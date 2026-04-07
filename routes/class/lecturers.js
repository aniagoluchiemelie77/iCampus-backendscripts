import express from "express";
import { authenticate, protect } from "../../middleware/auth.js";
import {
  Course,
  Lectures,
  Assessment,
  TestSubmission,
} from "../../tableDeclarations.js";
import { createNotification } from "../../services/notificationService.js";
import { customAlphabet } from "nanoid";
import PDFDocument from "pdfkit-table";
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nano = customAlphabet(alphabet, 6);
import { generateNotificationId } from "../../utils/idGenerator.js";

export const generateAssessmentId = (courseCode = "GEN") => {
  const year = new Date().getFullYear();
  return `IC-${courseCode.toUpperCase()}-${year}-${nano()}`;
};

export default function (User) {
  const router = express.Router();
  router.post("/courses", authenticate, async (req, res) => {
    try {
      const { payload, user } = req.body;

      if (!payload?.ids || !Array.isArray(payload.ids)) {
        return res.status(400).json({ message: "Invalid payload format" });
      }

      // Fetch courses taught by this lecturer
      const courses = await Course.find({
        courseId: { $in: payload.ids },
        lecturerIds: user,
      });

      if (!courses || courses.length === 0) {
        return res
          .status(404)
          .json({ message: "No teaching courses found registered for you" });
      }

      // Format course details with student count
      const filteredDetails = courses.map((course) => ({
        courseId: course.courseId,
        courseCode: course.courseCode,
        title: course.courseTitle,
        credits: course.credits,
        semester: course.semester,
        createdAt: course.createdAt,
        numberOfStudents: course.studentsEnrolled?.length || 0,
      }));

      console.log("Filtered course details:", filteredDetails);
      return res.status(200).json({ details: filteredDetails });
    } catch (error) {
      console.error("Error fetching course details:", error);
      return res.status(500).json({ message: "Server error" });
    }
  });
  router.get("/courses/lecturer-view", authenticate, async (req, res) => {
    try {
      const { lecturerId, semester, session } = req.query;

      const query = { lecturerIds: lecturerId };
      if (semester && semester !== "All") query.semester = semester;
      if (session && session !== "All") query.session = session;

      const courses = await Course.find(query).lean();

      // 1. Get all unique student UIDs across all courses
      const allStudentUids = [
        ...new Set(courses.flatMap((c) => c.studentsEnrolled)),
      ];

      // 2. Fetch those users from the User collection
      const students = await User.find(
        { uid: { $in: allStudentUids } },
        "firstname lastname email matricNumber uid current_level",
      ).lean();

      // 3. Map students back into their respective courses
      const results = courses.map((course) => ({
        ...course,
        studentsEnrolled: students.filter((s) =>
          course.studentsEnrolled.includes(s.uid),
        ),
        studentCount: course.studentsEnrolled.length,
      }));

      res.status(200).json(results);
    } catch (error) {
      res.status(500).json({ message: "Error fetching lecturer courses" });
    }
  });
  //Update Course content
  router.post(
    "/courses/updateContent/:courseId",
    authenticate,
    async (req, res) => {
      try {
        const { courseId } = req.params;
        const { updatedContents } = req.body;

        if (!Array.isArray(updatedContents)) {
          return res.status(400).json({ message: "Invalid content format" });
        }

        const updatedCourse = await Course.findByIdAndUpdate(
          courseId,
          { $set: { courseContents: updatedContents } },
          { new: true },
        );

        if (!updatedCourse) {
          return res.status(404).json({ message: "Course not found" });
        }

        // --- NOTIFY STUDENTS (In-App Only) ---
        const students = await User.find({
          usertype: "student",
          department: updatedCourse.department,
          level: updatedCourse.level,
        }).select("uid");

        // Fire and forget: update the notification bell for all students
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: student.uid,
            category: "classroom",
            actionType: "CONTENT_UPDATED",
            title: "Course Syllabus Updated",
            message: `the course contents for ${updatedCourse.courseCode} have been updated by the lecturer/instructor.`,
            payload: { courseId: updatedCourse._id },
            sendEmail: false,
            sendPush: false,
            sendSocket: true,
            saveToDb: true,
          });
        });

        res.status(200).json({
          message: "Course content updated successfully",
          courseContents: updatedCourse.courseContents,
        });
      } catch (error) {
        console.error("Update Course Error:", error);
        res
          .status(500)
          .json({ message: "Server error updating course contents" });
      }
    },
  );
  // --- 1. UPLOAD MATERIAL ---
  router.post(
    "/courses/uploadMaterial/:courseId",
    authenticate,
    async (req, res) => {
      try {
        const { courseId } = req.params;
        const fileUrl = req.file.path;
        const fileName = req.file.originalname || "New Resource";

        const updatedCourse = await Course.findByIdAndUpdate(
          courseId,
          { $push: { resources: fileUrl } },
          { new: true },
        );

        // NOTIFY STUDENTS
        const students = await User.find({
          usertype: "student",
          department: updatedCourse.department,
          level: updatedCourse.level,
        }).select("uid");

        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: student.uid,
            category: "classroom",
            actionType: "MATERIAL_UPLOADED",
            title: "New Study Material",
            message: `A new resource file has been uploaded for ${updatedCourse.courseTitle}.`,
            payload: { courseId, fileName },
            sendEmail: false, // Per your requirement
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });

        res.status(200).json({
          message: "File uploaded",
          resources: updatedCourse.resources,
        });
      } catch (error) {
        res.status(500).json({ message: "Upload failed" });
      }
    },
  );
  // --- 2. CREATE ASSIGNMENT ---
  router.post(
    "/courses/:courseId/assignments",
    authenticate,
    upload.single("file"),
    async (req, res) => {
      try {
        const { courseId } = req.params;
        const { title, description, dueDate, submissionMethod, lectureId } =
          req.body;

        const newAssignment = {
          title,
          description,
          dueDate: new Date(dueDate),
          submissionMethod,
          lectureId,
          courseId,
          fileUrl: req.file ? req.file.path : null,
          submissions: [],
        };

        const course = await Course.findOneAndUpdate(
          { courseId: courseId },
          { $push: { assignments: newAssignment } },
          { new: true },
        );

        if (!course)
          return res.status(404).json({ message: "Course not found" });

        // NOTIFY STUDENTS
        const students = await User.find({
          usertype: "student",
          department: course.department,
          level: course.level,
        }).select("uid");

        const formattedDate = new Date(dueDate).toLocaleDateString();

        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: student.uid,
            category: "classroom",
            actionType: "ASSIGNMENT_CREATED",
            title: "New Assignment",
            message: `New assignment uploaded for ${course.courseTitle}: "${title}". Due: ${formattedDate}`,
            payload: {
              courseId,
              assignmentTitle: title,
              dueDate: formattedDate,
            },
            sendEmail: false, // Per your requirement
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });

        res.status(201).json(course.assignments);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    },
  );
  //Approve or disapprove exceptions
  router.patch("/exceptions/:id/status", authenticate, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, lecturerComment } = req.body;

      // 1. Find the exception record
      const exception = await CourseException.findById(id);
      if (!exception) {
        return res.status(404).json({ message: "Exception not found" });
      }

      // 2. Prevent double-processing
      if (exception.status !== "pending") {
        return res
          .status(400)
          .json({ message: "This exception has already been processed" });
      }

      // 3. Handle Lecturer Payout on Approval
      if (status === "approved") {
        const lecturer = await User.findOne({ uid: req.user.uid });
        if (lecturer) {
          lecturer.pointsBalance = (lecturer.pointsBalance || 0) + 0.4;
          await lecturer.save();
        }
      }

      // 4. Update Exception Record
      exception.status = status;
      exception.lecturerComment = lecturerComment || "";
      await exception.save();

      // 5. NOTIFY THE STUDENT (Socket + Push + DB only)
      // Find the student who submitted the exception
      const student = await User.findOne({ uid: exception.userId });

      if (student) {
        createNotification({
          notificationId: generateNotificationId(),
          recipientId: student.uid,
          category: "classroom",
          actionType: "EXCEPTION_UPDATED",
          title: `Exception ${status === "approved" ? "Approved " : "Rejected "}`,
          message: `Your request for ${exception.courseCode} has been ${status}. ${lecturerComment ? "Comment: " + lecturerComment : ""}`,
          payload: {
            exceptionId: id,
            status: status,
            courseCode: exception.courseCode,
          },
          sendEmail: false, // Per your requirement
          sendPush: true, // Important for students to see
          sendSocket: true, // Real-time UI update
          saveToDb: true,
        });
      }

      res.status(200).json({
        success: true,
        message: `Exception ${status} successfully.`,
        exception,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  // Create Lectures
  router.post(
    "/courses/:courseId/lectures/createSchedule",
    async (req, res) => {
      try {
        const {
          date,
          repeatWeeks,
          startTime,
          endTime,
          location,
          courseId,
          topicName,
          lectureType,
        } = req.body;
        const finalPayload = req.body;
        const lecturesToCreate = [];
        const datesToCheck = [];

        // 1. Generate dates
        for (let i = 0; i < (repeatWeeks || 1); i++) {
          const nextDate = new Date(date);
          nextDate.setDate(nextDate.getDate() + i * 7);
          datesToCheck.push(nextDate.toISOString().split("T")[0]);
        }

        // 2. Conflict Check
        const conflict = await Lectures.findOne({
          date: { $in: datesToCheck },
          $or: [
            {
              lectureType: "Physical",
              location,
              startTime: { $lt: endTime },
              endTime: { $gt: startTime },
            },
            {
              courseId,
              startTime: { $lt: endTime },
              endTime: { $gt: startTime },
            },
          ],
        });

        if (conflict) {
          return res.status(409).json({
            message: `Conflict detected on ${conflict.date}! Class exists from ${conflict.startTime} to ${conflict.endTime}.`,
          });
        }

        // 3. Build array
        datesToCheck.forEach((d) => {
          lecturesToCreate.push({
            ...finalPayload,
            date: d,
            status: "scheduled",
            isTaught: false,
            attendance: [],
          });
        });

        // 4. Save to DB
        const result = await Lectures.insertMany(lecturesToCreate);

        // 5. NOTIFICATION LOGIC (Asynchronous)
        const courseDetails = await Course.findOne({ courseId });
        if (!courseDetails) return; // Safety check

        const students = await User.find({
          usertype: "student",
          department: courseDetails.department,
          level: courseDetails.level,
        }).select("uid email firstname"); // Ensure this matches your User Schema casing

        const notificationPromises = students.map((student) =>
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: student.uid,
            recipientEmail: student.email,
            category: "academic", // Changed from 'classroom' to match your frontend icon logic
            actionType: "LECTURE_SCHEDULED",
            title: "New Lecture Scheduled",
            message: `A new ${lectureType} session for ${topicName} has been set.`,
            payload: {
              userName: student.firstname,
              topicName: topicName,
              courseId: courseId, // From req.body or courseDetails
              lectureId: result[0].id, // Use the ID from the first created record
              lectureType: lectureType,
              location: location,
              time: startTime,
              date:
                datesToCheck.length > 1
                  ? `${datesToCheck[0]} (Repeats for ${repeatWeeks} weeks)`
                  : datesToCheck[0],
            },
            entityId: result[0].id,
            entityType: "lecture",
            sendEmail: true,
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          }),
        );

        // Fire and forget (don't await to keep API response fast)
        Promise.all(notificationPromises).catch((err) =>
          console.error("Notification Error:", err),
        );

        res.status(201).json({
          message: "Lectures scheduled successfully",
          count: result.length,
          lecture: result[0],
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    },
  );
  // POST: Create or Update an Assessment
  router.post("/courses/:courseId/assessments", async (req, res) => {
    try {
      const { courseId } = req.params;
      const {
        id,
        title,
        questions,
        duration,
        isPublished,
        totalMarks,
        status,
        scheduledStart,
        dueDate,
      } = req.body;

      let assessment;
      let shouldNotify = false;

      // 1. FIND EXISTING OR PREPARE NEW
      const existingAssessment = id ? await Assessment.findOne({ id }) : null;

      if (existingAssessment) {
        // SCENARIO A: UPDATE
        // Logic: Notify if it wasn't published before, but is being published now
        if (!existingAssessment.isPublished && isPublished) {
          shouldNotify = true;
        }

        assessment = await Assessment.findOneAndUpdate(
          { id }, // Use your custom id field
          {
            title,
            questions,
            duration,
            totalMarks,
            isPublished,
            status,
            scheduledStart: scheduledStart
              ? new Date(scheduledStart)
              : undefined,
            dueDate,
            updatedAt: new Date(),
          },
          { new: true },
        );
      } else {
        // SCENARIO B: CREATE
        const course = await Course.findOne({ courseId });
        const personalizedId = generateAssessmentId(
          course?.courseCode || "TEMP",
        );

        assessment = new Assessment({
          id: personalizedId,
          courseId,
          title,
          questions,
          duration,
          totalMarks,
          isPublished,
          status,
          scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
          dueDate,
          createdAt: new Date(),
        });

        await assessment.save();

        // Link to course
        await Course.findOneAndUpdate(
          { courseId },
          { $addToSet: { tests: personalizedId } },
        );

        // Notify immediately if created as "Published"
        if (isPublished) shouldNotify = true;
      }

      // 2. TRIGGER NOTIFICATIONS (Handles both Create and Update-to-Publish)
      if (shouldNotify) {
        const course = await Course.findOne({ courseId });
        const students = await User.find({
          usertype: "student",
          department: course.department,
          level: course.level,
        }).select("uid");

        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: student.uid,
            category: "classroom",
            actionType: "TEST_CREATED",
            title: "New Assessment Posted",
            message: `A new test "${title}" has been posted for ${course.courseCode}.`,
            payload: {
              courseId: courseId,
              assessmentId: assessment.id,
            },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });
      }

      res.status(existingAssessment ? 200 : 201).json({
        message: isPublished ? "Assessment Published" : "Draft Synced",
        data: assessment,
      });
    } catch (error) {
      console.error("Assessment Error:", error);
      res.status(500).json({ message: error.message });
    }
  });
  // GET: Fetch all assessments for a course
  router.get("/courses/:courseId/assessments", async (req, res) => {
    try {
      const { courseId } = req.params;
      const assessments = await Assessment.find({ courseId })
        .sort({ updatedAt: -1 })
        .select("-__v");

      res.status(200).json({
        success: true,
        count: assessments.length,
        data: assessments,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  router.get("/tests/:testId/download-analysis", protect, async (req, res) => {
    try {
      const token = req.headers.authorization?.split(" ")[1] || req.query.token;
      if (!token) return res.status(401).send("Unauthorized");
      const { testId } = req.params;
      // 1. Fetch Data
      const test = await Assessment.findOne({ id: testId });
      if (!test) return res.status(404).send("Assessment not found");

      // 2. Security Check: Is it actually past due?
      const isPastDue = new Date() > new Date(test.dueDate);
      if (!isPastDue) {
        return res
          .status(403)
          .send("Analysis is only available after the due date.");
      }

      const course = await Course.findOne({ courseId: test.courseId });
      const submissions = await TestSubmission.find({ testId });
      const submittedIds = submissions.map((s) => s.studentId);
      const enrolledStudents = await User.find({
        enrolledCourses: test.courseId,
      });
      const absentees = enrolledStudents.filter(
        (s) => !submittedIds.includes(s.uid),
      );
      const passMark = test.totalMarks / 2;
      const sortedSubmissions = [...submissions].sort(
        (a, b) => b.score - a.score,
      );
      const topPerformers = sortedSubmissions.slice(0, 3);
      const passedCount = submissions.filter((s) => s.score >= passMark).length;
      const failedCount = submissions.length - passedCount;
      const passRate =
        submissions.length > 0
          ? ((passedCount / submissions.length) * 100).toFixed(1)
          : 0;

      const doc = new PDFDocument({ margin: 30, size: "A4" });
      let filename = `Report_${course?.courseCode || "TEST"}_${test.title.replace(/\s+/g, "_")}.pdf`;
      const logoPath = "../../assets/logo.png";
      const imageWidth = 60;
      const pageWidth = doc.page.width;
      const xPos = (pageWidth - imageWidth) / 2;

      res.setHeader(
        "Content-disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-type", "application/pdf");
      doc.pipe(res);

      // --- HEADER ---
      try {
        doc.image(logoPath, xPos, 40, { width: imageWidth });
        doc.moveDown(4); // Create space after the logo
      } catch (err) {
        doc.moveDown(2);
      }
      doc
        .fontSize(20)
        .fillColor("#2c3e50")
        .text("iCampus Academic Analysis", { align: "center" });
      doc
        .fontSize(10)
        .fillColor("#7f8c8d")
        .text("Official Assessment Summary", { align: "center" });
      doc.moveDown(2);

      // --- META DATA BOX ---
      doc.rect(50, 100, 500, 70).fill("#f9f9f9").stroke("#ecf0f1");
      doc
        .fillColor("#222")
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(
          `Course: ${course?.courseTitle} - ${course?.courseCode}`,
          60,
          110,
        );
      doc
        .font("Helvetica")
        .fontSize(10)
        .text(`Lecturer: ${test.instructorName || "N/A"}`, 60, 130)
        .text(
          `Total Submissions: ${submissions.length} | Generated: ${new Date().toLocaleString()}`,
          60,
          145,
        );

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#2c3e50")
        .text("Performance Analysis", 50, 190);

      const chartX = 70;
      const chartY = 210;
      const barMax = 150;

      // Draw Green Bar (Pass)
      const pWidth =
        submissions.length > 0
          ? (passedCount / submissions.length) * barMax
          : 0;
      doc.rect(chartX, chartY, pWidth, 12).fill("#27ae60");
      doc
        .fillColor("#222")
        .fontSize(8)
        .text(`Passed (${passedCount})`, chartX + pWidth + 5, chartY + 2);

      // Draw Red Bar (Fail)
      const fWidth =
        submissions.length > 0
          ? (failedCount / submissions.length) * barMax
          : 0;
      doc.rect(chartX, chartY + 20, fWidth, 12).fill("#e74c3c");
      doc
        .fillColor("#222")
        .fontSize(8)
        .text(`Failed (${failedCount})`, chartX + fWidth + 5, chartY + 22);

      // --- TOP PERFORMERS (Right Side) ---
      const topX = 350;
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#2c3e50")
        .text("Top Performers", topX, 190);

      doc.fontSize(9).font("Helvetica").fillColor("#222");
      topPerformers.forEach((student, index) => {
        const medal = index === 0 ? "🥇 " : index === 1 ? "🥈 " : "🥉 ";
        doc.text(
          `${medal}${student.studentName} (${student.score}/${test.totalMarks})`,
          topX,
          210 + index * 15,
        );
      });

      // --- TABLE HEADERS ---
      const tableTop = 280;
      const colX = { matric: 50, name: 150, score: 380, status: 470 };

      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Matric Number", colX.matric, tableTop);
      doc.text("Student Name", colX.name, tableTop);
      doc.text("Score", colX.score, tableTop);
      doc.text("Status", colX.status, tableTop);

      doc
        .moveTo(50, tableTop + 15)
        .lineTo(550, tableTop + 15)
        .stroke();

      // --- ROWS ---
      let currentY = tableTop + 30;
      doc.font("Helvetica").fontSize(9);

      submissions.forEach((sub, i) => {
        // Alternating row background for readability
        if (i % 2 === 0) {
          doc
            .rect(50, currentY - 5, 500, 18)
            .fill("#f2f2f2")
            .fillColor("#222");
        }

        doc.text(sub.matricNumber || "N/A", colX.matric, currentY);
        doc.text(sub.studentName, colX.name, currentY);
        doc.text(`${sub.score} / ${test.totalMarks}`, colX.score, currentY);
        doc.text(sub.status.toUpperCase(), colX.status, currentY);

        currentY += 20;

        if (currentY > 750) {
          doc.addPage();
          currentY = 50;
        }
      });
      if (absentees.length > 0) {
        doc.addPage();
        doc
          .fontSize(14)
          .fillColor("#c0392b")
          .text("Absentees (Did Not Submit)", { underline: true });
        doc.moveDown();

        doc.fontSize(10).fillColor("#000").font("Helvetica-Bold");
        doc.text("Matric Number", 50);
        doc.text("Student Name", 150);
        doc
          .moveTo(50, doc.y + 5)
          .lineTo(550, doc.y + 5)
          .stroke();
        doc.moveDown();

        doc.font("Helvetica");
        absentees.forEach((student) => {
          doc.text(student.matricNumber || "N/A", 50);
          doc.text(`${student.firstname} ${student.lastname}`, 150);
          doc.moveDown(0.5);
        });
      }

      doc.end();
      doc.on("finish", () => {
        console.log(`PDF Generated: ${filename}`);
      });
    } catch (error) {
      console.error(error);
      res.status(500).send("Error generating PDF");
    }
  });
  // GET: /tests/:testId/analysis-data
  router.get("/tests/:testId/analysis-data", authenticate, async (req, res) => {
    try {
      const { testId } = req.params;
      const test = await Assessment.findOne({ id: testId });
      if (!test) return res.status(404).json({ message: "Not found" });

      const submissions = await TestSubmission.find({ testId });
      const passMark = test.totalMarks / 2;
      const passedCount = submissions.filter((s) => s.score >= passMark).length;
      const failedCount = submissions.length - passedCount;

      const topPerformers = [...submissions]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      res.json({
        test,
        submissions,
        passedCount,
        failedCount,
        passRate: ((passedCount / (submissions.length || 1)) * 100).toFixed(1),
        topPerformers,
      });
    } catch (error) {
      res.status(500).send("Error");
    }
  });
  // PUT route to postpone a specific lecture
  router.put(
    "/courses/:courseId/lectures/:lectureId/postpone",
    authenticate,
    async (req, res) => {
      try {
        const { lectureId, courseId } = req.params;
        const { newDate, newStartTime, topicName } = req.body;

        // 1. Update the specific lecture
        const updatedLecture = await Lectures.findByIdAndUpdate(
          lectureId,
          {
            date: newDate,
            startTime: newStartTime,
            status: "postponed",
          },
          { new: true },
        );

        if (!updatedLecture)
          return res.status(404).json({ message: "Lecture not found" });

        // 2. Fetch students to notify (similar to your create logic)
        const course = await Course.findOne({ courseId });
        const students = await User.find({
          usertype: "student",
          department: course.department,
          level: course.level,
        }).select("uid email firstName");

        // 3. Send Notifications
        const notificationPromises = students.map((student) =>
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: student.uid,
            recipientEmail: student.email,
            category: "classroom",
            actionType: "LECTURE_POSTPONED",
            title: "Lecture Rescheduled",
            message: `The lecture "${topicName}" has been postponed to ${newDate} at ${newStartTime}.`,
            payload: {
              userName: student.firstName,
              topicName: topicName,
              newDate: newDate,
              newTime: newStartTime,
              courseId: updatedLecture.courseId,
              lectureId: updatedLecture.lectureId,
            },
            entityId: updatedLecture.lectureId,
            sendEmail: false,
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          }),
        );

        Promise.all(notificationPromises).catch((err) =>
          console.error("Notify Error:", err),
        );

        res.status(200).json({
          message: "Lecture postponed and students notified",
          updatedLecture,
        });
      } catch (error) {
        res.status(500).json({ message: "Internal Server Error" });
      }
    },
  );
  // DELETE: /users/lecturers/class/lectures/:lectureId
  router.delete("/lectures/:lectureId", authenticate, async (req, res) => {
    try {
      const { lectureId } = req.params;

      // 1. Find the lecture using the custom 'id' field
      const lecture = await Lectures.findOne({ id: lectureId });

      if (!lecture) {
        return res.status(404).json({ message: "Lecture not found" });
      }

      const { courseId, topicName, date } = lecture;

      // 2. Delete the lecture using the same custom 'id' field
      await Lectures.findOneAndDelete({ id: lectureId });

      // 3. Fetch course details to identify target students
      const course = await Course.findOne({ courseId });

      if (course) {
        // 4. Find all students in the same department and level
        const students = await User.find({
          usertype: "student",
          department: course.department,
          level: course.level,
        }).select("uid email firstName");

        // 5. Trigger notifications via your utility
        const notificationPromises = students.map((student) =>
          createNotification({
            notificationId: generateNotificationId(),
            recipientId: student.uid,
            recipientEmail: student.email,
            category: "classroom",
            actionType: "LECTURE_CANCELLED",
            title: "Lecture Cancelled",
            message: `The lecture "${topicName}" scheduled for ${date} has been cancelled.`,
            payload: {
              courseId: lecture.courseId, // CRITICAL: Frontend needs this to load the page
              lectureId: lecture.lectureId,
            },
            entityId: lecture.lectureId,
            sendEmail: false,
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          }),
        );

        // Run in background so the response isn't delayed
        Promise.all(notificationPromises).catch((err) =>
          console.error("Delete Notification Error:", err),
        );
      }

      return res.status(200).json({
        success: true,
        message: "Lecture deleted and students notified locally.",
      });
    } catch (error) {
      console.error("Delete Lecture Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  // routes/lecture.js (The Start Lecture Route)
router.post("/lectures/start", async (req, res) => {
  try {
    const { lectureId, courseId } = req.body;

    // 1. Validation: Ensure IDs are present
    if (!lectureId || !courseId) {
      return res
        .status(400)
        .json({ message: "Lecture ID and Course ID are required" });
    }
    const existingLecture = await Lectures.findById(lectureId);
    if (!existingLecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }

    if (existingLecture.status === "ongoing") {
      return res.status(200).json(existingLecture); // Already live, just return it
    }

    // 3. Update status to 'ongoing'
    const lecture = await Lectures.findByIdAndUpdate(
      lectureId,
      { status: "ongoing", actualStartTime: new Date() }, // Track actual start time
      { new: true },
    );

    // 4. Emit via Socket (with safety check)
    if (req.io) {
      // Use the course room so only enrolled students get the popup
      req.io.to(`course_${courseId}`).emit("lecture_started", lecture);
      console.log(`Live signal sent to course_${courseId}`);
    } else {
      console.error("Socket.io instance (req.io) not found on request object");
    }

    res.status(200).json(lecture);
  } catch (error) {
    console.error("Error starting lecture:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
  return router;
}
