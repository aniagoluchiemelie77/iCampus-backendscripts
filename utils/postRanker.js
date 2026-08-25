export const calculateRankingScore = (postData, authorDetails = {}) => {
  const subscriberBonus = authorDetails.isSubscriber === true ? 1000 : 0;
  
  let tierMultiplier = 1;
  if (authorDetails.tier === "premium") tierMultiplier = 5;
  else if (authorDetails.tier === "pro") tierMultiplier = 2;

  const impressionsScore = (postData.impressions || 0) * 0.1 * tierMultiplier;
  const engagementScore = ((postData.likesCount || 0) * 2) + ((postData.commentsCount || 0) * 3);

  const createdAtTime = postData.createdAt?.toMillis 
    ? postData.createdAt.toMillis() 
    : new Date(postData.createdAt || Date.now()).getTime();
  
  const timeScore = createdAtTime / 1000000000;

  return subscriberBonus + impressionsScore + engagementScore + timeScore;
};