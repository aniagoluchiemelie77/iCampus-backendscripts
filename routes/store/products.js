import express from "express";

export default function (Category) {
  const router = express.Router();

  router.get('/categories', async (req, res) => {
    try {
      const categories = await Category.find();
      res.status(200).json(categories);
    } catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({ message: 'Server error fetching categories' });
    }
  });

  return router;
}
