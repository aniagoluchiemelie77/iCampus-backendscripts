import { notifyAdmins } from "../services/adminNotification.js";
import { resolveLocation, locationMatchesCountry } from "./geoLocation.js";
import { generateNotificationId } from "./idGenerator.js";
import { UserSessions } from "../tableDeclarations.js";

export const verifyAndNotifyLogin = async (
  user,
  req,
  actionType = "LOGIN_AUDIT",
) => {
  const userId = user.uid || user.id;
  
  try {
    const [ip, sessionsSnapshot] = await Promise.all([
      Promise.resolve(
        (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
          .split(",")[0]
          .trim(),
      ),
      UserSessions.where("userId", "==", userId).get(),
    ]);

    const resolvedLocation = resolveLocation(ip);
    const currentLocation = resolvedLocation.label;

    const userSessions = sessionsSnapshot.docs.map((doc) => doc.data());

    const isSuspicious =
      userSessions.length > 0
        ? !userSessions.some(
            (s) => locationMatchesCountry(s.location, resolvedLocation),
          )
        : false;

    const params = {
      notificationId: generateNotificationId("security"),
      category: "security",
      actionType: isSuspicious ? "SUSPICIOUS_ACTIVITY_ALERT" : actionType,
      title: isSuspicious ? "Suspicious Login Detected" : "Login Audit",
      message: isSuspicious
        ? `A login from an unrecognized location (${currentLocation}) was detected for ${user.email}.`
        : `New login recorded for ${user.email} from ${currentLocation}.`,
      payload: {
        userEmail: user.email,
        userUid: userId,
        currentLocation: currentLocation,
        severity: isSuspicious ? "HIGH" : "LOW",
      },
      senderId: "system",
    };

    return new Promise((resolve) => {
      setImmediate(async () => {
        try {
          const result = await notifyAdmins(
            { role: ["super_admin", "support"] },
            params,
            isSuspicious,
          );
          resolve(result);
        } catch (error) {
          console.error(
            "[LOGIN_AUDIT_ERROR] Failed to dispatch admin notification:",
            error.message,
          );
          resolve(null);
        }
      });
    });
  } catch (err) {
    console.error("[LOGIN_AUDIT_ERROR] Execution setup failed:", err.message);
    return null;
  }
};
