import { Follow } from "../tableDeclarations.js";

export const getPriorityReposter = async (repostersDetails, currentUserId) => {
  if (!repostersDetails || repostersDetails.length === 0) return null;

  const reposterIds = repostersDetails.map(r => r.uid);
  const followedUsers = await Follow.find({
    followerId: currentUserId,
    followingId: { $in: reposterIds }
  }).distinct('followingId');

  const followedSet = new Set(followedUsers);
  const pickBest = (list) => {
    const followedInList = list.filter(r => followedSet.has(r.uid));
    if (followedInList.length > 0) return followedInList[0];
    return list[0];
  };
  const premiums = repostersDetails.filter(r => r.tier === 'premium');
  if (premiums.length > 0) return pickBest(premiums);
  const pros = repostersDetails.filter(r => r.tier === 'pro');
  if (pros.length > 0) return pickBest(pros);
  if (followedUsers.length > 0) {
    return repostersDetails.find(r => followedSet.has(r.uid));
  }
  return repostersDetails[Math.floor(Math.random() * repostersDetails.length)];
};