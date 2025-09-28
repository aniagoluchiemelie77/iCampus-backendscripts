import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";

// Temporary in-memory store
const verificationCodes = {};
const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: "ef11ae5dba1a82",
    pass: "e37a56bc265a6b",
  },
});
const now = new Date();

const getOrdinalSuffix = (day) => {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};
const day = now.getDate();
const month = now.toLocaleString('default', { month: 'short' }); // e.g., "Jan"
const year = now.getFullYear();

const formattedDate = `${day}${getOrdinalSuffix(day)} ${month} ${year}`;

// Utility to generate 6-digit code
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

export default function (User) {
  const router = express.Router();
  router.post("/register", async (req, res) => {
    console.log("Incoming payload:", req.body);
    const { usertype, matriculation_number, staff_id, department, password } =
      req.body;
    try {
      const existingUser = await User.findOne({
        usertype,
        ...(usertype === "student" && {
          matriculation_number,
          department,
        }),
        ...(usertype === "lecturer" && {
          staff_id,
          department,
        }),
      });
      if (existingUser) {
        return res.status(409).json({
          message: "User already exists with this ID and department.",
        });
      }
      console.log("🧪 Attempting insert...");
      const token = crypto.randomBytes(32).toString("hex");
      console.log(token);
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new User({
        ...req.body,
        password: hashedPassword,
        verificationToken: token,
        isVerified: false,
      });
      await newUser.save();
      const verificationLink = `http://localhost:5000/users/verify-email?token=${token}`;
      await transporter.sendMail({
        from: '"iCampus" <admin@uniquetechcontentwriter.com>',
        to: req.body.email,
        subject: "Verify Your Account",
        html: `
               <h2>Welcome to iCampus!</h2>
              <p>Click the link below to verify your account:</p>
              <a href="${verificationLink}">Verify Email</a>
            `,
      });
      res.status(201).json({
        message: "User created successfully, check your email",
        email: req.body.email,
        verified: false,
      });
    } catch (error) {
      console.error("❌ Insert failed:", error);
      if (error.code === 11000) {
        return res.status(409).json({
          message: "Duplicate entry: User already exists.",
        });
      }
      res.status(500).json({
        error: error.message || "Failed to save user",
      });
    }
  });
  router.post("/login", async (req, res) => {
    const { identifier, password } = req.body;
    try {
      const user = await User.findOne({
        $or: [{ email: identifier }],
      });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid password" });
      }
      const { password: _, ...safeUser } = user.toObject();
      console.log("✅ Login succeeded:", user._id);
      res.status(200).json({
        message: "Login successful",
        user: safeUser, // return full profile minus password
      });
    } catch (error) {
      console.error("❌ Login failed:", error);
      res.status(500).json({ error: error.message || "Login error" });
    }
  });

  router.patch("/:uid", async (req, res) => {
    try {
      const updatedUser = await User.findOneAndUpdate(
        { uid: req.params.uid },
        { $set: req.body },
        { new: true }
      );
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ message: "User updated", user: updatedUser });
    } catch (error) {
      console.error("❌ Update failed:", error);
      res.status(500).json({ error: error.message });
    }
  });
  router.get("/verify-email", async (req, res) => {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Missing verification token");
    }
    const user = await User.findOneAndUpdate(
      { verificationToken: token },
      { isVerified: true, verificationToken: null },
      { new: true }
    );
    console.log("✅ User updated:", user);
    if (!user) {
      return res.status(404).send("Invalid or expired token");
    }
    const isMobile =
      req.headers["user-agent"].includes("Android") ||
      req.headers["user-agent"].includes("iPhone");
    if (isMobile) {
      res.redirect("icampus://verify-email?verified=true");
    } else {
      res.status(200).json({
        message: "✅ Account verified",
        verified: true,
      });
    }
  });
  router.get("/status", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).send("Missing email");
    const user = await User.findOne({ email });
    if (!user) return res.status(404).send("User not found");
    res.status(200).json({ isVerified: user.isVerified });
  });
  router.post('/forgotPassword', async (req, res) => {
    console.log('step 1');
    const { email } = req.body;
    const user = await User.findOne({email});
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      console.log('Substep2');
      return;
    }
    const code = generateCode();
    verificationCodes[email] = {
      code,
       expiresAt: Date.now() + 12 * 60 * 60 * 1000, // expires in 12 hours
    };
    console.log(`Verification code for ${email}: ${code}`);
    await transporter.sendMail({
      from: '"iCampus" <admin@uniquetechcontentwriter.com>',
      to: email,
      subject: 'Password Reset Verification Code',
      html: `<h1>Your 6-digit verification code is: ${code}</h1>
             <p>You are required to use the above code within 12 hours of password reset request</p>`,
    });
    res.status(201).json({
      message: 'Verification code sent, check your email',
    });
  });
  router.post('/verifyCode', (req, res) => {
    const { email, code } = req.body;
    const record = verificationCodes[email];
    if (
      !record || record.code !== code || Date.now() > record.expiresAt
    ) {
      return res.status(400).json({ message: 'Invalid or expired code' });
    }
    // Mark as verified, don't delete yet
    verificationCodes[email].verified = true;
    res.status(200).json({ message: 'Code verified', email: email});
  });
  router.post('/changePassword', async (req, res) => {
    const { email, password, confirmPassword } = req.body;
    const record = verificationCodes[email];
    if (!record || !record.verified) {
      return res.status(403).json({ message: 'Email not verified for password reset' });
    }
    if (!password || !confirmPassword || password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match or are missing' });
    }
    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: 'User not found' });
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;
      await user.save();
      delete verificationCodes[email];
      await transporter.sendMail({
        from: '"iCampus" <admin@uniquetechcontentwriter.com>',
        to: email,
        subject: 'Successful Password Reset Attempt',
        html: `<h1>Successful Password Reset Attempt</h1>
               <p>Dear User, a successful password reset was carried out by your account on ${formattedDate}, if this is not you, reach out to our email: admin@uniquetechcontentwriter.com immediately.</p>`,
      });// Clean up after success
      res.status(200).json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });


  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
