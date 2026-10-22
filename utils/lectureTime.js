// Lectures have been stored in several shapes over time:
//   - startTime/endTime as full ISO instants (current app), where repeat
//     weeks used to copy week 1's instant onto every copy;
//   - startTime as a bare "HH:mm" wall-clock time (edit endpoint, legacy);
//   - startAt/endAt as real Dates (written from now on).
// These helpers turn any of them into the actual instant the class starts.

export const LECTURE_TIMEZONE = process.env.LECTURE_TIMEZONE || "Africa/Lagos";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "object" && (value._seconds ?? value.seconds) != null) {
    return new Date(Number(value._seconds ?? value.seconds) * 1000);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

/** Minutes the zone is ahead of UTC at `date` (e.g. +60 for Africa/Lagos). */
export const tzOffsetMinutes = (date, timeZone = LECTURE_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
};

/** "YYYY-MM-DD" of `date` in the lecture time zone. */
export const localDateKey = (date, timeZone = LECTURE_TIMEZONE) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const lectureDateKey = (lecture) => {
  if (typeof lecture?.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(lecture.date)) {
    return lecture.date.slice(0, 10);
  }
  const d = toDate(lecture?.date);
  return d ? d.toISOString().slice(0, 10) : null;
};

/** Wall-clock "HH:mm" on `dateKey` in the lecture zone → instant. */
export const wallClockToDate = (dateKey, hhmm, timeZone = LECTURE_TIMEZONE) => {
  const [y, mo, d] = String(dateKey).split("-").map(Number);
  const [h, mi] = String(hhmm).trim().split(":").map(Number);
  if ([y, mo, d, h].some((n) => Number.isNaN(n))) return null;
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi || 0);
  return new Date(naiveUtc - tzOffsetMinutes(new Date(naiveUtc), timeZone) * 60000);
};

/**
 * The instant a lecture starts ("start") or ends ("end"), or null.
 */
export const resolveLectureTime = (lecture, which = "start") => {
  const explicit = toDate(which === "start" ? lecture?.startAt : lecture?.endAt);
  if (explicit) return explicit;

  const raw = which === "start" ? lecture?.startTime : lecture?.endTime;
  const dateKey = lectureDateKey(lecture);

  if (typeof raw === "string" && /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw.trim())) {
    return dateKey ? wallClockToDate(dateKey, raw) : null;
  }

  const instant = toDate(raw);
  if (!instant || !dateKey) return instant;
  // Repeat-week copies kept week 1's instant; move it onto this copy's date
  // (whole weeks only, so the time of day is preserved).
  const [y, mo, d] = dateKey.split("-").map(Number);
  const weeks = Math.round((Date.UTC(y, mo - 1, d) - instant.getTime()) / WEEK_MS);
  return new Date(instant.getTime() + weeks * WEEK_MS);
};

/** e.g. "10:00 AM" in the lecture zone. */
export const formatLectureClock = (date, timeZone = LECTURE_TIMEZONE) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

/** e.g. "Mon, Oct 19 at 10:00 AM" in the lecture zone. */
export const formatLectureDateTime = (date, timeZone = LECTURE_TIMEZONE) =>
  `${new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date)} at ${formatLectureClock(date, timeZone)}`;
