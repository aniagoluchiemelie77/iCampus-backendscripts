import express from 'express';
import User from '../../iCampus/models/User.js'; // adjust path if needed
import bcrypt from 'bcrypt';

const router = express.Router();


router.post('/register', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const newUser = new User({ ...req.body, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: 'User saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save user' });
  }
});


export default router;
