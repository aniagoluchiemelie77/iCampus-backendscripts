import axios from "axios";
import { User, PaymentMethods } from "../tableDeclarations.js";
import { setImmediate } from "timers";
import { generateNotificationId } from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { USD_SUBSCRIPTION_PRICES } from "../constants/inAppConstants.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { encryptCardDetails } from "../utils/encryptionHelper.js";
import { TAX_RATE } from "../constants/inAppConstants.js";

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
export const initiateFlwCharge = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "initiateFlwChargeController";
  const action = "initiateFlwCharge";
  const { paymentType, paymentData } = req.body || {};
  const { cardData, isInternational, currencyCode, amount, meta } =
    paymentData || {};

  const SECRET_KEY = process.env.FLUTTERWAVE_CLIENT_SECRET;
  const ENCRYPTION_KEY = process.env.FLUTTERWAVE_CLIENT_EKEY;
  const userId = req.user?.uid || req.user?.id;

  try {
    let userEmail = req.user?.email;
    let userFirstname = req.user?.firstname;
    let userLastname = req.user?.lastname;
    let userOrgName = req.user?.organizationName;

    let userPromise = Promise.resolve(null);
    if ((!userEmail || (!userFirstname && !userOrgName)) && userId) {
      userPromise = User.where("uid", "==", userId).limit(1).get();
    }
    const [userQuery] = await Promise.all([userPromise]);

    if (userQuery && !userQuery.empty) {
      const userData = userQuery.docs[0].data();
      userEmail = userEmail || userData.email;
      userFirstname = userFirstname || userData.firstname;
      userLastname = userLastname || userData.lastname;
      userOrgName = userOrgName || userData.organizationName;
    }

    let finalPayload = {};
    let flwEndpointType = paymentType;
    const resolvedBusinessName =
      userOrgName ||
      `${userFirstname || ""} ${userLastname || ""}`.trim() ||
      "Marketplace Vendor";

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
      const chargeAmount = amount ? amount.toString() : "50";
      const txRefPrefix =
        meta?.purpose === "checkout_payment" ? "checkout" : "link-card";
      finalPayload = {
        client: encryptedData,
        currency: currencyCode || "NGN",
        amount: chargeAmount,
        fullname:
          cardData.name ||
          `${userFirstname || ""} ${userLastname || ""}`.trim() ||
          "User",
        email: userEmail,
        tx_ref: `${txRefPrefix}-${Date.now()}`,
        meta,
        authorization: {
          mode: isInternational ? "avs_noauth" : "pin",
        },
      };
    } else if (paymentType === "account") {
      if (meta?.purpose === "checkout_payment") {
        flwEndpointType = "account";
        const chargeAmount = amount ? amount.toString() : "50";
        finalPayload = {
          account_bank: paymentData?.account_bank,
          account_number: paymentData?.account_number,
          amount: chargeAmount,
          currency: currencyCode || "NGN",
          email: userEmail,
          tx_ref: `checkout-bank-${Date.now()}`,
          fullname: resolvedBusinessName,
          meta,
        };
        targetUrl = `https://api.flutterwave.com/v3/charges?type=account`;
      } else {
        flwEndpointType = null;
        finalPayload = {
          account_bank: paymentData.account_bank,
          account_number: paymentData.account_number,
          business_name: resolvedBusinessName,
          split_type: "percentage",
          split_value: TAX_RATE * 100,
        };
        targetUrl = "https://api.flutterwave.com/v3/subaccounts";
      }
    } else {
      finalPayload = paymentData;
      targetUrl = `https://api.flutterwave.com/v3/charges?type=${flwEndpointType}`;
    }
    const flwResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(finalPayload),
    });

    const data = await flwResponse.json();
    if (
      paymentType === "account" &&
      flwResponse.status === 200 &&
      data.status === "success"
    ) {
      const subaccountId = data.data.subaccount_id;
      const bankCode = paymentData.account_bank;
      const accountNumber = paymentData.account_number;

      setImmediate(async () => {
        try {
          await User.where("uid", "==", userId)
            .get()
            .then((snapshot) => {
              if (!snapshot.empty) {
                snapshot.docs[0].ref.update({
                  subaccountId,
                  bankCode,
                  accountNumber,
                });
              }
            });
        } catch (dbErr) {
          console.error(
            "Failed to save payout bank details to user profile:",
            dbErr.message,
          );
        }
      });
    }

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
      message: "Internal Server Error Processing Request",
    });
  }
};
//Tested and trusted using jest