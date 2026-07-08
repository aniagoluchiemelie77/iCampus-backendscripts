import mongoose from "mongoose";

const reposterSchema = new mongoose.Schema({
  uid: { type: String, required: true },
  firstname: { type: String, default: null },
  lastname: { type: String, default: null },
  username: { type: String, default: null },
  tier: { type: String, required: true },
  organizationName: { type: String, default: null },
  profilePic: [String],
  repostedAt: { type: Date, default: Date.now },
});

export const attendanceSchema = new mongoose.Schema({
  studentId: { type: String, required: true },
  lectureId: { type: String, required: true },
  courseId: { type: String },
  status: { type: String, enum: ["Present", "Absent"], required: true },
  checkData: [Boolean],
  timestamp: { type: Date, default: Date.now },
  deviceId: { type: String },
});
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
export const commentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  profilePic: { type: String },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 },
});
export const lectureSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  topicName: { type: String, required: true },
  lectureType: {
    type: String,
    enum: ["Physical", "Online"],
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
  courseId: { type: String, default: null },
  location: String,
  startTime: String,
  endTime: String,
  date: String,
  hostId: String,
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
  department: { type: String, default: null },
  level: { type: String, default: null },
  isLive: { type: Boolean, default: false },
  liveStreamUrl: { type: String, default: null },
  startedAt: { type: Date, default: null },
  attendanceOpen: { type: Boolean, default: false },
});
const assignmentSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  title: { type: String, required: true },
  description: { type: String },
  fileUrl: { type: String },
  dueDate: { type: Date, required: true },
  courseId: { type: String, ref: "Course", required: true },
  lectureId: { type: String },
  submissionInfo: { type: String, default: "Submit to your course rep" },
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
    courseId: { type: String, required: true, unique: true },
    courseCode: { type: String },
    courseTitle: { type: String, required: true },
    department: { type: String },
    level: { type: String },
    schoolName: { type: String, required: true },
    semester: { type: String },
    session: { type: String },
    credits: { type: Number },

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
      default: "light",
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
export const payoutSchema = new mongoose.Schema(
  {
    payoutId: {
      type: String,
      required: true,
      index: true,
    },
    sellerUid: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, "Minimum payout is 1.00"],
    },
    status: {
      type: String,
      enum: ["processing", "completed", "failed", "cancelled"],
      default: "processing",
    },
    method: {
      type: String,
      required: true,
    },
    reference: {
      type: String,
      unique: true,
    },
    processedAt: { type: Date },
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
  usertype: {
    type: String,
    enum: ["student", "lecturer", "otherUser", "enterprise"],
    default: null,
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
    get: (v) => parseFloat(v.toFixed(2)),
    set: (v) => parseFloat(v.toFixed(2)),
  },
  pendingSalesBalance: {
    type: Number,
    default: 0,
    get: (v) => parseFloat(v.toFixed(2)),
    set: (v) => parseFloat(v.toFixed(2)),
  },
  hasSubscribed: { type: Boolean, default: false },
  blockedUsers: [{ type: String }],
  createdAt: Date,
  country: String,
  current_level: String,
  schoolAvatarUrl: String,
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
  suspiciousActivity: [
    {
      type: {
        type: String,
        enum: [
          "UNRECOGNIZED_LOCATION",
          "HEAVY_TRANSFER",
          "HEAVY_WITHDRAWAL_ATTEMPT",
          "SESSION_REVOKED",
          "PIN_RESET_WHILE_SUSPICIOUS",
          "FAILED_PIN_ATTEMPT",
        ],
      },
      timestamp: { type: Date, default: Date.now },
    },
  ],
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
export const adminSchema = new mongoose.Schema({
  uid: { type: String, index: true, required: true, unique: true },
  firstname: { type: String, required: true },
  lastname: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  adminType: {
    type: String,
    enum: ["super_admin", "moderator", "support", "finance", "analyst"],
    required: true,
  },
  profilePic: [String],
  providerId: { type: String, enum: ["password"], default: "password" },
  country: String,
  isVerified: { type: Boolean, required: true, default: true },
  lastAccessed: { type: Date, default: Date.now },
  sessions: [sessionSchema],
  createdAt: { type: Date, default: Date.now },
});
export const dropOffStation = new mongoose.Schema({
  id: { type: String, required: true, index: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  code: { type: String },
  contactPerson: { type: String },
  images: [{ type: String }],
  agentId: { type: String, required: true },
  latitude: { type: Number },
  longitude: { type: Number },
  createdAt: { type: Date, required: true },
});
export const impressionLogSchema = new mongoose.Schema({
  userId: String,
  productId: String,
  monthYear: String,
});
export const productSchema = new mongoose.Schema({
  productId: { type: String, required: true, index: true },
  sellerId: { type: String, required: true },
  schoolName: { type: String },
  amountInStock: { type: Number, default: 1 },
  impressions: { type: Number, default: 1 },
  sales: { type: Number, default: 0 },
  niche: {
    type: String,
    enum: [
      "Electronics",
      "Courses",
      "Documents",
      "Fashion",
      "Stationery",
      "Snacks and Deserts",
      "Food",
    ],
    required: true,
  },
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
    studentsEnrolled: [{ type: String, default: null }],
    totalLessons: { type: Number, default: 0 },
    content: [
      {
        title: { type: String, default: null },
        videoUrl: { type: String, default: null },
        duration: { type: Number, default: 0 },
        isFreePreview: { type: Boolean, default: false },
      },
    ],
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
  createdAt: { type: Date, default: null },
});
export const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, index: true },
  buyerId: { type: String, required: true },
  sellerId: { type: String, required: true },
  productId: { type: String, required: true },
  amountPaid: { type: Number, required: true },
  quantity: { type: Number, required: true },
  agentId: { type: String, default: null },
  status: {
    type: String,
    enum: ["pending_delivery", "completed", "cancelled", "dropped_off"],
    default: "pending_delivery",
  },
  cancellationReason: { type: String, default: null },
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
  fileUrl: { type: String, default: null },
  createdAt: { type: Date, required: true },
  completedAt: { type: Date },
});
export const productSalesSchema = new mongoose.Schema({
  sellerId: { type: String, required: true, index: true },
  productId: { type: String, required: true },
  orderId: { type: String, default: null },
  productType: { type: String, enum: ["physical", "file", "course"] },
  quantity: { type: Number, default: 1 },
  amountPaid: { type: Number, required: true },
  netEarnings: { type: Number, required: true },
  buyerId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
export const reviewSchema = new mongoose.Schema({
  reviewerId: { type: String, required: true },
  targetId: { type: String, required: true },
  targetType: {
    type: String,
    required: true,
    enum: ["product", "seller", "agent", "course", "lecturer"],
  },
  orderId: { type: String },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  mediaUrls: [String],
  attributes: {
    deliverySpeed: Number,
    accuracy: Number,
    clarity: Number,
  },
  createdAt: { type: Date, default: Date.now },
});
export const notificationSchema = new mongoose.Schema(
  {
    notificationId: { type: String, required: true },
    recipientId: { type: String, required: true, index: true },
    recipientEmail: { type: String },
    senderId: { type: String },
    category: {
      type: String,
      enum: [
        "auth",
        "social",
        "system",
        "classroom",
        "store",
        "finance",
        "profile",
        "security",
        "reminder",
        "signup",
        "subscription",
      ],
      required: true,
    },
    currency: {
      type: String,
    },
    actionType: { type: String },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    relatedEntity: {
      entityId: String,
      entityType: String,
    },
    payload: { type: Object },
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
        progress: {
          type: Number,
          default: 0,
          min: 0,
          max: 100,
        },
        completedLessons: [String],
        lastWatched: { type: Date, default: Date.now },
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
  createdBy: { type: String, required: true },
  creatorType: {
    type: String,
    enum: ["student", "lecturer"],
    required: true,
  },
  title: { type: String, required: true },
  description: { type: String },
  courseTitle: { type: String },
  startDate: { type: String },
  endDate: { type: String },
  eventStartTime: { type: String },
  eventEndTime: { type: String },
  eventType: { type: String },
  lectureType: { type: String },
  visibility: {
    type: String,
    enum: ["public", "department", "private"],
    required: true,
  },
  restriction: { type: String, default: "none" },
  department: { type: String },
  isRecurring: { type: Boolean },
  recurrenceRule: { type: String },
  level: { type: String },
  userId: { type: String },
  location: { type: String },
  tags: { type: [String] },
  createdAt: { type: Date, default: () => new Date().toISOString() },
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
  id: { type: String, required: true, unique: true },
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
  createdAt: { type: Date, default: () => new Date() },
});
export const postSchema = new mongoose.Schema(
  {
    postId: { type: String, required: true, unique: true },
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
          votes: [String],
        },
      ],
      totalVotes: { type: Number, default: 0 },
      expiresAt: Date,
    },
    likes: [{ type: String }],
    bookmarks: [{ type: String }],
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
    repostersDetails: [reposterSchema],
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
    followerId: { type: String, ref: "User", index: true },
    followingId: { type: String, ref: "User", index: true },
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
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    lecturerComment: {
      type: String,
      default: "",
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    attachmentUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);
export const testSubmissionSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  testId: { type: String, required: true },
  studentId: { type: String, required: true },
  studentName: String,
  matricNumber: String,
  answers: [
    {
      questionId: String,
      studentAnswer: String,
      isCorrect: Boolean,
      pointsEarned: Number,
      aiScore: Number,
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
  },
  startTime: Date,
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
      "refund",
    ],
  },
  amountICash: Number,
  amountLocal: Number,
  status: { type: String, enum: ["pending", "success", "failed"] },
  payType: { type: String, enum: ["in", "out"] },
  title: { type: String },
  reference: { type: String, unique: true },
  metadata: {
    recipientId: { type: String, default: null },
    note: { type: String, default: null },
    senderItag: { type: String, default: null },
    recipientItag: { type: String, default: null },
    senderId: { type: String, default: null },
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
export const certificateSchema = new mongoose.Schema({
  certificateId: { type: String, required: true, unique: true },
  uid: { type: String, required: true, index: true },
  productId: { type: String, required: true },
  studentName: String,
  courseTitle: String,
  pdfUrl: String,
  issuedAt: { type: Date, default: Date.now },
});
export const statementSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  pdfUrl: { type: String, required: true },
  income: Number,
  expense: Number,
  generatedAt: { type: Date, default: Date.now },
});
export const schoolConfigurationSchema = new mongoose.Schema(
  {
    schoolId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    countryCode: {
      type: String,
      required: true,
      uppercase: true,
      maxLength: 2,
    },
    domainWhitelist: {
      type: [String],
      default: [],
    },
    isOperational: {
      type: Boolean,
      default: false,
    },
    verificationMethod: {
      type: String,
      required: true,
      enum: ["SSO", "EXTERNAL_API", "SEEDED_DATABASE", "EMAIL_ONLY"],
      default: "EMAIL_ONLY",
    },
    externalApiConfig: {
      endpoint: { type: String, trim: true },
      sharedSecret: { type: String },
      timeoutMs: { type: Number, default: 5000 },
    },
    ssoConfig: {
      provider: { type: String, enum: ["OIDC", "SAML"] },
      issuerUrl: { type: String, trim: true },
      clientId: { type: String },
      clientSecret: { type: String },
    },
  },
  {
    timestamps: true,
  },
);
export const supportTicketSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    ticketRefId: { type: String, unique: true, index: true },
    source: { type: String, enum: ["in-app", "email"], default: "in-app" },
    originalMessage: String,
    category: {
      type: String,
      enum: ["technical", "billing", "content", "other"],
    },
    summary: String,
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["open", "pending", "resolved", "closed"],
      default: "open",
    },
    thread: [
      {
        sender: String,
        message: String,
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);
export const controllerLogSchema = new mongoose.Schema({
  controllerName: { type: String, required: true, index: true },
  action: { type: String, required: true },
  status: { type: String, enum: ["success", "error"], required: true },
  cause: String,
  latency: Number,
  timestamp: { type: Date, default: Date.now, expires: "30d" },
});

supportTicketSchema.index({ category: 1, status: 1 });
userSchema.index(
  { matricNumber: 1, department: 1 },
  { unique: true, partialFilterExpression: { usertype: "student" } },
);
userSchema.index(
  { staff_id: 1, department: 1 },
  { unique: true, partialFilterExpression: { usertype: "lecturer" } },
);

assessmentSchema.index({ courseId: 1, title: 1 });
commentSchema.add({
  replies: [commentSchema],
});
impressionLogSchema.index(
  { userId: 1, productId: 1, monthYear: 1 },
  { unique: true },
);

exceptionSchema.index({ studentId: 1, date: -1 });
EmailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
attendanceSchema.index({ studentId: 1, lectureId: 1 }, { unique: true });
postSchema.index(
  {
    content: "text",
    "comments.comment": "text",
    "jobMetadata.title": "text",
    "jobMetadata.company": "text",
    "eventMetadata.title": "text",
    createdAt: -1,
  },
  {
    weights: {
      "jobMetadata.title": 5,
      "eventMetadata.title": 5,
      content: 3,
      "comments.comment": 1,
    },
    name: "icampus_post_text_search_index",
  },
);