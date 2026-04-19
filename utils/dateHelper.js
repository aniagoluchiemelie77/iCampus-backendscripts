export const generateExpiryDate = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear() + 5).slice(-2);
  return `${month}/${year}`;
};