import axios from "axios";
import {
  User,
  Transactions,
  AccountStatement,
  PaymentMethods,
  TaxEntries,
} from "../tableDeclarations.js";
import { setImmediate } from "timers";
import {
  generateTransactionId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { fetchLiveRateBackend } from "../utils/foreignAPIGetters.js";
import { theme } from "../services/emailTheme.js";
import { storage, db } from "../config/firebaseAdmin.js";
import { generateStatementPDF } from "../templates/transactionHistoryTemplate.js";
import { sendEmail } from "../services/emailService.js";
import { encryptCardDetails } from "../utils/encryptionHelper.js";
import { USD_SUBSCRIPTION_PRICES } from "../constants/inAppConstants.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { executeTransferWithRetry } from "../utils/withdrawalRetryHelper.js";
import {
  checkAndFlagHeavyActivity,
  addFlag,
  checkAndFlagWithdrawals,
} from "../utils/flagger.js";
import { logControllerPerformance } from "../utils/eventLogger.js";

export const getSavedMethods = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getSavedMethodsController";
  const action = "getSavedMethods";

  try {
    const userId = req.params.userId || req.user?.id || req.user?.uid;

    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized or missing user identifier",
        );
      });
      return res
        .status(401)
        .json({ error: "Unauthorized or missing user identifier" });
    }

    const methodsQuery = await PaymentMethods.where(
      "userId",
      "==",
      userId,
    ).get();

    const methods = methodsQuery.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    methods.sort((a, b) => {
      const timeA = a.createdAt?.toDate
        ? a.createdAt.toDate().getTime()
        : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toDate
        ? b.createdAt.toDate().getTime()
        : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
    res.status(200).json(methods);

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ error: error.message });
  }
};
export const createPaymentMethod = async (userId, cardDetails) => {
  const startTime = Date.now();
  const controllerName = "createPaymentMethodController";
  const action = "createPaymentMethod";

  try {
    const response = await flutterwavedoc.payment_methods_post({
      type: "card",
      card: {
        ...cardDetails,
        cof: { enabled: true },
      },
      meta: {
        userId: userId,
      },
    });

    if (response.data.status === "success") {
      const pmd = response.data.data;
      const paymentMethodId = Math.random().toString(36).slice(2, 11);
      const createdAt = new Date();

      await PaymentMethods.doc(paymentMethodId).set({
        paymentMethodId,
        userId: userId,
        type: "card",
        flw_token: pmd.id,
        last4: pmd.card.last4,
        card_type: pmd.card.network,
        expiry: `${pmd.card.expiry_month}/${pmd.card.expiry_year}`,
        createdAt,
        updatedAt: createdAt,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    }
  } catch (err) {
    console.error("Hydraulic failure in payment processing:", err.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
    });
  }
};
export const initializeBuy = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "initializeBuyController";
  const action = "initializeBuy";
  const {
    amount,
    currency,
    userId,
    paymentToken,
    methodType,
    country,
    iCashAmount,
  } = req.body || {};

  const resolvedUserId = userId || req.user?.id || req.user?.uid;

  if (!country) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Country information is required to calculate exchange rates.",
      );
    });
    return res.status(400).json({
      status: "error",
      message: "Country information is required to calculate exchange rates.",
    });
  }

  if (!amount || !paymentToken) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing payment details",
      );
    });
    return res
      .status(400)
      .json({ status: "error", message: "Missing payment details" });
  }

  try {
    const [rateData, userQuery] = await Promise.all([
      fetchLiveRateBackend(country),
      (!req.user?.email || !req.user?.firstname) && resolvedUserId
        ? User.where("uid", "==", resolvedUserId).limit(1).get()
        : Promise.resolve(null),
    ]);

    const { rate } = rateData || {};
    if (!rate) {
      throw new Error("Unable to fetch live exchange rate.");
    }

    const expectedInUsd = amount / rate;
    const EXCHANGE_RATE_USD = 0.74;
    const expectedICash = expectedInUsd / EXCHANGE_RATE_USD;
    const margin = 1.05;

    if (iCashAmount > expectedICash * margin) {
      console.error(
        `Security Alert: Price spoofing detected for User ${resolvedUserId}`,
      );
      setImmediate(async () => {
        try {
          await notifyAdmins(
            { role: ["super_admin", "finance"] },
            {
              notificationId: generateNotificationId("security"),
              actionType: "FINANCIAL_SECURITY_ALERT",
              payload: {
                userId: resolvedUserId,
                attemptedAmount: iCashAmount,
                expectedAmount: expectedICash,
                ipAddress: req.ip,
              },
              senderId: "system",
            },
            true,
          );
        } catch (err) {
          console.error(
            "Failed to notify admins of financial security alert:",
            err,
          );
        }
      });

      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Transaction integrity check failed. Please try again.",
        );
      });

      return res.status(400).json({
        status: "error",
        message: "Transaction integrity check failed. Please try again.",
      });
    }

    let userEmail = req.user?.email;
    let userFirstname = req.user?.firstname;
    let userLastname = req.user?.lastname;

    if (userQuery && !userQuery.empty) {
      const userData = userQuery.docs[0].data();
      userEmail = userEmail || userData.email;
      userFirstname = userFirstname || userData.firstname;
      userLastname = userLastname || userData.lastname;
    }

    const flwPayload = {
      token: paymentToken,
      currency: currency || "NGN",
      amount: amount,
      email: userEmail,
      first_name: userFirstname,
      last_name: userLastname,
      tx_ref: `iCampus-BUY-${Date.now()}`,
      ip: req.ip,
      meta: {
        userId: resolvedUserId,
        type: "icash_purchase",
        methodType,
        iCashAmount,
      },
    };

    const response = await axios.post(
      "https://api.flutterwave.com/v3/tokenized-charges",
      flwPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
          "Content-Type": "application/json",
        },
      },
    );

    const result = response.data;

    if (result.status === "success") {
      res.status(200).json({
        status: "success",
        message: "Charge initiated",
        authorization_url: result.meta?.authorization?.redirect || null,
        data: result.data,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    } else {
      res.status(400).json({ status: "error", message: result.message });

      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          result.message,
        );
      });
    }
  } catch (error) {
    console.error(
      "Tokenized Charge Error:",
      error.response?.data || error.message,
    );

    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.response?.data || error.message,
      );
    });

    return res.status(500).json({
      status: "error",
      message: error.response?.data?.message || "Internal Server Error",
    });
  }
};
export const initializeWithdraw = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "initializeWithdrawController";
  const action = "initializeWithdraw";
  const userId = req.user.uid || req.user.id;
  const { iCashAmount, amountToReceive, fee, currency, bankDetails } = req.body;
  const idempotencyKey = `wd-${userId}-${Date.now().toString().substring(0, 10)}`;
  const transactionId = generateTransactionId("withdraw");
  const title = `${iCashAmount} iCash Withdrawal`;

  try {
    const [userQuery, isFlagged] = await Promise.all([
      User.where("uid", "==", userId).limit(1).get(),
      checkAndFlagWithdrawals(userId),
    ]);

    if (userQuery.empty) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User profile record could not be resolved.",
        );
      }
      return res
        .status(404)
        .json({ message: "User profile record not found." });
    }

    if (isFlagged) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Too many withdrawal requests. Please contact support.",
        );
      }
      return res.status(403).json({
        message: "Too many withdrawal requests. Please contact support.",
      });
    }

    const userDocRef = userQuery.docs[0].ref;
    const user = userQuery.docs[0].data();

    if ((user.iCashBalance || 0) < iCashAmount) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Insufficient iCash balance.",
        );
      }
      return res.status(403).json({ message: "Insufficient iCash balance." });
    }

    const updatedBalance = (user.iCashBalance || 0) - iCashAmount;

    const now = new Date();
    await Promise.all([
      userDocRef.update({
        iCashBalance: updatedBalance,
        updatedAt: now,
      }),
      Transactions.doc(transactionId).set({
        transactionId,
        userId,
        type: "withdraw",
        amountICash: iCashAmount,
        amountLocal: amountToReceive,
        fee,
        payType: "out",
        title,
        currency,
        status: "pending",
        reference: idempotencyKey,
        metadata: bankDetails,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    const response = await executeTransferWithRetry({
      account_bank: bankDetails.bankCode,
      account_number: bankDetails.accountNumber,
      amount: amountToReceive,
      currency: currency,
      narration: "iCampus iCash Withdrawal",
      reference: idempotencyKey,
      callback_url: `${process.env.BACKEND_URL}webhooks/handleFlutterwaveWebhook`,
      debit_currency: "NGN",
    });

    if (response.data.status === "success") {
      const taxEntryId = generateTransactionId("appTax");
      const taxDocRef = TaxEntries.doc(taxEntryId);
      await Promise.all([
        Transactions.doc(transactionId).update({
          status: "success",
          updatedAt: new Date(),
        }),
        taxDocRef.set({
          transactionReference: idempotencyKey,
          taxType: "withdrawal_tax",
          amount: fee,
          currency: "iCash",
          date: now,
          sourceDetails: {
            userId: userId,
            relatedTransactionId: transactionId,
            iCashAmountDeducted: iCashAmount,
            localAmountReceived: amountToReceive,
          },
          createdAt: now,
        }),
      ]);
      res.status(200).json({
        status: "success",
        message: "Transfer initiated successfully",
        data: response.data.data,
      });
      setImmediate(async () => {
        try {
          const userName = user.firstname || "iCampus User";
          await Promise.all([
            createNotification({
              notificationId: generateNotificationId("finance"),
              recipientId: userId,
              isRead: false,
              recipientEmail: user.email,
              category: "finance",
              actionType: "ICASH_WITHDRAWAL",
              title,
              message: `Withdrawal of ${currency} ${amountToReceive} for ${iCashAmount} iCash is successful.`,
              payload: {
                userName,
                amountLocal: amountToReceive,
                amountICash: iCashAmount,
                currency,
                transactionId,
              },
              sendEmail: true,
              sendPush: true,
              sendSocket: true,
              saveToDb: true,
            }),
            notifyAdmins(
              { role: ["finance", "super_admin"] },
              {
                notificationId: generateNotificationId("finance"),
                actionType: "WITHDRAWAL_SUCCESS_AUDIT",
                payload: {
                  userId,
                  amount: amountToReceive,
                  currency,
                  transactionId,
                },
                senderId: "system",
              },
              false,
            ).catch(console.error),
          ]);

          if (typeof logControllerPerformance === "function") {
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            );
          }
        } catch (bgError) {
          console.error("Background Withdrawal Success Tasks Error:", bgError);
        }
      });
    } else {
      const refundedBalance = updatedBalance + iCashAmount;
      await Promise.all([
        userDocRef.update({
          iCashBalance: refundedBalance,
          updatedAt: new Date(),
        }),
        Transactions.doc(transactionId).update({
          status: "failed",
          updatedAt: new Date(),
        }),
      ]);

      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          response.data.message || "Flutterwave declined the transfer.",
        );
      }
      return res.status(400).json({
        status: "error",
        message: response.data.message || "Flutterwave declined the transfer.",
      });
    }
  } catch (error) {
    console.error("Withdrawal Error:", error.response?.data || error.message);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.response?.data?.message || error.message,
      );
    }

    if (error.response || error.request) {
      const rollbackQuery = await User.where("uid", "==", userId)
        .limit(1)
        .get();
      if (!rollbackQuery.empty) {
        const rollbackRef = rollbackQuery.docs[0].ref;
        const currentData = rollbackQuery.docs[0].data();
        await Promise.all([
          rollbackRef.update({
            iCashBalance: (currentData.iCashBalance || 0) + iCashAmount,
            updatedAt: new Date(),
          }),
          Transactions.doc(transactionId).update({
            status: "failed",
            updatedAt: new Date(),
          }),
        ]);
      }
    }

    if (error.code === 11000) {
      return res.status(409).json({ message: "Request already in progress." });
    }

    setImmediate(() => {
      notifyAdmins(
        { role: ["finance", "super_admin"] },
        {
          notificationId: generateNotificationId("finance"),
          actionType: "WITHDRAWAL_FAILED_AUDIT",
          payload: { userId, amount: amountToReceive, currency, transactionId },
          senderId: "system",
        },
        false,
      ).catch(console.error);
    });

    return res.status(500).json({
      status: "error",
      message: error.response?.data?.message || "Internal Server Error",
    });
  }
};
export const handleP2pTransfers = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "handleP2pTransfersController";
  const action = "handleP2pTransfers";

  try {
    const { recipientId, amount, description, recipientiTagName } = req.body;
    const senderId = req.user.id || req.user.uid;

    if (!amount || amount <= 0) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid amount",
        );
      }
      return res.status(400).json({ message: "Invalid amount" });
    }
    if (senderId === recipientId) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Cannot send to yourself",
        );
      }
      return res.status(400).json({ message: "Cannot send to yourself" });
    }

    const transactionRef = `P2P-${uuidv4().substring(0, 8).toUpperCase()}`;
    const senderTransactionId = generateTransactionId("p2p_sent");
    const receipientTransactionId = generateTransactionId("p2p_received");

    let senderData, recipientData;

    await db.runTransaction(async (t) => {
      const [senderQuery, recipientQuery] = await Promise.all([
        User.where("uid", "==", senderId).limit(1).get(),
        User.where("uid", "==", recipientId)
          .where("itagusername", "==", recipientiTagName)
          .limit(1)
          .get(),
      ]);

      if (senderQuery.empty) {
        throw new Error("Sender not found");
      }
      if (recipientQuery.empty) {
        throw new Error("Recipient not found");
      }

      const senderDoc = senderQuery.docs[0];
      const recipientDoc = recipientQuery.docs[0];

      senderData = senderDoc.data();
      recipientData = recipientDoc.data();

      const senderBalance =
        senderData.iCashBalance ?? senderData.pointsBalance ?? 0;
      if (senderBalance < amount) {
        throw new Error("Insufficient iCash balance");
      }

      const newSenderBalance = senderBalance - amount;
      const recipientBalance =
        recipientData.iCashBalance ?? recipientData.pointsBalance ?? 0;
      const newRecipientBalance = recipientBalance + amount;

      t.update(senderDoc.ref, {
        iCashBalance: newSenderBalance,
        pointsBalance: newSenderBalance,
        updatedAt: new Date(),
      });
      t.update(recipientDoc.ref, {
        iCashBalance: newRecipientBalance,
        pointsBalance: newRecipientBalance,
        updatedAt: new Date(),
      });

      const now = new Date();
      t.set(Transactions.doc(senderTransactionId), {
        transactionId: senderTransactionId,
        userId: senderId,
        type: "p2p_sent",
        amountICash: amount,
        status: "success",
        payType: "out",
        title: "iCash Sent",
        reference: transactionRef,
        metadata: {
          recipientId,
          note: description,
          recipientItag: recipientData.itagusername,
        },
        createdAt: now,
        updatedAt: now,
      });

      t.set(Transactions.doc(receipientTransactionId), {
        transactionId: receipientTransactionId,
        userId: recipientId,
        type: "p2p_received",
        amountICash: amount,
        status: "success",
        payType: "in",
        title: "iCash Received",
        reference: `${transactionRef}-REC`,
        metadata: {
          senderId: senderId,
          note: description,
          senderItag: senderData.itagusername,
        },
        createdAt: now,
        updatedAt: now,
      });
    });
    res.status(200).json({ message: "Transfer successful", transactionRef });
    setImmediate(async () => {
      try {
        await checkAndFlagHeavyActivity(senderId);

        const senderNotificationId = generateNotificationId("finance");
        const receipientNotificationId = generateNotificationId("finance");

        await Promise.all([
          createNotification({
            notificationId: senderNotificationId,
            recipientId: senderId,
            isRead: false,
            category: "financial",
            actionType: "ICASH_WITHDRAWAL",
            title: "iCash Sent Successfully",
            message: `You sent ${amount.toLocaleString()} iCash to ${recipientData.username || recipientData.firstname}.`,
            payload: {
              userName: senderData.firstname,
              amountICash: amount,
              amountLocal: 0,
              currency: "iCash",
              transactionId: senderTransactionId,
            },
            sendSocket: true,
            sendPush: true,
            saveToDb: true,
          }),
          createNotification({
            notificationId: receipientNotificationId,
            recipientId: recipientId,
            isRead: false,
            category: "financial",
            actionType: "ICASH_PURCHASE",
            title: "iCash Received!",
            message: `You received ${amount.toLocaleString()} iCash from ${senderData.username || senderData.firstname}.`,
            payload: {
              userName: recipientData.firstname,
              amountICash: amount,
              transactionId: receipientTransactionId,
            },
            sendSocket: true,
            sendPush: true,
            saveToDb: true,
          }),
          notifyAdmins(
            { role: ["finance", "super_admin"] },
            {
              notificationId: generateNotificationId("finance"),
              actionType: "P2P_TRANSFER_AUDIT",
              payload: {
                senderId: senderId,
                recipientId: recipientId,
                amount: amount,
                transactionRef: transactionRef,
              },
              senderId: "system",
            },
            false,
          ).catch(console.error),
        ]);

        if (typeof logControllerPerformance === "function") {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      } catch (bgError) {
        console.error("Background P2P Tasks Error:", bgError);
      }
    });
  } catch (error) {
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
    return res
      .status(500)
      .json({ message: error.message || "Internal Server Error" });
  }
};
export const verifySubscriptionFlwPayment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "verifySubscriptionFlwPaymentController";
  const action = "verifySubscriptionFlwPayment";
  const { transactionId, tier, currentExchangeRate } = req.body;
  const SECRET_KEY = process.env.FLUTTERWAVE_CLIENT_SECRET;
  const userId = req.user?.uid || req.user?.id;

  if (!transactionId) {
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Transactions ID is required",
      );
    }
    return res
      .status(400)
      .json({ status: "error", message: "Transactions ID is required" });
  }

  try {
    const [response, userQuery] = await Promise.all([
      axios.get(
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
        {
          headers: {
            Authorization: `Bearer ${SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        },
      ),
      User.where("uid", "==", userId).limit(1).get(),
    ]);

    const { status, currency, id, amount } = response.data.data;
    if (status !== "successful") {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Transactions not successful",
        );
      }
      return res
        .status(400)
        .json({ status: "error", message: "Transactions not successful" });
    }

    const baseUsdPrice = USD_SUBSCRIPTION_PRICES[tier];
    if (baseUsdPrice === undefined) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid tier selected",
        );
      }
      return res.status(400).json({ message: "Invalid tier selected" });
    }

    const expectedLocalPrice = baseUsdPrice * currentExchangeRate;
    const margin = 1;
    if (amount < expectedLocalPrice - margin) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          `Insufficient payment. Expected approx ${expectedLocalPrice} ${currency}`,
        );
      }
      return res.status(400).json({
        message: `Insufficient payment. Expected approx ${expectedLocalPrice} ${currency}`,
      });
    }

    if (userQuery.empty) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User profile record could not be resolved.",
        );
      }
      return res
        .status(404)
        .json({ status: "error", message: "User profile record not found." });
    }

    const userDocRef = userQuery.docs[0].ref;
    const existingUserData = userQuery.docs[0].data();
    const now = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(now.getDate() + 30);

    const subscriptionData = {
      tier: tier,
      isSubscribed: true,
      subscriptionDate: now,
      lastTransactionId: id,
      updatedAt: now,
      subscriptionExpiresAt: expiresAt,
      reminderSent7Days: false,
      reminderSent1Day: false,
    };

    await userDocRef.update(subscriptionData);

    const updatedUser = {
      ...existingUserData,
      ...subscriptionData,
    };
    res.status(200).json({
      status: "success",
      message: "Subscription verified and activated",
      data: { transactionId: id },
      tier: updatedUser.tier,
    });
    setImmediate(async () => {
      try {
        await Promise.all([
          createNotification({
            notificationId: generateNotificationId("subscription"),
            recipientId: updatedUser.uid,
            isRead: false,
            category: "finance",
            actionType: "SUBSCRIPTION_UPGRADED",
            title: "Subscription Successful",
            message: `Your account has been upgraded to the ${tier} plan.`,
            recipientEmail: updatedUser.email,
            sendEmail: true,
            saveToDb: true,
            payload: {
              userName: updatedUser.firstname,
              tier: tier,
              amount: amount,
              currency: currency,
              transactionId: id,
            },
          }),
          notifyAdmins(
            { role: ["super_admin", "finance"] },
            {
              notificationId: generateNotificationId("subscription"),
              category: "subscription",
              actionType: "ADMIN_SUBSCRIPTION_UPGRADED",
              payload: {
                userEmail: updatedUser.email,
                userName: updatedUser.firstname,
                tier: tier,
                amount: amount,
                currency: currency,
                transactionId: id,
              },
              senderId: "system",
            },
            false,
          ).catch((err) =>
            console.error("Admin subscription notification failed:", err),
          ),
        ]);

        if (typeof logControllerPerformance === "function") {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      } catch (bgError) {
        console.error("Background Subscription Tasks Error:", bgError);
      }
    });
  } catch (error) {
    console.error(
      "FLW Verification Error:",
      error.response?.data || error.message,
    );
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.response?.data || error.message,
      );
    }
    return res.status(500).json({
      status: "error",
      message: "Internal server error during verification",
    });
  }
};
export const generateTransactionHistory = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "generateTransactionHistoryController";
  const action = "generateTransactionHistory";

  try {
    const { colors } = theme;
    const { startDate, endDate } = req.body || {};
    const userId = req.user?.id || req.user?.uid;

    if (!userId || !startDate || !endDate) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing mandatory parameters or user identification.",
        );
      });
      return res.status(400).json({
        success: false,
        message: "Missing mandatory parameters or user identification.",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const [userQuery, statementQuery, txQuery] = await Promise.all([
      User.where("uid", "==", userId).limit(1).get(),
      AccountStatement.where("userId", "==", userId)
        .where("startDate", "==", start)
        .where("endDate", "==", end)
        .limit(1)
        .get(),
      Transactions.where("userId", "==", userId)
        .where("createdAt", ">=", start)
        .where("createdAt", "<=", end)
        .orderBy("createdAt", "desc")
        .get(),
    ]);

    if (userQuery.empty) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      });
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = userQuery.docs[0].data();
    const bucket = storage.bucket();
    const filePath = `statements/${userId}/AccountStatement-${start.getTime()}-${end.getTime()}.pdf`;
    const file = bucket.file(filePath);

    let firebaseUrl;
    let income = 0;
    let expense = 0;
    let pdfBuffer;

    if (!statementQuery.empty) {
      const existingStatement = statementQuery.docs[0].data();
      firebaseUrl = existingStatement.pdfUrl;
      income = existingStatement.income || 0;
      expense = existingStatement.expense || 0;

      const [downloadBuffer] = await file.download();
      pdfBuffer = downloadBuffer;
    } else {
      const history = [];
      txQuery.forEach((doc) => {
        const data = doc.data();
        if (data.payType === "in") {
          income += data.amountICash || 0;
        } else if (data.payType === "out") {
          expense += data.amountICash || 0;
        }
        history.push(data);
      });

      pdfBuffer = await generateStatementPDF({
        user,
        start,
        end,
        income,
        expense,
        history,
      });
      const statementId = `stmt-${userId}-${start.getTime()}-${end.getTime()}`;
      firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

      await Promise.all([
        file.save(pdfBuffer, {
          metadata: { contentType: "application/pdf" },
          public: true,
        }),
        AccountStatements.doc(statementId).set({
          statementId,
          userId,
          startDate: start,
          endDate: end,
          pdfUrl: firebaseUrl,
          income,
          expense,
          createdAt: new Date(),
        }),
      ]);
    }
    res.json({
      success: true,
      message: "Account Statement processed successfully!",
      pdfUrl: firebaseUrl,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
    setImmediate(async () => {
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
            <h2 style="color: ${colors.primary};">Your iCash Account Statement is Ready</h2>
            <p style="color: ${colors.text};">Hi ${user.firstname},</p>
            <p style="color: ${colors.text};">Attached is your transaction report for <b>${start.toDateString()}</b> to <b>${end.toDateString()}</b>.</p>
            <hr/>
            <p><b>Summary:</b></p>
            <p style="color: ${colors.success};">Total Received: ${income.toLocaleString()} iCash</p>
            <p style="color: ${colors.primary};">Total Spent: ${expense.toLocaleString()} iCash</p>
            <br/>
            <p style="color: ${colors.text};">Thank you for using iCampus.</p>
          </div>
        `;

        await sendEmail({
          to: user.email,
          subject: `iCash Account Statement: ${user.firstname}`,
          text: `Your iCash statement from ${start.toLocaleDateString()} is attached.`,
          html: emailHtml,
          attachments: [
            {
              filename: `iCash_Statement_${start.toISOString().split("T")[0]}.pdf`,
              content: pdfBuffer,
            },
          ],
        });
      } catch (err) {
        console.error(
          "Background email dispatch failure for account statement:",
          err,
        );
      }
    });
  } catch (error) {
    console.error("Account Statement Flow Error:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({ success: false, error: error.message });
  }
};
export const initiateFlwCharge = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "initiateFlwChargeController";
  const action = "initiateFlwCharge";
  const { paymentType, cardData, isInternational, currencyCode } =
    req.body || {};
  const SECRET_KEY = process.env.FLUTTERWAVE_CLIENT_SECRET;
  const ENCRYPTION_KEY = process.env.FLUTTERWAVE_CLIENT_EKEY;
  const userId = req.user?.uid || req.user?.id;

  try {
    let userEmail = req.user?.email;
    let userFirstname = req.user?.firstname;
    let userLastname = req.user?.lastname;
    if ((!userEmail || !userFirstname) && userId) {
      const userQuery = await User.where("uid", "==", userId).limit(1).get();
      if (!userQuery.empty) {
        const userData = userQuery.docs[0].data();
        userEmail = userEmail || userData.email;
        userFirstname = userFirstname || userData.firstname;
        userLastname = userLastname || userData.lastname;
      }
    }

    let finalPayload = {};
    if (paymentType === "card" && cardData) {
      const cardObject = JSON.stringify({
        card_number: cardData.number?.replace(/\s/g, "") || "",
        cvv: cardData.cvv,
        expiry_month: cardData.month,
        expiry_year: cardData.year,
        pin: cardData.pin,
        billing_address: cardData.address,
        billing_city: cardData.city,
        billing_state: cardData.state,
        billing_zip: cardData.zipcode,
        billing_country: cardData.country || "US",
      });
      const encryptedData = encryptCardDetails(ENCRYPTION_KEY, cardObject);
      finalPayload = {
        client: encryptedData,
        currency: currencyCode || "NGN",
        amount: "50",
        fullname:
          cardData.name ||
          `${userFirstname || ""} ${userLastname || ""}`.trim() ||
          "User",
        email: userEmail,
        tx_ref: `link-card-${Date.now()}`,
        meta: {
          userId: userId,
          purpose: "linking_card",
        },
        authorization: {
          mode: isInternational ? "avs_noauth" : "pin",
        },
      };
    } else {
      finalPayload = req.body.paymentData;
    }

    const flwResponse = await fetch(
      `https://api.flutterwave.com/v3/charges?type=${paymentType}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(finalPayload),
      },
    );

    const data = await flwResponse.json();

    res.status(flwResponse.status).json({ success: true, data });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (err) {
    console.error("Flutterwave Server Error:", err.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
    });
    return res.status(500).json({
      success: false,
      message: "Internal Server Error Processing Payment",
    });
  }
};
export const validatePaymentOTP = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "validatePaymentOTPController";
  const action = "validatePaymentOTP";

  try {
    const { otpCode, flw_ref, type } = req.body || {};
    if (!otpCode || !flw_ref) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "OTP and Reference are required.",
        );
      });
      return res.status(400).json({
        success: false,
        message: "OTP and Reference are required.",
      });
    }

    const response = await axios.post(
      "https://api.flutterwave.com/v3/validate-charge",
      {
        otp: otpCode,
        flw_ref: flw_ref,
        type: type || "card",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
        },
      },
    );

    if (response.data.status === "success") {
      res.status(200).json({
        success: true,
        message: "Payment verified successfully",
        data: response.data.data,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    } else {
      const message = response.data.message || "Verification failed";
      res.status(400).json({
        success: false,
        message,
      });

      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          message,
        );
      });
    }
  } catch (error) {
    console.error(
      "Flutterwave OTP Error:",
      error.response?.data || error.message,
    );

    const errorMessage = error.response?.data || error.message;
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        errorMessage,
      );
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Internal Server Error during verification",
    });
  }
};

//Tested and trusted using jest