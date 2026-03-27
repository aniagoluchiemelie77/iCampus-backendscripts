import express from "express";
import cron from "node-cron";
import { authenticate, protect } from "../../index.js";
import {
  Course,
  Lectures,
  Assessment,
  TestSubmission,
  User,
  Notification,
} from "../../tableDeclarations.js";
import { customAlphabet } from "nanoid";
import PDFDocument from "pdfkit-table";
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nano = customAlphabet(alphabet, 6);
import { generateNotificationId } from "../user.js";

export const generateAssessmentId = (courseCode = "GEN") => {
  const year = new Date().getFullYear();
  return `IC-${courseCode.toUpperCase()}-${year}-${nano()}`;
};
cron.schedule("0 * * * *", async () => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  try {
    // 1. Find tests that expired in the last hour
    const expiredTests = await Assessment.find({
      dueDate: { $lt: now, $gte: oneHourAgo },
    });

    for (const test of expiredTests) {
      // 2. Identify students who MISSED the test
      const submissions = await TestSubmission.find({
        testId: test._id,
      }).distinct("studentId");
      const enrolledStudents = await User.find({
        enrolledCourses: test.courseId,
      });

      const absentees = enrolledStudents.filter(
        (s) => !submissions.includes(s.uid),
      );
      test.isAnalyzed = true;
      await test.save();
      await Notification.create({
        notificationId: generateNotificationId(),
        userId: test.lecturerId,
        isRead: false,
        isPublic: false,
        title: "Test Deadline Reached",
        message: `${test.title} is now closed. Submissions: ${submissions.length}. Absentees: ${absentees.length}.`,
        type: "Test Deadline Alert",
        metadata: { testId: test._id },
      });
      console.log(`Notification sent to lecturer for test: ${test.title}`);
    }
  } catch (error) {
    console.error("Cron Job Error:", error);
  }
});

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
  router.post(
    "/courses/uploadMaterial/:courseId",
    authenticate,
    async (req, res) => {
      try {
        const { courseId } = req.params;
        // Assuming 'req.file.path' or 'req.file.location' (for S3) is provided by your upload middleware
        const fileUrl = req.file.path;

        const updatedCourse = await Course.findByIdAndUpdate(
          courseId,
          { $push: { resources: fileUrl } }, // Add new file to general resources
          { new: true },
        );

        res.status(200).json({
          message: "File uploaded",
          resources: updatedCourse.resources,
        });
      } catch (error) {
        res.status(500).json({ message: "Upload failed" });
      }
    },
  );
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
          fileUrl: req.file ? req.file.path : null, // If lecturer uploaded a brief
          submissions: [],
        };

        const course = await Course.findOneAndUpdate(
          { courseId: courseId },
          { $push: { assignments: newAssignment } },
          { new: true },
        );

        if (!course)
          return res.status(404).json({ message: "Course not found" });

        res.status(201).json(course.assignments);
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    },
  );
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

      res.status(200).json({
        success: true,
        message: `Exception ${status} successfully.`,
        exception,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  });
  // Example Express Route
  router.post(
    "/courses/:courseId/lectures/createSchedule",
    async (req, res) => {
      try {
        const { date, repeatWeeks, startTime, endTime, location, courseId } =
          req.body;
        const finalPayload = req.body;
        const lecturesToCreate = [];
        const datesToCheck = [];

        // 1. Generate all dates first to check for conflicts in bulk
        for (let i = 0; i < (repeatWeeks || 1); i++) {
          const nextDate = new Date(date);
          nextDate.setDate(nextDate.getDate() + i * 7);
          datesToCheck.push(nextDate.toISOString().split("T")[0]);
        }

        // 2. Optimized Bulk Conflict Check
        const conflict = await Lectures.findOne({
          date: { $in: datesToCheck },
          $or: [
            {
              lectureType: "Physical",
              location: location,
              startTime: { $lt: endTime },
              endTime: { $gt: startTime },
            },
            {
              courseId: courseId, // Or lecturerId if you have it in req.user
              startTime: { $lt: endTime },
              endTime: { $gt: startTime },
            },
          ],
        });

        if (conflict) {
          return res.status(409).json({
            message: `Conflict detected on ${conflict.date}! You have a class from ${conflict.startTime} to ${conflict.endTime}.`,
          });
        }

        // 3. Build the array
        datesToCheck.forEach((d) => {
          lecturesToCreate.push({
            ...finalPayload,
            date: d,
            status: "scheduled",
            isTaught: false,
            attendance: [],
          });
        });

        // 4. Save all and send ONE response
        const result = await Lectures.insertMany(lecturesToCreate);

        res.status(201).json({
          message: "Lectures scheduled successfully",
          count: result.length,
          lecture: result[0], // Return the first one for the success modal preview
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    },
  );
  // POST: Create or Update an Assessment (Test)
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
        dueDate,
      } = req.body;

      let assessment;

      if (id) {
        // SCENARIO A: UPDATE EXISTING
        assessment = await Assessment.findByIdAndUpdate(
          id,
          {
            title,
            questions,
            duration,
            totalMarks,
            isPublished,
            status,
            dueDate,
            updatedAt: new Date(),
          },
          { new: true },
        );
      } else {
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
          dueDate,
          createdAt: new Date(),
        });

        await assessment.save();
        await Course.findOneAndUpdate(
          { courseId },
          { $addToSet: { tests: personalizedId } },
        );
      }

      res.status(201).json({
        message: isPublished ? "Assessment Published" : "Draft Synced",
        data: assessment,
      });
    } catch (error) {
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
  return router;
}
