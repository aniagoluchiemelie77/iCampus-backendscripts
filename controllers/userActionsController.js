import {Reviews} from '../tableDeclarations';
import jwt from 'jsonwebtoken';

export const createReviewController = async (req, res) => {
  try {
    let reviewerId = null;
    reviewerId = req.user?.id;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        reviewerId = decoded.id || decoded.uid; 
      } catch (err) {
        console.log("Standard token verification failed, checking payload body next...");
      }
    }
    if (!reviewerId && req.body.token) {
      try {
        const decoded = jwt.verify(req.body.token, process.env.JWT_SECRET);
        reviewerId = decoded.id || decoded.uid;
      } catch (err) {
        return res.status(401).json({
          success: false,
          message: "Expired or invalid fallback authentication token link.",
        });
      }
    }
    const { targetId, targetType, orderId, rating, comment, mediaUrls, attributes } = req.body;
    if (!targetId || !targetType || !rating) {
      return res.status(400).json({
        success: false,
        message: "Missing required tracking metrics (targetId, targetType, or rating rating arrays).",
      });
    }
    let parsedMediaUrls = [];
    if (mediaUrls) {
      try {
        parsedMediaUrls = typeof mediaUrls === 'string' ? JSON.parse(mediaUrls) : mediaUrls;
      } catch (e) {
        parsedMediaUrls = [mediaUrls]; 
      }
    }

    let parsedAttributes = { accuracy: undefined, deliverySpeed: undefined, clarity: undefined };
    if (attributes) {
      try {
        const rawAttrs = typeof attributes === 'string' ? JSON.parse(attributes) : attributes;
        parsedAttributes = {
          accuracy: Number(rawAttrs.accuracy) || undefined,
          deliverySpeed: Number(rawAttrs.deliverySpeed) || undefined,
          clarity: Number(rawAttrs.clarity) || undefined,
        };
      } catch (e) {
        console.error("Attributes parsing layout mismatch anomaly:", e);
      }
    }
    const newReview = new Reviews({
      reviewerId,
      targetId,
      targetType,
      orderId, 
      rating: Number(rating),
      comment: comment ? comment.trim() : "",
      mediaUrls: parsedMediaUrls, 
      attributes: parsedAttributes
    });

    await newReview.save();
    return res.status(201).json({
      success: true,
      message: "Reviews validation metrics published successfully.",
    });

  } catch (error) {
    console.error("Global crash layer hit in createReviewController:", error);
    return res.status(500).json({
      success: false,
      message: "Internal application routing anomaly during review storage commit pipeline.",
    });
  }
};