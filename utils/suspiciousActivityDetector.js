import { notifyAdmins } from "../services/adminNotification.js";
import geoip from "geoip-lite";
import { generateNotificationId } from "./idGenerator.js";
import { UserSessions } from "../tableDeclarations.js";

export const verifyAndNotifyLogin = async (
  user,
  req,
  actionType = "LOGIN_AUDIT",
) => {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
    .split(",")[0]
    .trim();
  const geo = geoip.lookup(ip);
  const currentLocation = geo ? `${geo.city}, ${geo.country}` : "Unknown";
  const currentCountry = geo?.country || "Unknown";

  const userId = user.uid || user.id;

  const sessionsSnapshot = await UserSessions.where(
    "userId",
    "==",
    userId,
  ).get();
  const userSessions = sessionsSnapshot.docs.map((doc) => doc.data());

  const isSuspicious =
    userSessions.length > 0
      ? !userSessions.some(
          (s) => s.location && s.location.includes(currentCountry),
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

  return notifyAdmins(
    { role: ["super_admin", "support"] },
    params,
    isSuspicious,
  );
};
