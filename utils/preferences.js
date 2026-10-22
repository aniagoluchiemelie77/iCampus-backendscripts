import admin from "firebase-admin";

export const DEFAULT_NOTIFICATION_PREFS = {
  auth: true,
  social: true,
  classroom: true,
  store: true,
  finance: true,
  profile: true,
  security: true,
};
export const DEFAULT_CHANNEL_PREFS = { push: true, email: true, socket: true };

const EDITABLE_SECTIONS = {
  notifications: DEFAULT_NOTIFICATION_PREFS,
  channels: DEFAULT_CHANNEL_PREFS,
};

/** Top-level fields literally named "notifications.x" / "channels.x". */
const legacyDottedKeys = (data = {}) =>
  Object.keys(data).filter((key) => {
    const [section, field] = key.split(".");
    return !!EDITABLE_SECTIONS[section] && !!field && key.split(".").length === 2;
  });

/**
 * Preferences with defaults filled in. Toggles used to be saved with
 * `set({"notifications.x": v}, {merge: true})`, which stores a field literally
 * named "notifications.x" and leaves the nested value untouched; those were
 * the user's latest choices, so they win here.
 */
export const normalizePreferences = (data = {}) => {
  const prefs = {
    theme: "light",
    language: "en",
    quietHours: { enabled: false },
    ...data,
    notifications: { ...DEFAULT_NOTIFICATION_PREFS, ...(data.notifications || {}) },
    channels: { ...DEFAULT_CHANNEL_PREFS, ...(data.channels || {}) },
  };
  legacyDottedKeys(data).forEach((key) => {
    const [section, field] = key.split(".");
    if (typeof data[key] === "boolean") prefs[section][field] = data[key];
    delete prefs[key];
  });
  return prefs;
};

/**
 * Turns a PATCH body into a nested, whitelisted update. Accepts
 * {"notifications.social": false} as well as {notifications: {social: false}}.
 * Returns null when nothing valid was sent.
 */
export const buildPreferencesPatch = (body = {}) => {
  const patch = {};
  const put = (section, field, value) => {
    if (!EDITABLE_SECTIONS[section]) return;
    if (!(field in EDITABLE_SECTIONS[section])) return;
    if (typeof value !== "boolean") return;
    patch[section] = { ...(patch[section] || {}), [field]: value };
  };
  Object.entries(body).forEach(([key, value]) => {
    if (key.includes(".")) {
      const [section, field] = key.split(".");
      put(section, field, value);
    } else if (EDITABLE_SECTIONS[key] && value && typeof value === "object") {
      Object.entries(value).forEach(([field, v]) => put(key, field, v));
    }
  });
  ["theme", "language"].forEach((key) => {
    if (typeof body[key] === "string") patch[key] = body[key];
  });
  return Object.keys(patch).length ? patch : null;
};

/** FieldPath deletes for the stray literal dotted fields, for update(). */
export const legacyCleanupArgs = (data = {}) =>
  legacyDottedKeys(data).flatMap((key) => [
    new admin.firestore.FieldPath(key),
    admin.firestore.FieldValue.delete(),
  ]);
