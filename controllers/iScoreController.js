import {
  Lectures,
  TestSubmission,
  Attendance,
  User,
  OperationalInstitutions,
  Reviews,
} from "../tableDeclarations.js";


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

  if (utype === "enterprise" || !utype) {
    return user.currentIScore || 5;
  }

  const isLecturer = utype === "lecturer";
  const isStudent = utype === "student";
  const isOther = !isLecturer && !isStudent;

  let targetReviewAvg = 0;
  let targetReviewCount = 0;

  try {
    let validTargets = [];

    if (isLecturer) {
      validTargets = ["course", "lecturer", "product", "seller"];
    } else if (isStudent || isOther) {
      validTargets = ["product", "seller"];
    }
    const matchingReviews = await Reviews.find({
      targetId: user.uid,
      targetType: { $in: validTargets },
    }).select("rating");

    if (matchingReviews.length > 0) {
      targetReviewCount = matchingReviews.length;
      const sum = matchingReviews.reduce((acc, curr) => acc + curr.rating, 0);
      targetReviewAvg = sum / targetReviewCount;
    }
  } catch (err) {
    console.error(
      "Failed aggregating dynamic target reviews for score weight:",
      err,
    );
  }
  const combinedReputationAvg =
    targetReviewCount > 0
      ? targetReviewAvg * 0.6 + stats.avgReview * 0.4
      : stats.avgReview;

  let academicBase = 0;
  let attendanceScore = 0;
  let communityScore = 0;

  if (isLecturer) {
    academicBase = (combinedReputationAvg / 5) * 35;
    attendanceScore = Math.min((stats.minutesActive / 200) * 15, 15);
  } else if (isStudent) {
    const submissions = await TestSubmission.find({ studentId: user.uid });
    if (submissions.length > 0) {
      const totalPercentage = submissions.reduce(
        (acc, curr) => acc + curr.score / curr.totalPossibleScore,
        0,
      );
      academicBase = (totalPercentage / submissions.length) * 30;
    }
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
    const postCreationScore = Math.min(stats.libraryUsageSessions * 5, 25);
    const reachScore = Math.min((stats.minutesActive / 200) * 25, 25);
    communityScore = postCreationScore + reachScore;
  }

  const sessionWeight = isLecturer ? 3.0 : 2.0;
  const librarySessions = isOther
    ? 0
    : Math.min(stats.libraryUsageSessions * sessionWeight, 12);
  const libraryDownloads = Math.min(stats.booksFound * 1.5, 8);
  const aiAssistantUse = Math.min((stats.aiQueries / 40) * 10, 10);

  const techTotal =
    (isOther ? 0 : librarySessions) + libraryDownloads + aiAssistantUse;
  const engagement =
    isLecturer || isOther ? 0 : Math.min((stats.minutesActive / 200) * 20, 20);
  const reputation = (combinedReputationAvg / 5) * 20;
  let total =
    academicBase +
    attendanceScore +
    communityScore +
    techTotal +
    engagement +
    reputation;

  total += user.isVerified ? 5 : 0;

  const tierMultipliers = { free: 1, pro: 1.05, premium: 1.1 };
  total *= tierMultipliers[user.tier] || 1;
  const CARRY_FORWARD_WEIGHT = 0.3;
  const previousScore = user.currentIScore || 0;
  let finalScore =
    previousScore * CARRY_FORWARD_WEIGHT + total * (1 - CARRY_FORWARD_WEIGHT);

  return Math.min(Math.round(finalScore), 100);
};
