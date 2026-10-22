import admin from "firebase-admin";
import { User, Admin } from "../tableDeclarations.js";
import { theme } from "./emailTheme.js";

// Keep in sync with MainApplication.kt and firebase.json in the app.
const ANDROID_CHANNEL_ID = "icampus_alerts";
const PUSH_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export const sendPushNotification = async (
  recipientId,
  title,
  body,
  data = {},
) => {
  try {
    const { colors } = theme;
    if (!recipientId) {
      console.warn("Push notification skipped: Missing recipientId.");
      return;
    }
    let querySnapshot = await User.where("uid", "==", recipientId)
      .limit(1)
      .get();

    let targetCollection = User;
    if (querySnapshot.empty) {
      querySnapshot = await Admin.where("uid", "==", recipientId)
        .limit(1)
        .get();
      targetCollection = Admin;
    }

    if (querySnapshot.empty) {
      console.log("No user found for recipient:", recipientId);
      return;
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();

    if (!userData.fcmToken) {
      console.log("No FCM token found for user:", recipientId);
      return;
    }
    // FCM data must be flat string values and stay under 4KB. Nested objects
    // (e.g. a whole `course`) used to arrive as "[object Object]" and could
    // push the message over the limit, so keep scalars and lift out courseId.
    const sanitizedData = {};
    Object.entries(data).forEach(([key, val]) => {
      if (val === null || val === undefined) return;
      if (typeof val === "object") {
        if (val.courseId && data.courseId === undefined) {
          sanitizedData.courseId = String(val.courseId);
        }
        return;
      }
      sanitizedData[key] = String(val);
    });

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: sanitizedData,
      token: userData.fcmToken,
      android: {
        // Delivery priority: wakes the phone from Doze and delivers at once
        // (WhatsApp-style). `notification.priority` below is only display.
        priority: "high",
        // Phone offline? FCM holds the push this long and delivers it as soon
        // as data comes back on, even if the app is never opened.
        ttl: PUSH_TTL_MS,
        notification: {
          // Must match the channel created in MainApplication.kt (heads-up
          // popup + iCampus ping). Resource names, not file names.
          channelId: ANDROID_CHANNEL_ID,
          icon: "ic_notification",
          color: colors.primary,
          sound: "ping",
          priority: "high",
          defaultVibrateTimings: true,
          visibility: "public",
          // Same notification re-sent (retry) replaces instead of stacking.
          ...(sanitizedData.notificationId
            ? { tag: sanitizedData.notificationId }
            : {}),
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
          "apns-expiration": String(
            Math.floor((Date.now() + PUSH_TTL_MS) / 1000),
          ),
        },
        payload: {
          aps: {
            alert: {
              title: title,
              body: body,
            },
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log("Push sent successfully:", response);
  } catch (error) {
    console.error("Error sending push notification:", error.message);
    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
      console.warn(
        `[FCM_CLEANUP] Removing stale token for recipient: ${recipientId}`,
      );
      try {
        let querySnapshot = await User.where("uid", "==", recipientId)
          .limit(1)
          .get();
        if (querySnapshot.empty) {
          querySnapshot = await Admin.where("uid", "==", recipientId)
            .limit(1)
            .get();
        }
        if (!querySnapshot.empty) {
          await querySnapshot.docs[0].ref.update({
            fcmToken: null,
            updatedAt: new Date(),
          });
        }
      } catch (cleanupError) {
        console.error(
          "[FCM_CLEANUP_FAILED] Could not remove stale token:",
          cleanupError.message,
        );
      }
    }
  }
};
