import cron from "node-cron";
import { handleUpcomingAssessmentRemindersCron } from "../controllers/classActions.js";

let running = false;

export const assessmentReminderCron = () => {
  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await handleUpcomingAssessmentRemindersCron();
    } catch (error) {
      console.error("Assessment Reminder Cron Error:", error);
    } finally {
      running = false;
    }
  });
};
