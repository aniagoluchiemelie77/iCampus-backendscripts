import { storage } from '../config/firebaseAdmin.js'; 
import { Certificate, User, Product } from '../tableDeclarations.js';
import { createNotification } from '../services/notification.js';
import { generateCertificatePDF } from "../templates/downloadsCertificateTemplate.js";
import {generateNotificationId} from '../utils/idGenerator.js';


export const handleGenerateCertificate = async (req, res) => {
  const { productId } = req.body;
  const { uid, email} = req.user;

  try {
    const student = await User.findOne({ uid });
    const course = await Product.findOne({ productId });
    const lecturers = await User.find({ uid: { $in: course.courseDetails.lecturerIds } });
    
    const studentFullName = `${student.firstname} ${student.lastname}`;
    const certId = `CERT-${productId.slice(-5)}-${uid.slice(-5)}`.toUpperCase();

    const composition = {
      certificateId: certId,
      studentName: studentFullName,
      courseTitle: course.title,
      lecturers: lecturers.map(l => `${l.firstname} ${l.lastname}`),
      institution: "iCampus",
      logoUrl: "https://res.cloudinary.com/dbdw3zftx/image/upload/v1759354003/Black_And_White_King_Logo_ydy68f.png",
      issueDate: new Date().toLocaleDateString("en-NG"),
    };
    const pdfBuffer = await generateCertificatePDF(composition);
    const bucket = storage.bucket();
    const file = bucket.file(`certificates/${uid}/${certId}.pdf`);

    await file.save(pdfBuffer, {
      metadata: { contentType: 'application/pdf' },
      public: true,
    });
    const firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;
    const newCert = new Certificate({
      ...composition,
      uid,
      productId,
      pdfUrl: firebaseUrl
    });
    await newCert.save();
    await createNotification({
      notificationId: generateNotificationId('classroom'),
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
      }
    });
    res.status(200).json({ 
      success: true,
      pdfUrl: firebaseUrl, 
      certificateId: certId,
      composition
    });

  } catch (error) {
    console.error("Cert Flow Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};