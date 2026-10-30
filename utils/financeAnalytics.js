// Finance analytics for the finance and super admin dashboards.
//
// The financial year is measured in three four-month periods:
//   P1 Jan–Apr · P2 May–Aug · P3 Sep–Dec
//
// Money is never summed across currencies: every figure is for one currency
// (the request's ?currency=, else the one most transactions used). Counts
// (orders, subscribers) are currency-free.
//
// Sources: orders (marketplace), transactions (checkout, subscription,
// refund, payout), payment intents (attempts, including failed ones), users
// (subscriptions), operational institutions (school plans and billing).
import {
  ProductOrder,
  Transactions,
  PaymentIntents,
  User,
  OperationalInstitutions,
  TaxEntries,
} from "../tableDeclarations.js";
import { toDate } from "./lectureTime.js";
import { normalizeTier, TIER_LABELS } from "./schoolRoles.js";

export const PERIODS = [
  { id: 1, label: "Jan – Apr", startMonth: 0 },
  { id: 2, label: "May – Aug", startMonth: 4 },
  { id: 3, label: "Sep – Dec", startMonth: 8 },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;
const ABANDONED_AFTER_MS = 60 * 60 * 1000;
export const DUE_SOON_DAYS = 14;
export const BILLING_CYCLES = { monthly: 1, termly: 4, yearly: 12 };

export const currentPeriod = (date = new Date()) => Math.floor(date.getMonth() / 4) + 1;

/** { year, period: 1|2|3|"all" } → bounds and month keys. */
export const periodRange = (year, period) => {
  const all = period === "all";
  const startMonth = all ? 0 : PERIODS[period - 1].startMonth;
  const count = all ? 12 : 4;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + count, 1);
  const months = Array.from({ length: count }, (_, i) => {
    const d = new Date(year, startMonth + i, 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()], start: d, end: new Date(year, startMonth + i + 1, 1) };
  });
  return {
    year,
    period,
    label: all ? `${year} (full year)` : `P${period} ${year} · ${PERIODS[period - 1].label}`,
    start,
    end,
    months,
  };
};

/** Reads ?year=&period= with sane defaults (the current period). */
export const parsePeriod = (query = {}) => {
  const now = new Date();
  const year = Math.min(now.getFullYear() + 1, Math.max(2020, parseInt(query.year, 10) || now.getFullYear()));
  const period = query.period === "all" ? "all" : [1, 2, 3].includes(Number(query.period)) ? Number(query.period) : currentPeriod(now);
  return periodRange(year, period);
};

const previousRange = (range) => {
  if (range.period === "all") return periodRange(range.year - 1, "all");
  return range.period === 1 ? periodRange(range.year - 1, 3) : periodRange(range.year, range.period - 1);
};

const within = (date, range) => !!date && date >= range.start && date < range.end;
const sum = (list, fn) => Math.round(list.reduce((s, x) => s + (Number(fn(x)) || 0), 0) * 100) / 100;
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const fullName = (u) => [u?.firstname, u?.lastname].filter(Boolean).join(" ") || u?.organizationName || u?.username || "Unknown";
const monthIndex = (date, range) => range.months.findIndex((m) => date >= m.start && date < m.end);

const ORDER_GROUPS = {
  completed: ["completed"],
  cancelled: ["cancelled"],
  inProgress: ["pending_delivery", "dropped_off", "cancelling"],
};
export const orderGroup = (status) =>
  Object.keys(ORDER_GROUPS).find((g) => ORDER_GROUPS[g].includes(status)) || "inProgress";

const chunk = (list, size = 30) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
/** Users by uid, for seller and buyer names. */
export const loadUsersById = async (uids) => {
  const unique = [...new Set(uids.filter(Boolean))];
  const snaps = await Promise.all(chunk(unique).map((part) => User.where("uid", "in", part).get()));
  return new Map(snaps.flatMap((s) => s.docs.map((d) => d.data())).map((u) => [u.uid, u]));
};

// ---------------------------------------------------------------------------
// School plans and billing
// ---------------------------------------------------------------------------

/** One institution's plan and billing state, for the school cards. */
export const schoolBillingRow = (doc, now = new Date()) => {
  const billing = doc.billing || {};
  const due = toDate(billing.nextPaymentDue);
  const daysLeft = due ? Math.ceil((due.getTime() - now.getTime()) / DAY) : null;
  const tier = normalizeTier(doc.tier);
  return {
    id: doc.id || doc.schoolCode,
    schoolCode: doc.schoolCode || doc.id,
    name: doc.schoolName || doc.name || doc.id,
    logo: doc.logo || null,
    tier,
    tierLabel: TIER_LABELS[tier],
    amount: Number(billing.amount) || null,
    currency: billing.currency || "NGN",
    cycle: billing.cycle || null,
    nextPaymentDue: due?.toISOString() || null,
    lastPaidAt: toDate(billing.lastPaidAt)?.toISOString() || null,
    daysLeft,
    status: !due ? "not_set" : daysLeft < 0 ? "overdue" : daysLeft <= DUE_SOON_DAYS ? "due_soon" : "active",
    note: billing.note || null,
    createdAt: toDate(doc.createdAt)?.toISOString() || null,
  };
};

const STATUS_ORDER = { overdue: 0, due_soon: 1, active: 2, not_set: 3 };
export const loadSchoolBilling = async () => {
  const snap = await OperationalInstitutions.get();
  return snap.docs
    .map((d) => schoolBillingRow({ id: d.id, ...d.data() }))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
};

/** Next due date after a payment on `from`, by billing cycle. */
export const advanceDueDate = (from, cycle) => {
  const months = BILLING_CYCLES[cycle] || 12;
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next;
};

// ---------------------------------------------------------------------------
// Raw data for a period
// ---------------------------------------------------------------------------

/**
 * Everything the finance screens need for one range. Orders store createdAt
 * as an ISO string, so they're filtered in memory rather than by query.
 */
export const loadFinanceData = async (range) => {
  const prev = previousRange(range);
  const [ordersSnap, txSnap, intentsSnap, subscribersSnap, taxSnap] = await Promise.all([
    ProductOrder.get(),
    Transactions.where("createdAt", ">=", prev.start).where("createdAt", "<", range.end).get(),
    PaymentIntents.where("createdAt", ">=", prev.start).where("createdAt", "<", range.end).get(),
    User.where("isSubscribed", "==", true).get(),
    TaxEntries.where("date", ">=", range.start).where("date", "<", range.end).get(),
  ]);
  const withDate = (d, field = "createdAt") => {
    const data = d.data();
    return { id: d.id, ...data, _date: toDate(data[field]) };
  };
  const allOrders = ordersSnap.docs.map((d) => withDate(d));
  const allTx = txSnap.docs.map((d) => withDate(d));
  const allIntents = intentsSnap.docs.map((d) => withDate(d));
  return {
    range,
    prev,
    orders: allOrders.filter((o) => within(o._date, range)),
    prevOrders: allOrders.filter((o) => within(o._date, prev)),
    transactions: allTx.filter((t) => within(t._date, range)),
    prevTransactions: allTx.filter((t) => within(t._date, prev)),
    intents: allIntents.filter((i) => within(i._date, range)),
    subscribers: subscribersSnap.docs.map((d) => d.data()),
    taxes: taxSnap.docs.map((d) => withDate(d, "date")),
    allOrdersForYear: allOrders.filter((o) => o._date && o._date.getFullYear() === range.year),
  };
};

const orderCurrency = (o) => o.amountPaidCurrencyCode || "NGN";
const txCurrency = (t) => t.currency || "NGN";

const pickCurrency = (data, requested) => {
  const counts = {};
  data.transactions.forEach((t) => (counts[txCurrency(t)] = (counts[txCurrency(t)] || 0) + 1));
  data.orders.forEach((o) => (counts[orderCurrency(o)] = (counts[orderCurrency(o)] || 0) + 1));
  const currencies = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (!currencies.length) currencies.push("NGN");
  const currency = requested && currencies.includes(requested) ? requested : currencies[0];
  return { currency, currencies };
};

const isActiveSubscriber = (u, now) => {
  const exp = toDate(u.subscriptionExpiresAt);
  return u.isSubscribed && (!exp || exp > now) && ["pro", "premium"].includes(u.tier);
};

// ---------------------------------------------------------------------------
// Rows for lists and exports
// ---------------------------------------------------------------------------

export const orderRow = (o, users = new Map()) => ({
  orderId: o.orderId || o.id,
  createdAt: o._date?.toISOString() || null,
  updatedAt: toDate(o.updatedAt)?.toISOString() || null,
  status: o.status || "unknown",
  group: orderGroup(o.status),
  productId: o.productId || null,
  productName: o.productName || "Product",
  quantity: Number(o.quantity) || 1,
  amountPaid: Number(o.amountPaid) || 0,
  deliveryFee: Number(o.deliveryFee) || 0,
  currency: orderCurrency(o),
  deliveryMethod: o.deliveryMethod || null,
  sellerId: o.sellerId || null,
  sellerName: users.get(o.sellerId) ? fullName(users.get(o.sellerId)) : null,
  buyerId: o.buyerId || null,
  buyerName: users.get(o.buyerId) ? fullName(users.get(o.buyerId)) : null,
  cancellationReason: o.cancellationReason || null,
  refundAmount: Number(o.refundAmount) || 0,
});

export const transactionRow = (t, users = new Map()) => ({
  transactionId: t.transactionId || t.id,
  createdAt: t._date?.toISOString() || null,
  type: t.type || "other",
  title: t.title || null,
  amount: Number(t.amount) || 0,
  currency: txCurrency(t),
  status: t.status || "unknown",
  payType: t.payType || null,
  userId: t.userId || null,
  userName: users.get(t.userId) ? fullName(users.get(t.userId)) : null,
  reference: t.reference || null,
  gatewayReference: t.gatewayReference || null,
});

export const intentRow = (i, now = Date.now()) => ({
  txRef: i.txRef || i.id,
  createdAt: i._date?.toISOString() || null,
  purpose: i.purpose || null,
  amount: Number(i.amount) || 0,
  currency: i.currency || "NGN",
  status: i.status === "pending" && now - (i._date?.getTime() || now) > ABANDONED_AFTER_MS ? "abandoned" : i.status,
  failureReason: i.failureReason || null,
  userId: i.userId || null,
  title: i.title || null,
});

export const subscriberRow = (u) => ({
  uid: u.uid,
  name: fullName(u),
  username: u.username || null,
  tier: u.tier,
  subscribedAt: toDate(u.subscriptionDate)?.toISOString() || null,
  expiresAt: toDate(u.subscriptionExpiresAt)?.toISOString() || null,
  daysLeft: toDate(u.subscriptionExpiresAt) ? Math.ceil((toDate(u.subscriptionExpiresAt) - Date.now()) / DAY) : null,
  country: u.country || null,
});

/** Sellers with orders in range, worst cancellation record first. */
export const sellerIssueRows = (orders, users = new Map()) => {
  const by = {};
  orders.forEach((o) => {
    if (!o.sellerId) return;
    const row = (by[o.sellerId] = by[o.sellerId] || { sellerId: o.sellerId, orders: 0, completed: 0, cancelled: 0, reasons: {} });
    row.orders += 1;
    if (o.status === "completed") row.completed += 1;
    if (o.status === "cancelled") {
      row.cancelled += 1;
      const reason = String(o.cancellationReason || "No reason given").trim().slice(0, 80);
      row.reasons[reason] = (row.reasons[reason] || 0) + 1;
    }
  });
  return Object.values(by)
    .map((r) => ({
      ...r,
      name: users.get(r.sellerId) ? fullName(users.get(r.sellerId)) : r.sellerId,
      cancellationRatePct: pct(r.cancelled, r.orders),
      topReason: Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      reasons: undefined,
    }))
    .sort((a, b) => b.cancelled - a.cancelled || (b.cancellationRatePct ?? 0) - (a.cancellationRatePct ?? 0));
};

export const productIssueRows = (orders) => {
  const by = {};
  orders.forEach((o) => {
    const key = o.productId || o.productName;
    if (!key) return;
    const row = (by[key] = by[key] || { productId: o.productId || null, productName: o.productName || "Product", sellerId: o.sellerId, orders: 0, cancelled: 0 });
    row.orders += 1;
    if (o.status === "cancelled") row.cancelled += 1;
  });
  return Object.values(by)
    .filter((r) => r.cancelled > 0)
    .map((r) => ({ ...r, cancellationRatePct: pct(r.cancelled, r.orders) }))
    .sort((a, b) => b.cancelled - a.cancelled || (b.cancellationRatePct ?? 0) - (a.cancellationRatePct ?? 0));
};

// ---------------------------------------------------------------------------
// The overview
// ---------------------------------------------------------------------------

export const buildFinanceOverview = async (query = {}) => {
  const range = parsePeriod(query);
  const data = await loadFinanceData(range);
  const { currency, currencies } = pickCurrency(data, query.currency);
  const now = new Date();
  const inCur = (list, fn) => list.filter((x) => fn(x) === currency);

  const orders = data.orders;
  const ordersCur = inCur(orders, orderCurrency);
  const tx = inCur(data.transactions, txCurrency);
  const prevTx = inCur(data.prevTransactions, txCurrency);
  const byType = (list, type, status = "success") => list.filter((t) => t.type === type && (!status || t.status === status));

  const count = (list, group) => list.filter((o) => orderGroup(o.status) === group).length;
  const activeSubs = data.subscribers.filter((u) => isActiveSubscriber(u, now));
  const newSubsInRange = (r) => data.subscribers.filter((u) => within(toDate(u.subscriptionDate), r)).length;

  // Monthly series within the period.
  const monthly = range.months.map((m) => ({
    month: m.key,
    label: m.label,
    completed: 0,
    cancelled: 0,
    inProgress: 0,
    gmv: 0,
    subscriptionRevenue: 0,
    refunds: 0,
    payouts: 0,
    subscriptions: 0,
  }));
  orders.forEach((o) => {
    const i = monthIndex(o._date, range);
    if (i < 0) return;
    monthly[i][orderGroup(o.status)] += 1;
    if (o.status !== "cancelled" && orderCurrency(o) === currency) monthly[i].gmv += Number(o.amountPaid) || 0;
  });
  tx.forEach((t) => {
    const i = monthIndex(t._date, range);
    if (i < 0 || t.status !== "success") return;
    if (t.type === "subscription") {
      monthly[i].subscriptionRevenue += Number(t.amount) || 0;
      monthly[i].subscriptions += 1;
    } else if (t.type === "refund") monthly[i].refunds += Number(t.amount) || 0;
    else if (t.type === "payout") monthly[i].payouts += Number(t.amount) || 0;
  });
  monthly.forEach((m) => ["gmv", "subscriptionRevenue", "refunds", "payouts"].forEach((k) => (m[k] = Math.round(m[k] * 100) / 100)));

  // Year at a glance: the three periods side by side.
  const comparison = PERIODS.map((p) => {
    const r = periodRange(range.year, p.id);
    const list = data.allOrdersForYear.filter((o) => within(o._date, r));
    return {
      period: p.id,
      label: `P${p.id} · ${p.label}`,
      orders: list.length,
      completed: count(list, "completed"),
      cancelled: count(list, "cancelled"),
      gmv: sum(list.filter((o) => o.status !== "cancelled" && orderCurrency(o) === currency), (o) => o.amountPaid),
      isFuture: r.start > now,
    };
  });

  const reasons = {};
  orders
    .filter((o) => o.status === "cancelled")
    .forEach((o) => {
      const reason = String(o.cancellationReason || "No reason given").trim().slice(0, 60) || "No reason given";
      reasons[reason] = (reasons[reason] || 0) + 1;
    });

  const intents = data.intents.map((i) => intentRow(i, now.getTime()));
  const outcome = (s) => intents.filter((i) => i.status === s).length;

  const subsByTier = ["pro", "premium"].map((t) => ({ tier: t, count: activeSubs.filter((u) => u.tier === t).length }));
  const expiringSoon = activeSubs.filter((u) => {
    const exp = toDate(u.subscriptionExpiresAt);
    return exp && exp.getTime() - now.getTime() <= 7 * DAY;
  }).length;

  const users = await loadUsersById([
    ...orders.map((o) => o.sellerId),
    ...data.transactions.slice(0, 50).map((t) => t.userId),
  ]);
  const schools = await loadSchoolBilling();

  const sellerIssues = sellerIssueRows(orders, users).filter((s) => s.cancelled > 0);
  const recentTransactions = [...data.transactions]
    .sort((a, b) => (b._date?.getTime() || 0) - (a._date?.getTime() || 0))
    .slice(0, 8)
    .map((t) => transactionRow(t, users));

  return {
    generatedAt: now.toISOString(),
    period: { year: range.year, period: range.period, label: range.label, start: range.start.toISOString(), end: range.end.toISOString() },
    previousLabel: data.prev.label,
    periods: PERIODS.map((p) => ({ id: p.id, label: p.label })),
    currency,
    currencies,
    cards: {
      successfulOrders: { current: count(orders, "completed"), previous: count(data.prevOrders, "completed") },
      cancelledOrders: { current: count(orders, "cancelled"), previous: count(data.prevOrders, "cancelled") },
      activeSubscribers: { current: activeSubs.length, newInPeriod: newSubsInRange(range), newInPrevious: newSubsInRange(data.prev) },
    },
    kpis: {
      totalOrders: orders.length,
      inProgressOrders: count(orders, "inProgress"),
      cancellationRatePct: pct(count(orders, "cancelled"), orders.length),
      gmv: sum(ordersCur.filter((o) => o.status !== "cancelled"), (o) => o.amountPaid),
      deliveryFees: sum(ordersCur.filter((o) => o.status !== "cancelled"), (o) => o.deliveryFee),
      averageOrderValue: ordersCur.length ? Math.round((sum(ordersCur, (o) => o.amountPaid) / ordersCur.length) * 100) / 100 : 0,
      subscriptionRevenue: sum(byType(tx, "subscription"), (t) => t.amount),
      previousSubscriptionRevenue: sum(byType(prevTx, "subscription"), (t) => t.amount),
      refunds: sum(byType(tx, "refund"), (t) => t.amount),
      payouts: sum(byType(tx, "payout", null).filter((t) => t.status !== "failed"), (t) => t.amount),
      pendingPayouts: byType(tx, "payout", "pending").length,
      failedPayouts: byType(tx, "payout", "failed").length,
      taxCollected: sum(data.taxes.filter((t) => (t.currency || "NGN") === currency), (t) => t.amount),
      expiringSoon,
    },
    monthly,
    comparison,
    orderStatus: ["completed", "pending_delivery", "dropped_off", "cancelling", "cancelled"].map((s) => ({
      status: s,
      count: orders.filter((o) => o.status === s).length,
    })),
    deliveryMethods: ["drop_off", "home_delivery"].map((m) => ({ method: m, count: orders.filter((o) => o.deliveryMethod === m).length })),
    subscribersByTier: subsByTier,
    paymentOutcomes: [
      { status: "completed", count: outcome("completed") },
      { status: "abandoned", count: outcome("abandoned") },
      { status: "refunded", count: outcome("refunded") },
      { status: "refund_failed", count: outcome("refund_failed") },
      { status: "flagged", count: outcome("flagged") },
    ],
    cancellationReasons: Object.entries(reasons)
      .map(([reason, n]) => ({ reason, count: n }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    sellerIssues: sellerIssues.slice(0, 6),
    productIssues: productIssueRows(orders).slice(0, 6),
    recentTransactions,
    schools: {
      total: schools.length,
      overdue: schools.filter((s) => s.status === "overdue").length,
      dueSoon: schools.filter((s) => s.status === "due_soon").length,
      notSet: schools.filter((s) => s.status === "not_set").length,
      byTier: ["basic", "pro", "enterprise"].map((t) => ({ tier: t, label: TIER_LABELS[t], count: schools.filter((s) => s.tier === t).length })),
      items: schools.slice(0, 6),
    },
  };
};
