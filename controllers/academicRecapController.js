import { User, Course, Lectures, Attendance, Assessment, TestSubmission } from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import { sendEmail } from "../services/emailService.js";
import { generateSessionRecapPDF } from "../templates/sessionRecapTemplate.js";

const asText = value => String(value ?? "").trim();

const sessionValue = value => {
  const match = asText(value).match(/\d{4}\s*\/\s*\d{4}/);
  return match ? match[0].replace(/\s/g, "") : "";
};

const sessionStart = value => {
  const year = Number(asText(value).slice(0, 4));
  return Number.isFinite(year) ? year : 0;
};

export const detectAcademicSessionRecap = async ({
  requesterUid,
  requesterEmail,
  role,
  sessions,
  newLevel,
}) => {
  const normalizedSessions = [...new Set(sessions.map(sessionValue).filter(Boolean))]
    .sort((a, b) => sessionStart(a) - sessionStart(b));
  const latestSession = normalizedSessions.at(-1);
  if (!latestSession) return null;

  const userSnapshot = await User.where("uid", "==", requesterUid).limit(1).get();
  if (userSnapshot.empty) return null;
  const userRef = userSnapshot.docs[0].ref;
  const userData = userSnapshot.docs[0].data();
  let previousSession =
    sessionValue(userData.lastRecapSession || userData.currentAcademicSession || userData.previousAcademicSession) ||
    sessionValue(normalizedSessions.filter(session => session !== latestSession).at(-1));
  if (!previousSession) {
    const courseSnapshot = await Course.get();
    const priorSessions = [...new Set(courseSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(course =>
        role === "lecturer"
          ? asText(course.lecturerId) === requesterUid || (course.lecturers || []).includes(requesterUid)
          : (course.studentsEnrolled || []).includes(requesterUid) || asText(course.studentId) === requesterUid,
      )
      .map(course => sessionValue(course.session))
      .filter(value => value && value !== latestSession))]
      .sort((a, b) => sessionStart(b) - sessionStart(a));
    previousSession = priorSessions[0] || "";
  }
  const changedLevel = role === "student" &&
    asText(newLevel) && asText(newLevel) !== asText(userData.current_level);

  if (!previousSession || previousSession === latestSession) {
    await userRef.set({ currentAcademicSession: latestSession }, { merge: true });
    return null;
  }

  if (sessionStart(latestSession) <= sessionStart(previousSession)) {
    await userRef.set({ currentAcademicSession: latestSession }, { merge: true });
    return null;
  }

  await userRef.set({
    currentAcademicSession: latestSession,
    previousAcademicSession: previousSession,
    recapPromptPending: true,
    ...(changedLevel ? { current_level: asText(newLevel) } : {}),
  }, { merge: true });

  await createNotification({
    notificationId: generateNotificationId("academic"),
    recipientId: requesterUid,
    recipientEmail: requesterEmail,
    isRead: false,
    sendEmail: false,
    sendPush: true,
    sendSocket: true,
    saveToDb: true,
    category: "academic",
    actionType: "ACADEMIC_SESSION_RECAP",
    title: "Would you like a recap of your last session?",
    message: `A new academic session (${latestSession}) has been detected. View a recap of your ${previousSession} activities.`,
    payload: { previousSession, currentSession: latestSession, changedLevel },
    entityId: requesterUid,
    entityType: "user",
  });
  return { previousSession, latestSession };
};

const belongsToSession = (record, session) =>
  sessionValue(record.session || record.academicSession) === session;

export const requestAcademicSessionRecap = async (req, res) => {
  try {
    const uid = req.user?.uid || req.user?.id;
    const session = sessionValue(req.body?.session);
    if (!uid || !session) {
      return res.status(400).json({ success: false, message: "A valid previous session is required." });
    }

    const userSnapshot = await User.where("uid", "==", uid).limit(1).get();
    if (userSnapshot.empty) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }
    const userDoc = userSnapshot.docs[0];
    const user = userDoc.data();
    const role = user.usertype === "lecturer" ? "lecturer" : "student";
    const courseSnapshot = await Course.get();
    const courses = courseSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(course => belongsToSession(course, session))
      .filter(course =>
        role === "lecturer"
          ? asText(course.lecturerId) === uid || (course.lecturers || []).includes(uid)
          : (course.studentsEnrolled || []).includes(uid) || asText(course.studentId) === uid,
      );
    const courseIds = courses.map(course => course.courseId || course.id).filter(Boolean);

    const [lectureSnapshot, attendanceSnapshot, assessmentSnapshot, submissionSnapshot] =
      await Promise.all([Lectures.get(), Attendance.get(), Assessment.get(), TestSubmission.get()]);
    const lectures = lectureSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => belongsToSession(item, session) && courseIds.includes(item.courseId));
    const attendance = attendanceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item =>
        courseIds.includes(item.courseId) &&
        (role === "lecturer" || item.studentId === uid || item.userId === uid),
      );
    const assessments = assessmentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => belongsToSession(item, session) && courseIds.includes(item.courseId));
    const submissions = submissionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => item.studentId === uid && courseIds.includes(item.courseId));

    const presentAttendance = attendance.filter(item =>
      ["present", "true", true, "attended"].includes(item.status ?? item.attendanceStatus),
    ).length;
    const stats = role === "lecturer"
      ? {
          "Courses taught": courses.length,
          "Lectures conducted": lectures.filter(item => item.hostId === uid || item.lecturerId === uid).length,
          Assessments: assessments.length,
        }
      : {
          Courses: courses.length,
          Lectures: lectures.length,
          "Attendance marked": presentAttendance,
          Assessments: submissions.length,
          "Average assessment score": submissions.length
            ? `${Math.round(submissions.reduce((sum, item) => sum + Number(item.score || item.percentage || 0), 0) / submissions.length)}%`
            : "Not available",
        };

    const pdf = await generateSessionRecapPDF({ user, role, session, stats });
    const recipient = user.email || req.user?.email;
    if (!recipient) {
      return res.status(400).json({ success: false, message: "No email address is linked to this account." });
    }
    await sendEmail({
      to: recipient,
      subject: `Your iCampus ${session} academic session recap`,
      text: `Hi ${user.firstname || ""}, your ${session} academic session recap is attached.`,
      html: `<p>Hi ${user.firstname || "there"},</p><p>Your academic session recap for <strong>${session}</strong> is attached.</p>`,
      attachments: [{
        filename: `icampus-${session.replace("/", "-")}-recap.pdf`,
        content: pdf,
        contentType: "application/pdf",
      }],
    });
    await userDoc.ref.set({ recapPromptPending: false, lastRecapSession: session }, { merge: true });

    res.status(200).json({ success: true, message: "Your session recap has been sent by email.", stats });
  } catch (error) {
    console.error("Academic recap failed:", error);
    res.status(500).json({ success: false, message: "Could not generate your session recap." });
  }
};
