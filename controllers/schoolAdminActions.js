// School administrator endpoints: department-scoped analytics lists, school
// representatives (seats by plan), school announcements and the audit log.
// Every handler derives the school and department from the signed-in admin
// (utils/schoolRoles.js#resolveSchoolScope), never from what the UI hides.
import admin from "firebase-admin";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { setImmediate } from "timers";
import {
  Admin,
  Course,
  User,
  Notification,
  SchoolConfiguration,
  SchoolAnnouncements,
  SchoolAuditLog,
} from "../tableDeclarations.js";
import { buildSchoolAnalytics, loadInstitution } from "../utils/schoolAnalytics.js";
import {
  isSchoolAdmin,
  isSchoolAdminA,
  isSchoolAdminB,
  normalizeTier,
  resolveSchoolScope,
  resolveSession,
  SCHOOL_ADMIN_A,
  SCHOOL_ADMIN_B,
  SEAT_LIMITS,
  TIER_LABELS,
} from "../utils/schoolRoles.js";
import { localDateKey } from "../utils/lectureTime.js";
import { createNotification } from "../services/notification.js";
import { sendEmail } from "../services/emailService.js";
import { schoolRepInviteTemplate } from "../services/emailTemplates.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import { emailExport } from "../utils/exportService.js";
import { attachmentPayload, parseAttachments } from "../utils/notificationAttachments.js";
import { toDate } from "../utils/lectureTime.js";

const ADMIN_PORTAL_URL = process.env.ADMIN_PORTAL_URL || null;
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
const fullName = (a) => [a?.firstname, a?.lastname].filter(Boolean).join(" ").trim() || "School admin";
const levelOf = (adminType) => (isSchoolAdminA(adminType) ? "a" : isSchoolAdminB(adminType) ? "b" : null);
const roleLabel = (level) => (level === "a" ? "Institution Representative" : "Department Representative");

/** Records who viewed, exported or changed what (NDPR compliance). Never blocks the request. */
export const recordSchoolAudit = (req, action, details = {}) => {
  const actor = req.admin || {};
  if (!actor.schoolCode && !details.schoolCode) return;
  setImmediate(() => {
    SchoolAuditLog.add({
      schoolCode: details.schoolCode || actor.schoolCode,
      actorUid: actor.uid || null,
      actorName: fullName(actor),
      actorType: actor.adminType || null,
      actorDepartment: actor.department || null,
      action,
      details,
      ipAddress: String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
        .split(",")[0]
        .trim(),
      createdAt: new Date(),
    }).catch((err) => console.error("School audit log error:", err.message));
  });
};

/** 403 unless the requester is a school admin linked to a school. */
const requireSchool = (req, res) => {
  if (!isSchoolAdmin(req.admin?.adminType)) {
    res.status(403).json({ error: "Only school administrators can use this." });
    return null;
  }
  if (!req.admin.schoolCode) {
    res.status(400).json({ error: "Your admin account is not linked to a school." });
    return null;
  }
  return resolveSchoolScope(req.admin, req.query);
};

const paginate = (list, query) => {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const totalPages = Math.max(1, Math.ceil(list.length / limit));
  const page = Math.min(totalPages, Math.max(1, parseInt(query.page, 10) || 1));
  return { items: list.slice((page - 1) * limit, page * limit), total: list.length, page, totalPages };
};

const matchesSearch = (row, q) =>
  !q || JSON.stringify(Object.values(row)).toLowerCase().includes(q.toLowerCase());

// ---------------------------------------------------------------------------
// "View all" lists
// ---------------------------------------------------------------------------

const SECTIONS = ["courses", "announcements", "lectures", "at-risk", "lecturers"];

export const getSchoolSection = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  const { section } = req.params;
  if (!SECTIONS.includes(section)) {
    return res.status(404).json({ error: "Unknown section." });
  }
  try {
    const data = await buildSchoolAnalytics(scope.schoolCode, { department: scope.department, full: true, session: req.query.session });
    let list;
    if (section === "courses") list = data.lists.courses;
    else if (section === "announcements") list = data.lists.announcements;
    else if (section === "lectures") {
      const filter = String(req.query.filter || "all");
      const today = localDateKey(new Date());
      list =
        filter === "ongoing"
          ? data.live.ongoing
          : filter === "today"
            ? data.lists.lectures.filter((l) => l.startsAt && localDateKey(new Date(l.startsAt)) === today)
            : data.lists.lectures;
    } else if (section === "at-risk") {
      if (!data.enterprise) return res.status(403).json({ error: "At-risk students are part of the Enterprise plan." });
      list = data.enterprise.atRisk.students;
    } else {
      if (!data.professional) return res.status(403).json({ error: "Lecturer activity is part of the Professional plan." });
      list = data.professional.lecturers;
    }
    const q = String(req.query.q || "").trim();
    const page = paginate(list.filter((row) => matchesSearch(row, q)), req.query);
    res.json({
      ...page,
      section,
      scope: data.scope,
      session: data.session,
      institution: data.institution,
    });
    recordSchoolAudit(req, "section_viewed", { section, department: scope.department, session: data.session.label, q: q || null, page: page.page });
  } catch (err) {
    console.error("getSchoolSection Error:", err);
    res.status(500).json({ error: "Failed to load this list." });
  }
};

// ---------------------------------------------------------------------------
// Users: the school's students and lecturers, by department and level
// ---------------------------------------------------------------------------

const USER_ROLES = { students: "student", lecturers: "lecturer" };
const norm = (value) => String(value || "").trim().toLowerCase();
const levelKey = (u) => (u.current_level ? String(u.current_level) : "Unknown");

// Only what a school needs to identify and support its members; contact
// details, devices and identity documents stay out (data minimisation).
const userRow = (u) => ({
  uid: u.uid,
  name: [u.firstname, u.lastname].filter(Boolean).join(" ") || u.username || "Unknown",
  username: u.username || null,
  usertype: u.usertype,
  idNumber: (u.usertype === "student" ? u.matricNumber : u.staffId) || null,
  department: String(u.department || "").trim() || "General",
  level: u.usertype === "student" ? levelKey(u) : null,
  isVerified: !!u.isVerified,
  isSuspended: !!u.isSuspended,
  profilePic: u.profilePic || [],
  joinedAt: toDate(u.createdAt)?.toISOString() || null,
});

// A school can have thousands of students. Its members are read once per
// MEMBERS_TTL_MS, with only the fields the Users tab needs, and every page,
// search keystroke and breakdown is served from that copy, so paging through
// 4,000 students doesn't re-read the whole school from Firestore each time.
// Only one page (`limit`, max 100) is ever sent to the portal.
const MEMBER_FIELDS = [
  "uid", "firstname", "lastname", "username", "usertype", "matricNumber", "staffId",
  "department", "current_level", "isVerified", "isSuspended", "profilePic", "createdAt",
];
const MEMBERS_TTL_MS = 2 * 60 * 1000;
const MAX_CACHED_SCHOOLS = 50;
const memberCache = new Map(); // schoolCode -> { at, promise }

const loadMembers = (schoolCode, { fresh = false } = {}) => {
  const hit = memberCache.get(schoolCode);
  if (!fresh && hit && Date.now() - hit.at < MEMBERS_TTL_MS) return hit.promise;
  const promise = User.where("schoolCode", "==", schoolCode)
    .select(...MEMBER_FIELDS)
    .get()
    .then((snap) => snap.docs.map((d) => d.data()).filter((u) => Object.values(USER_ROLES).includes(u.usertype)));
  // Re-inserting keeps the Map in least-recently-loaded order for eviction.
  memberCache.delete(schoolCode);
  memberCache.set(schoolCode, { at: Date.now(), promise });
  if (memberCache.size > MAX_CACHED_SCHOOLS) memberCache.delete(memberCache.keys().next().value);
  promise.catch(() => {
    if (memberCache.get(schoolCode)?.promise === promise) memberCache.delete(schoolCode);
  });
  return promise;
};

/**
 * The school's students or lecturers in scope, plus department and level
 * breakdowns. `fresh` skips the member cache (exports must be current).
 */
const loadSchoolUsers = async (scope, query, { fresh = false } = {}) => {
  const role = USER_ROLES[query.role] ? query.role : "students";
  const members = await loadMembers(scope.schoolCode, { fresh });
  const departments = [...new Set(members.map((u) => String(u.department || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const inScope = members.filter((u) => !scope.department || norm(u.department || "General") === norm(scope.department));

  const byDepartment = {};
  const byLevel = {};
  inScope.forEach((u) => {
    const dept = String(u.department || "").trim() || "General";
    byDepartment[dept] = byDepartment[dept] || { department: dept, students: 0, lecturers: 0 };
    byDepartment[dept][u.usertype === "student" ? "students" : "lecturers"] += 1;
    if (u.usertype === "student") byLevel[levelKey(u)] = (byLevel[levelKey(u)] || 0) + 1;
  });

  const level = String(query.level || "").trim();
  const q = String(query.q || "").trim().toLowerCase();
  const rows = inScope
    .filter((u) => u.usertype === USER_ROLES[role])
    .filter((u) => !level || role !== "students" || levelKey(u) === level)
    .map(userRow)
    .filter((r) => !q || [r.name, r.username, r.idNumber, r.department].some((v) => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => a.department.localeCompare(b.department) || String(a.level).localeCompare(String(b.level), undefined, { numeric: true }) || a.name.localeCompare(b.name));

  return {
    role,
    level: level || null,
    rows,
    scope: { department: scope.department, departments, locked: scope.locked },
    breakdown: {
      totals: {
        students: inScope.filter((u) => u.usertype === "student").length,
        lecturers: inScope.filter((u) => u.usertype === "lecturer").length,
        verified: inScope.filter((u) => u.isVerified).length,
        suspended: inScope.filter((u) => u.isSuspended).length,
      },
      byDepartment: Object.values(byDepartment).sort((a, b) => b.students + b.lecturers - (a.students + a.lecturers)),
      byLevel: Object.entries(byLevel)
        .map(([name, count]) => ({ level: name, students: count }))
        .sort((a, b) => a.level.localeCompare(b.level, undefined, { numeric: true })),
    },
  };
};

export const getSchoolUsers = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  if (scope.locked && !scope.department) {
    return res.status(400).json({ error: "Your account has no department yet." });
  }
  try {
    const data = await loadSchoolUsers(scope, req.query);
    const { rows, ...rest } = data;
    res.json({ ...paginate(rows, req.query), ...rest });
    recordSchoolAudit(req, "users_viewed", { role: data.role, department: scope.department, level: data.level, page: req.query.page || 1 });
  } catch (err) {
    console.error("getSchoolUsers Error:", err);
    res.status(500).json({ error: "Failed to load users." });
  }
};

// ---------------------------------------------------------------------------
// Exports (branded Excel, emailed to the requesting rep only)
// ---------------------------------------------------------------------------

const USER_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "username", label: "Username" },
  { key: "idNumber", label: "Matric / Staff ID" },
  { key: "department", label: "Department" },
  { key: "level", label: "Level" },
  { label: "Verified", value: (r) => (r.isVerified ? "Yes" : "No") },
  { label: "Suspended", value: (r) => (r.isSuspended ? "Yes" : "No") },
  { key: "joinedAt", label: "Joined" },
];

const SCHOOL_EXPORTS = {
  overview: { title: "Institution summary", personalData: false },
  courses: { title: "Courses this session", personalData: false },
  lectures: { title: "Lectures this session", personalData: false },
  announcements: { title: "Announcements this session", personalData: false },
  lecturers: { title: "Lecturer activity", personalData: true, tier: "professional" },
  "at-risk": { title: "Students at risk", personalData: true, tier: "enterprise" },
  students: { title: "Students", personalData: true },
  "lecturer-accounts": { title: "Lecturers", personalData: true },
};

export const exportSchoolData = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  const section = String(req.body?.section || "");
  const spec = SCHOOL_EXPORTS[section];
  if (!spec) return res.status(400).json({ error: "Choose what to export." });
  if (scope.locked && !scope.department) {
    return res.status(400).json({ error: "Your account has no department yet." });
  }
  // Scope comes from the signed-in rep; the body can only narrow an A-level rep's view.
  const narrowed = resolveSchoolScope(req.admin, { department: req.body?.department });
  try {
    let files;
    if (section === "students" || section === "lecturer-accounts") {
      const data = await loadSchoolUsers(
        narrowed,
        { role: section === "students" ? "students" : "lecturers", level: req.body?.level },
        { fresh: true },
      );
      files = [{ name: section, rows: data.rows, columns: USER_COLUMNS }];
    } else {
      const data = await buildSchoolAnalytics(narrowed.schoolCode, { department: narrowed.department, full: true, session: req.body?.session });
      if (spec.tier && !data.access[spec.tier]) {
        return res.status(403).json({ error: `${spec.title} is not included in your plan.` });
      }
      const b = data.basic;
      files = {
        overview: () => [
          {
            name: "summary",
            columns: [
              { key: "metric", label: "Metric" },
              { key: "value", label: "Value" },
            ],
            rows: [
              ["Institution", data.institution.name],
              ["Plan", data.institution.tierLabel],
              ["Session", data.session.label],
              ["Department", narrowed.department || "All departments"],
              ["Students", data.kpis.students.current],
              ["Lecturers", data.kpis.lecturers.current],
              ["Classes scheduled this month", data.kpis.classes.current],
              ["Lectures held", b.attendance.lecturesHeld],
              ["Physical lectures held", b.lectureModes.physical],
              ["Online lectures held", b.lectureModes.online],
              ["Attendance rate %", b.attendance.attendanceRatePct],
              ["Physical attendance %", b.lectureModes.attendanceRatePct.physical],
              ["Online attendance %", b.lectureModes.attendanceRatePct.online],
              ["Active courses", b.courses.totalActiveCourses],
              ["Courses without a lecturer", b.courses.allocationStatus.unassigned],
              ["Memos posted", b.announcements.memosPosted],
              ["Notifications sent", b.announcements.notificationsSent],
            ].map(([metric, value]) => ({ metric, value })),
          },
          {
            name: "lectures-by-month",
            columns: [
              { key: "month", label: "Month" },
              { key: "physical", label: "Physical" },
              { key: "online", label: "Online" },
            ],
            rows: b.lectureModes.byMonth,
          },
        ],
        courses: () => [
          {
            name: "courses",
            rows: data.lists.courses,
            columns: [
              { key: "courseCode", label: "Code" },
              { key: "courseTitle", label: "Title" },
              { key: "department", label: "Department" },
              { key: "level", label: "Level" },
              { key: "semester", label: "Semester" },
              { key: "enrolled", label: "Enrolled" },
              { key: "lecturesHeld", label: "Lectures held" },
              { label: "Lecturers", value: (r) => r.lecturers.join("; ") },
            ],
          },
        ],
        lectures: () => [
          {
            name: "lectures",
            rows: data.lists.lectures,
            columns: [
              { key: "startsAt", label: "Starts" },
              { key: "courseCode", label: "Course" },
              { key: "topicName", label: "Topic" },
              { key: "department", label: "Department" },
              { key: "lectureType", label: "Type" },
              { key: "location", label: "Location" },
              { key: "host", label: "Lecturer" },
              { key: "status", label: "Status" },
              { key: "checkIns", label: "Check-ins" },
              { key: "enrolled", label: "Enrolled" },
            ],
          },
        ],
        announcements: () => [
          {
            name: "announcements",
            rows: data.lists.announcements,
            columns: [
              { key: "createdAt", label: "Date" },
              { key: "kind", label: "Kind" },
              { key: "title", label: "Title" },
              { key: "body", label: "Message" },
              { key: "department", label: "Department" },
              { key: "sentBy", label: "Sent by" },
              { key: "reach", label: "Reach" },
              { key: "reachLabel", label: "Reach type" },
            ],
          },
        ],
        lecturers: () => [
          {
            name: "lecturer-activity",
            rows: data.professional.lecturers,
            columns: [
              { key: "name", label: "Lecturer" },
              { key: "lecturesDelivered", label: "Lectures delivered" },
              { key: "physical", label: "Physical" },
              { key: "online", label: "Online" },
            ],
          },
        ],
        "at-risk": () => [
          {
            name: "students-at-risk",
            rows: data.enterprise.atRisk.students,
            columns: [
              { key: "name", label: "Student" },
              { key: "matricNumber", label: "Matric number" },
              { key: "department", label: "Department" },
              { key: "level", label: "Level" },
              { key: "attendancePct", label: "Attendance %" },
              { key: "scorePct", label: "Average score %" },
            ],
          },
        ],
      }[section]();
    }
    const result = await emailExport(req, {
      title: spec.title,
      files,
      personalData: spec.personalData,
      scope: {
        School: req.admin.organizationName || narrowed.schoolCode,
        Session: section === "students" || section === "lecturer-accounts" ? null : resolveSession(req.body?.session).label,
        Department: narrowed.department || "All departments",
      },
    });
    res.status(result.status).json(result.body);
    if (result.status === 200) {
      recordSchoolAudit(req, "data_exported", { section, department: narrowed.department, rows: result.body.rows, personalData: spec.personalData });
    }
  } catch (err) {
    console.error("exportSchoolData Error:", err);
    res.status(500).json({ error: "Failed to prepare the export." });
  }
};

// ---------------------------------------------------------------------------
// School representatives
// ---------------------------------------------------------------------------

const loadDomainWhitelist = async (schoolCode) => {
  const snap = await SchoolConfiguration.where("schoolId", "==", schoolCode).limit(1).get();
  const list = snap.empty ? [] : snap.docs[0].data().domainWhitelist;
  return (Array.isArray(list) ? list : [])
    .map((d) => String(d).trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
};

/** Email's domain is a whitelisted domain or one of its subdomains (staff.fupre.edu.ng). */
const domainAllowed = (email, whitelist) => {
  if (!whitelist.length) return true;
  const domain = String(email).split("@")[1]?.toLowerCase() || "";
  return whitelist.some((d) => domain === d || domain.endsWith(`.${d}`));
};

const loadSchoolAdmins = async (schoolCode) => {
  const snap = await Admin.where("schoolCode", "==", schoolCode).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => isSchoolAdmin(a.adminType));
};

const seatSummary = (tier, admins) => {
  const limits = SEAT_LIMITS[tier];
  return {
    a: { used: admins.filter((a) => levelOf(a.adminType) === "a").length, limit: limits.a },
    b: { used: admins.filter((a) => levelOf(a.adminType) === "b").length, limit: limits.b },
  };
};

const repView = (a, schoolName) => ({
  uid: a.uid,
  firstname: a.firstname || "",
  lastname: a.lastname || "",
  email: a.email || "",
  adminType: levelOf(a.adminType) === "a" ? SCHOOL_ADMIN_A : SCHOOL_ADMIN_B,
  level: levelOf(a.adminType),
  department: a.department || null,
  schoolName: a.organizationName || schoolName,
  profilePic: a.profilePic || [],
  isVerified: a.isVerified !== false,
  lastAccessed: a.lastAccessed || null,
  invitedBy: a.invitedBy || null,
  createdAt: a.createdAt || null,
});

export const getSchoolReps = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  try {
    const [institution, admins] = await Promise.all([
      loadInstitution(scope.schoolCode),
      loadSchoolAdmins(scope.schoolCode),
    ]);
    const tier = normalizeTier(institution?.tier);
    const schoolName = institution?.schoolName || scope.schoolCode;
    const reps = admins
      .map((a) => repView(a, schoolName))
      .sort(
        (x, y) =>
          x.level.localeCompare(y.level) ||
          String(x.department || "").localeCompare(String(y.department || "")) ||
          fullName(x).localeCompare(fullName(y)),
      );
    res.json({
      reps,
      schoolName,
      tier,
      tierLabel: TIER_LABELS[tier],
      seats: seatSummary(tier, admins),
      canManage: isSchoolAdminA(req.admin.adminType),
      // A-level reps can add more A-level reps only where the plan has room for them.
      canInviteA: isSchoolAdminA(req.admin.adminType) && SEAT_LIMITS[tier].a !== 1,
      domainWhitelist: await loadDomainWhitelist(scope.schoolCode),
    });
  } catch (err) {
    console.error("getSchoolReps Error:", err);
    res.status(500).json({ error: "Failed to load school representatives." });
  }
};

/**
 * Creates a school representative with a one-time password and emails it.
 * Used by A-level reps (their school) and super admins (any school).
 * Returns { status, body } so both callers can answer with it.
 */
export const inviteSchoolRep = async (inviter, input) => {
  const level = input.level === "a" ? "a" : "b";
  const firstname = String(input.firstname || "").trim();
  const lastname = String(input.lastname || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const department = String(input.department || "").trim();
  const schoolCode = String(input.schoolCode || "").trim();

  if (!schoolCode) return { status: 400, body: { error: "Choose the school this representative belongs to." } };
  if (!firstname || !lastname) return { status: 400, body: { error: "First and last name are required." } };
  if (!isEmail(email)) return { status: 400, body: { error: "Enter a valid email address." } };
  if (level === "b" && !department) {
    return { status: 400, body: { error: "Department representatives need a department." } };
  }

  const [institution, whitelist, admins, existing] = await Promise.all([
    loadInstitution(schoolCode),
    loadDomainWhitelist(schoolCode),
    loadSchoolAdmins(schoolCode),
    Admin.where("email", "==", email).limit(1).get(),
  ]);
  if (!institution) return { status: 404, body: { error: "That school is not an iCampus institution." } };
  if (!existing.empty) return { status: 409, body: { error: "An administrator with this email already exists." } };
  if (!domainAllowed(email, whitelist)) {
    return {
      status: 400,
      body: { error: `Use a school email address (${whitelist.map((d) => `@${d}`).join(", ")}).` },
    };
  }

  const tier = normalizeTier(institution.tier);
  const seats = seatSummary(tier, admins)[level];
  if (seats.limit !== null && seats.used >= seats.limit) {
    return {
      status: 403,
      body: {
        error: `Your ${TIER_LABELS[tier]} plan includes ${seats.limit} ${roleLabel(level).toLowerCase()} seat${seats.limit === 1 ? "" : "s"}, and all are in use. Remove one or contact iCampus to upgrade.`,
      },
    };
  }

  const temporaryPassword = crypto.randomBytes(9).toString("base64url");
  const ref = Admin.doc();
  const schoolName = institution.schoolName || schoolCode;
  const record = {
    uid: ref.id,
    firstname,
    lastname,
    email,
    password: await bcrypt.hash(temporaryPassword, 10),
    adminType: level === "a" ? SCHOOL_ADMIN_A : SCHOOL_ADMIN_B,
    schoolCode,
    department: level === "b" ? department : null,
    organizationName: schoolName,
    providerId: "password",
    isVerified: true,
    profilePic: [],
    invitedBy: inviter.uid,
    lastAccessed: null,
    createdAt: new Date(),
  };
  await ref.set(record);
  if (level === "b" && isSchoolAdminA(inviter.adminType) && inviter.id) {
    await Admin.doc(inviter.id).set(
      { schoolAdminsBLevelAdded: admin.firestore.FieldValue.arrayUnion(ref.id) },
      { merge: true },
    );
  }

  setImmediate(() => {
    sendEmail({
      to: email,
      subject: `You've been added to ${schoolName} on iCampus`,
      html: schoolRepInviteTemplate({
        name: firstname,
        inviterName: fullName(inviter),
        schoolName,
        roleLabel: roleLabel(level),
        department: record.department,
        email,
        temporaryPassword,
        portalUrl: ADMIN_PORTAL_URL,
      }),
    }).catch((err) => console.error("Rep invite email failed:", err.message));
  });

  return { status: 201, body: { message: "Representative added. Their sign-in details were emailed to them.", rep: repView(record, schoolName) } };
};

export const createSchoolRep = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  if (!isSchoolAdminA(req.admin.adminType)) {
    return res.status(403).json({ error: "Only the institution representative can add representatives." });
  }
  try {
    const result = await inviteSchoolRep(req.admin, { ...req.body, schoolCode: scope.schoolCode });
    res.status(result.status).json(result.body);
    if (result.status === 201) {
      recordSchoolAudit(req, "rep_invited", {
        repUid: result.body.rep.uid,
        level: result.body.rep.level,
        department: result.body.rep.department,
      });
    }
  } catch (err) {
    console.error("createSchoolRep Error:", err);
    res.status(500).json({ error: "Failed to add the representative." });
  }
};

/** The target rep, if the requester (an A-level rep) may manage them. */
const loadManageableRep = async (req, res, scope) => {
  if (!isSchoolAdminA(req.admin.adminType)) {
    res.status(403).json({ error: "Only the institution representative can manage representatives." });
    return null;
  }
  const { uid } = req.params;
  if (uid === req.admin.uid) {
    res.status(400).json({ error: "You cannot change your own access here." });
    return null;
  }
  const doc = await Admin.doc(uid).get();
  const target = doc.exists ? { id: doc.id, ...doc.data() } : null;
  if (!target || target.schoolCode !== scope.schoolCode || !isSchoolAdmin(target.adminType)) {
    res.status(404).json({ error: "Representative not found." });
    return null;
  }
  return target;
};

export const updateSchoolRep = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  try {
    const target = await loadManageableRep(req, res, scope);
    if (!target) return;
    const updates = {};
    ["firstname", "lastname"].forEach((key) => {
      const value = String(req.body?.[key] ?? "").trim();
      if (value) updates[key] = value;
    });
    if (isSchoolAdminB(target.adminType) && req.body?.department !== undefined) {
      const department = String(req.body.department || "").trim();
      if (!department) return res.status(400).json({ error: "Department representatives need a department." });
      updates.department = department;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update." });
    updates.updatedAt = new Date();
    await Admin.doc(target.id).set(updates, { merge: true });
    res.json({ message: "Representative updated.", rep: repView({ ...target, ...updates }, target.organizationName) });
    recordSchoolAudit(req, "rep_updated", { repUid: target.uid, fields: Object.keys(updates) });
  } catch (err) {
    console.error("updateSchoolRep Error:", err);
    res.status(500).json({ error: "Failed to update the representative." });
  }
};

export const deleteSchoolRep = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  try {
    const target = await loadManageableRep(req, res, scope);
    if (!target) return;
    await Admin.doc(target.id).delete();
    if (target.invitedBy) {
      const inviter = await Admin.where("uid", "==", target.invitedBy).limit(1).get();
      if (!inviter.empty) {
        await inviter.docs[0].ref.set(
          { schoolAdminsBLevelAdded: admin.firestore.FieldValue.arrayRemove(target.uid) },
          { merge: true },
        );
      }
    }
    res.json({ message: "Representative removed." });
    recordSchoolAudit(req, "rep_removed", { repUid: target.uid, name: fullName(target), department: target.department || null });
  } catch (err) {
    console.error("deleteSchoolRep Error:", err);
    res.status(500).json({ error: "Failed to remove the representative." });
  }
};

// ---------------------------------------------------------------------------
// School announcements (as in-app + push notifications)
// ---------------------------------------------------------------------------

const AUDIENCES = { a: ["students", "lecturers", "reps"], b: ["students", "lecturers"] };
const SEND_BATCH = 25;

export const sendSchoolNotification = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  const level = levelOf(req.admin.adminType);
  const title = String(req.body?.title || "").trim();
  const message = String(req.body?.message || "").trim();
  const audiences = [...new Set(Array.isArray(req.body?.audiences) ? req.body.audiences : [])];
  // B-level reps always send to their own department.
  const department = level === "b" ? scope.department : String(req.body?.department || "").trim() || null;
  const { attachments, error: attachmentError } = parseAttachments(req.body?.attachments);

  if (attachmentError) return res.status(400).json({ error: attachmentError });
  if (title.length < 3 || title.length > 80) return res.status(400).json({ error: "Title must be 3–80 characters." });
  // A memo image can carry the whole message, so the text may be short then.
  const minMessage = attachments.length ? 0 : 3;
  if (message.length < minMessage || message.length > 1000) {
    return res.status(400).json({ error: `Message must be ${minMessage}–1000 characters.` });
  }
  if (!audiences.length || audiences.some((a) => !AUDIENCES[level].includes(a))) {
    return res.status(400).json({ error: `Choose who receives this: ${AUDIENCES[level].join(", ")}.` });
  }
  if (level === "b" && !department) {
    return res.status(400).json({ error: "Your account has no department, so it cannot send announcements." });
  }

  try {
    const inDept = (value) => !department || String(value || "").trim().toLowerCase() === department.toLowerCase();
    const userTypes = audiences.filter((a) => a !== "reps").map((a) => (a === "students" ? "student" : "lecturer"));
    const [institution, usersSnap, reps] = await Promise.all([
      loadInstitution(scope.schoolCode),
      userTypes.length ? User.where("schoolCode", "==", scope.schoolCode).get() : null,
      audiences.includes("reps") ? loadSchoolAdmins(scope.schoolCode) : [],
    ]);
    const users = (usersSnap?.docs || [])
      .map((d) => d.data())
      .filter((u) => u.uid && userTypes.includes(u.usertype) && !u.isSuspended && inDept(u.department));
    const repRecipients = reps.filter(
      (r) => isSchoolAdminB(r.adminType) && r.uid !== req.admin.uid && inDept(r.department),
    );
    const recipients = [...users.map((u) => u.uid), ...repRecipients.map((r) => r.uid)];
    if (!recipients.length) {
      return res.status(400).json({ error: "No one matches that audience yet." });
    }

    const schoolName = institution?.schoolName || scope.schoolCode;
    const senderName = fullName(req.admin);
    const ref = SchoolAnnouncements.doc();
    const record = {
      id: ref.id,
      schoolCode: scope.schoolCode,
      schoolName,
      senderUid: req.admin.uid,
      senderName,
      senderLevel: level,
      title,
      message,
      attachments,
      audiences,
      department,
      recipientCount: recipients.length,
      counts: {
        students: users.filter((u) => u.usertype === "student").length,
        lecturers: users.filter((u) => u.usertype === "lecturer").length,
        reps: repRecipients.length,
      },
      status: "sending",
      createdAt: new Date(),
    };
    await ref.set(record);
    res.status(202).json({ message: `Sending to ${recipients.length.toLocaleString()} people.`, announcement: record });
    recordSchoolAudit(req, "notification_sent", { announcementId: ref.id, audiences, department, recipients: recipients.length });

    setImmediate(async () => {
      let delivered = 0;
      const payload = {
        school: schoolName,
        from: `${senderName} (${roleLabel(level)})`,
        department: department || "All departments",
        ...attachmentPayload(attachments),
      };
      const body = message || (attachments.length ? "Open to view the attached memo." : message);
      for (let i = 0; i < recipients.length; i += SEND_BATCH) {
        const results = await Promise.allSettled(
          recipients.slice(i, i + SEND_BATCH).map((recipientId) =>
            createNotification({
              notificationId: generateNotificationId("classroom"),
              recipientId,
              category: "classroom",
              actionType: "SCHOOL_ANNOUNCEMENT",
              title,
              message: body,
              entityId: ref.id,
              entityType: "school_announcement",
              payload,
            }),
          ),
        );
        delivered += results.filter((r) => r.status === "fulfilled" && r.value).length;
      }
      await ref
        .set({ status: "sent", delivered, completedAt: new Date() }, { merge: true })
        .catch((err) => console.error("Announcement status update failed:", err.message));
    });
  } catch (err) {
    console.error("sendSchoolNotification Error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to send the notification." });
  }
};

export const getSchoolNotifications = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  try {
    const [sentSnap, inboxSnap, coursesSnap] = await Promise.all([
      SchoolAnnouncements.where("schoolCode", "==", scope.schoolCode).get(),
      // Sorted here rather than with orderBy so no composite index is needed.
      Notification.where("recipientId", "==", req.admin.uid).limit(200).get(),
      // Department choices for institution reps.
      scope.locked ? null : Course.where("schoolCode", "==", scope.schoolCode).select("department").get(),
    ]);
    const departments = [
      ...new Set((coursesSnap?.docs || []).map((d) => String(d.get("department") || "").trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    const time = (v) => (v?.toDate ? v.toDate() : new Date(v || 0)).getTime();
    const sent = sentSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // Department reps only see what was sent to their department or school-wide.
      .filter((a) => !scope.department || !a.department || a.department.toLowerCase() === scope.department.toLowerCase())
      .sort((x, y) => time(y.createdAt) - time(x.createdAt));
    const inbox = inboxSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((x, y) => time(y.createdAt) - time(x.createdAt))
      .slice(0, 50);
    res.json({
      sent: paginate(sent, req.query),
      inbox,
      audiences: AUDIENCES[levelOf(req.admin.adminType)],
      department: scope.department,
      departments,
    });
  } catch (err) {
    console.error("getSchoolNotifications Error:", err);
    res.status(500).json({ error: "Failed to load notifications." });
  }
};

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const getSchoolAuditLog = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  if (!isSchoolAdminA(req.admin.adminType)) {
    return res.status(403).json({ error: "Only the institution representative can view the audit log." });
  }
  try {
    const snap = await SchoolAuditLog.where("schoolCode", "==", scope.schoolCode).get();
    const time = (v) => (v?.toDate ? v.toDate() : new Date(v || 0)).getTime();
    const entries = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((x, y) => time(y.createdAt) - time(x.createdAt));
    res.json(paginate(entries, req.query));
  } catch (err) {
    console.error("getSchoolAuditLog Error:", err);
    res.status(500).json({ error: "Failed to load the audit log." });
  }
};
