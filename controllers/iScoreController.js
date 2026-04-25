import {
  Lectures,
  TestSubmission,
  Attendance,
  User,
  OperationalInstitutions,
} from "../tableDeclarations.js";

const CARRY_FORWARD_WEIGHT = 0.5;

export const updateInstitutionScores = async () => {
  const stats = await User.aggregate([
    { $match: { schoolCode: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: "$schoolCode",
        avgCurrent: { $avg: "$currentIScore" },
        avgPrevious: { $avg: "$previousIScore" },
      },
    },
  ]);
  const instBulkOps = stats.map((stat) => ({
    updateOne: {
      filter: { schoolCode: stat._id },
      update: {
        $set: {
          currentiScoreAvg: stat.avgCurrent,
          previousiScoreAvg: stat.avgPrevious,
        },
      },
    },
  }));

  if (instBulkOps.length > 0) {
    await OperationalInstitutions.bulkWrite(instBulkOps);
  }
};
export const calculateUnifiedIScore = async (user) => {
  const stats = user.monthlyStats;
  const utype = user.usertype;

  // Enterprise users or undefined types still get the floor
  if (utype === "enterprise" || !utype) {
    return user.currentIScore || 5;
  }

  const isLecturer = utype === "lecturer";
  const isStudent = utype === "student";
  const isOther = !isLecturer && !isStudent; // Staff, Alumni, etc.

  let academicBase = 0;
  let attendanceScore = 0;
  let communityScore = 0;

  // --- 1. Role-Specific Logic ---
  if (isLecturer) {
    academicBase = (stats.avgReview / 5) * 35;
    attendanceScore = Math.min((stats.minutesActive / 200) * 15, 15);
  } else if (isStudent) {
    // Student Academic Logic
    const submissions = await TestSubmission.find({ studentId: user.uid });
    if (submissions.length > 0) {
      const totalPercentage = submissions.reduce(
        (acc, curr) => acc + curr.score / curr.totalPossibleScore,
        0,
      );
      academicBase = (totalPercentage / submissions.length) * 30;
    }
    // Student Attendance Logic
    const totalLectures = await Lectures.countDocuments({
      courseId: { $in: user.coursesEnrolled },
      status: { $in: ["completed", "ongoing"] },
    });
    const attendedCount = await Attendance.countDocuments({
      studentId: user.uid,
      status: "Present",
    });
    attendanceScore =
      totalLectures > 0
        ? Math.min((attendedCount / totalLectures) * 20, 20)
        : 0;
  } else if (isOther) {
    // --- NEW: otherUser Logic (Target: 50 pts for this section) ---
    // They are graded on "Community Contribution" (Posts created) and "Social Reach"
    const postCreationScore = Math.min(stats.libraryUsageSessions * 5, 25); // 5 posts = 25 pts
    const reachScore = Math.min((stats.minutesActive / 200) * 25, 25); // Engagement via impressions/activity
    communityScore = postCreationScore + reachScore;
  }

  // --- 2. Shared Library & AI Logic (Target: 30) ---
  const sessionWeight = isLecturer ? 3.0 : 2.0;
  const librarySessions = isOther
    ? 0
    : Math.min(stats.libraryUsageSessions * sessionWeight, 12);
  const libraryDownloads = Math.min(stats.booksFound * 1.5, 8);
  const aiAssistantUse = Math.min((stats.aiQueries / 40) * 10, 10);

  // For 'other', we don't count librarySessions here because it's in 'communityScore'
  const techTotal =
    (isOther ? 0 : librarySessions) + libraryDownloads + aiAssistantUse;

  // --- 3. Engagement & Reputation ---
  // Students/Lecturers use the standard engagement
  const engagement =
    isLecturer || isOther ? 0 : Math.min((stats.minutesActive / 200) * 20, 20);
  const reputation = (stats.avgReview / 5) * 20;

  // --- 4. Final Calculation ---
  let total =
    academicBase +
    attendanceScore +
    communityScore +
    techTotal +
    engagement +
    reputation;

  //Bonuses
  total += user.isVerified ? 5 : 0;

  // Tier Multiplier
  const tierMultipliers = { free: 1, pro: 1.05, premium: 1.1 };
  total *= tierMultipliers[user.tier] || 1;

  // Formula: (50% of Old Score) + (50% of New Month Performance)
  // This prevents the score from dropping to zero while rewarding fresh work.
  const previousScore = user.currentIScore || 0;
  let finalScore =
    previousScore * CARRY_FORWARD_WEIGHT + total * (1 - CARRY_FORWARD_WEIGHT);
  return Math.min(Math.round(finalScore), 100);
};
