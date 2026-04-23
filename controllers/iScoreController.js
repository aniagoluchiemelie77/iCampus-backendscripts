const calculateIScore = (userStats) => {
  const engagement = (userStats.minutesActive / 120) * 15;
  const academic = (userStats.avgTestScore / 100) * 25; // Reduced from 30
  const libraryUse = (userStats.booksRead / 10) * 15;
  const assistantUse = (userStats.aiQueries / 50) * 10;
  const reputation = (userStats.avgReview / 5) * 35; // Reduced from 40

  let total = engagement + academic + libraryUse + assistantUse + reputation;

  // 2. Multipliers & Bonuses
  if (userStats.tier === "Premium") total *= 1.05; // 5% Boost
  if (userStats.isVerified) total += 2; // Flat Bonus
  return Math.min(total, 100);
};
