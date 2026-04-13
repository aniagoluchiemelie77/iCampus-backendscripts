import express from "express";
import { authenticate } from "../middleware/auth.js";
import { Transactions } from "../tableDeclarations.js";

const now = new Date();

function userAccountDetailsId(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
export default function (User) {
  const router = express.Router();
  router.get("/my-transactions/:userId", authenticate, async (req, res) => {
    try {
      const { userId } = req.params;
      const list = await Transactions.find({ userId })
        .sort({ createdAt: -1 })
        .limit(20);
      res.status(200).json({
        success: true,
        data: list,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });

  return router;
}