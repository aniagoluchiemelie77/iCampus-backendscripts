// services/notificationService.js
import Notification from '../tableDeclarations'; 
import { getIO } from '../controllers/socket.js'; 
import { sendEmail } from './emailService.js'; 
import { sendPushNotification } from './pushNotificationService';
import { purchaseTemplate, loginAlertTemplate, passwordResetSuccessTemplate } from './emailTemplates.js';

const createNotification = async ({
  notificationId,
  recipientId,
  category,
  actionType,
  title,
  message,
  entityId = null,
  entityType = null,
  payload = {},
  sendEmailFlag = false, // Optional: only email for important stuff
  recipientEmail = null,
  sendEmail = false,
  sendPush = true,
  sendSocket = true,
  saveToDb = true
}) => {
  try {
    let notificationRecord = null;
    if (saveToDb) {
      notificationRecord = new Notification({
        notificationId,
        recipientId,
        category,
        actionType,
        title,
        message,
        relatedEntity: { entityId, entityType },
        payload
      });
      await notificationRecord.save();
    }
    if (sendSocket) {
        const io = getIO();
        io.to(recipientId).emit('new_notification', notificationRecord || { title, message, payload });
    }
    if (sendEmail && recipientEmail) {
        let htmlContent = '';
        let subject = 'iCampus Notification';
        switch (actionType) {
            case 'PURCHASE_DEBIT':
                subject = 'Successful Purchase - iCampus';
                htmlContent = purchaseTemplate(payload.userName, payload.productName, payload.amount, payload.downloadUrl);
                break; 
            case 'NEW_LOGIN':
                subject = 'Security Alert: New Login Detected';
                htmlContent = loginAlertTemplate(payload.userName, payload.ipAddress, new Date().toLocaleString());
                break;
            case 'PASSWORD_CHANGED':
                subject = 'Security Alert: Password Updated';
                htmlContent = passwordResetSuccessTemplate(
                    payload.userName, 
                    payload.time || new Date().toLocaleString()
                );
                break;
            case 'TEST_CREATED':
                subject = `New Assessment: ${payload.courseCode}`;
                htmlContent = testCreatedTemplate(
                    payload.userName, 
                    payload.courseCode, 
                    payload.testTitle, 
                    payload.dueDate || 'Check app for details'
                );
                break;
            case 'LECTURE_SCHEDULED':
                subject = `New Lecture: ${payload.topicName}`;
                htmlContent = lectureScheduledTemplate(
                    payload.userName,
                    payload.topicName,
                    payload.lectureType,
                    payload.location,
                    payload.time,
                    payload.date
                );
                break;
               // Add more cases for 'TEST_CREATED', 'NEW_FOLLOWER', etc.
        }
        if (htmlContent) {
            await sendEmail({
                to: recipientEmail,
                subject,
                html: htmlContent
            });
        }
    }
    if (sendPush) {
        await sendPushNotification(recipientId, title, message, {
            category,
            actionType,
            ...payload 
       });
    }

    return notificationRecord;
  } catch (error) {
    console.error("Notification Error:", error);
  }
};

module.exports = { createNotification };