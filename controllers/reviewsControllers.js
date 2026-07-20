import { Product, Reviews, User } from "../tableDeclarations.js";
import { logControllerPerformance } from "../utils/eventLogger.js";

export const fetchSellerReviews = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchSellerReviewsController";
  const action = "fetchSellerReviews";
  try {
    const sellerId = req.user.id;
    const [productsSnapshot, sellerReviewsSnapshot] = await Promise.all([
      Product.where("sellerId", "==", sellerId).get(),
      Reviews.where("targetId", "==", sellerId)
        .where("targetType", "==", "seller")
        .get(),
    ]);

    const productIds = productsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return data.productId || doc.id;
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
    const reviewerUids = [
      ...new Set(reviews.map((r) => r.reviewerId).filter(Boolean)),
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
    const formattedReviews = reviews.map((review) => {
      const reviewer = userMap[review.reviewerId] || {};
      return {
        ...review,
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
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      data: formattedReviews,
    });
  } catch (error) {
    console.error("Error fetching seller reviews:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
