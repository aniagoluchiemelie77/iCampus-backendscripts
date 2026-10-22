export const extractMentions = (text) => {
  if (!text) return [];
  const mentionRegex = /@(\w+)/g;
  const matches = text.match(mentionRegex);
  // Usernames are stored lowercase, so "@Ada_O" still finds "ada_o".
  return matches
    ? [...new Set(matches.map((match) => match.substring(1).toLowerCase()))]
    : [];
};