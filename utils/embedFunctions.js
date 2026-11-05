import { OperationalInstitutions, User } from "../tableDeclarations.js";

export const normalizeInstitutionTier = (tier) => {
  const normalized = String(tier || "basic").trim().toLowerCase();
  if (normalized === "enterprise" || normalized === "premium") return "premium";
  if (normalized === "pro" || normalized === "professional") return "pro";
  return "basic";
};

export const institutionTierToUserTier = (tier) => {
  const normalized = normalizeInstitutionTier(tier);
  return normalized === "basic" ? "free" : normalized;
};

export const embedUserWithInstitutionTier = async (user) => {
  if (!user) return user;
  const isInstitutionalUser =
    user.usertype === "student" || user.usertype === "lecturer";
  const isInstitutionAdmin =
    user.usertype === "enterprise" && user.isInstitutionAdmin === true;
  if ((!isInstitutionalUser && !isInstitutionAdmin) || !user.schoolCode) {
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

    let institutionTier = "basic";

    if (!institutionSnapshot.empty) {
      const institutionData = institutionSnapshot.docs[0].data();
      institutionTier = normalizeInstitutionTier(institutionData.tier);
    }
    return {
      ...user,
      institutionTier,
      tier: institutionTierToUserTier(institutionTier),
      hasSubscribed: true,
    };
  } catch (err) {
    console.error(
      `Error fetching institution tier for schoolCode ${user.schoolCode}:`,
      err.message,
    );
    return {
      ...user,
      institutionTier: "basic",
      tier: "free",
      hasSubscribed: true,
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
        instructorId: lastLecturerId || null,
      };
    }

    return {
      ...course,
      instructors: null,
      instructorId: null,
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
