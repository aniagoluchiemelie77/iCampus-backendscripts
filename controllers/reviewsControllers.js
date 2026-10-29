import { Product, ProductOrder, Reviews, User } from "../tableDeclarations.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { setImmediate } from "timers";


//Tested and trusted using jest
export const fetchSellerReviews = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchSellerReviewsController";
  const action = "fetchSellerReviews";

  try {
    const sellerId = req.user?.id || req.user?.uid;
    if (!sellerId) {
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized seller context." });
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [productsSnapshot, sellerReviewsSnapshot] = await Promise.all([
      Product.where("sellerId", "==", sellerId).get(),
      Reviews.where("targetId", "==", sellerId)
        .where("targetType", "==", "seller")
        .get(),
    ]);

    // Seller's listings by id, so each review can say what it was about.
    const productMap = new Map();
    const productIds = productsSnapshot.docs.map((doc) => {
      const data = doc.data();
      const id = data.productId || doc.id;
      productMap.set(id, data);
      return id;
    });

    let productReviewsSnapshots = [];
    if (productIds.length > 0) {
      const chunks = [];
      for (let i = 0; i < productIds.length; i += 30) {
        chunks.push(productIds.slice(i, i + 30));
      }

      const validTargetTypes = ["product", "course", "file"];
      const reviewPromises = chunks.flatMap((chunk) =>
        validTargetTypes.map((targetType) =>
          Reviews.where("targetId", "in", chunk)
            .where("targetType", "==", targetType)
            .get(),
        ),
      );

      productReviewsSnapshots = await Promise.all(reviewPromises);
    }

    const reviewMap = new Map();
    const processSnapshot = (snapshot) => {
      snapshot.docs.forEach((doc) => {
        reviewMap.set(doc.id, { id: doc.id, ...doc.data() });
      });
    };

    processSnapshot(sellerReviewsSnapshot);
    productReviewsSnapshots.forEach(processSnapshot);

    let reviews = Array.from(reviewMap.values());
    reviews.sort((a, b) => {
      const timeA = a.createdAt?.toDate
        ? a.createdAt.toDate()
        : new Date(a.createdAt || 0);
      const timeB = b.createdAt?.toDate
        ? b.createdAt.toDate()
        : new Date(b.createdAt || 0);
      return timeB - timeA;
    });

    const totalReviewsCount = reviews.length;
    // Computed over every review, not just this page, so the header stats
    // don't change as the seller scrolls.
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let ratingSum = 0;
    reviews.forEach((r) => {
      const rating = Number(r.rating) || 0;
      ratingSum += rating;
      const bucket = Math.min(5, Math.max(1, Math.round(rating)));
      if (rating > 0) distribution[bucket] += 1;
    });
    const summary = {
      total: totalReviewsCount,
      averageRating: totalReviewsCount
        ? Math.round((ratingSum / totalReviewsCount) * 10) / 10
        : 0,
      distribution,
    };
    const paginatedReviews = reviews.slice(skip, skip + limit);

    // Store-level reviews only point at the seller; their order says which
    // product was bought.
    const orderIds = [
      ...new Set(
        paginatedReviews
          .filter((r) => r.orderId && !productMap.has(r.targetId))
          .map((r) => r.orderId),
      ),
    ];
    const orderMap = new Map();
    if (orderIds.length > 0) {
      const orderDocs = await Promise.all(
        orderIds.map((id) => ProductOrder.doc(String(id)).get().catch(() => null)),
      );
      orderDocs.forEach((doc, i) => {
        if (doc?.exists) orderMap.set(orderIds[i], doc.data());
      });
    }
    const firstImage = (media) =>
      Array.isArray(media) ? media.find((u) => typeof u === "string") || null : media || null;
    const resolveSubject = (review) => {
      const order = review.orderId ? orderMap.get(review.orderId) : null;
      const variant =
        [order?.color, order?.size].filter(Boolean).join(" · ") || null;
      const product =
        productMap.get(review.targetId) ||
        (order?.productId ? productMap.get(order.productId) : null);
      if (product) {
        return {
          type: review.targetType === "seller" ? "product" : review.targetType,
          id: product.productId || order?.productId || review.targetId,
          title: product.title || order?.productName || "Listing",
          image: firstImage(product.mediaUrls),
          price: product.price ?? null,
          orderId: review.orderId || null,
          quantity: order?.quantity ?? null,
          variant,
          isStoreReview: review.targetType === "seller",
        };
      }
      if (order) {
        // Product deleted since, but the order remembers its name.
        return {
          type: "product",
          id: order.productId || null,
          title: order.productName || "A past order",
          image: null,
          price: null,
          orderId: review.orderId,
          quantity: order.quantity ?? null,
          variant,
          isStoreReview: review.targetType === "seller",
        };
      }
      return {
        type: review.targetType || "seller",
        id: review.targetId || null,
        title: review.targetType === "seller" ? "Your store" : "Deleted listing",
        image: null,
        price: null,
        orderId: review.orderId || null,
        quantity: null,
        variant: null,
        isStoreReview: review.targetType === "seller",
      };
    };

    const reviewerUids = [
      ...new Set(paginatedReviews.map((r) => r.reviewerId).filter(Boolean)),
    ];

    const userMap = {};
    if (reviewerUids.length > 0) {
      const userChunks = [];
      for (let i = 0; i < reviewerUids.length; i += 30) {
        userChunks.push(reviewerUids.slice(i, i + 30));
      }

      const userSnapshots = await Promise.all(
        userChunks.map((chunk) => User.where("uid", "in", chunk).get()),
      );

      userSnapshots.forEach((snap) => {
        snap.docs.forEach((doc) => {
          const userData = doc.data();
          const uidKey = userData.uid || doc.id;
          userMap[uidKey] = userData;
        });
      });
    }

    const formattedReviews = paginatedReviews.map((review) => {
      const reviewer = userMap[review.reviewerId] || {};
      return {
        ...review,
        createdAt: review.createdAt?.toDate
          ? review.createdAt.toDate().toISOString()
          : review.createdAt || null,
        subject: resolveSubject(review),
        reviewerDetails: {
          firstname: reviewer.firstname || reviewer.firstName || "Anonymous",
          lastname: reviewer.lastname || reviewer.lastName || "iCampus",
          username: reviewer.username || "User",
          profilePic: reviewer.profilePic || null,
          isVerified: reviewer.isVerified || false,
          tier: reviewer.tier,
          organizationName: reviewer.organizationName,
        },
      };
    });

    res.status(200).json({
      success: true,
      data: formattedReviews,
      summary,
      pagination: {
        total: totalReviewsCount,
        page,
        limit,
        totalPages: Math.ceil(totalReviewsCount / limit),
        hasMore: skip + limit < totalReviewsCount,
      },
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error fetching seller reviews:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * GET /reviews/product/:productId?limit=20
 * Public reviews of one listing, newest first, for the product page.
 */
export const fetchProductReviews = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchProductReviewsController";
  const action = "fetchProductReviews";

  try {
    const productId = String(req.params.productId || "").trim();
    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing product id." });
    }
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const snapshot = await Reviews.where("targetId", "==", productId)
      .where("targetType", "==", "product")
      .get();

    const toTime = (value) =>
      value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime();
    const reviews = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));

    const total = reviews.length;
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let ratingSum = 0;
    reviews.forEach((r) => {
      const rating = Number(r.rating) || 0;
      ratingSum += rating;
      if (rating > 0) distribution[Math.min(5, Math.max(1, Math.round(rating)))] += 1;
    });

    const page = reviews.slice(0, limit);
    const reviewerUids = [
      ...new Set(page.map((r) => r.reviewerId).filter(Boolean)),
    ];
    const userMap = {};
    for (let i = 0; i < reviewerUids.length; i += 30) {
      const snap = await User.where("uid", "in", reviewerUids.slice(i, i + 30)).get();
      snap.docs.forEach((doc) => {
        const data = doc.data();
        userMap[data.uid || doc.id] = data;
      });
    }

    const data = page.map((review) => {
      const reviewer = userMap[review.reviewerId] || {};
      return {
        id: review.id,
        rating: Number(review.rating) || 0,
        comment: review.comment || "",
        mediaUrls: Array.isArray(review.mediaUrls) ? review.mediaUrls : [],
        isVerifiedPurchase: !!review.orderId,
        createdAt: review.createdAt?.toDate
          ? review.createdAt.toDate().toISOString()
          : review.createdAt || null,
        reviewerDetails: {
          firstname: reviewer.firstname || reviewer.firstName || "Anonymous",
          lastname: reviewer.lastname || reviewer.lastName || "",
          username: reviewer.username || null,
          profilePic: reviewer.profilePic || null,
          isVerified: reviewer.isVerified || false,
          organizationName: reviewer.organizationName || null,
        },
      };
    });

    res.status(200).json({
      success: true,
      data,
      summary: {
        total,
        averageRating: total ? Math.round((ratingSum / total) * 10) / 10 : 0,
        distribution,
      },
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    console.error("Error fetching product reviews:", error.message);
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
