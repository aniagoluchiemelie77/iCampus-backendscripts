/**
 * One-off: move stored data onto the new school admin names.
 *
 *   node scripts/migrateSchoolAdminRoles.js          # dry run, prints the plan
 *   node scripts/migrateSchoolAdminRoles.js --apply  # writes it
 *
 *   admins.adminType                "school_administrator" → "school_admin_a"
 *   ads.creatorType                 "school_administrator" → "school_admin_a"
 *   operationalinstitutions.tier    "free" → "basic", "premium" → "enterprise"
 *
 * The code already reads the old values (utils/schoolRoles.js), so this can
 * run any time after the deploy. Safe to run more than once.
 */
import { Admin, Ads, OperationalInstitutions } from "../tableDeclarations.js";
import { LEGACY_SCHOOL_ADMIN, normalizeTier, SCHOOL_ADMIN_A } from "../utils/schoolRoles.js";

const apply = process.argv.includes("--apply");

const main = async () => {
  const [admins, ads, institutions] = await Promise.all([
    Admin.where("adminType", "==", LEGACY_SCHOOL_ADMIN).get(),
    Ads.where("creatorType", "==", LEGACY_SCHOOL_ADMIN).get(),
    OperationalInstitutions.get(),
  ]);
  const changes = [
    ...admins.docs.map((d) => ({ ref: d.ref, label: `admin ${d.id}`, data: { adminType: SCHOOL_ADMIN_A } })),
    ...ads.docs.map((d) => ({ ref: d.ref, label: `ad ${d.id}`, data: { creatorType: SCHOOL_ADMIN_A } })),
    ...institutions.docs
      .filter((d) => d.data().tier !== normalizeTier(d.data().tier))
      .map((d) => ({
        ref: d.ref,
        label: `institution ${d.id} (${d.data().tier ?? "none"})`,
        data: { tier: normalizeTier(d.data().tier) },
      })),
  ];

  changes.forEach((c) => console.log(`${c.label} → ${JSON.stringify(c.data)}`));
  console.log(`${changes.length} document(s) to update.`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply to write.");
    return;
  }
  for (let i = 0; i < changes.length; i += 400) {
    await Promise.all(changes.slice(i, i + 400).map((c) => c.ref.set(c.data, { merge: true })));
  }
  console.log("Done.");
};

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
