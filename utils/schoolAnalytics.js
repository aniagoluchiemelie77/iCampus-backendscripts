// Tiered institutional analytics for school administrators.
//
// Tiers map to OperationalInstitutions.tier (see utils/schoolRoles.js):
//   basic      → monthly enrolment & class KPIs, live lectures, attendance
//                overview, current-session courses, announcements
//   pro        → + tests & exam proctoring, LMS activity, attendance by
//                department/course, lecturer activity
//   enterprise → + at-risk students, department comparison, engagement
//                trends, lecture heatmap, proctoring breakdown, lecturer load
//
// Scope is applied here, on the server: a department-scoped request only ever
// reads that department's users and courses. Courses and announcements are
// limited to the current academic session.
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
  SchoolAnnouncements,
} from "../tableDeclarations.js";
import { resolveLectureTime, toDate, localDateKey, tzOffsetMinutes } from "./lectureTime.js";
import {
  academicSession,
  normalizeTier,
  sessionStartYear,
  TIER_LABELS,
  TIERS,
} from "./schoolRoles.js";

export const SCHOOL_TIER_FEATURES = {
  basic: [
    "Monthly enrolment & class trends",
    "Live lectures",
    "Attendance overview",
    "Current-session courses",
    "Announcements",
  ],
  pro: [
    "Tests & exam proctoring",
    "LMS activity",
    "Attendance by department & course",
    "Lecturer activity",
  ],
  enterprise: [
    "At-risk student detection",
    "Department performance comparison",
    "12-week engagement trends",
    "Lecture activity heatmap",
    "Proctoring & integrity breakdown",
    "Lecturer workload",
    "Dedicated support",
  ],
};
const AT_RISK_ATTENDANCE_PCT = 60;
const AT_RISK_SCORE_PCT = 40;
const KPI_MONTHS = 6;
const PREVIEW = 6;

const chunk = (list, size = 30) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
/** Runs `where(field, "in", chunk)` for every chunk and flattens the docs. */
const queryIn = async (collection, field, values) => {
  if (!values.length) return [];
  const snaps = await Promise.all(chunk(values).map((part) => collection.where(field, "in", part).get()));
  return snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
};
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const avg = (arr) =>
  arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;
const weekKey = (date) => {
  // Monday of the week, YYYY-MM-DD.
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};
const lastWeeks = (n) => {
  const keys = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) keys.push(weekKey(new Date(now - i * 7 * 86400000)));
  return keys;
};
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** The last `n` months, oldest first, with their [start, end) bounds. */
const lastMonths = (n) => {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { key: monthKey(start), start, end };
  });
};
const fullName = (u) =>
  [u?.firstname, u?.lastname].filter(Boolean).join(" ") || u?.username || "Unknown";
const norm = (value) => String(value || "").trim().toLowerCase();
const listLength = (value) =>
  Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
/** Share of `list` in each 20-point band of a percentage. */
const bands = (values) =>
  [0, 20, 40, 60, 80].map((from) => ({
    band: `${from}–${from + 20}%`,
    count: values.filter((v) => v !== null && v >= from && (from === 80 ? v <= 100 : v < from + 20)).length,
  }));

export const loadInstitution = async (schoolCode) => {
  const direct = await OperationalInstitutions.doc(String(schoolCode)).get();
  if (direct.exists) return direct.data();
  const snap = await OperationalInstitutions.where("schoolCode", "==", schoolCode).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
};

/** Course belongs to the session: by its `session` field, else by when it was created. */
const inSession = (course, session) => {
  const year = sessionStartYear(course.session);
  if (year !== null) return year === session.startYear;
  const created = toDate(course.createdAt) || toDate(course.updatedAt);
  return !!created && created >= session.startsAt && created < session.endsAt;
};

/**
 * @param schoolCode  the institution
 * @param options.department  limit every figure to one department (null = all)
 * @param options.full  also return complete lists, for the "View all" screens
 */
export const buildSchoolAnalytics = async (schoolCode, { department = null, full = false } = {}) => {
  const institution = await loadInstitution(schoolCode);
  const tier = normalizeTier(institution?.tier);
  const level = TIERS.indexOf(tier);
  const access = { basic: true, professional: level >= 1, enterprise: level >= 2 };
  const session = academicSession();
  const inDept = (value) => !department || norm(value || "General") === norm(department);
  const take = (list, n = PREVIEW) => (full ? list : list.slice(0, n));

  // ---- Shared base data -----------------------------------------------------
  const [usersSnap, coursesSnap, memosSnap, broadcastsSnap] = await Promise.all([
    User.where("schoolCode", "==", schoolCode).get(),
    Course.where("schoolCode", "==", schoolCode).get(),
    Posts.where("schoolCode", "==", schoolCode).where("audience", "==", "school").get(),
    SchoolAnnouncements.where("schoolCode", "==", schoolCode).get(),
  ]);
  const allUsers = usersSnap.docs.map((d) => d.data());
  const allCourses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Filter options come from the whole school, so switching department never
  // makes the other choices disappear.
  const departments = [
    ...new Set(
      [...allCourses.map((c) => c.department), ...allUsers.map((u) => u.department)]
        .map((d) => String(d || "").trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const users = allUsers.filter((u) => inDept(u.department));
  const courses = allCourses.filter((c) => inSession(c, session) && inDept(c.department));
  const courseIds = courses.map((c) => c.courseId).filter(Boolean);
  const courseById = new Map(courses.map((c) => [c.courseId, c]));
  const userById = new Map(allUsers.map((u) => [u.uid, u]));

  const [lectures, attendance] = await Promise.all([
    queryIn(Lectures, "courseId", courseIds),
    queryIn(Attendance, "courseId", courseIds),
  ]);

  const now = new Date();
  const nowMs = now.getTime();
  const startOf = (l) => resolveLectureTime(l, "start");
  const endOf = (l) => resolveLectureTime(l, "end");
  const heldLectures = lectures.filter((l) => {
    if (l.status === "cancelled") return false;
    if (l.status === "completed" || l.isTaught) return true;
    const start = startOf(l);
    return !!start && start.getTime() <= nowMs;
  });
  const heldIds = new Set(heldLectures.map((l) => l.id));
  const presentRecords = attendance.filter((a) => a.status === "Present" && heldIds.has(a.lectureId));
  const presentByLecture = new Map();
  attendance
    .filter((a) => a.status === "Present")
    .forEach((a) => presentByLecture.set(a.lectureId, (presentByLecture.get(a.lectureId) || 0) + 1));
  const seatsOf = (courseId) => listLength(courseById.get(courseId)?.studentsEnrolled);
  const expectedSeats = heldLectures.reduce((sum, l) => sum + seatsOf(l.courseId), 0);

  const students = users.filter((u) => u.usertype === "student");
  const lecturers = users.filter((u) => u.usertype === "lecturer");
  const verifiedStudents = students.filter((u) => u.isVerified).length;
  const verifiedLecturers = lecturers.filter((u) => u.isVerified).length;

  // ---- Monthly KPIs: this month against last month, with a 6-month trend ---
  const months = lastMonths(KPI_MONTHS);
  const createdAtOf = (u) => toDate(u.createdAt);
  const enrolmentKpi = (list) => {
    const joined = list.map(createdAtOf);
    const series = months.map((m) => ({
      month: m.key,
      // Accounts without a creation date are counted from the start.
      value: joined.filter((d) => !d || d < m.end).length,
      added: joined.filter((d) => d && d >= m.start && d < m.end).length,
    }));
    const current = series[series.length - 1];
    const previous = series[series.length - 2];
    return {
      current: current.value,
      previous: previous.value,
      addedThisMonth: current.added,
      addedLastMonth: previous.added,
      series,
    };
  };
  const lectureStarts = lectures
    .filter((l) => l.status !== "cancelled")
    .map(startOf)
    .filter(Boolean);
  const classSeries = months.map((m) => ({
    month: m.key,
    value: lectureStarts.filter((d) => d >= m.start && d < m.end).length,
  }));
  const kpis = {
    students: enrolmentKpi(students),
    lecturers: enrolmentKpi(lecturers),
    classes: {
      current: classSeries[classSeries.length - 1].value,
      previous: classSeries[classSeries.length - 2].value,
      series: classSeries,
    },
  };

  // ---- Live: ongoing now, and the rest of today -----------------------------
  const lectureRow = (l) => {
    const course = courseById.get(l.courseId);
    return {
      id: l.id,
      topicName: l.topicName || "Lecture",
      courseId: l.courseId,
      courseCode: course?.courseCode || "",
      courseTitle: course?.courseTitle || "",
      department: course?.department || l.department || "General",
      lectureType: l.lectureType || "Physical",
      location: l.location || null,
      host: fullName(userById.get(l.hostId)),
      status: l.status || "scheduled",
      startsAt: startOf(l)?.toISOString() || null,
      endsAt: endOf(l)?.toISOString() || null,
      checkIns: presentByLecture.get(l.id) || 0,
      enrolled: seatsOf(l.courseId),
    };
  };
  const isOngoing = (l) => {
    if (["cancelled", "completed", "postponed"].includes(l.status)) return false;
    if (l.status === "ongoing" || l.isLive) return true;
    const start = startOf(l);
    const end = endOf(l);
    return !!start && !!end && start.getTime() <= nowMs && nowMs < end.getTime();
  };
  const todayKey = localDateKey(now);
  const ongoing = lectures.filter(isOngoing);
  const today = lectures.filter((l) => {
    const start = startOf(l);
    return l.status !== "cancelled" && !!start && localDateKey(start) === todayKey;
  });
  const upcomingToday = today
    .filter((l) => !isOngoing(l) && (startOf(l)?.getTime() || 0) > nowMs)
    .sort((a, b) => startOf(a) - startOf(b));
  const live = {
    ongoingCount: ongoing.length,
    todayCount: today.length,
    completedToday: today.filter((l) => (endOf(l)?.getTime() ?? Infinity) <= nowMs).length,
    ongoing: take(ongoing.map(lectureRow), 8),
    upcomingToday: take(upcomingToday.map(lectureRow), 5),
  };

  // ---- Courses (current session) -------------------------------------------
  let assigned = 0;
  let enrollments = 0;
  const deptCourses = {};
  const heldByCourse = new Map();
  heldLectures.forEach((l) => heldByCourse.set(l.courseId, (heldByCourse.get(l.courseId) || 0) + 1));
  courses.forEach((c) => {
    const dept = c.department || "General";
    deptCourses[dept] = (deptCourses[dept] || 0) + 1;
    if (listLength(c.lecturerIds)) assigned += 1;
    enrollments += listLength(c.studentsEnrolled);
  });
  const courseRows = courses
    .map((c) => ({
      courseId: c.courseId,
      courseCode: c.courseCode || "",
      courseTitle: c.courseTitle || "",
      department: c.department || "General",
      level: c.level || null,
      semester: c.semester || null,
      session: c.session || session.label,
      enrolled: listLength(c.studentsEnrolled),
      lecturers: (Array.isArray(c.lecturerIds) ? c.lecturerIds : []).map((uid) => fullName(userById.get(uid))),
      lecturesHeld: heldByCourse.get(c.courseId) || 0,
    }))
    .sort((a, b) => b.enrolled - a.enrolled);

  // ---- Announcements (current session) -------------------------------------
  const sinceSession = (d) => !!d && d >= session.startsAt;
  const memos = memosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => sinceSession(toDate(m.createdAt)));
  const broadcasts = broadcastsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    // Department reps see school-wide notices and their own department's.
    .filter((b) => sinceSession(toDate(b.createdAt)) && (!department || !b.department || inDept(b.department)));
  const announcementRows = [
    ...memos.map((m) => ({
      id: m.postId || m.id,
      kind: "memo",
      title: "School memo",
      body: String(m.content || "").slice(0, 280),
      createdAt: toDate(m.createdAt)?.toISOString() || null,
      reach: Number(m.impressions) || 0,
      reachLabel: "views",
      sentBy: m.postAuthorsDetails?.organizationName || fullName(m.postAuthorsDetails),
      department: null,
    })),
    ...broadcasts.map((b) => ({
      id: b.id,
      kind: "notification",
      title: b.title,
      body: String(b.message || "").slice(0, 280),
      createdAt: toDate(b.createdAt)?.toISOString() || null,
      reach: Number(b.recipientCount) || 0,
      reachLabel: "recipients",
      sentBy: b.senderName || "School admin",
      department: b.department || null,
      audiences: b.audiences || [],
    })),
  ].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const growth = {};
  users.forEach((u) => {
    if (!["student", "lecturer"].includes(u.usertype)) return;
    const d = createdAtOf(u);
    if (!d) return;
    const key = monthKey(d);
    growth[key] = growth[key] || { students: 0, lecturers: 0 };
    growth[key][u.usertype === "student" ? "students" : "lecturers"] += 1;
  });

  const basic = {
    identity: {
      totalStudents: students.length,
      verifiedStudents,
      totalLecturers: lecturers.length,
      verifiedLecturers,
      verificationRatePct: pct(verifiedStudents + verifiedLecturers, students.length + lecturers.length),
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
      notificationsSent: broadcasts.length,
      totalImpressions: memos.reduce((s, m) => s + (Number(m.impressions) || 0), 0),
      lastPostedAt: announcementRows[0]?.createdAt || null,
      recent: take(announcementRows, 5),
      total: announcementRows.length,
    },
    courses: {
      totalActiveCourses: courses.length,
      byDepartment: Object.entries(deptCourses)
        .map(([name, count]) => ({ department: name, courses: count }))
        .sort((a, b) => b.courses - a.courses),
      allocationStatus: { assigned, unassigned: courses.length - assigned },
      studentEnrollments: enrollments,
      list: take(courseRows),
    },
    onboardingGrowth: months.map((m) => ({ month: m.key, students: 0, lecturers: 0, ...growth[m.key] })),
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
    submissions = await queryIn(TestSubmission, "testId", published.map((a) => a.id));
    const scorePcts = submissions
      .map((s) => pct(Number(s.score) || 0, marksByTest.get(s.testId) || 0))
      .filter((v) => v !== null);

    const deptAgg = {};
    const courseAgg = new Map();
    heldLectures.forEach((l) => {
      const seats = seatsOf(l.courseId);
      const dept = courseById.get(l.courseId)?.department || "General";
      deptAgg[dept] = deptAgg[dept] || { present: 0, seats: 0 };
      deptAgg[dept].seats += seats;
      const ca = courseAgg.get(l.courseId) || { present: 0, seats: 0, lectures: 0 };
      ca.seats += seats;
      ca.lectures += 1;
      courseAgg.set(l.courseId, ca);
    });
    presentRecords.forEach((a) => {
      const dept = courseById.get(a.courseId)?.department || "General";
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

    const weeks = lastWeeks(8);
    const weekly = Object.fromEntries(weeks.map((w) => [w, { present: 0, seats: 0 }]));
    const lectureWeek = new Map();
    heldLectures.forEach((l) => {
      const start = startOf(l);
      const w = start ? weekKey(start) : null;
      lectureWeek.set(l.id, w);
      if (w && weekly[w]) weekly[w].seats += seatsOf(l.courseId);
    });
    presentRecords.forEach((a) => {
      const w = lectureWeek.get(a.lectureId);
      if (w && weekly[w]) weekly[w].present += 1;
    });

    const byLecturer = {};
    heldLectures.forEach((l) => {
      if (!l.hostId) return;
      byLecturer[l.hostId] = byLecturer[l.hostId] || { lecturesDelivered: 0, online: 0, physical: 0 };
      byLecturer[l.hostId].lecturesDelivered += 1;
      byLecturer[l.hostId][l.lectureType === "Physical" ? "physical" : "online"] += 1;
    });
    const withSyllabus = courses.filter((c) => listLength(c.courseContents) > 0).length;

    professional = {
      assessments: {
        published: published.length,
        drafts: assessments.length - published.length,
        submissions: submissions.length,
        averageScorePct: avg(scorePcts),
        passRatePct: pct(scorePcts.filter((p) => p >= 40).length, scorePcts.length),
        flaggedSubmissions: submissions.filter((s) => s.isFlagged).length,
        impersonationBlocked: submissions.filter((s) => s.verificationStatus === "Impersonation_Detected").length,
        scoreBands: bands(scorePcts),
      },
      lms: {
        coursesWithSyllabus: withSyllabus,
        syllabusCoveragePct: pct(withSyllabus, courses.length),
        materialsUploaded: courses.reduce((s, c) => s + listLength(c.resources), 0),
        assignmentsPosted: courses.reduce((s, c) => s + listLength(c.assignments), 0),
      },
      attendance: {
        byDepartment: Object.entries(deptAgg)
          .map(([name, v]) => ({ department: name, attendanceRatePct: pct(v.present, v.seats) }))
          .sort((a, b) => (b.attendanceRatePct ?? 0) - (a.attendanceRatePct ?? 0)),
        topCourses: courseRates.slice(0, 5),
        lowestCourses: courseRates.slice(-5).reverse(),
        weeklyTrend: weeks.map((w) => ({ week: w, attendanceRatePct: pct(weekly[w].present, weekly[w].seats) })),
        exceptionsApproved: exceptions.filter((e) => e.status === "approved").length,
        exceptionsPending: exceptions.filter((e) => e.status === "pending").length,
      },
      lecturers: take(
        Object.entries(byLecturer)
          .map(([uid, v]) => ({ uid, name: fullName(userById.get(uid)), ...v }))
          .sort((a, b) => b.lecturesDelivered - a.lecturesDelivered),
        8,
      ),
    };
  }

  // ---- Enterprise -------------------------------------------------------------
  let enterprise = null;
  if (access.enterprise) {
    const possibleByCourse = new Map();
    assessments
      .filter((a) => a.isPublished !== false)
      .forEach((a) => possibleByCourse.set(a.courseId, (possibleByCourse.get(a.courseId) || 0) + (Number(a.totalMarks) || 0)));
    const presentByStudent = new Map();
    presentRecords.forEach((a) => presentByStudent.set(a.studentId, (presentByStudent.get(a.studentId) || 0) + 1));
    const excusedByStudent = new Map();
    exceptions
      .filter((e) => e.status === "approved")
      .forEach((e) => excusedByStudent.set(e.studentId, (excusedByStudent.get(e.studentId) || 0) + 1));
    const scoreByStudent = new Map();
    submissions.forEach((s) => scoreByStudent.set(s.studentId, (scoreByStudent.get(s.studentId) || 0) + (Number(s.score) || 0)));
    const expected = new Map();
    const possible = new Map();
    courses.forEach((c) => {
      (Array.isArray(c.studentsEnrolled) ? c.studentsEnrolled : []).forEach((sid) => {
        expected.set(sid, (expected.get(sid) || 0) + (heldByCourse.get(c.courseId) || 0));
        possible.set(sid, (possible.get(sid) || 0) + (possibleByCourse.get(c.courseId) || 0));
      });
    });

    const studentRows = students.map((u) => {
      const exp = expected.get(u.uid) || 0;
      return {
        uid: u.uid,
        name: fullName(u),
        matricNumber: u.matricNumber || "N/A",
        department: u.department || "General",
        level: u.current_level || null,
        attendancePct: pct(Math.min(exp, (presentByStudent.get(u.uid) || 0) + (excusedByStudent.get(u.uid) || 0)), exp),
        scorePct: pct(scoreByStudent.get(u.uid) || 0, possible.get(u.uid) || 0),
      };
    });
    const atRisk = studentRows
      .filter(
        (s) =>
          (s.attendancePct !== null && s.attendancePct < AT_RISK_ATTENDANCE_PCT) ||
          (s.scorePct !== null && s.scorePct < AT_RISK_SCORE_PCT),
      )
      .sort((a, b) => (a.attendancePct ?? 100) + (a.scorePct ?? 100) - ((b.attendancePct ?? 100) + (b.scorePct ?? 100)));

    const deptStats = {};
    studentRows.forEach((s) => {
      const d = (deptStats[s.department] = deptStats[s.department] || { students: 0, att: [], score: [] });
      d.students += 1;
      if (s.attendancePct !== null) d.att.push(s.attendancePct);
      if (s.scorePct !== null) d.score.push(s.scorePct);
    });

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

    // Lectures by weekday (Mon–Sun) and hour (07:00–19:00), school time.
    const HOURS = Array.from({ length: 13 }, (_, i) => 7 + i);
    const heatmap = Array.from({ length: 7 }, () => HOURS.map(() => 0));
    lectureStarts.forEach((start) => {
      const local = new Date(start.getTime() + tzOffsetMinutes(start) * 60000);
      const hourIndex = HOURS.indexOf(local.getUTCHours());
      if (hourIndex >= 0) heatmap[(local.getUTCDay() + 6) % 7][hourIndex] += 1;
    });

    const flagReasons = {};
    submissions.forEach((s) =>
      (Array.isArray(s.flagReasons) ? s.flagReasons : []).forEach((r) => {
        // "3 random identity checks did not match" → one bucket for any count.
        const key = String(r).replace(/^\d+ /, "");
        flagReasons[key] = (flagReasons[key] || 0) + 1;
      }),
    );

    const lecturerLoad = {};
    courses.forEach((c) =>
      (Array.isArray(c.lecturerIds) ? c.lecturerIds : []).forEach((uid) => {
        const row = (lecturerLoad[uid] = lecturerLoad[uid] || { courses: 0, students: 0 });
        row.courses += 1;
        row.students += listLength(c.studentsEnrolled);
      }),
    );

    const levels = {};
    students.forEach((u) => {
      const key = u.current_level ? String(u.current_level) : "Unknown";
      levels[key] = (levels[key] || 0) + 1;
    });

    const exceptionReasons = {};
    exceptions.forEach((e) => {
      const r = e.reasonCategory || "Other";
      exceptionReasons[r] = (exceptionReasons[r] || 0) + 1;
    });
    const sumProctoring = (field) =>
      submissions.reduce((sum, s) => sum + (Number(s.proctoringData?.[field]) || 0), 0);

    enterprise = {
      atRisk: {
        thresholds: { attendancePct: AT_RISK_ATTENDANCE_PCT, scorePct: AT_RISK_SCORE_PCT },
        count: atRisk.length,
        students: take(atRisk, 8),
      },
      attendanceDistribution: bands(studentRows.map((s) => s.attendancePct)),
      departments: Object.entries(deptStats)
        .map(([name, d]) => ({
          department: name,
          students: d.students,
          averageAttendancePct: avg(d.att),
          averageScorePct: avg(d.score),
        }))
        .sort((a, b) => (b.averageScorePct ?? 0) - (a.averageScorePct ?? 0)),
      levels: Object.entries(levels)
        .map(([name, count]) => ({ level: name, students: count }))
        .sort((a, b) => a.level.localeCompare(b.level, undefined, { numeric: true })),
      engagementTrend: weeks.map((w) => ({ week: w, ...engagement[w] })),
      heatmap: { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], hours: HOURS, counts: heatmap },
      lecturerLoad: take(
        Object.entries(lecturerLoad)
          .map(([uid, v]) => ({ uid, name: fullName(userById.get(uid)), ...v }))
          .sort((a, b) => b.students - a.students),
        8,
      ),
      exceptionReasons,
      integrity: {
        flaggedSubmissions: submissions.filter((s) => s.isFlagged).length,
        flagReasons: Object.entries(flagReasons)
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
        identityMismatchesInTests: sumProctoring("identityMismatches"),
        multiplePeopleDetected: sumProctoring("multipleFaceCount"),
        lookAways: sumProctoring("lookAwayCount"),
        testInterruptions: sumProctoring("tabSwitchCount"),
        averageStrikes: avg(submissions.map((s) => Number(s.proctoringData?.totalStrikes) || 0)),
        accountsWithSuspiciousActivity: users.filter((u) => listLength(u.suspiciousActivity) > 0).length,
        suspendedAccounts: users.filter((u) => u.isSuspended).length,
      },
      support: { dedicatedSupport: true, contactEmail: process.env.ENTERPRISE_SUPPORT_EMAIL || null },
    };
  }

  return {
    institution: {
      schoolCode,
      name: institution?.schoolName || institution?.name || schoolCode,
      logo: institution?.logo || null,
      tier,
      tierLabel: TIER_LABELS[tier],
    },
    scope: { department: department || null, departments },
    session: { label: session.label, startsAt: session.startsAt.toISOString() },
    access,
    // What higher tiers add, for upgrade prompts.
    locked: TIERS.slice(level + 1).map((t) => ({ tier: t, label: TIER_LABELS[t], features: SCHOOL_TIER_FEATURES[t] })),
    generatedAt: new Date().toISOString(),
    kpis,
    live,
    basic,
    professional,
    enterprise,
    ...(full
      ? {
          lists: {
            courses: courseRows,
            announcements: announcementRows,
            lectures: lectures
              .filter((l) => l.status !== "cancelled")
              .map(lectureRow)
              .sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt))),
          },
        }
      : {}),
  };
};
