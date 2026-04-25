import cron from "node-cron";
import { User } from "../tableDeclarations.js";
import {
  calculateUnifiedIScore,
  updateInstitutionScores,
} from "../controllers/iScoreController.js";

cron.schedule("0 0 1 * *", async () => {
  console.log("Starting Monthly iScore Refresh...");

  try {
    const users = await User.find({
      usertype: { $in: ["student", "lecturer", "otherUser"] },
    });

    const bulkOps = [];

    for (let user of users) {
      try {
        const newScore = await calculateUnifiedIScore(user);

        bulkOps.push({
          updateOne: {
            filter: { uid: user.uid },
            update: {
              $set: {
                previousIScore: user.currentIScore || 0, // Shift current to previous
                currentIScore: newScore,
                monthlyStats: {
                  minutesActive: 0,
                  libraryUsageSessions: 0,
                  booksFound: 0,
                  aiQueries: 0,
                  avgReview: 0,
                  avgTestScore: 0,
                  lastLibraryAccess: user.monthlyStats.lastLibraryAccess,
                },
              },
            },
          },
        });
      } catch (err) {
        console.error(`Error calculating for ${user.uid}:`, err);
      }
    }

    if (bulkOps.length > 0) {
      await User.bulkWrite(bulkOps);
    }
    await updateInstitutionScores();
    console.log("Monthly iScore Refresh Complete.");
  } catch (globalErr) {
    console.error("Critical error in iScore Cron Job:", globalErr);
  }
});
