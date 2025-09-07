import express, { json } from 'express';
import cors from 'cors';
import User from '../iCampus/models/User.js';
import mongoose from 'mongoose';
import userRoutes from './routes/user.js';

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB 
const MONGO_URI = 'mongodb://localhost:27017/iCampus';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Sample Route
app.get('/', async (req, res) => {
  const users = await User.find();
  res.json(users);
});
const router = express.Router();
app.use('/api', userRoutes);
app.listen(5000, () => console.log('Backend running on port 5000'));

