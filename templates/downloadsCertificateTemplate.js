import PDFDocument from 'pdfkit';
import fs from 'fs';
import { Buffer } from 'node:buffer'; 
import { theme } from "../services/emailTheme.js";

export const generateCertificatePDF = async (composition) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      layout: 'landscape',
      size: 'A4',
      margin: 0,
    });
    const {colors} = theme;

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    // --- Design Section ---

    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40)
       .lineWidth(8)
       .stroke(colors.primary); 

    doc.rect(35, 35, doc.page.width - 70, doc.page.height - 70)
       .lineWidth(1)
       .stroke(colors.secondary);

    // 3. iCampus Brand Header
    doc.fillColor(colors.primary)
       .font('Helvetica-Bold')
       .fontSize(42)
       .text('CERTIFICATE', 0, 100, { align: 'center' });
    
    doc.fontSize(20)
       .letterSpacing(2)
       .text('OF COMPLETION', { align: 'center' });

    // 4. Recipient Section
    doc.moveDown(2);
    doc.fillColor(colors.text)
       .font('Helvetica')
       .fontSize(16)
       .letterSpacing(0)
       .text('This is to officially certify that', { align: 'center' });

    doc.moveDown(1);
    doc.fillColor(colors.primary)
       .font('Helvetica-Bold')
       .fontSize(38)
       .text(composition.studentName, { align: 'center' });

    // 5. Course Achievement Section
    doc.moveDown(1);
    doc.fillColor(colors.text)
       .font('Helvetica')
       .fontSize(16)
       .text('has successfully completed all requirements for', { align: 'center' });

    doc.moveDown(0.5);
    doc.fillColor(colors.primary) 
       .font('Helvetica-Bold')
       .fontSize(24)
       .text(composition.courseTitle, { align: 'center' });

    const footerY = 460;
    
    // Lecturer Signature
    doc.fillColor(colors.text)
       .font('Helvetica')
       .fontSize(12)
       .text('Lecturer(s):', 100, footerY);
    
    doc.font('Helvetica-Bold')
       .text(composition.lecturers.join(', '), 100, footerY + 20);
    doc.moveTo(100, footerY + 35).lineTo(300, footerY + 35).lineWidth(1).stroke(colors.secondary);

    // Date
    doc.font('Helvetica')
       .text('Date of Issue:', 550, footerY);
    doc.font('Helvetica-Bold')
       .text(composition.issueDate, 550, footerY + 20);
    doc.moveTo(550, footerY + 35).lineTo(750, footerY + 35).lineWidth(1).stroke(colors.secondary);

    doc.fontSize(9)
       .fillColor(colors.primary)
       .text(`Verify this certificate at useicampus.edu/verify | ID: ${composition.certificateId}`, 0, 540, { align: 'center' });

    doc.end();
  });
};