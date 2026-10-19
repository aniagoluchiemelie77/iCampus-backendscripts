import { User, Comments, PostReposters } from "../tableDeclarations.js";
import { getPriorityReposter } from "./reposterPriorityChecker.js";

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------
// "public": everyone. "school": an institution memo, visible only to students
// and lecturers of the posting school (plus the author themselves).
export const POST_AUDIENCES = ["public", "school"];
const SCHOOL_AUDIENCE_USER_TYPES = ["student", "lecturer"];

export const canPostToSchool = (user) =>
  !!user && user.isInstitutionAdmin === true && !!user.schoolCode;

/** `viewer` is the full user record (req.user from `protect`). */
export const canViewPost = (post, viewer) => {
  if (!post || post.status === "hidden") return false;
  if ((post.audience || "public") !== "school") return true;
  const viewerUid = viewer?.uid || viewer?.id;
  if (viewerUid && viewerUid === post.originalAuthor) return true;
  return (
    SCHOOL_AUDIENCE_USER_TYPES.includes(viewer?.usertype) &&
    !!viewer?.schoolCode &&
    viewer.schoolCode === post.schoolCode
  );
};

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
const chunk = (list, size = 30) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const toPicArray = (pic) =>
  Array.isArray(pic) ? pic.filter(Boolean).map(String) : pic ? [String(pic)] : [];
const toIso = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "object" && "_seconds" in value)
    return new Date(value._seconds * 1000).toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export const toPublicUser = (data, fallbackUid) =>
  data
    ? {
        uid: data.uid || fallbackUid,
        firstname: data.firstname || data.firstName || "",
        lastname: data.lastname || data.lastName || "",
        username: data.username || "",
        tier: data.tier || "free",
        organizationName: data.organizationName || null,
        profilePic: toPicArray(data.profilePic),
        isVerified: !!data.isVerified,
        usertype: data.usertype || null,
      }
    : null;

/** Loads public profiles for many uids in batches of 30. */
export const loadUsersByUid = async (uids) => {
  const unique = [...new Set(uids.filter((u) => typeof u === "string" && u))];
  const map = new Map();
  await Promise.all(
    chunk(unique).map(async (ids) => {
      const snap = await User.where("uid", "in", ids).get();
      snap.docs.forEach((doc) => {
        const data = doc.data();
        map.set(data.uid || doc.id, toPublicUser(data, doc.id));
      });
    }),
  );
  return map;
};

const normalizeReposter = (r) => ({
  uid: r.uid,
  firstname: r.firstname || "",
  lastname: r.lastname || "",
  username: r.username || "",
  tier: r.tier || "free",
  organizationName: r.organizationName || null,
  profilePic: toPicArray(r.profilePic),
  repostedAt: toIso(r.repostedAt),
});

/**
 * Turns raw post documents into the shape every client screen expects:
 * author details, reposters, counts, and a featured reposter. Pass
 * `featuredReposterUid` to pin the reposter shown (e.g. on a profile, the
 * profile owner's own reposts).
 */
export const enrichPosts = async (
  rawPosts,
  viewerUid,
  { featuredReposterUid } = {},
) => {
  if (!rawPosts.length) return [];
  const ids = rawPosts.map((p) => p.postId || p.id);

  const repostersByPost = new Map();
  const commentCounts = new Map();
  const [authorMap] = await Promise.all([
    loadUsersByUid(rawPosts.map((p) => p.originalAuthor)),
    Promise.all(
      chunk([...new Set(ids)]).map(async (part) => {
        const snap = await PostReposters.where("postId", "in", part).get();
        snap.docs.forEach((doc) => {
          const data = doc.data();
          if (!repostersByPost.has(data.postId)) repostersByPost.set(data.postId, []);
          repostersByPost.get(data.postId).push(normalizeReposter(data));
        });
      }),
    ),
    Promise.all(
      [...new Set(ids)].map(async (id) => {
        const agg = await Comments.where("postId", "==", id).count().get();
        commentCounts.set(id, agg.data().count);
      }),
    ),
  ]);

  return Promise.all(
    rawPosts.map(async (post) => {
      const postId = post.postId || post.id;
      const repostersDetails = (repostersByPost.get(postId) || []).sort(
        (a, b) => new Date(b.repostedAt || 0) - new Date(a.repostedAt || 0),
      );
      const pinned = featuredReposterUid
        ? repostersDetails.find((r) => r.uid === featuredReposterUid)
        : null;
      // Legacy posts embedded a `comments` array; comments now live in their
      // own collection and are paged via GET /posts/:postId/comments.
      const { comments: _legacyComments, ...rest } = post;
      return {
        ...rest,
        id: post.id || postId,
        postId,
        audience: post.audience || "public",
        createdAt: toIso(post.createdAt),
        updatedAt: toIso(post.updatedAt),
        postAuthorsDetails: authorMap.get(post.originalAuthor) || null,
        repostersDetails,
        repostsCount: repostersDetails.length,
        commentsCount: commentCounts.get(postId) || 0,
        featuredReposter:
          pinned || (await getPriorityReposter(repostersDetails, viewerUid)),
      };
    }),
  );
};

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
export const COMMENT_TYPES = ["text", "gif", "sticker"];
const ALLOWED_MEDIA_HOSTS = /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com)\//i;

/** Validates a comment payload. Returns { error } or { value }. */
export const parseCommentInput = ({ text, comment, type, media, parentId }) => {
  const kind = COMMENT_TYPES.includes(type) ? type : "text";
  const body = typeof (text ?? comment) === "string" ? (text ?? comment).trim() : "";
  if (body.length > 2000) return { error: "Comment is too long (max 2000 characters)." };
  let cleanMedia = null;
  if (kind !== "text") {
    if (!media?.url || !ALLOWED_MEDIA_HOSTS.test(media.url)) {
      return { error: "Unsupported GIF or sticker." };
    }
    cleanMedia = {
      url: media.url,
      previewUrl: ALLOWED_MEDIA_HOSTS.test(media.previewUrl || "")
        ? media.previewUrl
        : media.url,
      width: Number(media.width) || null,
      height: Number(media.height) || null,
    };
  } else if (!body) {
    return { error: "Comment text is required." };
  }
  return {
    value: {
      type: kind,
      text: body,
      media: cleanMedia,
      parentId: typeof parentId === "string" && parentId ? parentId : null,
    },
  };
};

export const normalizeComment = (id, data, authorMap) => {
  const likes = Array.isArray(data.likes) ? data.likes : [];
  return {
    commentId: data.id || id,
    postId: data.postId,
    parentId: data.parentId || null,
    type: COMMENT_TYPES.includes(data.type) ? data.type : "text",
    text: data.text ?? data.comment ?? "",
    media: data.media || null,
    likes,
    likesCount: likes.length,
    createdAt: toIso(data.createdAt || data.timestamp),
    author: authorMap.get(data.userId) || {
      uid: data.userId,
      firstname: data.username || "iCampus user",
      lastname: "",
      username: data.username || "",
      tier: "free",
      profilePic: toPicArray(data.profilePic),
      isVerified: false,
    },
  };
};
