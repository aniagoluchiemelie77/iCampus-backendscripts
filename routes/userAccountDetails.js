import express from "express";
import { protect } from "../middleware/auth.js";
import { Transactions } from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import PDFDocument from "pdfkit";
import {
  generateNotificationId,
  generateTransactionId,
} from "../utils/idGenerator.js";
import {
  getSavedMethods,
  initializeBuy,
  initializeWithdraw,
  handleP2pTransfers,
  verifySubscriptionFlwPayment,
} from "../controllers/paymentController.js";
import {
  fetchUserTransactionHistory,
  fetchUserTransactionStats,
  fetchItagByUsername,
} from "../controllers/fetchActions.js";
import {
  verifyIcashPin,
  icashPinSetup,
  requestIcashPinReset,
  resetIcashPin,
} from "../controllers/userActionsController.js";

export default function (User) {
  const router = express.Router();
  router.get("/my-transactions/:userId", protect, fetchUserTransactionHistory);
  router.post("/verify-icash-pin", protect, verifyIcashPin);
  router.post("/setup-icash-pin", protect, icashPinSetup);
  router.post("/request-pin-reset", protect, requestIcashPinReset);
  router.post("/reset-icash-pin", protect, resetIcashPin);
  router.get("/payment-methods", protect, getSavedMethods);
  router.get("/transactions/initialize-buy", protect, initializeBuy);
  router.get("/transactions/initialize-withdraw", protect, initializeWithdraw);
  router.get("/my-profile", protect, async (req, res) => {
    try {
      const userId = req.user.id;
      const safeFields = [
        "uid",
        "firstname",
        "lastname",
        "username",
        "email",
        "pointsBalance",
        "profilePic",
        "coursesEnrolled",
        "coursesTeaching",
        "country",
        "department",
        "schoolName",
        "usertype",
        "isFirstLogin",
        "hasSubscribed",
        "twoFactorEnabled",
      ].join(" ");
      const user = await User.findOne({ uid: userId }).select(safeFields);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        user,
      });
    } catch (error) {
      console.error("Profile Fetch Error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  });
  router.get("/iTag/search/:username", protect, fetchItagByUsername);
  router.post("/transactions/p2p-transfer", protect, handleP2pTransfers);
  router.get("/transactions/stats/:userId", protect, fetchUserTransactionStats);
  router.post("/transactions/export", protect, async (req, res) => {
    try {
      const { userId, startDate, endDate } = req.body;
      const user = await User.findOne({ uid: userId });

      if (!user) return res.status(404).send("User not found");

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
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
              { $group: { _id: "$payType", total: { $sum: "$amountICash" } } },
            ],
            history: [{ $sort: { createdAt: -1 } }],
          },
        },
      ]);

      const stats = reportData[0].stats;
      const history = reportData[0].history;

      const income = stats.find((s) => s._id === "in")?.total || 0;
      const expense = stats.find((s) => s._id === "out")?.total || 0;
      const totalVolume = income + expense;

      // 2. Generate PDF
      const pdfBuffer = await new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 50, size: "A4" });
        let buffers = [];
        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => resolve(Buffer.concat(buffers)));

        // --- Header: Logo & Branding ---
        path.join(__dirname, "../assets/logo.png");
        doc.image("../assets/logo.png", 50, 45, { width: 50 });
        doc.fillColor("#222").fontSize(20).text("iCash Statement", 110, 57);

        doc
          .fontSize(10)
          .fillColor("#888")
          .text(`Generated on: ${new Date().toLocaleString()}`, {
            align: "right",
          });

        doc.moveDown(2);
        doc.path("M 50 100 L 545 100").stroke("#EEE");

        // --- Section 1: User & Period Info ---
        doc.moveDown();
        doc
          .fillColor("#000")
          .fontSize(12)
          .font("Helvetica-Bold")
          .text("Account Holder Details");
        doc
          .font("Helvetica")
          .fontSize(10)
          .text(`Name: ${user.firstname} ${user.lastname}`);
        doc.text(`Reg ID: ${user.regId || "N/A"}`);
        doc.text(`Period: ${start.toDateString()} - ${end.toDateString()}`);

        // --- Section 2: Visual Stats (The "Pie Chart" Summary) ---
        doc.moveDown(2);
        doc.font("Helvetica-Bold").text("Financial Summary");

        // Draw a simple visual bar/stat box representing the flow
        const chartY = doc.y + 10;
        doc.rect(50, chartY, 500, 60).fill("#F8F9FA");

        // Income Text
        doc
          .fillColor("#4CAF50")
          .fontSize(12)
          .text("TOTAL RECEIVED", 70, chartY + 15);
        doc
          .fontSize(14)
          .text(`${income.toLocaleString()} iCash`, 70, chartY + 32);

        // Expense Text
        doc
          .fillColor("#E91E63")
          .fontSize(12)
          .text("TOTAL SPENT", 350, chartY + 15);
        doc
          .fontSize(14)
          .text(`${expense.toLocaleString()} iCash`, 350, chartY + 32);

        // --- Section 3: Transactions History Table ---
        doc.moveDown(5);
        doc
          .fillColor("#000")
          .font("Helvetica-Bold")
          .fontSize(12)
          .text("Transactions History");
        doc.moveDown();

        // Table Header
        const tableTop = doc.y;
        doc.fontSize(10).fillColor("#888");
        doc.text("Date", 50, tableTop);
        doc.text("Description / Recipient", 130, tableTop);
        doc.text("Type", 350, tableTop);
        doc.text("Amount", 450, tableTop, { align: "right" });

        doc.moveDown(0.5);
        doc.path(`M 50 ${doc.y} L 545 ${doc.y}`).stroke("#CCC");
        doc.moveDown();

        // Table Rows
        history.forEach((tx) => {
          const rowY = doc.y;
          doc.fillColor("#333").fontSize(9);

          doc.text(new Date(tx.createdAt).toLocaleDateString(), 50, rowY);
          doc.text(
            tx.receiverName || tx.description || "System Transfer",
            130,
            rowY,
            { width: 200 },
          );
          doc.text(tx.payType === "in" ? "Credit" : "Debit", 350, rowY);

          doc
            .fillColor(tx.payType === "in" ? "#4CAF50" : "#E91E63")
            .text(
              `${tx.payType === "in" ? "+" : "-"}${tx.amountICash.toLocaleString()}`,
              450,
              rowY,
              { align: "right" },
            );

          doc.moveDown();
          if (doc.y > 750) doc.addPage(); // Handle pagination
        });

        doc.end();
      });

      // 3. Email Template
      const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: ${PRIMARY_COLOR};">Your iCash Statement is Ready</h2>
        <p>Hi ${user.firstname},</p>
        <p>Attached is your transaction report for <b>${start.toDateString()}</b> to <b>${end.toDateString()}</b>.</p>
        <hr/>
        <p><b>Summary:</b></p>
        <p style="color: #4CAF50;">Total Received: ${income.toLocaleString()} iCash</p>
        <p style="color: #E91E63;">Total Spent: ${expense.toLocaleString()} iCash</p>
        <br/>
        <p>Thank you for using iCampus.</p>
      </div>
    `;

      // 4. Send Email
      await sendEmail({
        to: user.email,
        subject: `iCash Statement: ${user.firstname}`,
        text: `Your iCash statement from ${start.toLocaleDateString()} is attached.`,
        html: emailHtml,
        attachments: [
          {
            filename: `iCash_Statement_${userId}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      res.json({ message: "Statement sent successfully!" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  });
  router.post(
    "/subscriptionPayments/verify",
    protect,
    verifySubscriptionFlwPayment,
  );
  return router;
}