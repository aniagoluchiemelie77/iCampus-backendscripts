// Social media admin endpoints (/admins/social/*): the trends dashboard,
// an on-demand refresh and the export. Social media and super admins only.
import { buildSocialOverview, takeSnapshots } from "../utils/socialMedia.js";
import { emailExport } from "../utils/exportService.js";
import { recordAdminActivity } from "../utils/adminActivity.js";

const SOCIAL_ROLES = ["super_admin", "social_media"];
const REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
let lastRefresh = 0;

const requireSocial = (req, res) => {
  if (!SOCIAL_ROLES.includes(req.admin?.adminType)) {
    res.status(403).json({ error: "Only social media and super admins can view this." });
    return false;
  }
  return true;
};

export const getSocialOverview = async (req, res) => {
  if (!requireSocial(req, res)) return;
  try {
    res.json(await buildSocialOverview({ days: req.query.days }));
  } catch (err) {
    console.error("getSocialOverview Error:", err);
    res.status(500).json({ error: "Failed to load social media analytics." });
  }
};

/** Takes today's snapshot now instead of waiting for the nightly run. */
export const refreshSocialStats = async (req, res) => {
  if (!requireSocial(req, res)) return;
  const wait = lastRefresh + REFRESH_COOLDOWN_MS - Date.now();
  if (wait > 0) {
    return res.status(429).json({ error: `Stats were refreshed recently. Try again in ${Math.ceil(wait / 60000)} min.` });
  }
  lastRefresh = Date.now();
  try {
    const result = await takeSnapshots();
    const failed = result.results.filter((r) => !r.ok);
    res.json({
      message: result.results.length
        ? `Updated ${result.results.length - failed.length} of ${result.results.length} accounts.`
        : "No accounts are connected yet. Add their credentials to the backend .env file.",
      ...result,
    });
    recordAdminActivity(req, "social stats refreshed", { platforms: result.results.length, failed: failed.length });
  } catch (err) {
    console.error("refreshSocialStats Error:", err);
    res.status(500).json({ error: "Failed to refresh the stats." });
  }
};

export const exportSocialData = async (req, res) => {
  if (!requireSocial(req, res)) return;
  try {
    const data = await buildSocialOverview({ days: req.body?.days });
    const tracked = data.platforms.filter((p) => p.current);
    const daily = data.days.flatMap((day, i) =>
      tracked.map((p) => ({
        date: day,
        platform: p.name,
        followers: p.series.followers[i],
        posts: p.series.posts[i],
        impressions: p.series.impressions[i],
      })),
    );
    const files = [
      {
        name: "summary",
        rows: data.platforms.map((p) => ({
          platform: p.name,
          url: p.url,
          status: p.connected ? (p.lastError ? `Error: ${p.lastError}` : "Tracking") : p.url ? "Link only" : "Not set up",
          followers: p.current?.followers ?? null,
          change: p.followersGrowth.change,
          pct: p.followersGrowth.pct,
          posts: p.current?.posts ?? null,
          postsInRange: p.postsInRange,
          impressions28d: p.impressions28d,
          impressionsLabel: p.impressionsLabel,
        })),
        columns: [
          { key: "platform", label: "Platform" },
          { key: "url", label: "Profile" },
          { key: "status", label: "Status" },
          { key: "followers", label: "Followers" },
          { key: "change", label: `Follower change (${data.range} days)` },
          { key: "pct", label: "Change %" },
          { key: "posts", label: "Total posts" },
          { key: "postsInRange", label: `Posts in ${data.range} days` },
          { key: "impressions28d", label: "Impressions / views (28 days)" },
          { key: "impressionsLabel", label: "What the impressions figure means" },
        ],
      },
      {
        name: "daily",
        rows: daily,
        columns: [
          { key: "date", label: "Date" },
          { key: "platform", label: "Platform" },
          { key: "followers", label: "Followers" },
          { key: "posts", label: "Posts" },
          { key: "impressions", label: "Impressions / views" },
        ],
      },
    ];
    const s = data.scorecard;
    if (s.status === "set") {
      files.push({
        name: "manager scorecard",
        rows: [
          { metric: "Manager", value: s.name || "—" },
          { metric: "Started", value: s.startDate },
          { metric: "Days in role", value: s.daysIn },
          { metric: "Followers per 30 days before", value: s.before?.followersPer30Days ?? "Not enough history" },
          { metric: "Followers per 30 days since", value: s.after?.followersPer30Days ?? "Not enough history" },
          { metric: "Posts per week before", value: s.before?.postsPerWeek ?? "—" },
          { metric: "Posts per week since", value: s.after?.postsPerWeek ?? "—" },
          { metric: "Verdict", value: s.verdict.replace(/_/g, " ") },
        ],
        columns: [
          { key: "metric", label: "Metric" },
          { key: "value", label: "Value" },
        ],
      });
    }
    const result = await emailExport(req, {
      title: `Social media report · last ${data.range} days`,
      files,
      personalData: false,
      scope: { Range: `${data.days[0]} to ${data.days[data.days.length - 1]}` },
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("exportSocialData Error:", err);
    res.status(500).json({ error: "Failed to prepare the export." });
  }
};
