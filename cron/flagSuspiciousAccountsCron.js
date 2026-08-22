import cron from "node-cron";
import { User } from "../tableDeclarations.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { generateNotificationId } from "../utils/idGenerator.js";

export const flagSuspiciousAccounts = () => {
  cron.schedule("0 0 * * *", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    console.log("Starting daily suspicious accounts check...");

    try {
      const querySnapshot = await User.where("isSuspended", "==", false).get();

      if (querySnapshot.empty) {
        console.log("No active non-suspended users found.");
        return;
      }

      const docs = querySnapshot.docs;
      const BATCH_SIZE = 10;

      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = docs.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (userDoc) => {
            const userDocRef = userDoc.ref;
            const user = userDoc.data();

            if (
              !user.suspiciousActivity ||
              !Array.isArray(user.suspiciousActivity)
            ) {
              return;
            }

            const recentFlags = user.suspiciousActivity.filter((a) => {
              const timestamp = a.timestamp?.toDate
                ? a.timestamp.toDate()
                : new Date(a.timestamp);
              return timestamp >= oneHourAgo;
            });

            if (recentFlags.length > 3) {
              try {
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
                console.log(
                  `[Security] Suspended user ${user.uid} due to excessive flags.`,
                );
              } catch (updateError) {
                console.error(
                  `Failed to suspend user ${user.uid}:`,
                  updateError.message,
                );
              }
            }
          }),
        );
      }
      console.log("Daily suspicious accounts check completed successfully.");
    } catch (error) {
      console.error("Cron job suspension check error:", error.message);
    }
  });
};