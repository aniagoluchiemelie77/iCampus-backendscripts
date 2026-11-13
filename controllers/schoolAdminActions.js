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
  Assessment,
  Attendance,
  Course,
  Exceptions,
  Lectures,
  TestSubmission,
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
import { resolveLectureTime, toDate } from "../utils/lectureTime.js";
import { notifyAdmins } from "../services/adminNotification.js";
import {
  CalendarError,
  dismissSuggestion,
  labelYear,
  loadDetections,
  loadInstitutionDoc,
  readCalendar,
  resolveAcademicSession,
  sessionView,
  startSession,
  SUGGEST_MIN_LECTURERS,
  SUGGEST_MIN_REPORTERS,
  undoLastSession,
  updateCalendarSettings,
  updateCurrentSession,
} from "../utils/academicCalendar.js";

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

const riskScore = (s) => (s.attendancePct ?? 100) + (s.scorePct ?? 100);
const levelOrder = (s) => Number(String(s.level || "").match(/[0-9]+/)?.[0]) || Number.MAX_SAFE_INTEGER;
/**
 * At-risk order: "risk" (most at risk first, the default), "department"
 * (A–Z, most at risk first within each) or "level" (100L up, likewise).
 */
const sortAtRisk = (rows, sort) => {
  const list = [...rows];
  if (sort === "department") {
    return list.sort((a, b) => String(a.department).localeCompare(String(b.department)) || riskScore(a) - riskScore(b));
  }
  if (sort === "level") return list.sort((a, b) => levelOrder(a) - levelOrder(b) || riskScore(a) - riskScore(b));
  return list.sort((a, b) => riskScore(a) - riskScore(b));
};

export const getSchoolSection = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  const { section } = req.params;
  if (!SECTIONS.includes(section)) {
    return res.status(404).json({ error: "Unknown section." });
  }
  try {
    const data = await buildSchoolAnalytics(scope.schoolCode, { department: scope.department, level: scope.level, full: true, session: req.query.session });
    let list;
    if (section === "courses") {
      // "department" groups the Courses tab A–Z by department, then by code.
      list =
        req.query.sort === "department"
          ? [...data.lists.courses].sort(
              (a, b) =>
                String(a.department).localeCompare(String(b.department)) ||
                String(a.courseCode).localeCompare(String(b.courseCode), undefined, { numeric: true }),
            )
          : data.lists.courses;
    }
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
      list = sortAtRisk(data.enterprise.atRisk.students, req.query.sort);
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
      ...(section === "at-risk"
        ? { breakdown: { byDepartment: data.enterprise.atRisk.byDepartment, byLevel: data.enterprise.atRisk.byLevel } }
        : {}),
    });
    recordSchoolAudit(req, "section_viewed", { section, department: scope.department, level: scope.level, session: data.session.label, q: q || null, page: page.page });
  } catch (err) {
    console.error("getSchoolSection Error:", err);
    res.status(500).json({ error: "Failed to load this list." });
  }
};

// ---------------------------------------------------------------------------
// Course detail: lecturers, enrolled students, lectures, assessments and a
// timeline of what has happened in the course. Same scope as every other
// school endpoint: the course must belong to the admin's school, and to a
// department rep's own department.
// ---------------------------------------------------------------------------

const chunked = async (collection, field, values) => {
  const unique = [...new Set(values.filter(Boolean))];
  const results = [];
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await collection.where(field, "in", unique.slice(i, i + 30)).get();
    snap.docs.forEach((d) => results.push({ id: d.id, ...d.data() }));
  }
  return results;
};
const listOf = (value) => (Array.isArray(value) ? value : []);
const pctOf = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const iso = (value) => toDate(value)?.toISOString() || null;
const personName = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(" ").trim() || u?.username || "Unknown";
const average = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);

/** The course, or null when it doesn't exist or is outside the admin's scope. */
const loadScopedCourse = async (scope, courseId) => {
  const id = String(courseId || "").trim();
  if (!id) return null;
  const byField = await Course.where("courseId", "==", id).limit(1).get();
  const doc = byField.empty ? await Course.doc(id).get() : byField.docs[0];
  if (!doc.exists) return null;
  const course = { id: doc.id, ...doc.data() };
  if (course.schoolCode !== scope.schoolCode) return null;
  if (scope.department && norm(course.department || "General") !== norm(scope.department)) return null;
  return course;
};

export const getSchoolCourseDetail = async (req, res) => {
  const scope = requireSchool(req, res);
  if (!scope) return;
  try {
    const course = await loadScopedCourse(scope, req.params.courseId);
    // 404 for "out of scope" too, so reps can't probe other departments' courses.
    if (!course) return res.status(404).json({ error: "Course not found." });
    const courseId = course.courseId || course.id;

    const institution = await loadInstitution(scope.schoolCode);
    // Test scores are a Professional-plan feature, as on the dashboard.
    const access = { assessments: normalizeTier(institution?.tier) !== "basic" };

    const lecturerIds = listOf(course.lecturerIds);
    const studentIds = listOf(course.studentsEnrolled);
    const [members, lectureSnap, attendanceSnap, assessments, exceptionsSnap] = await Promise.all([
      loadMembers(scope.schoolCode),
      Lectures.where("courseId", "==", courseId).get(),
      Attendance.where("courseId", "==", courseId).get(),
      access.assessments ? chunked(Assessment, "courseId", [courseId]) : Promise.resolve([]),
      Exceptions.where("courseId", "==", courseId).get(),
    ]);
    const people = new Map(members.map((u) => [u.uid, u]));
    // Enrolled people missing from the school's member list (e.g. carry-over
    // students) are looked up directly.
    const missing = [...lecturerIds, ...studentIds].filter((uid) => !people.has(uid));
    if (missing.length) {
      (await chunked(User, "uid", missing)).forEach((u) => people.set(u.uid, u));
    }

    const nowMs = Date.now();
    const startOf = (l) => resolveLectureTime(l, "start");
    const endOf = (l) => resolveLectureTime(l, "end");
    const lectures = lectureSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const isHeld = (l) => {
      if (l.status === "cancelled") return false;
      if (l.status === "completed" || l.isTaught) return true;
      const start = startOf(l);
      return !!start && start.getTime() <= nowMs;
    };
    const held = lectures.filter(isHeld);
    const heldIds = new Set(held.map((l) => l.id));
    const present = attendanceSnap.docs.map((d) => d.data()).filter((a) => a.status === "Present");
    const presentByLecture = new Map();
    const presentByStudent = new Map();
    let presentAtHeld = 0;
    present.forEach((a) => {
      presentByLecture.set(a.lectureId, (presentByLecture.get(a.lectureId) || 0) + 1);
      if (heldIds.has(a.lectureId)) {
        presentAtHeld += 1;
        presentByStudent.set(a.studentId, (presentByStudent.get(a.studentId) || 0) + 1);
      }
    });

    const published = assessments.filter((a) => a.isPublished !== false);
    const submissions = access.assessments ? await chunked(TestSubmission, "testId", published.map((a) => a.id)) : [];
    const marksByTest = new Map(published.map((a) => [a.id, Number(a.totalMarks) || 0]));
    const scorePct = (s) => pctOf(Number(s.score) || 0, marksByTest.get(s.testId) || Number(s.totalPossibleScore) || 0);
    const scoresByStudent = new Map();
    const submissionsByTest = new Map();
    submissions.forEach((s) => {
      submissionsByTest.set(s.testId, [...(submissionsByTest.get(s.testId) || []), s]);
      const value = scorePct(s);
      if (value !== null) scoresByStudent.set(s.studentId, [...(scoresByStudent.get(s.studentId) || []), value]);
    });

    const hosted = new Map();
    held.forEach((l) => l.hostId && hosted.set(l.hostId, (hosted.get(l.hostId) || 0) + 1));
    const lecturers = lecturerIds.map((uid) => {
      const u = people.get(uid) || {};
      return {
        uid,
        name: personName(u),
        staffId: u.staffId || null,
        department: u.department || null,
        profilePic: u.profilePic || [],
        isVerified: !!u.isVerified,
        lecturesHeld: hosted.get(uid) || 0,
      };
    });

    const students = studentIds
      .map((uid) => {
        const u = people.get(uid) || {};
        const attended = presentByStudent.get(uid) || 0;
        const scores = scoresByStudent.get(uid) || [];
        return {
          uid,
          name: personName(u),
          matricNumber: u.matricNumber || null,
          department: u.department || null,
          level: u.current_level ? String(u.current_level) : null,
          profilePic: u.profilePic || [],
          isSuspended: !!u.isSuspended,
          lecturesAttended: attended,
          attendancePct: pctOf(attended, held.length),
          ...(access.assessments ? { averageScorePct: average(scores), testsTaken: scores.length } : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const lectureRows = lectures
      .map((l) => ({
        id: l.id,
        topicName: l.topicName || "Lecture",
        host: personName(people.get(l.hostId)),
        hostId: l.hostId || null,
        lectureType: l.lectureType || "Physical",
        location: l.location || null,
        status: l.status === "cancelled" ? "cancelled" : isHeld(l) ? "held" : l.status || "scheduled",
        startsAt: startOf(l)?.toISOString() || null,
        endsAt: endOf(l)?.toISOString() || null,
        checkIns: presentByLecture.get(l.id) || 0,
      }))
      .sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt)));

    const assessmentRows = assessments
      .map((a) => {
        const subs = submissionsByTest.get(a.id) || [];
        return {
          id: a.id,
          title: a.title || "Assessment",
          totalMarks: Number(a.totalMarks) || 0,
          isPublished: a.isPublished !== false,
          status: a.status || null,
          dueDate: iso(a.dueDate || a.endTime),
          createdAt: iso(a.createdAt),
          submissions: subs.length,
          averageScorePct: average(subs.map(scorePct).filter((v) => v !== null)),
          flagged: subs.filter((s) => s.isFlagged).length,
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const materials = listOf(course.resources).map((r) =>
      typeof r === "string"
        ? { title: "Course material", uploadedAt: null }
        : { title: r.title || r.resourceTitle || r.fileName || "Course material", uploadedAt: iso(r.uploadedAt || r.createdAt) },
    );
    const assignments = listOf(course.assignments).map((a) => ({
      title: a.title || "Assignment",
      dueDate: iso(a.dueDate),
      submissions: listOf(a.submissions).length,
    }));
    const exceptions = exceptionsSnap.docs.map((d) => d.data());

    // Everything that happened in the course, newest first.
    const timeline = [
      ...lectureRows.map((l) => ({
        kind: l.status === "cancelled" ? "lecture_cancelled" : l.status === "held" ? "lecture_held" : "lecture_scheduled",
        title: l.topicName,
        detail: `${l.host} · ${l.lectureType}${l.status === "held" ? ` · ${l.checkIns} checked in` : ""}`,
        at: l.startsAt,
      })),
      ...assessmentRows.map((a) => ({
        kind: a.isPublished ? "assessment_published" : "assessment_draft",
        title: a.title,
        detail: a.isPublished ? `${a.submissions} submissions` : "Draft",
        at: a.createdAt,
      })),
      ...materials.filter((m) => m.uploadedAt).map((m) => ({ kind: "material_uploaded", title: m.title, detail: "Course material", at: m.uploadedAt })),
      ...assignments.map((a) => ({ kind: "assignment_due", title: a.title, detail: `${a.submissions} submissions`, at: a.dueDate })),
    ]
      .filter((e) => e.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 60);

    res.json({
      access,
      course: {
        courseId,
        courseCode: course.courseCode || "",
        courseTitle: course.courseTitle || "",
        department: course.department || "General",
        level: course.level || null,
        semester: course.semester || null,
        session: course.session || null,
        credits: Number(course.credits) || null,
        description: course.description || course.courseDescription || null,
        isActive: course.isActive !== false,
        contents: listOf(course.courseContents)
          .map((c) => (typeof c === "string" ? c : c?.title || c?.topic || ""))
          .filter(Boolean),
      },
      summary: {
        enrolled: studentIds.length,
        lecturers: lecturerIds.length,
        lecturesScheduled: lectures.length,
        lecturesHeld: held.length,
        lecturesCancelled: lectures.filter((l) => l.status === "cancelled").length,
        attendanceRatePct: pctOf(presentAtHeld, held.length * studentIds.length),
        materials: materials.length,
        assignments: assignments.length,
        exceptionsPending: exceptions.filter((e) => e.status === "pending").length,
        exceptionsApproved: exceptions.filter((e) => e.status === "approved").length,
        ...(access.assessments
          ? {
              assessments: assessmentRows.length,
              submissions: submissions.length,
              averageScorePct: average(submissions.map(scorePct).filter((v) => v !== null)),
            }
          : {}),
      },
      lecturers,
      students,
      lectures: lectureRows,
      assessments: assessmentRows,
      materials,
      assignments,
      timeline,
    });
    recordSchoolAudit(req, "course_viewed", { courseId, department: course.department || null });
  } catch (err) {
    console.error("getSchoolCourseDetail Error:", err);
    res.status(500).json({ error: "Failed to load this course." });
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

export const loadMembers = (schoolCode, { fresh = false } = {}) => {
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
  all: { title: "All institution sections", personalData: true },
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
  const narrowed = resolveSchoolScope(req.admin, { department: req.body?.department, level: req.body?.level });
  try {
    let files;
    let sessionLabel = null;
    if (section === "students" || section === "lecturer-accounts") {
      const data = await loadSchoolUsers(
        narrowed,
        { role: section === "students" ? "students" : "lecturers", level: req.body?.level },
        { fresh: true },
      );
      files = [{ name: section, rows: data.rows, columns: USER_COLUMNS }];
    } else {
      const data = await buildSchoolAnalytics(narrowed.schoolCode, { department: narrowed.department, level: narrowed.level, full: true, session: req.body?.session });
      sessionLabel = data.session.label;
      if (spec.tier && !data.access[spec.tier]) {
        return res.status(403).json({ error: `${spec.title} is not included in your plan.` });
      }
      const b = data.basic;
      if (section === "all") {
        files = [
          {
            name: "summary",
            columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }],
            rows: [
              { metric: "Institution", value: data.institution.name },
              { metric: "Session", value: data.session.label },
              { metric: "Students", value: data.kpis.students.current },
              { metric: "Lecturers", value: data.kpis.lecturers.current },
              { metric: "Lectures held", value: b.attendance.lecturesHeld },
              { metric: "Attendance rate %", value: b.attendance.attendanceRatePct },
            ],
          },
          { name: "courses", rows: data.lists.courses, columns: [{ key: "courseCode", label: "Code" }, { key: "courseTitle", label: "Title" }, { key: "department", label: "Department" }, { key: "level", label: "Level" }] },
          { name: "lectures", rows: data.lists.lectures, columns: [{ key: "startsAt", label: "Starts" }, { key: "courseCode", label: "Course" }, { key: "topicName", label: "Topic" }, { key: "lectureType", label: "Type" }, { key: "host", label: "Lecturer" }, { key: "checkIns", label: "Check-ins" }] },
          { name: "announcements", rows: data.lists.announcements, columns: [{ key: "createdAt", label: "Date" }, { key: "title", label: "Title" }, { key: "body", label: "Message" }] },
        ];
      } else {
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
            rows: sortAtRisk(data.enterprise.atRisk.students, req.body?.sort),
            columns: [
              { key: "name", label: "Student" },
              { key: "matricNumber", label: "Matric number" },
              { key: "department", label: "Department" },
              { key: "level", label: "Level" },
              { key: "attendancePct", label: "Attendance %" },
              { key: "scorePct", label: "Average score %" },
            ],
          },
          {
            name: "at-risk-by-department",
            rows: data.enterprise.atRisk.byDepartment,
            columns: [
              { key: "key", label: "Department" },
              { key: "count", label: "At-risk students" },
              { key: "lowAttendance", label: "Low attendance" },
              { key: "lowScore", label: "Low score" },
              { key: "averageAttendancePct", label: "Avg attendance %" },
              { key: "averageScorePct", label: "Avg score %" },
            ],
          },
          {
            name: "at-risk-by-level",
            rows: data.enterprise.atRisk.byLevel,
            columns: [
              { key: "key", label: "Level" },
              { key: "count", label: "At-risk students" },
              { key: "lowAttendance", label: "Low attendance" },
              { key: "lowScore", label: "Low score" },
              { key: "averageAttendancePct", label: "Avg attendance %" },
              { key: "averageScorePct", label: "Avg score %" },
            ],
          },
        ],
      }[section]();
      }
    }
    const result = await emailExport(req, {
      title: spec.title,
      files,
      personalData: spec.personalData,
      scope: {
        School: req.admin.organizationName || narrowed.schoolCode,
        Session: sessionLabel,
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
// ---------------------------------------------------------------------------
// Academic calendar: the A-level rep sets when sessions start and end
// (utils/academicCalendar.js). B-level reps can see it but not change it.
// Super admins manage any school's calendar with ?schoolCode= / body.schoolCode;
// support can view it.
// ---------------------------------------------------------------------------

/** { schoolCode, canManage } for the requester, or null after sending an error. */
const calendarScope = (req, res, { manage = false } = {}) => {
  const adminType = req.admin?.adminType;
  if (adminType === "super_admin" || (adminType === "support" && !manage)) {
    const schoolCode = String(req.query.schoolCode || req.body?.schoolCode || "").trim();
    if (!schoolCode) {
      res.status(400).json({ error: "Which institution?" });
      return null;
    }
    return { schoolCode, canManage: adminType === "super_admin" };
  }
  if (!isSchoolAdmin(adminType)) {
    res.status(403).json({ error: "Only school administrators can use this." });
    return null;
  }
  if (!req.admin.schoolCode) {
    res.status(400).json({ error: "Your admin account is not linked to a school." });
    return null;
  }
  const canManage = isSchoolAdminA(adminType);
  if (manage && !canManage) {
    res.status(403).json({ error: "Only your institution representative can change the academic calendar." });
    return null;
  }
  return { schoolCode: req.admin.schoolCode, canManage };
};

const calendarEntryView = (s) =>
  s && {
    label: s.label,
    startsAt: s.startsAt?.toISOString() ?? null,
    endsAt: s.endsAt?.toISOString() ?? null,
    plannedEndsAt: s.plannedEndsAt?.toISOString() ?? null,
    setAt: s.setAt?.toISOString() ?? null,
  };

/** The calendar as the portal shows it: what's set, what analytics uses, and what uploads report. */
const calendarResponse = async (doc, schoolCode, canManage) => {
  const institution = doc.data();
  const [coursesSnap, detections] = await Promise.all([
    Course.where("schoolCode", "==", schoolCode).select("session", "createdAt").get(),
    loadDetections(schoolCode),
  ]);
  const cal = readCalendar(institution);
  const resolved = resolveAcademicSession({
    institution,
    courses: coursesSnap.docs.map((d) => d.data()),
    detections,
  });
  return {
    schoolCode,
    schoolName: institution.schoolName || institution.name || schoolCode,
    canManage,
    current: calendarEntryView(cal.current),
    history: cal.history.map(calendarEntryView),
    defaultStartMonth: cal.defaultStartMonth,
    // The session analytics use right now, and where it came from.
    inUse: sessionView(resolved.current),
    status: resolved.status,
    // What students and lecturers have been uploading, newest session first.
    detected: detections
      .sort((a, b) => (labelYear(b.label) ?? 0) - (labelYear(a.label) ?? 0) || b.reporters - a.reporters)
      .slice(0, 10)
      .map((d) => ({
        label: d.label,
        reporters: d.reporters,
        lecturers: d.lecturers,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        matchesCurrent: d.key === resolved.current.key,
        dismissed: cal.dismissed.includes(d.key),
      })),
    thresholds: { reporters: SUGGEST_MIN_REPORTERS, lecturers: SUGGEST_MIN_LECTURERS },
  };
};

const withCalendar = (manage, action) => async (req, res) => {
  const scope = calendarScope(req, res, { manage });
  if (!scope) return;
  try {
    const doc = await loadInstitutionDoc(scope.schoolCode);
    if (!doc) return res.status(404).json({ error: "Institution not found." });
    const message = action ? await action(req, doc, scope) : null;
    // Re-read so the response reflects what was saved.
    const fresh = action ? await doc.ref.get() : doc;
    res.json({ ...(message ? { message } : {}), ...(await calendarResponse(fresh, scope.schoolCode, scope.canManage)) });
  } catch (err) {
    if (err instanceof CalendarError) return res.status(err.status).json({ error: err.message });
    console.error("Academic calendar Error:", err);
    res.status(500).json({ error: "Couldn't update the academic calendar." });
  }
};

/** Tells the school's other reps that the session changed. Never blocks the request. */
const notifySchoolReps = (req, schoolCode, title, message) => {
  setImmediate(async () => {
    try {
      const snap = await Admin.where("schoolCode", "==", schoolCode).get();
      const uids = snap.docs
        .map((d) => d.data())
        .filter((a) => isSchoolAdmin(a.adminType) && a.uid !== req.admin?.uid)
        .map((a) => a.uid);
      if (!uids.length) return;
      await notifyAdmins(
        { uids },
        {
          notificationId: generateNotificationId("classroom"),
          category: "classroom",
          actionType: "SCHOOL_SESSION_CHANGED",
          title,
          message,
          payload: { schoolCode },
        },
        false,
      );
    } catch (err) {
      console.error("Session change notification failed:", err.message);
    }
  });
};

export const getAcademicCalendar = withCalendar(false, null);

export const startAcademicSession = withCalendar(true, async (req, doc, scope) => {
  const { previous, current } = await startSession(doc, req.body || {}, req.admin.uid);
  recordSchoolAudit(req, "academic_session_started", {
    schoolCode: scope.schoolCode,
    session: current.label,
    startsAt: current.startsAt,
    endsAt: current.endsAt,
    previous: previous?.label || null,
  });
  notifySchoolReps(
    req,
    scope.schoolCode,
    "New academic session",
    `${fullName(req.admin)} started the ${current.label} session. Dashboards now show ${current.label}${previous ? `; ${previous.label} is in the session picker` : ""}.`,
  );
  return `${current.label} is now the current session.`;
});

export const updateAcademicSession = withCalendar(true, async (req, doc, scope) => {
  await updateCurrentSession(doc, req.body || {}, req.admin.uid);
  recordSchoolAudit(req, "academic_session_updated", { schoolCode: scope.schoolCode, fields: Object.keys(req.body || {}).filter((k) => k !== "schoolCode") });
  return "Session updated.";
});

export const undoAcademicSession = withCalendar(true, async (req, doc, scope) => {
  const { removed, current } = await undoLastSession(doc, req.admin.uid);
  recordSchoolAudit(req, "academic_session_undone", { schoolCode: scope.schoolCode, removed: removed.label, restored: current?.label || null });
  notifySchoolReps(
    req,
    scope.schoolCode,
    "Academic session reverted",
    `${fullName(req.admin)} removed the ${removed.label} session${current ? `; ${current.label} is current again` : ""}.`,
  );
  return current ? `${removed.label} removed. ${current.label} is current again.` : `${removed.label} removed.`;
});

export const updateAcademicCalendarSettings = withCalendar(true, async (req, doc, scope) => {
  await updateCalendarSettings(doc, req.body || {}, req.admin.uid);
  recordSchoolAudit(req, "academic_calendar_settings_updated", { schoolCode: scope.schoolCode, defaultStartMonth: req.body?.defaultStartMonth });
  return "Calendar settings saved.";
});

export const dismissSessionSuggestion = withCalendar(true, async (req, doc, scope) => {
  await dismissSuggestion(doc, req.body?.label, req.admin.uid);
  recordSchoolAudit(req, "session_suggestion_dismissed", { schoolCode: scope.schoolCode, session: req.body?.label });
  return "Suggestion dismissed.";
});
