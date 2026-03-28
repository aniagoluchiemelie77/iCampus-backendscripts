// cron/assessmentCron.js
import cron from 'node-cron';
import { processAssessmentAnalysis } from '../controllers/assessmentController.js';
import {
  Assessment,
} from "../tableDeclarations.js";

cron.schedule("0 * * * *", async () => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  try {
    const expiredTests = await Assessment.find({
      dueDate: { $lt: now, $gte: oneHourAgo },
      isAnalyzed: { $ne: true } 
    });

    for (const test of expiredTests) {
      await processAssessmentAnalysis(test.id);
      console.log(`[CRON] Analysis triggered for: ${test.title}`);
    }
  } catch (error) {
    console.error("Cron Job Error:", error);
  }
});