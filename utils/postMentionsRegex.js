export const extractMentions = (text) => {
  if (!text) return [];
  const mentionRegex = /@(\w+)/g;
  const matches = text.match(mentionRegex);
  return matches ? matches.map(match => match.substring(1)) : []; 
};