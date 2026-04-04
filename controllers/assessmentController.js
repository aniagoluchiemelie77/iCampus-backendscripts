// controllers/assessmentController.js
import { createNotification } from '../services/notification.js';
import {
  Assessment,
  TestSubmission,
  User,
} from "../tableDeclarations.js";
import { generateNotificationId } from "../utils/idGenerator.js";
export const processAssessmentAnalysis = async (testId) => {
  const test = await Assessment.findOne({ id: testId });
  if (!test || test.isAnalyzed) return;

  const submissions = await TestSubmission.find({ testId });
  const enrolledStudents = await User.find({ enrolledCourses: test.courseId });
  
  const submittedIds = submissions.map(s => s.studentId);
  const absentees = enrolledStudents.filter(s => !submittedIds.includes(s.uid));

  // Update Test status
  test.isAnalyzed = true;
  await test.save();

  // Find the Lecturer
  const lecturer = await User.findOne({ uid: test.lecturerId });

  if (lecturer) {
    await createNotification({
        notificationId: generateNotificationId(),
      recipientId: lecturer.uid,
      recipientEmail: lecturer.email,
      category: 'academic',
      actionType: 'TEST_ANALYSIS_READY',
      title: 'Assessment Report Ready',
      message: `The analysis for "${test.title}" is ready. ${submissions.length} submitted, ${absentees.length} missed.`,
      payload: { 
        testId: test.id, 
        testTitle: test.title,
        submissionCount: submissions.length,
        absenteeCount: absentees.length
      },
      sendEmail: true,   // Reports are high-value; email is appropriate
      sendPush: true,    // Alert the lecturer immediately
      sendSocket: true, 
      saveToDb: true
    });
  }
  
  return { submissions, absentees };
};