// Tiered institutional analytics for school administrators.
//
// Tiers map to OperationalInstitutions.tier:
//   free    → Basic         attendance, student identity, announcements,
//                           basic analytics
//   pro     → Professional  + tests & exam proctoring, LMS activity, deeper
//                           attendance and lecturer analytics
//   premium → Enterprise    + advanced analytics (at-risk students, department
//                           comparisons, trends), integrity & security
//
// Every query is scoped to the school's own courses; nothing reads a whole
// collection. Higher tiers only run the extra queries they need.
import {
  User,
  Course,
  Lectures,
  Attendance,
  Assessment,
  TestSubmission,
  Exceptions,
  Posts,
  OperationalInstitutions,
} from "../tableDeclarations.js";
import { resolveLectureTime, toDate } from "./lectureTime.js";

export const SCHOOL_TIERS = {
  free: {
    key: "basic",
    label: "Basic",
    features: ["Attendance overview", "Student identity", "Announcements", "Basic analytics"],
  },
  pro: {
    key: "professional",
    label: "Professional",
    features: [
      "Tests & exam proctoring",
      "LMS activity",
      "Attendance by department & course",
      "Lecturer activity",
    ],
  },
  premium: {
    key: "enterprise",
    label: "Enterprise",
    features: [
      "At-risk student detection",
      "Department performance comparison",
      "12-week engagement trends",
      "Exam integrity & account security",
      "Dedicated support",
    ],
  },
};
const TIER_ORDER = ["free", "pro", "premium"];
const AT_RISK_ATTENDANCE_PCT = 60;
const AT_RISK_SCORE_PCT = 40;

const chunk = (list, size = 30) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
/** Runs `where(field, "in", chunk)` for every chunk and flattens the docs. */
const queryIn = async (collection, field, values, extra) => {
  if (!values.length) return [];
  const snaps = await Promise.all(
    chunk(values).map((part) => {
      let q = collection.where(field, "in", part);
      if (extra) q = extra(q);
      return q.get();
    }),
  );
  return snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
};
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const weekKey = (date) => {
  // Monday of the week, YYYY-MM-DD.
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};
const lastWeeks = (n) => {
  const keys = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    keys.push(weekKey(new Date(now.getTime() - i * 7 * 86400000)));
  }
  return keys;
};
const fullName = (u) =>
  [u?.firstname, u?.lastname].filter(Boolean).join(" ") || u?.username || "Unknown";

export const loadInstitution = async (schoolCode) => {
  const direct = await OperationalInstitutions.doc(String(schoolCode)).get();
  if (direct.exists) return direct.data();
  const snap = await OperationalInstitutions.where("schoolCode", "==", schoolCode)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].data();
};

export const buildSchoolAnalytics = async (schoolCode) => {
  const institution = await loadInstitution(schoolCode);
  const tier = TIER_ORDER.includes(institution?.tier) ? institution.tier : "free";
  const level = TIER_ORDER.indexOf(tier);
  const access = { basic: true, professional: level >= 1, enterprise: level >= 2 };

  // ---- Shared base data -----------------------------------------------------
  const [usersSnap, coursesSnap, memosSnap] = await Promise.all([
    User.where("schoolCode", "==", schoolCode).get(),
    Course.where("schoolCode", "==", schoolCode).get(),
    Posts.where("schoolCode", "==", schoolCode).where("audience", "==", "school").get(),
  ]);
  const users = usersSnap.docs.map((d) => d.data());
  const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const courseIds = courses.map((c) => c.courseId).filter(Boolean);
  const courseById = new Map(courses.map((c) => [c.courseId, c]));
  const userById = new Map(users.map((u) => [u.uid, u]));

  const [lectures, attendance] = await Promise.all([
    queryIn(Lectures, "courseId", courseIds),
    queryIn(Attendance, "courseId", courseIds),
  ]);

  const now = Date.now();
  const heldLectures = lectures.filter((l) => {
    if (l.status === "cancelled") return false;
    if (l.status === "completed" || l.isTaught) return true;
    const start = resolveLectureTime(l, "start");
    return !!start && start.getTime() <= now;
  });
  const heldIds = new Set(heldLectures.map((l) => l.id));
  const presentRecords = attendance.filter(
    (a) => a.status === "Present" && heldIds.has(a.lectureId),
  );

  // Expected seats = enrolled students per held lecture.
  const expectedSeats = heldLectures.reduce(
    (sum, l) => sum + (courseById.get(l.courseId)?.studentsEnrolled?.length || 0),
    0,
  );

  // ---- Basic ------------------------------------------------------------------
  const students = users.filter((u) => u.usertype === "student");
  const lecturers = users.filter((u) => u.usertype === "lecturer");
  const verifiedStudents = students.filter((u) => u.isVerified).length;
  const verifiedLecturers = lecturers.filter((u) => u.isVerified).length;

  const growth = {};
  users.forEach((u) => {
    if (!u.isVerified || !["student", "lecturer"].includes(u.usertype)) return;
    const d = toDate(u.createdAt) || new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    growth[key] = growth[key] || { students: 0, lecturers: 0 };
    growth[key][u.usertype === "student" ? "students" : "lecturers"] += 1;
  });

  const departmentBreakdown = {};
  let assigned = 0;
  let enrollments = 0;
  courses.forEach((c) => {
    const dept = c.department || "General";
    departmentBreakdown[dept] = (departmentBreakdown[dept] || 0) + 1;
    if (Array.isArray(c.lecturerIds) && c.lecturerIds.length) assigned += 1;
    enrollments += Array.isArray(c.studentsEnrolled) ? c.studentsEnrolled.length : 0;
  });

  const memos = memosSnap.docs.map((d) => d.data());
  const basic = {
    identity: {
      totalStudents: students.length,
      verifiedStudents,
      totalLecturers: lecturers.length,
      verifiedLecturers,
      verificationRatePct: pct(
        verifiedStudents + verifiedLecturers,
        students.length + lecturers.length,
      ),
    },
    attendance: {
      lecturesScheduled: lectures.length,
      lecturesHeld: heldLectures.length,
      lecturesCancelled: lectures.filter((l) => l.status === "cancelled").length,
      physicalLectures: heldLectures.filter((l) => l.lectureType === "Physical").length,
      onlineLectures: heldLectures.filter((l) => l.lectureType !== "Physical").length,
      checkIns: presentRecords.length,
      attendanceRatePct: pct(presentRecords.length, expectedSeats),
    },
    announcements: {
      memosPosted: memos.length,
      totalImpressions: memos.reduce((s, m) => s + (Number(m.impressions) || 0), 0),
      lastPostedAt:
        memos
          .map((m) => toDate(m.createdAt))
          .filter(Boolean)
          .sort((a, b) => b - a)[0]
          ?.toISOString() || null,
    },
    courses: {
      totalActiveCourses: courses.length,
      departmentBreakdown,
      allocationStatus: { assigned, unassigned: courses.length - assigned },
      studentEnrollments: enrollments,
    },
    onboardingGrowth: Object.keys(growth)
      .sort()
      .slice(-12)
      .map((month) => ({ month, ...growth[month] })),
  };

  // ---- Professional -----------------------------------------------------------
  let professional = null;
  let assessments = [];
  let submissions = [];
  let exceptions = [];
  if (access.professional) {
    [assessments, exceptions] = await Promise.all([
      queryIn(Assessment, "courseId", courseIds),
      queryIn(Exceptions, "courseId", courseIds),
    ]);
    const published = assessments.filter((a) => a.isPublished !== false);
    const marksByTest = new Map(published.map((a) => [a.id, Number(a.totalMarks) || 0]));
    submissions = await queryIn(
      TestSubmission,
      "testId",
      published.map((a) => a.id),
    );
    const scorePcts = submissions
      .map((s) => pct(Number(s.score) || 0, marksByTest.get(s.testId) || 0))
      .filter((v) => v !== null);
    const avgScore = scorePcts.length
      ? Math.round((scorePcts.reduce((a, b) => a + b, 0) / scorePcts.length) * 10) / 10
      : null;

    // Attendance by department and by course.
    const deptAgg = {};
    const courseAgg = new Map();
    heldLectures.forEach((l) => {
      const course = courseById.get(l.courseId);
      const seats = course?.studentsEnrolled?.length || 0;
      const dept = course?.department || "General";
      deptAgg[dept] = deptAgg[dept] || { present: 0, seats: 0 };
      deptAgg[dept].seats += seats;
      const ca = courseAgg.get(l.courseId) || { present: 0, seats: 0, lectures: 0 };
      ca.seats += seats;
      ca.lectures += 1;
      courseAgg.set(l.courseId, ca);
    });
    presentRecords.forEach((a) => {
      const course = courseById.get(a.courseId);
      const dept = course?.department || "General";
      if (deptAgg[dept]) deptAgg[dept].present += 1;
      const ca = courseAgg.get(a.courseId);
      if (ca) ca.present += 1;
    });
    const courseRates = [...courseAgg.entries()]
      .map(([courseId, v]) => ({
        courseId,
        courseCode: courseById.get(courseId)?.courseCode || courseId,
        courseTitle: courseById.get(courseId)?.courseTitle || "",
        lecturesHeld: v.lectures,
        attendanceRatePct: pct(v.present, v.seats),
      }))
      .filter((c) => c.attendanceRatePct !== null)
      .sort((a, b) => b.attendanceRatePct - a.attendanceRatePct);

    // Weekly attendance, last 8 weeks.
    const weeks = lastWeeks(8);
    const weekly = Object.fromEntries(weeks.map((w) => [w, { present: 0, seats: 0 }]));
    heldLectures.forEach((l) => {
      const start = resolveLectureTime(l, "start");
      const w = start ? weekKey(start) : null;
      if (w && weekly[w]) weekly[w].seats += courseById.get(l.courseId)?.studentsEnrolled?.length || 0;
    });
    const lectureWeek = new Map(
      heldLectures.map((l) => {
        const start = resolveLectureTime(l, "start");
        return [l.id, start ? weekKey(start) : null];
      }),
    );
    presentRecords.forEach((a) => {
      const w = lectureWeek.get(a.lectureId);
      if (w && weekly[w]) weekly[w].present += 1;
    });

    // Lecturer activity.
    const byLecturer = {};
    heldLectures.forEach((l) => {
      if (!l.hostId) return;
      byLecturer[l.hostId] = byLecturer[l.hostId] || { lecturesDelivered: 0, online: 0, physical: 0 };
      byLecturer[l.hostId].lecturesDelivered += 1;
      byLecturer[l.hostId][l.lectureType === "Physical" ? "physical" : "online"] += 1;
    });

    const assignmentsCount = courses.reduce(
      (s, c) => s + (Array.isArray(c.assignments) ? c.assignments.length : 0),
      0,
    );
    const materialsCount = courses.reduce((s, c) => {
      const r = c.resources;
      return s + (Array.isArray(r) ? r.length : r && typeof r === "object" ? Object.keys(r).length : 0);
    }, 0);

    professional = {
      assessments: {
        published: published.length,
        drafts: assessments.length - published.length,
        submissions: submissions.length,
        averageScorePct: avgScore,
        passRatePct: pct(scorePcts.filter((p) => p >= 40).length, scorePcts.length),
        flaggedSubmissions: submissions.filter((s) => s.isFlagged).length,
        impersonationBlocked: submissions.filter(
          (s) => s.verificationStatus === "Impersonation_Detected",
        ).length,
      },
      lms: {
        coursesWithSyllabus: courses.filter(
          (c) => Array.isArray(c.courseContents) && c.courseContents.length > 0,
        ).length,
        syllabusCoveragePct: pct(
          courses.filter((c) => Array.isArray(c.courseContents) && c.courseContents.length > 0).length,
          courses.length,
        ),
        materialsUploaded: materialsCount,
        assignmentsPosted: assignmentsCount,
      },
      attendance: {
        byDepartment: Object.entries(deptAgg)
          .map(([department, v]) => ({ department, attendanceRatePct: pct(v.present, v.seats) }))
          .sort((a, b) => (b.attendanceRatePct ?? 0) - (a.attendanceRatePct ?? 0)),
        topCourses: courseRates.slice(0, 5),
        lowestCourses: courseRates.slice(-5).reverse(),
        weeklyTrend: weeks.map((w) => ({ week: w, attendanceRatePct: pct(weekly[w].present, weekly[w].seats) })),
        exceptionsApproved: exceptions.filter((e) => e.status === "approved").length,
        exceptionsPending: exceptions.filter((e) => e.status === "pending").length,
      },
      lecturers: Object.entries(byLecturer)
        .map(([uid, v]) => ({ uid, name: fullName(userById.get(uid)), ...v }))
        .sort((a, b) => b.lecturesDelivered - a.lecturesDelivered)
        .slice(0, 10),
    };
  }

  // ---- Enterprise -------------------------------------------------------------
  let enterprise = null;
  if (access.enterprise) {
    const totalMarksAll = new Map(assessments.map((a) => [a.id, Number(a.totalMarks) || 0]));
    const assessmentsByCourse = new Map();
    assessments
      .filter((a) => a.isPublished !== false)
      .forEach((a) => assessmentsByCourse.set(a.courseId, (assessmentsByCourse.get(a.courseId) || 0) + (Number(a.totalMarks) || 0)));

    // Per-student attendance and score across the school's courses.
    const heldByCourse = new Map();
    heldLectures.forEach((l) => heldByCourse.set(l.courseId, (heldByCourse.get(l.courseId) || 0) + 1));
    const presentByStudent = new Map();
    presentRecords.forEach((a) => presentByStudent.set(a.studentId, (presentByStudent.get(a.studentId) || 0) + 1));
    const excusedByStudent = new Map();
    exceptions
      .filter((e) => e.status === "approved")
      .forEach((e) => excusedByStudent.set(e.studentId, (excusedByStudent.get(e.studentId) || 0) + 1));
    const scoreByStudent = new Map();
    submissions.forEach((s) => {
      scoreByStudent.set(s.studentId, (scoreByStudent.get(s.studentId) || 0) + (Number(s.score) || 0));
    });
    const expected = new Map();
    const possible = new Map();
    courses.forEach((c) => {
      (c.studentsEnrolled || []).forEach((sid) => {
        expected.set(sid, (expected.get(sid) || 0) + (heldByCourse.get(c.courseId) || 0));
        possible.set(sid, (possible.get(sid) || 0) + (assessmentsByCourse.get(c.courseId) || 0));
      });
    });

    const studentRows = students.map((u) => {
      const attendancePct = pct(
        Math.min(expected.get(u.uid) || 0, (presentByStudent.get(u.uid) || 0) + (excusedByStudent.get(u.uid) || 0)),
        expected.get(u.uid) || 0,
      );
      const scorePct = pct(scoreByStudent.get(u.uid) || 0, possible.get(u.uid) || 0);
      return {
        uid: u.uid,
        name: fullName(u),
        matricNumber: u.matricNumber || "N/A",
        department: u.department || "General",
        attendancePct,
        scorePct,
      };
    });
    const atRisk = studentRows
      .filter(
        (s) =>
          (s.attendancePct !== null && s.attendancePct < AT_RISK_ATTENDANCE_PCT) ||
          (s.scorePct !== null && s.scorePct < AT_RISK_SCORE_PCT),
      )
      .sort((a, b) => (a.attendancePct ?? 100) + (a.scorePct ?? 100) - ((b.attendancePct ?? 100) + (b.scorePct ?? 100)));

    // Department comparison.
    const deptStats = {};
    studentRows.forEach((s) => {
      const d = (deptStats[s.department] = deptStats[s.department] || { students: 0, att: [], score: [] });
      d.students += 1;
      if (s.attendancePct !== null) d.att.push(s.attendancePct);
      if (s.scorePct !== null) d.score.push(s.scorePct);
    });
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);

    // 12-week engagement: check-ins and test submissions per week.
    const weeks = lastWeeks(12);
    const engagement = Object.fromEntries(weeks.map((w) => [w, { checkIns: 0, submissions: 0 }]));
    presentRecords.forEach((a) => {
      const d = toDate(a.timestamp) || toDate(a.createdAt);
      const w = d ? weekKey(d) : null;
      if (w && engagement[w]) engagement[w].checkIns += 1;
    });
    submissions.forEach((s) => {
      const d = toDate(s.submittedAt) || toDate(s.createdAt);
      const w = d ? weekKey(d) : null;
      if (w && engagement[w]) engagement[w].submissions += 1;
    });

    const exceptionReasons = {};
    exceptions.forEach((e) => {
      const r = e.reasonCategory || "Other";
      exceptionReasons[r] = (exceptionReasons[r] || 0) + 1;
    });

    enterprise = {
      atRisk: {
        thresholds: { attendancePct: AT_RISK_ATTENDANCE_PCT, scorePct: AT_RISK_SCORE_PCT },
        count: atRisk.length,
        students: atRisk.slice(0, 25),
      },
      departments: Object.entries(deptStats)
        .map(([department, d]) => ({
          department,
          students: d.students,
          averageAttendancePct: avg(d.att),
          averageScorePct: avg(d.score),
        }))
        .sort((a, b) => (b.averageScorePct ?? 0) - (a.averageScorePct ?? 0)),
      engagementTrend: weeks.map((w) => ({ week: w, ...engagement[w] })),
      exceptionReasons,
      integrity: {
        flaggedSubmissions: submissions.filter((s) => s.isFlagged).length,
        identityMismatchesInTests: submissions.reduce(
          (sum, s) => sum + (Number(s.proctoringData?.identityMismatches) || 0),
          0,
        ),
        testInterruptions: submissions.reduce(
          (sum, s) => sum + (Number(s.proctoringData?.tabSwitchCount) || 0),
          0,
        ),
        accountsWithSuspiciousActivity: users.filter(
          (u) => Array.isArray(u.suspiciousActivity) && u.suspiciousActivity.length > 0,
        ).length,
        suspendedAccounts: users.filter((u) => u.isSuspended).length,
      },
      support: { dedicatedSupport: true, contactEmail: process.env.ENTERPRISE_SUPPORT_EMAIL || null },
    };
  }

  const tierInfo = SCHOOL_TIERS[tier];
  return {
    institution: {
      schoolCode,
      name: institution?.schoolName || institution?.name || schoolCode,
      logo: institution?.logo || null,
      tier,
      tierLabel: tierInfo.label,
    },
    access,
    // What higher tiers add, for upgrade prompts.
    locked: TIER_ORDER.slice(level + 1).map((t) => ({
      tier: t,
      label: SCHOOL_TIERS[t].label,
      features: SCHOOL_TIERS[t].features,
    })),
    generatedAt: new Date().toISOString(),
    basic,
    professional,
    enterprise,
    // Legacy shape kept for older app builds.
    users: {
      verifiedStudents,
      verifiedLecturers,
      onboardingGrowth: basic.onboardingGrowth,
    },
    courses: {
      totalActiveCourses: courses.length,
      departmentBreakdown,
      allocationStatus: { assigned, unassigned: courses.length - assigned },
      studentEnrollmentDensity: enrollments,
    },
    academics: {
      totalAssessmentsCreated: access.professional ? assessments.length : 0,
      testSubmissionsCount: access.professional ? submissions.length : 0,
      attendanceSyncVolume: presentRecords.length,
    },
  };
};
