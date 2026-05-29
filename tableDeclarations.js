import mongoose from "mongoose";
import {
  dropOffStation,
  reviewSchema,
  iTagSchema,
  messageSchema,
  notificationSchema,
  deletedUserSchema,
  userBankOrCardDetails,
  courseSchema,
  userDownloadsSchema,
  verifyLecturerSchema,
  eventSchema,
  productSchema,
  userRecordsSchema,
  userSchema,
  EmailVerificationSchema,
  transactionSchema,
  iCampusOperationalInstitutionSchema,
  postSchema,
  reviewSchema,
  exceptionSchema,
  lectureSchema,
  assessmentSchema,
  testSubmissionSchema,
  followSchema,
  attendanceSchema,
  paymentMethodSchema,
  userPreferencesSchema,
  phoneVerificationSchema,
  orderSchema,
  certificateSchema,
  impressionLogSchema,
  productSalesSchema,
  payoutSchema,
  statementSchema,
  schoolConfigurationSchema,
} from "./models.js";

export const Posts = mongoose.model("Posts", postSchema, "posts");
export const Lecturer = mongoose.model(
  "Lecturer",
  verifyLecturerSchema,
  "lecturers",
);
export const Event = mongoose.model("Event", eventSchema, "events");
export const Product =
  mongoose.models.Product ||
  mongoose.model("Product", productSchema, "store-products");
export const User =
  mongoose.models.User || mongoose.model("User", userSchema, "users");
export const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema, "notifications");
export const Course =
  mongoose.models.Course || mongoose.model("Course", courseSchema, "courses");
export const UserBankOrCardDetails =
  mongoose.models.UserBankOrCardDetails ||
  mongoose.model(
    "UserBankOrCardDetails",
    userBankOrCardDetails,
    "userBankDetails",
  );
export const UserRecords =
  mongoose.models.UserRecords ||
  mongoose.model("UserRecords", userRecordsSchema, "records");
export const EmailVerification = mongoose.model(
  "EmailVerification",
  EmailVerificationSchema,
);
export const OperationalInstitutions = mongoose.model(
  "OperationalInstitutions",
  iCampusOperationalInstitutionSchema,
);
export const Exceptions = mongoose.model(
  "Exceptions",
  exceptionSchema,
  "exceptions",
);
export const Lectures = mongoose.model("Lectures", lectureSchema, "Lectures");
export const Assessment = mongoose.model(
  "Assessment",
  assessmentSchema,
  "assessment",
);
export const TestSubmission = mongoose.model(
  "TestSubmission",
  testSubmissionSchema,
  "testSubmission",
);
export const Follow = mongoose.model("Follow", followSchema, "follows");
export const Attendance = mongoose.model(
  "Attendance",
  attendanceSchema,
  "lectureAttendance",
);
export const Transactions = mongoose.model(
  "Transactions",
  transactionSchema,
  "transactions",
);
export const PaymentMethods = mongoose.model(
  "PaymentMethods",
  paymentMethodSchema,
  "paymentMethods",
);
export const ITag = mongoose.model("ITag", iTagSchema, "iTags");
export const Message = mongoose.model("Message", messageSchema, "messages");
export const userPrefs = mongoose.model(
  "userPrefs",
  userPreferencesSchema,
  "userPreferences",
);
export const DeletedUser = mongoose.model(
  "DeletedUser",
  deletedUserSchema,
  "deletedUser",
);
export const PhoneNumberVerification = mongoose.model(
  "PhoneNumberVerification",
  phoneVerificationSchema,
  "phoneNumberVerification",
);
export const ProductOrder = mongoose.model(
  "ProductOrder",
  orderSchema,
  "productOrder",
);
export const UserDownloads = mongoose.model(
  "UserDownloads",
  userDownloadsSchema,
  "userDownloads",
);
export const Certificate = mongoose.model(
  "Certificate",
  certificateSchema,
  "downloadCertificate",
);
export const ProductImpression = mongoose.model(
  "ProductImpression",
  impressionLogSchema,
  "productImpression",
);
export const ProductSales = mongoose.model(
  "ProductSales",
  productSalesSchema,
  "productSales",
);
export const Reviews = mongoose.model("Reviews", reviewSchema, "reviews");
export const Payout = mongoose.model("Payout", payoutSchema, "payout");
export const DropOffStation = mongoose.model(
  "DropOffStation",
  dropOffStation,
  "dropOffStations",
);
export const AccountStatement = mongoose.model(
  "AccountStatement",
  statementSchema,
  "accountStatement",
);
export const SchoolConfiguration = mongoose.model(
  "SchoolConfiguration",
  schoolConfigurationSchema,
  "schoolConfiguration",
);