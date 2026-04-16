import { PaymentMethods } from "../tableDeclarations.js";
import axios from "axios";

export const handleFlutterwaveWebhook = async (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_HASH;
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== secretHash) return res.status(401).end();
  const { event, data } = req.body;

  if (event === "charge.completed") {
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
      // Add these from the payload meta if you passed them
      billingAddressDetails: data.meta.address
        ? {
            street: data.meta.address,
            city: data.meta.city,
            zip: data.meta.zip,
          }
        : undefined,
    };

    // 2. Save to Database
    await PaymentMethods.create(paymentData);
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
  try {
    const { amount, currency, userId, paymentToken, methodType } = req.body;
    if (!amount || !paymentToken) {
      return res
        .status(400)
        .json({ status: "error", message: "Missing payment details" });
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
