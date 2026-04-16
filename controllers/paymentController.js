import { PaymentMethods } from "../tableDeclarations.js";
import axios from "axios";
import { User, Transactions } from "../tableDeclarations.js";
import {
  generateTransactionId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { fetchLiveRateBackend } from "../utils/foreignAPIGetters.js";

export const handleFlutterwaveWebhook = async (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_HASH;
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== secretHash) return res.status(401).end();
  const { event, data } = req.body;

  if (event === "charge.completed" && data.status === "successful") {
    const { userId, type, methodType, iCashAmount } = data.meta;
    const amountPaid = data.amount;
    const currency = data.currency;
    if (type === "icash_purchase") {
      const transactionId = generateTransactionId();
      const iCashToCredit = Math.floor(iCashAmount);
      const title = `${iCashToCredit} iCash purchased for ${data.currency} ${amountPaid}`;
      const updatedUser = await User.findOneAndUpdate(
        { uid: userId },
        { $inc: { pointsBalance: iCashToCredit } },
        { new: true },
      );
      const userName =
        updatedUser.username || updatedUser.firstname || "iCampus User";
      await Transactions.create({
        transactionId,
        userId,
        type: "buy",
        currency,
        amountLocal: amountPaid,
        amountICash: iCashToCredit,
        status: "success",
        payType: "in",
        title,
        reference: data.tx_ref,
        createdAt: Date.now(),
      });
      createNotification({
        notificationId: generateNotificationId(),
        recipientId: userId,
        category: "finance",
        actionType: "ICASH_PURCHASE",
        title,
        message: ` ${methodType} payment made for ${iCashToCredit} iCash purchase is successful.`,
        payload: {
          userName,
          amountLocal: amountPaid,
          amountICash: iCashToCredit,
          currency,
          transactionId,
        },
        sendEmail: true,
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      });
    }
    const paymentToken = data.card?.token || data.account?.token;
    if (paymentToken) {
      const existingMethod = await PaymentMethods.findOne({ paymentToken });
      if (!existingMethod) {
        const paymentData = {
          userId: data.meta.userId,
          method: data.payment_type === "card" ? "card" : "bank",
          paymentToken: data.card?.token || data.account?.token, // Map to paymentToken
          lastFourDigits:
            data.card?.last4digits || data.account?.account_number?.slice(-4),
          cardBrand: data.card?.issuer,
          bankName: data.account?.bank_name,
          bankAccNumber: data.account?.account_number,
          expiryMonth: data.card?.expiry_month,
          expiryYear: data.card?.expiry_year,
          billingAddressDetails: data.meta.address
            ? {
                street: data.meta.address,
                city: data.meta.city,
                zip: data.meta.zip,
              }
            : undefined,
        };
        await PaymentMethods.create(paymentData);
      }
    }
  }
  res.status(200).end();
};

export const getSavedMethods = async (req, res) => {
  try {
    const methods = await PaymentMethods.findAll({
      where: { userId: req.params.userId },
      order: [["createdAt", "DESC"]],
    });
    res.json(methods);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createPaymentMethod = async (userId, cardDetails) => {
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
      await PaymentMethods.create({
        userId: userId,
        type: "card",
        flw_token: pmd.id, // The pmd_... ID
        last4: pmd.card.last4,
        card_type: pmd.card.network,
        expiry: `${pmd.card.expiry_month}/${pmd.card.expiry_year}`,
      });
    }
  } catch (err) {
    console.error("Hydraulic failure in payment processing:", err);
  }
};

export const initializeBuy = async (req, res) => {
  const {
    amount,
    currency,
    userId,
    paymentToken,
    methodType,
    country,
    iCashAmount,
  } = req.body;

  if (!country) {
    return res.status(400).json({
      status: "error",
      message: "Country information is required to calculate exchange rates.",
    });
  }
  if (!amount || !paymentToken) {
    return res
      .status(400)
      .json({ status: "error", message: "Missing payment details" });
  }
  try {
    const EXCHANGE_RATE_USD = 0.74;
    const { rate } = await fetchLiveRateBackend(country);
    const expectedInUsd = amount / rate;
    const expectedICash = expectedInUsd / EXCHANGE_RATE_USD;
    const margin = 1.05;
    if (iCashAmount > expectedICash * margin) {
      console.error(
        `Security Alert: Price spoofing detected for User ${userId}`,
      );
      return res.status(400).json({
        status: "error",
        message: "Transaction integrity check failed. Please try again.",
      });
    }
    const flwPayload = {
      token: paymentToken,
      currency: currency || "NGN",
      amount: amount,
      email: req.user.email,
      first_name: req.user.firstname,
      last_name: req.user.lastname,
      tx_ref: `iCampus-BUY-${Date.now()}`,
      ip: req.ip,
      meta: {
        userId: userId,
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
      return res.status(200).json({
        status: "success",
        message: "Charge initiated",
        authorization_url: result.meta?.authorization?.redirect || null,
        data: result.data,
      });
    } else {
      return res.status(400).json({ status: "error", message: result.message });
    }
  } catch (error) {
    console.error(
      "Tokenized Charge Error:",
      error.response?.data || error.message,
    );
    res.status(500).json({
      status: "error",
      message: error.response?.data?.message || "Internal Server Error",
    });
  }
};
