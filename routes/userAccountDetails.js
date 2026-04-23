import express from "express";
import { protect } from "../middleware/auth.js";
import { Transactions, ITag } from "../tableDeclarations.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { icashPinResetTemplate } from "../services/emailTemplates.js";
import { createNotification } from "../services/notification.js";
import { sendEmail } from "../services/emailService.js";
import PDFDocument from "pdfkit";
import {
  generateNotificationId,
  generateTransactionId,
} from "../utils/idGenerator.js";
import {
  getSavedMethods,
  handleFlutterwaveWebhook,
  initializeBuy,
  initializeWithdraw,
} from "../controllers/paymentController.js";
import { v4 as uuidv4 } from "uuid";
import mongoose from "mongoose";

export default function (User) {
  const router = express.Router();
  router.get("/my-transactions/:userId", protect, async (req, res) => {
    try {
      const { userId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const [transactions, total] = await Promise.all([
        Transactions.find({ userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Transactions.countDocuments({ userId }),
      ]);

      // 4. Calculate total pages
      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        data: transactions,
        pagination: {
          totalItems: total,
          totalPages: totalPages,
          currentPage: page,
          hasNextPage: page < totalPages,
        },
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.post("/verify-icash-pin", protect, async (req, res) => {
    const { pin } = req.body;
    const user = await User.findOne({ uid: req.user.uid }).select("+iCashPin");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.iCashLockoutUntil && user.iCashLockoutUntil > Date.now()) {
      return res.status(403).json({
        message: `Locked. Try again after ${moment(user.iCashLockoutUntil).format("LT")}`,
      });
    }
    if (user.isSuspended) {
      return res.status(403).json({
        isSuspended: true,
        message: "This account is already suspended.",
      });
    }
    const isMatch = await bcrypt.compare(pin, user.iCashPin);
    if (!isMatch) {
      user.iCashAttempts += 1;
      if (user.iCashAttempts >= 5) {
        user.isSuspended = true;
        user.iCashAttempts = 0;
        await user.save();
        return res.status(403).json({
          isSuspended: true,
          message: "Maximum attempts reached. Account suspended for security.",
        });
      }

      await user.save();
      return res.status(401).json({
        message: "Invalid PIN",
        attemptsRemaining: 5 - user.iCashAttempts,
      });
    }
    user.iCashAttempts = 0;
    user.iCashLockoutUntil = null;
    await user.save();

    res.status(200).json({ success: true });
  });
  router.post("/setup-icash-pin", protect, async (req, res) => {
    const { pin } = req.body;
    const user = await User.findOne({ uid: req.user.uid }).select("+iCashPin");
    if (user.iCashPin) {
      return res.status(400).json({
        message: "PIN already exists. Use the 'Reset PIN' flow to change it.",
      });
    }
    const salt = await bcrypt.genSalt(10);
    user.iCashPin = await bcrypt.hash(pin, salt);
    user.twoFactorEnabled = true;
    await user.save();
    res.status(200).json({ success: true, message: "iCash PIN secured." });
  });
  router.post("/request-pin-reset", protect, async (req, res) => {
    const user = await User.findOne({ uid: req.user.uid });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPinOTP = otp;
    user.resetPinOTPExpires = Date.now() + 10 * 60 * 1000;
    await user.save();
    try {
      const htmlContent = icashPinResetTemplate(user.firstname, otp);
      await sendEmail({
        email: user.email,
        subject: "IMPORTANT: iCash PIN Reset Code",
        message: `Your reset code is ${otp}`,
        html: htmlContent,
      });
      res.status(200).json({ message: "OTP sent to your registered email." });
    } catch (err) {
      user.resetPinOTP = undefined;
      user.resetPinOTPExpires = undefined;
      await user.save();
      res.status(500).json({ message: "Email could not be sent." });
    }
  });
  router.post("/reset-icash-pin", protect, async (req, res) => {
    const { otp, newPin } = req.body;
    const user = await User.findOne({
      uid: req.user.uid,
      resetPinOTP: otp,
      resetPinOTPExpires: { $gt: Date.now() },
    }).select("+iCashPin");

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }
    const salt = await bcrypt.genSalt(10);
    user.iCashPin = await bcrypt.hash(newPin, salt);
    user.resetPinOTP = undefined;
    user.resetPinOTPExpires = undefined;
    user.iCashAttempts = 0;
    await user.save();
    createNotification({
      notificationId: generateNotificationId(),
      recipientEmail: user.email,
      recipientId: user.uid,
      category: "security",
      actionType: "ICASH_PIN_RESET",
      title: "iCash PIN Reset",
      message: `Your iCash PIN has been successfully reset.`,
      payload: {
        userName: user.username || user.firstname,
        date: Date.now(),
      },
      sendEmail: true,
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });
    res
      .status(200)
      .json({ success: true, message: "PIN updated successfully." });
  });
  router.get("/payment-methods", protect, getSavedMethods);
  router.get("/transactions/initialize-buy", protect, initializeBuy);
  router.get("/transactions/initialize-withdraw", protect, initializeWithdraw);
  router.post("/flw-webhook", handleFlutterwaveWebhook);
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
  router.get("/iTag/search/:username", protect, async (req, res) => {
    try {
      const { username } = req.params;
      let isPremium;
      let isUser;
      const iTagData = await ITag.findOne({
        username: { $regex: new RegExp(`^${username}$`, "i") },
      });

      if (!iTagData) {
        return res.status(404).json({ message: "User not found" });
      }
      const maskedNumber = iTagData.cardNumber.replace(/\d(?=\d{4})/g, "*");
      isPremium = iTagData.tier === "premium";
      isUser = iTagData.userId === req.user.id;

      res.status(200).json({
        userId: iTagData.userId,
        username: iTagData.username,
        cardHolderName: iTagData.cardHolderName,
        cardNumber: maskedNumber,
        tier: iTagData.tier,
        designOptions: iTagData.designOptions,
        isPremium,
        isUser,
      });
    } catch (error) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
  router.post("/transactions/p2p-transfer", protect, async (req, res) => {
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

      // 5. Create Transaction Records (Dual-entry)
      const senderTransactionId = generateTransactionId();
      const senderTx = new Transaction({
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
      const receipientTransactionId = generateTransactionId();
      const recipientTx = new Transaction({
        transactionId: receipientTransactionId,
        userId: recipientId,
        type: "p2p_received",
        amountICash: amount,
        status: "success",
        payType: "in",
        title: "iCash Received",
        reference: `${transactionRef}-REC`, // Unique ref for recipient
        metadata: { senderId: senderId, note: description },
      });
      await senderTx.save({ session });
      await recipientTx.save({ session });
      // 6. Commit everything
      await session.commitTransaction();
      session.endSession();

      // --- 7. Notifications (Triggered after successful commit) ---
      // A. Notification for the SENDER (Debit Alert)
      const senderNotificationId = generateNotificationId();
      const receipientNotificationId = generateNotificationId();
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
      // B. Notification for the RECIPIENT (Credit Alert)
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
  });
  router.get("/transactions/stats/:userId", protect, async (req, res) => {
    try {
      const { userId } = req.params;
      const { month, year } = req.query;
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      const stats = await Transactions.aggregate([
        { $match: { userId, createdAt: { $gte: start, $lte: end } } },
        {
          $facet: {
            flow: [
              { $group: { _id: "$payType", total: { $sum: "$amountICash" } } },
            ],
            topRecipients: [
              { $match: { payType: "out", type: "p2p_sent" } },
              {
                $group: {
                  _id: "$metadata.recipientId",
                  count: { $sum: 1 },
                  total: { $sum: "$amountICash" },
                },
              },
              {
                $lookup: {
                  from: "users",
                  localField: "_id",
                  foreignField: "uid", // or "uid" depending on your schema
                  as: "userDetails",
                },
              },
              { $unwind: "$userDetails" },
              {
                $project: {
                  _id: 1,
                  count: 1,
                  total: 1,
                  name: {
                    $concat: [
                      { $ifNull: ["$userDetails.firstname", "User"] },
                      " ",
                      { $ifNull: ["$userDetails.lastname", ""] },
                    ],
                  },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 3 },
            ],
            monthly: [
              {
                $group: {
                  _id: { $month: "$createdAt" },
                  total: { $sum: "$amountICash" },
                },
              },
            ],
          },
        },
      ]);
      res.json(stats[0]);
    } catch (e) {
      res.status(500).send(e.message);
    }
  });

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

      // --- Section 3: Transaction History Table ---
      doc.moveDown(5);
      doc
        .fillColor("#000")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text("Transaction History");
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
  return router;
}