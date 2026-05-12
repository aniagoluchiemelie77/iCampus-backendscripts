import { ITag } from "../tableDeclarations.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

/**
 * Format: CATEGORY-YYMMDDHHMM-RANDOM
 * Example: finance-2605121930-4829
 */
export function generateNotificationId(category) {
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-T:.Z]/g, '')
    .slice(2, 12);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const cat = category.toLowerCase();

  return `${cat}-${timestamp}-${randomSuffix}`;
}
export function generatePostId(length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
export function userAccountDetailsId(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
export const generateTransactionId = () => {
  const prefix = "iCn_trns";
  const timestamp = Date.now(); // Current time in milliseconds
  const randomStr = Math.random().toString(36).substring(2, 8); // 6 character random alphanumeric string

  return `${prefix}_${timestamp}_${randomStr}`;
};
export const generateUniqueCardNumber = async () => {
  let isUnique = false;
  let cardNumber = "";

  while (!isUnique) {
    // 1. Generate 16 random digits
    const digits = Math.floor(
      Math.random() * 900000000000000 + 100000000000000,
    ).toString();
    const formatted = `7${digits.match(/.{1,4}/g).join(" ")}`;
    // 3. Check database to ensure it's unique
    const existingCard = await ITag.findOne({ cardNumber: formatted });

    if (!existingCard) {
      cardNumber = formatted;
      isUnique = true;
    }
  }
  return cardNumber;
};
export const generateUserUID = () => {
  const randomBytes = crypto.randomBytes(12).toString("hex");
  return `iC-u-${randomBytes}`;
};
export const generateUniqueDealId = (length = 10) => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
export const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

export const generateTokens = async (user) => {
  const accessToken = jwt.sign(
    { id: user.uid, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "30m" },
  );

  const refreshToken = jwt.sign(
    { id: user.uid },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "30d" },
  );

  // Save refresh token to DB
  user.refreshTokens.push(refreshToken);
  if (user.refreshTokens.length > 5) {
    user.refreshTokens.shift();
  }
  await user.save();
  return { accessToken, refreshToken };
};
const generateReferralCode = (name, length = 7) => {
  const cleanName = name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const prefix = cleanName.substring(0, 3);
  const randomLength = Math.max(0, length - prefix.length);
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let randomPart = "";
  for (let i = 0; i < randomLength; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}${randomPart}`;
};
export const generateUniqueReferralCode = async (user) => {
  let code;
  let exists = true;
  const nameToUse =
    user.userType === "enterprise" ? user.organizationName : user.firstName;

  while (exists) {
    code = generateReferralCode(nameToUse);
    const userWithCode = await User.findOne({ referralCode: code });

    if (!userWithCode) {
      exists = false;
    }
  }

  return code;
};