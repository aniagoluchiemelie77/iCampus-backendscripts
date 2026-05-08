import express from "express";
import mongoose from "mongoose";
import { protect } from "../middleware/auth.js";

export default function (Product) {
  const router = express.Router();
  router.get("/products", async (req, res) => {
    const { q, category, cursor, limit = 10 } = req.query;
    try {
      let query = { isAvailable: true };
      if (category && category !== 'all' && category !== 'popular') {
        query.category = category;
      }
      if (q) {
        query.$or = [
          { title: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } }
        ];
      }
      if (cursor) {
        query._id = { $lt: cursor }; // Assuming descending order by ID
      }
      let sort = { createdAt: -1 };
      if (category === 'popular') {
        sort = { favCount: -1, ratingsAverage: -1 };
      }
      const products = await Product.find(query)
        .sort(sort)
        .limit(Number(limit));
      const nextCursor = products.length === Number(limit) 
        ? products[products.length - 1]._id 
        : null;
      res.json({ products, nextCursor });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  return router;
}


