/**
 * Payouts may only go to a bank account held in the seller's own name (or,
 * for enterprise accounts, the organization's name). Bank-reported names
 * vary in order, punctuation and truncation ("OKAFOR CHIDI J."), so this
 * compares normalized word sets rather than raw strings.
 */

// Words that don't identify an organization: "Acme Ventures Ltd" must match
// "ACME VENTURES LIMITED" and "ACME VENTURES NIG LTD".
const ORG_FILLER_WORDS = new Set([
  "LTD", "LIMITED", "PLC", "INC", "INCORPORATED", "LLC", "LLP", "CO", "COMPANY",
  "CORP", "CORPORATION", "ENT", "ENTERPRISE", "ENTERPRISES", "NIG", "NIGERIA",
  "INTL", "INTERNATIONAL", "GLOBAL", "THE", "AND", "OF", "RC", "BN",
]);

const tokenize = (value) =>
  String(value || "")
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Banks truncate long names, so "CHIDIEBE" may come back as "CHIDIEB".
 * A prefix of at least 4 letters counts as the same word.
 */
const wordsMatch = (a, b) => {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
};

const containsWord = (words, word) => words.some((w) => wordsMatch(w, word));

/** The name the payout account must carry, for messages and the client. */
export const expectedPayoutName = (user) =>
  user?.usertype === "enterprise" && user?.organizationName
    ? String(user.organizationName).trim()
    : [user?.firstname, user?.lastname].filter(Boolean).join(" ").trim();

/**
 * True when `accountName` (as reported by the bank) belongs to `user`.
 *
 * - Individuals: both the first and last name must appear, in any order;
 *   extra words (middle names) on the bank side are fine.
 * - Organizations: every identifying word of the organization name must
 *   appear (legal suffixes like LTD/LIMITED are ignored).
 */
export const accountNameMatchesUser = (accountName, user) => {
  const accountWords = tokenize(accountName);
  if (!accountWords.length || !user) return false;

  if (user.usertype === "enterprise" && user.organizationName) {
    const orgWords = tokenize(user.organizationName).filter(
      (w) => !ORG_FILLER_WORDS.has(w),
    );
    if (!orgWords.length) return false;
    return orgWords.every((w) => containsWord(accountWords, w));
  }

  const nameWords = [...tokenize(user.firstname), ...tokenize(user.lastname)];
  if (!nameWords.length) return false;
  return nameWords.every((w) => containsWord(accountWords, w));
};
