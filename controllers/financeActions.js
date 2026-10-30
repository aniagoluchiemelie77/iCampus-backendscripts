// Finance admin endpoints (/admins/finance/*): the four-month-period overview,
// detailed lists, school billing and Excel exports. Finance and super admins only.
import { OperationalInstitutions, User } from "../tableDeclarations.js";
import {
  advanceDueDate,
  BILLING_CYCLES,
  buildFinanceOverview,
  currencyConverter,
  intentRow,
  loadFinanceData,
  loadSchoolBilling,
  loadUsersById,
  orderGroup,
  orderRow,
  parsePeriod,
  productIssueRows,
  schoolBillingRow,
  sellerIssueRows,
  subscriberRow,
  transactionRow,
  withDisplayAmount,
} from "../utils/financeAnalytics.js";
import { emailExport } from "../utils/exportService.js";
import { recordAdminActivity } from "../utils/adminActivity.js";
import { toDate } from "../utils/lectureTime.js";

const FINANCE_ROLES = ["super_admin", "finance"];

const requireFinance = (req, res) => {
  if (!FINANCE_ROLES.includes(req.admin?.adminType)) {
    res.status(403).json({ error: "Only finance administrators can view this." });
    return false;
  }
  return true;
};

const paginate = (list, query) => {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const totalPages = Math.max(1, Math.ceil(list.length / limit));
  const page = Math.min(totalPages, Math.max(1, parseInt(query.page, 10) || 1));
  return { items: list.slice((page - 1) * limit, page * limit), total: list.length, page, totalPages };
};

const matches = (row, q) => !q || JSON.stringify(Object.values(row)).toLowerCase().includes(q.toLowerCase());
const newestFirst = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));

export const getFinanceOverview = async (req, res) => {
  if (!requireFinance(req, res)) return;
  try {
    res.json(await buildFinanceOverview(req.query));
  } catch (err) {
    console.error("getFinanceOverview Error:", err);
    res.status(500).json({ error: "Failed to load finance analytics." });
  }
};

// ---------------------------------------------------------------------------
// Lists ("View all")
// ---------------------------------------------------------------------------

export const FINANCE_SECTIONS = ["transactions", "orders", "sellers", "products", "subscribers", "payments", "schools"];

/** All rows of one section for the requested period and filter. */
const sectionRows = async (section, query) => {
  if (section === "schools") {
    const rows = await loadSchoolBilling();
    const status = String(query.status || "all");
    return rows.filter((r) => status === "all" || r.status === status);
  }
  if (section === "subscribers") {
    const snap = await User.where("isSubscribed", "==", true).get();
    const tier = String(query.status || "all");
    return snap.docs
      .map((d) => subscriberRow(d.data()))
      .filter((r) => (r.daysLeft === null || r.daysLeft >= 0) && ["pro", "premium"].includes(r.tier))
      .filter((r) => tier === "all" || r.tier === tier || (tier === "expiring" && r.daysLeft !== null && r.daysLeft <= 7))
      .sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  }

  const range = parsePeriod(query);
  const data = await loadFinanceData(range);
  const status = String(query.status || "all");
  if (section === "payments") {
    const now = Date.now();
    return data.intents
      .map((i) => intentRow(i, now))
      .filter((r) => (status === "all" ? r.status !== "completed" : r.status === status))
      .sort(newestFirst);
  }
  const users = await loadUsersById([
    ...data.orders.flatMap((o) => [o.sellerId, o.buyerId]),
    ...data.transactions.map((t) => t.userId),
  ]);
  if (section === "transactions") {
    return data.transactions
      .map((t) => transactionRow(t, users))
      .filter((r) => status === "all" || r.type === status)
      .sort(newestFirst);
  }
  if (section === "orders") {
    // "unsuccessful" = cancelled or stuck cancelling.
    return data.orders
      .filter((o) =>
        status === "all"
          ? true
          : status === "unsuccessful"
            ? ["cancelled", "cancelling"].includes(o.status)
            : orderGroup(o.status) === status,
      )
      .map((o) => orderRow(o, users))
      .sort(newestFirst);
  }
  if (section === "sellers") return sellerIssueRows(data.orders, users);
  if (section === "products") return productIssueRows(data.orders);
  return [];
};

export const getFinanceSection = async (req, res) => {
  if (!requireFinance(req, res)) return;
  const { section } = req.params;
  if (!FINANCE_SECTIONS.includes(section)) return res.status(404).json({ error: "Unknown section." });
  try {
    const [rows, converter] = await Promise.all([sectionRows(section, req.query), currencyConverter(req.query.currency)]);
    const q = String(req.query.q || "").trim();
    const range = ["schools", "subscribers"].includes(section) ? null : parsePeriod(req.query);
    const page = paginate(rows.filter((r) => matches(r, q)), req.query);
    res.json({
      ...page,
      // Only this page's rows are converted; the originals stay alongside.
      items: page.items.map((r) => withDisplayAmount(r, converter)),
      section,
      period: range ? { label: range.label, year: range.year, period: range.period } : null,
      conversion: converter.summary(),
    });
  } catch (err) {
    console.error("getFinanceSection Error:", err);
    res.status(500).json({ error: "Failed to load this list." });
  }
};

// ---------------------------------------------------------------------------
// School billing
// ---------------------------------------------------------------------------

export const updateSchoolBilling = async (req, res) => {
  if (!requireFinance(req, res)) return;
  const { id } = req.params;
  try {
    const ref = OperationalInstitutions.doc(String(id));
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Institution not found." });
    const current = doc.data().billing || {};
    const body = req.body || {};
    const billing = { ...current };

    if (body.cycle !== undefined) {
      if (!BILLING_CYCLES[body.cycle]) return res.status(400).json({ error: "Billing cycle must be monthly, termly or yearly." });
      billing.cycle = body.cycle;
    }
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!(amount >= 0)) return res.status(400).json({ error: "Enter a valid amount." });
      billing.amount = Math.round(amount * 100) / 100;
    }
    if (body.currency !== undefined) billing.currency = String(body.currency).toUpperCase().slice(0, 3) || "NGN";
    if (body.note !== undefined) billing.note = String(body.note).slice(0, 300) || null;
    if (body.nextPaymentDue !== undefined) {
      const due = body.nextPaymentDue ? toDate(body.nextPaymentDue) : null;
      if (body.nextPaymentDue && !due) return res.status(400).json({ error: "Enter a valid due date." });
      billing.nextPaymentDue = due;
    }
    // Recording a payment moves the due date on by one cycle from the old
    // due date (or today if none), so paying early doesn't lose time.
    if (body.markPaid) {
      const now = new Date();
      const from = toDate(billing.nextPaymentDue) || now;
      billing.lastPaidAt = now;
      billing.nextPaymentDue = advanceDueDate(from > now ? from : now, billing.cycle || "yearly");
      billing.cycle = billing.cycle || "yearly";
    }
    billing.updatedAt = new Date();
    billing.updatedBy = req.admin.uid;
    await ref.set({ billing }, { merge: true });
    res.json({ message: body.markPaid ? "Payment recorded." : "Billing updated.", school: schoolBillingRow({ id: doc.id, ...doc.data(), billing }) });
    recordAdminActivity(req, body.markPaid ? "school payment recorded" : "school billing updated", {
      schoolId: doc.id,
      schoolName: doc.data().schoolName,
      fields: Object.keys(body),
    });
  } catch (err) {
    console.error("updateSchoolBilling Error:", err);
    res.status(500).json({ error: "Failed to update billing." });
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

const COLUMNS = {
  transactions: [
    { key: "createdAt", label: "Date" },
    { key: "transactionId", label: "Transaction ID" },
    { key: "type", label: "Type" },
    { key: "title", label: "Description" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "status", label: "Status" },
    { key: "payType", label: "Direction" },
    { key: "userName", label: "User" },
    { key: "reference", label: "Reference" },
    { key: "gatewayReference", label: "Gateway reference" },
  ],
  orders: [
    { key: "createdAt", label: "Date" },
    { key: "orderId", label: "Order ID" },
    { key: "status", label: "Status" },
    { key: "productName", label: "Product" },
    { key: "quantity", label: "Quantity" },
    { key: "amountPaid", label: "Amount paid" },
    { key: "deliveryFee", label: "Delivery fee" },
    { key: "currency", label: "Currency" },
    { key: "deliveryMethod", label: "Delivery" },
    { key: "sellerName", label: "Seller" },
    { key: "buyerName", label: "Buyer" },
    { key: "cancellationReason", label: "Cancellation reason" },
    { key: "refundAmount", label: "Refunded" },
  ],
  sellers: [
    { key: "name", label: "Seller" },
    { key: "sellerId", label: "Seller ID" },
    { key: "orders", label: "Orders" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
    { key: "cancellationRatePct", label: "Cancellation rate %" },
    { key: "topReason", label: "Most common reason" },
  ],
  products: [
    { key: "productName", label: "Product" },
    { key: "productId", label: "Product ID" },
    { key: "orders", label: "Orders" },
    { key: "cancelled", label: "Cancelled" },
    { key: "cancellationRatePct", label: "Cancellation rate %" },
  ],
  subscribers: [
    { key: "name", label: "Name" },
    { key: "username", label: "Username" },
    { key: "tier", label: "Plan" },
    { key: "subscribedAt", label: "Subscribed" },
    { key: "expiresAt", label: "Expires" },
    { key: "country", label: "Country" },
  ],
  payments: [
    { key: "createdAt", label: "Date" },
    { key: "txRef", label: "Reference" },
    { key: "purpose", label: "Purpose" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "status", label: "Status" },
    { key: "failureReason", label: "Reason" },
  ],
  schools: [
    { key: "name", label: "Institution" },
    { key: "schoolCode", label: "Code" },
    { key: "tierLabel", label: "Plan" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "cycle", label: "Cycle" },
    { key: "lastPaidAt", label: "Last paid" },
    { key: "nextPaymentDue", label: "Next payment due" },
    { key: "status", label: "Status" },
  ],
};
const PERSONAL = new Set(["transactions", "orders", "sellers", "subscribers"]);
const CONVERTED = new Set(["transactions", "orders", "payments", "schools"]);

export const exportFinanceData = async (req, res) => {
  if (!requireFinance(req, res)) return;
  const requested = Array.isArray(req.body?.sections) ? req.body.sections : [req.body?.section];
  const sections = [...new Set(requested.filter((s) => COLUMNS[s]))];
  if (!sections.length) return res.status(400).json({ error: "Choose what to export." });
  const query = { ...req.body, status: req.body?.status || "all" };
  try {
    const converter = await currencyConverter(req.body?.currency);
    // Money sections get an extra column in the display currency the admin was viewing.
    const files = await Promise.all(
      sections.map(async (section) => {
        const rows = await sectionRows(section, query);
        if (!CONVERTED.has(section)) return { name: section, columns: COLUMNS[section], rows };
        return {
          name: section,
          columns: [...COLUMNS[section], { key: "displayAmount", label: `Amount in ${converter.currency}` }],
          rows: rows.map((r) => withDisplayAmount(r, converter)),
        };
      }),
    );
    const range = parsePeriod(query);
    const result = await emailExport(req, {
      title: sections.length > 1 ? `Finance report · ${range.label}` : `Finance ${sections[0]} · ${range.label}`,
      files,
      personalData: sections.some((s) => PERSONAL.has(s)),
      scope: { Period: range.label, Filter: query.status !== "all" ? query.status : null, "Converted to": converter.currency },
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error("exportFinanceData Error:", err);
    res.status(500).json({ error: "Failed to prepare the export." });
  }
};
