import {User, Transactions} from "../tableDeclarations.js";
import { notifyAdmins } from "../services/adminNotification.js";

export const addFlag = async (userId, type) => {
  await User.findOneAndUpdate(
    { uid: userId },
    { $push: { suspiciousActivity: { type, timestamp: new Date() } } }
  );
  await notifyAdmins(
    { role: ["moderator", "super_admin"] },
    {
      actionType: "SECURITY_FLAG_RAISED",
      payload: { 
        userId, 
        flagType: type,
        message: `Security flag '${type}' was raised for user ${userId}.` 
      },
      senderId: "system"
    },
    true 
  ).catch((err) => console.error("Admin notification failed:", err));
};
export const checkAndFlagHeavyActivity = async (userId, session) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const recentTxCount = await Transactions.countDocuments({
    userId: userId,
    type: "p2p_sent",
    createdAt: { $gte: oneHourAgo }
  }).session(session);

  if (recentTxCount >= 5) {
    await User.updateOne(
      { uid: userId },
      { $push: { suspiciousActivity: { type: "HEAVY_TRANSFER", timestamp: new Date() } } }
    ).session(session);
    await notifyAdmins(
      { role: ["moderator", "super_admin"] },
      {
        actionType: "SECURITY_ALERT_HEAVY_ACTIVITY",
        payload: { 
          userId, 
          message: "User exceeded 5 P2P transfers in one hour." 
        },
        senderId: "system"
      },
      true 
    ).catch((err) => console.error("Admin notification failed:", err));
  }
};
export const checkAndFlagWithdrawals = async (userId) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const recentWithdrawals = await Transactions.countDocuments({
    userId: userId,
    type: "withdraw",
    createdAt: { $gte: oneHourAgo }
  });
  if (recentWithdrawals >= 5) {
    await addFlag(userId, "HEAVY_WITHDRAWAL_ATTEMPT");

    await notifyAdmins(
      { role: ["moderator", "super_admin"] },
      {
        actionType: "SECURITY_ALERT_HEAVY_WITHDRAWAL",
        payload: { 
          userId, 
          message: "User exceeded 5 withdrawal attempts in one hour." 
        },
        senderId: "system"
      },
      true 
    ).catch((err) => console.error("Admin notification failed:", err));

    return true; 
  }

  return false;
};