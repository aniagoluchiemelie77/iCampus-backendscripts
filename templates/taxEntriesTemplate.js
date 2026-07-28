import PDFDocument from "pdfkit";
import { theme } from "../services/emailTheme.js";

export const generateTaxStatementPDF = async (reportData) => {
  const { colors } = theme;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    const { start, end, totalTaxAmount, history } = reportData;

    try {
      doc.image("../assets/logo.png", 50, 45, { width: 50 });
    } catch (e) {
      doc.rect(50, 45, 50, 50).fill(colors.primary);
    }
    doc.fillColor(colors.primary).fontSize(20).text("iCampus Tax Report", 110, 57);

    doc
      .fontSize(10)
      .fillColor(colors.text)
      .text(`Generated on: ${new Date().toLocaleString()}`, { align: "right" });

    doc.moveDown(2);
    doc.path("M 50 100 L 545 100").stroke(colors.secondary);

    // --- Section 1: User & Period Info ---
    doc.moveDown();
    doc
      .fillColor(colors.text)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Tax Account Details");
    // --- Section 2: Visual Summary Card ---
    doc.moveDown(2);
    doc.font("Helvetica-Bold").text("Financial Summary");

    const chartY = doc.y + 10;
    doc.rect(50, chartY, 500, 50).fill(colors.background || "#f9f9f9");

    doc
      .fillColor(colors.success)
      .fontSize(12)
      .text("TOTAL TAX COLLECTED", 70, chartY + 18);
    doc.fontSize(14).text(`${totalTaxAmount.toLocaleString()} iCash`, 70, chartY + 32);

    // --- Section 3: Tax Entries History Table ---
    doc.moveDown(5);
    doc
      .fillColor(colors.text)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Tax Transactions History");
    doc.moveDown();

    // Table Header
    const tableTop = doc.y;
    doc.fontSize(10).fillColor(colors.textTint || "#666");
    doc.text("Date", 50, tableTop);
    doc.text("Tax Type", 150, tableTop);
    doc.text("Reference ID", 280, tableTop);
    doc.text("Amount", 450, tableTop, { align: "right" });

    doc.moveDown(0.5);
    doc.path(`M 50 ${doc.y} L 545 ${doc.y}`).stroke(colors.secondary);
    doc.moveDown();

    // Table Rows
    history.forEach((tx) => {
      const rowY = doc.y;
      doc.fillColor(colors.textTint || "#333").fontSize(9);

      doc.text(tx.date ? new Date(tx.date).toLocaleDateString() : 'N/A', 50, rowY);
      doc.text(tx.taxType ? tx.taxType.replace('_', ' ').toUpperCase() : 'TAX', 150, rowY, { width: 120 });
      doc.text(tx.transactionReference || "N/A", 280, rowY, { width: 160 });

      doc
        .fillColor(colors.success)
        .text(`${tx.amount.toLocaleString()} iCash`, 450, rowY, { align: "right" });

      doc.moveDown();
      if (doc.y > 750) doc.addPage();
    });

    doc.end();
  });
};