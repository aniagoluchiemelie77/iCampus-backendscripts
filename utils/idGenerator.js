import { ITag } from "../tableDeclarations.js";
import crypto from "crypto";

export function generateNotificationId(length = 7) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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
  const prefix = "trns";
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
      Math.random() * 9000000000000000 + 1000000000000000,
    ).toString();
    const formatted = `iC-${digits.match(/.{1,4}/g).join(" ")}`;

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
  return `iC_${randomBytes}`;
};
