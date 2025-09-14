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
