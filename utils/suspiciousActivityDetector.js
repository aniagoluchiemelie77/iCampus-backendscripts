import { notifyAdmins } from '../services/adminNotification'; 
import geoip from 'geoip-lite';

export const verifyAndNotifyLogin = async (user, req, actionType = "LOGIN_AUDIT") => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const geo = geoip.lookup(ip);
  const currentLocation = geo ? `${geo.city}, ${geo.country}` : "Unknown";
  const currentCountry = geo?.country || "Unknown";

  const isSuspicious = user.sessions && user.sessions.length > 0 
    ? !user.sessions.some(s => s.location && s.location.includes(currentCountry))
    : false;

  const params = {
    actionType: isSuspicious ? "SUSPICIOUS_ACTIVITY_ALERT" : actionType,
    payload: {
      userEmail: user.email,
      userUid: user.uid,
      currentLocation: currentLocation,
      severity: isSuspicious ? "HIGH" : "LOW"
    },
    senderId: "system"
  };

  return notifyAdmins(
    { role: ["super_admin", "support"] },
    params,
    isSuspicious 
  );
};