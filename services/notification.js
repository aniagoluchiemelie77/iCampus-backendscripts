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
  newAdminWelcomeTemplate,
  supportTicketReceivedTemplate,
  supportTicketResolvedTemplate,
  supportTicketReplyTemplate,
  suspiciousPasswordChangeTemplate,
  financialSecurityAlertTemplate,
  newStationRegistrationTemplate,
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
          payload.userId,
        );
        break;
      case "PASSWORD_CHANGED":
        subject = "Security Alert: Password Updated";
        htmlContent = passwordResetSuccessTemplate(
          payload.userName,
          payload.date,
          payload.time,
          payload.userId,
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
      case "VERIFICATION_SUCCESS":
        category = "system";
        subject = "Account Verified";
        title = title || "Identity Verified!";
        message =
          message ||
          "Your identity has been successfully verified. You now have full access to all platform features.";
        break;
      case "SUPPORT_TICKET_RECEIVED":
        category = "system";
        subject = "We've received your support request";
        title = "Support Ticket Created";
        message = `Your ticket (Ref: ${payload.ticketRefId}) has been received. Our team will review your request and reply within 24 hours.`;

        if (canSendEmail) {
          htmlContent = supportTicketReceivedTemplate(
            payload.userName,
            payload.ticketRefId,
            payload.date,
            payload.time,
          );
        }
        break;
      case "SUPPORT_TICKET_RESOLVED":
        category = "system";
        subject = `Update: Support Ticket #${payload.ticketRefId} Resolved`;
        title = "Support Ticket Resolved";
        message = `Dear iCampus user, your support ticket (Ref: ${payload.ticketRefId}) has been successfully resolved.`;

        if (
          canSendEmail &&
          typeof supportTicketResolvedTemplate === "function"
        ) {
          htmlContent = supportTicketResolvedTemplate(
            payload.userName,
            payload.ticketRefId,
            payload.date,
            payload.time,
          );
        }
        break;
      case "SUPPORT_TICKET_REPLY":
        category = "system";
        subject = `New Response to Ticket #${payload.ticketRefId}`;
        title = title || "Support Ticket Update";
        message = message || payload.adminMessage;
        if (canSendEmail && typeof supportTicketReplyTemplate === "function") {
          htmlContent = supportTicketReplyTemplate(
            payload.userName,
            payload.ticketRefId,
            payload.adminMessage,
            payload.date,
            payload.time,
          );
        }
        break;
      case "CLASS_SCHEDULED":
        category = "academic";
        entityId = payload.lectureId;
        entityType = "lecture";
        break;
      case "STATION_DELETION":
        category = "system";
        subject = "Important: Station Removal Notice";
        title = title || "Station Removed";
        message =
          message ||
          `Your drop-off station "${payload.stationName}" has been removed. Please contact support if this was an error.`;
        break;
      case "STATION_CREATED":
        category = "system";
        subject = "New Drop-off Station Creation";
        title = "Drop-off Station Assigned";
        message = `Dear iCampus User, your request to create an iCampus drop off station has been approved and you have been assigned to manage station: ${payload.stationName}.`;
        break;
      case "STATION_UPDATED":
        category = "system";
        subject = "Update: Drop-off Station Settings";
        title = "Drop-off Station Updated";
        message = `The settings for your station "${payload.stationName}" have been modified.`;
        break;
      case "GRADUATION_CONGRATULATIONS":
        category = "system";
        subject = "Account Update: Welcome to Alumni status";
        title = title || "Transition to Alumni";
        message =
          message ||
          "Congratulations! Your account has been officially upgraded to Alumni status. You now have access to exclusive alumni features on iCampus.";
        break;
      case "STATION_REQUEST_RECEIVED":
        category = "system";
        subject = "Station Registration: Request Under Review";
        title = title || "Registration Received";
        message =
          message ||
          "Your drop-off station request has been received and is under review. Our team will verify your details; please expect a reply within 5 days.";
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

      //admin notifications
      case "NEW_ADMIN_CREATED":
        title = title || "New Administrator Alert";
        message = message || "A new admin has been added to the system.";
        break;
      case "ADMIN_SUBSCRIPTION_UPGRADED":
        title = title || "Subscription Upgraded";
        message =
          message ||
          `User ${payload.userName} upgraded to the ${payload.tier.toUpperCase()} plan.`;
        break;
      case "WELCOME_ADMIN":
        subject = "Welcome to the iCampus Admin Team";
        if (canSendEmail) {
          htmlContent = newAdminWelcomeTemplate(
            payload.adminName,
            payload.creatorName,
          );
        }
        break;
      case "ADMIN_DELETED":
        title = title || "Security Alert: Admin Removed";
        message = message || "An administrator account has been deleted.";
        break;
      case "ADMIN_PROFILE_UPDATED":
        title = title || "Account Information Updated";
        message = message || "Your account details have been modified.";
        break;
      case "ADMIN_PERMISSIONS_CHANGED":
        title = title || "Security Alert: Permissions Changed";
        message =
          message || "An administrator's access level has been modified.";
        break;
      case "PURCHASE_ORDER_COMPLETION":
        category = "store";
        subject = `Order Completed: #${payload.orderId}`;
        title = title || "Order Delivered & Settled";
        message =
          message ||
          `Order #${payload.orderId} has been successfully completed and funds have been settled.`;
        break;
      case "NEW_PURCHASE_ORDER":
        category = "store";
        subject = `New Order Placed: REF-${payload.transactionId}`;
        title = title || "New Order Activity";
        message =
          message ||
          `A new order batch was purchased by ${payload.buyerId} containing ${payload.itemCount} items.`;
        entityId = payload.transactionId;
        entityType = "transaction";
        break;
      case "ORDER_CANCELLED_ADMIN":
        category = "store";
        subject = `Audit: Order Cancelled - #${payload.orderId}`;
        title = title || "Cancellation Audit";
        message =
          message ||
          `Order #${payload.orderId} was cancelled. Reason: ${payload.reason}`;
        break;
      case "SALES_PAYOUT_ADMIN_ALERT":
        category = "store";
        subject = "Audit: Sales Payout Processed";
        title = title || "Payout Audit";
        message =
          message ||
          `A payout of ${payload.amount} iCash was credited to user ${payload.userId}.`;
        break;
      case "PRODUCT_CREATION":
      case "PRODUCT_UPDATE":
        category = "store";
        subject =
          actionType === "PRODUCT_CREATION"
            ? "New Marketplace Listing"
            : "Marketplace Update";
        title =
          title ||
          (actionType === "PRODUCT_CREATION"
            ? "New Product Listed"
            : "Product Updated");
        message =
          message ||
          `The product "${payload.productName}" has been ${actionType === "PRODUCT_CREATION" ? "added" : "updated"}.`;
        entityId = payload.productId;
        entityType = "product";
        break;
      case "PRODUCT_DELETION_ADMIN":
        category = "store";
        subject = "Audit: Product Deleted";
        title = "Product Deletion Audit";
        message = `Product "${payload.productName}" (ID: ${payload.productId}) was removed from the marketplace.`;
        break;
      case "USER_VERIFICATION_AUDIT":
        category = "social";
        subject = "Audit: Identity Verified";
        title = "User Verified";
        message = `The user with UID ${payload.referenceId} has successfully completed Persona verification.`;
        break;
      case "ACCOUNT_DELETION_ADMIN_ALERT":
        category = "profile";
        subject = "Security Alert: Account Deleted";
        title = "User Account Deletion";
        message = `User ${payload.userUid} has permanently deleted their account. Reason provided: ${payload.reason || "None"}.`;
        break;
      case "ICASH_PIN_RESET_AUDIT":
        category = "security";
        subject = "Security Audit: iCash PIN Reset";
        title = "Security Alert";
        message = `The iCash PIN for user ${payload.userName} (UID: ${payload.userUid}) was successfully reset.`;
        break;
      case "AI_SUPPORT_ESCALATION":
        category = "social";
        subject = "Action Required: AI Support Escalation";
        title = "New Support Ticket Escalated";
        message = `The AI could not resolve a query from UID ${payload.userUid}. A ticket has been created: ${payload.ticketId}. Please review it in the admin dashboard.`;
        break;
      case "ADMIN_LOGIN_AUDIT":
        category = "security";
        subject = "Security Audit: Admin Login";
        title = "Admin Login Detected";
        message = `Admin ${payload.userEmail} logged in from ${payload.currentLocation}.`;
        break;
      case "PASSWORD_CHANGE_AUDIT":
        category = "security";
        subject = "Security Audit: Password Changed";
        title = "User Password Reset";
        message = `The password for user ${payload.userEmail} (UID: ${payload.userUid}) was successfully changed at ${payload.timestamp}.`;
        break;
      case "SUSPICIOUS_PASSWORD_CHANGE":
        category = "security";
        subject = "CRITICAL: Suspicious Password Change Detected";
        title = "Security Alert";
        message = `Alert: Password for ${payload.userEmail} changed from ${payload.currentCountry}. Previous known location was ${payload.previousCountry}. Immediate review recommended.`;
        if (
          canSendEmail &&
          typeof suspiciousPasswordChangeTemplate === "function"
        ) {
          htmlContent = suspiciousPasswordChangeTemplate(
            payload,
            payload.isSuspicious,
          );
        }
        break;
      case "SUSPICIOUS_ACTIVITY_ALERT":
        category = "security";
        subject = "SECURITY ALERT: Unusual Login Activity";
        title = "Suspicious Access Detected";
        message = `Security Alert: The account with UID ${payload.userUid} was accessed from ${payload.currentLocation}. This location does not match the user's historical login patterns. Please investigate immediately.`;
        break;
      case "MODERATION_ALERT_NUDITY":
        category = "social";
        subject = "Urgent: Policy Violation Detected";
        title = "Content Moderation Alert";
        message = `An automated system flagged a post (ID: ${payload.postId}) for ${payload.reason} with ${payload.confidence}% confidence. Post has been hidden pending review.`;
        break;
      case "FINANCIAL_SECURITY_ALERT":
        category = "security";
        subject = "CRITICAL: Potential Financial Fraud Attempt";
        title = "Price Spoofing Detected";
        message = `Alert: User ${payload.userId} attempted an iCash purchase that failed integrity checks. Amount requested: ${payload.attemptedAmount}. IP: ${payload.ipAddress}. Investigation recommended.`;
        break;
        if (
          canSendEmail &&
          typeof financialSecurityAlertTemplate === "function"
        ) {
          htmlContent = financialSecurityAlertTemplate(payload);
        }
      case "WITHDRAWAL_SUCCESS_AUDIT":
        category = "finance";
        subject = "Audit: Successful Withdrawal";
        title = "New Withdrawal Processed";
        message = `User ${payload.userId} has successfully withdrawn ${payload.currency} ${payload.amount}. Transaction ID: ${payload.transactionId}.`;
        break;
      case "WITHDRAWAL_FAILED_AUDIT":
        category = "finance";
        subject = "Alert: Withdrawal Failed";
        title = "Withdrawal Failure";
        message = `A withdrawal attempt for User ${payload.userId} (ID: ${payload.transactionId}) failed. Funds were reverted.`;
        break;
      case "P2P_TRANSFER_AUDIT":
        category = "finance";
        subject = "Financial Audit: P2P Transfer";
        title = "P2P Transaction Logged";
        message = `A P2P transfer of ${payload.amount} iCash occurred between ${payload.senderId} and ${payload.recipientId}. Ref: ${payload.transactionRef}.`;
        break;
      case "ACCOUNT_SUSPENDED_SECURITY":
        category = "security";
        subject = "CRITICAL: Account Suspended";
        title = "Automatic Security Suspension";
        message = `User ${payload.userId} has been suspended due to: ${payload.reason}.`;
        break;
      case "SECURITY_FLAG_RAISED":
        category = "security";
        subject = "Security Notice: New Flag";
        title = "Account Security Flagged";
        message = `A '${payload.flagType}' flag was raised for user ${payload.userId}. Please review.`;
        break;
      case "SECURITY_ALERT_HEAVY_ACTIVITY":
        category = "security";
        subject = "Security Alert: Heavy P2P Activity";
        title = "Rapid P2P Transactions Detected";
        message = `Warning: User ${payload.userId} has performed 5+ P2P transfers within one hour.`;
        break;
      case "SECURITY_ALERT_HEAVY_WITHDRAWAL":
        category = "security";
        subject = "Security Alert: Heavy Withdrawal Activity";
        title = "Rapid Withdrawal Attempts Detected";
        message = `Warning: User ${payload.userId} has attempted 5+ withdrawals within one hour.`;
        break;
      case "SUPPORT_TICKET_RESOLVED_ADMIN":
        category = "social";
        subject = `Audit: Ticket Resolved - #${payload.ticketRefId}`;
        title = "Ticket Resolution Audit";
        message = `Ticket #${payload.ticketRefId} initiated by user ${payload.userId} was marked as resolved by admin ${payload.adminId}.`;
        break;
      case "ADMIN_INSTITUTION_DELETED":
        subject = "Audit: Institution Deletion";
        title = title || "Institution Removed";
        message =
          message ||
          `Institution ${payload.schoolName} was deleted from the system.`;
        break;
      case "STATION_DELETION_ADMIN":
        subject = "Audit: Drop-Off Station Deletion";
        title = title || "Station Deletion Audit";
        message =
          message ||
          `Station "${payload.stationName}" (Agent: ${payload.agentId}) was deleted.`;
        break;
      case "ADMIN_INSTITUTION_CREATED":
        subject = "New Institution Onboarding";
        title = title || "Institution Added";
        message =
          message ||
          `A new institution, ${payload.schoolName}, has joined the platform.`;
        break;
      case "ADMIN_INSTITUTION_UPDATED":
        subject = "Audit: Institution Update";
        title = title || "Configuration Changed";
        message =
          message ||
          `Institution ${payload.schoolName} (ID: ${payload.schoolId}) was updated by an admin.`;
        break;
      case "STATION_CREATED_ADMIN":
        subject = "Audit: New Drop-off Station";
        title = title || "Drop-off Station Created";
        message =
          message ||
          `Drop-off Station ${payload.stationName} successfully linked to Agent ${payload.agentId}.`;
        break;
      case "STATION_UPDATED_ADMIN":
        subject = "Audit: Drop-off Station Modification";
        title = "Drop-off Station Edit Audit";
        message = `Audit: Drop-off Station ${payload.stationId} (Agent: ${payload.agentId}) was updated.`;
        break;
      case "NEW_STATION_REGISTRATION":
        category = "store";
        subject = "Action Required: New Station Registration";
        title = title || "New Station Pending Review";
        message =
          message ||
          `A new drop-off station registration has been submitted and requires admin review. Ticket Ref: ${data?.ticketRefId || "N/A"}`;
        if (
          canSendEmail &&
          typeof newStationRegistrationTemplate === "function"
        ) {
          htmlContent = newStationRegistrationTemplate(
            payload.name,
            payload.userId,
            payload,
          );
        }
        break;
      case "STATION_APPROVAL_UPDATE":
        category = "store";
        subject = "Station Registration: Status Update";
        title = title || "Update on your Station Request";
        message =
          message ||
          "There has been an update regarding your station registration request. Please check the support ticket for details.";
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