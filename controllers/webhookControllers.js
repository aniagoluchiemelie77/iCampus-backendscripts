import crypto from "crypto";
import {User, Transactions, PaymentMethods} from '../tableDeclarations.js';
import {
  generateTransactionId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";

export const personaVerifyConfirmation = async (req, res) => {
        const personaSignature = req.headers['persona-signature'];
        const WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET; 
        const hash = crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(JSON.stringify(req.body))
            .digest('hex');
        if (hash !== personaSignature) {
            return res.status(401).send('Invalid signature');
        }
        const { data } = req.body;
        const eventType = data.attributes.name; 
        const payload = data.relationships.object.data;
        if (eventType === 'inquiry.completed') {
            const inquiryId = payload.id;
            const referenceId = data.attributes.payload.data.attributes['reference-id'];
            if (referenceId) {
                // 3. Update your Database
                const updatedUser = await User.findOneAndUpdate(
                    { uid: referenceId }, 
                    { 
                        isVerified: true,
                        personaInquiryId: inquiryId 
                    },
                    { new: true } 
                );
                if (updatedUser) {
                    console.log(`User with uid: ${referenceId} is now verified.`);
                } else {
                    console.warn(`Webhook received for uid: ${referenceId}, but no user found.`);
                }
            }
        }
        res.status(200).send('Webhook processed');
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