/**
 * Retired payment endpoints, kept so older app builds get a clear message
 * instead of a 404. Payments now go through controllers/paymentsController.js.
 *
 *  - initiateFlwCharge sent raw card numbers through this server to
 *    Flutterwave's direct-charge API (needs PCI-DSS approval) and crashed on
 *    an undeclared variable for card payments.
 *  - verifySubscriptionFlwPayment trusted the exchange rate sent by the app
 *    and accepted the same transaction more than once.
 */
const retired = (req, res) =>
  res.status(410).json({
    success: false,
    status: "error",
    message: "Please update the app to make payments.",
  });

export const initiateFlwCharge = retired;
export const verifySubscriptionFlwPayment = retired;
