import { ITag } from "../tableDeclarations.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

export function generateNotificationId(category) {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-T:.Z]/g, "")
    .slice(2, 12);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const cat = category.toLowerCase();
  /**
   * Format: CATEGORY-YYMMDDHHMM-RANDOM
   * Example: finance-2605121930-4829
   */
  return `${cat}-${timestamp}-${randomSuffix}`;
}
export function generateTransactionId(type = "payment") {
  const typeMap = {
    buy: "BUYY",
    withdraw: "WITH",
    p2p_sent: "PSNT",
    p2p_received: "PRCV",
    payment: "PAYM",
    exceptionsDividend: "DIVI",
    refund: "RFND",
  };

  const typePrefix = typeMap[type] || "GENR";
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");
  const timeStr =
    now.getHours().toString().padStart(2, "0") +
    now.getMinutes().toString().padStart(2, "0");
  const randomStr = Math.random().toString(36).substring(2, 5).toUpperCase();
  /**
   * Format: TX-[TYPE]-[YYMMDD]-[HHMM]-[RANDOM]
   * Example: TX-WITH-260512-2145-K9L
   */
  return `TX-${typePrefix}-${dateStr}-${timeStr}-${randomStr}`;
}
export function generateExceptionId(courseId, lectureId) {
  const cleanCourse = (courseId || "GEN").trim().toUpperCase();
  const cleanLecture = (lectureId || "LEC").trim().toUpperCase();
  const courseFragment =
    cleanCourse.length > 4
      ? cleanCourse.slice(-4)
      : cleanCourse.padStart(4, "X");

  const lectureFragment =
    cleanLecture.length > 4
      ? cleanLecture.slice(-4)
      : cleanLecture.padStart(4, "X");
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");

  /**
   * Format: EXC-[COURSE_HASH][LECTURE_HASH]-[YYMMDD]
   * Example Assuming:
   * courseId:  "60d5ecf8b5c9a2341c8a1111" -> "1111"
   * lectureId: "60d5ecf8b5c9a2341c8b2222" -> "2222"
   * Output: EXC-11112222-260529-A7B
   */
  return `EXC-${courseFragment}${lectureFragment}-${dateStr}`;
}
export function generateLectureId(courseId, lectureType) {
  const cleanCourse = (courseId || "GEN").trim().toUpperCase();
  const cleanType = (lectureType || "PHY").trim().toUpperCase();
  const courseFragment =
    cleanCourse.length > 4
      ? cleanCourse.slice(-4)
      : cleanCourse.padStart(4, "X");

  const typeFragment =
    cleanType.length > 4 ? cleanType.slice(0, 4) : cleanType.padEnd(4, "X");
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");

  /**
   * Format: LEC-[COURSE_HASH][TYPE_HASH]-[YYMMDD]
   */
  return `LEC-${courseFragment}${typeFragment}-${dateStr}`;
}
export function generateAssessmentId(courseId, assessmentType = "TEST") {
  const cleanCourse = (courseId || "GEN").trim().toUpperCase();
  const cleanType = (assessmentType || "TEST").trim().toUpperCase();
  const courseFragment =
    cleanCourse.length > 4
      ? cleanCourse.slice(-4)
      : cleanCourse.padStart(4, "X");

  const typeFragment =
    cleanType.length > 4 ? cleanType.slice(0, 4) : cleanType.padEnd(4, "X");

  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");

  /**
   * Format: ASM-[COURSE_HASH][TYPE_HASH]-[YYMMDD]-[RANDOM]
   */
  return `ASM-${courseFragment}${typeFragment}-${dateStr}`;
}
export function generateAssignmentId(courseId) {
  const cleanCourse = (courseId || "GEN").trim().toUpperCase();

  const courseFragment =
    cleanCourse.length > 4
      ? cleanCourse.slice(-4)
      : cleanCourse.padStart(4, "X");

  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");
  const randomFragment = crypto.randomBytes(2).toString("hex").toUpperCase();

  /**
   * Format: ASG-[COURSE_FRAGMENT]-[YYMMDD]-[RANDOM]
   */
  return `ASG-${courseFragment}-${dateStr}-${randomFragment}`;
}
export function generatePayoutId(userId) {
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");
  const timeStr =
    now.getHours().toString().padStart(2, "0") +
    now.getMinutes().toString().padStart(2, "0");
  const userPart = userId ? userId.toString().slice(-4).toUpperCase() : "ANON";
  const randomStr = Math.random().toString(36).substring(2, 4).toUpperCase();
  //PY-YYMMDD-HHMM-Last 4 characters of UID-2 random characters
  return `PY-${dateStr}-${timeStr}-${userPart}-${randomStr}`;
}
export function generateProductId(userId) {
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");
  const timeStr =
    now.getHours().toString().padStart(2, "0") +
    now.getMinutes().toString().padStart(2, "0");

  const userStr = userId ? userId.toString() : "ANON";
  const userPart = userStr.slice(-4).toUpperCase();
  const randomStr = Math.random().toString(36).substring(2, 4).toUpperCase();

  // PR-YYMMDD-HHMM-Last 4 characters of UID-2 random characters
  return `PR-${dateStr}-${timeStr}-${userPart}-${randomStr}`;
}
export function generatePostId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const now = new Date();
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, "");
  const timeStr =
    now.getHours().toString().padStart(2, "0") +
    now.getMinutes().toString().padStart(2, "0");
  let randomStr = "";
  for (let i = 0; i < 4; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  /**
   * Format: PST-[YYMMDD]-[HHMM]-[RANDOM]
   */
  return `PST-${dateStr}-${timeStr}-${randomStr}`;
}
export function userAccountDetailsId(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
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