// services/notificationService.js
import { Notification } from "../tableDeclarations.js";
import { getIO } from "../controllers/socket.js";
import { sendEmail } from "./emailService.js";
import { sendPushNotification } from "./pushNotification.js";
import {
  purchaseTemplate,
  passwordResetTemplate,
  testAnalysisTemplate,
  lectureScheduledTemplate,
  loginAlertTemplate,
  passwordResetSuccessTemplate,
  testCreatedTemplate,
  emailVerificationTemplate,
} from "./emailTemplates.js";

export const createNotification = async ({
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
  saveToDb = true,
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
        payload,
      });
      await notificationRecord.save();
    }
    if (sendSocket) {
      const io = getIO();
      io.to(recipientId).emit(
        "new_notification",
        notificationRecord || { title, message, payload },
      );
    }
    if (sendEmail && recipientEmail) {
      let htmlContent = "";
      let subject = "iCampus Notification";
      switch (actionType) {
        case "PURCHASE_DEBIT":
          subject = "Successful Purchase - iCampus";
          htmlContent = purchaseTemplate(
            payload.userName,
            payload.productName,
            payload.amount,
            payload.downloadUrl,
          );
          break;
        case "NEW_LOGIN":
          subject = "Security Alert: New Login Detected";
          htmlContent = loginAlertTemplate(
            payload.userName,
            payload.ipAddress,
            new Date().toLocaleString(),
          );
          break;
        case "PASSWORD_CHANGED":
          subject = "Security Alert: Password Updated";
          htmlContent = passwordResetSuccessTemplate(
            payload.userName,
            payload.time || new Date().toLocaleString(),
          );
          break;
        case "TEST_CREATED":
          subject = `New Assessment: ${payload.courseCode}`;
          htmlContent = testCreatedTemplate(
            payload.userName,
            payload.courseCode,
            payload.testTitle,
            payload.dueDate || "Check app for details",
          );
          break;
        case "MATERIAL_UPLOADED":
          subject = "New Course Material Available"; // Fallback if ever needed
          break;
        case "ASSIGNMENT_CREATED":
          subject = "New Assignment Posted";
          break;
        case "EXCEPTION_UPDATED":
          subject = `Update on your Exception: ${payload.courseCode}`;
          break;
        case "CONTENT_UPDATED":
          subject = `Syllabus Update: ${payload.courseCode}`;
          break;
        case "TEST_ANALYSIS_READY":
          subject = `Academic Report: ${payload.testTitle}`;
          htmlContent = testAnalysisTemplate(
            payload.userName,
            payload.testTitle,
            payload.submissionCount,
            payload.absenteeCount,
            payload.testId,
          );
          break;
        case "TEST_SUBMITTED":
          subject = "Submission Confirmed"; // Fallback label
          break;
        case "EXCEPTION_SUBMITTED":
          subject = "Exception Payment Confirmed"; // Internal/DB label
          break;
        case "COURSES_EXTRACTED":
          subject = "Registration Sync Complete";
          break;
        case "PASSWORD_RESET_CODE":
          subject = "Your iCampus Verification Code";
          htmlContent = passwordResetTemplate(payload.userName, payload.code);
          break;
        case "EMAIL_VERIFICATION":
          subject = "Verify your iCampus Account";
          htmlContent = emailVerificationTemplate(payload.code);
          break;
        case "LECTURE_REMINDER":
          subject = `Reminder: ${payload.topicName} starts in 45 mins`;
          priority = "normal";
          break;
        case "NEW_POST":
          subject = `New post from ${title}`;
          break;
        case "NEW_FOLLOWER":
          subject = "You have a new follower!";
          title = "New Follower";
          message = `${payload.userName} started following you.`;
          break;
        case "POST_MENTION":
        case "POST_LIKED":
        case "POST_COMMENTED":
        case "POST_REPOSTED":
          category = "social";
          entityId = payload.postId;
          entityType = "post";
          break;
        case "POLL_MILESTONE":
          subject = "Your poll is trending!";
          title = "Poll Milestone reached";
          break;
        case "LECTURE_CANCELLED":
        case "LECTURE_POSTPONED":
        case "LECTURE_SCHEDULED":
          category = "academic";
          entityId = payload.lectureId;
          entityType = "lecture";
          break;
      }
      if (htmlContent) {
        await sendEmail({
          to: recipientEmail,
          subject,
          html: htmlContent,
        });
      }
    }
    if (sendPush) {
      await sendPushNotification(recipientId, title, message, {
        category,
        actionType,
        ...payload,
      });
    }

    return notificationRecord;
  } catch (error) {
    console.error("Notification Error:", error);
  }
};

module.exports = { createNotification };