import express from "express";

export default function (Student) {
  const router = express.Router();

  router.post("/verify", async (req, res) => {
    const { school_name, matriculation_number } = req.body;
    if (!school_name || !matriculation_number) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const normalize = (str) => str.trim();
    const incomingSchool = normalize(school_name);
    try {
      console.log(
        "Searching for student with matric number:",
        matriculation_number,
      );
      const student = await Student.findOne({
        matriculation_number: matriculation_number,
      }).lean();

      // If student not found or school name doesn't match
      if (!student && incomingSchool) {
        return res
          .status(404)
          .json({ message: "Student not found", verified: false });
      }

      const { firstname, lastname, department, current_level, phone_number } =
        student;

      return res.json({
        firstname,
        lastname,
        department,
        current_level,
        phone_number,
        verified: true,
      });
    } catch (err) {
      console.error("Verification error:", err);
      return res.status(500).json({ message: "Server error", verified: false });
    }
  });

  return router;
}
