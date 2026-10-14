/**
 * firestoreIndexProbe.mjs
 * ---------------------------------------------------------------------------
 * Runs every Firestore query in the codebase that is a composite-index
 * candidate (`.where()` + `.orderBy()`, multiple equality/range filters, or
 * `array-contains` + filters). When Firestore needs a composite index it
 * throws a FAILED_PRECONDITION (code 9) error whose message embeds a
 * ready-to-click console URL for creating the index. This captures those URLs.
 *
 * Run:  node controllertests/firestoreIndexProbe.mjs
 * ---------------------------------------------------------------------------
 */
import {
  Exceptions,
  Notification,
  SupportTicket,
  Assessment,
  Course,
  Ads,
  Product,
  ProductSales,
  Transactions,
} from "../tableDeclarations.js";

// Each probe mirrors the EXACT query shape used in the controllers.
// Dummy filter values are fine — Firestore validates index requirements
// during query planning, before it looks at any matching documents.
const probes = [
  {
    controller: "fetchActions.js",
    endpoint: "fetchLectureExceptions (lecturer view)",
    run: () =>
      Exceptions.where("courseId", "==", "__probe__")
        .orderBy("date", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchAllExceptionsForOngoingLecture",
    run: () =>
      Exceptions.where("lectureId", "==", "__probe__")
        .orderBy("date", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchLectureExceptions (student role)",
    run: () =>
      Exceptions.where("courseId", "==", "__probe__")
        .where("studentId", "==", "__probe__")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchLectureExceptions (lecturer role branch)",
    run: () =>
      Exceptions.where("courseId", "==", "__probe__")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "getNotifications (admin)",
    run: () =>
      Notification.where("category", "==", "__probe__")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchActiveTickets",
    run: () =>
      SupportTicket.where("status", "not-in", ["closed", "resolved"])
        .orderBy("__name__", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchAllCourseAssessments",
    run: () =>
      Assessment.where("courseId", "==", "__probe__")
        .orderBy("updatedAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchStudentsEnrolledCourses (base)",
    run: () =>
      Course.where("studentsEnrolled", "array-contains", "__probe__")
        .where("isActive", "==", true)
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchStudentsEnrolledCourses (+semester)",
    run: () =>
      Course.where("studentsEnrolled", "array-contains", "__probe__")
        .where("isActive", "==", true)
        .where("semester", "==", "First")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchStudentsEnrolledCourses (+session)",
    run: () =>
      Course.where("studentsEnrolled", "array-contains", "__probe__")
        .where("isActive", "==", true)
        .where("session", "==", "2024/2025")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchLecturerEnrolledCourses (base)",
    run: () =>
      Course.where("lecturerIds", "array-contains", "__probe__")
        .where("isActive", "==", true)
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchLecturerEnrolledCourses (+semester+session)",
    run: () =>
      Course.where("lecturerIds", "array-contains", "__probe__")
        .where("isActive", "==", true)
        .where("semester", "==", "First")
        .where("session", "==", "2024/2025")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "fetchCourseLectures auth check (courseId + lecturerIds)",
    run: () =>
      Course.where("courseId", "==", "__probe__")
        .where("lecturerIds", "array-contains", "__probe__")
        .get(),
  },
  {
    controller: "fetchActions.js",
    endpoint: "getAds",
    run: () =>
      Ads.where("isActive", "==", true)
        .orderBy("createdAt", "desc")
        .limit(10)
        .get(),
  },
  {
    controller: "storeControllers.js",
    endpoint: "fetchStoreProducts (default sort)",
    run: () =>
      Product.where("isAvailable", "==", true)
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "storeControllers.js",
    endpoint: "fetchStoreProducts (category filter)",
    run: () =>
      Product.where("isAvailable", "==", true)
        .where("niche", "==", "Electronics")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "storeControllers.js",
    endpoint: "fetchStoreProducts (popular sort)",
    run: () =>
      Product.where("isAvailable", "==", true)
        .orderBy("favCount", "desc")
        .get(),
  },
  {
    controller: "storeControllers.js",
    endpoint: "getSellerSalesHistory",
    run: () =>
      ProductSales.where("sellerId", "==", "__probe__")
        .orderBy("createdAt", "desc")
        .get(),
  },
  {
    controller: "storeControllers.js",
    endpoint: "getPayoutHistory",
    run: () =>
      Transactions.where("userId", "==", "__probe__")
        .where("type", "==", "payout")
        .orderBy("createdAt", "desc")
        .limit(15)
        .get(),
  },
  {
    controller: "webhookControllers.js",
    endpoint: "Postmark inbound ticket lookup",
    run: () =>
      SupportTicket.where("userId", "==", "__probe__")
        .where("status", "!=", "closed")
        .orderBy("status")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get(),
  },
];

const URL_RE = /https:\/\/console\.firebase\.google\.com[^\s"'<>)\]]+/;

function extractIndexUrl(err) {
  const haystack = `${err?.message || ""} ${err?.details || ""} ${
    err?.toString?.() || ""
  }`;
  const match = haystack.match(URL_RE);
  return match ? match[0] : null;
}

async function main() {
  console.log("🔎 Probing Firestore for composite-index requirements...\n");
  const needingIndex = [];
  const ok = [];

  for (const probe of probes) {
    try {
      await probe.run();
      ok.push(probe);
      console.log(
        `✅ OK (index present / not required): [${probe.controller}] ${probe.endpoint}`,
      );
    } catch (err) {
      const code = err?.code;
      const url = extractIndexUrl(err);
      // code 9 === FAILED_PRECONDITION (missing index)
      const isIndexError =
        code === 9 ||
        /requires an index|FAILED_PRECONDITION|index/i.test(err?.message || "");

      if (isIndexError && url) {
        needingIndex.push({ ...probe, url });
        console.log(
          `\n⚠️  NEEDS COMPOSITE INDEX: [${probe.controller}] ${probe.endpoint}`,
        );
        console.log(`    🔗 ${url}\n`);
      } else {
        console.log(
          `❌ ERROR (not an index issue): [${probe.controller}] ${probe.endpoint} -> ${err?.message}`,
        );
      }
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("SUMMARY");
  console.log("=".repeat(72));
  console.log(`Queries needing a composite index : ${needingIndex.length}`);
  console.log(`Queries OK (no index required)     : ${ok.length}`);
  console.log("");

  if (needingIndex.length > 0) {
    console.log("👉 Click each URL below to auto-create the required index:\n");
    needingIndex.forEach((p, i) => {
      console.log(`${i + 1}. [${p.controller}] ${p.endpoint}`);
      console.log(`   ${p.url}\n`);
    });
  } else {
    console.log("No composite indexes are currently missing. 🎉");
  }

  // Firestore may keep the process alive; exit cleanly.
  process.exit(0);
}

main().catch((e) => {
  console.error("Probe crashed:", e);
  process.exit(1);
});
