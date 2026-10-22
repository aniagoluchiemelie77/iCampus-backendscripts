/**
 * One-off: give every existing user a unique, valid username and create the
 * `usernames/{name}` reservations that signup and profile edits now rely on.
 *
 *   node scripts/backfillUsernames.js          # dry run, prints the plan
 *   node scripts/backfillUsernames.js --apply  # writes it
 *
 * Rules: a valid username (lowercased) is kept by the oldest account that has
 * it; later duplicates, invalid names and missing names get a generated one.
 * Safe to run more than once.
 */
import { User } from "../tableDeclarations.js";
import {
  Usernames,
  normalizeUsername,
  validateUsername,
  generateUsername,
} from "../utils/username.js";

const apply = process.argv.includes("--apply");

const toMillis = (value) =>
  value?.toMillis?.() ?? (value ? new Date(value).getTime() : 0) ?? 0;

const main = async () => {
  const [usersSnap, reservationsSnap] = await Promise.all([
    User.get(),
    Usernames.get(),
  ]);
  const reservedBy = new Map(
    reservationsSnap.docs.map((d) => [d.id, d.data()?.uid]),
  );
  // Oldest accounts first, so they keep a contested name.
  const users = usersSnap.docs.sort(
    (a, b) => toMillis(a.data().createdAt) - toMillis(b.data().createdAt),
  );

  const plan = [];
  for (const doc of users) {
    const data = doc.data();
    const uid = data.uid || doc.id;
    const current = normalizeUsername(data.username);
    const owner = reservedBy.get(current);
    let target = current;

    if (!current || validateUsername(current) || (owner && owner !== uid)) {
      target = await generateUsername(data);
      // generateUsername can't see names planned earlier in this run.
      while (reservedBy.has(target)) target = await generateUsername(data);
    }
    reservedBy.set(target, uid);
    if (target !== data.username || owner !== uid) {
      plan.push({ ref: doc.ref, uid, from: data.username || null, to: target });
    }
  }

  plan.forEach((p) => console.log(`${p.uid}: ${p.from ?? "(none)"} -> ${p.to}`));
  console.log(`\n${plan.length} of ${users.length} users need changes.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write.");
    return;
  }

  for (const p of plan) {
    await Usernames.doc(p.to).set({ uid: p.uid, createdAt: new Date() });
    await p.ref.update({ username: p.to, updatedAt: new Date() });
  }
  console.log("Done.");
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
