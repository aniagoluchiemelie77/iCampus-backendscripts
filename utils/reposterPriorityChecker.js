import { Follow, User } from "../tableDeclarations.js";

export const getPriorityReposter = async (repostersDetails, currentUserId) => {
  if (!Array.isArray(repostersDetails) || repostersDetails.length === 0)
    return null;

  const reposterIds = repostersDetails.map((r) => r?.uid).filter(Boolean);
  let followedUsers = [];

  if (currentUserId && reposterIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < reposterIds.length; i += 30) {
      chunks.push(reposterIds.slice(i, i + 30));
    }
    const queryPromises = chunks.map((chunk) =>
      Follow.where("followerId", "==", currentUserId)
        .where("followingId", "in", chunk)
        .get(),
    );

    const snapshots = await Promise.all(queryPromises);

    snapshots.forEach((querySnapshot) => {
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data && data.followingId) {
          followedUsers.push(data.followingId);
        }
      });
    });
  }

  const followedSet = new Set(followedUsers);

  const pickBest = (list) => {
    const followedInList = list.filter((r) => r && followedSet.has(r.uid));
    if (followedInList.length > 0) return followedInList[0];
    return list[0];
  };

  const premiums = repostersDetails.filter((r) => r?.tier === "premium");
  if (premiums.length > 0) return pickBest(premiums);

  const pros = repostersDetails.filter((r) => r?.tier === "pro");
  if (pros.length > 0) return pickBest(pros);

  if (followedUsers.length > 0) {
    const found = repostersDetails.find((r) => r && followedSet.has(r.uid));
    if (found) return found;
  }
  return (
    repostersDetails[Math.floor(Math.random() * repostersDetails.length)] ||
    null
  );
};
export const embedPostWithAuthorDetails = async (post) => {
  if (!post || !post.originalAuthor) {
    return post;
  }
  const authorId =
    typeof post.originalAuthor === "string"
      ? post.originalAuthor
      : post.originalAuthor?.uid || post.originalAuthor?.id;

  if (!authorId) {
    post.postAuthorsDetails = null;
    return post;
  }

  try {
    const userDoc = await User.doc(authorId).get();
    if (!userDoc.exists) {
      post.postAuthorsDetails = null;
      return post;
    }
    const userData = userDoc.data();
    const authorDetails = {
      uid: userDoc.id,
      firstname: userData?.firstname || userData?.firstName || "",
      lastname: userData?.lastname || userData?.lastName,
      username: userData?.username,
      tier: userData?.tier || "free",
      organizationName: userData?.organizationName,
      profilePic: Array.isArray(userData?.profilePic)
        ? userData.profilePic.map(String)
        : userData?.profilePic
          ? [String(userData.profilePic)]
          : [],
      isVerified: userData?.isVerified || false,
    };
    post.postAuthorsDetails = authorDetails;
  } catch (error) {
    console.error(
      `Failed to fetch author details for post ${post.postId || "unknown"}:`,
      error,
    );
    post.postAuthorsDetails = null;
  }

  return post;
};
