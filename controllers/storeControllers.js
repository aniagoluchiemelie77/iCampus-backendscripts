import {
  Product,
  User,
  Order,
  UserDownloads,
  Transactions,
} from "../tableDeclarations.js";
import { client as redis } from "../workers/reditFile.js";
import { createNotification } from "../services/notification.js";
import { v4 as uuidv4 } from "uuid";
import mongoose from "mongoose";

async function sendOrderNotifications(buyer, processedItems) {
  for (const {
    order,
    sellerEmail,
    product,
    filePassword,
    sellerId,
  } of processedItems) {
    await createNotification({
      notificationId: uuidv4(),
      recipientId: sellerId,
      recipientEmail: sellerEmail,
      category: "store",
      actionType: "NEW_ORDER",
      title: "New Sale",
      message:
        product.type === "physical"
          ? `Item: ${product.title}. Deliver to: ${order.selectedStation?.name || "Assigned Station"}.`
          : `Your digital product "${product.title}" has been purchased.`,
      entityId: order.orderId,
      entityType: "order",
      payload: {
        orderId: order.orderId,
        productName: product.title,
        buyerName: buyer.firstname,
        amount: order.amountPaid,
        deliveryMethod: deliveryMethod,
        stationName: order.selectedStation?.name,
        stationAddress: order.selectedStation?.address,
        buyerAddress: buyerAddress,
        buyerPhoneNumber: buyerPhoneNumber,
      },
      sendPush: true,
      sendEmail: true,
      saveToDb: true,
    });
    await createNotification({
      notificationId: uuidv4(),
      recipientId: buyer.uid,
      recipientEmail: buyer.email,
      category: "finance",
      actionType: "MARKET_PURCHASE_DEBIT",
      title: "Purchase Confirmed",
      message: `Your purchase of ${product.title} was successful. ${
        filePassword
          ? "File Password: " + filePassword
          : "Scan your QR code at the station or to seller to complete the transaction."
      }`,
      entityId: order.orderId,
      entityType: "order",
      payload: {
        orderId: order.orderId,
        productName: product.title,
        productType: product.type,
        amount: order.amountPaid,
        password: filePassword,
        userName: buyer.firstname,
      },
      sendPush: true,
      sendEmail: true,
      saveToDb: true,
    });
  }
}
export const fetchAllProducts = async (req, res) => {
  const CACHE_KEY = "catalog:all_products";
  try {
    const cachedProducts = await redis.get(CACHE_KEY);

    if (cachedProducts) {
      return res.status(200).json({
        success: true,
        products: JSON.parse(cachedProducts),
        source: "cache",
      });
    }
    const products = await Product.find({})
      .select(
        "title isAvailable priceInPoints mediaUrls productId courseDetails category description ratings fileDetails type sellerId physicalDetails",
      )
      .lean();
    await redis.set(CACHE_KEY, JSON.stringify(products), {
      EX: 18000,
    });

    res.status(200).json({
      success: true,
      products,
      source: "database",
    });
  } catch (error) {
    console.error("Cache/DB Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
export const clearUserCart = async (req, res) => {
  try {
    const userId = req.user.id;

    const updatedUser = await User.findOneAndUpdate(
      { uid: userId },
      { $set: { cart: [] } },
      { new: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      status: true,
      message: "Cart cleared successfully",
      cart: updatedUser.cart,
    });
  } catch (error) {
    console.error("Clear Cart Error:", error);
    res.status(500).json({
      status: false,
      message: "An error occurred while clearing the cart",
    });
  }
};
export const bulkAddToCart = async (req, res) => {
  const { items } = req.body;
  const userId = req.user.id;
  const user = await User.findOne({ uid: userId });
  const newCart = [...user.cart];
  items.forEach((newItem) => {
    if (!newCart.some((item) => item.productId === newItem.productId)) {
      newCart.push(newItem);
    }
  });
  user.cart = newCart;
  await user.save();
  res.status(200).json({
    status: true,
    cart: user.cart,
    message: "Successfully moved all favorites to cart.",
  });
};
export const clearFavorites = async (req, res) => {
  const userId = req.user.id;
  await User.findOneAndUpdate({ uid: userId }, { $set: { favorites: [] } });
  res.status(200).json({ status: true });
};
export const initializeCheckout = async (req, res) => {
  const { items, totals, buyerId, shippingContact } = req.body;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const buyer = await User.findOne({ uid: buyerId }).session(session);
    if (!buyer || buyer.pointsBalance < totals.grandTotal) {
      res.status(401).json({
        success: false,
        message: "Insufficient balance or user not found",
      });
    }
    buyer.pointsBalance -= totals.grandTotal;
    await buyer.save({ session });
    const buyerTxId = `TXB-${uuidv4().split("-")[0].toUpperCase()}`;
    const buyerTransaction = new Transactions({
      transactionId: buyerTxId,
      userId: buyerId,
      type: "payment",
      amountICash: totals.grandTotal,
      status: "success",
      payType: "out",
      title: `Purchase of ${items.length} item(s)`,
      reference: `REF-${uuidv4()}`,
      createdAt: new Date(),
    });
    await buyerTransaction.save({ session });

    const processedResults = [];
    for (const item of items) {
      const product = await Product.findOne({
        productId: item.productId,
      }).session(session);
      const seller = await User.findOne({ uid: item.sellerId }).session(
        session,
      );
      if (!product || !seller)
        res.status(401).json({
          success: false,
          message: "Product or Seller info not found",
        });
      const orderId = `ORD-${uuidv4().split("-")[0].toUpperCase()}`;
      let filePassword = null;
      const isDropOff = item.deliveryMethod === "drop_off";
      const stationAgentId =
        isDropOff && item.selectedStation ? item.selectedStation.agentId : null;
      if (product.type === "file") {
        filePassword = Math.random().toString(36).slice(-8);
      } else if (product.type === "course") {
        await UserDownloads.findOneAndUpdate(
          { userId: buyerId },
          { $addToSet: { ownedProducts: product.productId } },
          { upsert: true, session },
        );
      }
      const newOrder = new Order({
        orderId,
        buyerId,
        sellerId: item.sellerId,
        productId: item.productId,
        amountPaid: item.price * item.quantity,
        status: product.type === "physical" ? "pending_delivery" : "completed",
        deliveryMethod: item.deliveryMethod,
        verificationQrCode: orderId,
        generatedFilePassword: filePassword,
        agentId: stationAgentId,
        selectedStation: item.selectedStation || null,
        selectedStation: item.selectedStation || null,
        createdAt: new Date().toISOString(),
      });
      await newOrder.save({ session });

      seller.pointsBalance += item.price * item.quantity;
      await seller.save({ session });
      const sellerTxId = `TXS-${uuidv4().split("-")[0].toUpperCase()}`;
      const sellerTransaction = new Transactions({
        transactionId: sellerTxId,
        userId: seller.uid,
        type: "payment",
        amountICash: item.price * item.quantity,
        status: "success",
        payType: "in",
        title: `Sale of ${product.title}`,
        reference: `REF-${orderId}`,
        metadata: { recipientId: buyerId },
        createdAt: new Date(),
      });
      await sellerTransaction.save({ session });
      processedResults.push({
        order: newOrder,
        sellerEmail: seller.email,
        sellerId: seller.uid,
        product,
        filePassword,
        buyerAddress: shippingContact.address,
        buyerPhoneNumber: shippingContact.phone,
        deliveryMethod: item.deliveryMethod,
      });
    }
    await session.commitTransaction();
    await sendOrderNotifications(buyer, processedResults);
    session.endSession();
    res
      .status(200)
      .json({ success: true, data: processedResults.map((r) => r.order) });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: error.message });
  }
};
export const cancelOrder = async (orderId) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const order = await Order.findOne({ orderId }).session(session);
    if (order.status !== "pending_delivery")
      throw new Error("Cannot cancel a completed order");
    await User.findOneAndUpdate(
      { uid: order.buyerId },
      { $inc: { pointsBalance: order.amountPaid } },
      { session },
    );
    await User.findOneAndUpdate(
      { uid: order.sellerId },
      { $inc: { pointsBalance: -order.amountPaid } },
      { session },
    );

    // 3. Create Refund Transaction Record
    const refundTx = new Transaction({
      transactionId: `REFUND-${uuidv4()}`,
      userId: order.buyerId,
      type: "payment",
      amountICash: order.amountPaid,
      payType: "in",
      title: `Refund for Order #${orderId}`,
      status: "success",
    });
    await refundTx.save({ session });

    // 4. Update Order Status
    order.status = "cancelled";
    await order.save({ session });

    await session.commitTransaction();
    return { success: true };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  }
};
