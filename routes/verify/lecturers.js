import express from 'express';
import { Lecturer } from "../../tableDeclarations.js";

export default function lecturerVerifyRoutes() {
  const router = express.Router();

  router.post("/", async (req, res) => {
    const { school_name, staff_id } = req.body;
    console.log("Incoming payload:", req.body);
    if (!school_name || !staff_id) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    try {
      const lecturer = await Lecturer.findOne({
        school_name: school_name,
        staff_id: staff_id,
      });
      if (!lecturer) {
        return res.status(404).json({ message: "User not found" });
      }
      const {
        firstname,
        lastname,
        department,
        phone_number,
        school_name: lecturer_school_name,
        staff_id: lecturer_staff_id,
      } = lecturer;
      return res.json({
        firstname,
        lastname,
        department,
        phone_number,
        school_name: lecturer_school_name,
        staff_id: lecturer_staff_id,
      });
    } catch (err) {
      console.error("Verification error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  });
  return router;
}
