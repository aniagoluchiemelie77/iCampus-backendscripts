// services/notificationService.js
import { Notification, userPrefs } from "../tableDeclarations.js";
import { getIO } from "../controllers/socket.js";
import { sendEmail } from "./emailService.js";
import { sendPushNotification } from "./pushNotification.js";
import {
  welcomeEmailTemplate,
  productUpdateTemplate,
  courseCompletionEmailTemplate,
  purchaseTemplate,
  newOrderTemplate,
  passwordResetTemplate,
  testAnalysisTemplate,
  lectureScheduledTemplate,
  loginAlertTemplate,
  passwordResetSuccessTemplate,
  testCreatedTemplate,
  emailVerificationTemplate,
  iCashSuccessfulPinResetTemplate,
  iCashPurchaseTemplate,
  iCashWithdrawalTemplate,
  subscriptionUpgradeTemplate,
  marketplacePurchaseTemplate,
  orderCompletedTemplate,
  orderReviewTemplate,
  orderCancelledEmailTemplate,
  salesPayoutTemplate,
  productCreationTemplate,
  productDeletionTemplate,
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
  sendEmailFlag = false,
  recipientEmail = null,
  recoveryEmails = [],
  sendEmail = false,
  sendPush = true,
  sendSocket = true,
  saveToDb = true,
}) => {
  try {
    const prefs = await userPrefs.findOne({ userId: recipientId });
    const isCritical = [
      "NEW_LOGIN",
      "ICASH_WITHDRAWAL",
      "PASSWORD_CHANGED",
    ].includes(actionType);
    const verifiedRecoveries = recoveryEmails
      .filter((item) => item.isVerified)
      .map((item) => item.email);
    const recipients = [
      ...new Set([recipientEmail, ...verifiedRecoveries]),
    ].filter(Boolean);
    let canSendPush = sendPush;
    let canSendEmail = sendEmail;
    let canSendSocket = sendSocket;
    if (prefs && !isCritical) {
      if (prefs.notifications[category] === false) {
        console.log(
          `Notification suppressed: ${category} is disabled for user.`,
        );
        return null;
      }
      canSendPush = sendPush && prefs.channels.push;
      canSendEmail = sendEmail && prefs.channels.email;
      canSendSocket = sendSocket && prefs.channels.socket;
    }

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
    if (canSendSocket) {
      const io = getIO();
      io.to(recipientId).emit(
        "new_notification",
        notificationRecord || { title, message, payload },
      );
    }
    if (canSendEmail && recipients.length > 0) {
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
        case "WELCOME_USER":
          subject = "Welcome to iCampus!";
          if (sendEmail) {
            htmlContent = welcomeEmailTemplate(payload.userName);
          }
          title = title || "Welcome aboard!";
          message =
            message ||
            `Hi ${payload.userName}, welcome to the iCampus community!`;
          break;
        case "PRODUCT_DELETION":
          const { productName, productId, username } = payload;
          emailSubject = `Marketplace Listing Removed: ${productName}`;
          emailBody = productDeletionTemplate(username, productName, productId);
          break;
        case "PRODUCT_CREATION":
          const { username, productName, price, productId } = payload;
          emailHtml = productCreationTemplate(
            username,
            productName,
            price,
            productId,
          );
          emailSubject = ` Product Listed Successfully: ${productName}`;
          break;
        case "PRODUCT_UPDATE":
          const {
            productId: updatedId,
            productName: updatedName,
            price: updatedPrice,
          } = payload;

          emailHtml = productUpdateTemplate(
            username,
            updatedName,
            updatedPrice,
            updatedId,
          );
          emailSubject = `Changes Saved: ${updatedName}`;
          break;
        case "SALES_PAYOUT_SUCCESS":
          subject = "Funds Received: Your Sales Payout is here!";
          if (sendEmail) {
            htmlContent = salesPayoutTemplate(
              payload.username,
              payload.amount,
              payload.transactionId,
            );
          }
          title = title || "Sales Payout Successful";
          message =
            message ||
            `${payload.amount.toLocaleString()} iCash has been moved to your wallet.`;
          break;
        case "MARKET_PURCHASE_DEBIT":
          subject = `Receipt: ${payload.productName}`;
          if (sendEmail) {
            htmlContent = marketplacePurchaseTemplate(
              payload.userName,
              payload.productName,
              payload.amount,
              payload.orderId,
              payload.productType,
              payload.fileUrl,
            );
          }
          break;
        case "ORDER_CANCELLED":
          emailHtml = orderCancelledEmailTemplate(
            recipientName,
            payload.productName,
            payload.orderId,
            payload.reason,
            payload.buyerName,
          );
          subject = `Action Required: Order #${payload.orderId} Cancelled`;
          break;
        case "NEW_ORDER":
          subject = `New Sale: ${payload.productName}`;
          if (sendEmail) {
            htmlContent = newOrderTemplate(
              payload.userName,
              payload.productName,
              payload.amount,
              payload.orderId,
              payload.deliveryMethod,
              payload.stationName,
              payload.stationAddress,
              payload.buyerAddress,
              payload.buyerPhoneNumber,
            );
          }
          break;
        case "NEW_LOGIN":
          subject = "Security Alert: New Login Detected";
          htmlContent = loginAlertTemplate(
            payload.userName,
            payload.ipAddress,
            payload.location,
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
        case "ORDER_COMPLETED":
          subject = `Payment Released: ${payload.productName}`;
          if (sendEmail) {
            htmlContent = orderCompletedTemplate(
              payload.userName,
              payload.productName,
              payload.amount,
              payload.orderId,
              payload.role,
            );
          }
          break;
        case "ORDER_REVIEW_REQUEST":
          subject = `How was your purchase of ${payload.productName}?`;
          if (sendEmail) {
            htmlContent = orderReviewTemplate(
              payload.userName,
              payload.productName,
              payload.orderId,
              payload.targetId,
            );
          }
          break;
        case "POST_UPDATED":
          category = "social";
          entityId = payload.postId;
          entityType = "post";
          subject = "Your post has been updated";
          break;
        case "MATERIAL_UPLOADED":
          subject = "New Course Material Available";
          break;
        case "ASSIGNMENT_CREATED":
          subject = "New Assignment Posted";
          break;
        case "COURSE_COMPLETED":
          subject = `Congratulations on finishing ${payload.productName}! 🎓`;
          if (sendEmail) {
            htmlContent = courseCompletionEmailTemplate(
              payload.userName,
              payload.productName,
              payload.pdfUrl,
              payload.productId,
            );
          }
          title = title || "Course Completed!";
          message =
            message ||
            `You've officially finished ${payload.productName}. Well done!`;
          break;
        case "LEARNING_REMINDER":
          subject = "Ready to continue your learning journey?";
          title = title || "Don't break your streak!";
          message =
            message || `Pick up where you left off in ${payload.productName}.`;
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
          htmlContent = passwordResetTemplate(
            payload.userName,
            payload.code,
            payload.expiryTime,
          );
          break;
        case "EMAIL_VERIFICATION":
          subject = "Verify your iCampus Account";
          htmlContent = emailVerificationTemplate(payload.code);
          break;
        case "LECTURE_REMINDER":
          subject = `Reminder: ${payload.topicName} starts in 45 mins`;
          priority = "normal";
          break;
        case "ICASH_PURCHASE":
          subject = `Credit Alert: ${payload.amountICash.toLocaleString()} iCash Added`;
          if (sendEmail) {
            // Ensure you pass these values in the payload during webhook/logic
            htmlContent = iCashPurchaseTemplate(
              payload.userName,
              payload.amountICash,
              payload.amountLocal,
              payload.currency,
              payload.transactionId || "N/A",
            );
          }
          break;
        case "ICASH_WITHDRAWAL":
          subject = `Debit Alert: ${payload.amountICash.toLocaleString()} iCash Withdrawn`;
          if (sendEmail) {
            htmlContent = iCashWithdrawalTemplate(
              payload.userName,
              payload.amountICash,
              payload.amountLocal,
              payload.currency,
              payload.transactionId || "N/A",
            );
          }
          title = title || "Withdrawal Successful";
          message =
            message ||
            `You have successfully withdrawn ${payload.currency} ${payload.amountLocal.toLocaleString()}.`;
          break;
        case "SUBSCRIPTION_UPGRADED":
          category = "finance";
          subject = "Premium Access Activated";
          title = "Subscription Upgraded";
          message = `Congratulations! You are now on the ${payload.tier} plan.`;
          if (sendEmail) {
            htmlContent = subscriptionUpgradeTemplate(
              payload.userName,
              payload.tier,
              payload.amount,
              payload.currency,
              payload.transactionId,
            );
          }
          break;
        case "ICASH_PIN_RESET":
          subject = "Security Alert: iCash PIN Reset";
          if (sendEmail) {
            htmlContent = iCashSuccessfulPinResetTemplate(
              payload.userName,
              new Date().toLocaleString(),
            );
          }
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
        case "PROFILE_VIEW":
          subject = "Someone viewed your profile";
          break;
        case "PROFILE_UPDATED":
          subject = "Security Alert: Profile Change";
          break;
      }
      if (htmlContent && recipients.length > 0) {
        const targets = isCritical
          ? recipients
          : [recipientEmail].filter(Boolean);
        await Promise.all(
          targets.map((email) =>
            sendEmail({
              to: email,
              subject:
                isCritical && email !== recipientEmail
                  ? `[Security Alert] ${subject}`
                  : subject,
              html: htmlContent,
            }),
          ),
        );
      }
    }
    if (canSendPush) {
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