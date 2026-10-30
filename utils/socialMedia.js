// iCampus's own social media accounts: daily snapshots of followers, posts
// and impressions, so the super admin and the social media admin can see
// whether the accounts are growing (and whether a paid manager is working).
//
// The platform APIs mostly return current totals (insights go back ~30 days
// at best), so a cron saves one snapshot per platform per day
// (cron/socialMediaCron.js) and the trends are built from those.
//
// Everything is configured in .env, so links and credentials can change at
// will. A platform with only a profile link shows as "link only"; add its
// credentials to start tracking. See SOCIAL_MEDIA_ENV below for the keys.
import { db } from "../config/firebaseAdmin.js";
import { SocialMediaSnapshots } from "../tableDeclarations.js";
import { localDateKey } from "./lectureTime.js";

const env = (key, fallback = "") => String(process.env[key] ?? fallback).trim();
const TIMEOUT_MS = 15000;
const DAY = 86400000;
const WINDOW_DAYS = 28;
const SocialConfig = db.collection("socialmediaconfig");

/** Raised for a platform problem worth showing on the dashboard. */
class PlatformError extends Error {}

const getJson = async (url, options = {}) => {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new PlatformError(err.name === "TimeoutError" ? "The platform took too long to respond." : "Could not reach the platform.");
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data.error || data.errors?.length) {
    // Never echo URLs: some APIs take the token as a query parameter.
    const detail = data.error?.message || data.errors?.[0]?.message || data.detail || data.title || data.message || `HTTP ${response.status}`;
    throw new PlatformError(String(detail).slice(0, 200));
  }
  return data;
};

const sum = (list) => list.reduce((s, v) => s + (Number(v) || 0), 0);
const num = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const windowStart = () => new Date(Date.now() - WINDOW_DAYS * DAY);
const unix = (d) => Math.floor(d.getTime() / 1000);

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

const metaVersion = () => env("META_GRAPH_VERSION", "v21.0");

/** Sums a Meta insights metric (period=day) over the last 28 days. */
const metaInsightSum = async (base, id, metric, token) => {
  const since = unix(windowStart());
  const until = unix(new Date());
  const data = await getJson(
    `${base}/${id}/insights?metric=${encodeURIComponent(metric)}&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`,
  );
  return sum((data.data?.[0]?.values || []).map((v) => v.value));
};

/**
 * Each platform: env keys, whether it's connected, and fetch() returning
 * { followers, following, posts, impressions, impressionsBasis, engagement }.
 * impressionsBasis "28d" = total over the last 28 days as the API reports it;
 * "lifetime" = an all-time counter (daily figures are the day-to-day change).
 */
export const PLATFORMS = {
  x: {
    name: "X (Twitter)",
    urlKey: "SOCIAL_X_URL",
    credentials: ["X_USERNAME", "X_BEARER_TOKEN"],
    impressionsLabel: "Views on posts from the last 28 days",
    async fetch() {
      const headers = { Authorization: `Bearer ${env("X_BEARER_TOKEN")}` };
      const user = await getJson(
        `https://api.x.com/2/users/by/username/${encodeURIComponent(env("X_USERNAME").replace(/^@/, ""))}?user.fields=public_metrics`,
        { headers },
      );
      const m = user.data?.public_metrics || {};
      let impressions = null;
      let engagement = null;
      try {
        const tweets = await getJson(
          `https://api.x.com/2/users/${user.data.id}/tweets?max_results=100&start_time=${windowStart().toISOString()}&tweet.fields=public_metrics`,
          { headers },
        );
        const list = (tweets.data || []).map((t) => t.public_metrics || {});
        impressions = sum(list.map((t) => t.impression_count));
        engagement = sum(list.map((t) => (t.like_count || 0) + (t.retweet_count || 0) + (t.reply_count || 0) + (t.quote_count || 0)));
      } catch {
        // Post metrics need a higher X API tier; profile totals still count.
      }
      return {
        followers: num(m.followers_count),
        following: num(m.following_count),
        posts: num(m.tweet_count),
        impressions,
        impressionsBasis: "28d",
        engagement,
      };
    },
  },
  instagram: {
    name: "Instagram",
    urlKey: "SOCIAL_INSTAGRAM_URL",
    credentials: ["INSTAGRAM_USER_ID", "META_ACCESS_TOKEN"],
    impressionsLabel: "Accounts reached in the last 28 days",
    async fetch() {
      const base = `https://graph.facebook.com/${metaVersion()}`;
      const id = env("INSTAGRAM_USER_ID");
      const token = env("META_ACCESS_TOKEN");
      const profile = await getJson(`${base}/${id}?fields=followers_count,follows_count,media_count&access_token=${encodeURIComponent(token)}`);
      let impressions = null;
      try {
        impressions = await metaInsightSum(base, id, env("INSTAGRAM_INSIGHT_METRIC", "reach"), token);
      } catch {
        // Insights need instagram_manage_insights; totals still count.
      }
      return {
        followers: num(profile.followers_count),
        following: num(profile.follows_count),
        posts: num(profile.media_count),
        impressions,
        impressionsBasis: "28d",
        engagement: null,
      };
    },
  },
  facebook: {
    name: "Facebook",
    urlKey: "SOCIAL_FACEBOOK_URL",
    credentials: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_TOKEN"],
    impressionsLabel: "Page impressions in the last 28 days",
    async fetch() {
      const base = `https://graph.facebook.com/${metaVersion()}`;
      const id = env("FACEBOOK_PAGE_ID");
      const token = env("FACEBOOK_PAGE_TOKEN");
      const page = await getJson(`${base}/${id}?fields=followers_count,fan_count&access_token=${encodeURIComponent(token)}`);
      let posts = null;
      let impressions = null;
      try {
        const published = await getJson(`${base}/${id}/published_posts?summary=total_count&limit=0&access_token=${encodeURIComponent(token)}`);
        posts = num(published.summary?.total_count);
      } catch {
        // Optional.
      }
      try {
        impressions = await metaInsightSum(base, id, env("FACEBOOK_INSIGHT_METRIC", "page_impressions"), token);
      } catch {
        // Meta renames page metrics from time to time; set FACEBOOK_INSIGHT_METRIC.
      }
      return {
        followers: num(page.followers_count ?? page.fan_count),
        following: null,
        posts,
        impressions,
        impressionsBasis: "28d",
        engagement: null,
      };
    },
  },
  threads: {
    name: "Threads",
    urlKey: "SOCIAL_THREADS_URL",
    credentials: ["THREADS_USER_ID", "THREADS_ACCESS_TOKEN"],
    impressionsLabel: "Views in the last 28 days",
    async fetch() {
      const id = env("THREADS_USER_ID");
      const token = encodeURIComponent(env("THREADS_ACCESS_TOKEN"));
      const base = "https://graph.threads.net/v1.0";
      const followers = await getJson(`${base}/${id}/threads_insights?metric=followers_count&access_token=${token}`);
      let impressions = null;
      try {
        const views = await getJson(
          `${base}/${id}/threads_insights?metric=views&since=${unix(windowStart())}&until=${unix(new Date())}&access_token=${token}`,
        );
        impressions = sum((views.data?.[0]?.values || []).map((v) => v.value));
      } catch {
        // Optional.
      }
      return {
        followers: num(followers.data?.[0]?.total_value?.value),
        following: null,
        posts: null,
        impressions,
        impressionsBasis: "28d",
        engagement: null,
      };
    },
  },
  tiktok: {
    name: "TikTok",
    urlKey: "SOCIAL_TIKTOK_URL",
    credentials: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REFRESH_TOKEN"],
    impressionsLabel: "Views on videos from the last 28 days",
    async fetch() {
      const headers = { Authorization: `Bearer ${await tiktokAccessToken()}`, "Content-Type": "application/json" };
      const info = await getJson("https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count", {
        headers,
      });
      const user = info.data?.user || {};
      let impressions = null;
      let engagement = null;
      try {
        const videos = await getJson("https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,view_count,like_count,comment_count,share_count", {
          method: "POST",
          headers,
          body: JSON.stringify({ max_count: 20 }),
        });
        const recent = (videos.data?.videos || []).filter((v) => v.create_time * 1000 >= windowStart().getTime());
        impressions = sum(recent.map((v) => v.view_count));
        engagement = sum(recent.map((v) => (v.like_count || 0) + (v.comment_count || 0) + (v.share_count || 0)));
      } catch {
        // Needs the video.list scope.
      }
      return {
        followers: num(user.follower_count),
        following: num(user.following_count),
        posts: num(user.video_count),
        impressions,
        impressionsBasis: "28d",
        engagement,
      };
    },
  },
  youtube: {
    name: "YouTube",
    urlKey: "SOCIAL_YOUTUBE_URL",
    credentials: ["YOUTUBE_CHANNEL_ID", "YOUTUBE_API_KEY"],
    impressionsLabel: "Channel views",
    async fetch() {
      const data = await getJson(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(env("YOUTUBE_CHANNEL_ID"))}&key=${encodeURIComponent(env("YOUTUBE_API_KEY"))}`,
      );
      const s = data.items?.[0]?.statistics;
      if (!s) throw new PlatformError("Channel not found. Check YOUTUBE_CHANNEL_ID.");
      return {
        followers: s.hiddenSubscriberCount ? null : num(s.subscriberCount),
        following: null,
        posts: num(s.videoCount),
        impressions: num(s.viewCount),
        impressionsBasis: "lifetime",
        engagement: null,
      };
    },
  },
  linkedin: {
    name: "LinkedIn",
    urlKey: "SOCIAL_LINKEDIN_URL",
    credentials: ["LINKEDIN_ORG_ID", "LINKEDIN_ACCESS_TOKEN"],
    impressionsLabel: "Post impressions",
    async fetch() {
      const urn = encodeURIComponent(`urn:li:organization:${env("LINKEDIN_ORG_ID")}`);
      const headers = {
        Authorization: `Bearer ${env("LINKEDIN_ACCESS_TOKEN")}`,
        "LinkedIn-Version": env("LINKEDIN_API_VERSION", "202410"),
        "X-Restli-Protocol-Version": "2.0.0",
      };
      const size = await getJson(`https://api.linkedin.com/rest/networkSizes/${urn}?edgeType=COMPANY_FOLLOWED_BY_COMPANY`, { headers });
      let impressions = null;
      let engagement = null;
      try {
        const stats = await getJson(
          `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${urn}`,
          { headers },
        );
        const t = stats.elements?.[0]?.totalShareStatistics || {};
        impressions = num(t.impressionCount);
        engagement = num((t.likeCount || 0) + (t.commentCount || 0) + (t.shareCount || 0));
      } catch {
        // Needs r_organization_social.
      }
      return {
        followers: num(size.firstDegreeSize),
        following: null,
        posts: null,
        impressions,
        impressionsBasis: "lifetime",
        engagement,
      };
    },
  },
};

/** Every .env key the module reads, for setup and the dashboard's help text. */
export const SOCIAL_MEDIA_ENV = [
  "SOCIAL_MANAGER_NAME",
  "SOCIAL_MANAGER_START_DATE",
  ...Object.values(PLATFORMS).flatMap((p) => [p.urlKey, ...p.credentials]),
];

// TikTok access tokens last 24 hours and refresh tokens rotate, so the
// latest pair is kept in Firestore; TIKTOK_REFRESH_TOKEN only seeds it.
const tiktokAccessToken = async () => {
  const ref = SocialConfig.doc("tiktok");
  const stored = (await ref.get()).data() || {};
  if (stored.accessToken && stored.expiresAt?.toDate?.() > new Date(Date.now() + 5 * 60000)) return stored.accessToken;
  const body = new URLSearchParams({
    client_key: env("TIKTOK_CLIENT_KEY"),
    client_secret: env("TIKTOK_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken || env("TIKTOK_REFRESH_TOKEN"),
  });
  const data = await getJson("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!data.access_token) throw new PlatformError("TikTok did not return an access token. Reconnect the account.");
  await ref.set(
    {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || stored.refreshToken || null,
      expiresAt: new Date(Date.now() + (Number(data.expires_in) || 86400) * 1000),
      updatedAt: new Date(),
    },
    { merge: true },
  );
  return data.access_token;
};

/** Platforms with their link and whether they can be tracked. */
export const platformConfig = () =>
  Object.entries(PLATFORMS).map(([id, p]) => {
    const missing = p.credentials.filter((key) => !env(key));
    const url = env(p.urlKey) || null;
    return {
      id,
      name: p.name,
      url,
      connected: missing.length === 0,
      configured: Boolean(url) || missing.length < p.credentials.length,
      missing,
      impressionsLabel: p.impressionsLabel,
    };
  });

export const managerConfig = () => {
  const start = env("SOCIAL_MANAGER_START_DATE");
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T00:00:00`) : null;
  return { name: env("SOCIAL_MANAGER_NAME") || null, startDate: startDate && !isNaN(startDate) ? startDate : null };
};

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Fetches every connected platform and saves today's snapshot (one doc per platform per day). */
export const takeSnapshots = async () => {
  const date = localDateKey(new Date());
  const results = await Promise.all(
    platformConfig()
      .filter((p) => p.connected)
      .map(async (p) => {
        const ref = SocialMediaSnapshots.doc(`${p.id}_${date}`);
        try {
          const metrics = await PLATFORMS[p.id].fetch();
          await ref.set({ platform: p.id, date, ...metrics, error: null, fetchedAt: new Date() }, { merge: true });
          return { platform: p.id, ok: true };
        } catch (err) {
          const message = err instanceof PlatformError ? err.message : "Unexpected error while fetching.";
          if (!(err instanceof PlatformError)) console.error(`Social snapshot ${p.id} failed:`, err.message);
          // Keep any figures already saved today; just record the failure.
          await ref.set({ platform: p.id, date, error: message, errorAt: new Date() }, { merge: true });
          return { platform: p.id, ok: false, error: message };
        }
      }),
  );
  return { date, results };
};

const dateKeys = (from, to) => {
  const keys = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) keys.push(localDateKey(new Date(t)));
  return [...new Set(keys)];
};

/** Snapshots per platform from `since` (inclusive), keyed by date. */
const loadSnapshots = async (since) => {
  const snap = await SocialMediaSnapshots.where("date", ">=", localDateKey(since)).get();
  const by = {};
  snap.docs.forEach((d) => {
    const row = d.data();
    (by[row.platform] = by[row.platform] || {})[row.date] = row;
  });
  return by;
};

/** Value on each day, carrying the last known value over days without a snapshot. */
const carry = (days, rows, field) => {
  let last = null;
  return days.map((day) => {
    const v = num(rows?.[day]?.[field]);
    if (v !== null) last = v;
    return last;
  });
};

const growth = (series) => {
  const values = series.filter((v) => v !== null);
  if (values.length < 2) return { start: values[0] ?? null, end: values[values.length - 1] ?? null, change: null, pct: null };
  const start = values[0];
  const end = values[values.length - 1];
  return { start, end, change: end - start, pct: start > 0 ? Math.round(((end - start) / start) * 1000) / 10 : null };
};

/** Followers gained per 30 days and posts per week between two dates, from a daily series. */
const rateBetween = (days, followers, posts, from, to) => {
  const inRange = days.map((d, i) => ({ d, i })).filter(({ d }) => d >= localDateKey(from) && d <= localDateKey(to));
  const pick = (series) => inRange.map(({ i }) => series[i]).filter((v) => v !== null);
  const f = pick(followers);
  const p = pick(posts);
  const span = inRange.length > 1 ? inRange.length - 1 : 0;
  if (f.length < 2 || span < 7) return null;
  return {
    days: span,
    followersPer30Days: Math.round(((f[f.length - 1] - f[0]) / span) * 30),
    postsPerWeek: p.length > 1 ? Math.round(((p[p.length - 1] - p[0]) / span) * 7 * 10) / 10 : null,
  };
};

/**
 * Is the paid manager working? Compares the follower growth rate since
 * SOCIAL_MANAGER_START_DATE with the rate in the 90 days before it.
 */
const scorecard = (days, followers, posts, manager) => {
  if (!manager.startDate) return { status: "not_set" };
  const now = new Date();
  const after = rateBetween(days, followers, posts, manager.startDate, now);
  const before = rateBetween(days, followers, posts, new Date(manager.startDate.getTime() - 90 * DAY), manager.startDate);
  const daysIn = Math.floor((now - manager.startDate) / DAY);
  let verdict;
  if (daysIn < 14 || !after) verdict = "too_early";
  else if (after.followersPer30Days < 0) verdict = "declining";
  else if (!before) verdict = after.followersPer30Days > 0 ? "growing" : "flat";
  else if (after.followersPer30Days > Math.max(0, before.followersPer30Days) * 1.1) verdict = "improving";
  else if (after.followersPer30Days < before.followersPer30Days * 0.9) verdict = "slower";
  else verdict = "flat";
  return { status: "set", name: manager.name, startDate: localDateKey(manager.startDate), daysIn, before, after, verdict };
};

/** Everything the dashboard shows, for the last `days` days. */
export const buildSocialOverview = async ({ days = 90 } = {}) => {
  const range = Math.min(730, Math.max(7, Number(days) || 90));
  const manager = managerConfig();
  const now = new Date();
  // Load enough history for the range and for the manager comparison.
  const earliest = new Date(
    Math.min(now.getTime() - range * DAY, manager.startDate ? manager.startDate.getTime() - 90 * DAY : Infinity),
  );
  const snapshots = await loadSnapshots(earliest);
  const allDays = dateKeys(earliest, now);
  const rangeStart = localDateKey(new Date(now.getTime() - range * DAY));
  const shownFrom = allDays.findIndex((d) => d >= rangeStart);
  const days_ = allDays.slice(shownFrom);

  const platforms = platformConfig().map((p) => {
    const rows = snapshots[p.id] || {};
    const followers = carry(allDays, rows, "followers");
    const posts = carry(allDays, rows, "posts");
    const raw = carry(allDays, rows, "impressions");
    const dates = Object.keys(rows).sort();
    const latest = rows[dates[dates.length - 1]] || null;
    const lifetime = latest?.impressionsBasis === "lifetime";
    // Daily views for lifetime counters; the reported 28-day figure otherwise.
    const impressions = lifetime ? raw.map((v, i) => (i === 0 || v === null || raw[i - 1] === null ? null : Math.max(0, v - raw[i - 1]))) : raw;
    const last28 = lifetime
      ? (() => {
          const end = raw[raw.length - 1];
          const startIdx = Math.max(0, raw.length - 1 - WINDOW_DAYS);
          const start = raw.slice(startIdx).find((v) => v !== null);
          return end !== null && start !== undefined && start !== null ? end - start : null;
        })()
      : latest?.impressions ?? null;
    return {
      ...p,
      lastSnapshotAt: latest?.fetchedAt?.toDate?.()?.toISOString() || null,
      lastError: latest?.error || null,
      current: latest
        ? { followers: num(latest.followers), following: num(latest.following), posts: num(latest.posts), engagement: num(latest.engagement) }
        : null,
      impressions28d: last28,
      impressionsKind: lifetime ? "daily" : "rolling28",
      followersGrowth: growth(followers.slice(shownFrom)),
      postsInRange: growth(posts.slice(shownFrom)).change,
      series: {
        followers: followers.slice(shownFrom),
        posts: posts.slice(shownFrom),
        impressions: impressions.slice(shownFrom),
      },
      scorecard: scorecard(allDays, followers, posts, manager),
      _followersAll: followers,
      _postsAll: posts,
    };
  });

  // Total audience across platforms (each platform counts from its first snapshot).
  const tracked = platforms.filter((p) => p._followersAll.some((v) => v !== null));
  const totalAll = allDays.map((_, i) => {
    const vals = tracked.map((p) => p._followersAll[i]).filter((v) => v !== null);
    return vals.length ? sum(vals) : null;
  });
  const postsAll = allDays.map((_, i) => {
    const vals = tracked.map((p) => p._postsAll[i]).filter((v) => v !== null);
    return vals.length ? sum(vals) : null;
  });

  return {
    generatedAt: now.toISOString(),
    range,
    days: days_,
    manager: { name: manager.name, startDate: manager.startDate ? localDateKey(manager.startDate) : null },
    totals: {
      followers: totalAll[totalAll.length - 1],
      followersGrowth: growth(totalAll.slice(shownFrom)),
      postsInRange: growth(postsAll.slice(shownFrom)).change,
      impressions28d: sum(platforms.map((p) => p.impressions28d)),
      series: totalAll.slice(shownFrom),
      tracked: tracked.length,
      connected: platforms.filter((p) => p.connected).length,
    },
    scorecard: scorecard(allDays, totalAll, postsAll, manager),
    platforms: platforms.map(({ _followersAll, _postsAll, ...rest }) => rest),
  };
};
