// services/emailService.js
import nodemailer from "nodemailer";
/*
Create Email Accounts: In your iCampus cPanel, 
create no-reply@icampus.com and support@icampus.com
*/
const transporter = nodemailer.createTransport({
  host: process.env.TRANSPORTER_EMAIL_HOST,
  port: 465, 
  secure: true, 
  auth: {
    user: process.env.TRANSPORTER_AUTH_USER,
    pass: process.env.TRANSPORTER_AUTH_PASS,
  },
});

/**
 * Sends an email
 * @param {Object} options - { to, subject, text, html }
 */
const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const info = await transporter.sendMail({
      from: `"iCampus Support" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text, // Plain text version
      html, // HTML version (better for receipts/links)
    });
    console.log("Email sent: %s", info.messageId);
    return info;
  } catch (error) {
    console.error("Email Sending Error:", error);
    throw error;
  }
};

module.exports = { sendEmail };