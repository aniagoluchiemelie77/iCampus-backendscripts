// services/emailTemplates.js
import { theme } from './emailTheme.js';

const { colors, branding, typography } = theme;

// A reusable Wrapper (Header/Footer) to keep it DRY
const emailWrapper = (content) => `
  <div style="background-color: ${colors.background}; padding: 40px 0; font-family: ${typography.fontFamily};">
    <div style="max-width: 600px; margin: 0 auto; background: ${colors.white}; border-radius: 8px; overflow: hidden; border: 1px solid #e1e4e8;">
      <div style="background-color: ${colors.primary}; padding: 20px; text-align: center;">
        <img src="${branding.logoUrl}" alt="${branding.companyName}" style="width: 150px;">
      </div>
      
      <div style="padding: 30px; line-height: 1.6; color: ${colors.text}; font-size: ${typography.fontSize};">
        ${content}
      </div>

      <div style="padding: 20px; text-align: center; font-size: 12px; color: ${colors.muted}; border-top: 1px solid #eee;">
        <p>&copy; ${new Date().getFullYear()} ${branding.companyName}. All rights reserved.</p>
        <p>Visit us at <a href="${branding.websiteUrl}" style="color: ${colors.primary};">${branding.websiteUrl}</a></p>
      </div>
    </div>
  </div>
`;

export const purchaseTemplate = (userName, productName, amount, downloadUrl) => {
  const body = `
    <h2 style="color: ${colors.success}; margin-top: 0;">Purchase Successful!</h2>
    <p>Hi ${userName},</p>
    <p>You have successfully purchased <strong>${productName}</strong>.</p>
    <div style="border: 2px dashed ${colors.primary}; padding: 20px; text-align: center; margin: 20px 0;">
      <span style="font-size: 24px; font-weight: bold; color: ${colors.text};">₦${amount}</span>
    </div>
    ${downloadUrl ? `
      <div style="text-align: center;">
        <a href="${downloadUrl}" style="background-color: ${colors.primary}; color: ${colors.white}; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
          Access Your Digital Product
        </a>
      </div>
    ` : ''}
  `;
  return emailWrapper(body);
};

export const loginAlertTemplate = (userName, ipAddress, time) => {
  const body = `
    <h2 style="color: ${colors.danger}; margin-top: 0;">Security Alert</h2>
    <p>Hello ${userName},</p>
    <p>A new login was detected on your account from an unrecognized IP address.</p>
    <div style="background: #fff5f5; border-left: 4px solid ${colors.danger}; padding: 15px; margin: 20px 0;">
      <strong>Details:</strong><br>
      IP: ${ipAddress}<br>
      Time: ${time}
    </div>
    <p style="font-size: 14px;">If this was not you, please change your password immediately in the <strong>Profile</strong> section of the app.</p>
  `;
  return emailWrapper(body);
};
export const passwordResetSuccessTemplate = (userName, time) => {
  const body = `
    <h2 style="color: ${theme.colors.primary}; margin-top: 0;">Password Changed Successfully</h2>
    <p>Hello ${userName},</p>
    <p>This is a confirmation that the password for your iCampus account was recently changed on <strong>${time}</strong>.</p>
    <div style="background: ${theme.colors.background}; padding: 15px; border-radius: 4px; margin: 20px 0; font-size: 14px;">
      If you did not make this change, please contact our support team immediately at <a href="mailto:${theme.branding.supportEmail}" style="color: ${theme.colors.primary};">${theme.branding.supportEmail}</a>.
    </div>
    <p>For your security, your active sessions on other devices may have been logged out.</p>
  `;
  return emailWrapper(body);
};
// services/emailTemplates.js
export const testCreatedTemplate = (userName, courseCode, testTitle, dueDate) => {
  const body = `
    <h2 style="color: ${theme.colors.primary};">New Assessment Created</h2>
    <p>Hi ${userName},</p>
    <p>A new assessment has been created for your <strong>${courseCode}</strong>.</p>
    
    <div style="background: ${theme.colors.background}; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin: 0;">${testTitle}</h3>
      <p style="color: ${theme.colors.danger}; font-weight: bold;">Due: ${dueDate}</p>
    </div>

    <div style="text-align: center; margin-top: 25px;">
      <a href="${theme.branding.websiteUrl}/assessments" 
         style="background-color: ${theme.colors.primary}; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
        Click to take test
      </a>
    </div>
  `;
  return emailWrapper(body);
};
export const lectureScheduledTemplate = (userName, topic, type, location, time, date) => {
  const isOnline = type === 'Online';
  const body = `
    <h2 style="color: ${theme.colors.primary};">Lecture Scheduled</h2>
    <p>Hi ${userName}, a new ${type} lecture has been set for <strong>${topic}</strong>.</p>
    <p><strong>Time:</strong> ${time}</p>
    <p><strong>Date:</strong> ${date}</p>
    
    ${isOnline ? `
      <div style="margin: 20px 0; text-align: center;">
        <p>You can join the live lecture session using the link below:</p>
        <a href="${location}" style="color: ${theme.colors.primary}; font-weight: bold;">${location}</a>
      </div>
    ` : `
      <p><strong>Location:</strong> ${location}</p>
    `}
  `;
  return emailWrapper(body);
};