import cron from 'node-cron';
import {User, SchoolConfiguration} from '../tableDeclarations.js';
import { createNotification } from "../services/notification.js";
import {
  generateNotificationId,
} from "../utils/idGenerator.js";

// Runs at 00:00 on the 1st day of every 6th month (Jan and July)
cron.schedule('0 0 1 */6 *', async () => {
  console.log('Starting bi-annual student status verification...');
  
  const students = await User.find({ usertype: 'student', isStillInSchool: true });

  for (const student of students) {
    try {
      const schoolConfig = await SchoolConfiguration.findOne({ schoolCode: student.schoolCode });
      if (!schoolConfig || !schoolConfig.isOperational) continue;

      const response = await fetch(schoolConfig.externalApiConfig.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-iCampus-API-Key': schoolConfig.externalApiConfig.sharedSecret,
        },
        body: JSON.stringify({
          student_id: student.matricNumber,
          role: 'student',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.isStillInSchool === false) {
          student.isStillInSchool = false;
          student.usertype = 'otherUser'; 
          student.isVerified = true;
          await student.save();
          await createNotification({
            notificationId: generateNotificationId("account_upgrade"),
            recipientId: student.uid,
            category: 'system',
            actionType: 'GRADUATION_CONGRATULATIONS',
            title: 'Account Status Upgraded',
            message: 'Congratulations! Your account has been officially upgraded to Alumni status. You now have access to exclusive alumni features on iCampus.',
          });
        }
      }
    } catch (err) {
      console.error(`Error verifying student ${student.uid}:`, err.message);
    }
  }
});