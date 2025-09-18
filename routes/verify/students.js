import express from 'express';
export default function studentVerifyRoutes(UserModel) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const { school_name, matriculation_number } = req.body;
    console.log("Incoming payload:", req.body);

    if (!school_name || !matriculation_number) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    try {
      const student = await UserModel.findOne({
        school_name: school_name,
        matriculation_number: matriculation_number
      });

      if (!student) {
        return res.status(404).json({ message: 'Student not found' });
      }

      const {
        firstname,
        lastname,
        department,
        current_level,
        phone_number
      } = student;

      return res.json({
        firstname,
        lastname,
        department,
        current_level,
        phone_number
      });
    } catch (err) {
      console.error('Verification error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  });
  return router;
}
