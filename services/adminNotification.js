import { Admin } from "../tableDeclarations.js";
import { createNotification } from "./notification.js";

export const notifyAdmins = async (target, params, sendEmailFlag = false) => {
  try {
    let querySnapshot;

    if (target.role) {
      const roles = Array.isArray(target.role) ? target.role : [target.role];
      querySnapshot = await Admin.where("adminType", "in", roles).get();
    } else if (target.uids) {
      const uids = target.uids;
      const chunks = [];
      for (let i = 0; i < uids.length; i += 30) {
        chunks.push(uids.slice(i, i + 30));
      }

      let allDocs = [];
      for (const chunk of chunks) {
        const snap = await Admin.where("uid", "in", chunk).get();
        allDocs.push(...snap.docs);
      }
      querySnapshot = { docs: allDocs };
    } else {
      querySnapshot = await Admin.get();
    }

    const admins = querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    const recipients = admins.filter((a) => a.uid !== params.senderId);

    const notifications = recipients.map((admin) =>
      createNotification({
        ...params,
        recipientId: admin.uid,
        recipientEmail: admin.email,
        sendEmail: sendEmailFlag,
      }),
    );

    return await Promise.all(notifications);
  } catch (error) {
    console.error("Notification Service Error:", error);
  }
};
