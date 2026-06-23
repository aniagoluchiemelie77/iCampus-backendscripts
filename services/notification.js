// services/notificationService.js
import { Notification, userPrefs } from "../tableDeclarations.js";
import { getIO } from "../controllers/socket.js";
import { sendEmail } from "./emailService.js";
import { sendPushNotification } from "./pushNotification.js";
import {
  welcomeEmailTemplate,
  productUpdateTemplate,
  courseCompletionEmailTemplate,
  newOrderTemplate,
  passwordResetTemplate,
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
  orderDroppedOffEmailTemplate,
  agentAwaitingPickupEmailTemplate,
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

    let htmlContent = "";
    let subject = "iCampus Notification";
    let priority = "normal";

    switch (actionType) {
      //navigate to Notification detail
      case "WELCOME_USER":
        subject = "Welcome to iCampus!";
        if (canSendEmail) {
          htmlContent = welcomeEmailTemplate(payload.userName);
        }
        title = title || "Welcome aboard!";
        message =
          message ||
          `Hi ${payload.userName}, welcome to the iCampus community!`;
        break;
      case "ORDER_CANCELLED":
        htmlContent = orderCancelledEmailTemplate(
          payload.recipientName,
          payload.productName,
          payload.orderId,
          payload.reason,
          payload.buyerName,
          payload.date,
          payload.time,
        );
        subject = `Action Required: Order #${payload.orderId} Cancelled`;
        break;
      case "NEW_ORDER":
        subject = `New Sale: ${payload.productName}`;
        if (canSendEmail) {
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
            payload.date,
            payload.time,
          );
        }
        break;
      case "ORDER_DROPPED_OFF":
        subject = `Ready for Pickup: ${payload.productName}`;
        title = title || "Package Dropped Off!";
        message =
          message ||
          `The seller dropped off "${payload.productName}" at ${payload.stationName || "the station"}. It is ready for collection!`;

        if (canSendEmail) {
          htmlContent = orderDroppedOffEmailTemplate(
            payload.userName,
            payload.productName,
            payload.orderId,
            payload.stationName,
            payload.stationAddress,
          );
        }
        break;
      case "AGENT_AWAITING_PICKUP":
        subject = `New Package Dropped Off - Order #${payload.orderId}`;
        title = title || "New Package Inbound";
        message =
          message ||
          `Order #${payload.orderId} (${payload.productName}) has been logged at your station hub.`;
        if (canSendEmail) {
          htmlContent = agentAwaitingPickupEmailTemplate(
            payload.agentName,
            payload.productName,
            payload.orderId,
            payload.stationName,
            payload.date,
            payload.time,
          );
        }
        break;
      case "NEW_LOGIN":
        subject = "Security Alert: New Login Detected";
        htmlContent = loginAlertTemplate(
          payload.userName,
          payload.ipAddress,
          payload.location,
          payload.date,
          payload.time,
        );
        break;
      case "PASSWORD_CHANGED":
        subject = "Security Alert: Password Updated";
        htmlContent = passwordResetSuccessTemplate(
          payload.userName,
          payload.date,
          payload.time,
        );
        break;
      case "ORDER_COMPLETED":
        subject = `Payment Released: ${payload.productName}`;
        if (canSendEmail) {
          htmlContent = orderCompletedTemplate(
            payload.userName,
            payload.productName,
            payload.amount,
            payload.orderId,
            payload.role,
          );
        }
        break;
      case "POST_DELETION":
        subject = "Post Deleted Successfully";
        title = title || "Post Deleted";
        message =
          message || "Your post has been successfully deleted from your feed.";
        break;
      case "LEARNING_REMINDER":
        subject = "Ready to continue your learning journey?";
        title = title || "Don't break your streak!";
        break;
      case "TEST_SUBMITTED":
        subject = "Assessment Submission Confirmed";
        message = `Assessment for ${payload.title} submitted successfully`;
        break;
      case "EXCEPTION_SUBMITTED":
        subject = "Lecture Exception Submited";
        message = `Lecture exception for ${payload.lectureTitle} submitted and awaiting approval`;
        break;
      case "COURSES_EXTRACTED":
        subject = "Courses Verification Complete";
        message = `Courses extraction for ${payload.semester} semester ${payload.session} session completed and verified`;
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
      case "SUBSCRIPTION_UPGRADED":
        category = "finance";
        subject = "Premium Access Activated";
        title = "Subscription Upgraded";
        message = `Congratulations! You are now on the ${payload.tier} plan.`;
        if (canSendEmail) {
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
        if (canSendEmail) {
          htmlContent = iCashSuccessfulPinResetTemplate(
            payload.userName,
            new Date().toLocaleString(),
          );
        }
        break;

      //navigate to CreateReviewScreen, param: productType: 'lecturer', targetId: payload.targetId
      case "LECTURER_REVIEW_REQUEST":
        category = "classroom";
        subject = `How was your lecture on "${payload.topicName}"?`;
        title = title || "Rate Your Live Class Experience";
        message =
          message ||
          `Hi ${payload.userName || "Student"}, how was today's session on "${payload.topicName}"? Rate your experience to help the iCampus community.`;
        break;

      //navigate to CourseSubPage, param: title: 'View Lecture Schedule', userRole: user.usertype,
      case "LECTURE_CANCELLED":
      case "LECTURE_POSTPONED":
      case "LECTURE_SCHEDULED":
      case "LECTURE_VENUE_CHANGE":
      case "LECTURE_TYPE_CHANGE":
        category = "classroom";
        entityId = payload.lectureId;
        entityType = "lecture";

      //first navigate to notification detail screen, then eith a download button for the payload.url to download the certificate
      case "COURSE_COMPLETED":
        subject = `Congratulations on finishing ${payload.productName}!`;
        if (canSendEmail) {
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

      //navigate to CourseSubPage, param: title = 'Assessments', userRole: user.usertype
      case "TEST_CREATED":
        subject = `New Assessment update: ${payload.courseTitle}`;
        message = `New assessment created for ${payload.courseTitle}`;
        htmlContent = testCreatedTemplate(
          payload.userName,
          payload.courseTitle,
          payload.testTitle,
          payload.dueDate,
          payload.creationDate,
          payload.creationTime,
        );
        break;

      //navigate to CreateReviewScreen, param: productType: 'product', targetId: payload.targetId,
      case "ORDER_REVIEW_REQUEST":
        subject = `How was your purchase of ${payload.productName}?`;
        if (canSendEmail) {
          htmlContent = orderReviewTemplate(
            payload.userName,
            payload.productName,
            payload.orderId,
            payload.targetId,
          );
        }
        break;

      // navigate to SalesHub on frontend
      case "PRODUCT_DELETION":
        subject = `Marketplace Listing Removed: ${payload.productName}`;
        htmlContent = productDeletionTemplate(
          payload.username,
          payload.productName,
          payload.productId,
          payload.date,
          payload.time,
        );
        break;
      case "PRODUCT_CREATION":
        htmlContent = productCreationTemplate(
          payload.username,
          payload.productName,
          payload.price,
          payload.productId,
          payload.date,
          payload.time,
        );
        subject = `Product Listed Successfully: ${payload.productName}`;
        break;
      case "PRODUCT_UPDATE":
        htmlContent = productUpdateTemplate(
          payload.username,
          payload.productName,
          payload.price,
          payload.productId,
          payload.date,
          payload.time,
        );
        subject = `Changes Saved: ${payload.productName}`;
        break;

      //navigate to TransactionDetail, param: transactionId
      case "SALES_PAYOUT_SUCCESS":
        subject = "Funds Received: Your Sales Payout is here!";
        if (canSendEmail) {
          htmlContent = salesPayoutTemplate(
            payload.username,
            payload.amount,
            payload.transactionId,
            payload.date,
            payload.time,
          );
        }
        title = title || "Sales Payout Successful";
        message =
          message ||
          `${payload.amount.toLocaleString()} iCash has been moved to your wallet.`;
        break;
      case "MARKET_PURCHASE_DEBIT":
        subject = `Receipt: ${payload.productName}`;
        if (canSendEmail) {
          htmlContent = marketplacePurchaseTemplate(
            payload.userName,
            payload.productName,
            payload.amount,
            payload.orderId,
            payload.productType,
            payload.fileUrl,
            payload.transactionId,
            payload.date,
            payload.time,
          );
        }
        break;
      case "ICASH_PURCHASE":
        subject = `Credit Alert: ${payload.amountICash.toLocaleString()} iCash purchased`;
        if (canSendEmail) {
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
        if (canSendEmail) {
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

      //navigate to PostDetailScreen, param: postId = payload.postId
      case "POST_UPDATED":
        category = "social";
        entityId = payload.postId;
        entityType = "post";
        subject = "Your post has been updated";
        break;
      case "NEW_POST":
        subject = `New post from ${title}`;
        entityId = payload.postId;
        entityType = "post";
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

      //navigate to CourseSubPage param: title = 'Course Materials', userRole: user.usertype course: payload.course
      case "MATERIAL_UPLOADED":
        category = "classroom";
        title = title || "New Study Material";
        message = message || `A new resource file has been uploaded.`;
        break;
      case "MATERIAL_DELETED":
        category = "classroom";
        title = title || "Study Material Removed";
        message = `A course resource file ${payload.fileName} was deleted by the instructor.`;
        break;

      //navigate to CourseSubPage param: title = 'Assignments', userRole: user.usertype course: payload.course
      case "ASSIGNMENT_CREATED":
        category = "classroom";
        subject = `New Assignment: ${payload.assignmentTitle || "Task Assigned"}`;
        title = title || "New Assignment Posted";
        message =
          message ||
          `A new assignment has been uploaded for your course. Due: ${payload.dueDate || "See app for details"}`;
        break;
      case "ASSIGNMENT_REMOVED":
        category = "classroom";
        subject = `Course Update: Assignment Removed`;
        title = title || "Assignment Removed";
        message = `An assignment ${payload.title} was removed by your instructor.`;
        break;

      //navigate to CourseSubPage param: title = 'Course Contents', userRole: user.usertype, course: payload.course
      case "CONTENT_MUTATED":
        category = "classroom";
        subject = `Syllabus Update: ${payload.courseTitle || "Course Plan Updated"}`;
        title = title || "Course Syllabus Updated";
        message = `A syllabus topic: ${payload.updatedTopic} has been updated by your instructor.`;
        break;
      case "CONTENT_ADDED":
        category = "classroom";
        subject = `New Syllabus Topic: ${payload.courseTitle || "Course Plan Updated"}`;
        title = title || "New Topic Added";
        message = `A new topic: ${payload.topic} has been added to your ${payload.courseTitle} curriculum.`;
        break;
      case "CONTENT_DELETION":
        category = "classroom";
        subject = `Syllabus Revision: ${payload.courseTitle || "Course Plan Updated"}`;
        title = title || "Syllabus Content Removed";
        message = `A syllabus topic: ${payload.removedTopic} was removed from your ${payload.courseTitle} curriculum.`;
        break;

      //navigate to CourseSubPage param: title = 'Exceptions', userRole: user.usertype
      case "EXCEPTION_UPDATED":
        subject = `Update on your Exception: ${payload.courseTitle}`;
        break;

      //navigate to Profile, param: identifier: payload.followerId
      case "NEW_FOLLOWER":
        subject = "You have a new follower!";
        title = "New Follower";
        message = `${payload.firstname} started following you.`;
        break;

      // navigate to Profile, param: identifier: user.uid
      case "PROFILE_UPDATED":
        subject = "Security Alert: Profile Change";
        break;
      case "PROFILE_VIEW":
        subject = "Someone viewed your profile";
        break;

      default:
        break;
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
    if (canSendEmail && htmlContent && recipients.length > 0) {
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