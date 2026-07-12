import {
  Product,
  User,
  ProductOrder,
  UserDownloads,
  Transactions,
  ProductImpression,
  ProductSales,
  Payout,
  DropOffStation,
  Follow,
} from "../tableDeclarations.js";
import { client as redis } from "../workers/reditFile.js";
import { createNotification } from "../services/notification.js";
import { v4 as uuidv4 } from "uuid";
import mongoose from "mongoose";
import { storage } from "../config/firebaseAdmin.js";
import {
  generateNotificationId,
  generateTransactionId,
  generatePayoutId,
  generateProductId,
} from "../utils/idGenerator.js";
import { calculateHaversineDistance } from "../utils/distanceCalHelper.js";
import fs from "fs/promises";
import { TAX_RATE, DELIVERY_FEES } from "../constants/inAppConstants.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { calculateDistribution } from "../utils/finance.js";

const now = new Date();
const formattedDate = now.toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const formattedTime = now.toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

async function sendOrderNotifications(buyer, processedItems, transactionId) {
  for (const {
    order,
    sellerEmail,
    product,
    fileUrl,
    sellerId,
  } of processedItems) {
    await createNotification({
      notificationId: generateNotificationId("store"),
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
        date: formattedDate,
        time: formattedTime,
      },
      sendPush: true,
      sendEmail: true,
      saveToDb: true,
    });
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: buyer.uid,
      recipientEmail: buyer.email,
      category: "finance",
      actionType: "MARKET_PURCHASE_DEBIT",
      title: "Purchase Confirmed",
      message: `Your purchase of ${product.title} was successful. ${
        fileUrl
          ? "Download File "
          : "Scan your QR code at the station or to seller to complete the transaction."
      }`,
      entityId: order.orderId,
      entityType: "order",
      payload: {
        orderId: order.orderId,
        productName: product.title,
        productType: product.type,
        amount: order.amountPaid,
        fileUrl: fileUrl,
        userName: buyer.firstname,
        transactionId: transactionId,
        date: formattedDate,
        time: formattedTime,
      },
      sendPush: true,
      sendEmail: true,
      saveToDb: true,
    });
  }
}
async function processNotificationFanOut(
  sellerUid,
  sellerName,
  product,
  isEditing,
) {
  if (isEditing) return;
  try {
    const followers = await Follow.find({ followingId: sellerUid }).lean();
    const sellerUser = await User.findOne({ uid: sellerUid })
      .select("email")
      .lean();
    const notificationPromises = [];
    if (sellerUser && sellerUser.email) {
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("store"),
          recipientId: sellerUid,
          recipientEmail: sellerUser.email,
          category: "store",
          actionType: "PRODUCT_CREATION",
          title: "Product Published",
          message: `Your item "${product.title}" has been successfully listed on the platform.`,
          entityId: product.productId,
          entityType: "product",
          sendEmail: true,
          payload: {
            productId: product.productId,
            productType: product.productType,
            productName: product.title,
            date: formattedDate,
            time: formattedTime,
          },
        }),
      );
    }
    if (followers && followers.length > 0) {
      const followerIds = followers.map((f) => f.followerId);
      const followerUsers = await User.find({ uid: { $in: followerIds } })
        .select("uid email")
        .lean();
      const emailMap = new Map(followerUsers.map((u) => [u.uid, u.email]));

      // Build out delivery tasks for every follower who has an email on file
      followers.forEach((follower) => {
        const recipientEmail = emailMap.get(follower.followerId);

        if (recipientEmail) {
          notificationPromises.push(
            createNotification({
              notificationId: generateNotificationId("store"),
              recipientId: follower.followerId,
              recipientEmail: recipientEmail,
              category: "store",
              actionType: "NEW_PRODUCT",
              title: sellerName,
              message: `has published a brand new item: "${product.title}"! Check it out now.`,
              entityId: product.productId,
              entityType: "product",
              sendEmail: true,
              payload: {
                productId: product.productId,
                productType: product.productType,
                productName: product.title,
                userName: sellerName,
              },
            }),
          );
        }
      });
    }
    if (notificationPromises.length > 0) {
      await Promise.all(notificationPromises);
    }
  } catch (error) {
    console.error(
      "Critical failure during background fan-out notification loop:",
      error,
    );
  }
}
export const fetchStoreProducts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchStoreProductsController";
  const action = "fetchStoreProducts";
  const { q, category, cursor, limit = 10 } = req.query;
  try {
    let query = { isAvailable: true };
    if (category && category !== "all" && category !== "popular") {
      query.category = category;
    }
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
    }
    if (cursor) {
      query._id = { $lt: cursor };
    }
    let sort = { createdAt: -1 };
    if (category === "popular") {
      sort = { favCount: -1, ratingsAverage: -1 };
    }
    const products = await Product.find(query).sort(sort).limit(Number(limit));
    const nextCursor =
      products.length === Number(limit)
        ? products[products.length - 1].productId
        : null;
    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ products, nextCursor });
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      err.message,
    );
    res.status(500).json({ message: err.message });
  }
};
export const fetchAllProducts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllProductsController";
  const action = "fetchAllProducts";
  const CACHE_KEY = "catalog:all_products";
  try {
    const cachedProducts = await redis.get(CACHE_KEY);

    if (cachedProducts) {
      logControllerPerformance(controllerName, action, startTime, "success");
      return res.status(200).json({
        success: true,
        products: JSON.parse(cachedProducts),
        source: "cache",
      });
    }
    const products = await Product.find({})
      .select(
        "title isAvailable priceInPoints mediaUrls productId courseDetails impressions sales category description ratings fileDetails type sellerId physicalDetails",
      )
      .lean();
    await redis.set(CACHE_KEY, JSON.stringify(products), {
      EX: 18000,
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      products,
      source: "database",
    });
  } catch (error) {
    console.error("Cache/DB Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
export const clearUserCart = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "clearUserCartController";
  const action = "clearUserCart";
  try {
    const userId = req.user.id;

    const updatedUser = await User.findOneAndUpdate(
      { uid: userId },
      { $set: { cart: [] } },
      { new: true },
    );

    if (!updatedUser) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      status: true,
      message: "Cart cleared successfully",
      cart: updatedUser.cart,
    });
  } catch (error) {
    console.error("Clear Cart Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({
      status: false,
      message: "An error occurred while clearing the cart",
    });
  }
};
export const bulkAddToCart = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "bulkAddToCartController";
  const action = "bulkAddToCart";
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
  logControllerPerformance(controllerName, action, startTime, "success");
  res.status(200).json({
    status: true,
    cart: user.cart,
    message: "Successfully moved all favorites to cart.",
  });
};
export const clearFavorites = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "clearFavoritesController";
  const action = "clearFavorites";
  const userId = req.user.id;
  await User.findOneAndUpdate({ uid: userId }, { $set: { favorites: [] } });
  logControllerPerformance(controllerName, action, startTime, "success");
  res.status(200).json({ status: true });
};
export const initializeCheckout = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "initializeCheckoutController";
  const action = "initializeCheckout";
  const { items, totals, shippingContact } = req.body;
  const buyerId = req.user.id;
  const session = await mongoose.startSession();
  const PAYOUT_FACTOR = 1 - TAX_RATE;
  try {
    session.startTransaction();
    const buyer = await User.findOne({ uid: buyerId }).session(session);
    if (!buyer || buyer.pointsBalance < totals.grandTotal) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Insufficient iCash balance to complete purchase or user not found.",
      );
      throw new Error(
        "Insufficient iCash balance to complete purchase or user not found.",
      );
    }
    buyer.pointsBalance -= totals.grandTotal;
    await buyer.save({ session });
    const buyerTxId = generateTransactionId("payment");
    const buyerTransaction = new Transactions({
      transactionId: buyerTxId,
      userId: buyerId,
      type: "payment",
      amountICash: totals.grandTotal,
      status: "success",
      payType: "out",
      title: `Purchase of ${items.length} item(s)`,
      reference: `REF-${buyerTxId}`,
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
      const tier = buyer.tier || "free";
      if (!product || !seller) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Product or Seller info not found.",
        );
        throw new Error("Product or Seller info not found.");
      }

      const orderId = `ORD-${uuidv4().split("-")[0].toUpperCase()}`;
      let filePassword = null;
      const isDropOff = item.deliveryMethod === "drop_off";
      const stationAgentId =
        isDropOff && item.selectedStation ? item.selectedStation.agentId : null;
      const itemTotal = item.price * item.quantity;
      if (product.type === "file" || product.type === "course") {
        const netEarnings = itemTotal * PAYOUT_FACTOR;
        seller.pendingSalesBalance += netEarnings;
        const salesIncrement = item.quantity || 1;
        await seller.save({ session });
        await Product.findOneAndUpdate(
          { productId: product.productId },
          { $inc: { sales: salesIncrement } },
          { session },
        );
        await new ProductSales({
          sellerId: item.sellerId,
          productId: item.productId,
          productType: product.type,
          quantity: item.quantity,
          amountPaid: itemTotal,
          buyerId,
          netEarnings: netEarnings,
        }).save({ session });
      }
      if (product.type === "course") {
        await UserDownloads.findOneAndUpdate(
          { userId: buyerId },
          { $addToSet: { ownedProducts: product.productId } },
          { upsert: true, session },
        );
      } else if (product.type === "physical") {
        const currentStock = product?.amountInStock || 1;
        if (currentStock < item.quantity) {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            `Insufficient stock for ${product.title}. Available: ${currentStock}`,
          );
          throw new Error(
            `Insufficient stock for ${product.title}. Available: ${currentStock}`,
          );
        }
        if (product.amountInStock !== undefined) {
          product.amountInStock -= item.quantity;
        }
        if (product?.amountInStock === 0) {
          product.isAvailable = false;
        }
      }
      const newOrder = new ProductOrder({
        orderId,
        buyerId,
        sellerId: item.sellerId,
        productId: item.productId,
        productName: product.title,
        amountPaid: itemTotal,
        quantity: item.quantity,
        status: product.type === "physical" ? "pending_delivery" : "completed",
        fileUrl: product.type === "file" ? product.fileUrl : null,
        deliveryMethod: item.deliveryMethod,
        verificationQrCode: orderId,
        agentId: stationAgentId,
        selectedStation: item.selectedStation || null,
        selectedStation: item.selectedStation || null,
        createdAt: new Date().toISOString(),
      });
      await newOrder.save({ session });
      await seller.save({ session });
      await product.save({ session });
      processedResults.push({
        order: newOrder,
        fileUrl: product.fileUrl,
        sellerEmail: seller.email,
        sellerId: seller.uid,
        product,
        buyerAddress: shippingContact.address,
        buyerPhoneNumber: shippingContact.phone,
        deliveryMethod: item.deliveryMethod,
      });
    }
    await session.commitTransaction();
    session.endSession();
    await sendOrderNotifications(buyer, processedResults, buyerTxId);
    await notifyAdmins(
      { role: ["super_admin", "finance"] },
      {
        actionType: "NEW_PURCHASE_ORDER",
        title: "New Purchase Order",
        message: `Order set #${buyerTxId} created with ${items.length} items.`,
        payload: { transactionId: buyerTxId, itemCount: items.length, buyerId },
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    res
      .status(200)
      .json({ success: true, data: processedResults.map((r) => r.order) });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const completeOrderDelivery = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "completeOrderDeliveryController";
  const action = "completeOrderDelivery";
  const { orderId } = req.body;
  const scannerUid = req.user.id;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const order = await ProductOrder.findOne({ orderId }).session(session);
    const salesIncrement = order.quantity || 1;
    if (!order) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Product order not found.",
      );
      throw new Error("Product order not found.");
    }
    if (order.status !== "pending_delivery" && order.status !== "dropped_off") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Product order is already processed or cancelled.",
      );
      throw new Error("Product order is already processed or cancelled.");
    }
    const isSeller = order.sellerId === scannerUid;
    const isAgent = order.agentId === scannerUid;
    if (!isSeller && !isAgent) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "You are not authorized to verify this delivery.",
      );
      throw new Error("You are not authorized to verify this delivery.");
    }
    const product = await Product.findOneAndUpdate(
      { productId: order.productId },
      { $inc: { sales: salesIncrement } },
      { session },
    );
    const seller = await User.findOne({ uid: order.sellerId }).session(session);
    const buyer = await User.findOne({ uid: order.buyerId }).session(session);
    if (!seller) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Seller account no longer exists.",
      );
      throw new Error("Seller account no longer exists.");
    }
    const buyerTier = buyer?.tier || "free";
    const deliveryFeeRate =
      DELIVERY_FEES[buyerTier]?.[order.deliveryMethod] || 0;
    const deliveryFeeAmount = order.amountPaid * deliveryFeeRate;
    const totalHeld = order.amountPaid;
    const taxAmount = totalHeld * TAX_RATE;
    const payableAmount = totalHeld - taxAmount;
    let sellerEarnings = payableAmount;
    let agentEarnings = 0;
    let agent;
    if (order.deliveryMethod === "drop_off" && order.agentId) {
      agent = await User.findOne({ uid: order.agentId }).session(session);
      if (!agent) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Drop-off agent not found.",
        );
        throw new Error("Drop-off agent not found.");
      }
      agentEarnings = deliveryFeeAmount * 0.5;
      const sellerDeliveryShare = deliveryFeeAmount * 0.5;
      sellerEarnings += sellerDeliveryShare;
      agent.pendingSalesBalance += agentEarnings;
      await agent.save({ session });
    } else if (order.deliveryMethod === "home_delivery") {
      const sellerDeliveryShare = deliveryFeeAmount * 0.7;
      sellerEarnings += sellerDeliveryShare;
    }
    seller.pendingSalesBalance += sellerEarnings;
    await seller.save({ session });

    order.status = "completed";
    order.completedAt = new Date().toISOString();
    await order.save({ session });

    await new ProductSales({
      sellerId: order.sellerId,
      productId: order.productId,
      orderId,
      productType: "physical",
      quantity: order.quantity || 1,
      buyerId: order.buyerId,
      amountPaid: order.amountPaid,
      netEarnings: sellerEarnings,
    }).save({ session });
    await session.commitTransaction();
    session.endSession();
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: order.buyerId,
      category: "store",
      actionType: "ORDER_REVIEW_REQUEST",
      title: "Share your experience",
      message: `How was your ${product.title}? Rate your experience to help the icampus community.`,
      payload: {
        orderId: order.orderId,
        productName: product.title,
        targetId: order.productId,
        userName: buyer ? buyer.firstname : "Valued User",
      },
    });
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: seller.uid,
      recipientEmail: seller.email,
      category: "finance",
      actionType: "ORDER_COMPLETED",
      title: "Payment Received",
      message: `Your sale for ${product.title} has been completed and funds released, proceed to payout to withdraw to your iCash wallet.`,
      payload: {
        amount: sellerEarnings,
        userName: seller.firstname,
        productName: product.title,
        orderId: orderId,
        role: "seller",
      },
      sendEmail: true,
    });
    if (order.deliveryMethod === "drop_off" && order.agentId) {
      await createNotification({
        notificationId: generateNotificationId("store"),
        recipientId: agent.uid,
        recipientEmail: agent.email,
        category: "finance",
        actionType: "ORDER_COMPLETED",
        title: "Delivery Commission Earned",
        message: `You earned ${agentEarnings} iCash for verifying order #${orderId}, proceed to payout to withdraw to your iCash wallet.`,
        payload: {
          amount: agentEarnings,
          userName: agent.firstname,
          productName: product.title,
          orderId: orderId,
          role: "agent",
        },
        sendEmail: true,
      });
    }
    await notifyAdmins(
      { role: ["super_admin", "finance"] },
      {
        actionType: "PURCHASE_ORDER_COMPLETION",
        title: "Order Completed",
        message: `Order #${orderId} has been completed and funds settled.`,
        payload: {
          orderId,
          sellerId: order.sellerId,
          buyerId: order.buyerId,
          agentId: order.agentId ? order.agentId : "",
        },
      },
      false,
    );
    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({
      success: true,
      orderId,
      settlementAmount: isSeller ? sellerEarnings : agentEarnings,
      role: isSeller ? "seller" : "agent",
      message: "Delivery verified and payments settled.",
      productName: product.title,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(400).json({ success: false, message: error.message });
  }
};
export const cancelOrder = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "cancelOrderController";
  const action = "cancelOrder";
  const { orderId, reason } = req.body;
  const userId = req.user.id;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    const order = await ProductOrder.findOne({
      orderId: orderId,
      buyerId: userId,
    }).session(session);
    if (!order || order.status !== "pending_delivery") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Order not found or you do not have permission to cancel it.",
      );
      throw new Error(
        "Order not found or you do not have permission to cancel it.",
      );
    }
    const buyer = await User.findOne({ uid: order.buyerId }).session(session);
    const seller = await User.findOne({ uid: order.sellerId }).session(session);
    const product = await Product.findOne({
      productId: order.productId,
    }).session(session);

    if (!seller) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Seller not found.",
      );
      throw new Error("Seller not found.");
    }
    buyer.pointsBalance += order.amountPaid;
    await buyer.save({ session });
    if (product && product.type === "physical") {
      product.amountInStock += order.quantity || 1;
      product.isAvailable = true;
      await product.save({ session });
    }
    order.status = "cancelled";
    order.cancellationReason = reason;
    await order.save({ session });
    await new Transactions({
      transactionId: generateTransactionId("refund"),
      userId: buyer.uid,
      type: "refund",
      amountICash: order.amountPaid,
      status: "success",
      payType: "in",
      title: `Refund of payment for ${product.title}`,
      reference: `REF-${orderId}`,
      createdAt: new Date(),
    }).save({ session });
    await session.commitTransaction();
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: seller.uid,
      recipientEmail: seller.email,
      category: "store",
      actionType: "ORDER_CANCELLED",
      title: "Order Cancelled by Buyer",
      message: `The order for "${product.title}" (#${orderId}) was cancelled. Reason: ${reason}`,
      payload: {
        orderId: orderId,
        productName: product.title,
        reason: reason,
        buyerName: buyer.firstname,
        date: formattedDate,
        time: formattedTime,
      },
      sendEmail: true,
    });
    await notifyAdmins(
      { role: ["super_admin", "finance"] },
      {
        actionType: "ORDER_CANCELLED_ADMIN",
        title: "Order Cancelled Audit",
        message: `Order #${orderId} has been cancelled. Buyer ${buyer.uid} refunded.`,
        payload: { orderId, sellerId: seller.uid, reason },
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      message: "Order cancelled, buyer refunded, and seller notified.",
    });
  } catch (error) {
    await session.abortTransaction();
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};
export const getPendingOrders = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getPendingOrdersController";
  const action = "getPendingOrders";
  try {
    const userId = req.user.id;
    const orders = await ProductOrder.find({
      buyerId: userId,
      status: { $in: ["pending_delivery", "dropped_off"] },
    }).sort({ createdAt: -1 });
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const logProductImpression = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "logProductImpressionController";
  const action = "logProductImpression";
  const { productId } = req.body;
  const userId = req.user.id;
  const currentMonthYear = new Date().toISOString().slice(0, 7);
  try {
    const logExists = await ProductImpression.findOne({
      userId,
      productId,
      monthYear: currentMonthYear,
    });
    if (!logExists) {
      await ProductImpression.create({
        userId,
        productId,
        monthYear: currentMonthYear,
      });
      await Product.findOneAndUpdate(
        { productId },
        { $inc: { impressions: 1 } },
      );
      return res
        .status(200)
        .json({ success: true, message: "Impression logged" });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      message: `${productId} impressions increment by ${userId} for ${currentMonthYear}`,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const getSellerSalesHistory = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getSellerSalesHistoryController";
  const action = "getSellerSalesHistory";
  try {
    const sellerId = req.user.id;
    if (!sellerId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized: Seller ID missing",
      );
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Seller ID missing",
      });
    }
    const sales = await ProductSales.find({ sellerId })
      .sort({ createdAt: -1 })
      .lean();

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      count: sales.length,
      data: sales,
    });
  } catch (error) {
    console.error("getSellerSalesHistory Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching sales records",
    });
  }
};
export const getPayoutHistory = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getPayoutHistoryController";
  const action = "getPayoutHistory";
  try {
    const userUid = req.user.id;
    if (!userUid) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User identification missing.",
      );
      return res.status(400).json({
        success: false,
        message: "User identification missing.",
      });
    }
    const history = await Payout.find({ sellerUid: userUid })
      .sort({ createdAt: -1 })
      .select("-__v");

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      data: history,
      message: "Payout history retrieved successfully.",
    });
  } catch (error) {
    console.error("Fetch Payout Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "An internal error occurred while fetching payout history.",
      error: error.message,
    });
  }
};
export const requestPayout = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "requestPayoutController";
  const action = "requestPayout";
  const { amount } = req.body;
  const userId = req.user.id;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findOne({ uid: userId }).session(session);

    if (!user) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "User not found.",
      );
      throw new Error("User not found.");
    }

    if (user.pendingSalesBalance < amount) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Insufficient pending balance.",
      );
      throw new Error("Insufficient pending balance.");
    }
    user.pendingSalesBalance -= amount;
    user.pointsBalance += amount;
    const payoutId = generatePayoutId(userId);
    const transactionId = generateTransactionId("payment");
    const newPayout = await Payout.create(
      [
        {
          payoutId,
          sellerUid: userId,
          amount: amount,
          status: "completed",
          method: "Internal Transfer",
          reference: `REF-${payoutId}`,
          processedAt: new Date(),
        },
      ],
      { session },
    );

    user.payoutHistory.push(newPayout[0].payoutId);
    await user.save({ session });
    const transaction = new Transactions({
      transactionId,
      userId,
      type: "payment",
      amountICash: amount,
      status: "success",
      payType: "in",
      title: `Sales Payout`,
      reference: `REF-${payoutId}`,
      createdAt: new Date(),
    });
    await transaction.save({ session });
    await session.commitTransaction();
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: userId,
      category: "finance",
      actionType: "SALES_PAYOUT_SUCCESS",
      title: "Sales Payout Credited",
      message: `${amount.toLocaleString()} iCash from your sales has been added to your wallet.`,
      recipientEmail: user.email,
      sendEmail: true,
      sendPush: true,
      payload: {
        username: user.firstname || user.lastname,
        amount: amount,
        payoutId: payoutId,
        transactionId: transactionId,
        date: formattedDate,
        time: formattedTime,
      },
    });
    await notifyAdmins(
      { role: ["finance", "super_admin"] },
      {
        actionType: "SALES_PAYOUT_ADMIN_ALERT",
        title: "New Sales Payout Processed",
        message: `User ${user.uid} successfully withdrew ${amount} iCash to their wallet.`,
        payload: { userId: user.uid, amount, payoutId, transactionId },
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    return {
      success: true,
      newPointsBalance: user.pointsBalance,
      transactionId: transactionId,
    };
  } catch (error) {
    await session.abortTransaction();
    console.error("Payout Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    throw error;
  } finally {
    session.endSession();
  }
};
export const getDropOffStations = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getDropOffStationsController";
  const action = "getDropOffStations";
  try {
    const { lat, lng } = req.query;
    const stations = await DropOffStation.find({}).lean();
    if (!lat || !lng) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Stations fetched successfully",
      );
      return res.status(200).json({
        success: true,
        message: "Stations fetched successfully",
        data: stations,
      });
    }
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    const stationsWithDistance = stations
      .map((station) => {
        const distance = calculateHaversineDistance(
          userLat,
          userLng,
          station.latitude,
          station.longitude,
          "km",
        );
        return {
          ...station,
          distance: distance,
        };
      })
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Closest stations fetched successfully",
      data: stationsWithDistance,
    });
  } catch (error) {
    console.error("Error fetching stations:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Internal server error processing station data",
    });
  }
};
export const saveProductController = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "saveProductController";
  const action = "saveProduct";
  try {
    const userUid = req.user.uid;
    const { productId } = req.params;
    const isEditing = !!productId;
    const { title, description, productType, price, mediaUrls } = req.body;

    if (!title || !description || !productType || !price) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required product fields.",
      );
      return res
        .status(400)
        .json({ success: false, message: "Missing required product fields." });
    }
    let productThumbnails = [];
    if (mediaUrls) {
      try {
        productThumbnails =
          typeof mediaUrls === "string" && mediaUrls.startsWith("[")
            ? JSON.parse(mediaUrls)
            : [mediaUrls];
      } catch (e) {
        productThumbnails = [mediaUrls];
      }
    }
    let courseDetails = null;
    let lessons = [];
    if (productType === "course") {
      const rawLecturersText = req.body.additionalLecturersRaw || "";
      let lecturerIds = [];

      if (rawLecturersText.trim()) {
        const inputNames = rawLecturersText
          .split(/[,;\n]+/)
          .map((name) => name.trim())
          .filter(Boolean);

        if (inputNames.length > 0) {
          const searchConditions = inputNames.flatMap((name) => [
            { firstname: { $regex: new RegExp(`^${name}$`, "i") } },
            { lastname: { $regex: new RegExp(`^${name}$`, "i") } },
            { username: { $regex: new RegExp(`^${name}$`, "i") } },
            {
              $expr: {
                $regexMatch: {
                  input: { $concat: ["$firstname", " ", "$lastname"] },
                  regex: name,
                  options: "i",
                },
              },
            },
          ]);
          const foundUsers = await User.find({ $or: searchConditions })
            .select("uid")
            .lean();
          lecturerIds = [...new Set(foundUsers.map((u) => u.uid))];
        }
      }
      courseDetails = {
        additionalLecturersRaw: rawLecturersText,
        lecturerIds: lecturerIds,
      };
      lessons = req.body.lessons ? JSON.parse(req.body.lessons) : [];
    }
    let physicalDetails = null;
    if (productType === "physical") {
      physicalDetails = {
        weightKg: Number(req.body.weightKg) || 0,
        inStock: Number(req.body.inStock) || 0,
        colors: req.body.colors ? JSON.parse(req.body.colors) : [],
        sizes: req.body.sizes ? JSON.parse(req.body.sizes) : [],
        sellerGateways: req.body.sellerGateways
          ? JSON.parse(req.body.sellerGateways)
          : [],
        dropOffAddress: req.body.dropOffAddress
          ? JSON.parse(req.body.dropOffAddress)
          : [],
      };
    }
    let fileDetails = null;

    if (isEditing) {
      const existingProduct = await Product.findOne({
        productId,
        sellerId: userUid,
      });

      if (!existingProduct) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Product not found.",
        );
        return res
          .status(404)
          .json({ success: false, message: "Product not found." });
      }

      if (productType === "file") {
        if (req.file) {
          if (existingProduct.fileDetails?.url) {
            await fs
              .unlink(existingProduct.fileDetails.url)
              .catch((err) =>
                console.error("Failed to delete stale digital asset:", err),
              );
          }
          fileDetails = {
            url: req.file.path,
            name: req.file.originalname,
            type: req.file.mimetype,
          };
        } else {
          fileDetails = existingProduct.fileDetails;
        }
      }
    } else {
      if (productType === "file" && req.file) {
        fileDetails = {
          url: req.file.path,
          name: req.file.originalname,
          type: req.file.mimetype,
        };
      }
    }
    let product;

    if (isEditing) {
      product = await Product.findOneAndUpdate(
        { productId: productId, sellerId: userUid },
        {
          title,
          description,
          productType,
          price,
          physicalDetails,
          courseDetails,
          lessons,
          fileDetails,
          mediaUrls: productThumbnails,
        },
        { new: true },
      );
      if (!product) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Product record not found or unauthorized editing access.",
        );
        return res.status(404).json({
          success: false,
          message: "Product record not found or unauthorized editing access.",
        });
      }
      await createNotification({
        notificationId: generateNotificationId("store"),
        recipientId: userUid,
        recipientEmail: req.user.email,
        category: "store",
        actionType: "PRODUCT_UPDATE",
        title: "Product Updated Successfully",
        message: `Your changes to "${product.title}" have been successfully saved.`,
        entityId: product.productId,
        entityType: "product",
        sendEmail: true,
        payload: {
          productId: product.productId,
          productType: product.productType,
          productName: product.title,
          price: product.price,
          date: formattedDate,
          time: formattedTime,
        },
      }).catch((err) =>
        console.error(
          "Non-blocking update notification tracking failure:",
          err,
        ),
      );
    } else {
      const newCustomId = generateProductId(userUid);
      product = new Product({
        productId: newCustomId,
        sellerId: userUid,
        title,
        description,
        productType,
        price,
        physicalDetails,
        courseDetails,
        lessons,
        fileDetails,
        mediaUrls: productThumbnails,
      });
      await product.save();
    }
    const seller = await User.findOne({ uid: userUid }).lean();
    const sellerName = seller ? seller.firstname : "A creator you follow";

    processNotificationFanOut(userUid, sellerName, product, isEditing).catch(
      (err) =>
        console.error("Background task pipeline error context captured:", err),
    );
    await notifyAdmins(
      { role: ["super_admin", "moderator"] },
      {
        actionType: isEditing ? "PRODUCT_UPDATE" : "PRODUCT_CREATION",
        title: isEditing ? "Product Updated" : "New Product Listed",
        message: `Product "${product.title}" was ${isEditing ? "updated" : "listed"} by ${sellerName}.`,
        payload: {
          productId: product.productId,
          productName: product.title,
          sellerId: userUid,
        },
      },
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(isEditing ? 200 : 201).json({
      success: true,
      message: isEditing
        ? "Product entry successfully patched."
        : "Product entry successfully saved.",
      data: product,
    });
  } catch (error) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    console.error(
      "Global crash layer hit in saveProductController:",
      error.message,
    );
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Internal application routing anomaly.",
    });
  }
};
export const deleteProductController = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "deleteProductController";
  const action = "deleteProduct";
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const userUid = req.user.uid;
    const { productId } = req.params;

    if (!productId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required product identification parameter.",
      );
      throw new Error("Missing required product identification parameter.");
    }
    const product = await Product.findOneAndDelete({
      productId: productId,
      sellerId: userUid,
    });
    if (!product) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Product record not found or unauthorized access.",
      );
      throw new Error("Product record not found or unauthorized access.");
    }
    await session.commitTransaction();
    if (product.productType === "file" && product.fileDetails?.fileUrl) {
      fs.unlink(product.fileDetails.fileUrl).catch((err) =>
        console.error(
          `Failed to delete local file asset at ${product.fileDetails.fileUrl}:`,
          err,
        ),
      );
    }
    if (product.thumbnails) {
      const thumbnailUrls = Array.isArray(product.thumbnails)
        ? product.thumbnails
        : [product.thumbnails];

      const bucket = storage().bucket();

      thumbnailUrls.forEach((url) => {
        if (url.includes("firebasestorage.googleapis.com")) {
          try {
            const decodedUrl = decodeURIComponent(url);
            const pathStartIndex = decodedUrl.indexOf("/o/") + 3;
            const pathEndIndex = decodedUrl.indexOf("?");
            const filePath =
              pathEndIndex !== -1
                ? decodedUrl.substring(pathStartIndex, pathEndIndex)
                : decodedUrl.substring(pathStartIndex);

            bucket
              .file(filePath)
              .delete()
              .catch((err) =>
                console.error(
                  `Firebase file deletion failed for path: ${filePath}`,
                  err,
                ),
              );
          } catch (parseError) {
            console.error(
              `Error parsing Firebase URL for deletion: ${url}`,
              parseError,
            );
          }
        }
      });
    }

    const seller = await User.findOne({ uid: userUid }).lean();
    const sellerEmail = seller ? seller.email : req.user.email;
    const sellerName = seller ? seller.firstname : req.user.firstname;
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: userUid,
      recipientEmail: sellerEmail,
      category: "store",
      actionType: "PRODUCT_DELETION",
      title: "Product Listing Removed",
      message: `Your marketplace item "${product.title}" has been successfully deleted.`,
      entityId: productId,
      entityType: "product",
      sendEmail: false,
      payload: {
        username: sellerName,
        productId: productId,
        productName: product.title,
        date: formattedDate,
        time: formattedTime,
      },
    }).catch((err) =>
      console.error("Non-blocking deletion log emission failure:", err),
    );
    await notifyAdmins(
      { role: ["super_admin", "moderator"] },
      {
        actionType: "PRODUCT_DELETION_ADMIN",
        title: "Product Deletion Audit",
        message: `Product "${product.title}" was deleted by seller ${userUid}.`,
        payload: { productId, productName: product.title, sellerId: userUid },
      },
    );
    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Product entry successfully unlinked and purged.",
      data: { productId },
    });
  } catch (error) {
    console.error(
      "Global crash layer hit in deleteProductController:",
      error.message,
    );
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({
      success: false,
      message: "Internal application routing anomaly.",
    });
  }
};
export const togglefavoriteActionController = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "togglefavoriteActionController";
  const action = "togglefavoriteAction";
  const { productId } = req.body;
  const userId = req.user.id;
  try {
    const user = await User.findOne({ uid: userId });
    if (!user) return res.status(404).json({ message: "User not found" });
    const isFavorited = user.favorites.includes(productId);

    const updateQuery = isFavorited
      ? { $pull: { favorites: productId } }
      : { $addToSet: { favorites: productId } };

    const updatedUser = await User.findOneAndUpdate(
      { uid: userId },
      updateQuery,
      { new: true },
    ).select("favorites");
    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({
      success: true,
      favorites: updatedUser.favorites,
      message: isFavorited ? "Removed from favorites" : "Added to favorites",
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const toggleCartActionController = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "toggleCartActionController";
  const controllerAction = "toggleCartAction";
  const {
    productId,
    action,
    selectedSize,
    selectedColor,
    quantity = 1,
  } = req.body;
  const userId = req.user.id;

  try {
    const user = await User.findOne({ uid: userId });
    if (!user) {
      logControllerPerformance(
        controllerName,
        controllerAction,
        startTime,
        "error",
        "User not found",
      );
      return res.status(404).json({ message: "User not found" });
    }

    let updatedUser;

    if (action === "add") {
      const cartItem = {
        productId,
        quantity,
        selectedSize,
        selectedColor,
      };
      updatedUser = await User.findOneAndUpdate(
        { uid: userId },
        { $addToSet: { cart: cartItem } },
        { new: true },
      ).select("cart");
    } else if (action === "remove") {
      updatedUser = await User.findOneAndUpdate(
        { uid: userId },
        { $pull: { cart: { productId: productId } } },
        { new: true },
      ).select("cart");
    } else if (action === "update") {
      updatedUser = await User.findOneAndUpdate(
        { uid: userId, "cart.productId": productId },
        { $set: { "cart.$.quantity": quantity } },
        { new: true },
      ).select("cart");
    }
    logControllerPerformance(
      controllerName,
      controllerAction,
      startTime,
      "success",
    );

    res.status(200).json({
      success: true,
      cart: updatedUser.cart,
      message: `Cart updated successfully`,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      controllerAction,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ success: false, message: error.message });
  }
};
export const markOrderAsDroppedOff = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markOrderAsDroppedOffController";
  const action = "markOrderAsDroppedOff";
  const { orderId } = req.body;
  const sellerId = req.user.id;
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const order = await ProductOrder.findOne({ orderId }).session(session);
    if (!order) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Order not found.",
      );
      throw new Error("Order not found.");
    }
    if (order.sellerId !== sellerId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized action.",
      );
      throw new Error("Unauthorized action.");
    }
    if (order.deliveryMethod !== "drop_off") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "This action is only valid for station drop-offs.",
      );
      throw new Error("This action is only valid for station drop-offs.");
    }

    order.status = "dropped_off";
    order.droppedOffAt = new Date().toISOString();
    await order.save({ session });
    const buyer = await User.findOne({ uid: order.buyerId }).session(session);
    await session.commitTransaction();
    session.endSession();
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: order.buyerId,
      recipientEmail: buyer.email,
      category: "store",
      actionType: "ORDER_DROPPED_OFF",
      sendEmail: true,
      payload: {
        userName: `${buyer.firstname} ${buyer.lastname}`,
        productName: order.productName,
        orderId: order.orderId,
        stationName: order.selectedStation.name,
        stationAddress: order.selectedStation.address,
      },
    });
    if (order.agentId) {
      await createNotification({
        notificationId: generateNotificationId("store"),
        recipientId: order.agentId,
        recipientEmail: agent.email,
        category: "store",
        actionType: "AGENT_AWAITING_PICKUP",
        sendEmail: true,
        payload: {
          agentName: agent.firstname,
          productName: order.productName,
          orderId: order.orderId,
          stationName: order.selectedStation.name,
          date: formattedDate,
          time: formattedTime,
        },
      });
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      message: "Order updated to dropped off. Buyer notified.",
      status: "dropped_off",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(400).json({ success: false, message: error.message });
  }
};