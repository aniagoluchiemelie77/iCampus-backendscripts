import express from "express";
import bcrypt from "bcrypt";

export default function (User) {
  const router = express.Router();
  router.post("/", async (req, res) => {
    try {
      console.log("🧪 Attempting insert...");
      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      const newUser = new User({ ...req.body, password: hashedPassword });
      const savedUser = await newUser.save(); // ✅ capture the saved document
      console.log("✅ Insert succeeded:", savedUser._id); // ✅ log the document ID
      res.status(201).json({ message: "User saved successfully" });
    } catch (error) {
      console.error("❌ Insert failed:", error);
      res.status(500).json({ error: error.message || "Failed to save user" });
    }
  });
  router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  try {
    // Find user by email or firstname
    const user = await User.findOne({
      $or: [{ email: identifier }],
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // Optional: generate token or session
    console.log("✅ Login succeeded:", user._id);
    res.status(200).json({ message: "Login successful", userId: user._id });
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
  return router;
}
//Mongod summon: mongod --dbpath D:\MongoDB\data
//backend summon: npx nodemon index.js
