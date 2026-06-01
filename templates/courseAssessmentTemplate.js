import PDFDocument from "pdfkit";
import { theme } from "../services/emailTheme";

export const generateTestAnalysisPDF = async (reportData) => {
  const { colors } = theme;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    const { course, test, submissions, absentees, analytics } = reportData;
    // --- BRANDING HEADER ---
    doc.rect(50, 45, 50, 50).fill(colors.primary);
    doc
      .fillColor(colors.primary)
      .fontSize(18)
      .text("iCampus Assessment Report", 110, 50, { font: "Helvetica-Bold" });
    doc
      .fontSize(10)
      .fillColor(colors.textTint)
      .text(`Compiled: ${new Date().toLocaleString()}`, 110, 72);

    doc.moveDown(3);
    doc.path("M 50 110 L 545 110").stroke(colors.secondary);

    // --- METADATA SECTION BOX ---
    doc.moveDown();
    const metaBoxY = doc.y;
    doc.rect(50, metaBoxY, 495, 75).fill(colors.background);

    const metaY = metaBoxY + 10;
    doc.fillColor(colors.text).fontSize(10);
    doc.text(
      `Course: ${course?.courseCode || "N/A"} - ${course?.courseTitle || "Untitled"}`,
      65,
      metaY,
    );
    doc.text(`Assessment: ${test.title}`, 65, metaY + 15);
    doc.text(`Lecturer: ${test.instructorName || "N/A"}`, 65, metaY + 30);
    doc.text(
      `Total Submissions: ${submissions.length} | Pass Rate: ${analytics.passRate}%`,
      65,
      metaY + 45,
    );

    doc.y = metaBoxY + 90;

    doc
      .fillColor(colors.text)
      .fontSize(12)
      .text("Performance Metrics", { font: "Helvetica-Bold" });
    doc.moveDown(0.5);

    const chartX = 50;
    const barMax = 200;

    const pWidth =
      submissions.length > 0
        ? (analytics.passedCount / submissions.length) * barMax
        : 0;
    doc.rect(chartX, doc.y, pWidth, 12).fill(colors.success || "#27ae60");
    doc
      .fillColor(colors.text)
      .fontSize(9)
      .text(`Passed: ${analytics.passedCount}`, chartX + pWidth + 8, doc.y + 1);

    doc.moveDown(1.5);
    const fWidth =
      submissions.length > 0
        ? (analytics.failedCount / submissions.length) * barMax
        : 0;
    doc.rect(chartX, doc.y, fWidth, 12).fill(colors.danger || "#e74c3c");
    doc
      .fillColor(colors.text)
      .fontSize(9)
      .text(`Failed: ${analytics.failedCount}`, chartX + fWidth + 8, doc.y + 1);

    doc.moveDown(2);
    doc
      .fillColor(colors.text)
      .fontSize(12)
      .text("Top Performers", { font: "Helvetica-Bold" });
    doc.moveDown(0.5);

    analytics.topPerformers.forEach((student, index) => {
      const medal = index === 0 ? "🥇 " : index === 1 ? "🥈 " : "🥉 ";
      doc
        .fillColor(colors.text)
        .fontSize(10)
        .text(
          `${medal}${student.studentName} (${student.score}/${test.totalMarks})`,
        );
      doc.moveDown(0.3);
    });

    doc.moveDown(1.5);
    doc
      .fillColor(colors.text)
      .fontSize(12)
      .text("Submission Breakdown", { font: "Helvetica-Bold" });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    doc.fontSize(10).fillColor(colors.textTint);
    doc.text("Matric Number", 50, tableTop);
    doc.text("Student Name", 180, tableTop);
    doc.text("Score", 380, tableTop);
    doc.text("Status", 480, tableTop);

    doc.moveDown(0.5);
    doc.path(`M 50 ${doc.y} L 545 ${doc.y}`).stroke(colors.secondary);
    doc.moveDown();

    const finalRows = submissions.map((sub, i) => ({
      matric: sub.matricNumber || "N/A",
      name: sub.studentName,
      score: `${sub.score} / ${test.totalMarks}`,
      status: sub.score >= test.totalMarks / 2 ? "PASSED" : "FAILED",
      color:
        sub.score >= test.totalMarks / 2
          ? colors.success || "#27ae60"
          : colors.danger || "#e74c3c",
      bgColor: i % 2 === 0 ? colors.background : "#ffffff",
    }));

    finalRows.forEach((row) => {
      const rowY = doc.y;

      if (row.bgColor !== "#ffffff") {
        doc.rect(50, rowY - 4, 495, 18).fill(row.bgColor);
      }

      doc.fillColor(colors.text).fontSize(9);
      doc.text(row.matric, 50, rowY, { width: 120 });
      doc.text(row.name, 180, rowY, { width: 190 });
      doc.text(row.score, 380, rowY, { width: 90 });
      doc
        .fillColor(row.color)
        .text(row.status, 480, rowY, { font: "Helvetica-Bold" });

      doc.moveDown();
      if (doc.y > 750) doc.addPage();
    });

    if (absentees.length > 0) {
      doc.addPage();
      doc
        .fillColor(colors.danger || "#c0392b")
        .fontSize(14)
        .text("Absentees (Did Not Submit)", { font: "Helvetica-Bold" });
      doc.moveDown(0.5);

      const absTop = doc.y;
      doc.fontSize(10).fillColor(colors.textTint);
      doc.text("Matric Number", 50, absTop);
      doc.text("Student Name", 200, absTop);

      doc.moveDown(0.5);
      doc.path(`M 50 ${doc.y} L 545 ${doc.y}`).stroke(colors.secondary);
      doc.moveDown();

      absentees.forEach((student) => {
        const rowY = doc.y;
        doc.fillColor(colors.text).fontSize(9);
        doc.text(student.matricNumber || "N/A", 50, rowY);
        doc.text(`${student.firstname} ${student.lastname}`, 200, rowY);
        doc.moveDown();
        if (doc.y > 750) doc.addPage();
      });
    }

    doc.end();
  });
};
