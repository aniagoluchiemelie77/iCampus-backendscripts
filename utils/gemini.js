// Shared Gemini settings.
//
// The model is configurable so it can be switched (e.g. to a paid tier or a
// different model with separate quota) from .env without code changes.
// Read lazily: some controllers are imported before dotenv runs.
export const geminiModel = () =>
  process.env.GEMINI_MODEL || "gemini-3-flash-preview";

export const geminiModels = () => {
  const configured = process.env.GEMINI_MODELS
    ?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [
    ...new Set([
      ...(configured || []),
      geminiModel(),
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
    ]),
  ];
};

export const isGeminiUnavailableError = (error) =>
  error?.status === 503 ||
  error?.status === 502 ||
  error?.code === 503 ||
  error?.code === "UNAVAILABLE" ||
  /UNAVAILABLE|"code":\s*503|overloaded|high demand/i.test(
    String(error?.message || ""),
  );

export const isGeminiTransientError = (error) =>
  isGeminiQuotaError(error) ||
  isGeminiUnavailableError(error) ||
  error?.status === 404 ||
  /NOT_FOUND|not found|no longer available/i.test(
    String(error?.message || ""),
  ) ||
  error?.status === 429 ||
  error?.status === 408 ||
  error?.status === 504;

export const withGeminiRetry = async (
  operation,
  { attempts = 3, initialDelayMs = 750 } = {},
) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isGeminiTransientError(error) || attempt === attempts - 1) {
        throw error;
      }
      const delay = initialDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

export const generateGeminiContent = async (ai, request) =>
  withGeminiRetry(async (attempt) => {
    const models = geminiModels();
    const model = models[Math.min(attempt, models.length - 1)];
    return ai.models.generateContent({ ...request, model });
  });

// Quota / rate-limit errors (HTTP 429, RESOURCE_EXHAUSTED). These are
// temporary and should reach users as "busy, try again later", not a 500.
export const isGeminiQuotaError = (error) =>
  error?.status === 429 ||
  error?.code === 429 ||
  /RESOURCE_EXHAUSTED|"code":\s*429/.test(String(error?.message || ""));

export const GEMINI_BUSY_MESSAGE =
  "The AI service is busy right now. Please try again in a little while.";
