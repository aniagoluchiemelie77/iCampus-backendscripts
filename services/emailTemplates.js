// services/emailTemplates.js
import { theme } from "./emailTheme.js";

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

export const purchaseTemplate = (
  userName,
  productName,
  amount,
  downloadUrl,
) => {
  const body = `
    <h2 style="color: ${colors.success}; margin-top: 0;">Purchase Successful!</h2>
    <p>Hi ${userName},</p>
    <p>You have successfully purchased <strong>${productName}</strong>.</p>
    <div style="border: 2px dashed ${colors.primary}; padding: 20px; text-align: center; margin: 20px 0;">
      <span style="font-size: 24px; font-weight: bold; color: ${colors.text};">₦${amount}</span>
    </div>
    ${
      downloadUrl
        ? `
      <div style="text-align: center;">
        <a href="${downloadUrl}" style="background-color: ${colors.primary}; color: ${colors.white}; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
          Access Your Digital Product
        </a>
      </div>
    `
        : ""
    }
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
export const testCreatedTemplate = (
  userName,
  courseCode,
  testTitle,
  dueDate,
) => {
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
export const emailVerificationTemplate = (code) => {
  const body = `
    <div style="text-align: center;">
      <h2 style="color: ${theme.colors.primary};">Welcome to iCampus</h2>
      <p>Please use the verification code below to complete your registration:</p>
      
      <div style="background: ${theme.colors.background}; padding: 25px; margin: 20px 0; border: 2px dashed ${theme.colors.primary}; border-radius: 8px;">
        <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: ${theme.colors.primary};">
          ${code}
        </span>
      </div>

      <p style="font-size: 12px; color: #888;">
        This code will expire in 15 minutes. If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;
  return emailWrapper(body);
};

//Still check urls for these templates
export const lectureScheduledTemplate = (
  userName,
  topic,
  type,
  location,
  time,
  date,
) => {
  const isOnline = type === "Online";
  const body = `
    <h2 style="color: ${theme.colors.primary};">Lecture Scheduled</h2>
    <p>Hi ${userName}, a new ${type} lecture has been set for <strong>${topic}</strong>.</p>
    <p><strong>Time:</strong> ${time}</p>
    <p><strong>Date:</strong> ${date}</p>
    
    ${
      isOnline
        ? `
      <div style="margin: 20px 0; text-align: center;">
        <p>You can join the live lecture session using the link below:</p>
        <a href="${location}" style="color: ${theme.colors.primary}; font-weight: bold;">${location}</a>
      </div>
    `
        : `
      <p><strong>Location:</strong> ${location}</p>
    `
    }
  `;
  return emailWrapper(body);
};
export const testAnalysisTemplate = (
  userName,
  testTitle,
  submissions,
  absentees,
  testId,
) => {
  const body = `
    <h2 style="color: ${theme.colors.primary}; margin-top: 0;">Assessment Overview</h2>
    <p>Hi ${userName},</p>
    <p>The automated performance report for <strong>${testTitle}</strong> is now available.</p>
    
    <table style="width: 100%; margin: 20px 0; border-collapse: collapse; background: ${theme.colors.background}; border-radius: 8px; overflow: hidden;">
      <tr>
        <td style="padding: 15px; border-bottom: 1px solid #eee;"><strong>Total Submissions:</strong></td>
        <td style="padding: 15px; border-bottom: 1px solid #eee;">${submissions}</td>
      </tr>
      <tr>
        <td style="padding: 15px;"><strong>Total Absentees:</strong></td>
        <td style="padding: 15px;">${absentees}</td>
      </tr>
    </table>

    <p style="font-size: 14px; color: #666;">
      You can download the full PDF report (including top performers and pass/fail rates) from your lecturer dashboard.
    </p>

    <div style="text-align: center; margin-top: 30px;">
      <a href="${theme.branding.websiteUrl}/lecturer/reports/${testId}" 
         style="background-color: ${theme.colors.primary}; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
        View Detailed Analysis
      </a>
    </div>
  `;
  return emailWrapper(body);
};

export const passwordResetTemplate = (userName, code) => {
  const body = `
    <div style="text-align: center;">
      <h2 style="color: ${theme.colors.primary};">Password Reset Request</h2>
      <p>Hi ${userName}, use the code below to reset your iCampus account password:</p>
      
      <div style="background: #f4f4f4; padding: 20px; margin: 20px 0; border-radius: 8px;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${theme.colors.primary};">
          ${code}
        </span>
      </div>

      <p style="font-size: 13px; color: #666;">
        This code is valid for <strong>12 hours</strong>. If you did not request this, please ignore.
      </p>
    </div>
  `;
  return emailWrapper(body);
};
export const icashPinResetTemplate = (userName, code) => {
  const body = `
    <div style="text-align: center; font-family: sans-serif;">
      <div style="margin-bottom: 20px;">
        <span style="background: ${colors.primary}; color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase;">
          Secure Transaction Service
        </span>
      </div>
      
      <h2 style="color: ${colors.primary}; margin-top: 10px;">iCash PIN Reset</h2>
      
      <p style="color: ${colors.text}; font-size: 15px;">
        Hello ${userName}, we received a request to reset your <strong>iCash Security PIN</strong>. 
        Use the authorization code below to proceed:
      </p>
      
      <div style="background: #fff5f0; border: 1px dashed ${theme.colors.primary}; padding: 25px; margin: 25px 0; border-radius: 12px;">
        <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: ${colors.primary}; font-family: monospace;">
          ${code}
        </span>
      </div>

      <div style="text-align: left; background: #f8fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444;">
        <p style="font-size: 13px; color: ${colors.text}; margin: 0;">
          <strong>Security Alert:</strong> This code will expire in <strong>10 minutes</strong>. 
          If you did not initiate this request, your iCash funds may be at risk. 
          Please change your iCampus password immediately or contact support.
        </p>
      </div>

      <p style="font-size: 12px; color: ${colors.secondary}; margin-top: 30px;">
        Sent securely by iCampus Fintech Division.
      </p>
    </div>
  `;
  return emailWrapper(body);
};
export const iCashPurchaseTemplate = (
  userName,
  amountICash,
  amountLocal,
  currency,
  transactionId,
) => {
  const body = `
    <div style="text-align: center; font-family: sans-serif; max-width: 500px; margin: auto;">
      <div style="margin-bottom: 20px;">
        <span style="background: ${colors.primary}; color: white; padding: 5px 15px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
          Transaction Confirmed
        </span>
      </div>
      
      <h2 style="color: ${colors.primary}; margin-bottom: 5px;">iCash Credited</h2>
      <p style="color: ${colors.text}; font-size: 15px;">Hello ${userName}, your wallet has been credited.</p>

      <div style="background: #f0f9ff; border: 1px solid #bae6fd; padding: 30px; margin: 25px 0; border-radius: 16px;">
        <div style="font-size: 14px; color: ${colors.text}; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Total iCash Added</div>
        <div style="font-size: 42px; font-weight: 800; color: ${colors.primary}">
          ${amountICash.toLocaleString()} 
        </div>
      </div>

      <div style="text-align: left; background: #fafafa; padding: 20px; border-radius: 12px; border: 1px solid #f1f5f9;">
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: ${colors.text};">Amount Paid</td>
            <td style="padding: 8px 0; text-align: right; color: ${colors.text}; font-weight: 600;">${currency} ${amountLocal.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Transaction ID</td>
            <td style="padding: 8px 0; text-align: right; color: #64748b; font-family: monospace;">${transactionId}</td>
          </tr>
        </table>
      </div>

      <p style="font-size: 13px; color: ${colors.secondary}; margin-top: 25px;">
        Your new balance is now updated in your iCash Dashboard. <br/>
        Thank you for choosing <strong>iCampus</strong>.
      </p>
    </div>
  `;
  return emailWrapper(body);
};
export const iCashWithdrawalTemplate = (
  userName,
  amountICash,
  amountLocal,
  currency,
  transactionId,
) => {
  const body = `
    <div style="text-align: center; font-family: sans-serif; max-width: 500px; margin: auto;">
      <div style="margin-bottom: 20px;">
        <span style="background: ${colors.primary}; color: white; padding: 5px 15px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
          Payout Processed
        </span>
      </div>
      
      <h2 style="color: ${colors.primary}; margin-bottom: 5px;">Withdrawal Successful</h2>
      <p style="color: ${colors.text}; font-size: 15px;">Hello ${userName}, your withdrawal request has been completed.</p>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 30px; margin: 25px 0; border-radius: 16px;">
        <div style="font-size: 14px; color: ${colors.text}; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">iCash Debited</div>
        <div style="font-size: 42px; font-weight: 800; color: ${colors.secondary}">
          -${amountICash.toLocaleString()} 
        </div>
      </div>

      <div style="text-align: left; background: #fafafa; padding: 20px; border-radius: 12px; border: 1px solid #f1f5f9;">
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: ${colors.text};">Amount Sent</td>
            <td style="padding: 8px 0; text-align: right; color: ${colors.secondary}; font-weight: 600;">${currency} ${amountLocal.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Transaction ID</td>
            <td style="padding: 8px 0; text-align: right; color: #64748b; font-family: monospace;">${transactionId}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Status</td>
            <td style="padding: 8px 0; text-align: right; color: ${colors.success}; font-weight: bold;">SUCCESS</td>
          </tr>
        </table>
      </div>

      <p style="font-size: 13px; color: ${colors.secondary}; margin-top: 25px;">
        The funds should reflect in your bank account shortly depending on your bank's processing time. <br/>
        Keep building with <strong>iCampus</strong>.
      </p>
    </div>
  `;
  return emailWrapper(body);
};
export const iCashSuccessfulPinResetTemplate = (userName, time) => {
  const body = `
    <div style="text-align: center; font-family: sans-serif; max-width: 500px; margin: auto;">
      <div style="margin-bottom: 20px;">
        <span style="background: #fee2e2; color:${colors.secondary}; padding: 5px 15px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
          Security Update
        </span>
      </div>
      
      <h2 style="color: ${colors.primary}; margin-bottom: 5px;">PIN Successfully Reset</h2>
      <p style="color: ${colors.text}; font-size: 15px;">Hello ${userName}, your <strong>iCash PIN</strong> was changed on ${time}.</p>

      <div style="background: #fff7ed; border: 1px solid #ffedd5; padding: 20px; margin: 25px 0; border-radius: 12px; text-align: left;">
        <p style="margin: 0; font-size: 13px; color: ${colors.text};">
          <strong>Didn't make this change?</strong><br/>
          If you did not authorize this PIN reset, please contact iCampus support immediately or freeze your iCash account from the security settings.
        </p>
      </div>

      <p style="font-size: 13px; color: ${colors.secondary}; margin-top: 25px;">
        Secure transactions are our priority. <br/>
        Thank you for keeping your account safe with <strong>iCampus</strong>.
      </p>
    </div>
  `;
  return emailWrapper(body);
};