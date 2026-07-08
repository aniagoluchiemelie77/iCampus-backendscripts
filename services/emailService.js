import { ServerClient } from "postmark";
import dotenv from "dotenv";

dotenv.config();

const postmarkClient = new ServerClient(process.env.POSTMARK_API_KEY);

export const sendEmail = async ({
  to,
  subject,
  text,
  html,
  attachments = [],
}) => {
  try {
    const response = await postmarkClient.sendEmail({
      From: "support@uniquetechcontentwriter.com",
      To: to,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      MessageStream: "broadcast",
      Attachments: attachments.map((att) => ({
        Name: att.filename,
        Content: att.content.toString("base64"),
        ContentType: att.contentType,
      })),
    });

    console.log("Email sent successfully. Message ID:", response.MessageID);
    return response;
  } catch (error) {
    console.error("Postmark Email Sending Error:", error);
    throw error;
  }
};
