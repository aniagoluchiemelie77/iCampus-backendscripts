// Image attachments on admin-sent notifications (memos are usually photos or
// scans). The portal uploads the files to Cloudinary first and sends their
// URLs; only https URLs on our own media hosts are accepted, so a notification
// can never point users at an arbitrary site.
const MEDIA_HOSTS = ["res.cloudinary.com", "firebasestorage.googleapis.com", "storage.googleapis.com"];
export const MAX_ATTACHMENTS = 4;

const allowedUrl = (value) => {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && MEDIA_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
};

/**
 * Normalises `[{ url, type, fileName }]` from a request body.
 * Returns { attachments } or { error }.
 */
export const parseAttachments = (input) => {
  if (input === undefined || input === null) return { attachments: [] };
  if (!Array.isArray(input)) return { error: "Attachments must be a list." };
  if (input.length > MAX_ATTACHMENTS) return { error: `Attach at most ${MAX_ATTACHMENTS} files.` };
  const attachments = [];
  for (const item of input) {
    if (!allowedUrl(item?.url)) return { error: "An attachment was not uploaded correctly. Remove it and try again." };
    const type = item.type === "file" ? "file" : "image";
    attachments.push({
      url: String(item.url),
      type,
      fileName: String(item.fileName || "").slice(0, 120) || null,
    });
  }
  return { attachments };
};

/** Fields to merge into a notification payload (imageUrl drives the push picture). */
export const attachmentPayload = (attachments) => {
  if (!attachments.length) return {};
  const firstImage = attachments.find((a) => a.type === "image");
  return { attachments, ...(firstImage ? { imageUrl: firstImage.url } : {}) };
};
