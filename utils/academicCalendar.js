// Academic calendar per institution.
//
// Schools in Nigeria and abroad start and end their sessions at different
// times (and strikes stretch them), so dates can't be assumed. The A-level
// institution rep owns the calendar; uploads only suggest.
//
// Stored on OperationalInstitutions.<doc>.academicCalendar:
//   current            { label, startsAt, endsAt|null, setBy, setAt }
//   history            closed sessions, newest first:
//                      { label, startsAt, endsAt, plannedEndsAt, setBy, setAt, closedBy, closedAt }
//   defaultStartMonth  1–12, used only to guess dates for sessions nobody set
//   dismissed          session keys the rep chose not to switch to
//
// Uploaded course registration / allocation forms write one SessionDetections
// doc per (school, session) listing who reported it. A detected session is
// only suggested once enough different people report it, and never applied
// automatically once the rep has set the calendar.
//
// Which session is "current":
//   1. the one the rep set
//   2. a detected session enough people agree on
//   3. the legacy institution.currentAcademicSession (written by older uploads)
//   4. the newest session on at least MIN_COURSES courses
//   5. a default window from defaultStartMonth around today
import admin from "firebase-admin";
import { OperationalInstitutions, SessionDetections } from "../tableDeclarations.js";
import { toDate } from "./lectureTime.js";

export const DEFAULT_START_MONTH = 9; // September, the usual Nigerian start
export const SUGGEST_MIN_REPORTERS = Number(process.env.SESSION_SUGGEST_MIN_REPORTERS) || 5;
export const SUGGEST_MIN_LECTURERS = Number(process.env.SESSION_SUGGEST_MIN_LECTURERS) || 2;
const REPORTER_CAP = 200; // enough to prove consensus; stops the doc growing
const MIN_COURSES = 3;
const MAX_PICKER_SESSIONS = 12;
export const LABEL_MAX_LENGTH = 40;
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** "2026/27", "2026-2027", "2026 / 2027 session" → "2026/2027"; any other label is trimmed as typed. */
export const canonicalSessionLabel = (value) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const pair = text.match(/(\d{4})\s*[/\-–]\s*(\d{4}|\d{2})(?!\d)/);
  if (pair) {
    const start = Number(pair[1]);
    let end = pair[2].length === 2 ? Math.floor(start / 100) * 100 + Number(pair[2]) : Number(pair[2]);
    if (end < start) end += 100; // "2099/00"
    return `${start}/${end}`;
  }
  return text;
};

/** Comparable form of a label: two spellings of the same session share a key. */
export const sessionKey = (value) => canonicalSessionLabel(value)?.toLowerCase() ?? null;

/** First four-digit year in a label, or null ("Fall 2026" → 2026, "Rain semester" → null). */
export const labelYear = (value) => {
  const match = String(value ?? "").match(/(\d{4})/);
  return match ? Number(match[1]) : null;
};

/** Rejects misread years: a form can't be for a session more than a year ahead, or very old. */
export const isPlausibleSession = (label, now = new Date()) => {
  const year = labelYear(label);
  return year !== null && year >= now.getFullYear() - 6 && year <= now.getFullYear() + 1;
};

const validMonth = (value) => {
  const month = Number(value);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
};

/** Guessed dates for a session nobody set: from its first year's start month, for a year. */
const derivedWindow = (label, startMonth) => {
  const year = labelYear(label);
  if (year === null) return null;
  return { startsAt: new Date(year, startMonth - 1, 1), endsAt: new Date(year + 1, startMonth - 1, 1) };
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const readEntry = (entry) => {
  const label = canonicalSessionLabel(entry?.label);
  const startsAt = toDate(entry?.startsAt);
  if (!label || !startsAt) return null;
  return {
    label,
    key: sessionKey(label),
    startsAt,
    endsAt: toDate(entry.endsAt),
    plannedEndsAt: toDate(entry.plannedEndsAt),
    setBy: entry.setBy || null,
    setAt: toDate(entry.setAt),
    closedBy: entry.closedBy || null,
    closedAt: toDate(entry.closedAt),
  };
};

/** The stored calendar, cleaned up: unreadable entries dropped, history newest first. */
export const readCalendar = (institution) => {
  const raw = institution?.academicCalendar || {};
  return {
    current: readEntry(raw.current),
    history: (Array.isArray(raw.history) ? raw.history : [])
      .map(readEntry)
      .filter(Boolean)
      .sort((a, b) => b.startsAt - a.startsAt),
    defaultStartMonth: validMonth(raw.defaultStartMonth) || DEFAULT_START_MONTH,
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.map(String) : [],
    updatedAt: toDate(raw.updatedAt),
    updatedBy: raw.updatedBy || null,
  };
};

/** The institution document (by id, else by schoolCode), or null. */
export const loadInstitutionDoc = async (schoolCode) => {
  const direct = await OperationalInstitutions.doc(String(schoolCode)).get();
  if (direct.exists) return direct;
  const snap = await OperationalInstitutions.where("schoolCode", "==", schoolCode).limit(1).get();
  return snap.empty ? null : snap.docs[0];
};

/** Sessions reported by uploads for one school, with how many people reported each. */
export const loadDetections = async (schoolCode) => {
  const snap = await SessionDetections.where("schoolCode", "==", schoolCode).get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      label: canonicalSessionLabel(d.label),
      key: sessionKey(d.label),
      reporters: Array.isArray(d.reporterUids) ? d.reporterUids.length : 0,
      lecturers: Array.isArray(d.lecturerUids) ? d.lecturerUids.length : 0,
      firstSeenAt: toDate(d.firstSeenAt),
      lastSeenAt: toDate(d.lastSeenAt),
    };
  }).filter((d) => d.label);
};

const hasConsensus = (d) => d.reporters >= SUGGEST_MIN_REPORTERS || d.lecturers >= SUGGEST_MIN_LECTURERS;

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

const defaultSession = (now, startMonth) => {
  const year = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
  const label = startMonth === 1 ? String(year) : `${year}/${year + 1}`;
  return { label, key: sessionKey(label), ...derivedWindow(label, startMonth), source: "default" };
};

/** Is `candidate` a later session than `current`? By year when both have one, else by start date. */
const isNewerThan = (candidate, current, startMonth) => {
  const a = labelYear(candidate.label);
  const b = labelYear(current.label);
  if (a !== null && b !== null) return a > b;
  const window = derivedWindow(candidate.label, startMonth);
  return !!window && window.startsAt > current.startsAt;
};

/**
 * Works out the current session, the sessions a school can pick from, the one
 * being asked for, and what the dashboard should tell the rep.
 *
 * @param institution  the OperationalInstitutions document data
 * @param courses      the school's courses (for sessions recorded before the calendar existed)
 * @param detections   from loadDetections()
 * @param requested    a session label from the request; null = current
 */
export const resolveAcademicSession = ({ institution, courses = [], detections = [], requested = null, now = new Date() }) => {
  const cal = readCalendar(institution);
  const month = cal.defaultStartMonth;
  const official = [cal.current, ...cal.history].filter(Boolean);
  const officialKeys = new Set(official.map((s) => s.key));

  // ---- Current -------------------------------------------------------------
  let current;
  if (cal.current) {
    current = { ...cal.current, source: "admin" };
  } else {
    const consensus = detections
      .filter((d) => hasConsensus(d) && isPlausibleSession(d.label, now))
      .sort((a, b) => labelYear(b.label) - labelYear(a.label) || b.reporters - a.reporters)[0];
    const legacy = canonicalSessionLabel(institution?.currentAcademicSession || institution?.activeAcademicSession);
    const courseCounts = {};
    courses.forEach((c) => {
      const label = canonicalSessionLabel(c.session);
      if (label && isPlausibleSession(label, now)) courseCounts[label] = (courseCounts[label] || 0) + 1;
    });
    const fromCourses = Object.entries(courseCounts)
      .filter(([, n]) => n >= MIN_COURSES)
      .map(([label]) => label)
      .sort((a, b) => labelYear(b) - labelYear(a))[0];

    const pick = consensus
      ? { label: consensus.label, source: "detected" }
      : legacy && isPlausibleSession(legacy, now)
        ? { label: legacy, source: "legacy" }
        : fromCourses
          ? { label: fromCourses, source: "courses" }
          : null;
    const window = pick && derivedWindow(pick.label, month);
    current = window ? { label: pick.label, key: sessionKey(pick.label), ...window, source: pick.source } : defaultSession(now, month);
  }

  // ---- Every session a school can look back at -----------------------------
  // The rep's sessions keep their real dates. Older labels found on courses
  // get guessed dates, clipped so they never overlap a real session.
  const known = new Map();
  [current, ...cal.history.map((s) => ({ ...s, source: "admin" }))].forEach((s) => known.set(s.key, s));
  courses.forEach((c) => {
    const label = canonicalSessionLabel(c.session);
    const key = sessionKey(label);
    if (!label || known.has(key) || !isPlausibleSession(label, now)) return;
    if (!isNewerThan({ label }, current, month) && key !== current.key) {
      const window = derivedWindow(label, month);
      if (window && window.startsAt < current.startsAt) known.set(key, { label, key, ...window, source: "courses" });
    }
  });
  const sessions = [...known.values()].sort((a, b) => b.startsAt - a.startsAt).slice(0, MAX_PICKER_SESSIONS);
  for (let i = 1; i < sessions.length; i++) {
    const newerStart = sessions[i - 1].startsAt;
    if (!sessions[i].endsAt || sessions[i].endsAt > newerStart) sessions[i] = { ...sessions[i], endsAt: newerStart };
  }

  const wanted = sessionKey(requested);
  const session = (wanted && sessions.find((s) => s.key === wanted)) || sessions.find((s) => s.key === current.key);

  // ---- What to tell the rep ------------------------------------------------
  const suggestion = detections
    .filter(
      (d) =>
        d.key !== current.key &&
        !officialKeys.has(d.key) &&
        !cal.dismissed.includes(d.key) &&
        hasConsensus(d) &&
        isPlausibleSession(d.label, now) &&
        isNewerThan(d, current, month),
    )
    .sort((a, b) => labelYear(b.label) - labelYear(a.label) || b.reporters - a.reporters)[0];

  return {
    current: { ...current, isCurrent: true },
    session: { ...session, isCurrent: session.key === current.key },
    sessions: sessions.map((s) => ({ ...s, isCurrent: s.key === current.key })),
    status: {
      isSet: !!cal.current,
      source: current.source,
      // The rep's planned end date has passed but no new session was started.
      overdue: !!(cal.current?.endsAt && cal.current.endsAt < now),
      suggestion: suggestion
        ? { label: suggestion.label, reporters: suggestion.reporters, lecturers: suggestion.lecturers, lastSeenAt: suggestion.lastSeenAt }
        : null,
      defaultStartMonth: month,
    },
  };
};

/**
 * Was `date` within `session`? The current session runs on until a new one
 * starts, whatever end date was planned.
 */
export const inSessionWindow = (date, session) =>
  !!date && date >= session.startsAt && (session.isCurrent || !session.endsAt || date < session.endsAt);

/** A course is in a session by its recorded `session`, else by when it was created. */
export const courseInSession = (course, session) => {
  const key = sessionKey(course.session);
  if (key) return key === session.key;
  return inSessionWindow(toDate(course.createdAt) || toDate(course.updatedAt), session);
};

/** JSON form of a resolved session. */
export const sessionView = (s) =>
  s && {
    label: s.label,
    key: s.key,
    startsAt: s.startsAt?.toISOString?.() ?? null,
    endsAt: s.endsAt?.toISOString?.() ?? null,
    source: s.source || null,
    isCurrent: !!s.isCurrent,
  };

// ---------------------------------------------------------------------------
// Detecting (from uploads)
// ---------------------------------------------------------------------------

const detectionId = (schoolCode, key) => `${schoolCode}__${key.replace(/[^a-z0-9]+/g, "-")}`;

/**
 * Notes that `uid` uploaded a form for each session in `labels`. Misread years
 * are ignored, each person counts once, and a session stops being written to
 * once REPORTER_CAP people have reported it.
 */
export const recordDetectedSessions = async ({ schoolCode, labels, uid, role }) => {
  if (!schoolCode || !uid) return;
  const now = new Date();
  const unique = [...new Set((labels || []).map(canonicalSessionLabel).filter((l) => l && isPlausibleSession(l, now)))];
  await Promise.all(
    unique.map(async (label) => {
      const key = sessionKey(label);
      const ref = SessionDetections.doc(detectionId(schoolCode, key));
      const doc = await ref.get();
      const reporters = doc.exists ? doc.data().reporterUids || [] : [];
      if (reporters.includes(uid) || reporters.length >= REPORTER_CAP) return;
      await ref.set(
        {
          schoolCode,
          key,
          label,
          reporterUids: admin.firestore.FieldValue.arrayUnion(uid),
          ...(role === "lecturer" ? { lecturerUids: admin.firestore.FieldValue.arrayUnion(uid) } : {}),
          ...(doc.exists ? {} : { firstSeenAt: now }),
          lastSeenAt: now,
        },
        { merge: true },
      );
    }),
  );
};

// ---------------------------------------------------------------------------
// Changing (A-level reps and super admins)
// ---------------------------------------------------------------------------

/** A 400-style error the controller turns into a response. */
export class CalendarError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const parseDate = (value, field) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = toDate(value) || new Date(value);
  if (Number.isNaN(date?.getTime?.())) throw new CalendarError(`Enter a valid ${field}.`);
  return date;
};

const cleanLabel = (value) => {
  const label = canonicalSessionLabel(value);
  if (!label || label.length < 2) throw new CalendarError("Enter the session's name, e.g. 2026/2027.");
  if (label.length > LABEL_MAX_LENGTH) throw new CalendarError(`Keep the session name under ${LABEL_MAX_LENGTH} characters.`);
  return label;
};

const checkDates = (startsAt, endsAt, now) => {
  if (startsAt > new Date(now.getTime() + 366 * DAY)) throw new CalendarError("A session can't start more than a year from now.");
  if (endsAt && endsAt <= startsAt) throw new CalendarError("The end date must be after the start date.");
  if (endsAt && endsAt - startsAt > 3 * 366 * DAY) throw new CalendarError("A session can't run longer than three years.");
};

const writeEntry = (s) => ({
  label: s.label,
  startsAt: s.startsAt,
  endsAt: s.endsAt ?? null,
  ...(s.plannedEndsAt !== undefined ? { plannedEndsAt: s.plannedEndsAt ?? null } : {}),
  setBy: s.setBy ?? null,
  setAt: s.setAt ?? null,
  ...(s.closedBy !== undefined ? { closedBy: s.closedBy ?? null, closedAt: s.closedAt ?? null } : {}),
});

const save = (ref, cal, actorUid, extra = {}) =>
  ref.set(
    {
      academicCalendar: {
        current: cal.current ? writeEntry(cal.current) : null,
        history: cal.history.map(writeEntry),
        updatedAt: new Date(),
        updatedBy: actorUid,
        ...extra,
      },
    },
    { merge: true },
  );

/**
 * Starts a new session and closes the current one. The closed session ends
 * when the new one starts, or earlier if the rep had planned an earlier end
 * (a break between sessions).
 */
export const startSession = async (doc, body, actorUid, now = new Date()) => {
  const cal = readCalendar(doc.data());
  const label = cleanLabel(body.label);
  const startsAt = parseDate(body.startsAt, "start date");
  if (!startsAt) throw new CalendarError("Enter the date this session starts.");
  const endsAt = parseDate(body.endsAt, "end date") ?? null;
  checkDates(startsAt, endsAt, now);

  const key = sessionKey(label);
  if ([cal.current, ...cal.history].some((s) => s?.key === key)) {
    throw new CalendarError(`${label} is already on your calendar. Edit it instead of starting it again.`, 409);
  }
  if (cal.current && startsAt <= cal.current.startsAt) {
    throw new CalendarError(`The new session must start after ${cal.current.label} started.`);
  }

  const history = cal.current
    ? [
        {
          ...cal.current,
          plannedEndsAt: cal.current.endsAt ?? null,
          endsAt: cal.current.endsAt && cal.current.endsAt < startsAt ? cal.current.endsAt : startsAt,
          closedBy: actorUid,
          closedAt: now,
        },
        ...cal.history,
      ]
    : cal.history;
  const next = { current: { label, startsAt, endsAt, setBy: actorUid, setAt: now }, history };
  await save(doc.ref, next, actorUid, { dismissed: cal.dismissed.filter((k) => k !== key) });
  return { previous: cal.current, current: next.current };
};

/** Renames the current session or moves its dates. The previous session's end follows a new start date. */
export const updateCurrentSession = async (doc, body, actorUid, now = new Date()) => {
  const cal = readCalendar(doc.data());
  if (!cal.current) throw new CalendarError("Start a session first.", 409);
  const label = body.label !== undefined ? cleanLabel(body.label) : cal.current.label;
  const startsAt = parseDate(body.startsAt, "start date") ?? cal.current.startsAt;
  const endsAt = body.endsAt !== undefined ? parseDate(body.endsAt, "end date") : cal.current.endsAt;
  checkDates(startsAt, endsAt, now);

  const key = sessionKey(label);
  if (cal.history.some((s) => s.key === key)) throw new CalendarError(`${label} is already a past session.`, 409);
  const previous = cal.history[0];
  if (previous && startsAt <= previous.startsAt) {
    throw new CalendarError(`This session must start after ${previous.label} started.`);
  }
  const history = previous && previous.endsAt && previous.endsAt > startsAt
    ? [{ ...previous, endsAt: startsAt }, ...cal.history.slice(1)]
    : cal.history;
  await save(doc.ref, { current: { ...cal.current, label, startsAt, endsAt, setBy: actorUid, setAt: now }, history }, actorUid);
};

/** Undo "start new session": the previous session becomes current again, with its planned end. */
export const undoLastSession = async (doc, actorUid) => {
  const cal = readCalendar(doc.data());
  if (!cal.current) throw new CalendarError("There's no session to undo.", 409);
  const [previous, ...rest] = cal.history;
  const current = previous
    ? { ...previous, endsAt: previous.plannedEndsAt ?? null, plannedEndsAt: undefined, closedBy: undefined }
    : null;
  await save(doc.ref, { current, history: rest }, actorUid);
  return { removed: cal.current, current };
};

export const updateCalendarSettings = async (doc, body, actorUid) => {
  const month = validMonth(body.defaultStartMonth);
  if (!month) throw new CalendarError("Choose the month sessions usually start.");
  await doc.ref.set(
    { academicCalendar: { defaultStartMonth: month, updatedAt: new Date(), updatedBy: actorUid } },
    { merge: true },
  );
};

export const dismissSuggestion = async (doc, label, actorUid) => {
  const key = sessionKey(label);
  if (!key) throw new CalendarError("Which suggestion?");
  await doc.ref.set(
    {
      academicCalendar: {
        dismissed: admin.firestore.FieldValue.arrayUnion(key),
        updatedAt: new Date(),
        updatedBy: actorUid,
      },
    },
    { merge: true },
  );
};
