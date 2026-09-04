import { Admin } from "../tableDeclarations.js";
import { createNotification } from "./notification.js";

export const notifyAdmins = async (target, params, sendEmailFlag = false) => {
  try {
    let querySnapshots = [];

    if (target?.role) {
      const roles = Array.isArray(target.role) ? target.role : [target.role];
      if (roles.length > 0) {
        const roleChunks = [];
        for (let i = 0; i < roles.length; i += 30) {
          roleChunks.push(roles.slice(i, i + 30));
        }
        const rolePromises = roleChunks.map((chunk) =>
          Admin.where("adminType", "in", chunk).get(),
        );
        querySnapshots = await Promise.all(rolePromises);
      }
    } else if (Array.isArray(target?.uids) && target.uids.length > 0) {
      const uids = target.uids;
      const chunks = [];
      for (let i = 0; i < uids.length; i += 30) {
        chunks.push(uids.slice(i, i + 30));
      }
      const uidPromises = chunks.map((chunk) =>
        Admin.where("uid", "in", chunk).get(),
      );
      querySnapshots = await Promise.all(uidPromises);
    } else {
      const allSnap = await Admin.get();
      querySnapshots = [allSnap];
    }
    const allDocs = querySnapshots.flatMap((snap) => snap.docs || []);
    const uniqueAdminsMap = new Map();
    allDocs.forEach((doc) => {
      uniqueAdminsMap.set(doc.id, {
        id: doc.id,
        ...doc.data(),
      });
    });

    const admins = Array.from(uniqueAdminsMap.values());
    const senderId = params?.senderId;
    const recipients = admins.filter((a) => a && a.uid && a.uid !== senderId);

    if (recipients.length === 0) {
      return [];
    }
    const notifications = recipients.map((admin) =>
      createNotification({
        ...params,
        recipientId: admin.uid,
        recipientEmail: admin.email,
        sendEmail: sendEmailFlag,
        isRead: false,
      }).catch((err) => {
        console.error(
          `[NOTIFICATION_DISPATCH_ERR] Failed for admin ${admin.uid}:`,
          err.message,
        );
        return null;
      }),
    );

    return await Promise.all(notifications);
  } catch (error) {
    console.error("Notification Service Critical Error:", error.message);
    return [];
  }
};
