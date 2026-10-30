// Super admin and support endpoints:
//   /admins/platform/overview         super admin: a little of everything
//   /admins/platform/directory        super admin: staff admins + A-level school reps
//   /admins/platform/admins/:uid      super admin: one admin's school, reps and activity
//   /admins/platform/activity         super admin: what admins did
//   /admins/platform/notify-admins    super admin: message admins directly
//   /admins/support/overview          support (+ super admin): tickets, inbox, accounts
//   /admins/notify-users              support (+ super admin): message app users directly
//   /admins/inbox                     every admin: notifications sent to them
import { setImmediate } from "timers";
import {
  Admin,
  AdminActivityLog,
  AdminBroadcasts,
  Ads,
  ControllerLog,
  Notification,
  OperationalInstitutions,
  SchoolAuditLog,
  SupportTicket,
  User,
} from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import { toDate } from "../utils/lectureTime.js";
import { isSchoolAdmin, isSchoolAdminA, isSchoolAdminB, normalizeTier, SEAT_LIMITS, TIER_LABELS } from "../utils/schoolRoles.js";
import { buildFinanceOverview, schoolBillingRow } from "../utils/financeAnalytics.js";
import { attachmentPayload, parseAttachments } from "../utils/notificationAttachments.js";
import { recordAdminActivity } from "../utils/adminActivity.js";

const DAY = 86400000;
const STAFF_ROLES = ["super_admin", "finance", "support", "moderator", "analyst", "social_media"];
const time = (v) => toDate(v)?.getTime() || 0;
const iso = (v) => toDate(v)?.toISOString() || null;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const fullName = (a) => [a?.firstname, a?.lastname].filter(Boolean).join(" ").trim() || a?.organizationName || "Administrator";
const listLength = (v) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);

const requireRole = (roles) => (req, res) => {
  if (!roles.includes(req.admin?.adminType)) {
    res.status(403).json({ error: "You don't have access to this." });
    return false;
  }
  return true;
};
const requireSuper = requireRole(["super_admin"]);
const requireSupport = requireRole(["super_admin", "support"]);

const paginate = (list, query) => {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const totalPages = Math.max(1, Math.ceil(list.length / limit));
  const page = Math.min(totalPages, Math.max(1, parseInt(query.page, 10) || 1));
  return { items: list.slice((page - 1) * limit, page * limit), total: list.length, page, totalPages };
};

/** Last `n` calendar days (oldest first) as YYYY-MM-DD keys. */
const lastDays = (n) =>
  Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * DAY).toISOString().slice(0, 10));
const lastMonths = (n) => {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return { key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`, start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
  });
};

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const ticketStats = (tickets) => {
  const days = lastDays(14);
  const perDay = Object.fromEntries(days.map((d) => [d, { opened: 0, resolved: 0 }]));
  tickets.forEach((t) => {
    const created = iso(t.createdAt)?.slice(0, 10);
    if (perDay[created]) perDay[created].opened += 1;
    if (["resolved", "closed"].includes(t.status)) {
      const done = iso(t.updatedAt)?.slice(0, 10);
      if (perDay[done]) perDay[done].resolved += 1;
    }
  });
  const open = tickets.filter((t) => ["open", "pending"].includes(t.status));
  const tally = (list, key, fallback) =>
    Object.entries(
      list.reduce((acc, t) => {
        const k = String(t[key] || fallback);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    )
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  const oldest = open.reduce((min, t) => Math.min(min, time(t.createdAt) || Infinity), Infinity);
  return {
    total: tickets.length,
    byStatus: ["open", "pending", "resolved", "closed"].map((s) => ({ status: s, count: tickets.filter((t) => t.status === s).length })),
    openCount: open.length,
    emailOpen: open.filter((t) => t.source === "email").length,
    bySeverity: tally(open, "severity", "unrated"),
    byCategory: tally(open, "category", "general"),
    bySource: tally(tickets, "source", "app"),
    oldestOpenHours: Number.isFinite(oldest) ? Math.round((Date.now() - oldest) / 3600000) : null,
    daily: days.map((d) => ({ day: d, ...perDay[d] })),
    recentEmails: open
      .filter((t) => t.source === "email")
      .sort((a, b) => time(b.updatedAt || b.createdAt) - time(a.updatedAt || a.createdAt))
      .slice(0, 6)
      .map((t) => ({
        ticketRefId: t.ticketRefId,
        from: t.guestEmail || t.userId,
        summary: t.summary || "Email inquiry",
        severity: t.severity || null,
        status: t.status,
        updatedAt: iso(t.updatedAt || t.createdAt),
        messages: listLength(t.thread),
      })),
  };
};

const healthStats = (logs) => {
  const days = lastDays(7);
  const perDay = Object.fromEntries(days.map((d) => [d, { requests: 0, errors: 0, latency: 0 }]));
  const byAction = {};
  logs.forEach((l) => {
    const day = iso(l.createdAt)?.slice(0, 10);
    const lat = Number(l.latency) || 0;
    if (perDay[day]) {
      perDay[day].requests += 1;
      perDay[day].latency += lat;
      if (l.status === "error") perDay[day].errors += 1;
    }
    const key = l.controllerName || l.action || "unknown";
    const row = (byAction[key] = byAction[key] || { name: key, requests: 0, errors: 0, latency: 0, lastError: null });
    row.requests += 1;
    row.latency += lat;
    if (l.status === "error") {
      row.errors += 1;
      row.lastError = row.lastError || (l.cause ? String(l.cause).slice(0, 160) : null);
    }
  });
  const actions = Object.values(byAction).map((a) => ({ ...a, avgLatency: Math.round(a.latency / a.requests), errorRatePct: pct(a.errors, a.requests) }));
  const errors = logs.filter((l) => l.status === "error").length;
  const avgLatency = logs.length ? Math.round(logs.reduce((s, l) => s + (Number(l.latency) || 0), 0) / logs.length) : 0;
  const sorted = logs.map((l) => Number(l.latency) || 0).sort((a, b) => a - b);
  return {
    sample: logs.length,
    avgLatency,
    p95Latency: sorted.length ? sorted[Math.floor(sorted.length * 0.95) - (sorted.length > 1 ? 1 : 0)] : 0,
    errorRatePct: pct(errors, logs.length),
    errors,
    daily: days.map((d) => ({
      day: d,
      requests: perDay[d].requests,
      errors: perDay[d].errors,
      avgLatency: perDay[d].requests ? Math.round(perDay[d].latency / perDay[d].requests) : null,
    })),
    slowest: [...actions].sort((a, b) => b.avgLatency - a.avgLatency).slice(0, 5),
    failing: actions.filter((a) => a.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 5),
  };
};

// ---------------------------------------------------------------------------
// Super admin overview
// ---------------------------------------------------------------------------

export const getPlatformOverview = async (req, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const since7 = new Date(Date.now() - 7 * DAY);
    const [usersSnap, schoolsSnap, ticketsSnap, logsSnap, adsSnap, adminsSnap, finance] = await Promise.all([
      User.select("uid", "usertype", "schoolCode", "createdAt", "isVerified", "isSuspended", "isSubscribed", "tier", "suspiciousActivity", "country").get(),
      OperationalInstitutions.get(),
      SupportTicket.get(),
      ControllerLog.where("createdAt", ">=", since7).get(),
      Ads.get(),
      Admin.get(),
      buildFinanceOverview({}).catch((err) => {
        console.error("Platform overview finance error:", err.message);
        return null;
      }),
    ]);
    const users = usersSnap.docs.map((d) => d.data());
    const months = lastMonths(6);
    const signups = months.map((m) => {
      const joined = users.filter((u) => {
        const d = toDate(u.createdAt);
        return d && d >= m.start && d < m.end;
      });
      return {
        month: m.key,
        students: joined.filter((u) => u.usertype === "student").length,
        lecturers: joined.filter((u) => u.usertype === "lecturer").length,
        others: joined.filter((u) => !["student", "lecturer"].includes(u.usertype)).length,
      };
    });
    const byType = ["student", "lecturer", "enterprise", "regular"].map((t) => ({
      type: t,
      count: users.filter((u) => (t === "regular" ? !["student", "lecturer", "enterprise"].includes(u.usertype) : u.usertype === t)).length,
    }));

    // Average school: members per institution, from users linked to a school.
    const schools = schoolsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const perSchool = new Map(schools.map((s) => [s.schoolCode || s.id, { students: 0, lecturers: 0, verified: 0, members: 0 }]));
    users.forEach((u) => {
      const row = perSchool.get(u.schoolCode);
      if (!row) return;
      row.members += 1;
      if (u.usertype === "student") row.students += 1;
      if (u.usertype === "lecturer") row.lecturers += 1;
      if (u.isVerified) row.verified += 1;
    });
    const schoolRows = schools.map((s) => ({ ...schoolBillingRow(s), ...perSchool.get(s.schoolCode || s.id) }));
    const avg = (key) => (schoolRows.length ? Math.round(schoolRows.reduce((sum, s) => sum + (s[key] || 0), 0) / schoolRows.length) : 0);

    const admins = adminsSnap.docs.map((d) => d.data());
    const ads = adsSnap.docs.map((d) => d.data());
    const now = Date.now();
    const adActive = (a) => a.isActive !== false && (!toDate(a.expiresAt) || toDate(a.expiresAt).getTime() > now);

    res.json({
      generatedAt: new Date().toISOString(),
      users: {
        total: users.length,
        newThisMonth: signups[signups.length - 1].students + signups[signups.length - 1].lecturers + signups[signups.length - 1].others,
        newLastMonth: signups[signups.length - 2].students + signups[signups.length - 2].lecturers + signups[signups.length - 2].others,
        verifiedPct: pct(users.filter((u) => u.isVerified).length, users.length),
        suspended: users.filter((u) => u.isSuspended).length,
        flagged: users.filter((u) => listLength(u.suspiciousActivity) > 0).length,
        subscribed: users.filter((u) => u.isSubscribed).length,
        byType,
        signups,
      },
      institutions: {
        total: schools.length,
        byTier: ["basic", "pro", "enterprise"].map((t) => ({ tier: t, label: TIER_LABELS[t], count: schoolRows.filter((s) => s.tier === t).length })),
        averageStudents: avg("students"),
        averageLecturers: avg("lecturers"),
        averageVerificationPct: pct(
          schoolRows.reduce((s, r) => s + (r.verified || 0), 0),
          schoolRows.reduce((s, r) => s + (r.members || 0), 0),
        ),
        overdue: schoolRows.filter((s) => s.status === "overdue").length,
        top: [...schoolRows].sort((a, b) => (b.members || 0) - (a.members || 0)).slice(0, 6),
      },
      finance: finance
        ? { period: finance.period, currency: finance.currency, cards: finance.cards, kpis: finance.kpis, monthly: finance.monthly }
        : null,
      support: ticketStats(ticketsSnap.docs.map((d) => d.data())),
      health: healthStats(logsSnap.docs.map((d) => d.data())),
      ads: {
        total: ads.length,
        active: ads.filter(adActive).length,
        schoolAds: ads.filter((a) => a.schoolCode).length,
      },
      admins: {
        total: admins.length,
        activeThisWeek: admins.filter((a) => time(a.lastAccessed) >= since7.getTime()).length,
        byRole: [...STAFF_ROLES, "school_admin_a", "school_admin_b"].map((role) => ({
          role,
          count: admins.filter((a) => (role === "school_admin_a" ? isSchoolAdminA(a.adminType) : a.adminType === role)).length,
        })),
      },
    });
  } catch (err) {
    console.error("getPlatformOverview Error:", err);
    res.status(500).json({ error: "Failed to load the platform overview." });
  }
};

// ---------------------------------------------------------------------------
// Support overview
// ---------------------------------------------------------------------------

export const getSupportOverview = async (req, res) => {
  if (!requireSupport(req, res)) return;
  try {
    const since30 = new Date(Date.now() - 30 * DAY);
    const [ticketsSnap, suspendedSnap, recentUsersSnap, broadcastsSnap] = await Promise.all([
      SupportTicket.get(),
      User.where("isSuspended", "==", true).select("uid", "firstname", "lastname", "username", "updatedAt", "suspiciousActivity").get(),
      User.where("createdAt", ">=", since30).select("uid", "createdAt", "isVerified", "usertype").get(),
      AdminBroadcasts.orderBy("createdAt", "desc").limit(5).get(),
    ]);
    const recent = recentUsersSnap.docs.map((d) => d.data());
    const days = lastDays(14);
    res.json({
      generatedAt: new Date().toISOString(),
      tickets: ticketStats(ticketsSnap.docs.map((d) => d.data())),
      accounts: {
        suspended: suspendedSnap.size,
        recentlySuspended: suspendedSnap.docs
          .map((d) => d.data())
          .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
          .slice(0, 5)
          .map((u) => ({ uid: u.uid, name: fullName(u), username: u.username || null, flags: listLength(u.suspiciousActivity) })),
        newLast30Days: recent.length,
        unverifiedNew: recent.filter((u) => !u.isVerified).length,
        signupsDaily: days.map((day) => ({ day, count: recent.filter((u) => iso(u.createdAt)?.slice(0, 10) === day).length })),
      },
      broadcasts: broadcastsSnap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: iso(d.data().createdAt) })),
    });
  } catch (err) {
    console.error("getSupportOverview Error:", err);
    res.status(500).json({ error: "Failed to load the support overview." });
  }
};

// ---------------------------------------------------------------------------
// Admin directory, profile and activity (super admin)
// ---------------------------------------------------------------------------

const adminView = (a) => ({
  uid: a.uid,
  firstname: a.firstname || "",
  lastname: a.lastname || "",
  email: a.email || "",
  adminType: isSchoolAdminA(a.adminType) ? "school_admin_a" : a.adminType || "",
  profilePic: a.profilePic || [],
  isVerified: a.isVerified !== false,
  schoolCode: a.schoolCode || null,
  department: a.department || null,
  organizationName: a.organizationName || null,
  lastAccessed: iso(a.lastAccessed),
  createdAt: iso(a.createdAt),
  invitedBy: a.invitedBy || null,
});

export const getAdminDirectory = async (req, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const [adminsSnap, schoolsSnap] = await Promise.all([Admin.get(), OperationalInstitutions.get()]);
    const admins = adminsSnap.docs.map((d) => d.data());
    const schools = new Map(schoolsSnap.docs.map((d) => [d.data().schoolCode || d.id, { id: d.id, ...d.data() }]));
    const repsBySchool = {};
    admins.filter((a) => isSchoolAdminB(a.adminType)).forEach((a) => (repsBySchool[a.schoolCode] = (repsBySchool[a.schoolCode] || 0) + 1));

    const schoolAdmins = admins
      .filter((a) => isSchoolAdminA(a.adminType))
      .map((a) => {
        const school = schools.get(a.schoolCode);
        const tier = normalizeTier(school?.tier);
        return {
          ...adminView(a),
          schoolName: school?.schoolName || a.organizationName || a.schoolCode || "Unlinked",
          schoolLogo: school?.logo || null,
          tier,
          tierLabel: TIER_LABELS[tier],
          bRepsAdded: repsBySchool[a.schoolCode] || 0,
          bRepsLimit: SEAT_LIMITS[tier].b,
          billingStatus: school ? schoolBillingRow(school).status : "not_set",
        };
      })
      .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
    res.json({
      admins: admins
        .filter((a) => !isSchoolAdmin(a.adminType))
        .map(adminView)
        .sort((a, b) => STAFF_ROLES.indexOf(a.adminType) - STAFF_ROLES.indexOf(b.adminType) || a.firstname.localeCompare(b.firstname)),
      schoolAdmins,
      departmentReps: admins.filter((a) => isSchoolAdminB(a.adminType)).length,
    });
  } catch (err) {
    console.error("getAdminDirectory Error:", err);
    res.status(500).json({ error: "Failed to load administrators." });
  }
};

/** One admin's actions, newest first: the portal-wide log and the school audit log. */
const loadActivity = async (uid, limit = 200) => {
  const [adminSnap, schoolSnap] = await Promise.all([
    AdminActivityLog.where("actorUid", "==", uid).limit(500).get(),
    SchoolAuditLog.where("actorUid", "==", uid).limit(500).get(),
  ]);
  return [
    ...adminSnap.docs.map((d) => ({ id: d.id, source: "portal", ...d.data() })),
    ...schoolSnap.docs.map((d) => ({ id: d.id, source: "school", ...d.data() })),
  ]
    .map((e) => ({ ...e, createdAt: iso(e.createdAt) }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
};

export const getAdminProfile = async (req, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const snap = await Admin.where("uid", "==", req.params.uid).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "Administrator not found." });
    const target = snap.docs[0].data();
    let school = null;
    let reps = [];
    if (target.schoolCode) {
      const [directDoc, byCodeSnap, repsSnap] = await Promise.all([
        OperationalInstitutions.doc(String(target.schoolCode)).get(),
        OperationalInstitutions.where("schoolCode", "==", target.schoolCode).limit(1).get(),
        Admin.where("schoolCode", "==", target.schoolCode).get(),
      ]);
      const schoolDoc = directDoc.exists ? directDoc : byCodeSnap.docs[0];
      if (schoolDoc) {
        const data = schoolDoc.data();
        const tier = normalizeTier(data.tier);
        school = { ...schoolBillingRow({ id: schoolDoc.id, ...data }), seats: SEAT_LIMITS[tier] };
      }
      reps = repsSnap.docs
        .map((d) => d.data())
        .filter((a) => isSchoolAdmin(a.adminType) && a.uid !== target.uid)
        .map((a) => ({ ...adminView(a), addedByThisAdmin: a.invitedBy === target.uid }))
        .sort((a, b) => a.adminType.localeCompare(b.adminType) || String(a.department).localeCompare(String(b.department)));
    }
    const inviter = target.invitedBy ? await Admin.where("uid", "==", target.invitedBy).limit(1).get() : null;
    const activity = await loadActivity(target.uid, 30);
    res.json({
      admin: adminView(target),
      invitedBy: inviter && !inviter.empty ? adminView(inviter.docs[0].data()) : null,
      school,
      reps,
      activity,
      stats: {
        actionsLast30Days: activity.filter((a) => time(a.createdAt) >= Date.now() - 30 * DAY).length,
        exports: activity.filter((a) => a.action === "data_exported").length,
      },
    });
  } catch (err) {
    console.error("getAdminProfile Error:", err);
    res.status(500).json({ error: "Failed to load this administrator." });
  }
};

export const getAdminActivity = async (req, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const actorUid = String(req.query.actorUid || "").trim();
    const entries = actorUid
      ? await loadActivity(actorUid, 1000)
      : (await AdminActivityLog.orderBy("createdAt", "desc").limit(500).get()).docs.map((d) => ({
          id: d.id,
          source: "portal",
          ...d.data(),
          createdAt: iso(d.data().createdAt),
        }));
    const role = String(req.query.role || "all");
    res.json(paginate(entries.filter((e) => role === "all" || e.actorType === role), req.query));
  } catch (err) {
    console.error("getAdminActivity Error:", err);
    res.status(500).json({ error: "Failed to load activity." });
  }
};

// ---------------------------------------------------------------------------
// Direct notifications
// ---------------------------------------------------------------------------

const readMessage = (body) => {
  const title = String(body?.title || "").trim();
  const message = String(body?.message || "").trim();
  const { attachments, error } = parseAttachments(body?.attachments);
  if (error) return { error };
  if (title.length < 3 || title.length > 80) return { error: "Title must be 3–80 characters." };
  const min = attachments.length ? 0 : 3;
  if (message.length < min || message.length > 1000) return { error: `Message must be ${min}–1000 characters.` };
  return { title, message: message || "Open to view the attachment.", attachments };
};

export const notifyAdminsDirectly = async (req, res) => {
  if (!requireSuper(req, res)) return;
  const parsed = readMessage(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const uids = Array.isArray(req.body?.uids) ? req.body.uids.map(String).filter(Boolean).slice(0, 200) : [];
  const roles = Array.isArray(req.body?.roles)
    ? req.body.roles.filter((r) => [...STAFF_ROLES, "school_admin_a", "school_admin_b"].includes(r))
    : [];
  if (!uids.length && !roles.length) return res.status(400).json({ error: "Choose who receives this." });
  // Stored A-level reps may still have the legacy name.
  const roleTargets = roles.includes("school_admin_a") ? [...roles, "school_administrator"] : roles;
  try {
    const results = await notifyAdmins(
      uids.length ? { uids } : { role: roleTargets },
      {
        notificationId: generateNotificationId("system"),
        category: "system",
        actionType: "ADMIN_DIRECT_MESSAGE",
        title: parsed.title,
        message: parsed.message,
        senderId: req.admin.uid,
        payload: { from: `${fullName(req.admin)} (Super Admin)`, ...attachmentPayload(parsed.attachments) },
      },
      false,
    );
    const delivered = results.filter(Boolean).length;
    res.json({ message: `Sent to ${delivered} administrator${delivered === 1 ? "" : "s"}.`, delivered });
    recordAdminActivity(req, "admins notified", { uids: uids.length, roles, title: parsed.title, delivered });
  } catch (err) {
    console.error("notifyAdminsDirectly Error:", err);
    res.status(500).json({ error: "Failed to send the message." });
  }
};

const BROADCAST_BATCH = 25;
const MAX_DIRECT_USERS = 50;

/**
 * Support (and super admins) message app users: specific users, a whole
 * school, or a user type. Only super admins may message everyone.
 */
export const notifyUsersDirectly = async (req, res) => {
  if (!requireSupport(req, res)) return;
  const parsed = readMessage(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const target = String(req.body?.target || "users");
  const superAdmin = req.admin.adminType === "super_admin";
  try {
    let recipients = [];
    let targetLabel = "";
    if (target === "users") {
      const uids = [...new Set((Array.isArray(req.body?.uids) ? req.body.uids : []).map(String).filter(Boolean))];
      if (!uids.length) return res.status(400).json({ error: "Choose at least one user." });
      if (uids.length > MAX_DIRECT_USERS) return res.status(400).json({ error: `Message at most ${MAX_DIRECT_USERS} users at once.` });
      recipients = uids;
      targetLabel = `${uids.length} selected user${uids.length === 1 ? "" : "s"}`;
    } else if (target === "school") {
      const schoolCode = String(req.body?.schoolCode || "").trim();
      if (!schoolCode) return res.status(400).json({ error: "Choose a school." });
      const snap = await User.where("schoolCode", "==", schoolCode).select("uid", "isSuspended").get();
      recipients = snap.docs.map((d) => d.data()).filter((u) => u.uid && !u.isSuspended).map((u) => u.uid);
      targetLabel = `everyone at ${schoolCode}`;
    } else if (target === "usertype") {
      const usertype = String(req.body?.usertype || "");
      if (!["student", "lecturer", "enterprise", "regular"].includes(usertype)) return res.status(400).json({ error: "Choose a user type." });
      if (!superAdmin) return res.status(403).json({ error: "Only super admins can message a whole user type." });
      const snap = await User.where("usertype", "==", usertype).select("uid", "isSuspended").get();
      recipients = snap.docs.map((d) => d.data()).filter((u) => u.uid && !u.isSuspended).map((u) => u.uid);
      targetLabel = `all ${usertype}s`;
    } else if (target === "all") {
      if (!superAdmin) return res.status(403).json({ error: "Only super admins can message every user." });
      const snap = await User.select("uid", "isSuspended").get();
      recipients = snap.docs.map((d) => d.data()).filter((u) => u.uid && !u.isSuspended).map((u) => u.uid);
      targetLabel = "every user";
    } else {
      return res.status(400).json({ error: "Unknown audience." });
    }
    if (!recipients.length) return res.status(400).json({ error: "No one matches that audience." });

    const ref = AdminBroadcasts.doc();
    const record = {
      id: ref.id,
      senderUid: req.admin.uid,
      senderName: fullName(req.admin),
      senderType: req.admin.adminType,
      title: parsed.title,
      message: parsed.message,
      attachments: parsed.attachments,
      target,
      targetLabel,
      recipientCount: recipients.length,
      status: "sending",
      createdAt: new Date(),
    };
    await ref.set(record);
    res.status(202).json({ message: `Sending to ${recipients.length.toLocaleString()} ${recipients.length === 1 ? "person" : "people"}.`, broadcast: record });
    recordAdminActivity(req, "users notified", { broadcastId: ref.id, target, targetLabel, recipients: recipients.length });

    setImmediate(async () => {
      let delivered = 0;
      const payload = { from: "iCampus Support", ...attachmentPayload(parsed.attachments) };
      for (let i = 0; i < recipients.length; i += BROADCAST_BATCH) {
        const results = await Promise.allSettled(
          recipients.slice(i, i + BROADCAST_BATCH).map((recipientId) =>
            createNotification({
              notificationId: generateNotificationId("system"),
              recipientId,
              category: "system",
              actionType: "ADMIN_BROADCAST",
              title: parsed.title,
              message: parsed.message,
              entityId: ref.id,
              entityType: "admin_broadcast",
              payload,
            }),
          ),
        );
        delivered += results.filter((r) => r.status === "fulfilled" && r.value).length;
      }
      await ref.set({ status: "sent", delivered, completedAt: new Date() }, { merge: true }).catch(() => {});
    });
  } catch (err) {
    console.error("notifyUsersDirectly Error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to send the notification." });
  }
};

export const getBroadcasts = async (req, res) => {
  if (!requireSupport(req, res)) return;
  try {
    const snap = await AdminBroadcasts.orderBy("createdAt", "desc").limit(200).get();
    res.json(paginate(snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: iso(d.data().createdAt) })), req.query));
  } catch (err) {
    console.error("getBroadcasts Error:", err);
    res.status(500).json({ error: "Failed to load sent notifications." });
  }
};

/** The signed-in admin's own notifications (direct messages from super admins, alerts). */
export const getAdminInbox = async (req, res) => {
  try {
    const snap = await Notification.where("recipientId", "==", req.admin.uid).limit(200).get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))
      .map((n) => ({ ...n, createdAt: iso(n.createdAt) }));
    res.json(paginate(items, req.query));
  } catch (err) {
    console.error("getAdminInbox Error:", err);
    res.status(500).json({ error: "Failed to load your notifications." });
  }
};
