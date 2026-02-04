import express from 'express';
import { Lecturer } from "../../tableDeclarations.js";

export default function lecturerVerifyRoutes() {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const { school_name, staff_id: incomingStaffId } = req.body;
    console.log("Incoming payload:", req.body);

    if (!school_name || !incomingStaffId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const normalize = (str) => str.trim().toLowerCase(); // Lowercase for better matching
    const incomingSchool = normalize(school_name);

    try {
      const lecturer = await Lecturer.findOne({
        staff_id: incomingStaffId,
      }).lean();

      if (!lecturer) {
        return res.status(404).json({ message: "Instructor not found" });
      }

      // CRITICAL: Compare the input school with the DB school
      const dbSchool = normalize(lecturer.school_name || "");
      if (dbSchool !== incomingSchool) {
        return res
          .status(401)
          .json({ message: "Staff ID does not match this institution" });
      }

      // Safely destructure without variable name conflicts
      const {
        firstname,
        lastname,
        department,
        phone_number,
        staff_id, // Using the DB field name
      } = lecturer;

      return res.json({
        firstname,
        lastname,
        department,
        phone_number,
        school_name: lecturer.school_name, // Return the official name from DB
        staff_id: lecturer.staff_id,
      });
    } catch (err) {
      console.error("Verification error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });
  return router;
}
