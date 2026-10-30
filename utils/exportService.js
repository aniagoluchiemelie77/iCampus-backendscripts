// Data exports for the admin portal, delivered by email as branded Excel
// workbooks (iCampus logo and title banner on every sheet, so a file is never
// mistaken for any other document).
//
// Data protection (NDPR / GDPR):
//   - An export only ever goes to the requesting admin's own account email,
//     never to an address typed into the request, so a hijacked session
//     cannot ship data to an outside inbox.
//   - Columns are chosen per export (data minimisation): no passwords,
//     tokens, phone numbers or bank details are ever included.
//   - Exports that contain personal data are labelled as such in the file,
//     the email and the audit trail, and are capped per admin per hour.
//   - Every export is recorded (who, what, how many rows, when).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { sendEmail } from "../services/emailService.js";
import { theme } from "../services/emailTheme.js";
import { recordAdminActivity } from "./adminActivity.js";

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "logo.png");
let logoBuffer = null;
const loadLogo = () => {
  if (logoBuffer === null) {
    try {
      logoBuffer = fs.readFileSync(LOGO_PATH);
    } catch {
      logoBuffer = false;
    }
  }
  return logoBuffer || null;
};
const BRAND = theme.colors.primary.replace("#", "").toUpperCase();
const ARGB = (hex) => `FF${hex}`;

export const EXPORTS_PER_HOUR = 10;
const MAX_ROWS = 50000;

const cellValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") return JSON.stringify(value);
  // ISO timestamps become real dates so Excel can sort and filter them.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return String(value);
};

/** Excel allows 31 characters and none of []:*?/\ in sheet names. */
const sheetName = (name, used) => {
  let base = String(name || "Sheet").replace(/[[\]:*?/\\-]/g, " ").trim().slice(0, 28) || "Sheet";
  base = base.charAt(0).toUpperCase() + base.slice(1);
  let candidate = base;
  for (let i = 2; used.has(candidate); i++) candidate = `${base} ${i}`;
  used.add(candidate);
  return candidate;
};

/**
 * One workbook, one sheet per file. Each sheet opens with the iCampus banner
 * (logo, report title, who generated it and when, scope, personal-data
 * notice), then the table with a branded header row, filters and frozen panes.
 *
 * @param files  [{ name, rows, columns }]; columns are [{ key, label }] or
 *               [{ label, value: (row) => any }]
 */
export const buildWorkbook = async ({ title, files, personalData, scopeText, generatedBy }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "iCampus Admin Portal";
  workbook.company = theme.branding.companyName;
  workbook.title = title;
  workbook.created = new Date();
  const logo = loadLogo();
  const logoId = logo ? workbook.addImage({ buffer: logo, extension: "png" }) : null;
  const used = new Set();
  const generated = new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Lagos" });

  for (const file of files) {
    const columns = file.columns;
    const width = Math.max(columns.length, 4);
    const sheet = workbook.addWorksheet(sheetName(file.name, used), {
      views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
      pageSetup: { orientation: columns.length > 6 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      headerFooter: { oddFooter: `&L${theme.branding.companyName} · ${title}&RPage &P of &N` },
    });

    // Banner: logo over A1:A4, text from column B.
    for (let r = 1; r <= 4; r++) sheet.getRow(r).height = r === 1 ? 26 : 18;
    if (logoId !== null) sheet.addImage(logoId, { tl: { col: 0.1, row: 0.15 }, ext: { width: 64, height: 64 } });
    const bannerRow = (r, text, font) => {
      sheet.mergeCells(r, 2, r, width);
      const cell = sheet.getCell(r, 2);
      cell.value = text;
      cell.font = font;
      cell.alignment = { vertical: "middle" };
    };
    bannerRow(1, `${theme.branding.companyName} · ${title}`, { size: 16, bold: true, color: { argb: ARGB(BRAND) } });
    bannerRow(2, `Generated ${generated} (WAT) by ${generatedBy}`, { size: 10, color: { argb: "FF666666" } });
    bannerRow(3, scopeText || `${file.rows.length.toLocaleString()} rows`, { size: 10, color: { argb: "FF666666" } });
    bannerRow(
      4,
      personalData ? "CONFIDENTIAL: contains personal data. Store securely and delete when no longer needed." : theme.branding.websiteUrl,
      { size: 9, bold: personalData, italic: !personalData, color: { argb: personalData ? "FFB03A00" : "FF999999" } },
    );
    // Brand rule under the banner.
    for (let c = 1; c <= width; c++) {
      sheet.getCell(5, c).border = { top: { style: "medium", color: { argb: ARGB(BRAND) } } };
    }
    sheet.getRow(5).height = 6;

    // Table.
    const header = sheet.getRow(6);
    columns.forEach((col, i) => {
      const cell = header.getCell(i + 1);
      cell.value = col.label;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(BRAND) } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    header.height = 22;
    file.rows.forEach((row, index) => {
      const added = sheet.addRow(columns.map((col) => cellValue(col.value ? col.value(row) : row[col.key])));
      added.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value instanceof Date) cell.numFmt = "dd mmm yyyy hh:mm";
        if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6F1" } };
      });
    });
    sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: columns.length } };
    columns.forEach((col, i) => {
      const longest = file.rows.slice(0, 500).reduce((max, row) => {
        const v = col.value ? col.value(row) : row[col.key];
        return Math.max(max, String(v ?? "").length);
      }, String(col.label).length);
      // The first column also sits under the logo, so it's never narrower than it.
      sheet.getColumn(i + 1).width = Math.max(i === 0 ? 12 : 8, Math.min(48, longest + 2));
    });
  }
  return workbook.xlsx.writeBuffer();
};

// Per-process sliding window; avoids a composite Firestore index. With several
// instances the effective cap is higher, which is acceptable for a soft limit.
const recentExports = new Map();
const takeExportSlot = (uid) => {
  const since = Date.now() - 60 * 60 * 1000;
  const times = (recentExports.get(uid) || []).filter((t) => t > since);
  if (times.length >= EXPORTS_PER_HOUR) return false;
  recentExports.set(uid, [...times, Date.now()]);
  return true;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * Emails a branded Excel workbook (one sheet per file) to the signed-in admin. Returns
 * { status, body } so controllers can answer with it.
 *
 * @param req   the request (req.admin is the recipient)
 * @param spec  { title, files: [{ name, rows, columns }], personalData, scope }
 */
export const emailExport = async (req, { title, files, personalData = false, scope = {} }) => {
  const admin = req.admin || {};
  if (!admin.email) {
    return { status: 400, body: { error: "Your admin account has no email address to send the export to." } };
  }
  const prepared = files
    .filter((f) => Array.isArray(f.rows))
    .map((f) => ({ ...f, rows: f.rows.slice(0, MAX_ROWS) }));
  const totalRows = prepared.reduce((sum, f) => sum + f.rows.length, 0);
  if (!totalRows) return { status: 400, body: { error: "There is nothing to export for this selection." } };
  if (!takeExportSlot(admin.uid)) {
    return {
      status: 429,
      body: { error: `You can request up to ${EXPORTS_PER_HOUR} exports an hour. Try again later.` },
    };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const name = admin.firstname || "there";
  const scopeLine = Object.entries(scope)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  const scopeText = escapeHtml(scopeLine);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";
  const buffer = await buildWorkbook({
    title,
    files: prepared,
    personalData,
    scopeText: scopeLine,
    generatedBy: [admin.firstname, admin.lastname].filter(Boolean).join(" ") || admin.email,
  });
  const attachments = [
    {
      filename: `icampus-${slug}-${stamp}.xlsx`,
      content: Buffer.from(buffer),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  ];

  await sendEmail({
    to: admin.email,
    subject: `iCampus export: ${title}`,
    text: `Hi ${name}, your export "${title}" (${totalRows} rows) is attached.`,
    html: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 3px solid ${theme.colors.primary}; margin-bottom: 18px;">
        <tr>
          <td style="padding: 0 0 12px 0;">
            <img src="${theme.branding.logoUrl}" alt="${theme.branding.companyName}" width="40" height="40" style="vertical-align: middle; border-radius: 8px;" />
            <span style="font-family: Helvetica, Arial, sans-serif; font-size: 18px; font-weight: bold; color: ${theme.colors.primary}; vertical-align: middle; margin-left: 8px;">${theme.branding.companyName} export</span>
          </td>
        </tr>
      </table>
      <p style="font-family: Helvetica, Arial, sans-serif; font-size: 15px;">Hi <strong>${escapeHtml(name)}</strong>,</p>
      <p style="font-family: Helvetica, Arial, sans-serif; font-size: 15px;">Your export <strong>${escapeHtml(title)}</strong> is attached as an Excel workbook (${totalRows.toLocaleString()} rows${prepared.length > 1 ? ` across ${prepared.length} sheets` : ""}).</p>
      ${scopeText ? `<p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: #666;">${scopeText}</p>` : ""}
      ${
        personalData
          ? `<p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; padding: 12px; background: #fff4ef; border-left: 4px solid #f54b02;">
              This file contains personal data. Store it securely, share it only with people who need it for their work,
              and delete it when you no longer need it. The export has been recorded in the audit log.
            </p>`
          : ""
      }
      <p style="font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #999;">You received this because you requested it from the iCampus admin portal. If you didn't, change your password and contact iCampus.</p>
    `,
    attachments,
  });

  recordAdminActivity(req, "data_exported", {
    title,
    files: prepared.map((f) => ({ name: f.name, rows: f.rows.length })),
    personalData,
    scope,
  });
  return {
    status: 200,
    body: { message: `Sent ${totalRows.toLocaleString()} rows to ${admin.email}.`, rows: totalRows, sentTo: admin.email },
  };
};
