import { Admin } from "../tableDeclarations.js"; 
import { createNotification } from "./notification.js"; 

export const notifyAdmins = async (target, params, sendEmailFlag = false) => {
  try {
    let query = {};
    if (target.role) query = { adminType: target.role };
    if (target.uids) query = { uid: { $in: target.uids } };

    const admins = await Admin.find(query);
    const recipients = admins.filter(a => a.uid !== params.senderId);

    const notifications = recipients.map((admin) =>
      createNotification({
        ...params,
        recipientId: admin.uid,
        recipientEmail: admin.email,
        sendEmail: sendEmailFlag, 
      })
    );

    return await Promise.all(notifications);
  } catch (error) {
    console.error("Notification Service Error:", error);
  }
};