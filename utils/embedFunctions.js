import { OperationalInstitutions, User } from "../tableDeclarations.js";

export const embedUserWithInstitutionTier = async (user) => {
  if (!user) return user;
  const isInstitutionalUser =
    user.usertype === "student" || user.usertype === "lecturer";
  if (!isInstitutionalUser || !user.schoolCode) {
    return {
      ...user,
    };
  }

  try {
    const institutionSnapshot = await OperationalInstitutions.where(
      "schoolCode",
      "==",
      user.schoolCode,
    )
      .limit(1)
      .get();

    let institutionTier = "free";

    if (!institutionSnapshot.empty) {
      const institutionData = institutionSnapshot.docs[0].data();
      institutionTier = institutionData.tier || "free";
    }
    return {
      ...user,
      institutionTier,
    };
  } catch (err) {
    console.error(
      `Error fetching institution tier for schoolCode ${user.schoolCode}:`,
      err.message,
    );
    return {
      ...user,
      institutionTier: "free",
    };
  }
};
export const embedCourseInstructor = async (course) => {
  if (
    !course ||
    !Array.isArray(course.lecturerIds) ||
    course.lecturerIds.length === 0
  ) {
    return {
      ...course,
      instructors: null,
    };
  }
  const lastLecturerId = course.lecturerIds[course.lecturerIds.length - 1];
  if (!lastLecturerId) {
    return {
      ...course,
      instructors: null,
    };
  }

  try {
    let userDoc = await User.doc(lastLecturerId).get();
    let userData = null;

    if (userDoc.exists) {
      userData = userDoc.data();
    } else {
      const userSnapshot = await User.where("uid", "==", lastLecturerId)
        .limit(1)
        .get();
      if (!userSnapshot.empty) {
        userData = userSnapshot.docs[0].data();
      }
    }

    if (userData) {
      const firstName = userData.firstname || userData.firstName || "";
      const lastName = userData.lastname || userData.lastName || "";
      const fullName = `${firstName} ${lastName}`.trim();

      return {
        ...course,
        instructors: fullName || null,
      };
    }

    return {
      ...course,
      instructors: null,
    };
  } catch (err) {
    console.error(
      `Error fetching instructor for lecturerId ${lastLecturerId}:`,
      err.message,
    );
    return {
      ...course,
      instructors: null,
    };
  }
};
