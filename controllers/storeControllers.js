import { Product } from "../tableDeclarations.js";
import { client as redis } from '../workers/reditFile.js';

export const fetchAllProducts = async (req, res) => {
  const CACHE_KEY = 'catalog:all_products';
  try {
    const cachedProducts = await redis.get(CACHE_KEY);

    if (cachedProducts) {
      return res.status(200).json({
        success: true,
        products: JSON.parse(cachedProducts),
        source: 'cache' 
      });
    }
    const products = await Product.find({})
      .select('title priceInPoints mediaUrls productId courseDetails fileDetails type sellerId physicalDetails')
      .lean();
    await redis.set(CACHE_KEY, JSON.stringify(products), {
      EX: 18000 
    });

    res.status(200).json({
      success: true,
      products,
      source: 'database'
    });
  } catch (error) {
    console.error('Cache/DB Error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};