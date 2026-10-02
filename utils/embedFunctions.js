import { OperationalInstitutions } from "../tableDeclarations.js";

export const embedUserWithInstitutionTier = async (user) => {
  if (!user) return user;
  const isInstitutionalUser = 
    user.usertype === 'student' || user.usertype === 'lecturer';
  if (!isInstitutionalUser || !user.schoolCode) {
    return {
      ...user
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

    let institutionTier = 'free';

    if (!institutionSnapshot.empty) {
      const institutionData = institutionSnapshot.docs[0].data();
      institutionTier = institutionData.tier || 'free';
    }
    return {
      ...user,
      institutionTier,
    };
  } catch (err) {
    console.error(`Error fetching institution tier for schoolCode ${user.schoolCode}:`, err.message);
    return {
      ...user,
      institutionTier: 'free', 
    };
  }
};