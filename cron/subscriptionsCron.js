import cron from "node-cron";
import { User} from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import {sendEmail} from '../services/emailService.js';
import {subscriptionReminderTemplate, subscriptionExpiredTemplate} from '../services/emailTemplates.js';

const toDate = (value) => (value?.toDate ? value.toDate() : new Date(value));

const pushNotice = (user, actionType, payload) =>
  createNotification({
    notificationId: generateNotificationId("finance"),
    recipientId: user.uid,
    isRead: false,
    actionType,
    payload,
    sendPush: true,
    sendSocket: true,
    saveToDb: true,
  });

/**
 * Sends the email and in-app notice, and only marks the reminder as sent if
 * at least one of them got through; otherwise tomorrow's run tries again.
 */
const sendReminder = async (doc, { flag, window, subject, text }) => {
  const user = doc.data();
  const [email, notice] = await Promise.allSettled([
    sendEmail({
      to: user.email,
      subject,
      text,
      html: subscriptionReminderTemplate(
        user.firstname,
        window,
        user.tier,
        user.subscriptionExpiresAt,
      ),
    }),
    pushNotice(user, "SUBSCRIPTION_EXPIRING", {
      tier: user.tier,
      // Shown verbatim in the message; a raw Timestamp reads "Timestamp(seconds=...)".
      expiryDate: toDate(user.subscriptionExpiresAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      userName: user.firstname,
    }),
  ]);
  if (email.status === "rejected" && notice.status === "rejected") {
    throw new Error(`no reminder delivered: ${email.reason?.message || email.reason}`);
  }
  await doc.ref.update({ [flag]: true });
};

/** Downgrade first (that part must happen), then tell the user. */
const expireSubscription = async (doc) => {
  const user = doc.data();
  await doc.ref.update({
    tier: "free",
    isSubscribed: false,
    subscriptionExpiresAt: null,
    reminderSent7Days: false,
    reminderSent1Day: false,
    updatedAt: new Date(),
  });
  const notices = await Promise.allSettled([
    sendEmail({
      to: user.email,
      subject: "Your iCampus Subscription Has Expired",
      text: `Hello ${user.firstname}, your subscription has ended and your account has moved to the free tier.`,
      html: subscriptionExpiredTemplate(user.firstname),
    }),
    pushNotice(user, "SUBSCRIPTION_EXPIRED", {
      tier: user.tier,
      userName: user.firstname,
    }),
  ]);
  notices
    .filter((n) => n.status === "rejected")
    .forEach((n) => console.warn(`Expiry notice for ${user.uid} failed:`, n.reason?.message || n.reason));
};

/**
 * Runs one group on its own: a failed query (e.g. a missing composite index)
 * or one bad user no longer stops the other groups, expiries included.
 */
const runGroup = async (label, query, handle) => {
  let snapshot;
  try {
    snapshot = await query.get();
  } catch (error) {
    console.error(`Subscription cron [${label}] query failed:`, error.message);
    return;
  }
  const results = await Promise.allSettled(snapshot.docs.map(handle));
  const failed = results.filter((r) => r.status === "rejected");
  failed.forEach((r) => console.error(`Subscription cron [${label}] user failed:`, r.reason?.message || r.reason));
  console.log(`Subscription cron [${label}]: ${snapshot.size - failed.length}/${snapshot.size} done.`);
};

export const monitorSubscriptions = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("Starting daily users subscription status check...");

    const now = new Date();

    const target7Days = new Date();
    target7Days.setDate(now.getDate() + 7);

    const target1Day = new Date();
    target1Day.setDate(now.getDate() + 1);

    // Expiries first: downgrading is the part that must not be skipped.
    await runGroup(
      "expired",
      User.where("isSubscribed", "==", true).where("subscriptionExpiresAt", "<", now),
      expireSubscription,
    );

    await runGroup(
      "1 day",
      User.where("isSubscribed", "==", true)
        .where("subscriptionExpiresAt", "<=", target1Day)
        .where("subscriptionExpiresAt", ">=", now)
        .where("reminderSent1Day", "==", false),
      (doc) =>
        sendReminder(doc, {
          flag: "reminderSent1Day",
          window: "24 hours",
          subject: "Action Required: Your iCampus Subscription Expires Tomorrow",
          text: `Hello ${doc.data().firstname}, your subscription expires in 24 hours.`,
        }),
    );

    await runGroup(
      "7 days",
      User.where("isSubscribed", "==", true)
        .where("subscriptionExpiresAt", "<=", target7Days)
        .where("subscriptionExpiresAt", ">=", now)
        .where("reminderSent7Days", "==", false),
      async (doc) => {
        const expiry = toDate(doc.data().subscriptionExpiresAt);
        // Already inside the last day (just got the 24-hour reminder above):
        // don't also send "7 days" the same night.
        if (expiry <= target1Day) {
          await doc.ref.update({ reminderSent7Days: true });
          return;
        }
        await sendReminder(doc, {
          flag: "reminderSent7Days",
          window: "7 days",
          subject: "Your iCampus Subscription Expires in 7 Days",
          text: `Hello ${doc.data().firstname}, your subscription will expire soon. Renew to keep your perks.`,
        });
      },
    );

    console.log("Daily subscription check completed.");
  });
};
