import cron from "node-cron";
import { Course, User, UserDownloads } from "../tableDeclarations.js";
import { createNotification } from "../services/notificationService.js";
import { generateNotificationId } from "../utils/idGenerator.js";

// Runs every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  const now = new Date();
  const targetTime = new Date(now.getTime() + 45 * 60 * 1000);
  const targetDateStr = targetTime.toISOString().split("T")[0];
  const targetHourMin = targetTime.toTimeString().slice(0, 5);

  try {
    const courses = await Course.find({
      Lectures: {
        $elemMatch: {
          date: targetDateStr,
          startTime: targetHourMin,
          status: "scheduled",
        },
      },
    })
      .select("courseCode courseTitle Lectures studentsEnrolled courseId")
      .lean();

    for (const course of courses) {
      const lecture = course.Lectures.find(
        (l) => l.startTime === targetHourMin,
      );
      if (!lecture) continue;
      const students = await User.find({
        uid: { $in: course.studentsEnrolled },
      })
        .select("uid firstname lastname")
        .lean();

      // Notify every enrolled student
      const notifications = students.map((student) => {
        return createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "LECTURE_REMINDER",
          title: `Class Starting Soon: ${course.courseCode}`,
          message: `Your ${lecture.lectureType} lecture on "${lecture.topicName}" starts in 45 minutes at ${lecture.location || "Online"}.`,
          payload: {
            courseId: course.courseId,
            lectureId: lecture.id,
            topicName: lecture.topicName,
            startTime: lecture.startTime,
            location: lecture.location,
          },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      });

      await Promise.all(notifications);
      console.log(
        `[CRON] Reminders sent for ${course.courseCode} - ${lecture.topicName}`,
      );
    }
  } catch (error) {
    console.error("Lecture Reminder Cron Error:", error);
  }
});

cron.schedule(
  "0 9 * * *",
  async () => {
    console.log("Running Inactivity Reminder Cron Job...");
    try {
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const inactiveUsers = await UserDownloads.find({
        lastAccessed: { $lt: threeDaysAgo },
      });
      for (const record of inactiveUsers) {
        const activeCourse = record.ownedProducts
          .sort((a, b) => b.lastWatched - a.lastWatched)
          .find((p) => p.progress < 100);
        if (activeCourse) {
          await createNotification({
            notificationId: generateNotificationId("reminder"),
            recipientId: record.userId,
            category: "academic",
            actionType: "LEARNING_REMINDER",
            title: "Don't break your streak",
            message: `It's been a few days since you accessed your course. Your progress is waiting for you!`,
            sendEmail: false,
            sendPush: true,
            payload: {
              productId: activeCourse.productId,
              currentProgress: activeCourse.progress,
            },
          });
        }
      }
      console.log(
        `Reminder notifications sent to ${inactiveUsers.length} users.`,
      );
    } catch (error) {
      console.error("Cron Job Error:", error);
    }
  },
  {
    scheduled: true,
    timezone: "Africa/Lagos",
  },
);
