/**
 * One-off: give courses saved before schoolCode was recorded their schoolCode,
 * matched from the institution's schoolName. Without it the school admin
 * analytics (courses, lectures, attendance) skip them.
 *
 *   node scripts/backfillCourseSchoolCodes.js          # dry run, prints the plan
 *   node scripts/backfillCourseSchoolCodes.js --apply  # writes it
 *
 * Safe to run more than once.
 */
import { Course, OperationalInstitutions } from "../tableDeclarations.js";

const apply = process.argv.includes("--apply");
const key = (s) => String(s || "").trim().toLowerCase();

const main = async () => {
  const [courses, institutions] = await Promise.all([Course.get(), OperationalInstitutions.get()]);
  const codeByName = new Map(
    institutions.docs
      .map((d) => d.data())
      .filter((i) => i.schoolCode && i.schoolName)
      .map((i) => [key(i.schoolName), i.schoolCode]),
  );
  const missing = courses.docs.filter((d) => !d.data().schoolCode);
  const changes = [];
  missing.forEach((d) => {
    const c = d.data();
    const schoolCode = codeByName.get(key(c.schoolName));
    if (schoolCode) changes.push({ ref: d.ref, label: `${c.courseCode || d.id} → ${schoolCode}`, schoolCode });
    else console.log(`skip ${c.courseCode || d.id}: no institution named "${c.schoolName || ""}"`);
  });
  changes.forEach((c) => console.log(`${apply ? "update" : "would update"} ${c.label}`));
  if (apply) await Promise.all(changes.map((c) => c.ref.update({ schoolCode: c.schoolCode })));
  console.log(`${missing.length} without schoolCode, ${changes.length} ${apply ? "updated" : "to update"}.`);
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
