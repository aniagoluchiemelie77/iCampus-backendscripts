import mongoose from 'mongoose';
import {notificationSchema, userBankOrCardDetails, courseSchema, transactionMiddleState, verifyStudentSchema, verifyLecturerSchema, storeCategoriesSchema, eventSchema, productSchema, userSchema} from './models';

export const Student = mongoose.model("Student", verifyStudentSchema, "students");
export const Lecturer = mongoose.model("Lecturer", verifyLecturerSchema, "lecturers");
export const ProductCategory = mongoose.model(
  "Category",
  storeCategoriesSchema,
  "store-categories"
);
export const Event = mongoose.model("Event", eventSchema, "events");
export const Product =
    mongoose.models.Product ||
    mongoose.model("Product", productSchema, "store-products");
export const User =
    mongoose.models.User || mongoose.model("User", userSchema, "users");
export  const Notification =
    mongoose.models.Notification ||
    mongoose.model("Notification", notificationSchema, "notifications");
export const TransactionMiddleState =
    mongoose.models.TransactionMiddleState ||
    mongoose.model(
      "TransactionMiddleState",
      transactionMiddleState,
      "trans-mid-state"
    );
export   const Course =
    mongoose.models.Course ||
    mongoose.model("Course", courseSchema, "all-courses");
export   const UserBankOrCardDetails =
    mongoose.models.UserBankOrCardDetails ||
    mongoose.model("UserBankOrCardDetails", userBankOrCardDetails, "userBankDetails");