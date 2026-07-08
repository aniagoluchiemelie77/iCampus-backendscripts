import PDFDocument from "pdfkit";
import { theme } from "../services/emailTheme.js";

export const generateAttendancePDF = async (reportData) => {
  const { colors } = theme;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    const { course, lecture, presentStudents, exceptions } = reportData;
    doc.rect(50, 45, 50, 50).fill(colors.primary);
    doc
      .fillColor(colors.primary)
      .fontSize(18)
      .text("iCampus Report Engine", 110, 50, { font: "Helvetica-Bold" });
    doc
      .fontSize(10)
      .fillColor(colors.textTint)
      .text(`Compiled: ${new Date().toLocaleString()}`, 110, 72);

    doc.moveDown(3);
    doc.path("M 50 110 L 545 110").stroke(colors.secondary);

    // Meta Section Box
    doc.moveDown();
    doc.rect(50, doc.y, 495, 65).fill(colors.background);

    const metaY = doc.y + 10;
    doc.fillColor(colors.text).fontSize(10);
    doc.text(
      `Course: ${course?.courseCode || "N/A"} - ${course?.courseTitle || "Untitled"}`,
      65,
      metaY,
    );
    doc.text(
      `Topic: ${lecture?.topicName || "General Session"}`,
      65,
      metaY + 15,
    );
    doc.text(
      `Type: ${lecture?.lectureType || "Physical"} Session`,
      65,
      metaY + 30,
    );
    doc.moveDown(5);
    doc
      .fillColor(colors.text)
      .fontSize(12)
      .text("Verified Attendance Log", { font: "Helvetica-Bold" });
    doc.moveDown();

    const tableTop = doc.y;
    doc.fontSize(10).fillColor(colors.textTint);
    doc.text("Student Name", 50, tableTop);
    doc.text("Matric Number", 220, tableTop);
    doc.text("Department", 360, tableTop);
    doc.text("Status", 480, tableTop);

    doc.moveDown(0.5);
    doc.path(`M 50 ${doc.y} L 545 ${doc.y}`).stroke(colors.secondary);
    doc.moveDown();

    const databaseRows = presentStudents.map((s) => ({
      name: `${s.firstname} ${s.lastname}`,
      matric: s.matricNumber || "N/A",
      dept: s.department || "General",
      status: "Present",
      color: colors.success,
    }));

    const exceptionRows = exceptions.map((e) => ({
      name: e.studentInfo?.fullname || "Excused Student",
      matric: e.studentInfo?.matricNumber || "N/A",
      dept: e.department || "General",
      status: "Exception",
      color: colors.primary,
    }));

    const finalRows = [...databaseRows, ...exceptionRows];

    finalRows.forEach((row) => {
      const rowY = doc.y;
      doc.fillColor(colors.text).fontSize(9);

      doc.text(row.name, 50, rowY, { width: 160 });
      doc.text(row.matric, 220, rowY, { width: 130 });
      doc.text(row.dept, 360, rowY, { width: 110 });

      doc
        .fillColor(row.color)
        .text(row.status, 480, rowY, { font: "Helvetica-Bold" });

      doc.moveDown();
      if (doc.y > 750) doc.addPage();
    });

    doc.end();
  });
};
