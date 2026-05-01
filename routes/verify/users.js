import express from "express";
import axios from "axios";
import { protect } from "../../middleware/auth.js";

export default function (User) {
  const router = express.Router();
  router.post("/persona/create-inquiry", protect, async (req, res) => {
    try {
      const userId = req.user.id;
      const { userType } = req.body;

      const INDIVIDUAL_TEMPLATE_ID = process.env.INDIVIDUAL_TEMPLATE_ID;
      const ENTERPRISE_TEMPLATE_ID = process.env.ENTERPRISE_TEMPLATE_ID;
      const selectedTemplate =
        userType === "enterprise"
          ? ENTERPRISE_TEMPLATE_ID
          : INDIVIDUAL_TEMPLATE_ID;

      const response = await axios.post(
        "https://withpersona.com/api/v1/inquiries",
        {
          data: {
            attributes: {
              "template-id": selectedTemplate,
              "reference-id": userId,
              environment: "sandbox",
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
            Accept: "application/json",
            "Persona-Version": "2023-01-05",
            "Content-Type": "application/json",
          },
        },
      );
      const inquiryId = response.data.data.id;
      res.status(200).json({ inquiryId });
    } catch (error) {
      console.error(
        "Persona API Error:",
        error.response?.data || error.message,
      );
      res.status(500).json({
        error: "Failed to initialize verification session",
        details: error.response?.data?.errors,
      });
    }
  });
  return router;
}
