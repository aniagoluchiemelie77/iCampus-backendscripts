import express from "express";
import { authenticate } from "../../index.js";
import {
  Course,
  Lectures,
  Assessment,
  TestSubmission,
} from "../../tableDeclarations.js";
import { customAlphabet } from "nanoid";
import PDFDocument from "pdfkit-table";
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const nano = customAlphabet(alphabet, 6);

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
  router.get("/courses/:courseId/assessmentAnalysis", async (req, res) => {
    try {
      const { testId } = req.params;

      // 1. Fetch Data
      const test = await Assessment.findById(testId);
      const course = await Course.findOne({ courseId: test.courseId });
      const submissions = await TestSubmission.find({ testId });

      const doc = new PDFDocument({ margin: 30, size: "A4" });
      let filename = `Report_${course.courseCode}_${test.title}.pdf`;

      res.setHeader(
        "Content-disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-type", "application/pdf");
      doc.pipe(res);

      // --- HEADER SECTION ---
      // doc.image('logo.png', 50, 45, { width: 50 }); // Add your iCampus logo
      doc.fontSize(18).text("iCampus Academic Report", { align: "center" });
      doc.fontSize(10).text(courseData.schoolName, { align: "center" });
      doc.moveDown(2);

      // --- META DATA ---
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`Course: ${courseData.courseCode} - ${courseData.courseTitle}`);
      doc.font("Helvetica").text(`Lecturer: ${courseData.instructorName}`);
      doc.text(
        `Assessment: ${testData.title} | Date: ${new Date().toLocaleDateString()}`,
      );
      doc.moveDown();

      // --- TABLE LOGIC ---
      const tableTop = 200;
      const itemCodeX = 50;
      const descriptionX = 150;
      const scoreX = 400;
      const statusX = 480;

      // Table Header
      doc.font("Helvetica-Bold").fontSize(10);
      doc.text("Matric No", itemCodeX, tableTop);
      doc.text("Student Name", descriptionX, tableTop);
      doc.text("Score", scoreX, tableTop);
      doc.text("Status", statusX, tableTop);

      doc
        .moveTo(50, tableTop + 15)
        .lineTo(550, tableTop + 15)
        .stroke();

      // Table Rows
      let currentY = tableTop + 30;
      doc.font("Helvetica").fontSize(9);

      submissions.forEach((sub) => {
        doc.text(sub.matricNumber, itemCodeX, currentY);
        doc.text(sub.studentName, descriptionX, currentY);
        doc.text(`${sub.score}`, scoreX, currentY);
        doc.text(sub.status, statusX, currentY);

        currentY += 20; // Row spacing

        // Add new page if table is too long
        if (currentY > 700) {
          doc.addPage();
          currentY = 50;
        }
      });

      doc.end();
    } catch (error) {
      res.status(500).send("Error generating PDF");
    }
  });
  return router;
}
