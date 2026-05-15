import {
  Product,
  User,
  ProductOrder,
  UserDownloads,
  Transactions,
  ProductImpression,
} from "../tableDeclarations.js";
import { client as redis } from "../workers/reditFile.js";
import { createNotification } from "../services/notification.js";
import { v4 as uuidv4 } from "uuid";
import mongoose from "mongoose";
import { generateNotificationId } from "../utils/idGenerator.js";

async function sendOrderNotifications(buyer, processedItems) {
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
        "title isAvailable priceInPoints mediaUrls productId courseDetails impressions sales category description ratings fileDetails type sellerId physicalDetails",
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
  const TAX_RATE = 0.02;
  const PAYOUT_FACTOR = 1 - TAX_RATE;
  try {
    session.startTransaction();
    const buyer = await User.findOne({ uid: buyerId }).session(session);
    if (!buyer || buyer.pointsBalance < totals.grandTotal) {
      throw new Error(
        "Insufficient iCash balance to complete purchase or user not found.",
      );
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
        throw new Error("Product or Seller info not found.");

      const orderId = `ORD-${uuidv4().split("-")[0].toUpperCase()}`;
      let filePassword = null;
      const isDropOff = item.deliveryMethod === "drop_off";
      const stationAgentId =
        isDropOff && item.selectedStation ? item.selectedStation.agentId : null;
      const itemTotal = item.price * item.quantity;
      if (product.type === "file" || product.type === "course") {
        const netEarnings = itemTotal * PAYOUT_FACTOR;
        seller.pointsBalance += netEarnings;
        const salesIncrement = item.quantity || 1;
        await seller.save({ session });
        await new Transactions({
          transactionId: `TXS-${uuidv4().split("-")[0].toUpperCase()}`,
          userId: seller.uid,
          type: "payment",
          amountICash: netEarnings,
          status: "success",
          payType: "in",
          title: `Payment for ${product.title}`,
          reference: `REF-${orderId}`,
          createdAt: new Date(),
        }).save({ session });
        await Product.findOneAndUpdate(
          { productId: product.productId },
          { $inc: { sales: salesIncrement } },
          { session },
        );
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
          throw new Error(
            `Insufficient stock for ${product.title}. Available: ${currentStock}`,
          );
        }
        product?.amountInStock -= item.quantity;
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
export const completeOrderDelivery = async (req, res) => {
  const { orderId } = req.body;
  const scannerUid = req.user.id;
  const session = await mongoose.startSession();
  const TAX_RATE = 0.02;
  const AGENT_RATE = 0.06;
  try {
    session.startTransaction();
    const order = await ProductOrder.findOne({ orderId }).session(session);
    const salesIncrement = order.quantity || 1;
    if (!order) throw new Error("Product order not found.");
    if (order.status !== "pending_delivery")
      throw new Error("Product order is already processed or cancelled.");
    const isSeller = order.sellerId === scannerUid;
    const isAgent = order.agentId === scannerUid;
    if (!isSeller && !isAgent) {
      throw new Error("You are not authorized to verify this delivery.");
    }
    const product = await Product.findOneAndUpdate(
      { productId: order.productId },
      { $inc: { sales: salesIncrement } },
      { session },
    );
    const seller = await User.findOne({ uid: order.sellerId }).session(session);
    const buyer = await User.findOne({ uid: order.buyerId }).session(session);
    if (!seller) throw new Error("Seller account no longer exists.");
    const totalHeld = order.amountPaid;
    const taxAmount = totalHeld * TAX_RATE;
    const payableAmount = totalHeld - taxAmount;
    let sellerEarnings = payableAmount;
    let agentEarnings = 0;
    if (order.deliveryMethod === "drop_off" && order.agentId) {
      const agent = await User.findOne({ uid: order.agentId }).session(session);
      if (!agent) throw new Error("Drop-off agent not found.");
      agentEarnings = payableAmount * AGENT_RATE;
      sellerEarnings -= agentEarnings;
      agent.pointsBalance += agentEarnings;
      await agent.save({ session });
      await new Transactions({
        transactionId: `TXA-${uuidv4().split("-")[0].toUpperCase()}`,
        userId: agent.uid,
        type: "payment",
        amountICash: agentEarnings,
        status: "success",
        payType: "in",
        title: `Delivery Fee: ${product.title}`,
        reference: `REF-${orderId}`,
        createdAt: new Date(),
      }).save({ session });
      await createNotification({
        notificationId: generateNotificationId("store"),
        recipientId: agent.uid,
        recipientEmail: agent.email,
        category: "finance",
        actionType: "ORDER_COMPLETED",
        title: "Delivery Commission Earned",
        message: `You earned ${agentEarnings} iCash for verifying order #${orderId}`,
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
    seller.pointsBalance += sellerEarnings;
    await seller.save({ session });

    order.status = "completed";
    order.completedAt = new Date().toISOString();
    await order.save({ session });

    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: seller.uid,
      recipientEmail: seller.email,
      category: "finance",
      actionType: "ORDER_COMPLETED",
      title: "Payment Received",
      message: `Your sale for ${product.title} has been completed and funds released.`,
      payload: {
        amount: sellerEarnings,
        userName: seller.firstname,
        productName: product.title,
        orderId: orderId,
        role: "seller",
      },
      sendEmail: true,
    });
    await new Transactions({
      transactionId: `TXA-${uuidv4().split("-")[0].toUpperCase()}`,
      userId: seller.uid,
      type: "payment",
      amountICash: sellerEarnings,
      status: "success",
      payType: "in",
      title: `Delivery Fee: ${product.title}`,
      reference: `REF-${orderId}`,
      createdAt: new Date(),
    }).save({ session });
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
        userName: buyer ? buyer.firstname : "Valued User",
      },
    });
    await session.commitTransaction();
    session.endSession();

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
    res.status(400).json({ success: false, message: error.message });
  }
};
export const cancelOrder = async (req, res) => {
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
      throw new Error(
        "Order not found or you do not have permission to cancel it.",
      );
    }
    const buyer = await User.findOne({ uid: order.buyerId }).session(session);
    const seller = await User.findOne({ uid: order.sellerId }).session(session);
    const product = await Product.findOne({
      productId: order.productId,
    }).session(session);

    if (!seller) throw new Error("Seller not found.");
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
      title: `Refund: ${product.title}`,
      reference: `REF-${orderId}`,
      createdAt: new Date(),
    }).save({ session });
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
      },
      sendEmail: true,
    });
    await session.commitTransaction();
    res.status(200).json({
      success: true,
      message: "Order cancelled, buyer refunded, and seller notified.",
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};
export const getPendingOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await ProductOrder.find({
      buyerId: userId,
      status: "pending_delivery",
    }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const logProductImpression = async (req, res) => {
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
    res.status(200).json({
      success: true,
      message: `${productId} impressions increment by ${userId} for ${currentMonthYear}`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
