import cron from 'node-cron';
import {
  User
} from "../tableDeclarations.js";

// Runs at 00:00 on the 1st day of every month
cron.schedule('0 0 1 * *', async () => {
  const users = await User.find({});

  for (let user of users) {
    user.currentIScore = calculateIScore(user.monthlyStats);

    // 2. Reset stats for the new month
    user.monthlyStats = {
      minutesActive: 0,
      booksFound: 0,
      aiQueries: 0,
      avgReview: user.monthlyStats.avgReview // Maybe keep the average review?
    };

    await user.save();
  }
  console.log("Monthly iScore Refresh Complete.");
});