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
 * Study level as a comparable key: "100", "100L", "100 Level" and 100 all
 * become "100"; anything without digits is kept lower-cased; empty → null.
 */
export const normalizeLevel = (value) => {
  const text = String(value ?? "").trim();
  if (!text || text.toLowerCase() === "all") return null;
  const digits = text.match(/[0-9]+/);
  return digits ? String(Number(digits[0])) : text.toLowerCase();
};

/**
 * What an admin may see of a school. B-level reps are pinned to their own
 * department whatever the request asks for; A-level reps (and super admins
 * inspecting a school) may narrow to one department. Every school admin,
 * A or B, may narrow to one study level (`level`, null = all levels).
 */
export const resolveSchoolScope = (admin, requested = {}) => {
  const adminType = admin?.adminType;
  const schoolCode =
    adminType === "super_admin" ? requested.schoolCode || admin?.schoolCode : admin?.schoolCode;
  const level = normalizeLevel(requested.level);
  if (isSchoolAdminB(adminType)) {
    return { schoolCode, department: admin?.department || null, level, locked: true };
  }
  const department = String(requested.department || "").trim();
  return { schoolCode, department: department && department !== "all" ? department : null, level, locked: false };
};

// Academic sessions (which one is current, and its dates) live in
// utils/academicCalendar.js: each institution rep sets their own calendar.
