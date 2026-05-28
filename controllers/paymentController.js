import { PaymentMethods } from "../tableDeclarations.js";
import axios from "axios";
import { User, Transactions } from "../tableDeclarations.js";
import {
  generateTransactionId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { fetchLiveRateBackend } from "../utils/foreignAPIGetters.js";
import mongoose from "mongoose";

const USD_SUBSCRIPTION_PRICES = {
  Pro: 1.11,
  Premium: 3.69,
  Free: 0,
};

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
      const transactionId = generateTransactionId('buy');
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
        notificationId: generateNotificationId('finance'),
        recipientId: userId,
        recipientEmail: updatedUser.email,
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
export const initializeWithdraw = async (req, res) => {
  const { iCashAmount, amountToReceive, fee, currency, bankDetails } = req.body;
  const userId = req.user.uid;
  const idempotencyKey = `wd-${userId}-${Date.now().toString().substring(0, 10)}`;
  const transactionId = generateTransactionId('withdraw');
  const title = "iCash Withdrawal",
  const user = await User.findOne({ uid: userId });
  if (user.iCashBalance < iCashAmount) {
    return res.status(400).json({ message: "Insufficient iCash balance." });
  }
  user.iCashBalance -= iCashAmount;
  try {
    const userName =
      user.username || user.firstname || "iCampus User";
    const newWithdrawal = await Transactions.create({
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
      createdAt: Date.now(),
    });
    await user.save();
    const response = await axios.post(
      "https://api.flutterwave.com/v3/transfers",
      {
        account_bank: bankDetails.bankCode,
        account_number: bankDetails.accountNumber,
        amount: amountToReceive,
        currency: currency,
        narration: "iCampus iCash Withdrawal",
        reference: idempotencyKey, 
        callback_url: `${process.env.BACKEND_URL}/hooks/flutterwave`,
        debit_currency: "NGN",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (response.data.status === "success") {
      await Transactions.findOneAndUpdate({ transactionId }, { status: "success" });
      createNotification({
        notificationId: generateNotificationId('finance'),
        recipientId: userId,
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
      });
      return res.status(200).json({
        status: "success",
        message: "Transfer initiated successfully",
        data: response.data.data,
      });
    } else {
      user.iCashBalance += iCashAmount;
      await user.save();
      await Transactions.findOneAndUpdate({ transactionId }, { status: "failed" });
      return res.status(400).json({ 
        status: "error", 
        message: response.data.message || "Flutterwave declined the transfer." 
      });
    }
  } catch (error) {
    console.error("Withdrawal Error:", error.response?.data || error.message);
    if (error.response || error.request) {
      const user = await User.findOne({ uid: userId });
      user.iCashBalance += iCashAmount;
      await user.save();
      await Transactions.findOneAndUpdate({ transactionId }, { status: "failed" });
    }
    if (error.code === 11000) {
      return res.status(409).json({ message: "Request already in progress." });
    }
    res.status(500).json({
      status: "error",
      message: error.response?.data?.message || "Internal Server Error",
    });
  }
};
export const handleP2pTransfers = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { recipientId, amount, description, recipientiTagName } = req.body;
      const senderId = req.user.id;
      if (amount <= 0)
        return res.status(400).json({ message: "Invalid amount" });
      if (senderId === recipientId)
        return res.status(400).json({ message: "Cannot send to yourself" });

      const sender = await User.findOne({ uid: senderUid }).session(session);
      const recipient = await User.findOne({
        uid: recipientId,
        itagusername: recipientiTagName,
      }).session(session);

      if (!recipient) throw new Error("Recipient not found");
      if (sender.pointsBalance < amount)
        return res.status(400).json({ message: "Insufficient iCash balance" });

      const transactionRef = `P2P-${uuidv4().substring(0, 8).toUpperCase()}`;

      sender.pointsBalance -= amount;
      recipient.pointsBalance += amount;
      await sender.save({ session });
      await recipient.save({ session });

      // 5. Create Transactions Records (Dual-entry)
      const senderTransactionId = generateTransactionId("p2p_sent");
      const senderTx = new Transactions({
        transactionId: senderTransactionId,
        userId: senderId,
        type: "p2p_sent",
        amountICash: amount,
        status: "success",
        payType: "out",
        title: "iCash Sent",
        reference: transactionRef,
        metadata: { recipientId, note: description },
      });
      const receipientTransactionId = generateTransactionId("p2p_received");
      const recipientTx = new Transactions({
        transactionId: receipientTransactionId,
        userId: recipientId,
        type: "p2p_received",
        amountICash: amount,
        status: "success",
        payType: "in",
        title: "iCash Received",
        reference: `${transactionRef}-REC`, 
        metadata: { senderId: senderId, note: description },
      });
      await senderTx.save({ session });
      await recipientTx.save({ session });
      await session.commitTransaction();
      session.endSession();
      const senderNotificationId = generateNotificationId("finance");
      const receipientNotificationId = generateNotificationId("finance");
      createNotification({
        notificationId: senderNotificationId,
        recipientId: senderUid,
        category: "financial",
        actionType: "ICASH_WITHDRAWAL",
        title: "iCash Sent Successfully",
        message: `You sent ${amount.toLocaleString()} iCash to ${recipient.username}.`,
        payload: {
          userName: sender.username,
          amountICash: amount,
          amountLocal: 0,
          currency: "iCash",
          transactionId: transactionRef,
        },
        sendSocket: true,
        sendPush: true,
      });
      createNotification({
        notificationId: receipientNotificationId,
        recipientId: recipientId,
        category: "financial",
        actionType: "ICASH_PURCHASE",
        title: "iCash Received!",
        message: `You received ${amount.toLocaleString()} iCash from ${sender.username}.`,
        payload: {
          userName: recipient.username,
          amountICash: amount,
          transactionId: transactionRef,
        },
        sendSocket: true,
        sendPush: true,
      });
      res.status(200).json({ message: "Transfer successful", transactionRef });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      res
        .status(500)
        .json({ message: error.message || "Internal Server Error" });
    }
};
export const verifySubscriptionFlwPayment = async (req, res) => {
    const { transactionId, tier, currentExchangeRate } = req.body;
    const SECRET_KEY = process.env.FLUTTERWAVE_CLIENT_SECRET;
    if (!transactionId) {
      return res
        .status(400)
        .json({ status: "error", message: "Transactions ID is required" });
    }
    try {
      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
        {
          headers: {
            Authorization: `Bearer ${SECRET_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );
      const { status, currency, id, amount, customer } = response.data.data;
      if (status !== "successful") {
        return res
          .status(400)
          .json({ status: "error", message: "Transactions not successful" });
      }
      const baseUsdPrice = USD_SUBSCRIPTION_PRICES[tier];
      if (baseUsdPrice === undefined) {
        return res.status(400).json({ message: "Invalid tier selected" });
      }
      const expectedLocalPrice = baseUsdPrice * currentExchangeRate;
      const margin = 1;
      if (amount < expectedLocalPrice - margin) {
        return res.status(400).json({
          message: `Insufficient payment. Expected approx ${expectedLocalPrice} ${currency}`,
        });
      }
      const updatedUser = await User.findOneAndUpdate(
        { uid: req.user.uid },
        {
          $set: {
            tier: tier,
            isSubscribed: true,
            subscriptionDate: new Date(),
            lastTransactionId: id,
          },
        },
        { new: true },
      );
      const userName = updatedUser && updatedUser.usertype === 'enterprise' ? updatedUser.organizationName : updatedUser.firstname;
      await createNotification({
        notificationId: generateNotificationId('subscription'),
        recipientId: updatedUser.uid,
        category: "finance",
        actionType: "SUBSCRIPTION_UPGRADED",
        title: "Subscription Successful",
        message: `Your account has been upgraded to the ${tier} plan.`,
        recipientEmail: updatedUser.email,
        sendEmail: true,
        payload: {
          userName,
          tier: tier,
          amount: amount,
          currency: currency,
          transactionId: id,
        },
      });

      return res.status(200).json({
        status: "success",
        message: "Subscription verified and activated",
        data: { transactionId: id },
        tier: updatedUser.tier,
      });
    } catch (error) {
      console.error(
        "FLW Verification Error:",
        error.response?.data || error.message,
      );
      return res.status(500).json({
        status: "error",
        message: "Internal server error during verification",
      });
    }
  }
