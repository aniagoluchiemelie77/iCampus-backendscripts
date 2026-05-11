import mongoose from "mongoose";
export const attendanceSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  lectureId: { type: String, required: true },
  courseId: { type: String },
  status: { type: String, enum: ["Present", "Absent"], required: true },
  checkData: [Boolean],
  timestamp: { type: Date, default: Date.now },
  deviceId: { type: String },
});
export const commentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  userId: { type: String, required: true },
  firstName: { type: String, required: true },
  userName: { type: String, required: true },
  profilePic: { type: String },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 },
  replies: [this],
});
export const lectureSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  topicName: { type: String, required: true },
  lectureType: {
    type: String,
    enum: ["Physical", "Online", "Recorded"],
    default: "Physical",
  },
  views: {
    type: Number,
    default: 0,
  },
  viewedBy: [
    {
      userId: String,
      lastViewed: { type: Date, default: Date.now },
    },
  ],
  courseId: String,
  location: String,
  startTime: String,
  endTime: String,
  date: String,
  status: {
    type: String,
    enum: ["scheduled", "ongoing", "completed", "cancelled", "postponed"],
    default: "scheduled",
  },
  isTaught: { type: Boolean, default: false },
  videoUrl: String,
  resources: [String],
  attendance: [attendanceSchema],
  comments: [commentSchema],
  getAttendanceMode: { type: String, enum: ["Uploaded", "Online"] },
});
const assignmentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  fileUrl: { type: String }, // URL to the assignment brief
  dueDate: { type: Date, required: true },
  courseId: { type: String, ref: "Course", required: true },
  lectureId: { type: String },
  submissionMethod: {
    type: String,
    enum: ["Online", "Physical", "Both"],
    default: "Online",
  },
  createdAt: { type: Date, default: Date.now },
  submissions: [
    {
      studentId: { type: String, ref: "User" },
      fileUrl: String,
      submittedAt: { type: Date, default: Date.now },
      isReceived: { type: Boolean, default: false },
    },
  ],
});
export const courseSchema = new mongoose.Schema(
  {
    courseId: { type: String, required: true, unique: true }, // Custom ID (e.g. "CSC201-2026")
    courseCode: { type: String, required: true },
    courseTitle: { type: String, required: true },
    department: { type: String, required: true },
    level: { type: String, required: true },
    schoolName: { type: String, required: true },
    semester: { type: String, required: true },
    session: { type: String, required: true },
    credits: { type: Number, required: true },

    // Arrays
    lecturerIds: [{ type: String, ref: "User" }],
    studentsEnrolled: [{ type: String, ref: "User" }],
    courseContents: [String],
    resources: [String],
    assignments: [assignmentSchema],
    tests: [assessmentSchema],

    // Nested Sub-documents
    Lectures: [lectureSchema],
    // Marketplace / UI Fields
    price: { type: Number, default: 0 },
    thumbnailUrl: String,
    rating: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: false },
    instructorName: String,
    courseDuration: String,
    description: { type: String },
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
const sessionSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  deviceName: String,
  deviceType: String,
  ipAddress: String,
  location: String,
  lastUsed: { type: Date, default: Date.now },
  refreshToken: { type: String, required: true },
});
export const userPreferencesSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    notifications: {
      auth: { type: Boolean, default: true },
      social: { type: Boolean, default: true },
      classroom: { type: Boolean, default: true },
      store: { type: Boolean, default: true },
      finance: { type: Boolean, default: true },
      profile: { type: Boolean, default: true },
      security: { type: Boolean, default: true },
    },
    channels: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      socket: { type: Boolean, default: true },
    },
    theme: {
      type: String,
      enum: ["light", "dark", "system"],
      default: "system",
    },
    language: { type: String, default: "en" },
    quietHours: {
      enabled: { type: Boolean, default: false },
      start: { type: String }, // e.g., "22:00"
      end: { type: String }, // e.g., "07:00"
    },
  },
  { timestamps: true },
);
export const userSchema = new mongoose.Schema({
  headline: { type: String },
  uid: { type: String, index: true, required: true },
  bio: { type: String },
  currentIScore: {
    type: Number,
    default: 5,
  },
  monthlyStats: {
    minutesActive: { type: Number, default: 0 },
    libraryUsageSessions: { type: Number, default: 0 },
    booksFound: { type: Number, default: 0 },
    aiQueries: { type: Number, default: 0 },
    avgReview: { type: Number, default: 0 },
    avgTestScore: { type: Number, default: 0 },
    lastLibraryAccess: { type: Date },
  },
  tier: {
    type: String,
    enum: ["free", "pro", "premium"],
    default: "free",
  },
  itagusername: { type: String, unique: true },
  referralCode: { type: String, unique: true, required: true },
  profilePic: [String],
  likes: [{ type: String }],
  bookmarks: [{ type: String }],
  organizationName: String,
  website: String,
  jobTitle: String,
  schoolCode: String,
  usertype: String,
  isFirstLogin: Boolean,
  username: String,
  firstname: String,
  lastname: String,
  schoolName: String,
  email: { type: String, unique: true },
  coursesEnrolled: [String],
  accessToken: String,
  password: { type: String, default: null },
  providerId: {
    type: String,
    enum: ["google", "github", "password"],
    required: true,
  },
  department: String,
  pointsBalance: {
    type: Number,
    default: 0,
    get: (v) => parseFloat(v.toFixed(2)), // Always return 2 dp
    set: (v) => parseFloat(v.toFixed(2)),
  },
  hasSubscribed: { type: Boolean, default: false },
  blockedUsers: [{ type: String }],
  createdAt: Date,
  country: String,
  current_level: String,
  phone_number: String,
  matricNumber: String,
  staffId: String,
  cart: [
    {
      productId: { type: String, default: null },
      quantity: { type: Number, default: 0 },
      selectedColor: { type: String, default: null },
      selectedSize: { type: String, default: null },
    },
  ],
  favorites: [{ type: String }],
  isVerified: {
    type: Boolean,
    default: false,
  },
  verificationToken: {
    type: String,
    default: null,
  },
  purchaseHistory: [{ type: String }],
  salesHistory: [{ type: String }],
  coursesEnrolled: [{ type: String }],
  coursesTeaching: [{ type: String }],
  userAccountDetails: [
    {
      type: String,
      ref: "UserBankOrCardDetails",
    },
  ],
  completedTests: [{ type: String }],
  iCashPin: { type: String, select: false },
  iCashLockoutUntil: { type: Date, default: null },
  iCashAttempts: { type: Number, default: 0 },
  twoFactorEnabled: { type: Boolean, default: false },
  resetPinOTP: { type: String },
  resetPinOTPExpires: { type: Date },
  isSuspended: { type: Boolean, default: false },
  skills: [{ type: String }],
  recoveryEmails: [
    {
      email: { type: String, required: true },
      isVerified: { type: Boolean, default: false },
      addedAt: { type: Date, default: Date.now },
    },
  ],
  personaInquiryId: { type: String, default: null },
  sessions: [sessionSchema],
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
export const dropOffStation = new mongoose.Schema({
  id: { type: String, required: true, index: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  code: { type: String },
  contactPerson: { type: String },
  agentId: { type: String, required: true },
});
export const productSchema = new mongoose.Schema({
  productId: { type: String, required: true, index: true },
  sellerId: { type: String, required: true },
  schoolName: { type: String },
  amountInStock: { type: Number, default: 1 },
  type: {
    type: String,
    enum: ["physical", "course", "file"],
    required: true,
  },
  category: { type: String },
  title: { type: String, required: true },
  description: { type: String },
  priceInPoints: { type: Number, default: 0 },
  mediaUrls: [{ type: String }],
  physicalDetails: {
    colors: [{ type: String, default: null }],
    sizes: [{ type: String, default: null }],
    inStock: { type: Number, default: 0 },
    weightKg: { type: Number, default: 0 },
    sellerGateways: [
      {
        type: String,
        enum: ["drop_off", "home_delivery"],
      },
    ],
    isNationalShippingAvailable: { type: Boolean, default: false },
    dropOffAddress: [dropOffStation],
  },
  courseDetails: {
    courseId: { type: String, default: null },
    lecturerIds: [{ type: String, default: null }],
    duration: { type: String, default: null },
    totalReviews: { type: Number, default: 0 },
    studentsEnrolledCount: { type: Number, default: 0 },
    studentsEnrolled: [{ type: String, default: null }],
  },
  fileDetails: {
    fileName: { type: String, default: null },
    fileSizeInMB: { type: Number, default: 0 },
    fileFormat: { type: String, default: null },
    fileUrl: { type: String, default: null },
    hasPassword: { type: Boolean, default: false },
  },
  ratings: [
    {
      userId: { type: String, default: null },
      score: { type: Number, default: 0 },
      comment: { type: String, default: null },
    },
  ],
  favCount: { type: Number, default: 0 },
  isAvailable: { type: Boolean, default: true },
  createdAt: { type: String, default: null },
});
export const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, index: true },
  buyerId: { type: String, required: true },
  sellerId: { type: String, required: true },
  productId: { type: String, required: true },
  amountPaid: { type: Number, required: true },
  agentId: { type: String, default: null },
  status: {
    type: String,
    enum: ["pending_delivery", "completed", "cancelled"],
    default: "pending_delivery",
  },
  deliveryMethod: {
    type: String,
    enum: ["drop_off", "home_delivery"],
    default: "drop_off",
  },
  selectedStation: {
    id: String,
    name: String,
    address: String,
    agentId: String,
  },
  verificationQrCode: { type: String, required: true },
  isVerifiedByScan: { type: Boolean, default: true },
  generatedFilePassword: { type: String, default: null },
  createdAt: { type: String, required: true },
  completedAt: { type: String },
});
export const notificationSchema = new mongoose.Schema(
  {
    notificationId: { type: String, required: true },
    recipientId: { type: String, required: true, index: true }, // Who gets it
    senderId: { type: String }, // Who triggered it (optional)
    category: {
      type: String,
      enum: [
        "auth",
        "social",
        "classroom",
        "store",
        "finance",
        "profile",
        "security",
      ],
      required: true,
    },
    currency: {
      type: String,
    },
    actionType: { type: String, required: true }, // e.g., 'TEST_CREATED', 'NEW_FOLLOWER'
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    // Use a flexible object for different IDs based on the category
    relatedEntity: {
      entityId: String, // Could be postId, testId, purchaseId
      entityType: String, // 'Post', 'Test', 'Transaction'
    },
    payload: { type: Object }, // Any extra data (IP address, old vs new time)
  },
  { timestamps: true },
);
export const userDownloadsSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    ownedProducts: [
      {
        productId: String,
      },
    ],
    purchaseHistory: [
      {
        productId: String,
        purchasedAt: { type: Date, default: Date.now },
      },
    ],
    lastAccessed: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
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
export const phoneVerificationSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true, index: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 900 },
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
  logo: { type: String },
  currentiScoreAvg: { type: Number },
  previousiScoreAvg: { type: Number },
});
export const universitiesAndCollegesSchema = new mongoose.Schema({
  name: String,
  domains: [String],
  web_pages: [String],
  country: String,
  alpha_two_code: String,
  state_province: String,
});
export const PostSchema = new mongoose.Schema(
  {
    postId: { type: String, required: true, unique: true },
    userId: {
      uid: { type: String, default: null },
      firstname: { type: String, default: null },
      lastname: { type: String, default: null },
      profilePic: { type: [String], default: null },
      tier: { type: String, default: null },
      organizationName: { type: String, default: null },
      username: { type: String, default: null },
    },
    priorityScore: { type: Number, default: 0 },
    isSubscriptionContent: { type: Boolean, default: false },
    content: { type: String, required: true },
    media: {
      url: [String],
      mediaType: { type: String, enum: ["image", "video"] },
    },
    poll: {
      options: [
        {
          optionId: String,
          text: String,
          votes: [String], // Array of User IDs
        },
      ],
      totalVotes: { type: Number, default: 0 },
      expiresAt: Date,
    },
    // Matching the String type for consistency
    likes: [{ type: String, ref: "User" }],
    bookmarks: [{ type: String, ref: "User" }],
    comments: [
      {
        commentId: { type: String, required: true },
        userId: {
          type: String,
          required: true,
        },
        comment: { type: String, required: true },
        parentId: { type: String, default: null },
        likes: [{ type: String, ref: "User" }],
        createdAt: { type: Date, default: Date.now },
      },
    ],
    impressions: { type: Number, default: 0 },
    shares: [{ type: String, ref: "User" }],
    isRepost: { type: Boolean, default: false },
    originalPostId: { type: String, default: null },
    originalAuthor: { type: String, default: null },
    repostsCount: { type: Number, default: 0 },
    sharesCount: { type: Number, default: 0 },
    postType: {
      type: String,
      enum: ["media", "job", "event", "poll"],
      default: "media",
    },
    jobMetadata: {
      title: String,
      company: String,
      location: String,
      type: {
        type: String,
        enum: ["Full-time", "Part-time", "Internship", "Contract"],
      },
      salaryRange: String,
      applicationLink: String,
    },
    eventMetadata: {
      title: String,
      startDate: Date,
      endDate: Date,
      location: String,
      isVirtual: { type: Boolean, default: false },
      attendees: [{ type: String, ref: "User" }],
    },
  },
  { timestamps: true },
);
export const followSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true },
    followerId: { type: String, ref: "User", index: true }, // The person doing the following
    followingId: { type: String, ref: "User", index: true }, // The person being followed
  },
  { timestamps: true },
);
export const exceptionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    courseId: {
      type: String,
      required: true,
      index: true,
    },
    studentInfo: {
      fullname: { type: String },
      matricNumber: { type: String },
    },
    courseInfo: {
      courseTitle: { type: String },
      courseCode: { type: String },
    },
    lectureId: {
      type: String,
      required: true,
    },
    reasonCategory: {
      type: String,
      enum: [
        "Medical",
        "Family Emergency",
        "Technical Issue",
        "Personal",
        "Other",
      ],
      default: "Personal",
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },

    // Status tracking
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    // Feedback from the lecturer
    lecturerComment: {
      type: String,
      default: "",
    },

    // The date the exception is for (to handle the "3 per month" logic)
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },

    // Proof of claim (optional URL to an image/PDF)
    attachmentUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }, // Automatically creates createdAt and updatedAt
);
const questionSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Frontend-generated ID
  type: {
    type: String,
    enum: ["MCQ", "ShortAnswer", "TrueFalse"],
    required: true,
  },
  questionText: { type: String, required: true },
  options: [{ type: String }], // Array of strings for MCQs
  correctAnswer: { type: String, required: true },
  points: { type: Number, default: 0 },
});
export const assessmentSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true },
    courseId: {
      type: String,
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    duration: { type: Number, required: true }, // Minutes
    totalMarks: { type: Number, required: true },
    questions: [questionSchema], // Array of sub-documents
    isPublished: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["published", "draft"],
      default: "draft",
    },
    scheduledStart: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
  },
);
export const testSubmissionSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: "Test", required: true },
  studentId: { type: String, required: true },
  studentName: String,
  matricNumber: String,
  answers: [
    {
      questionId: String,
      studentAnswer: String,
      isCorrect: Boolean,
      pointsEarned: Number,
      aiScore: Number, // For the semantic check we implemented
    },
  ],
  score: Number,
  totalPossibleScore: Number,
  status: { type: String, default: "submitted" },
  submittedAt: { type: Date, default: Date.now },
  proctoringData: {
    deviceId: String,
    entrySelfieUrl: String,
    tabSwitchCount: Number,
    ipAddress: String,
  },
  startTime: Date,
});
export const reviewSchema = new mongoose.Schema({
  reviewType: {
    type: String,
    enum: ["Lectures", "Transactions", "General"],
    default: "General",
  },
  lectureId: { type: String, ref: "Lecture", required: true, unique: true },
  studentId: { type: String },
  lecturerId: { type: String },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: String,
  createdAt: { type: Date, default: Date.now },
});
export const transactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  type: {
    type: String,
    enum: [
      "buy",
      "withdraw",
      "p2p_sent",
      "p2p_received",
      "payment",
      "exceptionsDividend",
      "icash_pin_reset",
    ],
  },
  amountICash: Number,
  amountLocal: Number,
  status: { type: String, enum: ["pending", "success", "failed"] },
  payType: { type: String, enum: ["in", "out"] },
  title: { type: String },
  reference: { type: String, unique: true },
  metadata: {
    recipientId: { type: String },
    bankName: String,
  },
  createdAt: { type: Date, default: Date.now },
});
export const paymentMethodSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  method: { type: String, enum: ["card", "bank"], required: true },
  paymentToken: { type: String, required: true },
  lastFourDigits: { type: String },
  cardBrand: { type: String },
  bankName: { type: String },
  bankAccNumber: { type: String },
  bankCode: { type: String },
  accountHolderName: { type: String },
  country: { type: String },
  isDefault: { type: Boolean, default: false },
  expiryMonth: { type: String },
  expiryYear: { type: String },
  billingAddressDetails: {
    state: String,
    city: String,
    street: String,
    zip: String,
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
export const iTagSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    cardHolderName: {
      type: String,
      required: true,
      uppercase: true,
    },
    cardNumber: {
      type: String,
      required: true,
    },
    expiryDate: {
      type: String,
    },
    layoutType: {
      type: Number,
      enum: [1, 2, 3],
      default: 1,
    },
    tier: {
      type: String,
      enum: ["pro", "premium", "free"],
      default: "free",
    },
    designOptions: {
      backgroundColor: {
        type: String,
        default: "#ffffff",
      },
      backgroundImage: {
        type: String,
        default: null,
      },
      glassmorphismOpacity: {
        type: Number,
        default: 0.2,
        min: 0,
        max: 1,
      },
    },
  },
  { timestamps: true },
);
export const floatSchema = new mongoose.Schema({
  totalCirculation: Number,
  actualBankBalance: Number,
  accruedInterest: Number,
  lastUpdated: { type: Date, default: Date.now },
});
export const messageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  senderId: { type: String, required: true },
  recipientId: { type: String, required: true },
  text: String,
  attachments: [
    {
      url: String,
      fileType: String,
      fileName: String,
    },
  ],
  status: {
    type: String,
    enum: ["sent", "delivered", "seen"],
    default: "sent",
  },
  timestamp: { type: Date, default: Date.now },
});
export const deletedUserSchema = new mongoose.Schema({
  uid: { type: String, required: true },
  reason: { type: String },
  accountAgeDays: { type: Number },
  tierAtDeletion: { type: String },
  finalBalance: { type: Number },
  deletedAt: { type: Date, default: Date.now },
  schoolName: String,
  department: String,
});
// Ensure a lecturer doesn't accidentally post the same test title twice in one course
assessmentSchema.index({ courseId: 1, title: 1 });
userDownloadsSchema.index({ userId: 1 });

// Indexing for faster lookups when checking monthly limits
exceptionSchema.index({ studentId: 1, date: -1 });
EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Add this to the end of your PostSchema file
PostSchema.index({ userId: 1, createdAt: -1 });
attendanceSchema.index({ studentId: 1, lectureId: 1 }, { unique: true });
