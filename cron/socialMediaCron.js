import cron from "node-cron";
import { takeSnapshots } from "../utils/socialMedia.js";

/** One snapshot of every connected social account per day (Lagos time). */
export const socialMediaSnapshotCron = () => {
  cron.schedule(
    "15 2 * * *",
    async () => {
      try {
        const { date, results } = await takeSnapshots();
        const failed = results.filter((r) => !r.ok);
        console.log(`Social media snapshot ${date}: ${results.length - failed.length} ok, ${failed.length} failed.`);
      } catch (err) {
        console.error("Social media snapshot cron error:", err.message);
      }
    },
    { timezone: "Africa/Lagos" },
  );
};
