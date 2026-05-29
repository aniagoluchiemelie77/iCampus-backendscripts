import { storage } from "../config/firebaseAdmin.js";
import {
  Certificate,
  User,
  Product,
  Exceptions,
  Transactions,
  Assessment,
  TestSubmission
} from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import { generateCertificatePDF } from "../templates/downloadsCertificateTemplate.js";
import {
  generateNotificationId,
  generateExceptionId,
} from "../utils/idGenerator.js";
import {
  EXCEPTION_COST_IN_ICASH,
  EXCEPTION_ACCOUNT_LIMITS,
} from "../constants/inAppConstants.js";

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
    },
