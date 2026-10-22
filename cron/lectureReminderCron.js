import cron from "node-cron";
import { handleUpcomingLectureRemindersCron } from "../controllers/classActions.js";

let running = false;

export const lectureReminderCron = () => {
  // Every minute is cheap (one small query) and means a reminder goes out
  // within a minute of entering the window. The handler sends each lecture's
  // reminder at most once, so overlapping or catch-up runs are safe.
  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await handleUpcomingLectureRemindersCron();
    } catch (error) {
      console.error("Lecture Reminder Cron Error:", error);
    } finally {
      running = false;
    }
  });
};
