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
} from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import { generateCertificatePDF } from "../templates/downloadsCertificateTemplate.js";
import {
  generateNotificationId,
  generateExceptionId,
  generateTransactionId,
  generateLectureId,
  generateAssessmentId,
} from "../utils/idGenerator.js";
import {
  EXCEPTION_COST_IN_ICASH,
  EXCEPTION_ACCOUNT_LIMITS,
  EXCEPTION_LECTURER_DIVIDEND_IN_ICASH,
} from "../constants/inAppConstants.js";
import { generateAttendancePDF } from "../templates/courseAttendanceTemplate.js";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const handleGenerateCertificate = async (req, res) => {
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
    res.status(200).json({
      success: true,
      pdfUrl: firebaseUrl,
      certificateId: certId,
      composition,
    });
  } catch (error) {
    console.error("Cert Flow Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
export const submitLectureException = async (req, res) => {
  try {
    const {
      courseId,
      lectureId,
      reason,
      reasonCategory,
      studentInfo,
      courseInfo,
    } = req.body;
    const studentId = req.user.id;
    const user = await User.findOne({ uid: studentId });
    if (!user) return res.status(404).json({ message: "User not found" });
    if ((user.pointsBalance || 0) < EXCEPTION_COST_IN_ICASH) {
      return res.status(402).json({
        message: `Insufficient iCash balance. Required: ${EXCEPTION_COST_IN_ICASH} iCash`,
      });
    }
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const monthlyCount = await Exceptions.countDocuments({
      studentId,
      createdAt: { $gte: startOfMonth },
    });
    const userLimit = EXCEPTION_ACCOUNT_LIMITS[user.tier];

    if (monthlyCount >= userLimit) {
      return res.status(403).json({
        message: `Monthly limit reached (${userLimit}) for your ${user.tier || "free"} plan.`,
      });
    }
    user.pointsBalance -= EXCEPTION_COST_IN_ICASH;
    const senderTransactionId = generateTransactionId("payment");
    await Transactions.create({
      transactionId: senderTransactionId,
      userId: user.uid,
      type: "payment",
      amountICash: EXCEPTION_COST_IN_ICASH,
      status: "success",
      payType: "out",
      title: "Lectures Exception Purchase",
      reference: `EXC-REF-${senderTransactionId}`,
    });

    const exception = new Exceptions({
      id: generateExceptionId(courseId, lectureId),
      studentId,
      studentInfo,
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

    createNotification({
      notificationId: generateNotificationId("classroom"),
      recipientId: user.uid,
      category: "finance",
      actionType: "EXCEPTION_SUBMITTED",
      title: "Exception Submitted",
      message: `Your exception for ${courseInfo.courseCode} was received. 0.5 iCash has been deducted.`,
      payload: {
        exceptionId: exception.id,
        newBalance: user.pointsBalance,
        courseCode: courseInfo.courseCode,
      },
      sendEmail: false,
      sendPush: true,
      sendSocket: true,
      saveToDb: true,
    });
    res.status(201).json({
      success: true,
      message: "Exception submitted successfully",
      newBalance: user.pointsBalance,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
export const checkTestStatus = async (req, res) => {
  try {
    const { assessmentId } = req.params;
    const studentId = req.user.uid;
    const test = await Assessment.findOne({
      $or: [{ id: assessmentId }],
    });
    if (!test) {
      return res.status(404).json({ message: "Assessment not found" });
    }
    const submission = await TestSubmission.findOne({
      testId: assessmentId,
      studentId: studentId,
    });
    res.status(200).json({
      hasSubmitted: !!submission,
      test: test,
    });
  } catch (error) {
    console.error("Error checking test status:", error);
    res
      .status(500)
      .json({ message: "Server error checking assessment status" });
  }
};
export const manageExceptions = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, lecturerComment } = req.body;
    const exception = await Exceptions.findOne({ id: id });
    if (!exception) {
      return res.status(404).json({ message: "Exception not found" });
    }
    if (exception.status !== "pending") {
      return res
        .status(400)
        .json({ message: "This exception has already been processed" });
    }
    let lecturer = null;

    if (status === "approved") {
      lecturer = await User.findOne({ uid: req.user.uid });
      if (lecturer) {
        lecturer.pointsBalance =
          (lecturer.pointsBalance || 0) + EXCEPTION_LECTURER_DIVIDEND_IN_ICASH;
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

    exception.status = status;
    exception.lecturerComment = lecturerComment || "";
    await exception.save();

    const student = await User.findOne({ uid: exception.studentId });
    if (student) {
      createNotification({
        notificationId: generateNotificationId("classroom"),
        recipientId: student.uid,
        category: "classroom",
        actionType: "EXCEPTION_UPDATED",
        title: `Exception ${status === "approved" ? "Approved" : "Rejected"}`,
        message: `Your request for ${exception.courseInfo?.courseCode || "your course"} has been ${status}.`,
        payload: {
          exceptionId: id,
          status,
          courseCode: exception.courseInfo?.courseCode,
        },
        sendPush: true,
        sendSocket: true,
        saveToDb: true,
      });
    }
    res.status(200).json({
      success: true,
      message: `Exception ${status} successfully.`,
      newIcashBalance: lecturer ? lecturer.pointsBalance : undefined,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
export const createLectureSchedule = async (req, res) => {
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

    const courseDetails = await Course.findOne({ courseId });
    if (!courseDetails) {
      return res.status(404).json({ message: "Course not found" });
    }
    for (let i = 0; i < (repeatWeeks || 1); i++) {
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + i * 7);
      datesToCheck.push(nextDate.toISOString().split("T")[0]);
    }

    const conflict = await Lectures.findOne({
      date: { $in: datesToCheck },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
      $or: [
        {
          lectureType: "Physical",
          location: location,
        },
        {
          courseId: courseId,
        },
        {
          department: courseDetails.department,
          level: courseDetails.level,
        },
      ],
    });

    if (conflict) {
      return res.status(409).json({
        message: `Conflict detected on ${conflict.date}! A lecture (${conflict.topicName || "Class"}) conflicts with this time slot (${conflict.startTime} - ${conflict.endTime}).`,
      });
    }
    datesToCheck.forEach((d) => {
      lecturesToCreate.push({
        ...finalPayload,
        id: generateLectureId(courseId, lectureType),
        date: d,
        department: courseDetails.department,
        level: courseDetails.level,
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
          lectureId: result[0].id, // Uses the generated custom id string
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

    // Fire and forget notifications
    Promise.all(notificationPromises).catch((err) =>
      console.error("Notification Error:", err),
    );
    await User.updateOne(
      { uid: req.user.uid },
      {
        $inc: {
          "monthlyStats.minutesActive": 15,
          "monthlyStats.aiQueries": 2,
        },
      },
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
};
export const createAssessment = async (req, res) => {
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
    } = req.body;

    let assessment;
    let shouldNotify = false;

    const course = await Course.findOne({ courseId });
    if (!course) {
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
          scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
          dueDate,
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
        scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
        dueDate,
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
};
export const deleteLecture = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const lecture = await Lectures.findOne({ id: lectureId });
    if (!lecture) {
      return res.status(404).json({ message: "Lecture not found" });
    }

    const { courseId, topicName, date, id } = lecture;
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({ message: "Associated course not found" });
    }
    const isAuthorizedLecturer =
      course.lecturerIds && course.lecturerIds.includes(req.user.uid);
    if (!isAuthorizedLecturer) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not assigned to teach this course.",
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

    return res.status(200).json({
      success: true,
      message: "Lecture successfully cancelled and enrolled students notified.",
    });
  } catch (error) {
    console.error("Delete Lecture Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
export const fetchLectureAttendanceReport = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const { exceptions = [] } = req.body;

    const lecture = await Lectures.findOne({ id: lectureId });
    if (!lecture) {
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

    return res.status(200).json({
      success: true,
      message: "Attendance sheet compiled successfully!",
      pdfUrl: firebaseUrl,
    });
  } catch (error) {
    console.error("Backend PDF Engine Error:", error);
    res.status(500).json({ message: "Internal server compilation error." });
  }
};
//
export const getCourseFinalAttendanceSummary = async (req, res) => {
  try {
    const { courseId } = req.params;
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({ message: "Course context not found." });
    }
    const totalLecturesCount = await Lectures.countDocuments({
      courseId,
      status: "completed",
      lectureType: { $ne: "Recorded" },
    });
    if (totalLecturesCount === 0) {
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

    return res.status(200).json({
      success: true,
      courseCode: course.courseCode,
      courseTitle: course.courseTitle,
      totalLecturesHeld: totalLecturesCount,
      data: attendanceSummary,
    });
  } catch (error) {
    console.error("End of Semester Analytics Aggregation Error:", error);
    res
      .status(500)
      .json({ message: "Failed to generate course grading summary sheet." });
  }
};
export const getCourseLecturePdfDirectory = async (req, res) => {
  try {
    const { courseId } = req.params;
    const lectureHistory = await Lectures.find({
      courseId,
      status: "completed",
    })
      .select("id topicName date startTime pdfUrl getAttendanceMode")
      .sort({ date: -1 });
    return res.status(200).json({
      success: true,
      history: lectureHistory,
    });
  } catch (error) {
    console.error("Fetch Directory Error:", error);
    res.status(500).json({ message: "Internal server registry lookup error." });
  }
};
//
export const compareStudentFacesWithGemini = async (req, res) => {
  try {
    const { selfieBase64, targetImageUrl } = req.body;
    if (!selfieBase64 || !targetImageUrl) {
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
      return res.status(500).json({
        verified: false,
        message: "AI Engine returned empty validation text.",
      });
    }
    const validationResult = JSON.parse(aiOutputText);

    if (validationResult.verified === true) {
      return res.status(200).json({
        verified: true,
        message: "Identity confirmed successfully.",
      });
    } else {
      return res.status(401).json({
        verified: false,
        message: validationResult.reason || "Facial signature mismatch.",
      });
    }
  } catch (error) {
    console.error("Gemini Multi-Modal verification exception:", error);
    return res.status(500).json({
      verified: false,
      message: "Internal server processing failure.",
    });
  }
};
export const uploadCourseMaterial = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { materialUrl, title } = req.body;

    if (!materialUrl) {
      return res
        .status(400)
        .json({ message: "Missing material URL parameter." });
    }
    const course = await Course.findOne({ courseId });
    if (!course) {
      return res.status(404).json({ message: "Course context not found." });
    }
    const isAuthorized =
      course.lecturerIds && course.lecturerIds.includes(req.user.uid);
    if (!isAuthorized) {
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
            payload: { courseId, fileName },
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
    return res.status(200).json({
      message: "Material added successfully",
    });
  } catch (error) {
    console.error("Backend Upload Sync Error:", error);
    return res
      .status(500)
      .json({ message: "Server error during upload synchronization." });
  }
};
export const deleteCourseMaterial = async (req, res) => {
      try {
        const { courseId } = req.params;
        const { materialUrl } = req.body;

        if (!materialUrl) {
          return res
            .status(400)
            .json({ message: "Missing reference target URL." });
        }
        const course = await Course.findOne({ courseId });
        if (!course) {
          return res
            .status(404)
            .json({ message: "Course context target not found." });
        }
        const isAuthorized =
          course.lecturerIds && course.lecturerIds.includes(req.user.uid);
        if (!isAuthorized) {
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
                payload: { courseId, fileName },
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
        return res.status(200).json({
          message: "Material permanently deleted",
          resources: updatedCourse.resources,
        });
      } catch (error) {
        console.error("Backend Deletion Pipeline Error: ", error);
        return res
          .status(500)
          .json({
            message: "Internal server error occurred while deleting resource.",
          });
      }
    },