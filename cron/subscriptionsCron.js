import cron from "node-cron";
import { User} from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import {sendEmail} from '../services/emailService.js';
import {subscriptionReminderTemplate, subscriptionExpiredTemplate} from '../services/emailTemplates.js';

export const monitorSubscriptions = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("Starting daily users subscription status check...");

    try {
      const now = new Date();

      const target7Days = new Date();
      target7Days.setDate(now.getDate() + 7);

      const target1Day = new Date();
      target1Day.setDate(now.getDate() + 1);

      const [snapshot7Days, snapshot1Day, expiredSnapshot] = await Promise.all([
        User.where("isSubscribed", "==", true)
          .where("subscriptionExpiresAt", "<=", target7Days)
          .where("subscriptionExpiresAt", ">=", now)
          .where("reminderSent7Days", "==", false)
          .get(),
        User.where("isSubscribed", "==", true)
          .where("subscriptionExpiresAt", "<=", target1Day)
          .where("subscriptionExpiresAt", ">=", now)
          .where("reminderSent1Day", "==", false)
          .get(),
        User.where("isSubscribed", "==", true)
          .where("subscriptionExpiresAt", "<", now)
          .get(),
      ]);
      const process7Day = snapshot7Days.docs.map(async (doc) => {
        await new Promise((resolve) => setImmediate(resolve));
        const user = doc.data();
        await Promise.all([
          sendEmail({
            to: user.email,
            subject: "Your iCampus Subscription Expires in 7 Days",
            text: `Hello ${user.firstname}, your subscription will expire soon. Renew to keep your perks.`,
            html: subscriptionReminderTemplate(user.firstname, "7 days", user.tier, user.subscriptionExpiresAt),
          }),
          doc.ref.update({ reminderSent7Days: true }),
          createNotification({
            notificationId: generateNotificationId("finance"),
            recipientId: user.uid,
            actionType: "SUBSCRIPTION_EXPIRING",
            payload: {
              tier: user.tier,
              expiryDate: user.subscriptionExpiresAt,
              userName: user.firstname,
            },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          }),
        ]);
      });
      const process1Day = snapshot1Day.docs.map(async (doc) => {
        await new Promise((resolve) => setImmediate(resolve));
        const user = doc.data();
        await Promise.all([
          sendEmail({
            to: user.email,
            subject: "Action Required: Your iCampus Subscription Expires Tomorrow",
            text: `Hello ${user.firstname}, your subscription expires in 24 hours.`,
            html: subscriptionReminderTemplate(user.firstname, "24 hours", user.tier, user.subscriptionExpiresAt),
          }),
          doc.ref.update({ reminderSent1Day: true }),
          createNotification({
            notificationId: generateNotificationId("finance"),
            recipientId: user.uid,
            actionType: "SUBSCRIPTION_EXPIRED",
            payload: {
              tier: user.tier,
              userName: user.firstname,
            },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          }),
        ]);
      });
      const processExpired = expiredSnapshot.docs.map(async (doc) => {
        await new Promise((resolve) => setImmediate(resolve));
        const user = doc.data();
        await Promise.all([
          doc.ref.update({
            tier: "free",
            isSubscribed: false,
            subscriptionExpiresAt: null,
            reminderSent7Days: false,
            reminderSent1Day: false,
            updatedAt: new Date(),
          }),
          sendEmail({
            to: user.email,
            subject: "Your iCampus Subscription Has Expired",
            text: `Hello ${user.firstname}, your subscription has ended and your account has moved to the free tier.`,
            html: subscriptionExpiredTemplate(user.firstname),
          }),
        ]);
      });
      await Promise.all([...process7Day, ...process1Day, ...processExpired]);

      console.log("Daily subscription check completed successfully.");
    } catch (error) {
      console.error("Cron job subscription error:", error.message);
    }
  });
};