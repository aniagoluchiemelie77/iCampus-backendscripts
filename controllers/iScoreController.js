import {
  Lectures,
  TestSubmission,
  Attendance,
  User,
  OperationalInstitutions,
  Reviews,
} from "../tableDeclarations.js";
import { db } from "../config/firebaseAdmin.js";
import { CARRY_FORWARD_WEIGHT } from "../constants/inAppConstants.js";

export const updateInstitutionScores = async () => {
  try {
    const usersSnapshot = await User.where("schoolCode", "!=", null).get();

    if (usersSnapshot.empty) return;
    const schoolStats = {};

    usersSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const schoolCode = data.schoolCode;

      if (!schoolCode) return;

      if (!schoolStats[schoolCode]) {
        schoolStats[schoolCode] = {
          totalCurrent: 0,
          totalPrevious: 0,
          count: 0,
        };
      }
      schoolStats[schoolCode].totalCurrent += Number(data.currentIScore) || 0;
      schoolStats[schoolCode].totalPrevious += Number(data.previousIScore) || 0;
      schoolStats[schoolCode].count += 1;
    });

    const batch = db.batch();
    const now = new Date();
    let updateCount = 0;

    for (const [schoolCode, stats] of Object.entries(schoolStats)) {
      const avgCurrent = stats.count > 0 ? stats.totalCurrent / stats.count : 0;
      const avgPrevious =
        stats.count > 0 ? stats.totalPrevious / stats.count : 0;
      const instSnapshot = await OperationalInstitutions.where(
        "schoolCode",
        "==",
        schoolCode,
      )
        .limit(1)
        .get();

      if (!instSnapshot.empty) {
        const instRef = instSnapshot.docs[0].ref;

        batch.update(instRef, {
          currentiScoreAvg: avgCurrent,
          previousiScoreAvg: avgPrevious,
          updatedAt: now,
        });

        updateCount++;
        if (updateCount >= 450) {
          await batch.commit();
          updateCount = 0;
        }
      }
    }
    if (updateCount > 0) {
      await batch.commit();
    }
  } catch (error) {
    console.error("Error updating institution scores:", error);
    throw error;
  }
};
export const calculateUnifiedIScore = async (user) => {
  const stats = user.monthlyStats || {};
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
    const reviewsSnapshot = await Reviews.where(
      "targetId",
      "==",
      user.uid || user.id,
    ).get();

    const matchingReviews = [];
    reviewsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (validTargets.includes(data.targetType)) {
        matchingReviews.push(data);
      }
    });

    if (matchingReviews.length > 0) {
      targetReviewCount = matchingReviews.length;
      const sum = matchingReviews.reduce(
        (acc, curr) => acc + (Number(curr.rating) || 0),
        0,
      );
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
      ? targetReviewAvg * 0.6 + (stats.avgReview || 0) * 0.4
      : stats.avgReview || 0;

  let academicBase = 0;
  let attendanceScore = 0;
  let communityScore = 0;

  if (isLecturer) {
    academicBase = (combinedReputationAvg / 5) * 35;
    attendanceScore = Math.min(((stats.minutesActive || 0) / 200) * 15, 15);
  } else if (isStudent) {
    const submissionsSnapshot = await TestSubmission.where(
      "studentId",
      "==",
      user.uid || user.id,
    ).get();

    if (!submissionsSnapshot.empty) {
      let totalPercentage = 0;
      let subCount = 0;

      submissionsSnapshot.docs.forEach((doc) => {
        const curr = doc.data();
        if (curr.totalPossibleScore && curr.totalPossibleScore > 0) {
          totalPercentage += (curr.score || 0) / curr.totalPossibleScore;
          subCount++;
        }
      });

      if (subCount > 0) {
        academicBase = (totalPercentage / subCount) * 30;
      }
    }
    let totalLectures = 0;
    let attendedCount = 0;

    if (
      user.coursesEnrolled &&
      Array.isArray(user.coursesEnrolled) &&
      user.coursesEnrolled.length > 0
    ) {
      const lecturesPromises = user.coursesEnrolled.map((courseId) =>
        Lectures.where("courseId", "==", courseId).get(),
      );
      const lecturesSnapshots = await Promise.all(lecturesPromises);

      lecturesSnapshots.forEach((snap) => {
        snap.docs.forEach((doc) => {
          const lData = doc.data();
          if (["completed", "ongoing"].includes(lData.status)) {
            totalLectures++;
          }
        });
      });
    }

    const attendanceSnapshot = await Attendance.where(
      "studentId",
      "==",
      user.uid || user.id,
    )
      .where("status", "==", "Present")
      .get();

    attendedCount = attendanceSnapshot.size;

    attendanceScore =
      totalLectures > 0
        ? Math.min((attendedCount / totalLectures) * 20, 20)
        : 0;
  } else if (isOther) {
    const postCreationScore = Math.min(
      (stats.libraryUsageSessions || 0) * 5,
      25,
    );
    const reachScore = Math.min(((stats.minutesActive || 0) / 200) * 25, 25);
    communityScore = postCreationScore + reachScore;
  }

  const sessionWeight = isLecturer ? 3.0 : 2.0;
  const librarySessions = isOther
    ? 0
    : Math.min((stats.libraryUsageSessions || 0) * sessionWeight, 12);
  const libraryDownloads = Math.min((stats.booksFound || 0) * 1.5, 8);
  const aiAssistantUse = Math.min(((stats.aiQueries || 0) / 40) * 10, 10);

  const techTotal =
    (isOther ? 0 : librarySessions) + libraryDownloads + aiAssistantUse;
  const engagement =
    isLecturer || isOther
      ? 0
      : Math.min(((stats.minutesActive || 0) / 200) * 20, 20);
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
  const previousScore = user.currentIScore || 0;
  let finalScore =
    previousScore * CARRY_FORWARD_WEIGHT + total * (1 - CARRY_FORWARD_WEIGHT);

  return Math.min(Math.round(finalScore), 100);
};
