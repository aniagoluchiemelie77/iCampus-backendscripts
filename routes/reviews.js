import express from "express";
import { protect } from "../middleware/auth.js";
import { fetchSellerReviews, fetchProductReviews } from '../controllers/reviewsControllers.js';


const router = express.Router();

router.get("/fetch-seller-reviews", protect, fetchSellerReviews);
router.get("/product/:productId", protect, fetchProductReviews);

export default router;