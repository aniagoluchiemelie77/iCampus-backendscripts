import express from "express";
import { authenticate } from "../index.js";
import {
  UserBankOrCardDetails
} from "../tableDeclarations.js";

const now = new Date();

const formattedTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "numeric",
  hour12: true,
}).format(now);

const getOrdinalSuffix = (day) => {
  if (day > 3 && day < 21) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
};
const day = now.getDate();
const month = now.toLocaleString("default", { month: "short" }); // e.g., "Jan"
const year = now.getFullYear();

const formattedDate = `${day}${getOrdinalSuffix(day)} ${month} ${year}`;

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
router.post("/account-details", authenticate, async (req, res) => {
  try {
    const { payload, user } = req.body;

    if (!payload?.ids || !Array.isArray(payload.ids)) {
      return res.status(400).json({ message: "Invalid payload format" });
    }

    const accountDetails = await UserBankOrCardDetails.find({
      cardOrBankDetailsId: { $in: payload.ids },
      userId: user,
    });

    if (!accountDetails || accountDetails.length === 0) {
      return res.status(404).json({ message: "No account details found" });
    }

    const filteredDetails = accountDetails.map((detail) => {
      if (detail.method === "card") {
        return {
          method: detail.method,
          cardBrand: detail.cardBrand,
          expiryMonth: detail.expiryMonth,
          expiryYear: detail.expiryYear,
          createdAt: detail.createdAt,
          lastFourDigits: detail.lastFourDigits,
        };
      } else if (detail.method === "bank") {
        return {
          method: detail.method,
          bankName: detail.bankName,
          bankAccNumber: detail.lastFourDigits, // assuming this is the account number
        };
      }
    });

    console.log("Filtered account details:", filteredDetails);
    return res.status(200).json({ details: filteredDetails });
  } catch (error) {
    console.error("Error fetching account details:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

    return router;
}