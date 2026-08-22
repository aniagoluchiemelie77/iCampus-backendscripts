import { OAuth2Client } from "google-auth-library";
const client = new OAuth2Client(process.env.WEB_CLIENT_ID);

export async function verifyGoogleToken(idToken, claimedEmail) {
  try {
    if (!idToken || !claimedEmail) {
      return false;
    }

    const ticket = await client.verifyIdToken({
      idToken: idToken,
      audience: process.env.WEB_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    
    return Boolean(
      payload &&
      payload.email &&
      payload.email.toLowerCase() === claimedEmail.toLowerCase() &&
      payload.email_verified
    );
  } catch (error) {
    console.error("Google Token Verification Failed:", error.message);
    return false;
  }
};
export async function verifyGithubToken(accessToken, claimedEmail) {
  try {
    if (!accessToken || !claimedEmail) {
      return false;
    }

    const headers = {
      Authorization: `token ${accessToken}`,
      "User-Agent": "iCampus-App",
      Accept: "application/vnd.github.v3+json",
    };
    const response = await fetch("https://api.github.com/user", { headers });

    if (!response.ok) {
      return false;
    }

    const githubUser = await response.json();
    if (
      githubUser.email &&
      githubUser.email.toLowerCase() === claimedEmail.toLowerCase()
    ) {
      return true;
    }
    const emailResponse = await fetch("https://api.github.com/user/emails", { headers });

    if (!emailResponse.ok) {
      return false;
    }

    const emails = await emailResponse.json();
    if (!Array.isArray(emails)) {
      return false;
    }
    return emails.some(
      (e) =>
        e &&
        e.email &&
        e.email.toLowerCase() === claimedEmail.toLowerCase() &&
        e.verified === true
    );
  } catch (error) {
    console.error("GitHub Token Verification Failed:", error.message);
    return false;
  }
};