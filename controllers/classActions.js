import { storage, db } from "../config/firebaseAdmin.js";
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
    const lectureQuery = await Lectures.where("id", "==", lectureId)
      .where("courseId", "==", course.courseId)
      .limit(1)
      .get();

    if (!lectureQuery.empty) {
      const lecture = lectureQuery.docs[0].data();
      if (lecture.hostId === userId) {
        return true;
      }
    }
  }
  return false;
};
export const handleGenerateCertificate = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "handleGenerateCertificateController";
  const action = "handleGenerateCertificate";

  const { productId } = req.body;
  const uid = req.user?.uid || req.user?.id;
  const email = req.user?.email;

  try {
    const studentQuery = await User.where("uid", "==", uid).limit(1).get();
    if (studentQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Student not found",
      );
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }
    const student = studentQuery.docs[0].data();
    const courseQuery = await Product.where("productId", "==", productId)
      .limit(1)
      .get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course product not found",
      );
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }
    const course = courseQuery.docs[0].data();
    const lecturerIds = course.courseDetails?.lecturerIds || [];
    let lecturers = [];
    if (lecturerIds.length > 0) {
      const lecturersQuery = await User.where("uid", "in", lecturerIds).get();
      lecturersQuery.forEach((doc) => {
        lecturers.push(doc.data());
      });
    }

    const studentFullName =
      `${student.firstname || ""} ${student.lastname || ""}`.trim();
    const certId = `CERT-${productId.slice(-5)}-${uid.slice(-5)}`.toUpperCase();

    const composition = {
      certificateId: certId,
      studentName: studentFullName,
      courseTitle: course.title,
      lecturers: lecturers.map((l) =>
        `${l.firstname || ""} ${l.lastname || ""}`.trim(),
      ),
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
    const now = new Date();

    const certData = {
      ...composition,
      uid,
      productId,
      pdfUrl: firebaseUrl,
      createdAt: now,
      updatedAt: now,
    };

    await Certificate.doc(certId).set(certData);

    await createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: uid,
      category: "classroom",
      actionType: "COURSE_COMPLETED",
      title: "Course Completed!",
      message: `Congratulations ${student.firstname || "Student"}! You've officially completed ${course.title}. Download your certificate now.`,
      entityId: productId,
      entityType: "course",
      recipientEmail: email || student.email,
      sendEmail: true,
      saveToDb: true,
      payload: {
        userName: student.firstname,
        productName: course.title,
        pdfUrl: firebaseUrl,
        productId: productId,
      },
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
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
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
};
export const submitLectureException = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "submitLectureExceptionController";
  const action = "submitLectureException";

  try {
    const { courseId, lectureId, reason, reasonCategory, courseInfo } = req.body;
    const studentId = req.user?.uid || req.user?.id;
    const userQuery = await User.where("uid", "==", studentId).limit(1).get();
    if (userQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    const userDocRef = userQuery.docs[0].ref;
    const user = userQuery.docs[0].data();
    const lectureQuery = await Lectures.where("id", "==", lectureId).limit(1).get();
    let lectureTopic = "Lecture";
    if (!lectureQuery.empty) {
      const lectureData = lectureQuery.docs[0].data();
      lectureTopic = lectureData.topicName || lectureData.title || "Lecture";
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyExceptionsQuery = await Exceptions
      .where("studentId", "==", studentId)
      .where("createdAt", ">=", startOfMonth)
      .get();

    const monthlyCount = monthlyExceptionsQuery.size;
    const userLimit = EXCEPTION_ACCOUNT_LIMITS[user.tier] || 1;
    const isPaidRequest = monthlyCount >= userLimit;
    let chargedAmount = 0;

    const currentBalance = user.iCashBalance ?? user.pointsBalance ?? 0;
    const now = new Date();

    await db.runTransaction(async (t) => {
      if (isPaidRequest) {
        if (currentBalance < EXCEPTION_COST_IN_ICASH) {
          throw new Error(
            `Monthly free limit (${userLimit}) reached. This exception costs ${EXCEPTION_COST_IN_ICASH} iCash, and your balance is insufficient.`
          );
        }

        const newBalance = currentBalance - EXCEPTION_COST_IN_ICASH;
        chargedAmount = EXCEPTION_COST_IN_ICASH;

        t.update(userDocRef, {
          iCashBalance: newBalance,
          pointsBalance: newBalance,
          updatedAt: now,
        });
        const senderTransactionId = generateTransactionId("payment");
        const txRef = Transactions.doc(senderTransactionId);
        t.set(txRef, {
          transactionId: senderTransactionId,
          userId: user.uid,
          type: "payment",
          amountICash: EXCEPTION_COST_IN_ICASH,
          status: "success",
          payType: "out",
          title: "Lectures Exception Purchase (Over Tier Limit)",
          reference: `EXC-REF-${senderTransactionId}`,
          createdAt: now,
          updatedAt: now,
        });
      }

      const studentName = `${user.firstname || ""} ${user.lastname || ""}`.trim();
      const studentMatric = user.matricNumber || "N/A";
      const exceptionId = generateExceptionId(courseId, lectureId);

      const exceptionRef = Exceptions.doc(exceptionId);
      t.set(exceptionRef, {
        id: exceptionId,
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
        date: now.toISOString(),
        createdAt: now,
        updatedAt: now,
      });
    });

    const updatedBalance = isPaidRequest
      ? currentBalance - EXCEPTION_COST_IN_ICASH
      : currentBalance;

    const notificationMessage = isPaidRequest
      ? `Your exception for ${courseInfo.courseTitle} was received. ${EXCEPTION_COST_IN_ICASH} iCash has been deducted.`
      : `Your free exception for ${courseInfo.courseTitle} was successfully submitted.`;

    await createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: user.uid,
      category: "finance",
      actionType: "EXCEPTION_SUBMITTED",
      title: "Exception Submitted",
      message: notificationMessage,
      saveToDb: true,
      payload: {
        exceptionId: generateExceptionId(courseId, lectureId),
        newBalance: updatedBalance,
        courseTitle: courseInfo.courseTitle,
        lectureTitle: lectureTopic,
      },
      sendEmail: false,
      sendPush: true,
      sendSocket: true,
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(201).json({
      success: true,
      message: "Exception submitted successfully",
      newBalance: updatedBalance,
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
    const statusCode = error.message.includes("insufficient") || error.message.includes("limit") ? 402 : 500;
    return res.status(statusCode).json({ message: error.message });
  }
};
export const checkTestStatus = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "checkTestStatusController";
  const action = "checkTestStatus";
  try {
    const { assessmentId } = req.params;
    const studentId = req.user?.uid || req.user?.id;
    const assessmentQuery = await Assessment
      .where("id", "==", assessmentId)
      .limit(1)
      .get();

    if (assessmentQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Assessment not found",
      );
      return res.status(404).json({ message: "Assessment not found" });
    }

    const testDoc = assessmentQuery.docs[0];
    const test = { id: testDoc.id, ...testDoc.data() };
    const submissionQuery = await TestSubmission
      .where("testId", "==", assessmentId)
      .where("studentId", "==", studentId)
      .limit(1)
      .get();

    const hasSubmitted = !submissionQuery.empty;

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      hasSubmitted: hasSubmitted,
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
    return res
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
    const currentLecturerUid = req.user?.uid || req.user?.id;
    const exceptionQuery = await Exceptions.where("id", "==", id).limit(1).get();
    if (exceptionQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture Exception not found",
      );
      return res.status(404).json({ message: "Lecture Exception not found" });
    }

    const exceptionDocRef = exceptionQuery.docs[0].ref;
    const exception = exceptionQuery.docs[0].data();

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

    let lecturerNewBalance = undefined;
    const now = new Date();

    await db.runTransaction(async (t) => {
      if (status === "approved") {
        const txQuery = await Transactions
          .where("reference", "==", `EXC-REF-${id}`)
          .where("status", "==", "success")
          .where("type", "==", "payment")
          .limit(1)
          .get();

        if (!txQuery.empty) {
          const lecturerQuery = await User.where("uid", "==", currentLecturerUid).limit(1).get();
          if (!lecturerQuery.empty) {
            const lecturerDocRef = lecturerQuery.docs[0].ref;
            const lecturerData = lecturerQuery.docs[0].data();

            const currentPoints = lecturerData.iCashBalance ?? lecturerData.pointsBalance ?? 0;
            lecturerNewBalance = currentPoints + EXCEPTION_LECTURER_DIVIDEND_IN_ICASH;

            t.update(lecturerDocRef, {
              iCashBalance: lecturerNewBalance,
              pointsBalance: lecturerNewBalance,
              updatedAt: now,
            });
            const transactionId = generateTransactionId("exceptionsDividend");
            const divTxRef = Transactions.doc(transactionId);
            t.set(divTxRef, {
              transactionId,
              userId: currentLecturerUid,
              type: "exceptionsDividend",
              amountICash: EXCEPTION_LECTURER_DIVIDEND_IN_ICASH,
              status: "success",
              payType: "in",
              title: `Lectures Exception Dividend for ${exception.courseInfo?.courseTitle || "Course"}`,
              reference: `EXC-REF-${id}`,
              metadata: {
                recipientId: currentLecturerUid,
              },
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }
      t.update(exceptionDocRef, {
        status: status,
        updatedAt: now,
      });
    });

    const studentQuery = await User.where("uid", "==", exception.studentId).limit(1).get();
    const lectureQuery = await Lectures.where("id", "==", exception.lectureId).limit(1).get();

    let studentEmail = "";
    let studentUid = exception.studentId;
    if (!studentQuery.empty) {
      const studentData = studentQuery.docs[0].data();
      studentEmail = studentData.email;
      studentUid = studentData.uid;
    }

    let lectureTopicName = "your course";
    if (!lectureQuery.empty) {
      const lectureData = lectureQuery.docs[0].data();
      lectureTopicName = lectureData.topicName || lectureData.title || "your course";
    }

    await createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: studentUid,
      category: "classroom",
      actionType: "EXCEPTION_UPDATED",
      title: `Exception ${status === "approved" ? "Approved" : "Rejected"}`,
      message: `Your lecture exception request for ${lectureTopicName} has been ${status}.`,
      recipientEmail: studentEmail,
      sendEmail: !!studentEmail,
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
      payload: {
        exceptionId: id,
        status,
        courseTitle: exception.courseInfo?.courseTitle,
      },
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: `Exception ${status} successfully.`,
      newIcashBalance: lecturerNewBalance,
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

    const lecturerUid = req.user?.uid || req.user?.id;
    const finalPayload = req.body;
    const lecturesToCreate = [];
    const datesToCheck = [];
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDoc = courseQuery.docs[0];
    const courseDetails = courseDoc.data();

    if (!courseDetails.lecturerIds || !courseDetails.lecturerIds.includes(lecturerUid)) {
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

    const existingLecturesQuery = await Lectures
      .where("date", "in", datesToCheck)
      .where("startTime", "<", endTime)
      .where("endTime", ">", lectureStartTime)
      .get();

    let conflict = null;
    existingLecturesQuery.forEach((doc) => {
      const lec = doc.data();
      const isPhysicalConflict = lectureType === "Physical" && location && lec.lectureType === "Physical" && lec.location === location;
      const isCourseConflict = lec.courseId === courseId;
      const isDepartmentConflict = lec.department === courseDetails.department && lec.level === courseDetails.level;

      if (isPhysicalConflict || isCourseConflict || isDepartmentConflict) {
        conflict = lec;
      }
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

    const now = new Date();
    const batch = db.batch();
    const createdLecturesList = [];

    datesToCheck.forEach((d) => {
      const lectureId = generateLectureId(courseId, lectureType);
      const lectureRef = Lectures.doc(lectureId);
      const newLectureData = {
        ...finalPayload,
        id: lectureId,
        date: d,
        department: courseDetails.department,
        level: courseDetails.level,
        hostId: lecturerUid,
        status: "scheduled",
        isTaught: false,
        attendance: [],
        createdAt: now,
        updatedAt: now,
      };
      batch.set(lectureRef, newLectureData);
      createdLecturesList.push(newLectureData);
    });

    await batch.commit();

    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", courseDetails.department)
      .where("level", "==", courseDetails.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "academic",
          actionType: "LECTURE_SCHEDULED",
          title: "New Lecture Scheduled",
          message: `A new ${lectureType} session for ${topicName} has been set.`,
          recipientEmail: student.email,
          sendEmail: !!student.email,
          payload: {
            userName: student.firstname,
            topicName: topicName,
            courseId: courseId,
            lectureId: createdLecturesList[0].id,
            lectureType: lectureType,
            location: location,
            time: lectureStartTime,
            date:
              datesToCheck.length > 1
                ? `${datesToCheck[0]} (Repeats for ${repeatWeeks} weeks)`
                : datesToCheck[0],
          },
          entityId: createdLecturesList[0].id,
          entityType: "lecture",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Notification Error:", err),
    );
    const lecturerQuery = await User.where("uid", "==", lecturerUid).limit(1).get();
    if (!lecturerQuery.empty) {
      const lecturerDocRef = lecturerQuery.docs[0].ref;
      const lecturerData = lecturerQuery.docs[0].data();
      const currentStats = lecturerData.monthlyStats || {};
      
      await lecturerDocRef.update({
        "monthlyStats.minutesActive": (currentStats.minutesActive || 0) + 15,
        "monthlyStats.aiQueries": (currentStats.aiQueries || 0) + 2,
        updatedAt: now,
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(201).json({
      message: "Lectures scheduled successfully",
      count: createdLecturesList.length,
      lecture: createdLecturesList[0],
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
    return res.status(500).json({ message: "Internal Server Error" });
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

    let assessmentData;
    let shouldNotify = false;
    const now = new Date();
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

    let assessmentId = id;
    let existingAssessment = null;

    if (id) {
      const assessmentQuery = await Assessment.where("id", "==", id).limit(1).get();
      if (!assessmentQuery.empty) {
        existingAssessment = {
          id: assessmentQuery.docs[0].id,
          ...assessmentQuery.docs[0].data(),
        };
      }
    }

    if (existingAssessment) {
      if (!existingAssessment.isPublished && isPublished) {
        shouldNotify = true;
      }

      assessmentData = {
        title,
        questions,
        duration,
        totalMarks,
        isPublished,
        status,
        scheduledStart,
        dueDate,
        endTime,
        updatedAt: now,
      };

      await Assessment.doc(assessmentId).update(assessmentData);
      assessmentData = { id: assessmentId, ...existingAssessment, ...assessmentData };
    } else {
      assessmentId = generateAssessmentId(
        course.courseId,
        assessmentType,
      );

      assessmentData = {
        id: assessmentId,
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
        createdAt: now,
        updatedAt: now,
      };

      await Assessment.doc(assessmentId).set(assessmentData);
      const existingTests = course.tests || [];
      if (!existingTests.includes(assessmentId)) {
        await courseDocRef.update({
          tests: [...existingTests, assessmentId],
          updatedAt: now,
        });
      }

      if (isPublished) shouldNotify = true;
    }

    if (
      shouldNotify &&
      course.studentsEnrolled &&
      course.studentsEnrolled.length > 0
    ) {
      const enrolledUids = course.studentsEnrolled;
      const studentChunks = [];
      for (let i = 0; i < enrolledUids.length; i += 10) {
        studentChunks.push(enrolledUids.slice(i, i + 10));
      }

      const enrolledStudentsList = [];
      for (const chunk of studentChunks) {
        const studentsQuery = await User
          .where("uid", "in", chunk)
          .where("usertype", "==", "student")
          .get();

        studentsQuery.forEach((doc) => {
          enrolledStudentsList.push(doc.data());
        });
      }

      const formattedDate = scheduledStart ? new Date(scheduledStart).toLocaleDateString() : "";
      const formattedTime = scheduledStart ? new Date(scheduledStart).toLocaleTimeString() : "";

      const notificationPromises = enrolledStudentsList.map((student) =>
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "TEST_CREATED",
          title: "New Assessment Posted",
          message: `A new test "${title}" has been posted for ${course.courseCode || course.title}.`,
          recipientEmail: student.email,
          sendEmail: !!student.email,
          payload: {
            userName: student.firstname,
            courseTitle: course.courseTitle || course.title,
            testTitle: title,
            dueDate,
            date: formattedDate,
            time: formattedTime,
            course,
          },
          entityId: assessmentId,
          entityType: "assessment",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        })
      );

      Promise.all(notificationPromises).catch((err) =>
        console.error("Assessment Notification Error:", err)
      );
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(existingAssessment ? 200 : 201).json({
      message: isPublished ? "Assessment Published" : "Draft Synced",
      data: assessmentData,
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
    return res.status(500).json({ message: error.message });
  }
};
export const deleteLecture = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteLectureController";
  const action = "deleteLecture";
  try {
    const { lectureId } = req.params;
    const currentUserId = req.user?.uid || req.user?.id;
    const lectureQuery = await Lectures.where("id", "==", lectureId).limit(1).get();
    if (lectureQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture not found",
      );
      return res.status(404).json({ message: "Lecture not found" });
    }

    const lectureDocRef = lectureQuery.docs[0].ref;
    const lecture = lectureQuery.docs[0].data();

    const { courseId, topicName, date, id, hostId } = lecture;
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Associated course not found",
      );
      return res.status(404).json({ message: "Associated course not found" });
    }

    const course = courseQuery.docs[0].data();

    const isCourseLecturer =
      course.lecturerIds && course.lecturerIds.includes(currentUserId);
    const isLectureHost = hostId === currentUserId;

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
    await lectureDocRef.delete();

    if (course.studentsEnrolled && course.studentsEnrolled.length > 0) {
      const enrolledUids = course.studentsEnrolled;
      const studentChunks = [];
      for (let i = 0; i < enrolledUids.length; i += 10) {
        studentChunks.push(enrolledUids.slice(i, i + 10));
      }

      const studentsList = [];
      for (const chunk of studentChunks) {
        const studentsQuery = await User
          .where("uid", "in", chunk)
          .where("usertype", "==", "student")
          .get();

        studentsQuery.forEach((doc) => {
          studentsList.push(doc.data());
        });
      }

      const notificationPromises = studentsList.map((student) =>
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "LECTURE_CANCELLED",
          title: "Lecture Cancelled",
          message: `The lecture "${topicName}" scheduled for ${date} has been cancelled.`,
          recipientEmail: student.email,
          sendEmail: !!student.email,
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
    const lectureQuery = await Lectures.where("id", "==", lectureId).limit(1).get();
    if (lectureQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture record not found.",
      );
      return res.status(404).json({ message: "Lecture record not found." });
    }

    const lectureDocRef = lectureQuery.docs[0].ref;
    const lecture = lectureQuery.docs[0].data();
    const courseQuery = await Course.where("courseId", "==", lecture.courseId).limit(1).get();
    const course = !courseQuery.empty ? courseQuery.docs[0].data() : null;

    const bucket = storage.bucket();
    const filePath = `attendance/${lecture.courseId}/Report-${lectureId}.pdf`;
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    let firebaseUrl = "";

    if (exists) {
      firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    } else {
      const attendanceQuery = await Attendance.where("lectureId", "==", lectureId).get();
      const studentUids = [];
      attendanceQuery.forEach((doc) => {
        const attData = doc.data();
        if (attData.studentId) {
          studentUids.push(attData.studentId);
        }
      });
      const presentStudents = [];
      if (studentUids.length > 0) {
        const studentChunks = [];
        for (let i = 0; i < studentUids.length; i += 10) {
          studentChunks.push(studentUids.slice(i, i + 10));
        }

        for (const chunk of studentChunks) {
          const usersQuery = await User.where("uid", "in", chunk).get();
          usersQuery.forEach((doc) => {
            const userData = doc.data();
            presentStudents.push({
              firstname: userData.firstname,
              lastname: userData.lastname,
              matricNumber: userData.matricNumber,
              department: userData.department,
              uid: userData.uid,
            });
          });
        }
      }

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
      await lectureDocRef.update({
        pdfUrl: firebaseUrl,
        updatedAt: new Date(),
      });
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
    return res.status(500).json({ message: "Internal server compilation error." });
  }
};
export const getCourseFinalAttendanceSummary = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getCourseFinalAttendanceSummaryController";
  const action = "getCourseFinalAttendanceSummary";
  try {
    const { courseId } = req.params;
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course context not found.",
      );
      return res.status(404).json({ message: "Course context not found." });
    }

    const course = courseQuery.docs[0].data();
    const lecturesQuery = await Lectures
      .where("courseId", "==", courseId)
      .where("status", "==", "completed")
      .get();

    let totalLecturesCount = 0;
    lecturesQuery.forEach((doc) => {
      const lec = doc.data();
      if (lec.lectureType !== "Recorded") {
        totalLecturesCount++;
      }
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

    const studentsEnrolled = course.studentsEnrolled || [];
    let studentsList = [];

    if (studentsEnrolled.length > 0) {
      const studentChunks = [];
      for (let i = 0; i < studentsEnrolled.length; i += 10) {
        studentChunks.push(studentsEnrolled.slice(i, i + 10));
      }

      for (const chunk of studentChunks) {
        const usersQuery = await Users.where("uid", "in", chunk).get();
        usersQuery.forEach((doc) => {
          studentsList.push(doc.data());
        });
      }
    }
    const attendanceQuery = await Attendance
      .where("courseId", "==", courseId)
      .where("status", "==", "Present")
      .get();

    const studentPresenceMap = {};
    attendanceQuery.forEach((doc) => {
      const att = doc.data();
      const studentId = att.studentId;
      if (studentId) {
        studentPresenceMap[studentId] = (studentPresenceMap[studentId] || 0) + 1;
      }
    });
    const attendanceSummary = studentsList.map((student) => {
      const uid = student.uid;
      const lecturesAttended = studentPresenceMap[uid] || 0;
      const attendancePercentage = Number(
        ((lecturesAttended / totalLecturesCount) * 100).toFixed(1)
      );

      return {
        uid: student.uid,
        firstname: student.firstname || "",
        lastname: student.lastname || "",
        matricNumber: student.matricNumber || "",
        department: student.department || "",
        lecturesAttended,
        totalLectures: totalLecturesCount,
        attendancePercentage,
      };
    });
    attendanceSummary.sort((a, b) => {
      if (a.matricNumber < b.matricNumber) return -1;
      if (a.matricNumber > b.matricNumber) return 1;
      return 0;
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      courseCode: course.courseCode,
      courseTitle: course.courseTitle || course.title,
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
    return res
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
    const lecturesQuery = await Lectures
      .where("courseId", "==", courseId)
      .where("status", "==", "completed")
      .get();

    let lectureHistory = [];
    lecturesQuery.forEach((doc) => {
      const data = doc.data();
      lectureHistory.push({
        id: data.id || doc.id,
        topicName: data.topicName,
        date: data.date,
        startTime: data.startTime,
        pdfUrl: data.pdfUrl,
        getAttendanceMode: data.getAttendanceMode,
      });
    });
    lectureHistory.sort((a, b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      return 0;
    });

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
    return res.status(500).json({ message: "Internal server registry lookup error." });
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
    const currentUserId = req.user?.uid || req.user?.id;

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
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course context not found.",
      );
      return res.status(404).json({ message: "Course context not found." });
    }

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

    const isAuthorized =
      course.lecturerIds && course.lecturerIds.includes(currentUserId);
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

    const existingResources = course.resources || [];
    const updatedResources = [...existingResources, materialUrl];
    const now = new Date();

    await courseDocRef.update({
      resources: updatedResources,
      updatedAt: now,
    });

    const fileName = title || materialUrl.split("/").pop() || "New Resource";
    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", course.department)
      .where("level", "==", course.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "MATERIAL_UPLOADED",
          title: "New Study Material",
          message: `A new resource file has been uploaded for ${course.courseTitle || course.title}.`,
          recipientEmail: student.email,
          sendEmail: !!student.email,
          payload: { 
            userName: student.firstname,
            courseTitle: course.courseTitle || course.title,
            course, 
            fileName,
            materialUrl,
          },
          entityId: courseId,
          entityType: "course",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Notification dispatch routine failed: ", err)
    );
    const lecturerQuery = await User.where("uid", "==", currentUserId).limit(1).get();
    if (!lecturerQuery.empty) {
      const lecturerDocRef = lecturerQuery.docs[0].ref;
      const lecturerData = lecturerQuery.docs[0].data();
      const currentStats = lecturerData.monthlyStats || {};

      await lecturerDocRef.update({
        "monthlyStats.libraryUsageSessions": (currentStats.libraryUsageSessions || 0) + 1,
        "monthlyStats.minutesActive": (currentStats.minutesActive || 0) + 10,
        updatedAt: now,
      });
    }

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
    const currentUserId = req.user?.uid || req.user?.id;

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
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
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

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

    const isAuthorized =
      course.lecturerIds && course.lecturerIds.includes(currentUserId);
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
        storageError.message || storageError,
      );
    }

    const existingResources = course.resources || [];
    const updatedResources = existingResources.filter((resUrl) => resUrl !== materialUrl);
    const now = new Date();

    await courseDocRef.update({
      resources: updatedResources,
      updatedAt: now,
    });

    const updatedCourse = {
      ...course,
      resources: updatedResources,
    };

    const fileName = materialUrl.split("/").pop() || "Resource Document";
    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", updatedCourse.department)
      .where("level", "==", updatedCourse.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "MATERIAL_DELETED",
          title: "Study Material Removed",
          message: `A resource file has been removed from ${updatedCourse.courseTitle || updatedCourse.title}.`,
          recipientEmail: student.email,
          sendEmail: !!student.email,
          payload: { 
            userName: student.firstname,
            courseTitle: updatedCourse.courseTitle || updatedCourse.title,
            course: updatedCourse, 
            fileName, 
          },
          entityId: courseId,
          entityType: "course",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
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
    const requesterUid = req.user?.uid || req.user?.id;

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
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

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

    const existingContents = course.courseContents || [];
    const updatedContents = [...existingContents, topic];
    const now = new Date();

    await courseDocRef.update({
      courseContents: updatedContents,
      updatedAt: now,
    });
    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", course.department)
      .where("level", "==", course.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "CONTENT_ADDED",
          title: "New Topic Added",
          message: `A new topic "${topic}" was added to ${course.courseCode}.`,
          recipientEmail: student.email,
          sendEmail: !!student.email,
          payload: {
            userName: student.firstname,
            courseId: course.courseId,
            topic,
            courseTitle: course.courseTitle || course.title,
          },
          sendPush: false,
          sendSocket: true,
          saveToDb: true,
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Notification Fetch Error:", err)
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Topic added successfully",
      updatedContents: updatedContents,
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
    const requesterUid = req.user?.uid || req.user?.id;

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
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

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

    const courseContents = course.courseContents || [];
    if (index < 0 || index >= courseContents.length) {
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

    const updatedContents = [...courseContents];
    updatedContents[index] = updatedTopic;
    const now = new Date();

    await courseDocRef.update({
      courseContents: updatedContents,
      updatedAt: now,
    });

    const updatedCourse = {
      ...course,
      courseContents: updatedContents,
    };
    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", updatedCourse.department)
      .where("level", "==", updatedCourse.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "CONTENT_MUTATED",
          title: "Course Syllabus Updated",
          message: `A topic in ${updatedCourse.courseCode} has been edited to "${updatedTopic}".`,
          recipientEmail: student.email,
          sendEmail: false,
          sendPush: false,
          sendSocket: true,
          saveToDb: true,
          payload: {
            userName: student.firstname,
            course: updatedCourse,
            updatedTopic,
            courseTitle: updatedCourse.courseTitle || updatedCourse.title,
          },
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Notification Error:", err)
    );

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
    const requesterUid = req.user?.uid || req.user?.id;

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
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

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

    const courseContents = course.courseContents || [];
    if (index < 0 || index >= courseContents.length) {
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

    const updatedContents = [...courseContents];
    const removedTopic = updatedContents.splice(index, 1)[0];
    const now = new Date();

    await courseDocRef.update({
      courseContents: updatedContents,
      updatedAt: now,
    });

    const updatedCourse = {
      ...course,
      courseContents: updatedContents,
    };
    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", updatedCourse.department)
      .where("level", "==", updatedCourse.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "CONTENT_DELETION",
          title: "Syllabus Content Removed",
          message: `"${removedTopic}" was removed from the course plan of ${updatedCourse.courseCode}.`,
          recipientEmail: student.email,
          sendEmail: false,
          sendPush: false,
          sendSocket: true,
          saveToDb: true,
          payload: {
            userName: student.firstname,
            courseId: updatedCourse.courseId,
            removedTopic,
            course: updatedCourse,
            courseTitle: updatedCourse.courseTitle || updatedCourse.title,
          },
        })
      );
    });

    Promise.all(notificationPromises).catch((err) => console.error("Notification Error:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: "Topic removed successfully",
      updatedContents: updatedCourse.courseContents,
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
    const requesterUid = req.user?.uid || req.user?.id;
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

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

    const existingAssignments = course.assignments || [];
    const updatedAssignments = [...existingAssignments, newAssignment];
    const now = new Date();

    await courseDocRef.update({
      assignments: updatedAssignments,
      updatedAt: now,
    });

    const formattedDate = new Date(dueDate).toLocaleDateString();

    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", course.department)
      .where("level", "==", course.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "ASSIGNMENT_CREATED",
          title: "New Assignment",
          message: `New assignment uploaded for ${course.courseTitle || course.title}: "${title}". Due: ${formattedDate}`,
          recipientEmail: student.email,
          sendEmail: !!student.email,
          payload: {
            userName: student.firstname,
            course: { ...course, assignments: updatedAssignments },
            assignmentId,
            assignmentTitle: title,
            dueDate: formattedDate,
          },
          entityId: assignmentId,
          entityType: "assignment",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Assignment Notification Dispatch Failure:", err)
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(201).json(updatedAssignments);
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
    const requesterUid = req.user?.uid || req.user?.id;
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseDocRef = courseQuery.docs[0].ref;
    const course = courseQuery.docs[0].data();

    const assignments = course.assignments || [];
    const targetAssignment = assignments.find(
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

    const updatedAssignments = assignments.filter(
      (asg) => asg.assignmentId !== assignmentId,
    );
    const now = new Date();

    await courseDocRef.update({
      assignments: updatedAssignments,
      updatedAt: now,
    });

    const updatedCourse = {
      ...course,
      assignments: updatedAssignments,
    };
    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", updatedCourse.department)
      .where("level", "==", updatedCourse.level)
      .get();

    const notificationPromises = [];
    studentsQuery.forEach((doc) => {
      const student = doc.data();
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "ASSIGNMENT_REMOVED",
          title: "Assignment Cancelled",
          message: `The assignment "${targetAssignment.title}" has been removed by the instructor.`,
          recipientEmail: student.email,
          sendEmail: false,
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
          payload: {
            userName: student.firstname,
            course: updatedCourse,
            assignmentId,
            title: targetAssignment.title,
            courseTitle: updatedCourse.courseTitle || updatedCourse.title,
          },
          entityId: assignmentId,
          entityType: "assignment",
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Wipe notification thread failed:", err)
    );

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
    const testQuery = await Assessment.where("id", "==", testId).limit(1).get();
    if (testQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Assessment not found",
      );
      return res.status(404).json({ error: "Assessment not found" });
    }

    const test = testQuery.docs[0].data();

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
    const courseQuery = await Course.where("courseId", "==", test.courseId).limit(1).get();
    const course = courseQuery.empty ? null : courseQuery.docs[0].data();
    const submissionsSnapshot = await TestSubmission.where("testId", "==", testId).get();
    const submissions = [];
    submissionsSnapshot.forEach((doc) => {
      submissions.push(doc.data());
    });
    const enrolledStudentsQuery = await User.where("enrolledCourses", "array-contains", test.courseId).get();
    const enrolledStudents = [];
    enrolledStudentsQuery.forEach((doc) => {
      enrolledStudents.push(doc.data());
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

  try {
    const { testId, answers, proctoringData, score } = req.body;
    const currentUserId = req.user?.uid || req.user?.id;

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

    const result = await db.runTransaction(async (transaction) => {
      const existingSubmissionQuery = await transaction.get(
        TestSubmission.where("testId", "==", testId)
          .where("studentId", "==", currentUserId)
          .limit(1)
      );

      if (!existingSubmissionQuery.empty) {
        return { error: "already_submitted" };
      }
      const userQuery = await transaction.get(
        User.where("uid", "==", currentUserId).limit(1)
      );
      const studentUser = userQuery.empty ? null : userQuery.docs[0].data();
      const userDocRef = userQuery.empty ? null : userQuery.docs[0].ref;
      const testQuery = await transaction.get(
        Assessment.where("id", "==", testId).limit(1)
      );
      const test = testQuery.empty ? null : testQuery.docs[0].data();

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

      const matricNumber = studentUser?.matricNumber || "N/A";
      const customSubmissionId = generateSubmissionId(testId, matricNumber);

      const newSubmissionData = {
        id: customSubmissionId,
        verificationStatus,
        ...req.body,
        studentId: currentUserId,
        isFlagged: isFlagged,
        score: isImpersonator ? 0 : score || 0,
        proctoringData: {
          deviceId: proctoringData?.deviceId || "Unknown",
          entrySelfieUrl: rawSelfieStatus,
          tabSwitchCount: proctoringData?.tabSwitchCount || 0,
        },
        createdAt: new Date(),
      };

      const newSubRef = TestSubmission.doc();
      transaction.set(newSubRef, newSubmissionData);

      if (!isImpersonator && userDocRef && studentUser) {
        const completedTests = studentUser.completedTests || [];
        const updatedCompletedTests = completedTests.includes(testId)
          ? completedTests
          : [...completedTests, testId];
        const currentProgress = studentUser.overallProgress || 0;
        const updatedProgress = currentProgress + 5;

        transaction.update(userDocRef, {
          completedTests: updatedCompletedTests,
          overallProgress: updatedProgress,
          updatedAt: new Date(),
        });
      }

      return {
        success: true,
        isImpersonator,
        isFlagged,
        customSubmissionId,
        test,
      };
    });

    if (result.error === "already_submitted") {
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

    const { isImpersonator, isFlagged, customSubmissionId, test } = result;

    await createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: currentUserId,
      recipientEmail: req.user?.email,
      sendEmail: !!req.user?.email,
      category: "academic",
      actionType: isImpersonator ? "TEST_FRAUD_BLOCKED" : "TEST_SUBMITTED",
      title: isImpersonator ? "Submission Flagged!" : "Assessment Submitted!",
      message: isImpersonator
        ? `Your submission for "${test?.title || "the assessment"}" failed biometric verification. System security response logs have been populated.`
        : `Your submission for "${test?.title || "the assessment"}" has been received successfully.`,
      payload: {
        userName: req.user?.firstname,
        testId,
        submissionId: customSubmissionId,
        isFlagged,
        actionEnforced: isImpersonator ? "SCORE_NULLIFIED" : "RECORDED",
        title: test?.title,
      },
      entityId: testId,
      entityType: "assessment",
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
    const requesterUid = req.user?.uid || req.user?.id;
    const lectureQuery = await Lectures.where("id", "==", lectureId).limit(1).get();
    if (lectureQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture not found",
      );
      return res.status(404).json({ message: "Lecture not found" });
    }

    const lectureDocRef = lectureQuery.docs[0].ref;
    const originalLecture = lectureQuery.docs[0].data();
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Associated course not found",
      );
      return res.status(404).json({ message: "Associated course not found" });
    }

    const course = courseQuery.docs[0].data();

    const lecturerIds = course.lecturerIds || [];
    const isCourseLecturer = lecturerIds.includes(requesterUid);
    const isLectureHost = originalLecture.hostId === requesterUid;

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

    const resolvedLectureType = lectureType || originalLecture.lectureType;
    const updatePayload = {
      topicName: topicName || originalLecture.topicName,
      lectureType: resolvedLectureType,
      location: resolvedLectureType === "Physical" ? location : null, // Wipe venue data if shifted online
      date: newDate || originalLecture.date,
      startTime: newStartTime || originalLecture.startTime,
      status: updatedStatus,
      updatedAt: new Date(),
    };

    await lectureDocRef.update(updatePayload);

    const updatedLecture = {
      ...originalLecture,
      ...updatePayload,
    };
    const studentsQuery = await User
      .where("usertype", "==", "student")
      .where("department", "==", course.department)
      .where("level", "==", course.level)
      .get();

    const changeListString = changes.join(", ");
    const notificationPromises = [];

    studentsQuery.forEach((doc) => {
      const student = doc.data();
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

      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          recipientEmail: student.email,
          sendEmail: !!student.email,
          category: "classroom",
          actionType: primaryActionType,
          title: `Lecture Update: ${course.courseId || course.courseCode}`,
          message: updateDetailsMessage,
          payload: {
            userName: student.firstname || student.firstName,
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
          entityType: "lecture",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        })
      );
    });

    Promise.all(notificationPromises).catch((err) =>
      console.error("Notify Error:", err),
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
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
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
export const submitOnlineClassAttendance = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "submitOnlineClassAttendanceController";
  const action = "submitOnlineClassAttendance";
  try {
    const { lectureId, courseId, status } = req.body;
    const studentId = req.user?.uid || req.user?.id;

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
    const lectureQuery = await Lectures.where("id", "==", lectureId).limit(1).get();
    if (lectureQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Lecture not found.",
      );
      return res.status(404).json({ error: "Lecture not found." });
    }

    const lecture = lectureQuery.docs[0].data();

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
    await db.runTransaction(async (transaction) => {
      const attendanceQuery = await transaction.get(
        Attendance.where("studentId", "==", studentId)
          .where("lectureId", "==", lectureId)
          .limit(1)
      );

      const existingRecord = attendanceQuery.empty ? null : attendanceQuery.docs[0].data();
      const attendanceDocRef = attendanceQuery.empty
        ? Attendance.doc()
        : attendanceQuery.docs[0].ref;

      const attendanceData = {
        studentId,
        lectureId,
        courseId,
        status,
        checkData: [],
        timestamp: currentTime,
        updatedAt: currentTime,
      };

      if (attendanceQuery.empty) {
        attendanceData.createdAt = currentTime;
      }

      transaction.set(attendanceDocRef, attendanceData, { merge: true });

      const wasNotPresentBefore = !existingRecord || existingRecord.status !== "Present";
      if (status === "Present" && wasNotPresentBefore) {
        const courseQuery = await transaction.get(
          Course.where("courseId", "==", courseId).limit(1)
        );
        if (!courseQuery.empty) {
          const courseDocRef = courseQuery.docs[0].ref;
          const courseData = courseQuery.docs[0].data();
          const studentsArray = courseData.students || [];

          let studentFoundInCourse = false;
          const updatedStudents = studentsArray.map((student) => {
            if (student.id === studentId || student.uid === studentId) {
              studentFoundInCourse = true;
              return {
                ...student,
                classesAttended: (student.classesAttended || 0) + 1,
              };
            }
            return student;
          });

          if (studentFoundInCourse) {
            transaction.update(courseDocRef, {
              students: updatedStudents,
              updatedAt: currentTime,
            });
          }
        }
        const userQuery = await transaction.get(
          User.where("uid", "==", studentId).limit(1)
        );
        if (!userQuery.empty) {
          const userDocRef = userQuery.docs[0].ref;
          const userData = userQuery.docs[0].data();
          const monthlyStats = userData.monthlyStats || {};
          const currentSessions = monthlyStats.libraryUsageSessions || 0;

          transaction.update(userDocRef, {
            "monthlyStats.libraryUsageSessions": currentSessions + 1,
            updatedAt: currentTime,
          });
        }
      }
    });

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
    return res
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

    const requesterUid = req.user?.uid || req.user?.id;

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
    const userMatric = req.user?.matricNumber
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

    const now = new Date();
    const processedCourseIds = [];
    for (const courseData of courses) {
      const cleanTitle = courseData.courseTitle.trim();
      
      const courseQuery = await Courses
        .where("courseTitle", ">=", cleanTitle)
        .where("courseTitle", "<=", cleanTitle + "\uf8ff")
        .limit(1)
        .get();

      let courseDocRef;
      let courseId;

      if (!courseQuery.empty) {
        const doc = courseQuery.docs[0];
        courseDocRef = doc.ref;
        const existingData = doc.data();
        courseId = existingData.courseId;

        const studentsEnrolled = existingData.studentsEnrolled || [];
        if (!studentsEnrolled.includes(requesterUid)) {
          await courseDocRef.update({
            studentsEnrolled: [...studentsEnrolled, requesterUid],
            updatedAt: now,
          });
        }
      } else {
        courseId = generateCourseId(courseData.courseTitle, courseData.courseCode);
        courseDocRef = Course.doc();
        
        const newCourseData = {
          ...courseData,
          courseId,
          schoolName: req.user?.schoolName || studentInfo.schoolName,
          department: studentInfo.department || req.user?.department,
          level: studentInfo.level,
          studentsEnrolled: [requesterUid],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        await courseDocRef.set(newCourseData);
      }
      processedCourseIds.push(courseId);
    }
    const userQuery = await User.where("uid", "==", requesterUid).limit(1).get();
    if (!userQuery.empty) {
      const userDocRef = userQuery.docs[0].ref;
      const userData = userQuery.docs[0].data();
      const existingEnrolled = userData.enrolledCourses || userData.coursesEnrolled || [];
      const updatedEnrolled = Array.from(new Set([...existingEnrolled, ...processedCourseIds]));

      await userDocRef.update({
        enrolledCourses: updatedEnrolled,
        updatedAt: now,
      });
    }

    const firstCourse = courses[0] || {};
    await createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: requesterUid,
      recipientEmail: req.user?.email,
      sendEmail: !!req.user?.email,
      category: "academic",
      actionType: "COURSES_EXTRACTED",
      title: "Course Registration Synced",
      message: `Successfully extracted ${courses.length} courses for the ${studentInfo.level}L curriculum.`,
      payload: {
        userName: req.user?.firstname || studentInfo.studentName,
        courseCount: courses.length,
        level: studentInfo.level,
        matricNo: studentInfo.matricNo,
        semester: firstCourse.semester ? firstCourse.semester.toLowerCase() : "unknown",
        session: firstCourse.session || "",
      },
      entityId: requesterUid,
      entityType: "user",
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    }).catch((err) => console.error("Notification Dispatch Error:", err));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
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
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
export const uploadCourseDetailsManually = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "uploadCourseDetailsManuallyController";
  const action = "uploadCourseDetailsManually";
  try {
    const { courseTitle, courseCode, credits } = req.body;
    const uid = req.user?.uid || req.user?.id;
    const usertype = req.user?.usertype;
    const schoolName = req.user?.schoolName;
    const department = req.user?.department;

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

    const trimmedCode = courseCode.trim();
    const trimmedTitle = courseTitle.trim();
    const now = new Date();
    let courseDocRef = null;
    let courseData = null;
    let assignedCourseId = null;

    const codeQuery = await Course
      .where("schoolName", "==", schoolName)
      .where("courseCode", "==", trimmedCode)
      .limit(1)
      .get();

    if (!codeQuery.empty) {
      courseDocRef = codeQuery.docs[0].ref;
      courseData = codeQuery.docs[0].data();
      assignedCourseId = courseData.courseId;
    } else {
      const titleQuery = await Course
        .where("schoolName", "==", schoolName)
        .where("courseTitle", "==", trimmedTitle)
        .limit(1)
        .get();

      if (!titleQuery.empty) {
        courseDocRef = titleQuery.docs[0].ref;
        courseData = titleQuery.docs[0].data();
        assignedCourseId = courseData.courseId;
      }
    }

    if (courseDocRef && courseData) {
      assignedCourseId = courseData.courseId;
      if (usertype === "lecturer") {
        const lecturerIds = courseData.lecturerIds || [];
        if (!lecturerIds.includes(uid)) {
          await courseDocRef.update({
            lecturerIds: [...lecturerIds, uid],
            updatedAt: now,
          });
        }
      } else {
        const studentsEnrolled = courseData.studentsEnrolled || [];
        if (!studentsEnrolled.includes(uid)) {
          await courseDocRef.update({
            studentsEnrolled: [...studentsEnrolled, uid],
            updatedAt: now,
          });
        }
      }
    } else {
      assignedCourseId = generateCourseId(trimmedTitle, trimmedCode);
      courseDocRef = Course.doc();

      const newCourseData = {
        courseId: assignedCourseId,
        courseCode: trimmedCode,
        courseTitle: trimmedTitle,
        credits: parseInt(credits, 10) || 0,
        schoolName: schoolName,
        department: department || "General",
        isActive: true,
        lecturerIds: usertype === "lecturer" ? [uid] : [],
        studentsEnrolled: usertype !== "lecturer" ? [uid] : [],
        createdAt: now,
        updatedAt: now,
      };

      await courseDocRef.set(newCourseData);
    }
    const userQuery = await User.where("uid", "==", uid).limit(1).get();
    if (!userQuery.empty) {
      const userDocRef = userQuery.docs[0].ref;
      const userData = userQuery.docs[0].data();
      const userFieldToUpdate =
        usertype === "lecturer" ? "coursesTaught" : "coursesEnrolled";

      const existingArray = userData[userFieldToUpdate] || [];
      if (!existingArray.includes(assignedCourseId)) {
        await userDocRef.update({
          [userFieldToUpdate]: [...existingArray, assignedCourseId],
          updatedAt: now,
        });
      }
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      message: courseDocRef && courseData
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

    const lectureQuery = await Lectures.where("date", "==", targetDateStr)
      .where("startTime", "==", targetHourMin)
      .where("status", "==", "scheduled")
      .get();

    if (lectureQuery.empty) {
      console.log(
        `[CRON_ENGINE] Verification cycle completed. 0 matching upcoming lectures identified.`,
      );
      return;
    }

    for (const lectureDoc of lectureQuery.docs) {
      const lecture = lectureDoc.data();
      const courseId = lecture.courseId;
      const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
      if (courseQuery.empty) {
        console.log(
          `[CRON_ENGINE] Skipping session ${lecture.id || lectureDoc.id}: Course context not found for courseId ${courseId}.`,
        );
        continue;
      }

      const courseData = courseQuery.docs[0].data();
      const studentUids = courseData.studentsEnrolled || [];

      if (studentUids.length === 0) {
        console.log(
          `[CRON_ENGINE] Skipping session ${lecture.id || lectureDoc.id}: No student enrollments detected.`,
        );
        continue;
      }
      const batchSize = 30;
      const enrolledStudents = [];

      for (let i = 0; i < studentUids.length; i += batchSize) {
        const batchIds = studentUids.slice(i, i + batchSize);
        const userQuery = await User.where("uid", "in", batchIds).get();

        userQuery.forEach((doc) => {
          const userData = doc.data();
          enrolledStudents.push({
            uid: userData.uid,
            firstname: userData.firstname,
          });
        });
      }

      const notificationPromises = enrolledStudents.map(async (student) => {
        try {
          return await createNotification({
            notificationId: generateNotificationId("classroom"),
            recipientId: student.uid,
            recipientEmail: student.email,
            sendEmail: !!student.email,
            category: "classroom",
            actionType: "LECTURE_REMINDER",
            title: `Class Starting Soon: ${courseData.courseCode}`,
            message: `Your ${lecture.lectureType || "live"} lecture on "${lecture.topicName}" starts in 45 minutes at ${lecture.location || "Online"}.`,
            payload: {
              courseId: lecture.courseId,
              lectureId: lecture.id || lectureDoc.id,
              topicName: lecture.topicName,
              startTime: lecture.startTime,
              location: lecture.location,
              userName: student.firstname || "Student",
            },
            entityId: student.uid,
            entityType: "user",
            sendPush: true,
            sendSocket: true,
            saveToDb: true,
          });
        } catch (err) {
          console.error(
            `[CRON_NOTIFICATION_ERR] Failed for recipient ${student.uid}:`,
            err.message,
          );
          return null;
        }
      });

      await Promise.all(notificationPromises);

      logControllerPerformance(controllerName, action, startTime, "success");
      console.log(
        `[CRON_SUCCESS] Dispatched reminders for ${courseData.courseCode} - "${lecture.topicName}" to ${enrolledStudents.length} students.`,
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
    const snapshot = await UserDownloads
      .where("lastAccessed", "<", threeDaysAgo)
      .get();

    if (snapshot.empty) {
      return;
    }

    const inactiveUsers = [];
    snapshot.forEach((doc) => {
      inactiveUsers.push({ id: doc.id, ...doc.data() });
    });

    const notificationPromises = inactiveUsers.map(async (record) => {
      const ownedProducts = record.ownedProducts || [];
      const activeCourse = [...ownedProducts]
        .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
        .find((p) => (p.progress || 0) < 100);

      if (!activeCourse) return null;

      try {
        return await createNotification({
          notificationId: generateNotificationId("reminder"),
          recipientId: record.userId,
          recipientEmail: record.email,
          sendEmail: !!record.email,
          category: "academic",
          actionType: "LEARNING_REMINDER",
          title: "Don't break your streak",
          message: `It's been a few days since you accessed your course. Your progress is waiting for you!`,
          sendEmail: false,
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
          payload: {
            userName: record.userName || record.firstname,
            productId: activeCourse.productId,
            currentProgress: activeCourse.progress,
          },
          entityId: activeCourse.productId,
          entityType: "product",
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
    const courseQuery = await Course.where("courseId", "==", courseId).limit(1).get();
    if (courseQuery.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Course not found",
      );
      return res.status(404).json({ message: "Course not found" });
    }

    const courseData = courseQuery.docs[0].data();
    const studentsEnrolled = courseData.studentsEnrolled || [];
    const tests = courseData.tests || [];
    const testIds = tests.map((t) => t.id).filter(Boolean);

    if (studentsEnrolled.length === 0) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({ success: true, data: [] });
    }
    const batchSize = 30;
    const studentsMap = new Map();

    for (let i = 0; i < studentsEnrolled.length; i += batchSize) {
      const batchIds = studentsEnrolled.slice(i, i + batchSize);
      const usersQuery = await User.where("uid", "in", batchIds).get();
      usersQuery.forEach((doc) => {
        const uData = doc.data();
        studentsMap.set(uData.uid, uData);
      });
    }
    const attendanceSnapshot = await Attendance.where("courseId", "==", courseId).get();
    const attendanceByStudent = new Map();
    attendanceSnapshot.forEach((doc) => {
      const att = doc.data();
      const sId = att.studentId;
      if (!attendanceByStudent.has(sId)) {
        attendanceByStudent.set(sId, []);
      }
      attendanceByStudent.get(sId).push(att);
    });
    const testSubmissionsByStudent = new Map();
    if (testIds.length > 0) {
      for (let i = 0; i < testIds.length; i += batchSize) {
        const batchTestIds = testIds.slice(i, i + batchSize);
        const subSnapshot = await TestSubmission.where("testId", "in", batchTestIds).get();
        subSnapshot.forEach((doc) => {
          const sub = doc.data();
          const sId = sub.studentId;
          if (!testSubmissionsByStudent.has(sId)) {
            testSubmissionsByStudent.set(sId, []);
          }
          testSubmissionsByStudent.get(sId).push(sub);
        });
      }
    }
    const exceptionsSnapshot = await Exceptions.where("courseId", "==", courseId).get();
    const exceptionsByStudent = new Map();
    exceptionsSnapshot.forEach((doc) => {
      const ex = doc.data();
      const sId = ex.studentId;
      if (!exceptionsByStudent.has(sId)) {
        exceptionsByStudent.set(sId, []);
      }
      exceptionsByStudent.get(sId).push(ex);
    });
    const gradebookData = [];

    for (const studentId of studentsEnrolled) {
      const student = studentsMap.get(studentId) || {
        uid: studentId,
        firstname: "",
        lastname: "",
        matricNumber: "N/A",
      };

      const studentName =
        student.firstname && student.lastname
          ? `${student.firstname} ${student.lastname}`
          : student.name || "Unknown Student";
      const matricNumber = student.matricNumber || "N/A";

      const attendanceRecords = attendanceByStudent.get(studentId) || [];
      const testSubmissions = testSubmissionsByStudent.get(studentId) || [];
      const exceptions = exceptionsByStudent.get(studentId) || [];

      const presentAttendanceCount = attendanceRecords.filter(
        (rec) => rec.status === "Present"
      ).length;

      const approvedExceptionsCount = exceptions.filter(
        (ex) => ex.status === "approved"
      ).length;

      const attendanceSum = presentAttendanceCount + approvedExceptionsCount;
      const testScores = testSubmissions.map((sub) => sub.score || 0);
      const testSum = testScores.reduce((acc, curr) => acc + curr, 0);

      const allActivities = [
        ...attendanceRecords,
        ...testSubmissions,
        ...exceptions,
      ];

      gradebookData.push({
        _id: student.uid || studentId,
        studentName,
        matricNumber,
        attendanceCount: attendanceRecords.length,
        attendanceSum,
        testScores,
        testSum,
        exceptions,
        allActivities,
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({ success: true, data: gradebookData });
  } catch (error) {
    console.error("Gradebook Engine Error:", error.message);
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