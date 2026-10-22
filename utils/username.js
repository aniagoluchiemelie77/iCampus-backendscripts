import crypto from "crypto";
import { db } from "../config/firebaseAdmin.js";
import { User } from "../tableDeclarations.js";

/**
 * Unique usernames.
 *
 * Every taken username has a reservation doc `usernames/{username}` -> { uid }.
 * Firestore doc ids are unique, and `create()` fails if the doc already
 * exists, so two people racing for the same name can never both get it
 * (a plain "query then write" check can't guarantee that).
 *
 * Usernames are stored lowercase and may only use letters, digits and "_"
 * so they always match the @mention regex (/@(\w+)/) used for posts.
 */
export const Usernames = db.collection("usernames");

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_RULE = /^[a-z][a-z0-9_]{2,19}$/;
const RESERVED = new Set([
  "admin", "administrator", "icampus", "support", "help", "system", "root",
  "moderator", "staff", "official", "security", "null", "undefined", "me",
  "everyone", "here", "iassistant", "settings", "notifications",
]);

export const normalizeUsername = (raw) =>
  String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

/** Returns a human-readable problem with the name, or null when it's valid. */
export const validateUsername = (name) => {
  if (!name) return "Enter a username.";
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return `Usernames are ${USERNAME_MIN}-${USERNAME_MAX} characters long.`;
  }
  if (!/^[a-z]/.test(name)) return "Usernames must start with a letter.";
  if (!USERNAME_RULE.test(name)) {
    return "Use only letters, numbers and underscores (_).";
  }
  if (/__/.test(name)) return "Usernames can't have two underscores in a row.";
  if (RESERVED.has(name)) return "That username is reserved.";
  return null;
};

/** "Ada  O'Neil-Smith" -> "ada_oneil_smith" (fits the rules where possible). */
const slugify = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "");

const fitBase = (base, suffixLength = 0) =>
  base.slice(0, USERNAME_MAX - suffixLength).replace(/_+$/, "");

/** Is the name held by someone other than `uid`? Checks legacy users too. */
const isHeldByOther = async (name, uid, transaction) => {
  const reservationRef = Usernames.doc(name);
  const legacyQuery = User.where("username", "==", name).limit(2);
  const [reservation, legacy] = transaction
    ? await Promise.all([transaction.get(reservationRef), transaction.get(legacyQuery)])
    : await Promise.all([reservationRef.get(), legacyQuery.get()]);
  if (reservation.exists && reservation.data()?.uid !== uid) return true;
  // Accounts created before reservations existed only have the user field.
  return legacy.docs.some((doc) => (doc.data()?.uid || doc.id) !== uid);
};

export const isUsernameAvailable = async (name, uid = null) =>
  !(await isHeldByOther(name, uid));

/** A few free alternatives to offer when the requested name is taken. */
export const suggestUsernames = async (name, uid = null, count = 3) => {
  const base = fitBase(slugify(name) || "user", 4);
  const candidates = new Set();
  const year = String(new Date().getFullYear()).slice(2);
  candidates.add(fitBase(`${base}_${year}`));
  while (candidates.size < count * 3) {
    candidates.add(`${base}${crypto.randomInt(10, 9999)}`.slice(0, USERNAME_MAX));
  }
  const free = [];
  for (const candidate of candidates) {
    if (free.length >= count) break;
    if (validateUsername(candidate)) continue;
    if (await isUsernameAvailable(candidate, uid)) free.push(candidate);
  }
  return free;
};

/**
 * Picks a free username for a new account from its name. The final
 * guarantee is the `create()` of the reservation at signup time; this only
 * makes a collision there very unlikely.
 */
export const generateUsername = async ({ firstname, lastname, organizationName, email }) => {
  const fromName =
    slugify(organizationName) ||
    slugify([firstname, lastname].filter(Boolean).join(" ")) ||
    slugify(String(email || "").split("@")[0]) ||
    "user";
  const base = fitBase(fromName.length >= USERNAME_MIN ? fromName : `${fromName}_user`);
  const tries = [base];
  for (let i = 0; i < 6; i++) {
    const suffix = String(crypto.randomInt(10, 99999));
    tries.push(`${fitBase(base, suffix.length)}${suffix}`);
  }
  for (const candidate of tries) {
    if (validateUsername(candidate)) continue;
    if (await isUsernameAvailable(candidate)) return candidate;
  }
  return `user${crypto.randomInt(100000, 9999999)}`;
};

export class UsernameTakenError extends Error {
  constructor(name) {
    super(`@${name} is already taken.`);
    this.code = "USERNAME_TAKEN";
  }
}

/**
 * Atomically moves `uid` from its current username to `newName`: reserves the
 * new name, frees the old one and updates the user doc in one transaction.
 * Throws UsernameTakenError when someone else holds the name.
 */
export const changeUsername = async ({ uid, userDocRef, newName }) =>
  db.runTransaction(async (t) => {
    const userSnap = await t.get(userDocRef);
    const currentName = normalizeUsername(userSnap.data()?.username);
    if (await isHeldByOther(newName, uid, t)) throw new UsernameTakenError(newName);

    let oldReservation = null;
    if (currentName && currentName !== newName) {
      oldReservation = await t.get(Usernames.doc(currentName));
    }
    // All reads are done; now the writes.
    t.set(Usernames.doc(newName), { uid, createdAt: new Date() });
    if (oldReservation?.exists && oldReservation.data()?.uid === uid) {
      t.delete(oldReservation.ref);
    }
    t.update(userDocRef, {
      username: newName,
      usernameChangedAt: new Date(),
      updatedAt: new Date(),
    });
    return newName;
  });

/** Frees a deleted account's username so someone else can use it. */
export const releaseUsername = async (name, uid) => {
  const key = normalizeUsername(name);
  if (!key) return;
  const ref = Usernames.doc(key);
  const snap = await ref.get();
  if (snap.exists && snap.data()?.uid === uid) await ref.delete();
};
