// services/emailTemplates.js
import { theme } from "./emailTheme.js";

const { colors, branding, typography } = theme;

// A reusable Wrapper (Header/Footer) to keep it DRY
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
    <h1 style="color: ${colors.primary}; margin-top: 0;">Welcome to iCampus</h1>
    <p>Hi ${userName},</p>
    <p>We're thrilled to have you join our community. iCampus is designed to make your academic journey seamless, social, and rewarding.</p>
    
    <div style="background: #f9f9f9; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #eee;">
      <h3 style="margin-top: 0; font-size: 16px;">What's Next?</h3>
      <ul style="padding-left: 20px; color: ${colors.text};">
        <li>Complete your profile to connect with peers.</li>
        <li>Check your <strong>iTag</strong> to view your digital ID.</li>
        <li>Explore course materials and upcoming lectures.</li>
      </ul>
    </div>

    <p style="color: ${colors.secondary};">If you have any questions, simply reply to this email. We're here to help!</p>
    <p style="color: ${colors.secondary};">Happy Learning,<br>The iCampus Team</p>
  `;
  return emailWrapper(body);
};
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

export const loginAlertTemplate = (userName, ipAddress, location, time) => {
  const body = `
    <h2 style="color: ${colors.danger}; margin-top: 0;">Security Alert</h2>
    <p>Hello ${userName},</p>
    <p>A new login was detected on your account from an unrecognized IP address.</p>
    <div style="background: #fff5f5; border-left: 4px solid ${colors.danger}; padding: 15px; margin: 20px 0;">
      <strong>Details:</strong><br>
      IP: ${ipAddress}<br>
      Location: ${location}
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

export const passwordResetTemplate = (userName, code, expiryTime) => {
  const body = `
    <div style="text-align: center;">
      <h2 style="color: ${theme.colors.primary};">Password Reset Request</h2>
      <p style="color: ${theme.colors.text}; margin-vertical: 20px">Hi ${userName}, use the code below to reset your iCampus account password:</p>
      
      <div style="background: #f4f4f4; padding: 20px; margin: 20px 0; border-radius: 8px;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: ${theme.colors.primary};">
          ${code}
        </span>
      </div>

      <p style="font-size: 13px; color: ${theme.colors.secondary};">
        This code is valid for <strong>${expiryTime}</strong>. If you did not request this, please ignore.
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
export const subscriptionUpgradeTemplate = (
  userName,
  tier,
  amount,
  currency,
  transactionId,
) => {
  const body = `
    <div style="text-align: center; font-family: sans-serif; max-width: 500px; margin: auto;">
      <div style="margin-bottom: 20px;">
        <span style="background: ${colors.primary}; color: white; padding: 5px 15px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">
          Plan Activated
        </span>
      </div>
      
      <h2 style="color: ${colors.primary}; margin-bottom: 5px;">Welcome to ${tier}!</h2>
      <p style="color: ${colors.text}; font-size: 15px;">Hello ${userName}, your iCampus account has been successfully upgraded.</p>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 30px; margin: 25px 0; border-radius: 16px;">
        <div style="font-size: 14px; color: ${colors.text}; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">Active Subscription</div>
        <div style="font-size: 36px; font-weight: 800; color: ${colors.primary};">
          ${tier} Plan
        </div>
        <div style="font-size: 13px; color: ${colors.secondary}; margin-top: 5px; font-weight: 500;">
          Full access granted
        </div>
      </div>

      <div style="text-align: left; background: #fafafa; padding: 20px; border-radius: 12px; border: 1px solid #f1f5f9;">
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: ${colors.text};">Plan Tier</td>
            <td style="padding: 8px 0; text-align: right; color: ${colors.text}; font-weight: 600;">${tier}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: ${colors.text};">Amount Paid</td>
            <td style="padding: 8px 0; text-align: right; color: ${colors.text}; font-weight: 600;">${currency} ${amount.toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Transaction ID</td>
            <td style="padding: 8px 0; text-align: right; color: #64748b; font-family: monospace;">${transactionId}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">Billing Cycle</td>
            <td style="padding: 8px 0; text-align: right; color: #64748b;">Monthly</td>
          </tr>
        </table>
      </div>

      <p style="font-size: 13px; color: ${colors.secondary}; margin-top: 25px;">
        You now have unlimited access to premium courses and exclusive campus features. <br/>
        Thank you for being part of the <strong>iCampus</strong> community.
      </p>
      
      <div style="margin-top: 30px;">
        <a href=${branding.appDashboardUrl} style="background: ${colors.primary}; color: white; padding: 12px 25px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
          Go to Dashboard
        </a>
      </div>
    </div>
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
) => {
  const isHomeDelivery = method === "home_delivery";

  const instructionBlock = isHomeDelivery
    ? `
      <h3 style="color:${colors.text};">Home Delivery Instructions</h3>
      <p>Deliver the item to the buyer's address:</p>
      <p style="background: #fff; border: 1px solid #ddd; padding: 10px;"><strong>${buyerAddress || "Check app for address"}, Buyer's phone number: ${buyerPhoneNumber}</strong></p>
      <p><strong>Action:</strong> Once you arrive, you must scan the Order QR code from the buyer's phone to complete the transaction and receive your payment.</p>
    `
    : `
      <h3 style="color: ${colors.text};">Station Drop-off Instructions</h3>
      <p>Please deliver the item to the following station:</p>
      <p style="background: #fff; border: 1px solid #ddd; padding: 10px;"><strong>${stationName}</strong><br/>${stationAddress}</p>
      <p><strong>Action:</strong> Hand the item to the station agent. The agent will scan the buyer's QR code when they come for pick-up to finalize the payment to both you and the agent.</p>
    `;

  return `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px;">
      <h2 style="color: ${colors.primary};">You've made a sale</h2>
      <p>Hi there, <strong>${buyerName}</strong> just purchased <strong>${productName}</strong>.</p>
      
      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p style="color: ${colors.primary};"><strong>Total Earnings:</strong> ${amount.toLocaleString()} iCash</p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        ${instructionBlock}
      </div>

      <p>Thank you for using iCampus!</p>
    </div>
  `;
};
export const marketplacePurchaseTemplate = (
  userName,
  productName,
  amount,
  orderId,
  type,
  fileUrl,
) => {
  let instructions = "";
  if (type === "course") {
    instructions = `
      <p>This course has been added to your library. You can access it anytime under <strong>"My Downloads"</strong> section in the iCampus app.</p>
    `;
  } else if (type === "physical") {
    instructions = `
      <p>Please head to your chosen collection point if it's not home delivery. Present the <strong>QR Code</strong> found in your order details to the seller or agent to collect your item.</p>
    `;
  } else if (type === "file") {
    instructions = `
      <div style="margin: 25px 0; text-align: center;">
        <p style="color: ${colors.text}; margin-bottom: 15px;">Your file is ready for download:</p>
        <a href="${fileUrl}" 
           style="background-color: ${colors.primary}; 
                  color: ${colors.white}; 
                  padding: 14px 25px; 
                  text-decoration: none; 
                  border-radius: 5px; 
                  font-weight: bold; 
                  display: inline-block;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
           Download File
        </a>
        <p style="font-size: 11px; color: ${colors.secondary}; margin-top: 15px;">
          If the button doesn't work, copy this link into your browser:<br>
          <span style="word-break: break-all; color: ${colors.primary};">${fileUrl}</span>
        </p>
      </div>
    `;
  }

  const body = `
    <h2 style="color: ${colors.success}; margin-top: 0;">Order Confirmed! ✅</h2>
    <p style="color: ${colors.text}">Hi ${userName},</p>
    <p style="color: ${colors.text}">Your purchase of <strong>${productName}</strong> was successful.</p>
    
    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="color: ${colors.text};margin: 0;"><strong>Order ID:</strong> #${orderId}</p>
      <p style="color: ${colors.primary};margin: 0;"><strong>Amount Deducted:</strong> ${amount.toLocaleString()} Points</p>
    </div>

    ${instructions}

    <p style="font-size: 13px; color:${colors.secondary};">View your full receipt and order status in the <strong>Orders</strong> tab of your profile.</p>
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
  const isAgent = role === "agent";

  const roleSpecificMessage = isAgent
    ? `<p style="color: ${colors.text}">You have successfully verified the delivery for <strong>${productName}</strong>, your commission has been credited. Proceed to payout to withdraw to your iCash wallet.</p>`
    : `<p style="color: ${colors.text}">The buyer has received <strong>${productName}</strong>, proceed to payout to withdraw your sales proceeds to your iCash wallet.</p>`;

  const body = `
    <h2 style="color: ${colors.success}; margin-top: 0;">Tranaction Completed, Payment Released!</h2>
    <p style="color: ${colors.text}">Hi ${userName},</p>
    ${roleSpecificMessage}
    
    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="color: ${colors.text}; margin: 0;"><strong>Order ID:</strong> #${orderId}</p>
      <p style="color: ${colors.primary}; margin: 0;"><strong>Amount Credited:</strong> ${amount.toLocaleString()} iCash</p>
    </div>

    <div style="background: #e7f3ff; border: 1px solid #d1e7ff; padding: 15px; border-radius: 5px; margin: 15px 0;">
      <p style="margin: 0; font-weight: bold; color: ${colors.secondary};">Transaction Finalized</p>
      <p style="font-size: 13px; margin: 5px 0; color: ${colors.text};">
        The funds are now available for withdrawal to your iCash wallet.
      </p>
    </div>

    <p style="font-size: 13px; color:${colors.secondary};">You can view the breakdown of this transaction in your <strong>Wallet History</strong>.</p>
  `;

  return emailWrapper(body);
};
export const orderReviewTemplate = (userName, productName, orderId) => {
  const body = `
    <h2 style="color: ${colors.primary}; margin-top: 0;">We value your feedback</h2>
    <p style="color: ${colors.text}">Hi ${userName},</p>
    <p style="color: ${colors.text}">Your order <strong>#${orderId}</strong> for <strong>${productName}</strong> has been marked as completed.</p>
    
    <div style="background: #fff3cd; border-left: 5px solid #ffc107; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; font-weight: bold; color: #856404;">Help the Community</p>
      <p style="font-size: 14px; color: ${colors.text}; margin: 5px 0;">
        Ratings directly impact a seller's <strong>iScore</strong>. By leaving a review, you help other students and staff find reliable items.
      </p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <a href="https://icampus.app/reviews/${orderId}" 
         style="background-color: ${colors.primary}; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
         Rate Product & Seller
      </a>
    </div>

    <p style="font-size: 13px; color:${colors.secondary};">What did you think of the purchase process? Open the app to rate the app's delivery method too!</p>
  `;

  return emailWrapper(body);
};
export const orderCancelledEmailTemplate = (
  sellerName,
  productName,
  orderId,
  reason,
  buyerName,
) => {
  const body = `
    <h2 style="color: ${colors.primary}; margin-top: 0;">Order Cancelled</h2>
    <p style="color: ${colors.text}">Hi ${sellerName},</p>
    <p style="color: ${colors.text}">
      The order for <strong>${productName}</strong> (ID: #${orderId}) has been cancelled by the buyer, <strong>${buyerName}</strong>.
    </p>
    
    <div style="background: #fff5f5; border-left: 4px solid #ff4444; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; font-weight: bold; color: #ff4444;">Reason for Cancellation:</p>
      <p style="margin: 5px 0; font-style: italic; color: ${colors.text};">"${reason}"</p>
    </div>

    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="color: ${colors.text}; margin: 0;">
        <strong>Inventory Update:</strong> The item has been automatically added back to your stock and is visible in the marketplace again.
      </p>
    </div>

    <p style="color: ${colors.secondary}; font-size: 13px;">
      No further action is required on your part. If you have already dispatched this item, please contact support immediately.
    </p>
  `;

  return emailWrapper(body);
};
export const courseCompletionEmailTemplate = (
  userName,
  productName,
  pdfUrl,
  productId,
) => {
  const body = `
    <h2 style="color: ${colors.primary}; margin-top: 0;">Congratulations!</h2>
    <p style="color: ${colors.text}">Hi ${userName},</p>
    <p style="color: ${colors.text}">
      Huge news! You have officially completed <strong>${productName}</strong>. This is a significant milestone in your learning journey at iCampus.
    </p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${pdfUrl}" style="background-color: ${colors.primary}; color: #ffffff; padding: 15px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
        Download My Certificate
      </a>
    </div>

    <div style="background: #f0f7ff; border-left: 4px solid ${colors.secondary}; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; font-weight: bold; color: ${colors.secondary};">Share the Knowledge:</p>
      <p style="margin: 5px 0; color: ${colors.text};">
        How was your experience? Your feedback helps the iCampus community grow.
      </p>
      <a href="https://useicampus.edu/reviews/${productId}" style="color: ${colors.primary}; font-weight: bold; text-decoration: underline;">
        Leave a Review for this Course
      </a>
    </div>

    <p style="color: ${colors.text}; font-size: 14px;">
      Your hard work is paying off. Keep the momentum going—check your library for your next challenge!
    </p>
  `;

  return emailWrapper(body);
};
export const salesPayoutTemplate = (username, amount, transactionId) => {
  const body = `
    <h2 style="color: ${colors.success}; margin-top: 0;">Payout Successful!</h2>
    <p style="color: ${colors.text}">Hi ${username},</p>
    <p style="color: ${colors.text}">Your request to move your sales proceeds to your main wallet has been processed. The funds are now available for immediate use.</p>
    
    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="color: #666; margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Amount Transferred</p>
      <p style="color: ${colors.primary}; margin: 5px 0; font-size: 24px; font-weight: bold;">${amount.toLocaleString()} iCash</p>
      
      <div style="height: 1px; background: #eee; margin: 10px 0;"></div>
      
      <p style="color: ${colors.text}; margin: 0; font-size: 13px;"><strong>Transaction ID:</strong> #${transactionId}</p>
    </div>

    <div style="background: #fff9e6; border: 1px solid #ffeeba; padding: 15px; border-radius: 5px; margin: 15px 0;">
      <p style="margin: 0; font-weight: bold; color: #856404;">What can you do now?</p>
      <ul style="font-size: 13px; margin: 5px 0; padding-left: 20px; color: ${colors.text};">
        <li>Purchase course materials or items on the Marketplace.</li>
        <li>Send iCash to other students on campus.</li>
        <li>Withdraw funds to your linked bank account.</li>
      </ul>
    </div>

    <p style="font-size: 13px; color:${colors.secondary}; text-align: center; margin-top: 25px;">
      Thank you for being a part of the <strong>iCampus</strong> sales ecosystem!
    </p>
  `;

  return emailWrapper(body);
};