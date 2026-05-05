import { OAuth2Client } from 'google-auth-library';
const client = new OAuth2Client(process.env.WEB_CLIENT_ID);

/**
 * Verifies a Google ID Token
 * @param {string} idToken - The JWT from the mobile app
 * @param {string} claimedEmail - The email the user claims to have
 */
async function verifyGoogleToken(idToken, claimedEmail) {
  try {
    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: process.env.WEB_CLIENT_ID, 
    });
    const payload = ticket.getPayload();
    return payload.email === claimedEmail && payload.email_verified;
  } catch (error) {
    console.error("Google Token Verification Failed:", error.message);
    return false;
  }
}
/**
 * Verifies a GitHub Access Token
 * @param {string} accessToken - The token from the mobile app
 * @param {string} claimedEmail - The email the user claims to have
 */
async function verifyGithubToken(accessToken, claimedEmail) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${accessToken}`,
        'User-Agent': 'iCampus app' 
      }
    });

    if (!response.ok) return false;
    const githubUser = await response.json();
    if (githubUser.email === claimedEmail) return true;
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `token ${accessToken}`,
        'User-Agent': 'iCampus app'
      }
    });

    const emails = await emailResponse.json();
    
    // Ensure the claimed email exists in the user's verified GitHub email list
    return emails.some(e => e.email === claimedEmail && e.verified);
  } catch (error) {
    console.error("GitHub Token Verification Failed:", error.message);
    return false;
  }
}