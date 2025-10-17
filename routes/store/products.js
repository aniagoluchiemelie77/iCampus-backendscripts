import express from "express";

export default function (Category, Product) {
  const router = express.Router();

  // GET /store/categories
  router.get("/categories", async (req, res) => {
    try {
      const { schoolName } = req.query;

      if (!schoolName || typeof schoolName !== "string") {
        return res
          .status(400)
          .json({ message: "Missing or invalid schoolName in query" });
      }

      const categories = await Category.find({ schoolName });
      res.status(200).json(categories);
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ message: "Server error fetching categories" });
    }
  });

  // GET /store/products
  router.get("/products", async (req, res) => {
    try {
      const { schoolName, category, limit = "10", offset = "0" } = req.query;
      console.log(
        `School name: ${schoolName}, Category: ${category}, Limit: ${limit}, Offset: ${offset}`
      );

      if (!schoolName || typeof schoolName !== "string") {
        return res
          .status(400)
          .json({ message: "Missing or invalid schoolName in query" });
      }

      const parsedLimit = Math.max(parseInt(limit), 1);
      const parsedOffset = Math.max(parseInt(offset), 0);

      const filter = { schoolName };
      if (category && category !== "all") {
        filter.category = new RegExp(`^${category}$`, "i"); // case-insensitive exact match
      }

      let products;
      let total;

      if (category === "all") {
        // Randomize products using aggregation
        const pipeline = [
          { $match: { schoolName } },
          { $sample: { size: parsedLimit } },
        ];
        products = await Product.aggregate(pipeline);
        total = await Product.countDocuments({ schoolName });
      } else {
        total = await Product.countDocuments(filter);
        products = await Product.find(filter)
          .skip(parsedOffset)
          .limit(parsedLimit);
      }

      res.status(200).json({ products, total });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Server error fetching products" });
    }
  });

  return router;
}

