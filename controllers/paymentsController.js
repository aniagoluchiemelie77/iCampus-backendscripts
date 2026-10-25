/**
 * Every in-app purchase (marketplace checkout, subscription) goes through the same three steps:
 *
 *  1. POST /users/payments/intent   - the server prices the purchase and
 *     stores a pending intent keyed by its tx_ref. The app never decides
 *     the amount or currency.
 *  2. The app opens Flutterwave's hosted checkout with that tx_ref/amount.
 *  3. POST /users/payments/confirm  - or the charge.completed webhook,
 *     whichever arrives first - verifies the transaction with Flutterwave
 *     and fulfils the intent exactly once.
 */
import crypto from "crypto";
import { setImmediate } from "timers";
import { db } from "../config/firebaseAdmin.js";
import {
  User,
  Product,
  ProductOrder,
  Transactions,
  TaxEntries,
  PaymentIntents,
} from "../tableDeclarations.js";
import {
  USD_SUBSCRIPTION_PRICES,
  DELIVERY_FEES,
  TAX_RATE,
} from "../constants/inAppConstants.js";
import {
  convertAmount,
  chargeCurrencyForCountry,
  currencyForCountry,
} from "../utils/currency.js";
import {
  PaymentError,
  flwRequest,
  verifyFlwTransaction,
  refundFlwTransaction,
  roundMoney,
  roundUpMoney,
} from "../utils/flutterwave.js";
import {
  generateNotificationId,
  generateTransactionId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { client as redis } from "../workers/reditFile.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { sendOrderNotifications } from "./storeControllers.js";

const PURPOSES = ["checkout", "subscription"];
const PAID_TIERS = ["pro", "premium"];
const MAX_CHECKOUT_ITEMS = 50;
const MAX_ITEM_QUANTITY = 100;
// Allowed shortfall between the intent amount and what Flutterwave reports
// (rounding only; never more than one minor unit).
const AMOUNT_TOLERANCE = 0.01;

/** Thrown when a verified payment cannot be fulfilled; triggers a refund. */
class FulfilmentError extends Error {}

const userIdOf = (req) => req.user?.uid || req.user?.id;

const sendError = (res, error, controllerName, action, startTime) => {
  const status = error instanceof PaymentError ? error.status : 500;
  setImmediate(() =>
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    ),
  );
  if (status >= 500 && !(error instanceof PaymentError)) {
    console.error(`${controllerName}:`, error);
  }
  return res.status(status).json({
    success: false,
    code: error.code,
    message:
      status >= 500 && !(error instanceof PaymentError)
        ? "Something went wrong processing the payment."
        : error.message,
  });
};

const findUserDoc = async (uid, transaction) => {
  const query = User.where("uid", "==", uid).limit(1);
  const snap = transaction ? await transaction.get(query) : await query.get();
  return snap.empty ? null : snap.docs[0];
};

const sameStation = (a, b) =>
  !!a &&
  !!b &&
  ((a.id != null && b.id != null && String(a.id) === String(b.id)) ||
    (a.name === b.name && a.address === b.address));

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Prices a cart on the server. Everything that affects money (price,
 * currency, seller, delivery fee, drop-off agent) comes from the database,
 * not from the request.
 */
export async function quoteCheckout(rawItems, buyer, buyerCurrency) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new PaymentError("Your cart is empty.");
  }
  if (rawItems.length > MAX_CHECKOUT_ITEMS) {
    throw new PaymentError("Too many items in one checkout.");
  }
  const tier = DELIVERY_FEES[buyer.tier] ? buyer.tier : "free";
  const seen = new Set();

  const lines = await Promise.all(
    rawItems.map(async (raw) => {
      const productId = String(raw?.productId || "");
      const quantity = Number(raw?.quantity);
      if (!productId || seen.has(productId)) {
        throw new PaymentError("Each product can only appear once.");
      }
      seen.add(productId);
      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_ITEM_QUANTITY
      ) {
        throw new PaymentError("Invalid quantity in your cart.");
      }

      const productSnap = await Product.where("productId", "==", productId)
        .limit(1)
        .get();
      if (productSnap.empty) {
        throw new PaymentError("A product in your cart no longer exists.");
      }
      const product = productSnap.docs[0].data();
      if (product.sellerId === buyer.uid) {
        throw new PaymentError("You cannot buy your own listing.");
      }
      const stock = Number(product.amountInStock ?? 0);
      if (product.isAvailable === false || stock < quantity) {
        throw new PaymentError(
          `${product.title || "An item"} only has ${Math.max(stock, 0)} left in stock.`,
        );
      }
      const unitPrice = Number(product.price);
      if (!(unitPrice > 0)) {
        throw new PaymentError(`${product.title || "An item"} has no price.`);
      }

      const seller = await findUserDoc(product.sellerId);
      if (!seller) {
        throw new PaymentError(
          `The seller of ${product.title || "an item"} is no longer available.`,
        );
      }
      const sellerData = seller.data();
      const sellerCurrency =
        product.currency || currencyForCountry(sellerData.country);

      const isPhysical = !product.type || product.type === "physical";
      const gateways = product.physicalDetails?.sellerGateways || [];
      const stations = product.physicalDetails?.dropOffAddress || [];
      let deliveryMethod = raw.deliveryMethod;
      let station = null;
      if (isPhysical) {
        if (deliveryMethod === "home_delivery") {
          if (!gateways.includes("home_delivery")) {
            throw new PaymentError(
              `${product.title} does not offer home delivery.`,
            );
          }
        } else {
          deliveryMethod = "drop_off";
          station = stations.find((s) => sameStation(s, raw.selectedStation));
          if (!station) {
            throw new PaymentError(
              `Select a valid drop-off station for ${product.title}.`,
            );
          }
        }
      } else {
        deliveryMethod = "none";
      }

      const feeRate = isPhysical
        ? DELIVERY_FEES[tier][deliveryMethod] || 0
        : 0;
      const sellerAmount = roundMoney(unitPrice * quantity);
      const itemTotal = roundMoney(
        await convertAmount(sellerAmount, sellerCurrency, buyerCurrency),
      );
      const deliveryFee = roundMoney(itemTotal * feeRate);

      return {
        productId,
        productName: product.title || "Product",
        sellerId: product.sellerId,
        sellerEmail: sellerData.email || null,
        quantity,
        color: raw.color ?? null,
        size: raw.size ?? null,
        deliveryMethod,
        selectedStation: station,
        agentId: station?.agentId || null,
        sellerCurrency,
        sellerAmount,
        sellerDeliveryFee: roundMoney(sellerAmount * feeRate),
        itemTotal,
        deliveryFee,
      };
    }),
  );

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.itemTotal, 0));
  const delivery = roundMoney(lines.reduce((s, l) => s + l.deliveryFee, 0));
  return { lines, subtotal, delivery, total: roundUpMoney(subtotal + delivery) };
}

async function priceIntent(purpose, body, user, currency) {
  if (purpose === "subscription") {
    const tier = String(body.tier || "").toLowerCase();
    if (!PAID_TIERS.includes(tier)) {
      throw new PaymentError("Choose a paid plan to upgrade to.");
    }
    const amount = await convertAmount(
      USD_SUBSCRIPTION_PRICES[tier],
      "USD",
      currency,
    );
    return {
      amount: roundUpMoney(amount),
      title: `iCampus ${tier[0].toUpperCase()}${tier.slice(1)} plan (30 days)`,
      payload: { tier },
    };
  }
  // checkout
  const quote = await quoteCheckout(body.items, user, currency);
  const phone = String(body.shippingContact?.phone || "").trim();
  const address = String(body.shippingContact?.address || "").trim();
  if (quote.lines.some((l) => l.deliveryMethod === "home_delivery")) {
    if (!phone || !address) {
      throw new PaymentError(
        "Add a phone number and delivery address for home delivery.",
      );
    }
  }
  return {
    amount: quote.total,
    title: `Purchase of ${quote.lines.length} item(s)`,
    payload: {
      lines: quote.lines,
      subtotal: quote.subtotal,
      delivery: quote.delivery,
      shippingContact: { phone: phone.slice(0, 40), address: address.slice(0, 300) },
    },
  };
}

export const createPaymentIntent = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createPaymentIntentController";
  const action = "createPaymentIntent";
  try {
    const uid = userIdOf(req);
    const purpose = req.body?.purpose;
    if (!PURPOSES.includes(purpose)) {
      throw new PaymentError("Unknown payment type.");
    }
    const userDoc = await findUserDoc(uid);
    if (!userDoc) throw new PaymentError("User not found.", 404);
    const user = userDoc.data();
    if (!user.email) {
      throw new PaymentError("Add an email address to your account to pay.");
    }

    const currency = chargeCurrencyForCountry(user.country);
    const { amount, title, payload } = await priceIntent(
      purpose,
      req.body,
      user,
      currency,
    );
    if (!(amount > 0)) throw new PaymentError("Nothing to pay for.");

    const txRef = `ICP-${purpose.slice(0, 3).toUpperCase()}-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const now = new Date();
    await PaymentIntents.doc(txRef).set({
      txRef,
      userId: uid,
      purpose,
      amount,
      currency,
      title,
      payload,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    res.status(200).json({
      success: true,
      txRef,
      amount,
      currency,
      title,
      customer: {
        email: user.email,
        name:
          `${user.firstname || ""} ${user.lastname || ""}`.trim() ||
          user.organizationName ||
          "iCampus user",
      },
      ...(purpose === "checkout"
        ? { subtotal: payload.subtotal, delivery: payload.delivery }
        : {}),
    });
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
  } catch (error) {
    return sendError(res, error, controllerName, action, startTime);
  }
};

// ---------------------------------------------------------------------------
// Fulfilment (runs inside a Firestore transaction: reads first, then writes)
// ---------------------------------------------------------------------------

const FULFIL = {
  async subscription(t, intent, flw) {
    const userDoc = await findUserDoc(intent.userId, t);
    if (!userDoc) throw new FulfilmentError("User not found.");
    const user = userDoc.data();
    const tier = intent.payload.tier;
    const now = new Date();
    // Renewing the same plan early extends it instead of wasting the rest.
    const currentExpiry = user.subscriptionExpiresAt?.toDate
      ? user.subscriptionExpiresAt.toDate()
      : user.subscriptionExpiresAt
        ? new Date(user.subscriptionExpiresAt)
        : null;
    const base =
      user.tier === tier && currentExpiry && currentExpiry > now
        ? currentExpiry
        : now;
    const expiresAt = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

    const transactionId = generateTransactionId("payment");
    t.update(userDoc.ref, {
      tier,
      isSubscribed: true,
      subscriptionDate: now,
      subscriptionExpiresAt: expiresAt,
      lastTransactionId: flw.id,
      reminderSent7Days: false,
      reminderSent1Day: false,
      updatedAt: now,
    });
    t.set(Transactions.doc(transactionId), {
      transactionId,
      userId: intent.userId,
      type: "subscription",
      amount: intent.amount,
      currency: intent.currency,
      status: "success",
      payType: "out",
      title: intent.title,
      reference: intent.txRef,
      gatewayReference: String(flw.id),
      createdAt: now,
      updatedAt: now,
    });
    return {
      tier,
      subscriptionExpiresAt: expiresAt.toISOString(),
      transactionId,
      email: user.email,
      firstname: user.firstname,
    };
  },

  async checkout(t, intent, flw) {
    const { lines, shippingContact } = intent.payload;
    const productSnaps = await Promise.all(
      lines.map((l) =>
        t.get(Product.where("productId", "==", l.productId).limit(1)),
      ),
    );
    const now = new Date();
    const buyerTxId = generateTransactionId("payment");
    const orders = [];

    lines.forEach((line, i) => {
      const snap = productSnaps[i];
      if (snap.empty) {
        throw new FulfilmentError(`${line.productName} is no longer available.`);
      }
      const productDoc = snap.docs[0];
      const stock = Number(productDoc.data().amountInStock ?? 0);
      if (stock < line.quantity) {
        throw new FulfilmentError(`${line.productName} sold out before payment completed.`);
      }
      const updatedStock = stock - line.quantity;
      t.update(productDoc.ref, {
        amountInStock: updatedStock,
        ...(updatedStock === 0 ? { isAvailable: false } : {}),
        updatedAt: now,
      });

      const orderId = `ORD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const order = {
        orderId,
        buyerId: intent.userId,
        sellerId: line.sellerId,
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        color: line.color,
        size: line.size,
        status: "pending_delivery",
        deliveryMethod: line.deliveryMethod,
        selectedStation: line.selectedStation,
        agentId: line.agentId,
        // Secret shown only to the buyer (as a QR code); the seller or agent
        // must scan it to confirm delivery and release the funds.
        verificationQrCode: crypto.randomBytes(8).toString("hex"),
        // What the buyer paid for this item (delivery fee separate).
        amountPaid: line.itemTotal,
        deliveryFee: line.deliveryFee,
        amountPaidCurrencyCode: intent.currency,
        // The same amounts in the seller's currency, used for settlement.
        sellerAmount: line.sellerAmount,
        sellerDeliveryFee: line.sellerDeliveryFee,
        sellerCurrency: line.sellerCurrency,
        shippingContact:
          line.deliveryMethod === "home_delivery" ? shippingContact : null,
        flwRef: String(flw.id),
        paymentIntentId: intent.txRef,
        buyerTransactionId: buyerTxId,
        createdAt: now.toISOString(),
        updatedAt: now,
      };
      t.set(ProductOrder.doc(orderId), order);

      const productTax = roundMoney(line.itemTotal * TAX_RATE);
      if (productTax > 0) {
        t.set(TaxEntries.doc(generateTransactionId("appTax")), {
          transactionReference: `REF-${buyerTxId}`,
          taxType: "product_tax",
          amount: productTax,
          currency: intent.currency,
          date: now,
          sourceDetails: {
            buyerId: intent.userId,
            sellerId: line.sellerId,
            productId: line.productId,
            relatedTransactionId: orderId,
          },
          createdAt: now,
        });
      }
      orders.push(order);
    });

    t.set(Transactions.doc(buyerTxId), {
      transactionId: buyerTxId,
      userId: intent.userId,
      type: "checkout",
      amount: intent.amount,
      currency: intent.currency,
      status: "success",
      payType: "out",
      gatewayReference: String(flw.id),
      title: intent.title,
      reference: `REF-${buyerTxId}`,
      createdAt: now,
    });
    return { orders, transactionId: buyerTxId };
  },
};

const AFTER_FULFIL = {
  async subscription(intent, result) {
    await Promise.all([
      createNotification({
        notificationId: generateNotificationId("subscription"),
        recipientId: intent.userId,
        isRead: false,
        category: "finance",
        actionType: "SUBSCRIPTION_UPGRADED",
        title: "Subscription Successful",
        message: `Your account has been upgraded to the ${result.tier} plan.`,
        recipientEmail: result.email,
        sendEmail: !!result.email,
        saveToDb: true,
        payload: {
          userName: result.firstname,
          tier: result.tier,
          amount: intent.amount,
          currency: intent.currency,
          transactionId: result.transactionId,
        },
      }),
      notifyAdmins(
        { role: ["super_admin", "finance"] },
        {
          notificationId: generateNotificationId("subscription"),
          category: "subscription",
          actionType: "ADMIN_SUBSCRIPTION_UPGRADED",
          payload: {
            userEmail: result.email,
            userName: result.firstname,
            tier: result.tier,
            amount: intent.amount,
            currency: intent.currency,
            transactionId: result.transactionId,
          },
          senderId: "system",
        },
        false,
      ),
    ]);
  },
  async checkout(intent, result) {
    redis.del("catalog:all_products:v2").catch(() => {});
    const buyerDoc = await findUserDoc(intent.userId);
    const buyer = buyerDoc ? buyerDoc.data() : { uid: intent.userId };
    const byId = Object.fromEntries(
      intent.payload.lines.map((l) => [l.productId, l]),
    );
    await Promise.all([
      sendOrderNotifications(
        buyer,
        result.orders.map((order) => ({
          order,
          sellerEmail: byId[order.productId]?.sellerEmail,
          sellerId: order.sellerId,
          product: { title: order.productName },
          buyerAddress: order.shippingContact?.address || null,
          buyerPhoneNumber: order.shippingContact?.phone || null,
          deliveryMethod: order.deliveryMethod,
        })),
        result.transactionId,
      ),
      notifyAdmins(
        { role: ["super_admin", "finance"] },
        {
          notificationId: generateNotificationId("store"),
          actionType: "NEW_PURCHASE_ORDER",
          title: "New Purchase Order",
          message: `Order set #${result.transactionId} created with ${result.orders.length} items.`,
          payload: {
            transactionId: result.transactionId,
            itemCount: result.orders.length,
            buyerId: intent.userId,
          },
        },
        false,
      ),
    ]);
  },
};

/** What the app receives after a successful payment. */
const publicResult = (intent, result) => {
  if (intent.purpose === "checkout") {
    return { orders: result.orders, transactionId: result.transactionId };
  }
  if (intent.purpose === "subscription") {
    return {
      tier: result.tier,
      subscriptionExpiresAt: result.subscriptionExpiresAt,
      transactionId: result.transactionId,
    };
  }
  throw new FulfilmentError("This payment type is no longer supported.");
};

async function refundFailedIntent(intentRef, flw, reason) {
  // Claim the refund so the webhook and the app can't both issue one.
  const claimed = await db.runTransaction(async (t) => {
    const snap = await t.get(intentRef);
    if (!snap.exists || snap.data().status !== "pending") return false;
    t.update(intentRef, {
      status: "refunding",
      failureReason: reason,
      gatewayTransactionId: String(flw.id),
      updatedAt: new Date(),
    });
    return true;
  });
  if (!claimed) return;
  let refunded = false;
  try {
    const { ok, data } = await refundFlwTransaction(flw.id);
    refunded = ok && data?.status === "success";
    if (!refunded) console.error("Flutterwave refund failed:", data);
  } catch (err) {
    console.error("Flutterwave refund error:", err.message);
  }
  await intentRef.update({
    status: refunded ? "refunded" : "refund_failed",
    updatedAt: new Date(),
  });
  setImmediate(() => {
    notifyAdmins(
      { role: ["super_admin", "finance"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: "PAYMENT_FULFILMENT_FAILED",
        title: refunded ? "Payment refunded" : "Refund needs attention",
        message: `${intentRef.id}: ${reason}${refunded ? " (refunded automatically)" : " (automatic refund FAILED, refund manually)"}`,
        payload: { txRef: intentRef.id, gatewayTransactionId: flw.id },
      },
      false,
    ).catch(() => {});
  });
}

/**
 * Verifies a Flutterwave transaction against its intent and fulfils it once.
 * Safe to call any number of times, from the app and from the webhook.
 */
export async function settleIntent(txRef, transactionId, { expectedUserId } = {}) {
  const intentRef = PaymentIntents.doc(String(txRef || "_"));
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) throw new PaymentError("Payment not found.", 404);
  const intent = intentSnap.data();
  if (expectedUserId && intent.userId !== expectedUserId) {
    throw new PaymentError("Payment not found.", 404);
  }
  if (intent.status === "completed") {
    return { intent, result: intent.result, alreadyCompleted: true };
  }
  if (intent.status !== "pending") {
    throw new PaymentError(
      intent.status === "refunded"
        ? "This payment could not be completed and was refunded."
        : "This payment could not be completed. Contact support if you were charged.",
      409,
    );
  }

  const flw = await verifyFlwTransaction(transactionId);
  const problems = [];
  if (flw.tx_ref !== intent.txRef) problems.push("reference mismatch");
  if (flw.status !== "successful") problems.push(`status ${flw.status}`);
  if (flw.currency !== intent.currency) problems.push("currency mismatch");
  if (Number(flw.amount) + AMOUNT_TOLERANCE < intent.amount) {
    problems.push(`underpaid (${flw.amount} < ${intent.amount})`);
  }
  if (problems.length) {
    // A pending/failed charge is not fraud; leave the intent pending so a
    // later webhook can still complete it.
    if (flw.status === "successful" && flw.tx_ref === intent.txRef) {
      await intentRef.update({
        status: "flagged",
        failureReason: problems.join(", "),
        gatewayTransactionId: String(flw.id),
        updatedAt: new Date(),
      });
    }
    throw new PaymentError(
      flw.status === "successful"
        ? "Payment details did not match this purchase. Support has been notified."
        : "The payment has not completed.",
      400,
    );
  }

  let fulfilled;
  try {
    fulfilled = await db.runTransaction(async (t) => {
      const fresh = await t.get(intentRef);
      const current = fresh.data();
      if (current.status === "completed") {
        return { result: current.result, alreadyCompleted: true };
      }
      if (current.status !== "pending") {
        throw new PaymentError("This payment is no longer pending.", 409);
      }
      const fulfilment = FULFIL[intent.purpose];
      if (!fulfilment) {
        throw new FulfilmentError("This payment type is no longer supported.");
      }
      const result = await fulfilment(t, intent, flw);
      const stored = publicResult(intent, result);
      t.update(intentRef, {
        status: "completed",
        gatewayTransactionId: String(flw.id),
        paidAmount: Number(flw.amount),
        result: stored,
        completedAt: new Date(),
        updatedAt: new Date(),
      });
      return { result: stored, raw: result, alreadyCompleted: false };
    });
  } catch (error) {
    if (error instanceof FulfilmentError) {
      await refundFailedIntent(intentRef, flw, error.message);
      throw new PaymentError(
        `${error.message} Your payment is being refunded.`,
        409,
        "REFUNDED",
      );
    }
    throw error;
  }

  if (!fulfilled.alreadyCompleted) {
    setImmediate(() => {
      AFTER_FULFIL[intent.purpose](intent, fulfilled.raw).catch((err) =>
        console.error(`Post-payment tasks failed (${intent.txRef}):`, err),
      );
    });
  }
  return { intent, result: fulfilled.result, alreadyCompleted: fulfilled.alreadyCompleted };
}

export const confirmPayment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "confirmPaymentController";
  const action = "confirmPayment";
  try {
    const { txRef, transactionId } = req.body || {};
    if (!txRef || !transactionId) {
      throw new PaymentError("Missing payment reference.");
    }
    const { intent, result } = await settleIntent(txRef, transactionId, {
      expectedUserId: userIdOf(req),
    });
    res.status(200).json({
      success: true,
      purpose: intent.purpose,
      amount: intent.amount,
      currency: intent.currency,
      ...result,
    });
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
  } catch (error) {
    return sendError(res, error, controllerName, action, startTime);
  }
};

// ---------------------------------------------------------------------------
// Payout bank account
// ---------------------------------------------------------------------------

const ACCOUNT_RESOLVE_COUNTRIES = new Set(["Nigeria"]);

async function resolveAccountName(bankCode, accountNumber) {
  const { ok, data } = await flwRequest("/accounts/resolve", {
    method: "POST",
    body: { account_number: accountNumber, account_bank: bankCode },
  });
  if (!ok || data?.status !== "success" || !data?.data?.account_name) {
    return null;
  }
  return data.data.account_name;
}

const validateAccountInput = (bankCode, accountNumber, country) => {
  const code = String(bankCode || "").trim();
  const number = String(accountNumber || "").replace(/\D/g, "");
  if (!code) throw new PaymentError("Select your bank.");
  const valid =
    country === "Nigeria"
      ? number.length === 10
      : number.length >= 6 && number.length <= 20;
  if (!valid) throw new PaymentError("Enter a valid account number.");
  return { code, number };
};

/** GET /users/payments/resolve-account?bankCode&accountNumber */
export const resolveBankAccount = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "resolveBankAccountController";
  const action = "resolveBankAccount";
  try {
    const country = req.user?.country || "Nigeria";
    const { code, number } = validateAccountInput(
      req.query.bankCode,
      req.query.accountNumber,
      country,
    );
    if (!ACCOUNT_RESOLVE_COUNTRIES.has(country)) {
      return res.status(200).json({ success: true, accountName: null });
    }
    const accountName = await resolveAccountName(code, number);
    if (!accountName) {
      throw new PaymentError("We couldn't find that account. Check the details.");
    }
    return res.status(200).json({ success: true, accountName });
  } catch (error) {
    return sendError(res, error, controllerName, action, startTime);
  }
};

/** POST /users/payments/payout-account { bankCode, accountNumber, bankName } */
export const savePayoutAccount = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "savePayoutAccountController";
  const action = "savePayoutAccount";
  try {
    const uid = userIdOf(req);
    const userDoc = await findUserDoc(uid);
    if (!userDoc) throw new PaymentError("User not found.", 404);
    const user = userDoc.data();
    const country = user.country || "Nigeria";
    const { code, number } = validateAccountInput(
      req.body?.bankCode,
      req.body?.accountNumber,
      country,
    );
    let accountName = null;
    if (ACCOUNT_RESOLVE_COUNTRIES.has(country)) {
      accountName = await resolveAccountName(code, number);
      if (!accountName) {
        throw new PaymentError("We couldn't find that account. Check the details.");
      }
    }
    const payoutAccount = {
      bankCode: code,
      bankName: String(req.body?.bankName || "").slice(0, 80) || null,
      accountNumber: number,
      accountName,
      currency: currencyForCountry(country),
      updatedAt: new Date(),
    };
    await userDoc.ref.update({
      payoutAccount,
      // Legacy fields read by older payout code.
      bankCode: code,
      accountNumber: number,
      updatedAt: new Date(),
    });
    res.status(200).json({
      success: true,
      payoutAccount: {
        ...payoutAccount,
        accountNumber: `••••${number.slice(-4)}`,
        updatedAt: payoutAccount.updatedAt.toISOString(),
      },
    });
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
  } catch (error) {
    return sendError(res, error, controllerName, action, startTime);
  }
};
