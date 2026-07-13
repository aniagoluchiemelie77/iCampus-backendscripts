import { storage } from "../config/firebaseAdmin.js";
import {
  Certificate,
  User,
  Product,
  Exceptions,
  Transactions,
  Assessment,
  TestSubmission,
  Lectures,
  Course,
  Attendance,
  UserDownloads,
} from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import { generateCertificatePDF } from "../templates/downloadsCertificateTemplate.js";
import { generateTestAnalysisPDF } from "../templates/courseAssessmentTemplate.js";
import {
  generateNotificationId,
  generateExceptionId,
  generateTransactionId,
  generateLectureId,
  generateAssessmentId,
  generateAssignmentId,
  generateSubmissionId,
  generateCourseId,
} from "../utils/idGenerator.js";
import {
  EXCEPTION_COST_IN_ICASH,
  EXCEPTION_ACCOUNT_LIMITS,
  EXCEPTION_LECTURER_DIVIDEND_IN_ICASH,
} from "../constants/inAppConstants.js";
import { generateAttendancePDF } from "../templates/courseAttendanceTemplate.js";
import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import mongoose from "mongoose";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { prepareLectureData } from "../utils/onlineClassLinkGenerator.js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const now = new Date();
const formattedDate = now.toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const formattedTime = now.toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

const checkContentAuthorization = async (userId, course, lectureId = null) => {
  if (course.lecturerIds && course.lecturerIds.includes(userId)) {
    return true;
  }
  if (lectureId) {
    const lecture = await Lectures.findOne({
      id: lectureId,
      courseId: course.courseId,
    });
    if (lecture && lecture.hostId === userId) {
      return true;
    }
  }
  return false;
};
export const handleGenerateCertificate = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "handleGenerateCertificateController";
  const action = "handleGenerateCertificate";

  const { productId } = req.body;
  const { uid, email } = req.user;

  try {
    const student = await User.findOne({ uid });
    const course = await Product.findOne({ productId });
    const lecturers = await User.find({
      uid: { $in: course.courseDetails.lecturerIds },
    });

    const studentFullName = `${student.firstname} ${student.lastname}`;
    const certId = `CERT-${productId.slice(-5)}-${uid.slice(-5)}`.toUpperCase();

    const composition = {
      certificateId: certId,
      studentName: studentFullName,
      courseTitle: course.title,
      lecturers: lecturers.map((l) => `${l.firstname} ${l.lastname}`),
      institution: "iCampus",
      logoUrl:
        "https://res.cloudinary.com/dbdw3zftx/image/upload/v1759354003/Black_And_White_King_Logo_ydy68f.png",
      issueDate: new Date().toLocaleDateString("en-NG"),
    };
    const pdfBuffer = await generateCertificatePDF(composition);
    const bucket = storage.bucket();
    const file = bucket.file(`certificates/${uid}/${certId}.pdf`);

    await file.save(pdfBuffer, {
      metadata: { contentType: "application/pdf" },
      public: true,
    });
    const firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    const newCert = new Certificate({
      ...composition,
      uid,
      productId,
      pdfUrl: firebaseUrl,
    });
    await newCert.save();
    await createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: uid,
      category: "classroom",
      actionType: "COURSE_COMPLETED",
      title: "Course Completed!",
      message: `Congratulations ${student.firstname}! You've officially completed ${course.title}. Download your certificate now.`,
      entityId: productId,
      entityType: "course",
      recipientEmail: email,
      sendEmail: true,
      payload: {
        userName: student.firstname,
        productName: course.title,
        pdfUrl: firebaseUrl,
        productId: productId,
      },
    });
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      pdfUrl: firebaseUrl,
      certificateId: certId,
      composition,
    });
  } catch (error) {
    console.error("Cert Flow Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
export const submitLectureException = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "submitLectureExceptionController";
  const action = "submitLectureException";
  try {
    const { courseId, lectureId, reason, reasonCategory, courseInfo } =
      req.body;
    const studentId = req.user.id;

    const user = await User.findOne({ uid: studentId });
    const lecture = await Lectures.findOne({ id: lectureId });
    if (!user) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyCount = await Exceptions.countDocuments({
      studentId,
      createdAt: { $gte: startOfMonth },
    });
    const userLimit = EXCEPTION_ACCOUNT_LIMITS[user.tier] || 1;
    const isPaidRequest = monthlyCount >= userLimit;
    let chargedAmount = 0;
    if (isPaidRequest) {
      if ((user.pointsBalance || 0) < EXCEPTION_COST_IN_ICASH) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          `Monthly free limit (${userLimit}) reached. This exception costs ${EXCEPTION_COST_IN_ICASH} iCash, and your balance is insufficient.`,
        );
        return res.status(402).json({
          message: `Monthly free limit (${userLimit}) reached. This exception costs ${EXCEPTION_COST_IN_ICASH} iCash, and your balance is insufficient.`,
        });
      }
      user.pointsBalance -= EXCEPTION_COST_IN_ICASH;
      chargedAmount = EXCEPTION_COST_IN_ICASH;

      const senderTransactionId = generateTransactionId("payment");
      await Transactions.create({
        transactionId: senderTransactionId,
        userId: user.uid,
        type: "payment",
        amountICash: EXCEPTION_COST_IN_ICASH,
        status: "success",
        payType: "out",
        title: "Lectures Exception Purchase (Over Tier Limit)",
        reference: `EXC-REF-${senderTransactionId}`,
      });
    }
    const studentName = `${user.firstname} ${user.lastname}`;
    const studentMatric = user.matricNumber || "N/A";

    const exception = new Exceptions({
      id: generateExceptionId(courseId, lectureId),
      studentId,
      studentInfo: {
        fullname: studentName,
        matricNumber: studentMatric,
      },
      courseInfo,
      courseId,
      lectureId,
      reason,
      reasonCategory,
      status: "pending",
      date: new Date().toISOString(),
    });

    await user.save();
    await exception.save();

    const notificationMessage = isPaidRequest
      ? `Your exception for ${courseInfo.courseTitle} was received. ${EXCEPTION_COST_IN_ICASH} iCash has been deducted.`
      : `Your free exception for ${courseInfo.courseTitle} was successfully submitted.`;

    createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: user.uid,
      category: "finance",
      actionType: "EXCEPTION_SUBMITTED",
      title: "Exception Submitted",
      message: notificationMessage,
      payload: {
        exceptionId: exception.id,
        newBalance: user.pointsBalance,
        courseTitle: courseInfo.courseTitle,
        lectureTitle: lecture.topicName,
      },
      sendEmail: false,
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(201).json({
      success: true,
      message: "Exception submitted successfully",
      newBalance: user.pointsBalance,
      charged: chargedAmount > 0,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};
export const checkTestStatus = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "checkTestStatusController";
  const action = "checkTestStatus";
  try {
    const { assessmentId } = req.params;
    const studentId = req.user.uid;
    const test = await Assessment.findOne({
      $or: [{ id: assessmentId }],
    });
    if (!test) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Assessment not found",
      );
      return res.status(404).json({ message: "Assessment not found" });
    }
    const submission = await TestSubmission.findOne({
      testId: assessmentId,
      studentId: studentId,
    });
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      hasSubmitted: !!submission,
      test: test,
    });
  } catch (error) {
    console.error("Error checking test status:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res
      .status(500)
      .json({ message: "Server error checking assessment status" });
  }
};
export const manageExceptions = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "manageExceptionsController";
  const action = "manageExceptions";
  try {
    const { id } = req.params;
    const { status } = req.body;

    const exception = await Exceptions.findOne({ id: id });
    if (!exception) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture Exception not found",
      );
      return res.status(404).json({ message: "Lecture Exception not found" });
    }

    if (exception.status !== "pending") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "This exception has already been processed",
      );
      return res
        .status(400)
        .json({ message: "This exception has already been processed" });
    }

    let lecturer = null;

    if (status === "approved") {
      const paymentTransaction = await Transactions.findOne({
        reference: `EXC-REF-${id}`,
        status: "success",
        type: "payment",
      });
      if (paymentTransaction) {
        lecturer = await User.findOne({ uid: req.user.uid });
        if (lecturer) {
          lecturer.pointsBalance =
            (lecturer.pointsBalance || 0) +
            EXCEPTION_LECTURER_DIVIDEND_IN_ICASH;
          await lecturer.save();

          const transactionId = generateTransactionId("exceptionsDividend");
          await Transactions.create({
            transactionId,
            userId: lecturer.uid,
            type: "exceptionsDividend",
            amountICash: EXCEPTION_LECTURER_DIVIDEND_IN_ICASH,
            status: "success",
            payType: "in",
            title: `Lectures Exception Dividend for ${exception.courseInfo?.courseTitle || "Course"}`,
            reference: `EXC-REF-${id}`,
            metadata: {
              recipientId: lecturer.uid,
            },
          });
        }
      }
    }

    exception.status = status;
    await exception.save();

    const student = await User.findOne({ uid: exception.studentId });
    const lecture = await Lectures.findOne({ id: exception.lectureId });
    if (student) {
      createNotification({
        notificationId: generateNotificationId("classroom"),
        recipientId: student.uid,
        category: "classroom",
        actionType: "EXCEPTION_UPDATED",
        title: `Exception ${status === "approved" ? "Approved" : "Rejected"}`,
        message: `Your lecture exception request for ${lecture.topicName || "your course"} has been ${status}.`,
        payload: {
          exceptionId: id,
          status,
          courseTitle: exception.courseInfo?.courseTitle,
        },
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      message: `Exception ${status} successfully.`,
      newIcashBalance: lecturer ? lecturer.pointsBalance : undefined,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};
export const createLectureSchedule = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createLectureScheduleController";
  const action = "createLectureSchedule";
  try {
    const preparedData = prepareLectureData(req.body);
    const {
      date,
      repeatWeeks,
      startTime: lectureStartTime,
      endTime,
      location,
      courseId,
      topicName,
      lectureType,
    } = preparedData;

    const lecturerUid = req.user.uid;
    const finalPayload = req.body;
    const lecturesToCreate = [];
    const datesToCheck = [];

    const courseDetails = await Course.findOne({ courseId });
    if (!courseDetails) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }
    if (!courseDetails.lecturerIds.includes(lecturerUid)) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized: You are not an instructor for this course.",
      );
      return res.status(403).json({
        message: "Unauthorized: You are not an instructor for this course.",
      });
    }
    for (let i = 0; i < (repeatWeeks || 1); i++) {
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + i * 7);
      datesToCheck.push(nextDate.toISOString().split("T")[0]);
    }
    const conflict = await Lectures.findOne({
      date: { $in: datesToCheck },
      startTime: { $lt: endTime },
      endTime: { $gt: lectureStartTime },
      $or: [
        { lectureType: "Physical", location: location },
        { courseId: courseId },
        { department: courseDetails.department, level: courseDetails.level },
      ],
    });

    if (conflict) {
      logControllerPerformance(
        controllerName,
        action,
        lectureStartTime,
        "error",
        `Conflict detected on ${conflict.date}! A lecture (${conflict.topicName || "Class"}) conflicts with this time slot.`,
      );
      return res.status(409).json({
        message: `Conflict detected on ${conflict.date}! A lecture (${conflict.topicName || "Class"}) conflicts with this time slot.`,
      });
    }
    datesToCheck.forEach((d) => {
      lecturesToCreate.push({
        ...finalPayload,
        id: generateLectureId(courseId, lectureType),
        date: d,
        department: courseDetails.department,
        level: courseDetails.level,
        hostId: lecturerUid,
        status: "scheduled",
        isTaught: false,
        attendance: [],
      });
    });

    const result = await Lectures.insertMany(lecturesToCreate);
    const students = await User.find({
      usertype: "student",
      department: courseDetails.department,
      level: courseDetails.level,
    }).select("uid firstname");

    const notificationPromises = students.map((student) =>
      createNotification({
        notificationId: generateNotificationId("classroom"),
        recipientId: student.uid,
        category: "academic",
        actionType: "LECTURE_SCHEDULED",
        title: "New Lecture Scheduled",
        message: `A new ${lectureType} session for ${topicName} has been set.`,
        payload: {
          userName: student.firstname,
          topicName: topicName,
          courseId: courseId,
          lectureId: result[0].id,
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
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      }),
    );

    Promise.all(notificationPromises).catch((err) =>
      console.error("Notification Error:", err),
    );

    await User.updateOne(
      { uid: lecturerUid },
      {
        $inc: {
          "monthlyStats.minutesActive": 15,
          "monthlyStats.aiQueries": 2,
        },
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(201).json({
      message: "Lectures scheduled successfully",
      count: result.length,
      lecture: result[0],
    });
  } catch (error) {
    console.error(error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal Server Error" });
  }
};
export const createAssessment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createAssessmentController";
  const action = "createAssessment";
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
      assessmentType = "Test",
      endTime,
    } = req.body;

    let assessment;
    let shouldNotify = false;

    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const existingAssessment = id ? await Assessment.findOne({ id }) : null;

    if (existingAssessment) {
      if (!existingAssessment.isPublished && isPublished) {
        shouldNotify = true;
      }

      assessment = await Assessment.findOneAndUpdate(
        { id },
        {
          title,
          questions,
          duration,
          totalMarks,
          isPublished,
          status,
          scheduledStart,
          dueDate,
          endTime,
          updatedAt: new Date(),
        },
        { new: true },
      );
    } else {
      const personalizedId = generateAssessmentId(
        course.courseId,
        assessmentType,
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
        scheduledStart,
        dueDate,
        endTime,
        createdAt: new Date(),
      });

      await assessment.save();
      await Course.findOneAndUpdate(
        { courseId },
        { $addToSet: { tests: personalizedId } },
      );

      if (isPublished) shouldNotify = true;
    }
    if (
      shouldNotify &&
      course.studentsEnrolled &&
      course.studentsEnrolled.length > 0
    ) {
      const enrolledStudentsList = await User.find({
        uid: { $in: course.studentsEnrolled },
        usertype: "student",
      }).select("uid");

      enrolledStudentsList.forEach((student) => {
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "TEST_CREATED",
          title: "New Assessment Posted",
          message: `A new test "${title}" has been posted for ${course.courseCode}.`,
          payload: {
            userName: student.firstname,
            courseTitle: course.courseTitle,
            testTitle: testTitle,
            dueDate,
            date: formattedDate,
            time: formattedTime,
            course,
          },
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(existingAssessment ? 200 : 201).json({
      message: isPublished ? "Assessment Published" : "Draft Synced",
      data: assessment,
    });
  } catch (error) {
    console.error("Assessment Error:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};
export const deleteLecture = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteLectureController";
  const action = "deleteLecture";
  try {
    const { lectureId } = req.params;
    const lecture = await Lectures.findOne({ id: lectureId });
    if (!lecture) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture not found",
      );
      return res.status(404).json({ message: "Lecture not found" });
    }

    const { courseId, topicName, date, id, hostId } = lecture;
    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Associated course not found",
      );
      return res.status(404).json({ message: "Associated course not found" });
    }
    const isCourseLecturer =
      course.lecturerIds && course.lecturerIds.includes(req.user.uid);
    const isLectureHost = hostId === req.user.uid;

    if (!isCourseLecturer && !isLectureHost) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Access denied. You do not have permissions to cancel this specific lecture slot.",
      );
      return res.status(403).json({
        success: false,
        message:
          "Access denied. You do not have permissions to cancel this specific lecture slot.",
      });
    }
    await Lectures.findOneAndDelete({ id: lectureId });
    if (course.studentsEnrolled && course.studentsEnrolled.length > 0) {
      const students = await User.find({
        uid: { $in: course.studentsEnrolled },
        usertype: "student",
      }).select("uid");

      const notificationPromises = students.map((student) =>
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "LECTURE_CANCELLED",
          title: "Lecture Cancelled",
          message: `The lecture "${topicName}" scheduled for ${date} has been cancelled.`,
          payload: {
            courseId: courseId,
            lectureId: id,
            course,
          },
          entityId: id,
          entityType: "lecture",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        }),
      );

      Promise.all(notificationPromises).catch((err) =>
        console.error("Delete Notification Error:", err),
      );
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Lecture successfully cancelled and enrolled students notified.",
    });
  } catch (error) {
    console.error("Delete Lecture Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchLectureAttendanceReport = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchLectureAttendanceReportController";
  const action = "fetchLectureAttendanceReport";
  try {
    const { lectureId } = req.params;
    const { exceptions = [] } = req.body;

    const lecture = await Lectures.findOne({ id: lectureId });
    if (!lecture) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture record not found.",
      );
      return res.status(404).json({ message: "Lecture record not found." });
    }

    const course = await Course.findOne({ courseId: lecture.courseId });
    const bucket = storage.bucket();
    const filePath = `attendance/${lecture.courseId}/Report-${lectureId}.pdf`;
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    let firebaseUrl = "";

    if (exists) {
      firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    } else {
      const attendanceRecords = await Attendance.find({ lectureId });
      const studentUids = attendanceRecords.map((r) => r.studentId);
      const presentStudents = await User.find({
        uid: { $in: studentUids },
      }).select("firstname lastname matricNumber department uid");
      const pdfBuffer = await generateAttendancePDF({
        course,
        lecture,
        presentStudents,
        exceptions,
      });
      await file.save(pdfBuffer, {
        metadata: { contentType: "application/pdf" },
        public: true,
      });

      firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
      await Lectures.findOneAndUpdate(
        { id: lectureId },
        { pdfUrl: firebaseUrl },
      );
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Attendance sheet compiled successfully!",
      pdfUrl: firebaseUrl,
    });
  } catch (error) {
    console.error("Backend PDF Engine Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal server compilation error." });
  }
};
export const getCourseFinalAttendanceSummary = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getCourseFinalAttendanceSummaryController";
  const action = "getCourseFinalAttendanceSummary";
  try {
    const { courseId } = req.params;
    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course context not found.",
      );
      return res.status(404).json({ message: "Course context not found." });
    }
    const totalLecturesCount = await Lectures.countDocuments({
      courseId,
      status: "completed",
      lectureType: { $ne: "Recorded" },
    });
    if (totalLecturesCount === 0) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "No live lectures recorded yet.",
      );
      return res
        .status(200)
        .json({ message: "No live lectures recorded yet.", summary: [] });
    }
    const attendanceSummary = await User.aggregate([
      {
        $match: { uid: { $in: course.studentsEnrolled } },
      },
      {
        $lookup: {
          from: "attendances",
          let: { studentUid: "$uid" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$studentId", "$$studentUid"] },
                    { $eq: ["$courseId", courseId] },
                    { $eq: ["$status", "Present"] },
                  ],
                },
              },
            },
          ],
          as: "presenceRecords",
        },
      },
      {
        // Project cleanly structured grading fields back to the client interface
        $project: {
          _id: 0,
          uid: 1,
          firstname: 1,
          lastname: 1,
          matricNumber: 1,
          department: 1,
          lecturesAttended: { $size: "$presenceRecords" },
          totalLectures: { $literal: totalLecturesCount },
          attendancePercentage: {
            $round: [
              {
                $multiply: [
                  {
                    $divide: [
                      { $size: "$presenceRecords" },
                      totalLecturesCount,
                    ],
                  },
                  100,
                ],
              },
              1,
            ],
          },
        },
      },
      { $sort: { matricNumber: 1 } },
    ]);
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      courseCode: course.courseCode,
      courseTitle: course.courseTitle,
      totalLecturesHeld: totalLecturesCount,
      data: attendanceSummary,
    });
  } catch (error) {
    console.error(
      "End of Semester Analytics Aggregation Error:",
      error.message,
    );
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res
      .status(500)
      .json({ message: "Failed to generate course grading summary sheet." });
  }
};
export const getCourseLecturePdfDirectory = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getCourseLecturePdfDirectoryController";
  const action = "getCourseLecturePdfDirectory";
  try {
    const { courseId } = req.params;
    const lectureHistory = await Lectures.find({
      courseId,
      status: "completed",
    })
      .select("id topicName date startTime pdfUrl getAttendanceMode")
      .sort({ date: -1 });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      history: lectureHistory,
    });
  } catch (error) {
    console.error("Fetch Directory Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal server registry lookup error." });
  }
};
export const compareStudentFacesWithGemini = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "compareStudentFacesWithGeminiController";
  const action = "compareStudentFacesWithGemini";
  try {
    const { selfieBase64, targetImageUrl } = req.body;
    if (!selfieBase64 || !targetImageUrl) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Verification parameters are missing.",
      );
      return res.status(400).json({
        verified: false,
        message: "Verification parameters are missing.",
      });
    }

    const responseImage = await axios.get(targetImageUrl, {
      responseType: "arraybuffer",
    });
    const targetImageBase64 = Buffer.from(
      responseImage.data,
      "binary",
    ).toString("base64");
    const textInstructions =
      "You are an automated biometric security system monitoring classroom attendance. " +
      "Compare Image 1 (live front-camera phone snapshot) and Image 2 (official institutional database headshot). " +
      "Determine if they show the exact same student. Ignore differences in backgrounds, lighting conditions, " +
      "or casual vs structured expressions. Be strict against proxy attempts or pictures held up to the camera.\n\n" +
      "Return your verdict STRICTLY as a JSON object matching this schema:\n" +
      '{"verified": boolean, "reason": "brief plain text explanation for audit logs"}';

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
      contents: [
        textInstructions,
        {
          inlineData: {
            data: selfieBase64,
            mimeType: "image/jpeg",
          },
        },
        {
          inlineData: {
            data: targetImageBase64,
            mimeType: "image/jpeg",
          },
        },
      ],
    });

    const aiOutputText = response.text;
    if (!aiOutputText) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "AI Engine returned empty validation text.",
      );
      return res.status(500).json({
        verified: false,
        message: "AI Engine returned empty validation text.",
      });
    }
    const validationResult = JSON.parse(aiOutputText);

    if (validationResult.verified === true) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        verified: true,
        message: "Identity confirmed successfully.",
      });
    } else {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        validationResult.reason || "Facial signature mismatch.",
      );

      return res.status(401).json({
        verified: false,
        message: validationResult.reason || "Facial signature mismatch.",
      });
    }
  } catch (error) {
    console.error("Gemini Multi-Modal verification exception:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      verified: false,
      message: "Internal server processing failure.",
    });
  }
};
export const uploadCourseMaterial = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "uploadCourseMaterialController";
  const action = "uploadCourseMaterial";
  try {
    const { courseId } = req.params;
    const { materialUrl, title } = req.body;

    if (!materialUrl) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing material URL parameter.",
      );
      return res
        .status(400)
        .json({ message: "Missing material URL parameter." });
    }
    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course context not found.",
      );
      return res.status(404).json({ message: "Course context not found." });
    }
    const isAuthorized =
      course.lecturerIds && course.lecturerIds.includes(req.user.uid);
    if (!isAuthorized) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized. You are not a lecturer for this course.",
      );
      return res.status(403).json({
        message: "Unauthorized. You are not a lecturer for this course.",
      });
    }
    course.resources = course.resources || [];
    course.resources.push(materialUrl);
    await course.save();

    const fileName = title || materialUrl.split("/").pop() || "New Resource";

    User.find({
      usertype: "student",
      department: course.department,
      level: course.level,
    })
      .select("uid")
      .then((students) => {
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "MATERIAL_UPLOADED",
            title: "New Study Material",
            message: `A new resource file has been uploaded for ${course.courseTitle}.`,
            payload: { course, fileName },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });
      })
      .catch((err) =>
        console.error("Notification dispatch routine failed: ", err),
      );
    await User.updateOne(
      { uid: req.user.uid },
      {
        $inc: {
          "monthlyStats.libraryUsageSessions": 1,
          "monthlyStats.minutesActive": 10,
        },
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Material added successfully",
    });
  } catch (error) {
    console.error("Backend Upload Sync Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ message: "Server error during upload synchronization." });
  }
};
export const deleteCourseMaterial = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteCourseMaterialController";
  const action = "deleteCourseMaterial";
  try {
    const { courseId } = req.params;
    const { materialUrl } = req.body;

    if (!materialUrl) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing reference target URL.",
      );
      return res.status(400).json({ message: "Missing reference target URL." });
    }
    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course context target not found.",
      );
      return res
        .status(404)
        .json({ message: "Course context target not found." });
    }
    const isAuthorized =
      course.lecturerIds && course.lecturerIds.includes(req.user.uid);
    if (!isAuthorized) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Action Denied. Access authorization mismatch.",
      );
      return res
        .status(403)
        .json({ message: "Action Denied. Access authorization mismatch." });
    }
    try {
      const encodedFilePath = materialUrl.split("/o/")[1]?.split("?")[0];
      if (encodedFilePath) {
        const filePath = decodeURIComponent(encodedFilePath);
        const bucket = storage.bucket();

        await bucket.file(filePath).delete();
        console.log(
          `Successfully purged asset from storage bucket: ${filePath}`,
        );
      }
    } catch (storageError) {
      console.error(
        "Firebase Storage Cleanup Failed (Link may be orphaned):",
        storageError,
      );
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        storageError,
      );
    }
    const updatedCourse = await Course.findOneAndUpdate(
      { courseId },
      { $pull: { resources: materialUrl } },
      { new: true },
    );
    const fileName = materialUrl.split("/").pop() || "Resource Document";

    User.find({
      usertype: "student",
      department: updatedCourse.department,
      level: updatedCourse.level,
    })
      .select("uid")
      .then((students) => {
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "MATERIAL_DELETED",
            title: "Study Material Removed",
            message: `A resource file has been removed from ${updatedCourse.courseTitle}.`,
            payload: { course, fileName },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });
      })
      .catch((err) =>
        console.error(
          "Notification push routine failed during deletion: ",
          err,
        ),
      );
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Material permanently deleted",
      resources: updatedCourse.resources,
    });
  } catch (error) {
    console.error("Backend Deletion Pipeline Error: ", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      message: "Internal server error occurred while deleting resource.",
    });
  }
};
export const createCourseContent = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createCourseContentController";
  const action = "createCourseContent";
  try {
    const { courseId } = req.params;
    const { topic, lectureId } = req.body;
    const requesterUid = req.user.uid;

    if (!topic || typeof topic !== "string") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid or missing topic content",
      );
      return res
        .status(400)
        .json({ message: "Invalid or missing topic content" });
    }

    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }
    const isAuthorized = await checkContentAuthorization(
      requesterUid,
      course,
      lectureId,
    );
    if (!isAuthorized) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized Access",
      );
      return res.status(403).json({
        message: "Unauthorized Access",
      });
    }

    course.courseContents.push(topic);
    await course.save();
    User.find({
      usertype: "student",
      department: course.department,
      level: course.level,
    })
      .select("uid")
      .then((students) => {
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "CONTENT_ADDED",
            title: "New Topic Added",
            message: `A new topic "${topic}" was added to ${course.courseCode}.`,
            payload: {
              courseId: course.courseId,
              topic,
              courseTitle: course.courseTitle,
            },
            sendPush: false,
            sendSocket: true,
            saveToDb: true,
          });
        });
      })
      .catch((err) => console.error("Notification Fetch Error:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Topic added successfully",
      updatedContents: course.courseContents,
    });
  } catch (error) {
    console.error("Add Content Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ message: "Server error processing your request" });
  }
};
export const editCourseContent = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "editCourseContentController";
  const action = "editCourseContent";
  try {
    const { courseId } = req.params;
    const { index, updatedTopic, lectureId } = req.body;
    const requesterUid = req.user.uid;

    if (typeof index !== "number" || !updatedTopic) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required update body fields",
      );
      return res
        .status(400)
        .json({ message: "Missing required update body fields" });
    }
    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const isAuthorized = await checkContentAuthorization(
      requesterUid,
      course,
      lectureId,
    );
    if (!isAuthorized) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized Access",
      );
      return res.status(403).json({
        message: "Unauthorized Access",
      });
    }

    if (index < 0 || index >= course.courseContents.length) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Target topic position index out of bounds",
      );
      return res
        .status(400)
        .json({ message: "Target topic position index out of bounds" });
    }
    const updateQuery = {};
    updateQuery[`courseContents.${index}`] = updatedTopic;

    const updatedCourse = await Course.findOneAndUpdate(
      { courseId },
      { $set: updateQuery },
      { new: true },
    );

    User.find({
      usertype: "student",
      department: updatedCourse.department,
      level: updatedCourse.level,
    })
      .select("uid")
      .then((students) => {
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "CONTENT_MUTATED",
            title: "Course Syllabus Updated",
            message: `A topic in ${updatedCourse.courseCode} has been edited to "${updatedTopic}".`,
            payload: {
              course: updatedCourse,
              updatedTopic,
              courseTitle: updatedCourse.courseTitle,
            },
            sendEmail: false,
            sendPush: false,
            sendSocket: true,
            saveToDb: true,
          });
        });
      })
      .catch((err) => console.error("Notification Error:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Topic updated successfully",
      updatedContents: updatedCourse.courseContents,
    });
  } catch (error) {
    console.error("Edit Content Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ message: "Server error updating curriculum topic" });
  }
};
export const deleteCourseContent = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteCourseContentController";
  const action = "deleteCourseContent";
  try {
    const { courseId } = req.params;
    const { index, lectureId } = req.body;
    const requesterUid = req.user.uid;

    if (typeof index !== "number") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Target element index parameter required",
      );
      return res
        .status(400)
        .json({ message: "Target element index parameter required" });
    }
    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const isAuthorized = await checkContentAuthorization(
      requesterUid,
      course,
      lectureId,
    );
    if (!isAuthorized) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized Access",
      );
      return res.status(403).json({ message: "Unauthorized Access" });
    }

    if (index < 0 || index >= course.courseContents.length) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Target position index out of array bounds",
      );
      return res
        .status(400)
        .json({ message: "Target position index out of array bounds" });
    }
    const removedTopic = course.courseContents.splice(index, 1)[0];
    await course.save();

    User.find({
      usertype: "student",
      department: course.department,
      level: course.level,
    })
      .select("uid")
      .then((students) => {
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "CONTENT_DELETION",
            title: "Syllabus Content Removed",
            message: `"${removedTopic}" was removed from the course plan of ${course.courseCode}.`,
            payload: {
              courseId: course.courseId,
              removedTopic,
              course,
              courseTitle: course.courseTitle,
            },
            sendEmail: false,
            sendPush: false,
            sendSocket: true,
            saveToDb: true,
          });
        });
      })
      .catch((err) => console.error("Notification Error:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Topic removed successfully",
      updatedContents: course.courseContents,
    });
  } catch (error) {
    console.error("Delete Content Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ message: "Server error processing array removal operation" });
  }
};
export const createCourseAssignment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createCourseAssignmentController";
  const action = "createCourseAssignment";
  try {
    const { courseId } = req.params;
    const { title, description, dueDate, submissionMethod, lectureId } =
      req.body;
    const requesterUid = req.user.uid;

    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }
    const isAuthorized = await checkContentAuthorization(
      requesterUid,
      course,
      lectureId,
    );
    if (!isAuthorized) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized Access",
      );
      return res.status(403).json({
        message: "Unauthorized Access",
      });
    }

    const assignmentId = generateAssignmentId(courseId);
    const newAssignment = {
      assignmentId,
      title,
      description,
      dueDate: new Date(dueDate),
      submissionMethod,
      lectureId,
      courseId,
      fileUrl: req.file ? req.file.path : null,
      submissions: [],
    };

    course.assignments.push(newAssignment);
    await course.save();

    const formattedDate = new Date(dueDate).toLocaleDateString();
    User.find({
      usertype: "student",
      department: course.department,
      level: course.level,
    })
      .select("uid")
      .then((students) => {
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "ASSIGNMENT_CREATED",
            title: "New Assignment",
            message: `New assignment uploaded for ${course.courseTitle}: "${title}". Due: ${formattedDate}`,
            payload: {
              course,
              assignmentId,
              assignmentTitle: title,
              dueDate: formattedDate,
            },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });
      })
      .catch((err) =>
        console.error("Assignment Notification Dispatch Failure:", err),
      );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(201).json(course.assignments);
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ message: error.message });
  }
};
export const deleteCourseAssignment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteCourseAssignmentController";
  const action = "deleteCourseAssignment";
  try {
    const { courseId, assignmentId } = req.params;
    const requesterUid = req.user.uid;

    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const targetAssignment = course.assignments.find(
      (asg) => asg.assignmentId === assignmentId,
    );
    if (!targetAssignment) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Target assignment not found within this course profile",
      );
      return res.status(404).json({
        message: "Target assignment not found within this course profile",
      });
    }
    const isAuthorized = await checkContentAuthorization(
      requesterUid,
      course,
      targetAssignment.lectureId,
    );
    if (!isAuthorized) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized Access",
      );
      return res.status(403).json({ message: "Unauthorized Access" });
    }

    const updatedCourse = await Course.findOneAndUpdate(
      { courseId },
      { $pull: { assignments: { assignmentId: assignmentId } } },
      { new: true },
    );

    User.find({
      usertype: "student",
      department: updatedCourse.department,
      level: updatedCourse.level,
    })
      .select("uid")
      .then((students) => {
        students.forEach((student) => {
          createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "ASSIGNMENT_REMOVED",
            title: "Assignment Cancelled",
            message: `The assignment "${targetAssignment.title}" has been removed by the instructor.`,
            payload: { course, assignmentId, title: targetAssignment.title },
            sendEmail: false,
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        });
      })
      .catch((err) => console.error("Wipe notification thread failed:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Assignment deleted successfully",
      assignments: updatedCourse.assignments,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ message: error.message });
  }
};
export const getAssessmentReport = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getAssessmentReportController";
  const action = "getAssessmentReport";
  try {
    const token = req.headers.authorization?.split(" ")[1] || req.query.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const { testId } = req.params;
    const test = await Assessment.findOne({ id: testId });
    if (!test) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Assessment not found",
      );
      return res.status(404).json({ error: "Assessment not found" });
    }

    const isPastDue = new Date() > new Date(test.dueDate);
    if (!isPastDue) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Analysis is only available after the due date.",
      );
      return res
        .status(403)
        .json({ error: "Analysis is only available after the due date." });
    }
    const bucket = storage.bucket();
    const filePath = `assessments/${test.courseId}/Analysis-${testId}.pdf`;
    const file = bucket.file(filePath);
    const [exists] = await file.exists();

    if (exists) {
      const firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ success: true, downloadUrl: firebaseUrl });
    }
    const course = await Course.findOne({ courseId: test.courseId });
    const submissions = await TestSubmission.find({ testId });
    const enrolledStudents = await User.find({
      enrolledCourses: test.courseId,
    });

    const submittedIds = submissions.map((s) => s.studentId);
    const absentees = enrolledStudents
      .filter((student) => !submittedIds.includes(student.uid))
      .map((student) => ({
        matricNumber: student.matricNumber || "N/A",
        studentName:
          (student.firstname && student.lastname
            ? `${student.firstname} ${student.lastname}`
            : null) ||
          student.name ||
          "Unknown Student",
      }));

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

    const reportData = {
      course,
      test,
      submissions,
      absentees,
      analytics: {
        topPerformers,
        passedCount,
        failedCount,
        passRate,
      },
    };
    const pdfBuffer = await generateTestAnalysisPDF(reportData);
    await file.save(pdfBuffer, {
      metadata: {
        contentType: "application/pdf",
      },
      public: true,
    });

    const firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      downloadUrl: firebaseUrl,
      assessmentAnalytics: reportData,
    });
  } catch (error) {
    console.error("PDF Handler Exception Error: ", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      error: "Error generating or processing assessment analysis report",
    });
  }
};
export const submitAssessment = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "submitAssessmentController";
  const action = "submitAssessment";
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { testId, answers, proctoringData, score } = req.body;
    if (!testId || !answers) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required submission data.",
      );
      return res
        .status(400)
        .json({ message: "Missing required submission data." });
    }
    const existingSubmission = await TestSubmission.findOne({
      testId,
      studentId: req.user.uid,
    }).session(session);
    if (existingSubmission) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "You have already submitted this test.",
      );
      return res
        .status(403)
        .json({ message: "You have already submitted this test." });
    }
    const rawSelfieStatus = proctoringData?.entrySelfieUrl || "";
    const isImpersonator = rawSelfieStatus.startsWith("FRAUD_BLOCKED");
    const isTabFlagged = (proctoringData?.tabSwitchCount || 0) >= 3;
    const isFlagged = isImpersonator || isTabFlagged;
    let verificationStatus = "Verified";

    if (isImpersonator) {
      verificationStatus = "Impersonation_Detected";
    } else if (rawSelfieStatus.includes("Skipped")) {
      verificationStatus = "Skipped_No_Avatar";
    } else if (!rawSelfieStatus || rawSelfieStatus.includes("Failed")) {
      verificationStatus = "Unverified_Camera_Failure";
    }

    const studentUser = await User.findOne({ uid: req.user.uid }).session(
      session,
    );
    const matricNumber = studentUser?.matricNumber || "N/A";
    const customSubmissionId = generateSubmissionId(testId, matricNumber);

    const newSubmission = new TestSubmission({
      id: customSubmissionId,
      verificationStatus,
      ...req.body,
      studentId: req.user.uid,
      isFlagged: isFlagged,
      score: isImpersonator ? 0 : score || 0,
      proctoringData: {
        deviceId: proctoringData?.deviceId || "Unknown",
        entrySelfieUrl: rawSelfieStatus,
        tabSwitchCount: proctoringData?.tabSwitchCount || 0,
      },
    });
    await newSubmission.save({ session });

    let updatedUser = studentUser;
    if (!isImpersonator) {
      updatedUser = await User.findOneAndUpdate(
        { uid: req.user.uid },
        {
          $addToSet: { completedTests: testId },
          $inc: { overallProgress: 5 },
        },
        { session, new: true },
      );
    }

    const test = await Assessment.findOne({ id: testId }).session(session);
    await session.commitTransaction();
    createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: req.user.uid,
      category: "academic",
      actionType: isImpersonator ? "TEST_FRAUD_BLOCKED" : "TEST_SUBMITTED",
      title: isImpersonator ? "Submission Flagged!" : "Assessment Submitted!",
      message: isImpersonator
        ? `Your submission for "${test?.title || "the assessment"}" failed biometric verification. System security response logs have been populated.`
        : `Your submission for "${test?.title || "the assessment"}" has been received successfully.`,
      payload: {
        testId,
        submissionId: customSubmissionId,
        isFlagged,
        actionEnforced: isImpersonator ? "SCORE_NULLIFIED" : "RECORDED",
        title: test?.title,
      },
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(201).json({
      success: !isImpersonator,
      message: isImpersonator
        ? "Submission rejected due to high-risk validation failure."
        : "Test submitted and graded successfully.",
      submissionId: customSubmissionId,
      flagged: isFlagged,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Submission Error Engine Exception:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  } finally {
    session.endSession();
  }
};
export const editLectures = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "editLecturesController";
  const action = "editLectures";
  try {
    const { lectureId, courseId } = req.params;
    const { newDate, newStartTime, topicName, lectureType, location } =
      req.body;

    const originalLecture = await Lectures.findOne({ id: lectureId });
    if (!originalLecture) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture not found",
      );
      return res.status(404).json({ message: "Lecture not found" });
    }
    const course = await Course.findOne({ courseId });
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Associated course not found",
      );
      return res.status(404).json({ message: "Associated course not found" });
    }
    const isCourseLecturer =
      course.lecturerIds && course.lecturerIds.includes(req.user.uid);
    const isLectureHost = originalLecture.hostId === req.user.uid;

    if (!isCourseLecturer && !isLectureHost) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Access denied",
      );
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const changes = [];
    let updatedStatus = originalLecture.status;
    let primaryActionType = "LECTURE_UPDATED";

    const isDateChanged = newDate && newDate !== originalLecture.date;
    const isTimeChanged =
      newStartTime && newStartTime !== originalLecture.startTime;

    if (isDateChanged || isTimeChanged) {
      changes.push("schedule");
      updatedStatus = "postponed";
      primaryActionType = "LECTURE_POSTPONED";
    }

    const isLocationChanged =
      location !== undefined && location !== originalLecture.location;
    if (isLocationChanged) {
      changes.push("venue");
      if (primaryActionType === "LECTURE_UPDATED") {
        primaryActionType = "LECTURE_VENUE_CHANGE";
      }
    }

    const isTypeChanged =
      lectureType && lectureType !== originalLecture.lectureType;
    if (isTypeChanged) {
      changes.push("delivery format");
      if (primaryActionType === "LECTURE_UPDATED") {
        primaryActionType = "LECTURE_TYPE_CHANGE";
      }
    }

    const isTopicChanged = topicName && topicName !== originalLecture.topicName;
    if (isTopicChanged) {
      changes.push("topic");
    }

    if (changes.length === 0) {
      return res.status(200).json({
        message: "No updates detected",
        updatedLecture: originalLecture,
      });
    }

    const updatePayload = {
      topicName: topicName || originalLecture.topicName,
      lectureType: lectureType || originalLecture.lectureType,
      location: lectureType === "Physical" ? location : undefined, // Wipe venue data if shifted online
      date: newDate || originalLecture.date,
      startTime: newStartTime || originalLecture.startTime,
      status: updatedStatus,
    };

    const updatedLecture = await Lectures.findOneAndUpdate(
      { id: lectureId },
      updatePayload,
      { new: true },
    );

    const students = await User.find({
      usertype: "student",
      department: course.department,
      level: course.level,
    }).select("uid firstName");

    const changeListString = changes.join(", ");
    const notificationPromises = students.map((student) => {
      let updateDetailsMessage = `The details for your lecture "${updatePayload.topicName}" have been updated (${changeListString}).`;
      if (isDateChanged || isTimeChanged) {
        updateDetailsMessage = `The lecture "${updatePayload.topicName}" has been rescheduled to ${updatePayload.date} at ${updatePayload.startTime}.`;
      } else if (
        isLocationChanged &&
        updatePayload.lectureType === "Physical"
      ) {
        updateDetailsMessage = `The venue for "${updatePayload.topicName}" has been updated to ${updatePayload.location}.`;
      } else if (isTypeChanged) {
        updateDetailsMessage = `The delivery format for "${updatePayload.topicName}" has changed to ${updatePayload.lectureType}.`;
      }

      return createNotification({
        notificationId: generateNotificationId("classroom"),
        recipientId: student.uid,
        category: "classroom",
        actionType: primaryActionType,
        title: `Lecture Update: ${course.courseId}`,
        message: updateDetailsMessage,
        payload: {
          userName: student.firstName,
          topicName: updatePayload.topicName,
          newDate: updatePayload.date,
          newTime: updatePayload.startTime,
          lectureType: updatePayload.lectureType,
          location: updatePayload.location,
          courseId: courseId,
          lectureId: lectureId,
          changedAttributes: changes,
          course,
        },
        entityId: lectureId,
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      });
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Notify Error:", err),
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      message: `Lecture modified successfully. Notification sent with type: ${primaryActionType}`,
      updatedLecture,
    });
  } catch (error) {
    console.error("Update Handler Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal Server Error" });
  }
};
export const submitOnlineClassAttendance = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "submitOnlineClassAttendanceController";
  const action = "submitOnlineClassAttendance";
  try {
    const { lectureId, courseId, status } = req.body;
    const studentId = req.user.uid;
    if (!lectureId || !courseId || !status) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required online attendance parameters.",
      );
      return res
        .status(400)
        .json({ error: "Missing required online attendance parameters." });
    }

    const lecture = await Lectures.findOne({ id: lectureId });
    if (!lecture) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture not found.",
      );
      return res.status(404).json({ error: "Lecture not found." });
    }

    const gracePeriod = 60 * 60 * 1000;
    const currentTime = new Date();
    const expiryTime = new Date(lecture.endTime).getTime() + gracePeriod;

    if (currentTime.getTime() > expiryTime) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Submission window closed",
      );
      return res.status(403).json({
        error: "Submission window closed",
      });
    }
    const existingRecord = await Attendance.findOne({ studentId, lectureId });

    const record = await Attendance.findOneAndUpdate(
      { studentId, lectureId },
      {
        courseId,
        status,
        checkData: [],
        timestamp: currentTime,
      },
      { upsert: true, new: true },
    );
    if (
      status === "Present" &&
      (!existingRecord || existingRecord.status !== "Present")
    ) {
      await Promise.all([
        Course.updateOne(
          { courseId, "students.id": studentId },
          { $inc: { "students.$.classesAttended": 1 } },
        ),
        User.updateOne(
          { uid: studentId },
          { $inc: { "monthlyStats.libraryUsageSessions": 1 } },
        ),
      ]);
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Attendance recorded successfully at end of class session.",
    });
  } catch (err) {
    console.error("iCampus Backend Error:", err.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    res
      .status(500)
      .json({ error: "Internal server error during attendance sync." });
  }
};
export const uploadCourseDetails = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "uploadCourseDetailsController";
  const action = "uploadCourseDetails";
  try {
    if (!req.files || req.files.length === 0) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "No files uploaded",
      );
      return res.status(400).json({ message: "No files uploaded" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" },
    });

    const prompt = `
        Extract all details from this course registration document. 
        It may consist of multiple pages or images. Combine the data into one response.
        
        Return ONLY a valid JSON object matching this schema:
        {
          "studentInfo": {
              "schoolName": "University name from header/logo",
              "studentName": "Full name",
              "college": "Faculty name",
              "department": "Department",
              "level": "Level digits only",
              "matricNo": "Registration number",
              "date": "Document date"
          },
          "courses": [
            {
              "courseCode": "e.g., GET 311",
              "courseTitle": "Full title",
              "semester": "First" or "Second",
              "session": "e.g., 2024/2025",
              "credits": 3
            }
          ]
        }
        Note: If a course appears across page breaks, do not duplicate it.
      `;

    const fileParts = req.files.map((file) => ({
      inlineData: {
        data: file.buffer.toString("base64"),
        mimeType: file.mimetype,
      },
    }));

    const result = await model.generateContent([prompt, ...fileParts]);

    let extraction;
    try {
      extraction = JSON.parse(result.response.text());
    } catch (e) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "AI returned invalid JSON structure.",
      );
      return res
        .status(422)
        .json({ message: "AI returned invalid JSON structure." });
    }

    const { studentInfo, courses } = extraction;

    if (!studentInfo || !courses || courses.length === 0) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Failed to extract structured course records.",
      );
      return res
        .status(422)
        .json({ message: "Failed to extract structured course records." });
    }
    const submittedMatric = studentInfo.matricNo
      ?.replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
    const userMatric = req.user.matricNumber
      ?.replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();

    if (!submittedMatric || submittedMatric !== userMatric) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        `Document verification failed. Matric Number mismatch.`,
      );
      return res.status(403).json({
        message: `Document verification failed. Matric Number mismatch.`,
      });
    }

    const processedCourseIds = await Promise.all(
      courses.map(async (courseData) => {
        const cleanTitle = courseData.courseTitle
          .trim()
          .replace(/\s+/g, "\\s*");
        let course = await Course.findOne({
          courseTitle: { $regex: new RegExp(`^${cleanTitle}$`, "i") },
          schoolName: req.user.schoolName,
        });

        if (course) {
          await Course.updateOne({
            $addToSet: { studentsEnrolled: req.user.uid },
          });
          return course.courseId;
        } else {
          const uniqueCourseId = generateCourseId(
            courseData.courseTitle,
            courseData.courseCode,
          );
          const newCourse = new Course({
            ...courseData,
            courseId: uniqueCourseId,
            schoolName: req.user.schoolName,
            department: studentInfo.department || req.user.department,
            level: studentInfo.level,
            studentsEnrolled: [req.user.uid],
            isActive: true,
          });
          await newCourse.save();
          return uniqueCourseId;
        }
      }),
    );
    await User.findOneAndUpdate(
      { uid: req.user.uid },
      { $addToSet: { coursesEnrolled: { $each: processedCourseIds } } },
    );
    createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: req.user.uid,
      category: "academic",
      actionType: "COURSES_EXTRACTED",
      title: "Course Registration Synced",
      message: `Successfully extracted ${courses.length} courses for the ${studentInfo.level}L curriculum.`,
      payload: {
        courseCount: courses.length,
        level: studentInfo.level,
        matricNo: studentInfo.matricNo,
        semester: courses.semester.toLowerCase(),
        session: courses.session,
      },
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    }).catch((err) => console.error("Notification Dispatch Error:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      message: `Processed ${courses.length} courses successfully.`,
      studentName: studentInfo.studentName,
      coursesCount: courses.length,
    });
  } catch (error) {
    console.error("Extraction Route Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Internal Server Error" });
  }
};
export const uploadCourseDetailsManually = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "uploadCourseDetailsManuallyController";
  const action = "uploadCourseDetailsManually";
  try {
    const { courseTitle, courseCode, credits } = req.body;
    const { uid, usertype, schoolName, department } = req.user;
    if (!courseTitle || !courseCode) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course Title or Code is required.",
      );
      return res
        .status(400)
        .json({ message: "Course Title or Code is required." });
    }
    const cleanCode = courseCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cleanTitle = courseTitle.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const looseCodeRegex = new RegExp(cleanCode.split("").join("\\s*"), "i");
    const looseTitleRegex = new RegExp(cleanTitle.split("").join("\\s*"), "i");
    let course = await Course.findOne({
      schoolName: schoolName,
      $or: [
        { courseCode: { $regex: looseCodeRegex } },
        { courseTitle: { $regex: looseTitleRegex } },
      ],
    });

    let assignedCourseId;

    if (course) {
      assignedCourseId = course.courseId;
      if (usertype === "lecturer") {
        await Course.updateOne({ $addToSet: { lecturerIds: uid } });
      } else {
        await Course.updateOne({ $addToSet: { studentsEnrolled: uid } });
      }
    } else {
      assignedCourseId = generateCourseId(courseTitle, courseCode);

      const newCourseData = {
        courseId: assignedCourseId,
        courseCode: courseCode.trim(),
        courseTitle: courseTitle.trim(),
        credits: parseInt(credits, 10) || 0,
        schoolName: schoolName,
        department: department || "General",
        isActive: true,
        lecturerIds: usertype === "lecturer" ? [uid] : [],
        studentsEnrolled: usertype !== "lecturer" ? [uid] : [],
      };

      const newCourse = new Course(newCourseData);
      await newCourse.save();
    }
    const userFieldToUpdate =
      usertype === "lecturer" ? "coursesTaught" : "coursesEnrolled";

    await User.findOneAndUpdate(
      { uid: uid },
      { $addToSet: { [userFieldToUpdate]: assignedCourseId } },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: course
        ? "You have been added to this existing course curriculum successfully."
        : "New course catalog entry generated and linked to your profile successfully.",
      courseId: assignedCourseId,
    });
  } catch (error) {
    console.error("Manual Course Creation Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
export const handleUpcomingLectureRemindersCron = async () => {
  const startTime = Date.now();
  const controllerName = "handleUpcomingLectureRemindersCronController";
  const action = "handleUpcomingLectureRemindersCron";
  try {
    const leadTimeMinutes = 45;
    const targetTime = new Date(Date.now() + leadTimeMinutes * 60 * 1000);

    const targetDateStr = targetTime.toISOString().split("T")[0];
    const targetHourMin = targetTime.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    console.log(
      `[CRON_ENGINE] Scanning for live sessions matching: [Date: ${targetDateStr}] [Time: ${targetHourMin}]`,
    );
    const upcomingLectures = await Lectures.aggregate([
      {
        $match: {
          date: targetDateStr,
          startTime: targetHourMin,
          status: "scheduled",
        },
      },
      {
        $lookup: {
          from: "courses",
          localField: "courseId",
          foreignField: "courseId",
          as: "courseContext",
        },
      },
      {
        $unwind: "$courseContext",
      },
      {
        $project: {
          id: 1,
          topicName: 1,
          startTime: 1,
          lectureType: 1,
          location: 1,
          courseId: 1,
          "courseContext.courseCode": 1,
          "courseContext.studentsEnrolled": 1,
        },
      },
    ]);

    if (!upcomingLectures || upcomingLectures.length === 0) {
      console.log(
        `[CRON_ENGINE] Verification cycle completed. 0 matching upcoming lectures identified.`,
      );
      return;
    }
    for (const lecture of upcomingLectures) {
      const studentUids = lecture.courseContext.studentsEnrolled;

      if (!studentUids || studentUids.length === 0) {
        console.log(
          `[CRON_ENGINE] Skipping session ${lecture.id}: No student enrollments detected.`,
        );
        continue;
      }
      const enrolledStudents = await User.find({
        uid: { $in: studentUids },
      })
        .select("uid firstname")
        .lean();

      const notificationPromises = enrolledStudents.map(async (student) => {
        try {
          return await createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            category: "classroom",
            actionType: "LECTURE_REMINDER",
            title: `Class Starting Soon: ${lecture.courseContext.courseCode}`,
            message: `Your ${lecture.lectureType || "live"} lecture on "${lecture.topicName}" starts in 45 minutes at ${lecture.location || "Online"}.`,
            payload: {
              courseId: lecture.courseId,
              lectureId: lecture.id,
              topicName: lecture.topicName,
              startTime: lecture.startTime,
              location: lecture.location,
              userName: student.firstname || "Student",
            },
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        } catch (err) {
          console.error(
            `[CRON_NOTIFICATION_ERR] Failed for recipient ${student.uid}:`,
            err.message,
          );
          // Return null or undefined so Promise.all resolved array doesn't break
          return null;
        }
      });

      await Promise.all(notificationPromises);

      logControllerPerformance(controllerName, action, startTime, "success");
      console.log(
        `[CRON_SUCCESS] Dispatched reminders for ${lecture.courseContext.courseCode} - "${lecture.topicName}" to ${enrolledStudents.length} students.`,
      );
    }
  } catch (error) {
    console.error(
      "[CRON_CRITICAL_EXCEPTION] Failed executing automated reminder cycles:",
      error.message,
    );
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
  }
};
export const sendInactiveUserReminders = async () => {
  const startTime = Date.now();
  const controllerName = "sendInactiveUserRemindersController";
  const action = "sendInactiveUserReminders";
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const inactiveUsers = await UserDownloads.find({
      lastAccessed: { $lt: threeDaysAgo },
    }).lean();

    if (!inactiveUsers.length) {
      return;
    }
    const notificationPromises = inactiveUsers.map(async (record) => {
      const activeCourse = [...record.ownedProducts]
        .sort((a, b) => b.lastWatched - a.lastWatched)
        .find((p) => p.progress < 100);

      if (!activeCourse) return null;

      try {
        return await createNotification({
          notificationId: generateNotificationId("reminder"),
          recipientId: record.userId,
          category: "academic",
          actionType: "LEARNING_REMINDER",
          title: "Don't break your streak",
          message: `It's been a few days since you accessed your course. Your progress is waiting for you!`,
          sendEmail: false,
          sendPush: true,
          payload: {
            productId: activeCourse.productId,
            currentProgress: activeCourse.progress,
          },
        });
      } catch (err) {
        console.error(
          `[REMINDER_ERR] Failed to send notification to user ${record.userId}:`,
          err.message,
        );
        return null;
      }
    });
    const results = await Promise.all(notificationPromises);
    const sentCount = results.filter((result) => result !== null).length;

    logControllerPerformance(controllerName, action, startTime, "success");
    console.log(
      `[REMINDER_CRON] Reminder notifications sent to ${sentCount} users.`,
    );
  } catch (error) {
    console.error("[REMINDER_CONTROLLER_ERR]:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
  }
};
export const getCourseGradebook = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getCourseGradebookController";
  const action = "getCourseGradebook";
  const { courseId } = req.params;

  try {
    const course = await Course.findOne({ courseId }).select(
      "studentsEnrolled tests",
    );
    if (!course) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }
    const gradebookData = await User.aggregate([
      { $match: { uid: { $in: course.studentsEnrolled } } },
      {
        $lookup: {
          from: "lectures",
          let: { studentId: "$uid" },
          pipeline: [
            { $match: { courseId: courseId } },
            { $unwind: "$attendance" },
            {
              $match: {
                $expr: { $eq: ["$attendance.studentId", "$$studentId"] },
              },
            },
          ],
          as: "attendanceRecords",
        },
      },
      {
        $lookup: {
          from: "testSubmission",
          let: { studentId: "$uid" },
          pipeline: [
            { $match: { testId: { $in: course.tests.map((t) => t.id) } } },
            { $match: { $expr: { $eq: ["$studentId", "$$studentId"] } } },
          ],
          as: "testSubmissions",
        },
      },
      {
        $lookup: {
          from: "exceptions",
          let: { studentId: "$uid" },
          pipeline: [
            { $match: { courseId: courseId } },
            { $match: { $expr: { $eq: ["$studentId", "$$studentId"] } } },
          ],
          as: "exceptions",
        },
      },
      {
        $project: {
          studentName: { $concat: ["$firstname", " ", "$lastname"] },
          matricNumber: "$matricNumber",
          attendanceCount: { $size: "$attendanceRecords" },
          attendanceSum: {
            $add: [
              {
                $size: {
                  $filter: {
                    input: "$attendanceRecords",
                    as: "rec",
                    cond: { $eq: ["$$rec.attendance.status", "Present"] },
                  },
                },
              },
              {
                $size: {
                  $filter: {
                    input: "$exceptions",
                    as: "ex",
                    cond: { $eq: ["$$ex.status", "approved"] },
                  },
                },
              },
            ],
          },
          testScores: "$testSubmissions.score",
          testSum: { $sum: "$testSubmissions.score" },
          exceptions: "$exceptions",
          allActivities: {
            $concatArrays: [
              "$attendanceRecords",
              "$testSubmissions",
              "$exceptions",
            ],
          },
        },
      },
    ]);

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, data: gradebookData });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: error.message });
  }
};