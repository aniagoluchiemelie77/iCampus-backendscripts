import crypto from "crypto";
import {
  User,
  Transactions,
  PaymentMethods,
  SupportTicket,
} from "../tableDeclarations.js";
import {
  generateTransactionId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { logControllerPerformance } from "../utils/eventLogger.js";

export const personaVerifyConfirmation = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "personaVerifyConfirmationController";
  const action = "personaVerifyConfirmation";
  const personaSignature = req.headers["persona-signature"];
  const WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET;

  const hash = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== personaSignature) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Invalid Persona signature",
    );
    return res.status(401).send("Invalid Persona signature");
  }
  res.status(200).send("Webhook accepted");
  try {
    const { data } = req.body;
    const eventType = data.attributes.name;
    const payload = data.relationships.object.data;

    if (eventType === "inquiry.completed") {
      const inquiryId = payload.id;
      const referenceId =
        data.attributes.payload.data.attributes["reference-id"];

      if (referenceId) {
        const updatedUser = await User.findOneAndUpdate(
          { uid: referenceId },
          { isVerified: true, personaInquiryId: inquiryId },
          { new: true },
        );

        if (updatedUser) {
          await createNotification({
            notificationId: generateNotificationId("system"),
            recipientId: referenceId,
            category: "system",
            actionType: "VERIFICATION_SUCCESS",
            title: "Identity Verified",
            message: "Your identity has been successfully verified!",
          });
          await notifyAdmins(
            { role: ["super_admin", "support"] },
            {
              notificationId: generateNotificationId("admin_notification"),
              category: "admin_notification",
              actionType: "USER_VERIFICATION_AUDIT",
              title: "User Identity Verified",
              message: `User ${updatedUser.firstname} (${referenceId}) has completed ID verification.`,
              payload: { referenceId, inquiryId },
            },
            false,
          );
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      }
    }
  } catch (error) {
    console.error("Webhook processing error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
  }
};
export const handleFlutterwaveWebhook = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "handleFlutterwaveWebhookController";
  const action = "handleFlutterwaveWebhook";
  const secretHash = process.env.FLW_WEBHOOK_HASH;
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== secretHash) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      "Invalid Flutterwave signature",
    );
    return res.status(401).end();
  }
  res.status(200).end();
  try {
    const { event, data } = req.body;
    if (event === "charge.completed" && data.status === "successful") {
      const { userId, type, methodType, iCashAmount } = data.meta;

      if (type === "icash_purchase") {
        const iCashToCredit = Math.floor(iCashAmount);
        const updatedUser = await User.findOneAndUpdate(
          { uid: userId },
          { $inc: { pointsBalance: iCashToCredit } },
          { new: true },
        );

        if (updatedUser) {
          const transactionId = generateTransactionId("buy");
          await Transactions.create({
            transactionId,
            userId,
            type: "buy",
            currency: data.currency,
            amountLocal: data.amount,
            amountICash: iCashToCredit,
            status: "success",
            payType: "in",
            title: `${iCashToCredit} iCash purchased`,
            reference: data.tx_ref,
            createdAt: new Date(),
          });
          await createNotification({
            notificationId: generateNotificationId("finance"),
            recipientId: userId,
            recipientEmail: updatedUser.email,
            category: "finance",
            actionType: "ICASH_PURCHASE",
            title: "iCash Purchase Successful",
            message: `${methodType} payment made for ${iCashToCredit} iCash is successful.`,
            payload: {
              userName: updatedUser.firstname,
              amountLocal: data.amount,
              amountICash: iCashToCredit,
              currency: data.currency,
              transactionId,
            },
            sendEmail: true,
            sendPush: true,
          });
          await notifyAdmins(
            { role: ["finance", "super_admin"] },
            {
              notificationId: generateNotificationId("admin_notification"),
              category: "admin_notification",
              actionType: "ICASH_PURCHASE_ADMIN",
              title: "Finance Audit: New Purchase",
              message: `User ${userId} purchased ${iCashToCredit} iCash.`,
              payload: {
                userId,
                amountICash: iCashToCredit,
                txRef: data.tx_ref,
              },
            },
            false,
          );
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      }
      const paymentToken = data.card?.token || data.account?.token;
      if (paymentToken) {
        const existingMethod = await PaymentMethods.findOne({ paymentToken });
        if (!existingMethod) {
          await PaymentMethods.create({
            userId: data.meta.userId,
            method: data.payment_type === "card" ? "card" : "bank",
            paymentToken,
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
          });
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      }
    }
  } catch (error) {
    console.error("Flutterwave Webhook Error:", error);
  }
};
export const handlePostmarkInboundSupportTickets = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "postmarkInboundEmailWebhookController";
  const action = "postmarkInboundEmailWebhook";
  try {
    const { ToFull, From, Subject, TextBody, MessageID } = req.body;
    const recipient = ToFull[0].Email;
    const userId = recipient.split("+")[1].split("@")[0];

    let ticket = await SupportTicket.findOne({
      userId,
      status: { $ne: "closed" },
    }).sort({ createdAt: -1 });

    if (ticket) {
      ticket.thread.push({ sender: From, message: TextBody });
      await ticket.save();
    } else {
      ticket = await SupportTicket.create({
        userId,
        ticketRefId: generateTicketRefId("technical"),
        source: "email",
        severity: "high",
        originalMessage: TextBody,
        summary: Subject,
        thread: [{ sender: From, message: TextBody }],
      });
    }
    await createNotification({
      recipientId: userId,
      category: "system",
      actionType: "SUPPORT_TICKET_RECEIVED",
      sendEmail: true,
      recipientEmail: From,
      payload: {
        userName: "User",
        ticketRefId: ticket.ticketRefId,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
      },
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).send("Webhook Processed");
  } catch (error) {
    console.error("Postmark Webhook Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).send("Internal Server Error");
  }
};
export const handleQstashInboundEmailJobs = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "qstashInboundEmailJobsController";
  const action = "qstashInboundEmailJobs";
  try {
    const jobData = req.body;
    await createNotification(jobData);
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error processing email job from QStash:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ error: error.message });
  }
};