// Simplified Logic for iScore Calculation
const calculateIScore = (userStats) => {
  const engagement = (userStats.minutesActive / 120) * 20; // 20% weight
  const academic = (userStats.avgTestScore / 100) * 30;    // 30% weight
  const assistantUse = (userStats.aiQueries / 50) * 10;   // 10% weight
  const reputation = (userStats.avgReview / 5) * 40;      // 40% weight

  let total = engagement + academic + assistantUse + reputation;

  // Apply Subscription Boost
  if (userStats.tier === 'Premium') total *= 1.05;
  if (userStats.isVerified) total += 2;

  return Math.min(total, 100); // Cap at 100
};