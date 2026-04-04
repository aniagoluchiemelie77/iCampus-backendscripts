import cron from 'node-cron';
import { Course, User } from "../tableDeclarations.js";
import { createNotification } from '../services/notificationService.js';
import { generateNotificationId } from '../utils/idGenerator.js';

// Runs every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  const now = new Date();
  const targetTime = new Date(now.getTime() + 45 * 60 * 1000);
  const targetDateStr = targetTime.toISOString().split('T')[0]; 
  const targetHourMin = targetTime.toTimeString().slice(0, 5); 

  try {
    const courses = await Course.find({
  "Lectures": {
    $elemMatch: {
      date: targetDateStr,
      startTime: targetHourMin,
      status: "scheduled"
    }
  }
}).select("courseCode courseTitle Lectures studentsEnrolled courseId").lean();

    for (const course of courses) {
      const lecture = course.Lectures.find(l => l.startTime === targetHourMin);
  if (!lecture) continue;
  const students = await User.find({ 
    uid: { $in: course.studentsEnrolled } 
  }).select("uid firstname lastname").lean();

      // Notify every enrolled student
      const notifications = students.map(student => {
        return createNotification({
          notificationId: generateNotificationId(),
          recipientId: student.uid,
          category: "classroom",
          actionType: "LECTURE_REMINDER", // Add this case to your notificationService
          title: `Class Starting Soon: ${course.courseCode}`,
          message: `Your ${lecture.lectureType} lecture on "${lecture.topicName}" starts in 45 minutes at ${lecture.location || 'Online'}.`,
          payload: {
            courseId: course.courseId,
            lectureId: lecture.id,
            topicName: lecture.topicName,
            startTime: lecture.startTime,
            location: lecture.location
          },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      });

      await Promise.all(notifications);
      console.log(`[CRON] Reminders sent for ${course.courseCode} - ${lecture.topicName}`);
    }
  } catch (error) {
    console.error("Lecture Reminder Cron Error:", error);
  }
});