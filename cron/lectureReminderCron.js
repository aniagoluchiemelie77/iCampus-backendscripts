import cron from "node-cron";
import { handleUpcomingLectureRemindersCron } from "../controllers/classActions.js";

export const lectureReminderCron = () => {
  cron.schedule("*/5 * * * *", async () => {
    try {
      handleUpcomingLectureRemindersCron();
    } catch (error) {
      console.error("Lecture Reminder Cron Error:", error);
    }
  });
};