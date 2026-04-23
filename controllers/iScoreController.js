import { Lectures, TestSubmission, Attendance } from "../tableDeclarations.js";

export const calculateUnifiedIScore = async (user) => {
  const stats = user.monthlyStats;
  const utype = user.usertype;

  if (utype !== "student" && utype !== "lecturer") {
    return user.currentIScore || 5;
  }

  const isLecturer = utype === "lecturer";
  let academicBase = 0;
  let attendanceScore = 0;

  // --- 1. Role-Specific Academic & Attendance Logic ---
  if (isLecturer) {
    // 1. Reputation (35 pts): Based on student feedback (rating 1-5)
    // Higher average reviews = higher academicBase.
    academicBase = (stats.avgReview / 5) * 35;
    // 2. Resource Impact (Bonus pts): Rewarding syllabus & material management
    // We can track this via minutesActive or a new 'impactScore'
    attendanceScore = Math.min((stats.minutesActive / 200) * 15, 15);
  } else {
    // Students: Dynamic Test Performance Ratio
    const submissions = await TestSubmission.find({ studentId: user.uid });
    if (submissions.length > 0) {
      const totalPercentage = submissions.reduce(
        (acc, curr) => acc + curr.score / curr.totalPossibleScore,
        0,
      );
      academicBase = (totalPercentage / submissions.length) * 30;
    }

    // Students: Attendance Ratio
    const totalLectures = await Lectures.countDocuments({
      courseId: { $in: user.coursesEnrolled },
      status: { $in: ["completed", "ongoing"] }, // include ongoing for real-time feel
    });
    const attendedCount = await Attendance.countDocuments({
      studentId: user.uid,
      status: "Present",
    });
    attendanceScore =
      totalLectures > 0
        ? Math.min((attendedCount / totalLectures) * 20, 20)
        : 0;
  }

  // --- 2. Shared Library & AI Logic (Target: 30) ---
  const sessionWeight = isLecturer ? 3.0 : 2.0;
  const librarySessions = Math.min(
    stats.libraryUsageSessions * sessionWeight,
    12,
  );
  const libraryDownloads = Math.min(stats.booksFound * 1.5, 8);
  const aiAssistantUse = Math.min((stats.aiQueries / 40) * 10, 10);
  const techTotal = librarySessions + libraryDownloads + aiAssistantUse;

  // --- 3. Engagement & Reputation ---
  const engagement = isLecturer
    ? 0
    : Math.min((stats.minutesActive / 200) * 20, 20);
  const reputation = (stats.avgReview / 5) * 20;

  // --- 4. Final Calculation ---
  let total =
    academicBase + attendanceScore + techTotal + engagement + reputation;

  // Bonuses
  if (isLecturer) total += user.isVerified ? 10 : 5;
  else total += (user.isCourseRep ? 3 : 0) + (user.isVerified ? 2 : 0);

  // Tier Multiplier
  const tierMultipliers = { free: 1, pro: 1.05, premium: 1.1 };
  total *= tierMultipliers[user.tier] || 1;

  return Math.min(Math.round(total), 100);
};
