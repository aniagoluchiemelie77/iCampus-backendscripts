import cron from 'node-cron';
import {User, SchoolConfiguration} from '../tableDeclarations.js';
import { createNotification } from "../services/notification.js";
import {
  generateNotificationId,
} from "../utils/idGenerator.js";

// Runs at 00:00 on the 1st day of every 6th month (Jan and July)
cron.schedule('0 0 1 */6 *', async () => {
  console.log('Starting bi-annual student status verification...');
  
  try {
    const studentsSnapshot = await User
      .where("usertype", "==", "student")
      .where("isStillInSchool", "==", true)
      .get();

    if (studentsSnapshot.empty) {
      console.log('No active students found for verification.');
      return;
    }
    const schoolConfigsCache = new Map();

    for (const studentDoc of studentsSnapshot.docs) {
      const studentDocRef = studentDoc.ref;
      const student = studentDoc.data();

      try {
        if (!student.schoolCode) continue;
        let schoolConfig = schoolConfigsCache.get(student.schoolCode);
        
        if (!schoolConfig) {
          const schoolQuery = await SchoolConfiguration
            .where("schoolCode", "==", student.schoolCode)
            .limit(1)
            .get();

          if (!schoolQuery.empty) {
            schoolConfig = schoolQuery.docs[0].data();
            schoolConfigsCache.set(student.schoolCode, schoolConfig);
          }
        }

        if (!schoolConfig || !schoolConfig.isOperational || !schoolConfig.externalApiConfig?.endpoint) {
          continue;
        }

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
            await studentDocRef.update({
              isStillInSchool: false,
              usertype: 'otherUser',
              isVerified: true,
              updatedAt: new Date(),
            });

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
  } catch (error) {
    console.error("Cron job student verification error:", error.message);
  }
});