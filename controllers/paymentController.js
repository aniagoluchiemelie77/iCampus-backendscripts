import axios from "axios";
import { User, Transactions, AccountStatement, PaymentMethods } from "../tableDeclarations.js";
import {
  generateTransactionId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { fetchLiveRateBackend } from "../utils/foreignAPIGetters.js";
import mongoose from "mongoose";
import { theme } from "../services/emailTheme.js";
import { storage } from "../config/firebaseAdmin.js";
import {generateStatementPDF} from '../templates/transactionHistoryTemplate.js';
import { sendEmail } from "../services/emailService.js";
import {encryptCardDetails} from '../utils/encryptionHelper.js';
import {USD_SUBSCRIPTION_PRICES} from '../constants/inAppConstants.js';
import { notifyAdmins } from "../services/adminNotification.js";
import {executeTransferWithRetry} from '../utils/withdrawalRetryHelper.js';

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
      notifyAdmins(
        { role: ["super_admin", "finance"] },
        {
          actionType: "FINANCIAL_SECURITY_ALERT",
          payload: {
            userId: userId,
            attemptedAmount: iCashAmount,
            expectedAmount: expectedICash,
            ipAddress: req.ip
          },
          senderId: "system"
        },
        true // Send email alert immediately
      ).catch(console.error);
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
  const title = `${iCashAmount} iCash Withdrawal`,
  const user = await User.findOne({ uid: userId });
  if (user.iCashBalance < iCashAmount) {
    return res.status(400).json({ message: "Insufficient iCash balance." });
  }
  user.iCashBalance -= iCashAmount;
  try {
    const userName =
      user.firstname || "iCampus User";
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
    const response = await executeTransferWithRetry({
    account_bank: bankDetails.bankCode,
    account_number: bankDetails.accountNumber,
    amount: amountToReceive,
    currency: currency,
    narration: "iCampus iCash Withdrawal",
    reference: idempotencyKey, 
    callback_url: `${process.env.BACKEND_URL}/hooks/flutterwave`,
    debit_currency: "NGN",
  });
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
      await notifyAdmins(
    { role: ["finance", "super_admin"] },
    {
      actionType: "WITHDRAWAL_SUCCESS_AUDIT",
      payload: { userId, amount: amountToReceive, currency, transactionId },
      senderId: "system"
    },
    false
  ).catch(console.error);
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
     await notifyAdmins(
    { role: ["finance", "super_admin"] },
    {
      actionType: "WITHDRAWAL_FAILED_AUDIT",
      payload: { userId, amount: amountToReceive, currency, transactionId },
      senderId: "system"
    },
    false
  ).catch(console.error);
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

      const sender = await User.findOne({ uid: senderId }).session(session);
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
        metadata: { 
          recipientId, 
          note: description,
          recipientItag: recipient.itagusername
        },
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
        metadata: { 
          senderId: senderId, 
          note: description,
          senderItag: sender.itagusername
        },
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
          userName: sender.firstname,
          amountICash: amount,
          amountLocal: 0,
          currency: "iCash",
          transactionId: senderTransactionId,
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
          userName: recipient.firstname,
          amountICash: amount,
          transactionId: receipientTransactionId,
        },
        sendSocket: true,
        sendPush: true,
      });
      await notifyAdmins(
  { role: ["finance", "super_admin"] },
  {
    actionType: "P2P_TRANSFER_AUDIT",
    payload: {
      senderId: senderId,
      recipientId: recipientId,
      amount: amount,
      transactionRef: transactionRef
    },
    senderId: "system"
  },
  false 
).catch(console.error);
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
  };
export const generateTransactionHistory = async (req, res) => {
    try {
      const { colors } = theme;
      const { startDate, endDate } = req.body;
      const userId = req.user.id;
      const user = await User.findOne({ uid: userId });
      if (!user) return res.status(404).json({ message: "User not found" });

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      const existingStatement = await AccountStatement.findOne({
        userId,
        startDate: start,
        endDate: end,
      });

      let firebaseUrl;
      let income = existingStatement?.income || 0;
      let expense = existingStatement?.expense || 0;
      let pdfBuffer;

      if (existingStatement) {
        firebaseUrl = existingStatement.pdfUrl;
        const bucket = storage.bucket();
        const filePath = `statements/${userId}/AccountStatement-${start.getTime()}-${end.getTime()}.pdf`;
        const file = bucket.file(filePath);

        const [downloadBuffer] = await file.download();
        pdfBuffer = downloadBuffer;
      } else {
        const reportData = await Transactions.aggregate([
        {
          $match: {
            userId,
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $facet: {
            stats: [
              {
                $group: { _id: "$payType", total: { $sum: "$amountICash" } },
              },
            ],
            history: [
              { $sort: { createdAt: -1 } },
              {
                $lookup: {
                  from: "users", 
                  localField: "receiverId", 
                  foreignField: "uid",      
                  as: "receiverDetails",
                },
              },
              {
                $unwind: {
                  path: "$receiverDetails",
                  preserveNullAndEmptyArrays: true, 
                }
              },
              {
                $addFields: {
                  receiverName: {
                    $cond: {
                      if: { $setEquals: [{ $ifNull: ["$receiverDetails", []] }, []] },
                      then: "$description", 
                      else: { $concat: ["$receiverDetails.firstname", " ", "$receiverDetails.lastname"] }
                    }
                  }
                }
              }  
            ],
          },
        },
      ]);

        const stats = reportData[0]?.stats || [];
        const history = reportData[0]?.history || [];

        income = stats.find((s) => s._id === "in")?.total || 0;
        expense = stats.find((s) => s._id === "out")?.total || 0;
        pdfBuffer = await generateStatementPDF({
          user,
          start,
          end,
          income,
          expense,
          history,
        });
        const bucket = storage.bucket();
        const fileName = `statements/${userId}/AccountStatement-${start.getTime()}-${end.getTime()}.pdf`;
        const file = bucket.file(fileName);

        await file.save(pdfBuffer, {
          metadata: { contentType: "application/pdf" },
          public: true,
        });

        firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
        const newStatement = new AccountStatement({
          userId,
          startDate: start,
          endDate: end,
          pdfUrl: firebaseUrl,
          income,
          expense,
        });
        await newStatement.save();
      }
      const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: ${colors.primary};">Your iCash AccountStatement is Ready</h2>
        <p style="color: ${colors.text};">Hi ${user.firstname},</p>
        <p style="color: ${colors.text};">Attached is your transaction report for <b>${start.toDateString()}</b> to <b>${end.toDateString()}</b>.</p>
        <hr/>
        <p><b>Summary:</b></p>
        <p style="color: ${colors.success};">Total Received: ${income.toLocaleString()} iCash</p>
        <p style="color:${colors.primary};">Total Spent: ${expense.toLocaleString()} iCash</p>
        <br/>
        <p style="color: ${colors.text};">Thank you for using iCampus.</p>
      </div>
    `;

      await sendEmail({
        to: user.email,
        subject: `iCash AccountStatement: ${user.firstname}`,
        text: `Your iCash statement from ${start.toLocaleDateString()} is attached.`,
        html: emailHtml,
        attachments: [
          {
            filename: `iCash_Statement_${start.toISOString().split("T")[0]}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      res.json({
        success: true,
        message: "AccountStatement processed successfully!",
        pdfUrl: firebaseUrl,
      });
    } catch (error) {
      console.error("AccountStatement Flow Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  };
export const initiateFlwCharge =  async (req, res) => {
    const { paymentType, cardData, isInternational, currencyCode } = req.body;
    const SECRET_KEY = process.env.FLUTTERWAVE_CLIENT_SECRET;
    const ENCRYPTION_KEY = process.env.FLUTTERWAVE_CLIENT_EKEY;

    try {
      let finalPayload = {};
      if (paymentType === "card") {
        const cardObject = JSON.stringify({
          card_number: cardData.number.replace(/\s/g, ""),
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
            `${req.user.firstname || ""} ${req.user.lastname || ""}`.trim() ||
            "User",
          email: req.user.email,
          tx_ref: `link-card-${Date.now()}`,
          meta: {
            userId: req.user.uid,
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
    } catch (err) {
      console.error("Flutterwave Server Error:", err);
      res
        .status(500)
        .json({
          success: false,
          message: "Internal Server Error Processing Payment",
        });
    }
  };
export const validatePaymentOTP = async (req, res) => {
  try {
    const { otpCode, flw_ref, type } = req.body;
    if (!otpCode || !flw_ref) {
      return res.status(400).json({ 
        success: false, 
        message: "OTP and Reference are required." 
      });
    }
    const response = await axios.post(
      'https://api.flutterwave.com/v3/validate-charge',
      {
        otp: otpCode,
        flw_ref: flw_ref,
        type: type || 'card', 
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
        },
      }
    );
    if (response.data.status === 'success') {
      return res.status(200).json({
        success: true,
        message: "Payment verified successfully",
        data: response.data.data
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.data.message || "Verification failed"
      });
    }

  } catch (error) {
    console.error("Flutterwave OTP Error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Internal Server Error during verification"
    });
  }
};