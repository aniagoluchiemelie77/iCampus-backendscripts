import cron from "node-cron";
import { User } from "../tableDeclarations.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { generateNotificationId } from "../utils/idGenerator.js";

cron.schedule("*/5 * * * *", async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  try {
    const querySnapshot = await User.where("isSuspended", "==", false).get();

    if (querySnapshot.empty) return;

    for (const userDoc of querySnapshot.docs) {
      const userDocRef = userDoc.ref;
      const user = userDoc.data();

      if (!user.suspiciousActivity || !Array.isArray(user.suspiciousActivity)) {
        continue;
      }
      const recentFlags = user.suspiciousActivity.filter((a) => {
        const timestamp = a.timestamp?.toDate
          ? a.timestamp.toDate()
          : new Date(a.timestamp);
        return timestamp >= oneHourAgo;
      });

      if (recentFlags.length > 5) {
        await userDocRef.update({
          isSuspended: true,
          suspiciousActivity: [],
          updatedAt: new Date(),
        });

        await notifyAdmins(
          { role: ["moderator", "super_admin"] },
          {
            notificationId: generateNotificationId("security"),
            actionType: "ACCOUNT_SUSPENDED_SECURITY",
            payload: {
              userId: user.uid,
              reason: "Excessive suspicious activity",
            },
            senderId: "system",
          },
          true,
        );
      }
    }
  } catch (error) {
    console.error("Cron job suspension check error:", error.message);
  }
});
