import {PaymentMethods} from '../tableDeclarations.js';

export const handleFlutterwaveWebhook = async (req, res) => {
  const secretHash = process.env.FLW_WEBHOOK_HASH || 'mastakraft';
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== secretHash) return res.status(401).end();
  const { event, data } = req.body;

  if (event === 'charge.completed') {
    const paymentData = {
      userId: data.meta.userId, // You passed this in the initial 'body'
      type: data.payment_type,
      flw_token: data.card?.token || data.account?.token,
      last4: data.card?.last4digits,
      card_type: data.card?.issuer,
      expiry: `${data.card?.expiry_month}/${data.card?.expiry_year}`,
      bank_name: data.account?.bank_name,
      account_number: data.account?.account_number?.slice(-4).padStart(10, '*')
    };

    // 2. Save to Database
    await PaymentMethods.create(paymentData);
  }

  res.status(200).end();
};
export const getSavedMethods = async (req, res) => {
  try {
    const methods = await PaymentMethods.find({ userId: req.user.uid })
      .sort({ isDefault: -1, createdAt: -1 });
    res.status(200).json({
      status: 'success',
      methods 
    });
  } catch (err) {
    res.status(500).json({ message: "Flow interrupted" });
  }
};

export const createPaymentMethod = async (userId, cardDetails) => {
  try {
    const response = await flutterwavedoc.payment_methods_post({
      type: 'card',
      card: {
        ...cardDetails,
        cof: { enabled: true } 
      },
      meta: {
        userId: userId 
      }
    });
    if (response.data.status === 'success') {
      const pmd = response.data.data;
      // Save to your MongoDB PaymentMethod model
      await PaymentMethods.create({
        userId: userId,
        type: 'card',
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