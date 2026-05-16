import {
  Product,
  Reviews,
  User
} from "../tableDeclarations.js";

export const fetchSellerReviews = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const products = await Product.find({ sellerId }).select("productId");
        const productIds = products.map((p) => p.productId.toString());
        const reviews = await Reviews.find({
            $or: [
                { targetId: sellerId, targetType: 'seller' },
                { targetId: { $in: productIds }, targetType: { $in: ['product', 'course', 'file'] } }
            ]
        }).sort({ createdAt: -1 });
        const reviewerUids = [...new Set(reviews.map(r => r.reviewerId))];
        const users = await User.find({ 
            uid: { $in: reviewerUids } 
        }).select('uid firstname lastname username profilePic isVerified tier organizationName');
        const userMap = {};
        users.forEach(user => {
            userMap[user.uid] = user;
        });
        const formattedReviews = reviews.map(review => {
            const reviewObj = review.toObject(); 
            return {
                ...reviewObj,
                reviewerDetails: userMap[review.reviewerId] || {
                    firstname: 'Anonymous',
                    lastname: 'iCampus',
                    username: 'User',
                    profilePic: null,
                    isVerified: false
                }
            };
        });

        return res.status(200).json({
            success: true,
            data: formattedReviews
        });

    } catch (error) {
        console.error("Error fetching seller reviews:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};