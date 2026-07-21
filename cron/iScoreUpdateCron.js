import cron from "node-cron";
import { User } from "../tableDeclarations.js";
import {
  calculateUnifiedIScore,
  updateInstitutionScores,
} from "../controllers/iScoreController.js";
import { db } from "../config/firebaseAdmin.js";

cron.schedule("0 0 1 * *", async () => {
  console.log("Starting Monthly iScore Refresh...");

  try {
    const querySnapshot = await User.where("usertype", "in", [
      "student",
      "lecturer",
      "otherUser",
    ]).get();

    if (querySnapshot.empty) {
      console.log("No eligible users found for iScore refresh.");
      return;
    }

    let batch = db.batch();
    let operationCount = 0;

    for (const userDoc of querySnapshot.docs) {
      const userDocRef = userDoc.ref;
      const user = userDoc.data();

      try {
        const newScore = await calculateUnifiedIScore(user);

        const updateData = {
          previousIScore: user.currentIScore || 0,
          currentIScore: newScore,
          monthlyStats: {
            minutesActive: 0,
            libraryUsageSessions: 0,
            booksFound: 0,
            aiQueries: 0,
            avgReview: 0,
            avgTestScore: 0,
            lastLibraryAccess: user.monthlyStats?.lastLibraryAccess || null,
          },
          updatedAt: new Date(),
        };

        batch.update(userDocRef, updateData);
        operationCount++;
        if (operationCount >= 500) {
          await batch.commit();
          batch = db.batch();
          operationCount = 0;
        }
      } catch (err) {
        console.error(`Error calculating for ${user.uid || userDoc.id}:`, err);
      }
    }
    if (operationCount > 0) {
      await batch.commit();
    }

    await updateInstitutionScores();
    console.log("Monthly iScore Refresh Complete.");
  } catch (globalErr) {
    console.error("Critical error in iScore Cron Job:", globalErr);
  }
});