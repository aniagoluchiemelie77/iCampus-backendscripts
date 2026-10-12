export function prepareChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((h) => h && (h.text || h.parts))
    .map((h) => {
      let role = h.role;
      if (role === "assistant" || role === "bot") {
        role = "model";
      }
      if (role !== "user" && role !== "model") {
        role = "user"; 
      }
      const parts = Array.isArray(h.parts)
        ? h.parts
        : [{ text: h.text || "" }];

      return { role, parts };
    });
}