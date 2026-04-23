import cron from "node-cron";
import { User } from "../tableDeclarations.js";
import { calculateUnifiedIScore } from "../controllers/iScoreController.js";

// Runs at 00:00 on the 1st day of every month
cron.schedule("0 0 1 * *", async () => {
  console.log("Starting Monthly iScore Refresh...");

  try {
    // 1. Only fetch users who actually use the iScore system
    const users = await User.find({
      usertype: { $in: ["student", "lecturer", "otherUser"] },
    });

    for (let user of users) {
      try {
        // 2. Calculate the score based on the PREVIOUS month's data
        // We pass the whole user object because the function needs uid and usertype
        const newScore = await calculateUnifiedIScore(user);

        // 3. Update the user record
        await User.updateOne(
          { uid: user.uid },
          {
            $set: {
              currentIScore: newScore,
              // Reset stats for the new month
              monthlyStats: {
                minutesActive: 0,
                libraryUsageSessions: 0,
                booksFound: 0,
                aiQueries: 0,
                avgReview: 0, // Reset to allow for fresh monthly feedback
                avgTestScore: 0,
                lastLibraryAccess: user.monthlyStats.lastLibraryAccess, // Keep the date
              },
            },
          },
        );
      } catch (err) {
        console.error(`Failed to update iScore for user ${user.uid}:`, err);
      }
    }
    console.log("Monthly iScore Refresh Complete.");
  } catch (globalErr) {
    console.error("Critical error in iScore Cron Job:", globalErr);
  }
});
