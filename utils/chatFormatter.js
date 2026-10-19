// Normalises client chat history into Gemini's format.
// Gemini expects oldest-first turns that start with a "user" turn; the app's
// history begins with the assistant's greeting, so leading model turns are
// dropped. Consecutive same-role turns are merged so roles alternate.
export function prepareChatHistory(history, { maxTurns = 20 } = {}) {
  if (!Array.isArray(history)) return [];

  const turns = history
    .filter((h) => h && (h.text || h.parts || h.content))
    .map((h) => {
      let role = h.role;
      if (role === "assistant" || role === "bot") role = "model";
      if (role !== "user" && role !== "model") role = "user";
      const text = Array.isArray(h.parts)
        ? h.parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
        : String(h.text ?? h.content ?? "");
      return { role, text: text.trim() };
    })
    .filter((t) => t.text.length > 0);

  const merged = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) last.text += `\n\n${turn.text}`;
    else merged.push({ ...turn });
  }

  let recent = merged.slice(-maxTurns);
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  return recent.map(({ role, text }) => ({ role, parts: [{ text }] }));
}
