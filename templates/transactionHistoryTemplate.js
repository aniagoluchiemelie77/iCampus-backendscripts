import PDFDocument from "pdfkit";
import { theme } from "../services/emailTheme";

export const generateStatementPDF = async (reportData) => {
  const { colors } = theme;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    const { user, start, end, income, expense, history } = reportData;

    try {
      doc.image("../assets/logo.png", 50, 45, { width: 50 });
    } catch (e) {
      doc.rect(50, 45, 50, 50).fill(colors.primary);
    }
    doc.fillColor(colors.primary).fontSize(20).text("iCash Statement", 110, 57);

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
      .text("Account Holder Details");
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(`Name: ${user.firstname} ${user.lastname}`);
    doc.text(`Reg ID: ${user.regId || "N/A"}`);
    doc.text(`Period: ${start.toDateString()} - ${end.toDateString()}`);

    // --- Section 2: Visual Stats ---
    doc.moveDown(2);
    doc.font("Helvetica-Bold").text("Financial Summary");

    const chartY = doc.y + 10;
    doc.rect(50, chartY, 500, 60).fill(colors.background);

    // Income Text
    doc
      .fillColor(colors.success)
      .fontSize(12)
      .text("TOTAL RECEIVED", 70, chartY + 15);
    doc.fontSize(14).text(`${income.toLocaleString()} iCash`, 70, chartY + 32);

    // Expense Text
    doc
      .fillColor(colors.primary)
      .fontSize(12)
      .text("TOTAL SPENT", 350, chartY + 15);
    doc
      .fontSize(14)
      .text(`${expense.toLocaleString()} iCash`, 350, chartY + 32);

    // --- Section 3: Transactions History Table ---
    doc.moveDown(5);
    doc
      .fillColor(colors.text)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Transactions History");
    doc.moveDown();

    // Table Header
    const tableTop = doc.y;
    doc.fontSize(10).fillColor(colors.textTint);
    doc.text("Date", 50, tableTop);
    doc.text("Description / Recipient", 130, tableTop);
    doc.text("Type", 350, tableTop);
    doc.text("Amount", 450, tableTop, { align: "right" });

    doc.moveDown(0.5);
    doc.path(`M 50 ${doc.y} L 545 ${doc.y}`).stroke(colors.secondary);
    doc.moveDown();

    // Table Rows
    history.forEach((tx) => {
      const rowY = doc.y;
      doc.fillColor(colors.textTint).fontSize(9);

      doc.text(new Date(tx.createdAt).toLocaleDateString(), 50, rowY);
      doc.text(
        tx.receiverName || tx.description || "System Transfer",
        130,
        rowY,
        { width: 200 },
      );
      doc.text(tx.payType === "in" ? "Credit" : "Debit", 350, rowY);

      doc
        .fillColor(tx.payType === "in" ? colors.success : colors.primary)
        .text(
          `${tx.payType === "in" ? "+" : "-"}${tx.amountICash.toLocaleString()}`,
          450,
          rowY,
          { align: "right" },
        );

      doc.moveDown();
      if (doc.y > 750) doc.addPage(); // Handle pagination boundary safely
    });

    doc.end();
  });
};
