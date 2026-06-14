import cron from "node-cron";
import {
  handleUpcomingLectureRemindersCron,
  sendInactiveUserReminders,
} from "../controllers/classActions.js";

cron.schedule("*/5 * * * *", async () => {
  try {
    handleUpcomingLectureRemindersCron();
  } catch (error) {
    console.error("Lecture Reminder Cron Error:", error);
  }
});

cron.schedule(
  "0 9 * * *",
  async () => {
    console.log("Running Inactivity Reminder Cron Job...");
    try {
      sendInactiveUserReminders();
    } catch (error) {
      console.error("Cron Job Error:", error);
    }
  },
  {
    scheduled: true,
    timezone: "Africa/Lagos",
  },
);
