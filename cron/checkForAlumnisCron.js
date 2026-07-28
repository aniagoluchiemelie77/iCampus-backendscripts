import cron from 'node-cron';
import {User, SchoolConfiguration} from '../tableDeclarations.js';
import { createNotification } from "../services/notification.js";
import {
  generateNotificationId,
} from "../utils/idGenerator.js";

// Runs at 00:00 on the 1st day of every 6th month (Jan and July)
cron.schedule("0 0 1 */6 *", async () => {
  console.log("Starting bi-annual student status and details verification...");

  try {
    const studentsSnapshot = await User.where("usertype", "==", "student")
      .where("isStillInSchool", "==", true)
      .get();

    if (studentsSnapshot.empty) {
      console.log("No active students found for verification.");
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
          const schoolQuery = await SchoolConfiguration.where(
            "schoolCode",
            "==",
            student.schoolCode,
          )
            .limit(1)
            .get();

          if (!schoolQuery.empty) {
            schoolConfig = schoolQuery.docs[0].data();
            schoolConfigsCache.set(student.schoolCode, schoolConfig);
          }
        }

        if (
          !schoolConfig ||
          !schoolConfig.isOperational ||
          !schoolConfig.externalApiConfig?.endpoint
        ) {
          continue;
        }

        const response = await fetch(schoolConfig.externalApiConfig.endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-iCampus-API-Key": schoolConfig.externalApiConfig.sharedSecret,
          },
          body: JSON.stringify({
            student_id: student.matricNumber,
            role: "student",
          }),
        });

        if (response.ok) {
          const schoolStudent = await response.json();
          const isStillInSchool = schoolStudent.isStillInSchool;

          if (isStillInSchool === false) {
            await studentDocRef.update({
              firstname: schoolStudent.first_name || student.firstname,
              lastname: schoolStudent.last_name || student.lastname,
              department: schoolStudent.faculty_dept || student.department,
              current_level: schoolStudent.level || student.current_level,
              schoolAvatarUrl:
                schoolStudent.profile_picture_url || student.schoolAvatarUrl,
              email: schoolStudent.email || student.email,
              isStillInSchool: false,
              usertype: "otherUser",
              isVerified: true,
              updatedAt: new Date(),
            });

            await createNotification({
              notificationId: generateNotificationId("account_upgrade"),
              recipientId: student.uid,
              category: "system",
              actionType: "GRADUATION_CONGRATULATIONS",
              title: "Account Status Upgraded",
              message:
                "Congratulations! Your account has been officially upgraded to Alumni status. You now have access to exclusive alumni features on iCampus.",
            });
          } else {
            await studentDocRef.update({
              firstname: schoolStudent.first_name || student.firstname,
              lastname: schoolStudent.last_name || student.lastname,
              department: schoolStudent.faculty_dept || student.department,
              current_level: schoolStudent.level || student.current_level,
              schoolAvatarUrl:
                schoolStudent.profile_picture_url || student.schoolAvatarUrl,
              email: schoolStudent.email || student.email,
              updatedAt: new Date(),
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

cron.schedule("0 0 1 */6 *", async () => {
  console.log("Starting bi-annual lecturer details verification...");

  try {
    const lecturersSnapshot = await User.where(
      "usertype",
      "==",
      "lecturer",
    ).get();

    if (lecturersSnapshot.empty) {
      console.log("No active lecturers found for verification.");
      return;
    }
    const schoolConfigsCache = new Map();

    for (const lecturerDoc of lecturersSnapshot.docs) {
      const lecturerDocRef = lecturerDoc.ref;
      const lecturer = lecturerDoc.data();

      try {
        if (!lecturer.schoolCode) continue;
        let schoolConfig = schoolConfigsCache.get(lecturer.schoolCode);

        if (!schoolConfig) {
          const schoolQuery = await SchoolConfiguration.where(
            "schoolCode",
            "==",
            lecturer.schoolCode,
          )
            .limit(1)
            .get();

          if (!schoolQuery.empty) {
            schoolConfig = schoolQuery.docs[0].data();
            schoolConfigsCache.set(lecturer.schoolCode, schoolConfig);
          }
        }

        if (
          !schoolConfig ||
          !schoolConfig.isOperational ||
          !schoolConfig.externalApiConfig?.endpoint
        ) {
          continue;
        }

        const response = await fetch(schoolConfig.externalApiConfig.endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-iCampus-API-Key": schoolConfig.externalApiConfig.sharedSecret,
          },
          body: JSON.stringify({
            staff_id: lecturer.staffId,
            role: "lecturer",
          }),
        });

        if (response.ok) {
          const externalLecturer = await response.json();

          await lecturerDocRef.update({
            firstname: externalLecturer.first_name || lecturer.firstname,
            lastname: externalLecturer.last_name || lecturer.lastname,
            department: externalLecturer.department || lecturer.department,
            schoolAvatarUrl:
              externalLecturer.profile_picture_url || lecturer.schoolAvatarUrl,
            email: externalLecturer.email || lecturer.email,
            updatedAt: new Date(),
          });
        }
      } catch (err) {
        console.error(`Error updating lecturer ${lecturer.uid}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Cron job lecturer verification error:", error.message);
  }
});