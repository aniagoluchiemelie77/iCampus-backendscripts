import express from "express";
import { protect } from "../middleware/auth.js";
import {fetchSellerReviews} from '../controllers/reviewsControllers.js';


const router = express.Router();

router.get("/fetch-seller-reviews", protect, fetchSellerReviews);

export default router;