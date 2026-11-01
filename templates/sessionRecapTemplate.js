import PDFDocument from "pdfkit";

export const generateSessionRecapPDF = async ({ user, role, session, stats }) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).fillColor("#f54b02").text("iCampus Academic Session Recap");
    doc.moveDown();
    doc.fontSize(11).fillColor("#333333");
    doc.text(`${user.firstname || ""} ${user.lastname || ""}`.trim() || "Student/Lecturer");
    doc.text(`${role === "lecturer" ? "Lecturer" : "Student"} | Academic session ${session}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`);

    doc.moveDown(2).fontSize(16).fillColor("#222222").text("Your session at a glance");
    doc.moveDown().fontSize(12);
    Object.entries(stats).forEach(([label, value]) => {
      doc.text(`${label}: ${value}`, { continued: false });
    });

    doc.moveDown(2).fontSize(10).fillColor("#666666");
    doc.text(
      "This report is based on course registrations, lectures, attendance records, and assessments recorded in iCampus for this academic session.",
    );
    doc.end();
  });
};
