import express from "express";
import bcrypt from "bcrypt";

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
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new User({ ...req.body, password: hashedPassword });
      const savedUser = await newUser.save();
      console.log("✅ Insert succeeded:", savedUser._id);
      res.status(201).json({ message: "User saved successfully" });
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
