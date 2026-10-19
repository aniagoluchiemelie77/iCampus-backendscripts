import { Notification } from "../tableDeclarations.js";

// The notifications list collapses repeats of the same action on the same
// entity ("Ada and 3 others liked your post"). Fetching, counting and marking
// read must all agree on what a group is, so the key lives here.
export const notificationGroupKey = (notif) => {
  const payload = notif.payload || {};
  const entityId =
    payload.postId ||
    payload.followerId ||
    payload.viewerUid ||
    notif.notificationId ||
    notif.id;
  return `${notif.actionType || "unknown"}_${entityId}`;
};

// Records saved before `isRead` was written have no field at all; treat those
// as unread instead of relying on a Firestore `isRead == false` filter, which
// never matches a missing field.
export const isNotificationUnread = (notif) => notif.isRead !== true;

const toMillis = (notif) =>
  notif.createdAt?.toMillis
    ? notif.createdAt.toMillis()
    : new Date(notif.createdAt).getTime();

/**
 * Loads a user's notifications and collapses them into groups, newest first.
 * Each group is the latest notification plus `othersCount`/`unreadCount`, and
 * is unread while any member is unread.
 */
export const loadNotificationGroups = async (userId, { category } = {}) => {
  let recipientQuery = Notification.where("recipientId", "==", userId);
  let publicQuery = Notification.where("isPublic", "==", true);
  if (category) {
    recipientQuery = recipientQuery.where("category", "==", category);
    publicQuery = publicQuery.where("category", "==", category);
  }
  const [recipientSnapshot, publicSnapshot] = await Promise.all([
    recipientQuery.get(),
    publicQuery.get(),
  ]);

  const byId = new Map();
  [...recipientSnapshot.docs, ...publicSnapshot.docs].forEach((doc) => {
    byId.set(doc.id, { id: doc.id, ...doc.data() });
  });
  const all = Array.from(byId.values()).sort((a, b) => toMillis(b) - toMillis(a));

  const groups = new Map();
  all.forEach((notif) => {
    const key = notificationGroupKey(notif);
    if (!groups.has(key)) groups.set(key, { latest: notif, count: 0, unread: 0 });
    const group = groups.get(key);
    group.count += 1;
    if (isNotificationUnread(notif)) group.unread += 1;
  });

  return Array.from(groups.values()).map(({ latest, count, unread }) => {
    const payload = latest.payload || {};
    return {
      ...latest,
      isRead: unread === 0,
      payload: {
        ...payload,
        primaryUser: payload.username || payload.firstname || "Someone",
        othersCount: Math.max(0, count - 1),
        unreadCount: unread,
      },
    };
  });
};
