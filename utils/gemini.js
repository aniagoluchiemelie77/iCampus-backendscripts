// Shared Gemini settings.
//
// The model is configurable so it can be switched (e.g. to a paid tier or a
// different model with separate quota) from .env without code changes.
// Read lazily: some controllers are imported before dotenv runs.
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

// Quota / rate-limit errors (HTTP 429, RESOURCE_EXHAUSTED). These are
// temporary and should reach users as "busy, try again later", not a 500.
export const isGeminiQuotaError = (error) =>
  error?.status === 429 ||
  error?.code === 429 ||
  /RESOURCE_EXHAUSTED|"code":\s*429/.test(String(error?.message || ""));

export const GEMINI_BUSY_MESSAGE =
  "The AI service is busy right now. Please try again in a little while.";
