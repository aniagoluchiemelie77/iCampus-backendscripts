import { User, Transactions } from "../tableDeclarations.js";
import { notifyAdmins } from "../services/adminNotification.js";
import admin from "firebase-admin";
import { generateNotificationId } from "../utils/idGenerator.js";

export const addFlag = async (userId, type) => {
  const querySnapshot = await User.where("uid", "==", userId).limit(1).get();

  if (!querySnapshot.empty) {
    const userDocRef = querySnapshot.docs[0].ref;
    await userDocRef.update({
      suspiciousActivity: admin.firestore.FieldValue.arrayUnion({
        type,
        timestamp: new Date(),
      }),
      updatedAt: new Date(),
    });
  }

  await notifyAdmins(
    { role: ["moderator", "super_admin"] },
    {
      notificationId: generateNotificationId("security"),
      actionType: "SECURITY_FLAG_RAISED",
      payload: {
        userId,
        flagType: type,
        message: `Security flag '${type}' was raised for user ${userId}.`,
      },
      senderId: "system",
    },
    true,
  ).catch((err) => console.error("Admin notification failed:", err));
};
export const checkAndFlagHeavyActivity = async (userId, session = null) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const querySnapshot = await Transactions.where("userId", "==", userId)
    .where("type", "==", "p2p_sent")
    .where("createdAt", ">=", oneHourAgo)
    .get();

  const recentTxCount = querySnapshot.size;

  if (recentTxCount >= 5) {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();

    if (!userQuery.empty) {
      const userDocRef = userQuery.docs[0].ref;
      const updateData = {
        suspiciousActivity: admin.firestore.FieldValue.arrayUnion({
          type: "HEAVY_TRANSFER",
          timestamp: new Date(),
        }),
        updatedAt: new Date(),
      };

      if (session) {
        session.update(userDocRef, updateData);
      } else {
        await userDocRef.update(updateData);
      }
    }

    await notifyAdmins(
      { role: ["moderator", "super_admin"] },
      {
        notificationId: generateNotificationId("security"),
        actionType: "SECURITY_ALERT_HEAVY_ACTIVITY",
        payload: {
          userId,
          message: "User exceeded 5 P2P transfers in one hour.",
        },
        senderId: "system",
      },
      true,
    ).catch((err) => console.error("Admin notification failed:", err));
  }
};
export const checkAndFlagWithdrawals = async (userId) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const querySnapshot = await Transactions.where("userId", "==", userId)
    .where("type", "==", "withdraw")
    .where("createdAt", ">=", oneHourAgo)
    .get();

  const recentWithdrawals = querySnapshot.size;
  if (recentWithdrawals >= 5) {
    await addFlag(userId, "HEAVY_WITHDRAWAL_ATTEMPT");

    await notifyAdmins(
      { role: ["moderator", "super_admin"] },
      {
        notificationId: generateNotificationId("security"),
        actionType: "SECURITY_ALERT_HEAVY_WITHDRAWAL",
        payload: {
          userId,
          message: "User exceeded 5 withdrawal attempts in one hour.",
        },
        senderId: "system",
      },
      true,
    ).catch((err) => console.error("Admin notification failed:", err));

    return true;
  }

  return false;
};
