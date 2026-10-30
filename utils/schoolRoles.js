// School administrator roles, plan tiers and seat limits.
//
//   school_admin_a  Institution Representative: whole institution. Invites and
//                   removes B-level reps, school ads, school-wide notifications.
//   school_admin_b  Department Representative: one department's data, and
//                   announcements to that department's students and lecturers.
//
// "school_administrator" is the old name for school_admin_a; stored accounts
// keep working until scripts/migrateSchoolAdminRoles.js has been run.

export const SCHOOL_ADMIN_A = "school_admin_a";
export const SCHOOL_ADMIN_B = "school_admin_b";
export const LEGACY_SCHOOL_ADMIN = "school_administrator";

export const isSchoolAdminA = (adminType) =>
  adminType === SCHOOL_ADMIN_A || adminType === LEGACY_SCHOOL_ADMIN;
export const isSchoolAdminB = (adminType) => adminType === SCHOOL_ADMIN_B;
export const isSchoolAdmin = (adminType) =>
  isSchoolAdminA(adminType) || isSchoolAdminB(adminType);

/** Both spellings, for Firestore `in` queries over stored accounts. */
export const SCHOOL_ADMIN_A_TYPES = [SCHOOL_ADMIN_A, LEGACY_SCHOOL_ADMIN];

export const TIERS = ["basic", "pro", "enterprise"];
const LEGACY_TIERS = { free: "basic", professional: "pro", premium: "enterprise" };

/** Institution plan, with the old free/premium names mapped across. */
export const normalizeTier = (tier) =>
  TIERS.includes(tier) ? tier : LEGACY_TIERS[tier] || "basic";

export const TIER_LABELS = { basic: "Basic", pro: "Professional", enterprise: "Enterprise" };

// null = unlimited. Enterprise gets "2 or more" A-level reps; 5 is a ceiling
// against runaway invites, raise it per contract if needed.
export const SEAT_LIMITS = {
  basic: { a: 1, b: 10 },
  pro: { a: 1, b: 20 },
  enterprise: { a: 5, b: null },
};

/**
 * What an admin may see of a school. B-level reps are pinned to their own
 * department whatever the request asks for; A-level reps (and super admins
 * inspecting a school) may narrow to one department.
 */
export const resolveSchoolScope = (admin, requested = {}) => {
  const adminType = admin?.adminType;
  const schoolCode =
    adminType === "super_admin" ? requested.schoolCode || admin?.schoolCode : admin?.schoolCode;
  if (isSchoolAdminB(adminType)) {
    return { schoolCode, department: admin?.department || null, locked: true };
  }
  const department = String(requested.department || "").trim();
  return { schoolCode, department: department && department !== "all" ? department : null, locked: false };
};

/**
 * The academic session a date falls in. Nigerian sessions start around
 * September, so September 2026 – August 2027 is "2026/2027".
 */
export const academicSession = (date = new Date()) => {
  const year = date.getFullYear();
  const start = date.getMonth() >= 8 ? year : year - 1;
  return {
    label: `${start}/${start + 1}`,
    startYear: start,
    startsAt: new Date(start, 8, 1),
    endsAt: new Date(start + 1, 8, 1),
  };
};

/** "2026/2027", "2026-27" and "2026 / 2027" all → 2026; null when unreadable. */
export const sessionStartYear = (session) => {
  const match = String(session || "").match(/(\d{4})/);
  return match ? Number(match[1]) : null;
};

/** iCampus school analytics start with the 2026/2027 session. */
export const FIRST_SESSION_START_YEAR = 2026;

export const sessionForStartYear = (startYear) => academicSession(new Date(startYear, 8, 1));

/** Sessions a school can view, newest first: the current one back to 2026/2027. */
export const availableSessions = (date = new Date()) => {
  const current = academicSession(date).startYear;
  const sessions = [];
  for (let y = current; y >= Math.min(FIRST_SESSION_START_YEAR, current); y--) sessions.push(`${y}/${y + 1}`);
  return sessions;
};

/** The requested session ("2026/2027"), or the current one if it's missing or out of range. */
export const resolveSession = (requested) => {
  const current = academicSession();
  const year = sessionStartYear(requested);
  if (year === null || year < FIRST_SESSION_START_YEAR || year > current.startYear) return current;
  return sessionForStartYear(year);
};
