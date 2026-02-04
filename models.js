import mongoose from "mongoose";

const purchaseItemSchema = new mongoose.Schema(
  {
    productId: String,
    title: String,
    quantity: Number,
    priceInPoints: Number,
    selectedSize: String,
    selectedColor: String,
    selectedQuantity: String,
    fileUrl: String,
  },
  { _id: false },
);
const purchaseHistorySchema = new mongoose.Schema(
  {
    id: String,
    date: {
      type: Date,
      default: Date.now,
    },
    totalProductsPurchased: Number,
    totalPointsSpent: Number,
    items: [purchaseItemSchema],
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { _id: false },
);
export const courseSchema = new mongoose.Schema(
  {
    courseId: { type: String, required: true },
    department: { type: String, required: true },
    level: { type: String, required: true },
    schoolName: { type: String, required: true },
    lecturerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    studentsEnrolled: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdAt: { type: Date, default: Date.now },
    courseCode: { type: String, required: true },
    courseTitle: { type: String, required: true },
    credits: { type: Number, required: true },
    semester: { type: String, required: true },
    session: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const userBankOrCardDetails = new mongoose.Schema({
  _id: String, // MongoDB default
  cardOrBankDetailsId: String, // Unique reference from payment gateway
  userId: {
    type: String,
    ref: "User",
    required: true,
  },
  paymentToken: String, // Tokenized reference (encrypted at rest)
  method: String, // 'card' or 'bank'
  provider: String, // e.g., 'Paystack', 'Flutterwave'
  lastFourDigits: String, // Safe for display
  cardBrand: String, // Optional: 'Visa', 'MasterCard'
  expiryMonth: String, // Optional
  expiryYear: String, // Optional
  bankName: String, // Optional
  bankAccNumber: String,
  country: String,
  isDefault: Boolean,
  createdAt: Date,
  updatedAt: Date,
  accountHolderName: String,
  bankCode: String,
  billingAddressDetails: {
    id: String,
    state: String,
    city: String,
    street: String,
    zip: String,
  },
});
export const userSchema = new mongoose.Schema({
  uid: String,
  iScore: String,
  profilePic: [String],
  schoolCode: String,
  usertype: String,
  isFirstLogin: Boolean,
  firstname: String,
  lastname: String,
  schoolName: String,
  email: { type: String, unique: true },
  ipAddress: [String],
  deviceType: [String],
  coursesEnrolled: [String],
  accessToken: String,
  password: String,
  department: String,
  pointsBalance: { type: Number, default: 0 },
  hasSubscribed: { type: Boolean, default: false },
  isCourseRep: { type: Boolean, default: false },
  createdAt: Date,
  country: String,
  current_level: String,
  phone_number: String,
  matricNumber: String,
  staff_id: String,
  cart: [{ type: String }],
  favorites: [{ type: String }],
  isVerified: {
    type: Boolean,
    default: false,
  },
  verificationToken: {
    type: String,
    default: null,
  },
  deals: [{ type: String, ref: "Deal" }],
  purchaseHistory: [purchaseHistorySchema],
  coursesEnrolled: [{ type: String }],
  coursesTeaching: [{ type: String }],
  userAccountDetails: [
    {
      type: String, // or mongoose.Schema.Types.String
      ref: "UserBankOrCardDetails",
    },
  ],
});
userSchema.index(
  { matriculation_number: 1, department: 1 },
  { unique: true, partialFilterExpression: { usertype: "student" } },
);

userSchema.index(
  { staff_id: 1, department: 1 },
  { unique: true, partialFilterExpression: { usertype: "lecturer" } },
);

export const verifyStudentSchema = new mongoose.Schema({
  firstname: String,
  lastname: String,
  department: String,
  current_level: String,
  phone_number: String,
  matriculation_number: String,
  school_name: String,
});
export const storeCategoriesSchema = new mongoose.Schema({
  id: Number,
  categoryName: String,
  schoolName: String,
  icon: String,
});
export const productSchema = new mongoose.Schema({
  id: Number,
  quantity: { type: String },
  inStock: { type: String },
  productId: { type: String, required: true },
  category: { type: String, required: true },
  schoolName: { type: String, required: true },
  sellerId: { type: String, required: true },
  title: { type: String, required: true },
  mediaUrls: [{ type: String }], // ✅ array of strings
  colors: [{ type: String }], // ✅ array of product colors
  sizes: [{ type: String }], // ✅ array of product sizes
  type: { type: String, enum: ["product", "File"], required: true },
  priceInPoints: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  isAvailable: { type: Boolean, default: true },
  favCount: { type: Number, default: 0 },
  ratings: [{ type: Number }], // ✅ array of numbers
  description: { type: String },
  lockedWithPassword: { type: Boolean, default: false },
  password: { type: String }, // optional, only if locked
  isFile: { type: Boolean, default: false },
  fileUrl: { type: String },
  fileSizeInMB: { type: Number },
  downloadCount: { type: Number, default: 0 },
});

export const notificationSchema = new mongoose.Schema(
  {
    id: Number,
    notificationId: { type: String },
    userId: { type: String },
    title: { type: String },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    isPublic: { type: Boolean, default: false },
    relatedSchoolName: { type: String },
    department: { type: String },
    level: { type: String },
    relatedCommunityId: { type: String },
    createdAt: { type: Date, default: Date.now },
    relatedEventId: { type: String },
    relatedPollId: { type: String },
    relatedClassSessionId: { type: String },
    type: { type: String },
    purchaseId: { type: String },
    status: { type: String },
    transactionIdMid: { type: String },
    fileUrls: [{ type: String }],
  },
  { timestamps: true },
);
export const transactionMiddleState = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    sellerId: { type: String, required: true },
    buyerId: { type: String, required: true },
    priceInPoints: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "completed", "rejected"],
      default: "pending",
    },
    productIdArrays: [{ type: String }],
  },
  { timestamps: true },
);

export const verifyLecturerSchema = new mongoose.Schema({
  firstname: String,
  lastname: String,
  department: String,
  phone_number: String,
  school_name: String,
  staff_id: String,
});
export const eventSchema = new mongoose.Schema({
  createdBy: { type: String, required: true }, // ID of the creator
  creatorType: {
    type: String,
    enum: ["student", "lecturer"],
    required: true,
  },
  title: { type: String, required: true },
  description: { type: String },
  courseTitle: { type: String }, //For lectures
  startDate: { type: String },
  endDate: { type: String },
  eventStartTime: { type: String },
  eventEndTime: { type: String },
  eventType: { type: String }, // e.g., "lecture", "Webinar", or 'other'
  lectureType: { type: String }, // e.g., "online", "physical"
  visibility: {
    type: String,
    enum: ["public", "department", "private"],
    required: true,
  },
  restriction: { type: String, default: "none" }, // For public events: "none" or level (e.g., "300")
  department: { type: String },
  isRecurring: { type: Boolean }, //For repeative private events
  recurrenceRule: { type: String }, // Recurrence rule in iCal format
  level: { type: String }, // For departmental or restricted public events
  userId: { type: String }, // For private events
  location: { type: String },
  tags: { type: [String] }, // Array of tags
  createdAt: { type: String, default: () => new Date().toISOString() },
});
export const dealSchema = new mongoose.Schema(
  {
    dealId: { type: String, required: true, unique: true },
    sellerId: { type: String, required: true }, // user.uid of seller
    buyerId: { type: String, required: true }, // user.uid of buyer
    totalPriceInPoints: { type: Number, required: true },
    dealStatus: {
      type: String,
      enum: ["pending", "completed", "cancelled"],
      default: "pending",
    },
    items: [
      {
        productId: { type: String, required: true },
        productTitle: { type: String, required: true },
        priceInPoints: { type: Number, required: true },
      },
    ],
    dealDate: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
const userRecordEntrySchema = new mongoose.Schema({
  type: String,
  status: String,
  message: String,
  refDate: String,
  refTime: String,
});
export const userRecordsSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  records: [userRecordEntrySchema],
});
export const EmailVerificationSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  code: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
});
export const iCampusOperationalInstitutionSchema = new mongoose.Schema({
  schoolName: {
    type: String,
    required: true,
    unique: true,
  },
  contactEmail: {
    type: String,
  },
  schoolCode: {
    type: String,
    required: true,
    unique: true,
  },
  dateJoined: {
    type: String,
    default: () => new Date().toISOString().split("T")[0],
    // YYYY-MM-DD
  },
  timeJoined: {
    type: String,
    default: () => new Date().toLocaleTimeString("en-US", { hour12: false }),
  },
});
export const universitiesAndCollegesSchema = new mongoose.Schema({
  name: String,
  domains: [String],
  web_pages: [String],
  country: String,
  alpha_two_code: String,
  state_province: String,
});

EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });