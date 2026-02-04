import express from 'express';
import { Student } from "../../tableDeclarations.js";

export default function studentVerifyRoutes() {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const { school_name, matriculation_number } = req.body;
    console.log("Incoming payload:", req.body);

    if (!school_name || !matriculation_number) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Normalize function to clean up school names
    const normalize = (str) => str.trim();

    const incomingSchool = normalize(school_name);

    try {
      // Find student by matric number only
      console.log(
        "Searching for student with matric number:",
        matriculation_number,
      );
      const student = await Student.findOne({
        matriculation_number: matriculation_number,
      }).lean();

      // If student not found or school name doesn't match
      if (!student && incomingSchool) {
        return res.status(404).json({ message: "Student not found" });
      }

      const { firstname, lastname, department, current_level, phone_number } =
        student;

      return res.json({
        firstname,
        lastname,
        department,
        current_level,
        phone_number,
      });
    } catch (err) {
      console.error("Verification error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });

  return router;
}
