import mongoose from "mongoose";
import {
  notificationSchema,
  dealSchema,
  userBankOrCardDetails,
  courseSchema,
  transactionMiddleState,
  verifyStudentSchema,
  verifyLecturerSchema,
  storeCategoriesSchema,
  eventSchema,
  productSchema,
  userRecordsSchema,
  userSchema,
  EmailVerificationSchema,
  iCampusOperationalInstitutionSchema,
  universitiesAndCollegesSchema,
  PostSchema,
} from "./models.js";

export const Student = mongoose.model(
  "Student",
  verifyStudentSchema,
  "students",
);
export const Posts = mongoose.model("Posts", PostSchema, "posts");
export const Lecturer = mongoose.model(
  "Lecturer",
  verifyLecturerSchema,
  "lecturers",
);
export const ProductCategory = mongoose.model(
  "Category",
  storeCategoriesSchema,
  "store-categories",
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
export const TransactionMiddleState =
  mongoose.models.TransactionMiddleState ||
  mongoose.model(
    "TransactionMiddleState",
    transactionMiddleState,
    "trans-mid-state",
  );
export const Course =
  mongoose.models.Course ||
  mongoose.model("Course", courseSchema, "all-courses");
export const UserBankOrCardDetails =
  mongoose.models.UserBankOrCardDetails ||
  mongoose.model(
    "UserBankOrCardDetails",
    userBankOrCardDetails,
    "userBankDetails",
  );
export const Deals =
  mongoose.models.Deals || mongoose.model("Deals", dealSchema, "userDealings");
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
export const UniversitiesAndColleges = mongoose.model(
  "UniversitiesAndColleges",
  universitiesAndCollegesSchema,
  "UniversitiesAndColleges", // <-- exact collection name
);
