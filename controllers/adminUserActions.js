// User lookup for every admin role: search (by name, username, ID number or
// uid) and a profile with the user's activity. What each role gets is decided
// here, on the server:
//
//   super_admin, support   full profile (minus secrets), every activity feed,
//                          edit (PATCH /admins/edit-users/:uid) and delete
//   school_admin_a         only users of their own school: academic profile
//                          and class/course activity, read-only
//   school_admin_b         as A, but only their own department
//   finance                read-only profile + store orders and transactions
//   moderator, analyst,    read-only profile + posts
//   social_media
//
// School reps get a 404 for anyone outside their scope, so the endpoint
// can't be used to find out whether a uid exists elsewhere.
import {
  Attendance,
  Course,
  Lectures,
  Notification,
  Posts,
  Product,
  ProductOrder,
  SupportTicket,
  TestSubmission,
  Transactions,
  User,
  UserSessions,
  Assessment,
} from "../tableDeclarations.js";
import { isSchoolAdmin, isSchoolAdminB, resolveSchoolScope } from "../utils/schoolRoles.js";
import { resolveLectureTime, toDate } from "../utils/lectureTime.js";
import { loadMembers, recordSchoolAudit } from "./schoolAdminActions.js";
import { purgeUserAccount } from "./userActionsController.js";
import { recordAdminActivity } from "../utils/adminActivity.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { generateNotificationId } from "../utils/idGenerator.js";

const FULL_ACCESS = ["super_admin", "support"];
const roleOf = (admin) => (admin?.adminType === "school_administrator" ? "school_admin_a" : admin?.adminType || "");
const canManage = (admin) => FULL_ACCESS.includes(roleOf(admin));

/** Activity feeds each role may read. */
const SECTION_ACCESS = {
  academics: ["super_admin", "support", "school_admin_a", "school_admin_b", "moderator", "analyst", "finance", "social_media"],
  posts: ["super_admin", "support", "moderator", "analyst", "social_media"],
  store: ["super_admin", "support", "finance"],
  transactions: ["super_admin", "support", "finance"],
  tickets: ["super_admin", "support"],
  security: ["super_admin", "support"],
  notifications: ["super_admin", "support"],
};
const sectionsFor = (admin) =>
  Object.entries(SECTION_ACCESS)
    .filter(([, roles]) => roles.includes(roleOf(admin)))
    .map(([name]) => name);

// Never sent to any admin.
const SECRET_FIELDS = new Set([
  "password", "iCashPin", "resetPinOTP", "verificationToken", "sessions", "refreshToken",
  "accessToken", "pushTokens", "fcmToken", "expoPushToken", "twoFactorSecret", "otp",
]);
const isSecret = (key) => SECRET_FIELDS.has(key) || /(token|secret|otp|pin|hash)$/i.test(key);

const iso = (value) => toDate(value)?.toISOString() || null;
const listOf = (value) => (Array.isArray(value) ? value : []);
const norm = (value) => String(value || "").trim().toLowerCase();
const personName = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(" ").trim() || u?.username || "Unknown";
const pctOf = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

const chunked = async (collection, field, values) => {
  const unique = [...new Set(values.filter(Boolean))];
  const results = [];
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await collection.where(field, "in", unique.slice(i, i + 30)).get();
    snap.docs.forEach((d) => results.push({ id: d.id, ...d.data() }));
  }
  return results;
};

/**
 * Newest `n` documents of a query. Falls back to sorting in memory when the
 * composite index for `orderBy(createdAt)` doesn't exist.
 */
const recent = async (query, n, field = "createdAt") => {
  try {
    const snap = await query.orderBy(field, "desc").limit(n).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    if (err?.code !== 9 && !/index/i.test(String(err?.message))) throw err;
    const snap = await query.limit(500).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b[field])?.getTime() || 0) - (toDate(a[field])?.getTime() || 0))
      .slice(0, n);
  }
};
const countOf = async (query) => {
  try {
    return (await query.count().get()).data().count;
  } catch {
    return null;
  }
};

/** School reps: the school and (for B) department they may see; null for staff. */
const schoolScopeOf = (admin) => {
  if (!isSchoolAdmin(admin?.adminType)) return null;
  return resolveSchoolScope(admin, {});
};
const inSchoolScope = (scope, user) =>
  !!scope?.schoolCode &&
  user?.schoolCode === scope.schoolCode &&
  (!scope.department || norm(user.department || "General") === norm(scope.department));

/**
 * Department reps may also open someone from another department who teaches
 * or takes one of their department's courses (what they see is still limited
 * to that department's courses).
 */
const linkedToScopedCourse = async (scope, user) => {
  if (!scope?.department || user?.schoolCode !== scope.schoolCode) return false;
  const field = user.usertype === "lecturer" ? "lecturerIds" : "studentsEnrolled";
  const snap = await Course.where(field, "array-contains", user.uid).get();
  return snap.docs.some((d) => {
    const c = d.data();
    return c.schoolCode === scope.schoolCode && norm(c.department || "General") === norm(scope.department);
  });
};

const loadUser = async (uid) => {
  const id = String(uid || "").trim();
  if (!id) return null;
  const byField = await User.where("uid", "==", id).limit(1).get();
  if (!byField.empty) return { id: byField.docs[0].id, ...byField.docs[0].data() };
  const doc = await User.doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

/** The row shown in search results. School reps get no contact details. */
const searchRow = (u, { school }) => ({
  uid: u.uid,
  firstname: u.firstname || "",
  lastname: u.lastname || "",
  username: u.username || "",
  usertype: u.usertype || null,
  tier: u.tier || null,
  isVerified: !!u.isVerified,
  isSuspended: !!u.isSuspended,
  profilePic: u.profilePic || [],
  organizationName: u.organizationName || "",
  department: u.department || null,
  idNumber: (u.usertype === "lecturer" ? u.staffId : u.matricNumber) || null,
  ...(school ? {} : { email: u.email || null, schoolName: u.schoolName || null }),
});

// ---------------------------------------------------------------------------
// GET /admins/users/search?q=
// ---------------------------------------------------------------------------

const STAFF_SEARCH_FIELDS = [
  "uid", "firstname", "lastname", "username", "usertype", "tier", "isVerified", "isSuspended",
  "profilePic", "organizationName", "department", "matricNumber", "staffId", "email", "schoolName",
  "itagusername", "schoolCode",
];
const MAX_RESULTS = 25;

export const searchUsersForAdmin = async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Type at least 2 characters." });
  const scope = schoolScopeOf(req.admin);
  if (scope && !scope.schoolCode) return res.status(400).json({ error: "Your admin account is not linked to a school." });
  if (scope?.locked && !scope.department) return res.status(400).json({ error: "Your account has no department yet." });
  const term = q.toLowerCase();

  try {
    // An exact uid always comes first.
    const exact = await loadUser(q);
    const exactAllowed = exact && (!scope || inSchoolScope(scope, exact)) ? exact : null;

    let pool;
    if (scope) {
      // School reps only ever search their own school's (cached) member list.
      pool = (await loadMembers(scope.schoolCode)).filter((u) => inSchoolScope(scope, { ...u, schoolCode: scope.schoolCode }));
    } else {
      pool = (await User.select(...STAFF_SEARCH_FIELDS).get()).docs.map((d) => d.data());
    }
    const fields = scope
      ? (u) => [u.firstname, u.lastname, personName(u), u.username, u.uid, u.matricNumber, u.staffId]
      : (u) => [
          u.firstname, u.lastname, personName(u), u.username, u.uid, u.email, u.matricNumber,
          u.staffId, u.itagusername, u.organizationName, u.schoolCode,
        ];
    const rank = (u) => {
      const values = fields(u).map((v) => String(v || "").toLowerCase());
      if (values.some((v) => v === term)) return 0;
      if (values.some((v) => v.startsWith(term))) return 1;
      return values.some((v) => v.includes(term)) ? 2 : -1;
    };
    const matches = pool
      .map((u) => ({ u, r: rank(u) }))
      .filter((m) => m.r >= 0 && m.u.uid !== exactAllowed?.uid)
      .sort((a, b) => a.r - b.r || personName(a.u).localeCompare(personName(b.u)));

    const users = [...(exactAllowed ? [exactAllowed] : []), ...matches.map((m) => m.u)].slice(0, MAX_RESULTS);
    res.json({
      results: users.map((u) => searchRow(u, { school: !!scope })),
      total: (exactAllowed ? 1 : 0) + matches.length,
      exactUid: exactAllowed?.uid || null,
    });
    if (scope) recordSchoolAudit(req, "user_search", { q, department: scope.department });
  } catch (err) {
    console.error("searchUsersForAdmin Error:", err);
    res.status(500).json({ error: "Search failed." });
  }
};

// ---------------------------------------------------------------------------
// GET /admins/users/:uid/profile
// ---------------------------------------------------------------------------

/** Profile fields by access level. */
const profileFor = (u, admin) => {
  const base = {
    uid: u.uid,
    firstname: u.firstname || "",
    lastname: u.lastname || "",
    username: u.username || "",
    usertype: u.usertype || null,
    profilePic: u.profilePic || [],
    department: u.department || null,
    current_level: u.usertype === "student" ? u.current_level || null : null,
    matricNumber: u.usertype === "student" ? u.matricNumber || null : null,
    staffId: u.usertype === "lecturer" ? u.staffId || null : null,
    schoolName: u.schoolName || null,
    isVerified: !!u.isVerified,
    isSuspended: !!u.isSuspended,
    createdAt: iso(u.createdAt),
  };
  // School reps: what a school needs to identify and support its members.
  if (isSchoolAdmin(admin?.adminType)) return base;
  const staff = {
    ...base,
    email: u.email || null,
    tier: u.tier || null,
    country: u.country || null,
    headline: u.headline || null,
    bio: u.bio || null,
    website: u.website || null,
    organizationName: u.organizationName || null,
    schoolCode: u.schoolCode || null,
    itagusername: u.itagusername || null,
    lastActiveAt: iso(u.lastActive || u.lastSeen || u.lastLogin),
    updatedAt: iso(u.updatedAt),
  };
  if (!canManage(admin)) return staff;
  // Support and super admins: the whole record except secrets, so the edit
  // sheet has every field it knows about.
  const full = {};
  Object.entries(u).forEach(([key, value]) => {
    if (!isSecret(key)) full[key] = value;
  });
  return { ...full, ...staff, current_level: u.current_level || null, matricNumber: u.matricNumber || null, staffId: u.staffId || null };
};

/**
 * Courses, attendance, test results and lectures. `department` (B reps)
 * limits it to that department's courses.
 */
const loadAcademics = async (u, { department = null } = {}) => {
  const isLecturer = u.usertype === "lecturer";
  const coursesSnap = await Course.where(isLecturer ? "lecturerIds" : "studentsEnrolled", "array-contains", u.uid).get();
  const courses = coursesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => !department || norm(c.department || "General") === norm(department));
  const courseIds = courses.map((c) => c.courseId || c.id);
  const courseById = new Map(courses.map((c) => [c.courseId || c.id, c]));
  const nowMs = Date.now();
  const startOf = (l) => resolveLectureTime(l, "start");
  const isHeld = (l) =>
    l.status !== "cancelled" && (l.status === "completed" || l.isTaught || (startOf(l)?.getTime() ?? Infinity) <= nowMs);

  const lectures = await chunked(Lectures, "courseId", courseIds);
  const heldByCourse = new Map();
  lectures.filter(isHeld).forEach((l) => heldByCourse.set(l.courseId, (heldByCourse.get(l.courseId) || 0) + 1));
  const lectureById = new Map(lectures.map((l) => [l.id, l]));

  const courseRow = (c, extra = {}) => ({
    courseId: c.courseId || c.id,
    courseCode: c.courseCode || "",
    courseTitle: c.courseTitle || "",
    department: c.department || "General",
    level: c.level || null,
    semester: c.semester || null,
    session: c.session || null,
    enrolled: listOf(c.studentsEnrolled).length,
    lecturesHeld: heldByCourse.get(c.courseId || c.id) || 0,
    ...extra,
  });

  if (isLecturer) {
    const hosted = lectures.filter((l) => l.hostId === u.uid);
    const rows = hosted
      .map((l) => ({
        kind: l.status === "cancelled" ? "lecture_cancelled" : isHeld(l) ? "lecture_held" : "lecture_scheduled",
        title: l.topicName || "Lecture",
        course: courseById.get(l.courseId)?.courseCode || "",
        detail: l.lectureType || "Physical",
        at: startOf(l)?.toISOString() || null,
      }))
      .filter((e) => e.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return {
      role: "lecturer",
      courses: courses.map((c) => courseRow(c, { hostedByUser: hosted.filter((l) => l.courseId === (c.courseId || c.id) && isHeld(l)).length })),
      summary: {
        courses: courses.length,
        lecturesHeld: hosted.filter(isHeld).length,
        lecturesScheduled: hosted.filter((l) => !isHeld(l) && l.status !== "cancelled").length,
        lecturesCancelled: hosted.filter((l) => l.status === "cancelled").length,
      },
      timeline: rows.slice(0, 40),
    };
  }

  const [attendanceSnap, submissionsSnap] = await Promise.all([
    Attendance.where("studentId", "==", u.uid).get(),
    TestSubmission.where("studentId", "==", u.uid).get(),
  ]);
  const inCourses = (courseId) => !department || courseById.has(courseId);
  const attendance = attendanceSnap.docs.map((d) => d.data()).filter((a) => inCourses(a.courseId));
  const presentByCourse = new Map();
  attendance
    .filter((a) => a.status === "Present")
    .forEach((a) => presentByCourse.set(a.courseId, (presentByCourse.get(a.courseId) || 0) + 1));

  const submissionsAll = submissionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const tests = await chunked(Assessment, "id", submissionsAll.map((s) => s.testId));
  const testById = new Map(tests.map((t) => [t.id, t]));
  const submissions = submissionsAll.filter((s) => inCourses(testById.get(s.testId)?.courseId));
  const scoreOf = (s) => pctOf(Number(s.score) || 0, Number(testById.get(s.testId)?.totalMarks) || Number(s.totalPossibleScore) || 0);
  const scores = submissions.map(scoreOf).filter((v) => v !== null);

  const timeline = [
    ...attendance.map((a) => {
      const lecture = lectureById.get(a.lectureId);
      return {
        kind: a.status === "Present" ? "checked_in" : "absent",
        title: lecture?.topicName || "Lecture",
        course: courseById.get(a.courseId)?.courseCode || "",
        detail: a.mode === "online" ? "Online" : "Physical",
        at: iso(a.timestamp || a.updatedAt) || startOf(lecture || {})?.toISOString() || null,
      };
    }),
    ...submissions.map((s) => {
      const test = testById.get(s.testId);
      const pct = scoreOf(s);
      return {
        kind: s.isFlagged ? "test_flagged" : "test_submitted",
        title: test?.title || "Assessment",
        course: courseById.get(test?.courseId)?.courseCode || "",
        detail: pct === null ? "Submitted" : `Scored ${pct}%`,
        at: iso(s.submittedAt),
      };
    }),
  ]
    .filter((e) => e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const totalHeld = courses.reduce((sum, c) => sum + (heldByCourse.get(c.courseId || c.id) || 0), 0);
  const totalPresent = [...presentByCourse.values()].reduce((a, b) => a + b, 0);
  return {
    role: "student",
    courses: courses.map((c) => {
      const id = c.courseId || c.id;
      const courseScores = submissions.filter((s) => testById.get(s.testId)?.courseId === id).map(scoreOf).filter((v) => v !== null);
      return courseRow(c, {
        lecturesAttended: presentByCourse.get(id) || 0,
        attendancePct: pctOf(presentByCourse.get(id) || 0, heldByCourse.get(id) || 0),
        averageScorePct: courseScores.length ? Math.round((courseScores.reduce((a, b) => a + b, 0) / courseScores.length) * 10) / 10 : null,
      });
    }),
    summary: {
      courses: courses.length,
      attendancePct: pctOf(totalPresent, totalHeld),
      lecturesAttended: totalPresent,
      testsTaken: submissions.length,
      averageScorePct: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      flaggedSubmissions: submissions.filter((s) => s.isFlagged).length,
    },
    timeline: timeline.slice(0, 40),
  };
};

const FEED = 20;

const loadPosts = async (uid) => {
  const [rows, total] = await Promise.all([recent(Posts.where("originalAuthor", "==", uid), FEED), countOf(Posts.where("originalAuthor", "==", uid))]);
  return {
    total,
    items: rows.map((p) => ({
      postId: p.postId || p.id,
      content: String(p.content || "").slice(0, 280),
      status: p.status || "visible",
      createdAt: iso(p.createdAt),
      likes: listOf(p.likes).length,
      comments: Number(p.commentsCount) || 0,
      impressions: Number(p.impressions) || 0,
      media: listOf(p.media?.url).length || (p.media?.url ? 1 : 0),
    })),
  };
};

// Order rows leave out the delivery QR secret and shipping contact.
const orderRow = (o, side) => ({
  orderId: o.orderId || o.id,
  side,
  productName: o.productName || "Product",
  quantity: Number(o.quantity) || 1,
  status: o.status || null,
  amount: Number(side === "seller" ? o.sellerAmount ?? o.amountPaid : o.amountPaid) || 0,
  currency: (side === "seller" ? o.sellerCurrency : o.amountPaidCurrencyCode) || "NGN",
  deliveryMethod: o.deliveryMethod || null,
  createdAt: iso(o.createdAt),
});
const loadStore = async (uid) => {
  const [bought, sold, products] = await Promise.all([
    recent(ProductOrder.where("buyerId", "==", uid), FEED),
    recent(ProductOrder.where("sellerId", "==", uid), FEED),
    Product.where("sellerId", "==", uid).limit(50).get(),
  ]);
  return {
    orders: [...bought.map((o) => orderRow(o, "buyer")), ...sold.map((o) => orderRow(o, "seller"))]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, FEED),
    products: products.docs.map((d) => {
      const p = d.data();
      return {
        productId: p.productId || d.id,
        title: p.title || "Product",
        price: Number(p.price) || 0,
        currency: p.currency || "NGN",
        inStock: Number(p.amountInStock) || 0,
        sales: Number(p.sales) || 0,
      };
    }),
  };
};

const loadTransactions = async (uid) =>
  (await recent(Transactions.where("userId", "==", uid), FEED)).map((t) => ({
    transactionId: t.transactionId || t.id,
    type: t.type || null,
    title: t.title || null,
    amount: Number(t.amount) || 0,
    currency: t.currency || "NGN",
    status: t.status || null,
    reference: t.reference || null,
    createdAt: iso(t.createdAt || t.date),
  }));

const loadTickets = async (uid) =>
  (await recent(SupportTicket.where("userId", "==", uid), FEED)).map((t) => ({
    ticketRefId: t.ticketRefId || t.id,
    subject: t.subject || t.title || t.category || "Support ticket",
    category: t.category || null,
    status: t.status || null,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
  }));

const loadSecurity = async (u) => {
  const sessions = (await recent(UserSessions.where("userId", "==", u.uid), FEED, "lastUsed")).map((s) => ({
    deviceName: s.deviceName || s.deviceId || "Unknown device",
    location: typeof s.location === "string" ? s.location : s.location?.city || s.location?.country || null,
    ipAddress: s.ipAddress || null,
    lastUsed: iso(s.lastUsed || s.updatedAt),
  }));
  return {
    twoFactorEnabled: !!u.twoFactorEnabled,
    sessions,
    suspiciousActivity: listOf(u.suspiciousActivity).map((a) => ({ type: a?.type || "activity", at: iso(a?.timestamp), detail: a?.details || a?.reason || null })),
    recoveryEmails: listOf(u.recoveryEmails).map((e) => ({ email: e?.email, isVerified: !!e?.isVerified })),
    phoneNumbers: listOf(u.phoneNumbers).map((p) => ({ number: p?.number, isVerified: !!p?.isVerified })),
  };
};

const loadNotifications = async (uid) =>
  (await recent(Notification.where("recipientId", "==", uid), FEED)).map((n) => ({
    id: n.notificationId || n.id,
    title: n.title || null,
    message: String(n.message || "").slice(0, 200),
    category: n.category || null,
    isRead: !!n.isRead,
    createdAt: iso(n.createdAt),
  }));

/** Loads one feed; a failing feed is reported, not fatal. */
const safely = (promise) => promise.then((data) => ({ data })).catch((err) => ({ error: err?.message || "Failed to load." }));

export const getUserProfileForAdmin = async (req, res) => {
  const scope = schoolScopeOf(req.admin);
  if (scope && !scope.schoolCode) return res.status(400).json({ error: "Your admin account is not linked to a school." });
  try {
    const user = await loadUser(req.params.uid);
    const visible = user && (!scope || inSchoolScope(scope, user) || (await linkedToScopedCourse(scope, user)));
    if (!visible) return res.status(404).json({ error: "User not found." });

    const sections = sectionsFor(req.admin);
    const has = (name) => sections.includes(name);
    const loaders = {
      academics: () => loadAcademics(user, { department: isSchoolAdminB(req.admin.adminType) ? scope.department : null }),
      posts: () => loadPosts(user.uid),
      store: () => loadStore(user.uid),
      transactions: () => loadTransactions(user.uid),
      tickets: () => loadTickets(user.uid),
      security: () => loadSecurity(user),
      notifications: () => loadNotifications(user.uid),
    };
    const entries = await Promise.all(
      Object.keys(loaders)
        .filter((name) => has(name) && (name !== "academics" || ["student", "lecturer"].includes(user.usertype)))
        .map(async (name) => [name, await safely(loaders[name]())]),
    );

    res.json({
      access: { canEdit: canManage(req.admin), canDelete: canManage(req.admin), sections },
      user: profileFor(user, req.admin),
      activity: Object.fromEntries(entries),
    });
    if (scope) recordSchoolAudit(req, "user_profile_viewed", { uid: user.uid, department: user.department || null });
    else recordAdminActivity(req, "user profile viewed", { uid: user.uid });
  } catch (err) {
    console.error("getUserProfileForAdmin Error:", err);
    res.status(500).json({ error: "Failed to load this user." });
  }
};

// ---------------------------------------------------------------------------
// DELETE /admins/users/:uid  { reason, confirm }  (super admins and support)
// ---------------------------------------------------------------------------

export const deleteUserAsAdmin = async (req, res) => {
  if (!canManage(req.admin)) return res.status(403).json({ error: "Only support and super admins can delete accounts." });
  const reason = String(req.body?.reason || "").trim();
  const confirm = String(req.body?.confirm || "").trim();
  if (reason.length < 5) return res.status(400).json({ error: "Give a reason for deleting this account." });
  try {
    const user = await loadUser(req.params.uid);
    if (!user) return res.status(404).json({ error: "User not found." });
    // The admin must type the username (or uid) back, so a stray click can't delete anyone.
    if (![user.username, user.uid].filter(Boolean).some((v) => v.toLowerCase() === confirm.toLowerCase())) {
      return res.status(400).json({ error: "Type the user's username to confirm." });
    }
    const purged = await purgeUserAccount(user.uid, { reason: `Admin: ${reason}`, deletedBy: req.admin.uid });
    if (!purged) return res.status(404).json({ error: "User not found." });
    res.json({ success: true, message: "Account deleted." });
    notifyAdmins(
      { role: FULL_ACCESS },
      {
        notificationId: generateNotificationId("profile"),
        category: "profile",
        title: "Account deleted by an admin",
        message: `${personName(req.admin)} deleted ${personName(user)} (@${user.username || user.uid}). Reason: ${reason}`,
        actionType: "ACCOUNT_DELETION_ADMIN_ALERT",
        payload: { userUid: user.uid, reason, deletedBy: req.admin.uid },
        senderId: "system",
      },
      false,
    ).catch((err) => console.error("Admin delete alert failed:", err.message));
  } catch (err) {
    console.error("deleteUserAsAdmin Error:", err);
    res.status(500).json({ error: "Failed to delete this account." });
  }
};
