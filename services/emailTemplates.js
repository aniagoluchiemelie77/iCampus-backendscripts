// services/emailTemplates.js
import { theme } from "./emailTheme.js";

const { colors, branding, typography } = theme;

const sanitize = (str) => {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};
export const emailWrapper = (content) => `
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
export const welcomeEmailTemplate = (userName) => {
  const body = `
    <p style="font-size: 16px; color: ${colors.text}; line-height: 1.5;">Hello ${userName},</p>
    <p style="font-size: 16px; color: ${colors.text}; line-height: 1.5;">
      We are delighted to welcome you to the iCampus ecosystem. You now have everything you need to manage your academic life, from live-streaming lectures to secure financial transactions via <strong>iCash</strong>.
    </p>
    <div style="text-align: center; margin: 30px 0;">
      <a href=${branding.appDashboardUrl}
         style="background-color: ${colors.primary}; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
         Access Your Dashboard
      </a>
    </div>
    <div style="border-radius: 8px; padding: 25px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: ${colors.primary}; border-bottom: 2px solid ${colors.primary}; display: inline-block; padding-bottom: 5px;">Your Academic Toolkit</h3>
      <ul style="padding-left: 20px; color: ${colors.text}; line-height: 1.8;">
        <li><strong>iCash Wallet:</strong> Manage fees and payments securely.</li>
        <li><strong>Live Lectures:</strong> Real-time streaming and archived sessions.</li>
        <li><strong>Digital ID (iTag):</strong> Your official academic verification.</li>
        <li><strong>Proctoring:</strong> Secure, fair, and automated test environments.</li>
      </ul>
    </div>
    <div style="padding-top: 5px; margin-top: 30px;">
      <p style="font-size: 14px; color: ${colors.textTint};">
        <strong>Security Tip:</strong> Never share your login credentials or iCash transaction PINs with anyone. iCampus staff will never ask for your password.
      </p>
      <p style="font-size: 14px; color: ${colors.textTint};">
        Need assistance? Our support team is ready to help at <a href="mailto:${branding.supportEmailMain}">support@icampus.com</a>.
      </p>
      <p style="font-size: 14px; color: ${colors.secondary}; margin-top: 20px;">
        Best regards,<br><strong>The iCampus Development Team</strong>
      </p>
    </div>
  `;
  return emailWrapper(body);
};
export const loginAlertTemplate = (
  userName,
  ipAddress,
  location,
  date,
  time,
) => {
  const body = `
    <p style="color: ${colors.text}; font-size: 16px; line-height: 1.5;">Hello ${userName},</p>
    <p style="color: ${colors.text}; font-size: 16px; line-height: 1.5;">
      We detected a sign-in to your <strong>iCampus</strong> account from an unrecognized device or location.
    </p>
    <div style="border: 1px solid ${colors.danger}; border-radius: 6px; padding: 20px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: ${colors.danger}; font-size: 16px; margin-bottom: 15px;">Login Details</h3>
      <table style="width: 100%; color: ${colors.text}; font-size: 14px;">
        <tr><td style="padding: 5px 0;"><strong>Date:</strong></td><td>${date}</td></tr>
        <tr><td style="padding: 5px 0;"><strong>Time:</strong></td><td>${time}</td></tr>
        <tr><td style="padding: 5px 0;"><strong>Location:</strong></td><td>${location}</td></tr>
        <tr><td style="padding: 5px 0;"><strong>IP Address:</strong></td><td>${ipAddress}</td></tr>
      </table>
    </div>
    <div style="background: ${theme.colors.background}; padding: 20px; border-radius: 6px; margin-bottom: 20px;">
      <p style="margin-top: 0; font-weight: bold; color: ${colors.text};">Was this you?</p>
      <p style="font-size: 14px; color: ${colors.text}; margin-bottom: 20px;">
        If you recognize this activity, you can safely ignore this email. If this was not you, your account may be at risk.
      </p>
      <p style="margin-top: 20px; font-size: 13px; color: #666;">
        Contact our support team at 
        <a href="mailto:ticket+${userId}${theme.branding.supportEmail}" style="color: ${theme.colors.primary};">
          ${theme.branding.supportEmail}
        </a>
      </p>
    </div>
  `;
  return emailWrapper(body);
};
export const passwordResetSuccessTemplate = (userName, date, time, userId) => {
  const { colors, branding } = theme;
  const supportEmail = branding?.supportEmail || "support@icampus.com";
  const ticketEmail = userId
    ? `ticket+${userId}@${supportEmail.split("@")[1] || supportEmail}`
    : supportEmail;

  const body = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td>
          <p style="color: ${colors.text}; margin: 0 0 15px 0; font-size: 15px; line-height: 1.6;">
            Hello <strong>${userName}</strong>,
          </p>
          <p style="color: ${colors.text}; margin: 0 0 20px 0; font-size: 15px; line-height: 1.6;">
            This email confirms that the password for your <strong>iCampus</strong> account was securely modified on <strong>${date}</strong> at <strong>${time}</strong>.
          </p>
          
          <div style="background-color: ${colors.background || "#f8f9fa"}; border-left: 4px solid ${colors.primary}; padding: 16px 20px; border-radius: 4px; margin: 25px 0;">
            <p style="margin: 0; font-size: 14px; color: ${colors.text}; line-height: 1.5;">
              <strong>Security Notice:</strong> If you initiated this change, no further action is required. However, if you did not authorize this password reset, your account may be compromised. Please contact our security support team immediately.
            </p>
          </div>

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 25px 0;">
            <tr>
              <td>
                <a href="mailto:${ticketEmail}" style="background-color: ${colors.primary}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block; text-align: center;">
                  Secure My Account
                </a>
              </td>
            </tr>
          </table>

          <p style="color: #666666; font-size: 13px; line-height: 1.5; margin-top: 30px; border-top: 1px solid #eaeaea; padding-top: 20px;">
            Need help? Reach out to us directly at 
            <a href="mailto:${ticketEmail}" style="color: ${colors.primary}; text-decoration: underline;">
              ${supportEmail}
            </a>.
          </p>
        </td>
      </tr>
    </table>
  `;
  return emailWrapper(body);
};
export const testCreatedTemplate = (
  userName,
  courseTitle,
  testTitle,
  dueDate,
  date,
  time,
) => {
  const safeUserName = sanitize(userName);
  const safeCourseTitle = sanitize(courseTitle);
  const safeTestTitle = sanitize(testTitle);
  const safeDueDate = sanitize(dueDate);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding: 0 0 16px 0;">
          <p style="color: ${colors.text}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 12px 0;">Hi ${safeUserName},</p>
          <p style="color: ${colors.text}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 20px 0;">A new assessment has been created for your course <strong>${safeCourseTitle}</strong>.</p>
        </td>
      </tr>
      <tr>
        <td style="background-color: ${theme.colors.background}; padding: 20px; border-radius: 8px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td>
                <p style="color: ${colors.text}; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; margin: 0 0 8px 0;">${safeTestTitle}</p>
                <p style="color: ${theme.colors.danger}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; margin: 0;">Due: ${safeDueDate}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding: 20px 0 0 0;">
          <p style="color: ${colors.secondary}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;"><strong>Test Creation Date:</strong> ${safeDate} &bull; ${safeTime}</p>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const emailVerificationTemplate = (code) => {
  const safeCode = sanitize(code);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: center;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 20px 0;">Please use the verification code below to complete your registration:</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="background-color: ${theme.colors.background}; padding: 25px; border: 2px dashed ${theme.colors.primary}; border-radius: 8px;">
                <span style="font-family: Helvetica, Arial, sans-serif; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: ${theme.colors.primary}; display: inline-block;">
                  ${safeCode}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 24px 0 0 0;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 16px; color: #888888; margin: 0;">
                  This code will expire in 15 minutes. If you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const lectureScheduledTemplate = (
  userName,
  topic,
  type,
  location,
  time,
  date,
) => {
  const sanitizeUrl = (url) => {
    if (typeof url !== "string") return "#";
    const trimmed = url.trim();
    if (trimmed.toLowerCase().startsWith("javascript:")) return "#";
    return sanitize(trimmed);
  };

  const safeUserName = sanitize(userName);
  const safeTopic = sanitize(topic);
  const safeType = sanitize(type);
  const safeLocation = sanitize(location);
  const safeUrl = sanitizeUrl(location);
  const safeTime = sanitize(time);
  const safeDate = sanitize(date);

  const isOnline = type === "Online";

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding: 0 0 16px 0;">
          <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px;">Hi ${safeUserName},</p>
          <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">A new ${safeType} lecture has been set for <strong>${safeTopic}</strong>.</p>
        </td>
      </tr>
      <tr>
        <td style="background-color: ${theme.colors.background || "#f9f9f9"}; padding: 16px; border-radius: 8px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding-bottom: 8px;">
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 18px; margin: 0;"><strong>Date:</strong> ${safeDate}</p>
              </td>
            </tr>
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 18px; margin: 0;"><strong>Time:</strong> ${safeTime}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-top: 20px;">
          ${
            isOnline
              ? `
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding-bottom: 12px;">
                    <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">You can join the live lecture session using the button below:</p>
                  </td>
                </tr>
                <tr>
                  <td align="left" style="padding-top: 4px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" bgcolor="${theme.colors.primary}" style="border-radius: 6px;">
                          <a href="${safeUrl}" target="_blank" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; border: 1px solid ${theme.colors.primary}; display: inline-block;">Join Live Lecture</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 12px;">
                    <p style="color: #888888; font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 16px; margin: 0; word-break: break-all;">Or copy and paste this link into your browser: <a href="${safeUrl}" style="color: ${theme.colors.primary}; text-decoration: underline;">${safeUrl}</a></p>
                  </td>
                </tr>
              </table>
            `
              : `
              <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;"><strong>Location:</strong> ${safeLocation}</p>
            `
          }
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const passwordResetTemplate = (userName, code, expiryTime) => {
  const safeUserName = sanitize(userName);
  const safeCode = sanitize(code);
  const safeExpiryTime = sanitize(expiryTime);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: center;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px;">Hi ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 20px 0;">Use the code below to reset your iCampus account password:</p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#f4f4f4" style="background-color: #f4f4f4; padding: 24px; border-radius: 8px;">
                <span style="font-family: Helvetica, Arial, sans-serif; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${theme.colors.primary}; display: inline-block;">
                  ${safeCode}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 24px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${theme.colors.secondary || "#666666"}; margin: 0;">
                  This code is valid for <strong>${safeExpiryTime}</strong>. If you did not request a password reset, please ignore this email or contact support if you have concerns.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const icashPinResetTemplate = (userName, code) => {
  const safeUserName = sanitize(userName);
  const safeCode = sanitize(code);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: center;">
            <tr>
              <td align="center" style="padding-bottom: 16px;">
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="#" style="height:28px;v-text-anchor:middle;width:170px;" arcsize="50%" fillcolor="${colors.primary}" stroke="f">
                  <w:anchorlock/>
                  <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;">Secure Transaction Service</center>
                </v:roundrect>
                <![endif]-->
                <span class="badge" style="background-color: ${colors.primary}; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-family: Helvetica, Arial, sans-serif; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
                  Secure Transaction Service
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px;">
                  Hello ${safeUserName},
                </p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin-vertical: 20px;">
                  We received a request to reset your <strong>iCash Security PIN</strong>. Use the authorization code below to proceed:
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#fff5f0" style="background-color: #fff5f0; border: 1px dashed ${theme.colors.primary}; padding: 24px; border-radius: 12px;">
                <span style="font-family: 'Courier New', Courier, monospace, Helvetica, Arial, sans-serif; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: ${colors.primary}; display: inline-block;">
                  ${safeCode}
                </span>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 24px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border-left: 4px solid #ef4444; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.text || "#333333"}; margin: 0;">
                        <strong>Security Alert:</strong> This code will expire in <strong>10 minutes</strong>. If you did not initiate this request, your iCash funds may be at risk. Please change your iCampus password immediately or contact support.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 30px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 16px; color: ${colors.secondary || "#888888"}; margin: 0;">
                  Sent securely by iCampus Fintech Division.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };

  const safeUserName = sanitize(userName);
  const safeCurrency = sanitize(currency);
  const safeTransactionId = sanitize(transactionId);
  const formattedICash = formatNumber(amountICash);
  const formattedLocal = formatNumber(amountLocal);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: center;">
            <tr>
              <td align="center" style="padding-bottom: 20px;">
                <span style="background-color: ${colors.primary}; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-family: Helvetica, Arial, sans-serif; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; display: inline-block;">
                  Transaction Confirmed
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin-bottom: 20px;">Hello ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin-bottom: 20px;">Your iCash wallet has been successfully credited.</p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#f0f9ff" style="background-color: #f0f9ff; border: 1px solid #bae6fd; padding: 28px; border-radius: 16px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: ${colors.text || "#333333"}; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0;">Total iCash Added</p>
                <span style="font-family: Helvetica, Arial, sans-serif; font-size: 38px; font-weight: 800; color: ${colors.primary}; display: inline-block; line-height: 1;">
                  ${formattedICash}
                </span>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 25px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fafafa; border-radius: 12px; border: 1px solid #f1f5f9;">
                  <tr>
                    <td style="padding: 20px;">
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 8px 0; color: ${colors.text || "#333333"};">Amount Paid</td>
                          <td style="padding: 8px 0; text-align: right; color: ${colors.text || "#333333"}; font-weight: bold;">${safeCurrency} ${formattedLocal}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #edf2f7;">Transaction ID</td>
                          <td style="padding: 8px 0; text-align: right; color: #64748b; font-family: 'Courier New', Courier, monospace; border-top: 1px solid #edf2f7;">${safeTransactionId}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 25px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0;">
                  Your new balance is now updated in your iCash Dashboard.<br />
                  Thank you for choosing <strong>iCampus</strong>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
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
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };

  const safeUserName = sanitize(userName);
  const safeCurrency = sanitize(currency);
  const safeTransactionId = sanitize(transactionId);
  const formattedICash = formatNumber(amountICash);
  const formattedLocal = formatNumber(amountLocal);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: center;">
            <tr>
              <td align="center" style="padding-bottom: 20px;">
                <span style="background-color: ${colors.primary}; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-family: Helvetica, Arial, sans-serif; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; display: inline-block;">
                  Payout Processed
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px;">Hello ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0px 20px;">Your withdrawal request has been completed.</p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#f8fafc" style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 28px; border-radius: 16px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: ${colors.text || "#333333"}; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0;">iCash Debited</p>
                <span style="font-family: Helvetica, Arial, sans-serif; font-size: 38px; font-weight: 800; color: ${colors.secondary}; display: inline-block; line-height: 1;">
                  -${formattedICash}
                </span>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 25px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fafafa; border-radius: 12px; border: 1px solid #f1f5f9;">
                  <tr>
                    <td style="padding: 20px;">
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 8px 0; color: ${colors.text || "#333333"};">Amount Sent</td>
                          <td style="padding: 8px 0; text-align: right; color: ${colors.secondary}; font-weight: bold;">${safeCurrency} ${formattedLocal}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #edf2f7;">Transaction ID</td>
                          <td style="padding: 8px 0; text-align: right; color: #64748b; font-family: 'Courier New', Courier, monospace; border-top: 1px solid #edf2f7;">${safeTransactionId}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #edf2f7;">Status</td>
                          <td style="padding: 8px 0; text-align: right; color: ${colors.success || "#10b981"}; font-weight: bold; border-top: 1px solid #edf2f7;">SUCCESS</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 25px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0;">
                  The funds should reflect in your bank account shortly depending on your bank's processing time.<br />
                  Keep building with <strong>iCampus</strong>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const iCashSuccessfulPinResetTemplate = (userName, time) => {
  const sanitizeEmailHref = (email) => {
    if (typeof email !== "string") return "#";
    const trimmed = email.trim();
    if (trimmed.toLowerCase().startsWith("javascript:")) return "#";
    const safeEmail = sanitize(trimmed);
    return safeEmail.startsWith("mailto:") ? safeEmail : `mailto:${safeEmail}`;
  };

  const safeUserName = sanitize(userName);
  const safeTime = sanitize(time);
  const supportEmailHref = sanitizeEmailHref(branding?.supportEmailMain);
  const supportEmailDisplay = sanitize(branding?.supportEmailMain || "Support");

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: center;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px;">Hello ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0px 20px;">Your iCash PIN was changed on ${safeTime}.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 10px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fff7ed; border: 1px solid #ffedd5; border-radius: 12px;">
                  <tr>
                    <td style="padding: 20px;">
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; color: ${colors.text || "#333333"};">
                        <strong>Didn't make this change?</strong><br />
                        If you did not authorize this PIN reset, please contact <a href="${supportEmailHref}" style="color: ${colors.primary}; text-decoration: underline; font-weight: bold;">${supportEmailDisplay}</a> immediately.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 25px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0;">
                  Secure transactions are our priority.<br />
                  Thank you for keeping your account safe with <strong>iCampus</strong>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const subscriptionUpgradeTemplate = (
  userName,
  tier,
  amount,
  currency,
  transactionId,
) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };
  const sanitizeUrl = (url) => {
    if (typeof url !== "string") return "#";
    const trimmed = url.trim();
    if (trimmed.toLowerCase().startsWith("javascript:")) return "#";
    return sanitize(trimmed);
  };

  const safeUserName = sanitize(userName);
  const safeTier = sanitize(tier);
  const safeCurrency = sanitize(currency);
  const safeTransactionId = sanitize(transactionId);
  const formattedAmount = formatNumber(amount);
  const dashboardUrl = sanitizeUrl(branding?.appDashboardUrl);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: center;">
            <tr>
              <td align="center" style="padding-bottom: 20px;">
                <span style="background-color: ${colors.primary}; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-family: Helvetica, Arial, sans-serif; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; display: inline-block;">
                  Plan Activated
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">Hello ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0px 20px;">Your iCampus account has been successfully upgraded.</p>
              </td>
            </tr>
            <tr>
              <td align="center" bgcolor="#f0fdf4" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 28px; border-radius: 16px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: ${colors.text || "#333333"}; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0;">Active Subscription</p>
                <span style="font-family: Helvetica, Arial, sans-serif; font-size: 34px; font-weight: 800; color: ${colors.primary}; display: inline-block; line-height: 1.1; margin-bottom: 6px;">
                  ${safeTier} Plan
                </span>
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; color: ${colors.secondary || "#666666"}; font-weight: 500; margin: 0;">
                  Full access granted
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 25px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fafafa; border-radius: 12px; border: 1px solid #f1f5f9;">
                  <tr>
                    <td style="padding: 20px;">
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 8px 0; color: ${colors.text || "#333333"};">Plan Tier</td>
                          <td style="padding: 8px 0; text-align: right; color: ${colors.text || "#333333"}; font-weight: bold;">${safeTier}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: ${colors.text || "#333333"}; border-top: 1px solid #edf2f7;">Amount Paid</td>
                          <td style="padding: 8px 0; text-align: right; color: ${colors.text || "#333333"}; font-weight: bold; border-top: 1px solid #edf2f7;">${safeCurrency} ${formattedAmount}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #edf2f7;">Transaction ID</td>
                          <td style="padding: 8px 0; text-align: right; color: #64748b; font-family: 'Courier New', Courier, monospace; border-top: 1px solid #edf2f7;">${safeTransactionId}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #64748b; border-top: 1px solid #edf2f7;">Billing Cycle</td>
                          <td style="padding: 8px 0; text-align: right; color: #64748b; border-top: 1px solid #edf2f7;">Monthly</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 25px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0 0 24px 0;">
                  You now have unlimited access to premium courses and exclusive campus features.<br />
                  Thank you for being part of the <strong>iCampus</strong> community.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" bgcolor="${colors.primary}" style="border-radius: 8px;">
                      <a href="${dashboardUrl}" target="_blank" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; border: 1px solid ${colors.primary}; display: inline-block;">Go to Dashboard</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const newOrderTemplate = (
  buyerName,
  productName,
  amount,
  orderId,
  method,
  stationName,
  stationAddress,
  buyerAddress,
  buyerPhoneNumber,
  date,
  time,
) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };

  const safeBuyerName = sanitize(buyerName);
  const safeProductName = sanitize(productName);
  const formattedAmount = formatNumber(amount);
  const safeOrderId = sanitize(orderId);
  const safeStationName = sanitize(stationName);
  const safeStationAddress = sanitize(stationAddress);
  const safeBuyerAddress = sanitize(buyerAddress || "Check app for address");
  const safeBuyerPhone = sanitize(buyerPhoneNumber);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const isHomeDelivery = method === "home_delivery";

  const instructionBlock = isHomeDelivery
    ? `
      <h3 style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; margin: 0 0 8px 0;">Home Delivery Instructions</h3>
      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 12px 0;">Deliver the item to the buyer's address:</p>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px;">
        <tr>
          <td style="padding: 12px;">
            <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">
              <strong>${safeBuyerAddress}</strong><br />
              Buyer's Phone: <a href="tel:${safeBuyerPhone}" style="color: ${colors.primary}; text-decoration: none;">${safeBuyerPhone}</a>
            </p>
          </td>
        </tr>
      </table>
      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 12px 0 0 0;"><strong>Action:</strong> Once you arrive, you must scan the Order QR code from the buyer's phone to complete the transaction and receive your payment.</p>
    `
    : `
      <h3 style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; margin: 0 0 8px 0;">Station Drop-off Instructions</h3>
      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 12px 0;">Please deliver the item to the following station:</p>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px;">
        <tr>
          <td style="padding: 12px;">
            <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">
              <strong>${safeStationName}</strong><br />
              ${safeStationAddress}
            </p>
          </td>
        </tr>
      </table>
      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 12px 0 0 0;"><strong>Action:</strong> Hand the item to the station agent. The agent will scan the buyer's QR code when they come for pick-up to finalize the payment to both you and the agent.</p>
    `;

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0 20px 0;">Hi there, <strong>${safeBuyerName}</strong> just purchased <strong>${safeProductName}</strong>.</p>
              </td>
            </tr>
            <tr>
              <td bgcolor="#f9f9f9" style="background-color: #f9f9f9; padding: 20px; border-radius: 8px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px;">
                  <tr>
                    <td style="padding-bottom: 8px; color: ${colors.text || "#333333"};">
                      <strong>Order ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">${safeOrderId}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-bottom: 12px; color: ${colors.primary}; font-size: 16px;">
                      <strong>Total Earnings:</strong> ${formattedAmount} iCash
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0 16px 0;">
                      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 0;" />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      ${instructionBlock}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0 0 12px 0;"><strong>Order Creation Date:</strong> ${safeDate} &bull; ${safeTime}</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">Thank you for using iCampus!</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const marketplacePurchaseTemplate = (
  userName,
  productName,
  amount,
  orderId,
  type,
  fileUrl,
  date,
  time,
) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };
  const sanitizeUrl = (url) => {
    if (typeof url !== "string") return "#";
    const trimmed = url.trim();
    if (trimmed.toLowerCase().startsWith("javascript:")) return "#";
    return sanitize(trimmed);
  };

  const safeUserName = sanitize(userName);
  const safeProductName = sanitize(productName);
  const formattedAmount = formatNumber(amount);
  const safeOrderId = sanitize(orderId);
  const safeType = sanitize(type);
  const safeFileUrl = sanitizeUrl(fileUrl);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  let instructions = "";
  if (safeType === "course") {
    instructions = `
      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">This course has been added to your library. You can access it anytime under the <strong>"My Downloads"</strong> section in the iCampus app.</p>
    `;
  } else if (safeType === "physical") {
    instructions = `
      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">Please head to your chosen collection point if it's not home delivery. Present the <strong>QR Code</strong> found in your order details to the seller or agent to collect your item.</p>
    `;
  } else if (safeType === "file") {
    instructions = `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding: 20px 0;">
            <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">Your file is ready for download:</p>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" bgcolor="${colors.primary}" style="border-radius: 5px;">
                  <a href="${safeFileUrl}" target="_blank" style="background-color: ${colors.primary}; color: ${colors.white || "#ffffff"}; padding: 14px 25px; text-decoration: none; border-radius: 5px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; font-size: 14px; display: inline-block; border: 1px solid ${colors.primary};">Download File</a>
                </td>
              </tr>
            </table>
            <p style="font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 16px; color: ${colors.secondary || "#666666"}; margin: 16px 0 0 0;">
              If the button doesn't work, copy and paste this link into your browser:<br />
              <span style="word-break: break-all; color: ${colors.primary};"><a href="${safeFileUrl}" style="color: ${colors.primary}; text-decoration: underline;">${safeFileUrl}</a></span>
            </p>
          </td>
        </tr>
      </table>
    `;
  }

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">Your purchase of <strong>${safeProductName}</strong> was successful.</p>
              </td>
            </tr>
            <tr>
              <td bgcolor="#f8f9fa" style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #edf2f7;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px;">
                  <tr>
                    <td style="padding-bottom: 8px; color: ${colors.text || "#333333"};">
                      <strong>Order ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">#${safeOrderId}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="color: ${colors.primary}; font-size: 15px; font-weight: bold;">
                      <strong>Amount Deducted:</strong> ${formattedAmount} Points
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                ${instructions}
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0 0 12px 0;">View your full receipt and order status in the <strong>Orders</strong> tab of your profile.</p>
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0;"><strong>Debit Date:</strong> ${safeDate} &bull; ${safeTime}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const orderCompletedTemplate = (
  userName,
  productName,
  amount,
  orderId,
  role,
) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };

  const safeUserName = sanitize(userName);
  const safeProductName = sanitize(productName);
  const formattedAmount = formatNumber(amount);
  const safeOrderId = sanitize(orderId);
  const safeRole = sanitize(role);

  const isAgent = safeRole === "agent";

  const roleSpecificMessage = isAgent
    ? `<p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0px;">You have successfully verified the delivery for <strong>${safeProductName}</strong>, and your commission has been credited. Proceed to payout to withdraw to your iCash wallet.</p>`
    : `<p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0px;">The buyer has received <strong>${safeProductName}</strong>. Proceed to payout to withdraw your sales proceeds to your iCash wallet.</p>`;

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 8px 0;">Hi ${safeUserName},</p>
                ${roleSpecificMessage}
              </td>
            </tr>
            <tr>
              <td bgcolor="#f8f9fa" style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border: 1px solid #edf2f7;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 14px;">
                  <tr>
                    <td style="padding-bottom: 8px; color: ${colors.text || "#333333"};">
                      <strong>Order ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">#${safeOrderId}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="color: ${colors.primary}; font-size: 15px; font-weight: bold;">
                      <strong>Amount Credited:</strong> ${formattedAmount} iCash
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #e7f3ff; border: 1px solid #d1e7ff; border-radius: 5px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: ${colors.secondary || "#555555"};">Transaction Finalized</p>
                      <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.text || "#333333"}; margin: 0;">
                        The funds are now available for withdrawal to your iCash wallet.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0;">You can view the breakdown of this transaction in your <strong>Wallet History</strong>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const orderReviewTemplate = (
  userName,
  productName,
  orderId,
  targetId,
  productType = "product",
) => {
  const sanitizeUrl = (url) => {
    if (typeof url !== "string") return "#";
    const trimmed = url.trim();
    if (trimmed.toLowerCase().startsWith("javascript:")) return "#";
    return sanitize(trimmed);
  };

  const safeUserName = sanitize(userName);
  const safeProductName = sanitize(productName);
  const safeOrderId = sanitize(orderId);
  const safeTargetId = sanitize(targetId);
  const safeProductType = sanitize(productType);

  const baseUrl = branding?.appReviewsScreenUrl || "#";
  const rawReviewUrl = `${baseUrl}?productType=${safeProductType}&targetId=${safeTargetId}`;
  const reviewUrl = sanitizeUrl(rawReviewUrl);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">Your order <strong>#${safeOrderId}</strong> for <strong>${safeProductName}</strong> has been marked as completed.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 10px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fff3cd; border-left: 5px solid #ffc107; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: #856404;">Help the Community</p>
                      <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.text || "#333333"}; margin: 0;">
                        Ratings directly impact a seller's <strong>iScore</strong>. By leaving a review, you help other students and staff find reliable items.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 30px 0 20px 0;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" bgcolor="${colors.primary}" style="border-radius: 5px;">
                      <a href="${reviewUrl}" target="_blank" style="background-color: ${colors.primary}; color: #ffffff; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; font-size: 14px; display: inline-block; border: 1px solid ${colors.primary};">Rate Product & Seller</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td>
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0;">What did you think of the purchase process? Open the app to rate the app's delivery method too!</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const orderCancelledEmailTemplate = (
  sellerName,
  productName,
  orderId,
  reason,
  buyerName,
  date,
  time,
) => {
  const safeSellerName = sanitize(sellerName);
  const safeProductName = sanitize(productName);
  const safeOrderId = sanitize(orderId);
  const safeReason = sanitize(reason || "No reason provided");
  const safeBuyerName = sanitize(buyerName);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeSellerName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">
                  The order for <strong>${safeProductName}</strong> (ID: <span style="font-family: 'Courier New', Courier, monospace;">#${safeOrderId}</span>) has been cancelled by the buyer, <strong>${safeBuyerName}</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fff5f5; border-left: 4px solid ${colors.primary}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: ${colors.text || "#333333"};">Reason for Cancellation:</p>
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; font-style: italic; color: ${colors.text || "#333333"};">"${safeReason}"</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border: 1px solid #edf2f7; border-radius: 8px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;">
                        <strong>Inventory Update:</strong> The item has been automatically added back to your stock and is visible in the marketplace again.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0 0 10px 0;"><strong>Order Cancellation Date:</strong> ${safeDate} &bull; ${safeTime}</p>
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;">
                  No further action is required on your part. If you have already dispatched this item, please contact support immediately.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const courseCompletionEmailTemplate = (
  userName,
  productName,
  pdfUrl,
  productId,
  productType = "course",
) => {
  const sanitizeUrl = (url) => {
    if (typeof url !== "string") return "#";
    const trimmed = url.trim();
    if (trimmed.toLowerCase().startsWith("javascript:")) return "#";
    return sanitize(trimmed);
  };

  const safeUserName = sanitize(userName);
  const safeProductName = sanitize(productName);
  const safeProductId = sanitize(productId);
  const safeProductType = sanitize(productType);

  const safePdfUrl = sanitizeUrl(pdfUrl);
  const baseUrl = branding?.appReviewsScreenUrl || "#";
  const rawReviewUrl = `${baseUrl}?productType=${safeProductType}&targetId=${safeProductId}`;
  const safeReviewUrl = sanitizeUrl(rawReviewUrl);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeUserName},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">
                  Huge news! You have officially completed <strong>${safeProductName}</strong>. This is a significant milestone in your learning journey at iCampus.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 20px 0;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" bgcolor="${colors.primary}" style="border-radius: 8px;">
                      <a href="${safePdfUrl}" target="_blank" style="background-color: ${colors.primary}; color: #ffffff; padding: 15px 25px; text-decoration: none; border-radius: 8px; font-family: Helvetica, Arial, sans-serif; font-weight: bold; font-size: 14px; display: inline-block; border: 1px solid ${colors.primary};">Download My Certificate</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 10px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0f7ff; border-left: 4px solid ${colors.secondary || "#3b82f6"}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: ${colors.secondary || "#3b82f6"};">Share the Knowledge:</p>
                      <p style="margin: 0 0 10px 0; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.text || "#333333"};">
                        How was your experience? Your feedback helps the iCampus community grow.
                      </p>
                      <a href="${safeReviewUrl}" target="_blank" style="color: ${colors.primary}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; font-weight: bold; text-decoration: underline;">Leave a Review for this Course</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 25px;">
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">
                  Your hard work is paying off. Keep the momentum going—check your library for your next challenge!
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const salesPayoutTemplate = (
  username,
  amount,
  transactionId,
  date,
  time,
) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };

  const safeUsername = sanitize(username);
  const formattedAmount = formatNumber(amount);
  const safeTransactionId = sanitize(transactionId);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeUsername},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">Your request to move your sales proceeds to your main wallet has been processed. The funds are now available for immediate use.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border: 1px solid #edf2f7; border-radius: 8px;">
                  <tr>
                    <td style="padding: 20px;">
                      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;">Amount Transferred</p>
                      <p style="color: ${colors.primary}; font-family: Helvetica, Arial, sans-serif; font-size: 24px; font-weight: bold; margin: 0 0 12px 0;">${formattedAmount} iCash</p>
                      
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="border-top: 1px solid #edf2f7; padding-top: 12px;">
                            <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; margin: 0;">
                              <strong>Transaction ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">#${safeTransactionId}</span>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fff9e6; border: 1px solid #ffeeba; border-radius: 5px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: ${colors.text || "#333333"};">What can you do now?</p>
                      <ul style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0; padding-left: 20px; color: ${colors.text || "#333333"};">
                        <li style="margin-bottom: 4px;">Purchase course materials or items on the Marketplace.</li>
                        <li style="margin-bottom: 4px;">Send iCash to other users on iCampus.</li>
                        <li>Withdraw funds to your linked bank account or card.</li>
                      </ul>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;"><strong>Payout Date:</strong> ${safeDate} &bull; ${safeTime}</p>
              </td>
            </tr>
            <tr>
              <td align="center">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"};">
                  Thank you for being a part of the <strong>iCampus</strong> sales ecosystem!
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const productCreationTemplate = (
  username,
  productName,
  price,
  productId,
  date,
  time,
) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };

  const safeUsername = sanitize(username);
  const safeProductName = sanitize(productName);
  const formattedPrice = formatNumber(price);
  const safeProductId = sanitize(productId);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeUsername},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">Your product has been approved and is now live on the campus digital marketplace. Other students can view and purchase it immediately.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border: 1px solid #edf2f7; border-radius: 8px;">
                  <tr>
                    <td style="padding: 20px;">
                      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;">Item Details</p>
                      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; margin: 0 0 4px 0;">${safeProductName}</p>
                      <p style="color: ${colors.primary}; font-family: Helvetica, Arial, sans-serif; font-size: 24px; font-weight: bold; margin: 0 0 12px 0;">${formattedPrice} iCash</p>
                      
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="border-top: 1px solid #edf2f7; padding-top: 12px;">
                            <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; margin: 0;">
                              <strong>Product ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">#${safeProductId}</span>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #e8f4fd; border: 1px solid ${colors.secondary || "#3b82f6"}; border-radius: 5px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: ${colors.text || "#333333"};">What happens next?</p>
                      <ul style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0; padding-left: 20px; color: ${colors.text || "#333333"};">
                        <li style="margin-bottom: 4px;">Track your views and sales directly from your seller dashboard.</li>
                        <li style="margin-bottom: 4px;">Once a student purchases this item, earnings will move to your sales wallet.</li>
                        <li>Ensure your item description remains accurate to avoid listing reports.</li>
                      </ul>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;"><strong>Product Creation Date:</strong> ${safeDate} &bull; ${safeTime}</p>
              </td>
            </tr>
            <tr>
              <td align="center">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"};">
                  Thank you for powering the <strong>iCampus</strong> digital marketplace!
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const productUpdateTemplate = (
  username,
  productName,
  price,
  productId,
  date,
  time,
) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || "0") : num.toLocaleString();
  };

  const safeUsername = sanitize(username);
  const safeProductName = sanitize(productName);
  const formattedPrice = formatNumber(price);
  const safeProductId = sanitize(productId);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeUsername},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">Your recent updates to your marketplace listing have been successfully processed and are now live for all users to see.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border: 1px solid #edf2f7; border-radius: 8px;">
                  <tr>
                    <td style="padding: 20px;">
                      <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;">Updated Details</p>
                      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; margin: 0 0 4px 0;">${safeProductName}</p>
                      <p style="color: ${colors.primary}; font-family: Helvetica, Arial, sans-serif; font-size: 24px; font-weight: bold; margin: 0 0 12px 0;">${formattedPrice} iCash</p>
                      
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="border-top: 1px solid #edf2f7; padding-top: 12px;">
                            <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; margin: 0;">
                              <strong>Product ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">#${safeProductId}</span>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #eafaf1; border: 1px solid ${colors.secondary || "#3b82f6"}; border-radius: 5px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: ${colors.text || "#333333"};">What should you check?</p>
                      <ul style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0; padding-left: 20px; color: ${colors.text || "#333333"};">
                        <li style="margin-bottom: 4px;">Review your product page in the app to ensure formatting looks correct.</li>
                        <li style="margin-bottom: 4px;">If you updated stock amounts or addresses, double-check your dashboard metrics.</li>
                        <li>Active carts containing this item have been automatically updated with your new price.</li>
                      </ul>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;"><strong>Product Update Date:</strong> ${safeDate} &bull; ${safeTime}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top: 10px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.secondary || "#666666"}; margin: 0;">
                  Thank you for maintaining an active presence in the <strong>iCampus</strong> digital marketplace!
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const productDeletionTemplate = (
  username,
  productName,
  productId,
  date,
  time,
) => {
  const safeUsername = sanitize(username);
  const safeProductName = sanitize(productName);
  const safeProductId = sanitize(productId);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi ${safeUsername},</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">This is confirmation that your marketplace listing has been removed from the platform on <strong>${safeDate}</strong> at <strong>${safeTime}</strong>.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border: 1px solid #edf2f7; border-left: 4px solid ${colors.primary}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 4px 0;">Removed Product Details</p>
                      <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; margin: 0 0 12px 0;">${safeProductName}</p>
                      
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td style="border-top: 1px solid #edf2f7; padding-top: 12px;">
                            <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; margin: 0 0 4px 0;">
                              <strong>Product ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">#${safeProductId}</span>
                            </p>
                            <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;">
                              <strong>Product Deletion Date:</strong> ${safeDate} &bull; ${safeTime}
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const orderDroppedOffEmailTemplate = (
  userName,
  productName,
  orderId,
  stationName,
  stationAddress,
) => {
  const safeUserName = sanitize(userName);
  const safeProductName = sanitize(productName);
  const safeOrderId = sanitize(orderId);
  const safeStationName = sanitize(stationName);
  const safeStationAddress = sanitize(stationAddress);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi <strong>${safeUserName}</strong>,</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">The seller has dropped off your purchase of <strong>${safeProductName}</strong> at your selected station hub.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${colors.background || "#f8f9fa"}; border: 1px solid #edf2f7; border-left: 4px solid ${colors.primary}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 4px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${colors.text || "#333333"};"><strong>Collection Station:</strong> ${safeStationName}</p>
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.text || "#333333"};">${safeStationAddress}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; font-weight: bold; color: ${colors.text || "#333333"};">Next Step:</p>
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.text || "#333333"};">
                        Go to the station and present your order's <strong>QR Code</strong> to the agent. Once scanned, your item will be released and finalized.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="font-family: Helvetica, Arial, sans-serif; font-size: 12px; line-height: 16px; color: ${colors.secondary || "#666666"}; margin: 0;">
                  Order Reference: <span style="font-family: 'Courier New', Courier, monospace;">#${safeOrderId}</span>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const agentAwaitingPickupEmailTemplate = (
  agentName,
  productName,
  orderId,
  stationName,
  date,
  time,
) => {
  const safeAgentName = sanitize(agentName);
  const safeProductName = sanitize(productName);
  const safeOrderId = sanitize(orderId);
  const safeStationName = sanitize(stationName);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi <strong>${safeAgentName}</strong>,</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 20px 0;">A seller has just dropped off <strong>${safeProductName}</strong> at your hub location (<strong>${safeStationName}</strong>).</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border: 1px solid #edf2f7; border-radius: 8px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 4px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${colors.text || "#333333"};"><strong>Order ID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">#${safeOrderId}</span></p>
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${colors.text || "#333333"};"><strong>Current Status:</strong> Awaiting Buyer Collection</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0 0 10px 0;"><strong>Action Required:</strong> Safe-keep this package. When the buyer arrives to pick it up, scan their mobile app tracking QR code to confirm checkout and release your delivery split commission.</p>
                <p style="color: ${colors.secondary || "#666666"}; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; margin: 0;"><strong>Product Drop-off Date:</strong> ${safeDate} &bull; ${safeTime}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const newAdminWelcomeTemplate = (adminName, creatorName) => {
  const safeAdminName = sanitize(adminName);
  const safeCreatorName = sanitize(creatorName);

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 5px 0;">Hi <strong>${safeAdminName}</strong>,</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 15px; line-height: 20px; margin: 0 0 16px 0;">Your iCampus administrator account has been successfully created by <strong>${safeCreatorName}</strong>.</p>
                <p style="color: ${colors.text || "#333333"}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 18px; margin: 0 0 20px 0;">You can now log in to the admin dashboard to begin managing iCampus operations.</p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border: 1px solid #edf2f7; border-left: 4px solid ${colors.primary}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 13px; line-height: 18px; color: ${colors.text || "#333333"};">
                        <strong>Stay Secure:</strong> Always ensure you are accessing the dashboard through the official iCampus admin portal.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const supportTicketReceivedTemplate = (
  userName,
  ticketRefId,
  date,
  time,
) => {
  const safeUserName = sanitize(userName);
  const safeTicketRefId = sanitize(ticketRefId);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const primaryColor = theme?.colors?.primary || "#3b82f6";
  const bgColor = theme?.colors?.background || "#f8f9fa";
  const textColor = colors?.text || "#333333";

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 5px 0;">Hello ${safeUserName},</p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">
                  We have successfully received your support request. Our team is currently reviewing the details and will get back to you shortly.
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${bgColor}; border: 1px solid #edf2f7; border-radius: 4px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};">
                        <strong>Ticket Reference ID:</strong> <span style="color: ${primaryColor}; font-weight: bold; font-family: 'Courier New', Courier, monospace;">#${safeTicketRefId}</span>
                      </p>
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};">
                        <strong>Received:</strong> ${safeDate} at ${safeTime}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">
                  We aim to respond to all inquiries within <strong>24 hours</strong>. You can reply directly to this email if you have any additional information to add.
                </p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">Thank you for your patience.</p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">Best regards,<br><strong>iCampus Support Team</strong></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const supportTicketResolvedTemplate = (
  userName,
  ticketRefId,
  date,
  time,
) => {

  const safeUserName = sanitize(userName);
  const safeTicketRefId = sanitize(ticketRefId);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const primaryColor = theme?.colors?.primary || '#3b82f6';
  const bgColor = theme?.colors?.background || '#f8f9fa';
  const textColor = colors?.text || '#333333';

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 5px 0;">Hello ${safeUserName},</p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">
                  Good news! We have successfully resolved your support request. 
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${bgColor}; border: 1px solid #edf2f7; border-radius: 4px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};">
                        <strong>Ticket Reference ID:</strong> <span style="color: ${primaryColor}; font-weight: bold; font-family: 'Courier New', Courier, monospace;">#${safeTicketRefId}</span>
                      </p>
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};">
                        <strong>Resolved On:</strong> ${safeDate} at ${safeTime}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">
                  If you are still experiencing issues or need further assistance regarding this matter, please feel free to reach out and open a new ticket or reply directly to this email. We are always here to help.
                </p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">Thank you for your patience and for being part of our community.</p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;">Best regards,<br><strong>iCampus Support Team</strong></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const supportTicketReplyTemplate = (
  userName,
  ticketRefId,
  adminMessage,
  date,
  time,
) => {

  const safeUserName = sanitize(userName);
  const safeTicketRefId = sanitize(ticketRefId);
  const safeAdminMessage = sanitize(adminMessage);
  const safeDate = sanitize(date);
  const safeTime = sanitize(time);

  const primaryColor = theme?.colors?.primary || '#3b82f6';
  const bgColor = theme?.colors?.background || '#f8f9fa';
  const textColor = colors?.text || '#333333';

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 5px 0;">Hello ${safeUserName},</p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">
                  Our support team has reviewed your inquiry and posted an update regarding your open ticket.
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${bgColor}; border-left: 4px solid ${primaryColor}; border-radius: 0 4px 4px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 13.5px; line-height: 20px; margin: 0; white-space: pre-wrap;">
                        ${safeAdminMessage}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${bgColor}; border: 1px solid #edf2f7; border-radius: 4px;">
                  <tr>
                    <td style="padding: 12px 15px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};">
                        <strong>Ticket Reference ID:</strong> <span style="color: ${primaryColor}; font-weight: bold; font-family: 'Courier New', Courier, monospace;">#${safeTicketRefId}</span>
                      </p>
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};">
                        <strong>Updated:</strong> ${safeDate} at ${safeTime}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top: 20px;">
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 16px 0;">
                  If this resolves your issue, no further action is required. If you need clarification or additional help, simply reply directly to this email to update the support thread.
                </p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0 0 4px 0;">Best regards,</p>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 0;"><strong>iCampus Support Team</strong></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const suspiciousPasswordChangeTemplate = (payload, isSuspicious) => {
  const safeUserEmail = sanitize(payload?.userEmail);
  const safeUserUid = sanitize(payload?.userUid);
  const safeCurrentLocation = sanitize(payload?.currentLocation);
  const safePreviousLocation = sanitize(payload?.previousLocation);

  const dangerColor = theme?.colors?.danger || '#ef4444';
  const warningColor = theme?.colors?.warning || '#f59e0b';
  const textColor = theme?.colors?.text || '#333333';
  const bgColor = theme?.colors?.background || '#f8f9fa';

  const alertColor = isSuspicious ? dangerColor : warningColor;
  const alertTitle = isSuspicious
    ? "Critical Security Alert"
    : "Password Change Audit";

  const boxBgColor = isSuspicious ? "#fff5f5" : "#fffcf0";

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 5px 0 16px 0;">
                  Attention Admin, a password change has been recorded for the following user:
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${boxBgColor}; border: 1px solid #edf2f7; border-left: 4px solid ${alertColor}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};"><strong>Account Details:</strong></p>
                      <ul style="list-style: none; padding: 0; margin: 0 0 12px 0; font-family: Helvetica, Arial, sans-serif; font-size: 13.5px; line-height: 20px; color: ${textColor};">
                        <li style="margin: 0 0 4px 0;"><strong>User Email:</strong> ${safeUserEmail}</li>
                        <li style="margin: 0;"><strong>User UID:</strong> <span style="font-family: 'Courier New', Courier, monospace;">${safeUserUid}</span></li>
                      </ul>
                      
                      <p style="margin: 0 0 6px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};"><strong>Location Tracking:</strong></p>
                      <ul style="list-style: none; padding: 0; margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 13.5px; line-height: 20px; color: ${textColor};">
                        <li style="margin: 0 0 4px 0;"><strong>Current:</strong> ${safeCurrentLocation}</li>
                        <li style="margin: 0;"><strong>Previous:</strong> ${safePreviousLocation}</li>
                      </ul>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${bgColor}; border-radius: 4px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; color: ${textColor};">
                        <strong>Action Required:</strong> Please review this activity in the admin dashboard. 
                        If this change was unauthorized, consider resetting the user's sessions immediately.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const financialSecurityAlertTemplate = (payload) => {
  const formatNumber = (val) => {
    const num = Number(val);
    return isNaN(num) ? String(val || '0') : num.toLocaleString();
  };

  const safeUserId = sanitize(payload?.userId);
  const formattedAttemptedAmount = formatNumber(payload?.attemptedAmount);
  const formattedExpectedAmount = formatNumber(payload?.expectedAmount);
  const safeIpAddress = sanitize(payload?.ipAddress);

  const dangerColor = theme?.colors?.danger || '#ef4444';
  const textColor = theme?.colors?.text || '#333333';
  const bgColor = theme?.colors?.background || '#f8f9fa';

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 5px 0 16px 0;">
                  A discrepancy has been detected in a financial transaction requiring immediate administrative review.
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fff5f5; border: 1px solid #edf2f7; border-left: 4px solid ${dangerColor}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 10px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};"><strong>Transaction Discrepancy:</strong></p>
                      
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 13.5px; line-height: 20px; color: ${textColor};">
                        <tr>
                          <td style="padding: 4px 0; color: #555555; width: 140px;">User ID:</td>
                          <td style="padding: 4px 0;"><strong style="font-family: 'Courier New', Courier, monospace;">${safeUserId}</strong></td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; color: #555555;">Attempted Amount:</td>
                          <td style="padding: 4px 0; color: ${dangerColor};"><strong>${formattedAttemptedAmount}</strong></td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; color: #555555;">Expected Amount:</td>
                          <td style="padding: 4px 0;"><strong>${formattedExpectedAmount}</strong></td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; color: #555555;">IP Address:</td>
                          <td style="padding: 4px 0;"><code style="font-family: 'Courier New', Courier, monospace; background: #fee2e2; padding: 2px 4px; border-radius: 3px;">${safeIpAddress}</code></td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-radius: 4px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; color: ${textColor};">
                        <strong>Required Action:</strong> Please verify this transaction against the system logs. 
                        If this is an indication of fraudulent activity, please take necessary action to lock the account or flag the transaction.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const newStationRegistrationTemplate = (name, userId, payload) => {
  const safeName = sanitize(name);
  const safeUserId = sanitize(userId);
  const safeRequestId = sanitize(payload?.requestId);
  const safeTicketRefId = sanitize(payload?.ticketRefId);

  const primaryColor = theme?.colors?.primary || '#3b82f6';
  const textColor = theme?.colors?.text || '#333333';
  const bgColor = theme?.colors?.background || '#f8f9fa';

  const body = `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; text-align: left;">
            <tr>
              <td>
                <p style="color: ${textColor}; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; margin: 5px 0 16px 0;">
                  A new drop-off station has been submitted for review. Please verify the registration details below.
                </p>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 5px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0f7ff; border: 1px solid #edf2f7; border-left: 4px solid ${primaryColor}; border-radius: 0 8px 8px 0;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0 0 10px 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; color: ${textColor};"><strong>Registration Summary:</strong></p>
                      
                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="font-family: Helvetica, Arial, sans-serif; font-size: 13.5px; line-height: 20px; color: ${textColor};">
                        <tr>
                          <td style="padding: 4px 0; color: #555555; width: 140px;">Station Name:</td>
                          <td style="padding: 4px 0;"><strong>${safeName}</strong></td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; color: #555555;">Submitted By:</td>
                          <td style="padding: 4px 0;"><span style="font-family: 'Courier New', Courier, monospace;">${safeUserId}</span></td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; color: #555555;">Request ID:</td>
                          <td style="padding: 4px 0;"><code style="font-family: 'Courier New', Courier, monospace; background: #e0f2fe; padding: 2px 4px; border-radius: 3px;">${safeRequestId}</code></td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; color: #555555;">Ticket Ref:</td>
                          <td style="padding: 4px 0;"><code style="font-family: 'Courier New', Courier, monospace; background: #e0f2fe; padding: 2px 4px; border-radius: 3px;">${safeTicketRefId}</code></td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="left" style="padding-top: 20px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${bgColor}; border: 1px solid #edf2f7; border-radius: 4px;">
                  <tr>
                    <td style="padding: 16px;">
                      <p style="margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 20px; color: ${textColor};">
                        <strong>Next Step:</strong> Navigate to the <strong>Station Moderation Dashboard</strong> 
                        to approve or deny this request using the Request ID provided above.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  return emailWrapper(body);
};
export const taxReportEmailTemplate = (
  monthName,
  year,
  totalTaxAmount,
  pdfUrl,
) => {
  const { colors, branding } = theme;
  const body = `
    <p style="color: ${colors.text}; font-size: 16px; line-height: 1.5;">Hello Admin,</p>
    <p style="color: ${colors.text}; font-size: 16px; line-height: 1.5;">
      The official iCampus tax report for <strong>${monthName} ${year}</strong> has been successfully generated.
    </p>
    <div style="border: 1px solid ${colors.secondary}; border-radius: 6px; padding: 20px; margin: 20px 0; background: ${colors.background};">
      <h3 style="margin-top: 0; color: ${colors.primary}; font-size: 16px; margin-bottom: 15px;">Report Summary</h3>
      <table style="width: 100%; color: ${colors.text}; font-size: 14px;">
        <tr><td style="padding: 5px 0;"><strong>Period:</strong></td><td>${monthName} ${year}</td></tr>
        <tr><td style="padding: 5px 0;"><strong>Total Tax Collected:</strong></td><td style="color: ${colors.success}; font-weight: bold;">${totalTaxAmount.toLocaleString()} iCash</td></tr>
      </table>
    </div>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${pdfUrl}" style="background-color: ${colors.primary}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Download PDF Report
      </a>
    </div>
    <p style="font-size: 13px; color: #666; margin-top: 20px;">
      For any billing discrepancies, please reach out via support at 
      <a href="mailto:${branding.supportEmail}" style="color: ${colors.primary};">
        ${branding.supportEmail}
      </a>
    </p>
  `;
  return emailWrapper(body);
};