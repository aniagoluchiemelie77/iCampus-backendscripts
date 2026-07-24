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
  TaxEntries,
} from "../tableDeclarations.js";
import { client as redis } from "../workers/reditFile.js";
import { createNotification } from "../services/notification.js";
import { v4 as uuidv4 } from "uuid";
import { storage, db } from "../config/firebaseAdmin.js";
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
    const followSnapshot = await Follow.where(
      "followingId",
      "==",
      sellerUid,
    ).get();
    const followers = [];
    followSnapshot.forEach((doc) => {
      followers.push(doc.data());
    });
    const sellerQuery = await User.where("uid", "==", sellerUid).limit(1).get();
    let sellerEmail = null;
    if (!sellerQuery.empty) {
      sellerEmail = sellerQuery.docs[0].data().email;
    }

    const notificationPromises = [];
    const formattedDate = new Date().toLocaleDateString();
    const formattedTime = new Date().toLocaleTimeString();

    if (sellerEmail) {
      notificationPromises.push(
        createNotification({
          notificationId: generateNotificationId("store"),
          recipientId: sellerUid,
          recipientEmail: sellerEmail,
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

    if (followers.length > 0) {
      const followerIds = followers.map((f) => f.followerId);
      const emailMap = new Map();
      const chunks = [];
      for (let i = 0; i < followerIds.length; i += 30) {
        chunks.push(followerIds.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        const userSnapshot = await User.where("uid", "in", chunk).get();
        userSnapshot.forEach((doc) => {
          const u = doc.data();
          if (u.uid && u.email) {
            emailMap.set(u.uid, u.email);
          }
        });
      }
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
  const pageLimit = Number(limit);

  try {
    let queryRef = Product.where("isAvailable", "==", true);

    if (category && category !== "all" && category !== "popular") {
      queryRef = queryRef.where("category", "==", category);
    }
    const isPopular = category === "popular";
    const snapshot = await queryRef.get();
    let products = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      products.push({ id: doc.id, ...data });
    });
    if (q) {
      const searchTerm = q.toLowerCase().trim();
      products = products.filter((p) => {
        const title = (p.title || "").toLowerCase();
        const description = (p.description || "").toLowerCase();
        return title.includes(searchTerm) || description.includes(searchTerm);
      });
    }
    products.sort((a, b) => {
      if (isPopular) {
        const favA = a.favCount || 0;
        const favB = b.favCount || 0;
        if (favB !== favA) return favB - favA;

        const ratingA = a.ratingsAverage || 0;
        const ratingB = b.ratingsAverage || 0;
        return ratingB - ratingA;
      } else {
        const timeA = a.createdAt?.toDate
          ? a.createdAt.toDate().getTime()
          : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.toDate
          ? b.createdAt.toDate().getTime()
          : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      }
    });
    if (cursor) {
      const cursorIndex = products.findIndex(
        (p) => (p.productId || p.id) === cursor,
      );
      if (cursorIndex !== -1) {
        products = products.slice(cursorIndex + 1);
      }
    }
    const paginatedProducts = products.slice(0, pageLimit);

    const nextCursor =
      paginatedProducts.length === pageLimit
        ? paginatedProducts[paginatedProducts.length - 1].productId ||
          paginatedProducts[paginatedProducts.length - 1].id
        : null;

    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ products: paginatedProducts, nextCursor });
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

    const snapshot = await Product.get();
    const products = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const projectedProduct = {
        id: doc.id,
        title: data.title,
        isAvailable: data.isAvailable,
        priceInPoints: data.priceInPoints,
        mediaUrls: data.mediaUrls,
        productId: data.productId,
        courseDetails: data.courseDetails,
        impressions: data.impressions,
        sales: data.sales,
        category: data.category,
        description: data.description,
        ratings: data.ratings,
        fileDetails: data.fileDetails,
        type: data.type,
        sellerId: data.sellerId,
        physicalDetails: data.physicalDetails,
      };
      products.push(projectedProduct);
    });

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
    const userId = req.user.id || req.user.uid;

    const userQuery = await User.where("uid", "==", userId).limit(1).get();

    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];

    await userDoc.ref.update({
      cart: [],
      updatedAt: new Date(),
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      status: true,
      message: "Cart cleared successfully",
      cart: [],
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
  const userId = req.user.id || req.user.uid;

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();

    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const currentCart = userData.cart || [];

    const newCart = [...currentCart];
    if (items && Array.isArray(items)) {
      items.forEach((newItem) => {
        if (!newCart.some((item) => item.productId === newItem.productId)) {
          newCart.push(newItem);
        }
      });
    }

    await userDoc.ref.update({
      cart: newCart,
      updatedAt: new Date(),
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      status: true,
      cart: newCart,
      message: "Successfully moved all favorites to cart.",
    });
  } catch (error) {
    console.error("Bulk Add To Cart Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({
      status: false,
      message: "An error occurred while adding items to cart",
    });
  }
};
export const clearFavorites = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "clearFavoritesController";
  const action = "clearFavorites";
  const userId = req.user.id || req.user.uid;

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();

    if (userQuery.empty) {
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

    const userDoc = userQuery.docs[0];

    await userDoc.ref.update({
      favorites: [],
      updatedAt: new Date(),
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ status: true });
  } catch (error) {
    console.error("Clear Favorites Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({
      status: false,
      message: "An error occurred while clearing favorites",
    });
  }
};
export const initializeCheckout = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "initializeCheckoutController";
  const action = "initializeCheckout";
  const { items, totals, shippingContact } = req.body;
  const buyerId = req.user.id || req.user.uid;
  const PAYOUT_FACTOR = 1 - TAX_RATE;
  try {
    const processedResults = await db.runTransaction(async (transaction) => {
      const buyerQuery = await User.where("uid", "==", buyerId).limit(1).get();
      if (buyerQuery.empty) {
        throw new Error(
          "Insufficient iCash balance to complete purchase or user not found.",
        );
      }

      const buyerDoc = buyerQuery.docs[0];
      const buyerData = buyerDoc.data();
      const currentBalance = buyerData.pointsBalance || 0;

      if (currentBalance < totals.grandTotal) {
        throw new Error(
          "Insufficient iCash balance to complete purchase or user not found.",
        );
      }
      const newBuyerBalance = currentBalance - totals.grandTotal;
      transaction.update(buyerDoc.ref, {
        pointsBalance: newBuyerBalance,
        updatedAt: new Date(),
      });
      const buyerTxId = generateTransactionId("payment");
      const buyerTransactionRef = Transactions.doc(buyerTxId);
      const buyerTransaction = {
        transactionId: buyerTxId,
        userId: buyerId,
        type: "payment",
        amountICash: totals.grandTotal,
        status: "success",
        payType: "out",
        title: `Purchase of ${items.length} item(s)`,
        reference: `REF-${buyerTxId}`,
        createdAt: new Date(),
      };
      transaction.set(buyerTransactionRef, buyerTransaction);

      const results = [];
      for (const item of items) {
        const productQuery = await Product.where(
          "productId",
          "==",
          item.productId,
        )
          .limit(1)
          .get();
        if (productQuery.empty) {
          throw new Error("Product or Seller info not found.");
        }
        const productDoc = productQuery.docs[0];
        const productData = productDoc.data();
        const sellerQuery = await User.where("uid", "==", item.sellerId)
          .limit(1)
          .get();
        if (sellerQuery.empty) {
          throw new Error("Product or Seller info not found.");
        }
        const sellerDoc = sellerQuery.docs[0];
        const sellerData = sellerDoc.data();

        const orderId = `ORD-${uuidv4().split("-")[0].toUpperCase()}`;
        const isDropOff = item.deliveryMethod === "drop_off";
        const stationAgentId =
          isDropOff && item.selectedStation
            ? item.selectedStation.agentId
            : null;
        const itemTotal = item.price * item.quantity;
        const netEarnings = itemTotal * PAYOUT_FACTOR;
        const productTaxAmount = itemTotal - netEarnings;
        if (productTaxAmount > 0) {
          const taxEntryId = generateTransactionId("appTax");
          const taxDocRef = TaxEntries.doc(taxEntryId);

          transaction.set(taxDocRef, {
            transactionReference: `REF-${buyerTxId}`,
            taxType: "product_tax",
            amount: productTaxAmount,
            currency: "iCash",
            date: new Date(),
            sourceDetails: {
              buyerId: buyerId,
              sellerId: item.sellerId,
              productId: item.productId,
              relatedTransactionId: orderId,
            },
            createdAt: new Date(),
          });
        }
        if (productData.type === "file" || productData.type === "course") {
          const updatedPendingSales =
            (sellerData.pendingSalesBalance || 0) + netEarnings;
          const salesIncrement =
            (productData.sales || 0) + (item.quantity || 1);

          transaction.update(sellerDoc.ref, {
            pendingSalesBalance: updatedPendingSales,
            updatedAt: new Date(),
          });

          transaction.update(productDoc.ref, {
            sales: salesIncrement,
            updatedAt: new Date(),
          });

          const productSaleRef = ProductSales.doc();
          transaction.set(productSaleRef, {
            sellerId: item.sellerId,
            productId: item.productId,
            productType: productData.type,
            quantity: item.quantity,
            amountPaid: itemTotal,
            buyerId,
            netEarnings,
            createdAt: new Date(),
          });
        }
        if (productData.type === "course") {
          const downloadQuery = await UserDownloads.where(
            "userId",
            "==",
            buyerId,
          )
            .limit(1)
            .get();
          if (downloadQuery.empty) {
            const newDownloadRef = UserDownloads.doc();
            transaction.set(newDownloadRef, {
              userId: buyerId,
              ownedProducts: [productData.productId],
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } else {
            const downloadDoc = downloadQuery.docs[0];
            const ownedProducts = downloadDoc.data().ownedProducts || [];
            if (!ownedProducts.includes(productData.productId)) {
              ownedProducts.push(productData.productId);
              transaction.update(downloadDoc.ref, {
                ownedProducts,
                updatedAt: new Date(),
              });
            }
          }
        } else if (productData.type === "physical") {
          const currentStock = productData.amountInStock ?? 1;
          if (currentStock < item.quantity) {
            throw new Error(
              `Insufficient stock for ${productData.title}. Available: ${currentStock}`,
            );
          }

          const updatedStock = currentStock - item.quantity;
          const productUpdates = {
            amountInStock: updatedStock,
            updatedAt: new Date(),
          };
          if (updatedStock === 0) {
            productUpdates.isAvailable = false;
          }
          transaction.update(productDoc.ref, productUpdates);
        }
        const newOrderRef = ProductOrder.doc(orderId);
        const newOrder = {
          orderId,
          buyerId,
          sellerId: item.sellerId,
          productId: item.productId,
          productName: productData.title,
          amountPaid: itemTotal,
          quantity: item.quantity,
          status:
            productData.type === "physical" ? "pending_delivery" : "completed",
          fileUrl:
            productData.type === "file"
              ? productData.fileUrl || productData.fileDetails?.fileUrl
              : null,
          deliveryMethod: item.deliveryMethod,
          verificationQrCode: orderId,
          agentId: stationAgentId,
          selectedStation: item.selectedStation || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date(),
        };
        transaction.set(newOrderRef, newOrder);

        results.push({
          order: newOrder,
          fileUrl: newOrder.fileUrl,
          sellerEmail: sellerData.email,
          sellerId: sellerData.uid,
          product: productData,
          buyerAddress: shippingContact.address,
          buyerPhoneNumber: shippingContact.phone,
          deliveryMethod: item.deliveryMethod,
        });
      }

      return { processedResults: results, buyerTxId };
    });
    const buyerQuery = await User.where("uid", "==", buyerId).limit(1).get();
    const buyerData = !buyerQuery.empty
      ? buyerQuery.docs[0].data()
      : { uid: buyerId };

    await sendOrderNotifications(
      buyerData,
      processedResults.processedResults,
      processedResults.buyerTxId,
    );
    await notifyAdmins(
      { role: ["super_admin", "finance"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: "NEW_PURCHASE_ORDER",
        title: "New Purchase Order",
        message: `Order set #${processedResults.buyerTxId} created with ${items.length} items.`,
        payload: {
          transactionId: processedResults.buyerTxId,
          itemCount: items.length,
          buyerId,
        },
      },
      false,
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      data: processedResults.processedResults.map((r) => r.order),
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
export const completeOrderDelivery = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "completeOrderDeliveryController";
  const action = "completeOrderDelivery";
  const { orderId } = req.body;
  const scannerUid = req.user.id || req.user.uid;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const orderDocRef = ProductOrder.doc(orderId);
      const orderDoc = await transaction.get(orderDocRef);

      if (!orderDoc.exists) {
        throw new Error("Product order not found.");
      }

      const order = orderDoc.data();
      const salesIncrement = order.quantity || 1;

      if (
        order.status !== "pending_delivery" &&
        order.status !== "dropped_off"
      ) {
        throw new Error("Product order is already processed or cancelled.");
      }

      const isSeller = order.sellerId === scannerUid;
      const isAgent = order.agentId === scannerUid;

      if (!isSeller && !isAgent) {
        throw new Error("You are not authorized to verify this delivery.");
      }
      const productQuery = await Product.where(
        "productId",
        "==",
        order.productId,
      )
        .limit(1)
        .get();
      if (productQuery.empty) {
        throw new Error("Product not found.");
      }
      const productDoc = productQuery.docs[0];
      const productData = productDoc.data();

      const sellerQuery = await User.where("uid", "==", order.sellerId)
        .limit(1)
        .get();
      if (sellerQuery.empty) {
        throw new Error("Seller account no longer exists.");
      }
      const sellerDoc = sellerQuery.docs[0];
      const seller = sellerDoc.data();

      const buyerQuery = await User.where("uid", "==", order.buyerId)
        .limit(1)
        .get();
      const buyer = !buyerQuery.empty ? buyerQuery.docs[0].data() : null;

      const buyerTier = buyer?.tier || "free";
      const deliveryFeeRate =
        DELIVERY_FEES?.[buyerTier]?.[order.deliveryMethod] || 0;
      const deliveryFeeAmount = order.amountPaid * deliveryFeeRate;
      const totalHeld = order.amountPaid;
      const taxAmount = totalHeld * TAX_RATE;
      const payableAmount = totalHeld - taxAmount;

      let sellerEarnings = payableAmount;
      let agentEarnings = 0;
      let agentDoc = null;
      let agentData = null;

      if (order.deliveryMethod === "drop_off" && order.agentId) {
        const agentQuery = await User.where("uid", "==", order.agentId)
          .limit(1)
          .get();
        if (agentQuery.empty) {
          throw new Error("Drop-off agent not found.");
        }
        agentDoc = agentQuery.docs[0];
        agentData = agentDoc.data();

        agentEarnings = deliveryFeeAmount * 0.5;
        const sellerDeliveryShare = deliveryFeeAmount * 0.5;
        sellerEarnings += sellerDeliveryShare;

        const updatedAgentPending =
          (agentData.pendingSalesBalance || 0) + agentEarnings;
        transaction.update(agentDoc.ref, {
          pendingSalesBalance: updatedAgentPending,
          updatedAt: new Date(),
        });
      } else if (order.deliveryMethod === "home_delivery") {
        const sellerDeliveryShare = deliveryFeeAmount * 0.7;
        sellerEarnings += sellerDeliveryShare;
      }

      const updatedSellerPending =
        (seller.pendingSalesBalance || 0) + sellerEarnings;
      transaction.update(sellerDoc.ref, {
        pendingSalesBalance: updatedSellerPending,
        updatedAt: new Date(),
      });
      const currentSales = productData.sales || 0;
      transaction.update(productDoc.ref, {
        sales: currentSales + salesIncrement,
        updatedAt: new Date(),
      });
      const completedAtTime = new Date().toISOString();
      transaction.update(orderDocRef, {
        status: "completed",
        completedAt: completedAtTime,
        updatedAt: new Date(),
      });
      const productSaleRef = ProductSales.doc();
      transaction.set(productSaleRef, {
        sellerId: order.sellerId,
        productId: order.productId,
        orderId,
        productType: "physical",
        quantity: order.quantity || 1,
        buyerId: order.buyerId,
        amountPaid: order.amountPaid,
        netEarnings: sellerEarnings,
        createdAt: new Date(),
      });

      return {
        productTitle: productData.title,
        buyer,
        seller,
        agent: agentData,
        sellerEarnings,
        agentEarnings,
        isSeller,
      };
    });
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: orderId.buyerId || result.buyer?.uid, // fallback safe handling
      category: "store",
      actionType: "ORDER_REVIEW_REQUEST",
      title: "Share your experience",
      message: `How was your ${result.productTitle}? Rate your experience to help the icampus community.`,
      payload: {
        orderId: orderId,
        productName: result.productTitle,
        targetId: orderId,
        userName: result.buyer ? result.buyer.firstname : "Valued User",
      },
    });

    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: result.seller.uid,
      recipientEmail: result.seller.email,
      category: "finance",
      actionType: "ORDER_COMPLETED",
      title: "Payment Received",
      message: `Your sale for ${result.productTitle} has been completed and funds released, proceed to payout to withdraw to your iCash wallet.`,
      payload: {
        amount: result.sellerEarnings,
        userName: result.seller.firstname,
        productName: result.productTitle,
        orderId: orderId,
        role: "seller",
      },
      sendEmail: true,
    });

    if (result.agent) {
      await createNotification({
        notificationId: generateNotificationId("store"),
        recipientId: result.agent.uid,
        recipientEmail: result.agent.email,
        category: "finance",
        actionType: "ORDER_COMPLETED",
        title: "Delivery Commission Earned",
        message: `You earned ${result.agentEarnings} iCash for verifying order #${orderId}, proceed to payout to withdraw to your iCash wallet.`,
        payload: {
          amount: result.agentEarnings,
          userName: result.agent.firstname,
          productName: result.productTitle,
          orderId: orderId,
          role: "agent",
        },
        sendEmail: true,
      });
    }

    await notifyAdmins(
      { role: ["super_admin", "finance"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: "PURCHASE_ORDER_COMPLETION",
        title: "Order Completed",
        message: `Order #${orderId} has been completed and funds settled.`,
        payload: {
          orderId,
          sellerId: result.seller.uid,
          buyerId: result.buyer?.uid || "",
          agentId: result.agent ? result.agent.uid : "",
        },
      },
      false,
    );

    logControllerPerformance(controllerName, action, startTime, "success");

    return res.status(200).json({
      success: true,
      orderId,
      settlementAmount: result.isSeller
        ? result.sellerEarnings
        : result.agentEarnings,
      role: result.isSeller ? "seller" : "agent",
      message: "Delivery verified and payments settled.",
      productName: result.productTitle,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(400).json({ success: false, message: error.message });
  }
};
export const cancelOrder = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "cancelOrderController";
  const action = "cancelOrder";
  const { orderId, reason } = req.body;
  const userId = req.user.id || req.user.uid;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const orderDocRef = ProductOrder.doc(orderId);
      const orderDoc = await transaction.get(orderDocRef);

      if (!orderDoc.exists) {
        throw new Error(
          "Order not found or you do not have permission to cancel it.",
        );
      }

      const order = orderDoc.data();

      if (order.buyerId !== userId || order.status !== "pending_delivery") {
        throw new Error(
          "Order not found or you do not have permission to cancel it.",
        );
      }
      const buyerQuery = await User.where("uid", "==", order.buyerId)
        .limit(1)
        .get();
      if (buyerQuery.empty) {
        throw new Error("User not found.");
      }
      const buyerDoc = buyerQuery.docs[0];
      const buyer = buyerDoc.data();

      const sellerQuery = await User.where("uid", "==", order.sellerId)
        .limit(1)
        .get();
      if (sellerQuery.empty) {
        throw new Error("Seller not found.");
      }
      const sellerDoc = sellerQuery.docs[0];
      const seller = sellerDoc.data();

      const productQuery = await Product.where(
        "productId",
        "==",
        order.productId,
      )
        .limit(1)
        .get();
      const productDoc = !productQuery.empty ? productQuery.docs[0] : null;
      const productData = productDoc ? productDoc.data() : null;
      const productTitle = productData ? productData.title : "Product";
      const newPointsBalance = (buyer.pointsBalance || 0) + order.amountPaid;
      transaction.update(buyerDoc.ref, {
        pointsBalance: newPointsBalance,
        updatedAt: new Date(),
      });
      if (productDoc && productData && productData.type === "physical") {
        const currentStock = productData.amountInStock || 0;
        const refundQuantity = order.quantity || 1;
        transaction.update(productDoc.ref, {
          amountInStock: currentStock + refundQuantity,
          isAvailable: true,
          updatedAt: new Date(),
        });
      }
      const nowIso = new Date().toISOString();
      transaction.update(orderDocRef, {
        status: "cancelled",
        cancellationReason: reason,
        updatedAt: new Date(),
      });

      const refundTxId = generateTransactionId("refund");
      const refundTxRef = Transactions.doc(refundTxId);
      transaction.set(refundTxRef, {
        transactionId: refundTxId,
        userId: buyer.uid,
        type: "refund",
        amountICash: order.amountPaid,
        status: "success",
        payType: "in",
        title: `Refund of payment for ${productTitle}`,
        reference: `REF-${orderId}`,
        createdAt: new Date(),
      });

      return {
        seller,
        buyer,
        productTitle,
        refundTxId,
      };
    });
    const currentDate = new Date();
    const formattedDate = currentDate.toLocaleDateString();
    const formattedTime = currentDate.toLocaleTimeString();

    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: result.seller.uid,
      recipientEmail: result.seller.email,
      category: "store",
      actionType: "ORDER_CANCELLED",
      title: "Order Cancelled by Buyer",
      message: `The order for "${result.productTitle}" (#${orderId}) was cancelled. Reason: ${reason}`,
      payload: {
        orderId: orderId,
        productName: result.productTitle,
        reason: reason,
        buyerName: result.buyer.firstname || "Buyer",
        date: formattedDate,
        time: formattedTime,
      },
      sendEmail: true,
    });

    await notifyAdmins(
      { role: ["super_admin", "finance"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: "ORDER_CANCELLED_ADMIN",
        title: "Order Cancelled Audit",
        message: `Order #${orderId} has been cancelled. Buyer ${result.buyer.uid} refunded.`,
        payload: { orderId, sellerId: result.seller.uid, reason },
      },
      false,
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Order cancelled, buyer refunded, and seller notified.",
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(400).json({ success: false, message: error.message });
  }
};
export const getPendingOrders = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getPendingOrdersController";
  const action = "getPendingOrders";

  try {
    const userId = req.user.id || req.user.uid;

    const snapshot = await ProductOrder.where("buyerId", "==", userId)
      .where("status", "in", ["pending_delivery", "dropped_off"])
      .get();

    const orders = [];
    snapshot.forEach((doc) => {
      orders.push(doc.data());
    });
    orders.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ success: false, message: error.message });
  }
};
export const logProductImpression = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "logProductImpressionController";
  const action = "logProductImpression";
  const { productId } = req.body;
  const userId = req.user.id || req.user.uid;
  const currentMonthYear = new Date().toISOString().slice(0, 7);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const impressionQuery = await ProductImpression.where(
        "userId",
        "==",
        userId,
      )
        .where("productId", "==", productId)
        .where("monthYear", "==", currentMonthYear)
        .limit(1)
        .get();

      const productQuery = await Product.where("productId", "==", productId)
        .limit(1)
        .get();
      const productDoc = !productQuery.empty ? productQuery.docs[0] : null;

      if (impressionQuery.empty) {
        const newImpressionRef = ProductImpression.doc();
        transaction.set(newImpressionRef, {
          userId,
          productId,
          monthYear: currentMonthYear,
          createdAt: new Date(),
        });

        if (productDoc) {
          const currentImpressions = productDoc.data().impressions || 0;
          transaction.update(productDoc.ref, {
            impressions: currentImpressions + 1,
            updatedAt: new Date(),
          });
        }

        return {
          newlyLogged: true,
          message: "Impression logged",
        };
      }

      return {
        newlyLogged: false,
        message: `${productId} impressions increment by ${userId} for ${currentMonthYear}`,
      };
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ success: false, message: error.message });
  }
};
export const getSellerSalesHistory = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getSellerSalesHistoryController";
  const action = "getSellerSalesHistory";
  try {
    const sellerId = req.user.id || req.user.uid;
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

    const snapshot = await ProductSales.where("sellerId", "==", sellerId).get();

    const sales = [];
    snapshot.forEach((doc) => {
      sales.push({ id: doc.id, ...doc.data() });
    });
    sales.sort((a, b) => {
      const timeA = a.createdAt?.toDate
        ? a.createdAt.toDate().getTime()
        : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toDate
        ? b.createdAt.toDate().getTime()
        : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

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
    const userUid = req.user.id || req.user.uid;
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

    const snapshot = await Payout.where("sellerUid", "==", userUid).get();

    const history = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const { __v, ...cleanData } = data;
      history.push({ id: doc.id, ...cleanData });
    });
    history.sort((a, b) => {
      const timeA = a.createdAt?.toDate
        ? a.createdAt.toDate().getTime()
        : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toDate
        ? b.createdAt.toDate().getTime()
        : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

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
  const userId = req.user.id || req.user.uid;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userQuery = await User.where("uid", "==", userId).limit(1).get();
      if (userQuery.empty) {
        throw new Error("User not found.");
      }

      const userDoc = userQuery.docs[0];
      const user = userDoc.data();
      const currentPendingBalance = user.pendingSalesBalance || 0;

      if (currentPendingBalance < amount) {
        throw new Error("Insufficient pending balance.");
      }
      const newPendingBalance = currentPendingBalance - amount;
      const newPointsBalance = (user.pointsBalance || 0) + amount;
      const payoutHistory = user.payoutHistory || [];

      const payoutId = generatePayoutId(userId);
      const transactionId = generateTransactionId("payment");

      payoutHistory.push(payoutId);

      transaction.update(userDoc.ref, {
        pendingSalesBalance: newPendingBalance,
        pointsBalance: newPointsBalance,
        payoutHistory: payoutHistory,
        updatedAt: new Date(),
      });

      const payoutRef = Payout.doc(payoutId);
      const newPayoutData = {
        payoutId,
        sellerUid: userId,
        amount: amount,
        status: "completed",
        method: "Internal Transfer",
        reference: `REF-${payoutId}`,
        processedAt: new Date(),
        createdAt: new Date(),
      };
      transaction.set(payoutRef, newPayoutData);
      const transactionRef = Transactions.doc(transactionId);
      const newTransactionData = {
        transactionId,
        userId,
        type: "payment",
        amountICash: amount,
        status: "success",
        payType: "in",
        title: `Sales Payout`,
        reference: `REF-${payoutId}`,
        createdAt: new Date(),
      };
      transaction.set(transactionRef, newTransactionData);

      return {
        user,
        newPointsBalance,
        payoutId,
        transactionId,
      };
    });
    const currentDate = new Date();
    const formattedDate = currentDate.toLocaleDateString();
    const formattedTime = currentDate.toLocaleTimeString();

    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: userId,
      category: "finance",
      actionType: "SALES_PAYOUT_SUCCESS",
      title: "Sales Payout Credited",
      message: `${amount.toLocaleString()} iCash from your sales has been added to your wallet.`,
      recipientEmail: result.user.email,
      sendEmail: true,
      sendPush: true,
      payload: {
        username: result.user.firstname || result.user.lastname || "User",
        amount: amount,
        payoutId: result.payoutId,
        transactionId: result.transactionId,
        date: formattedDate,
        time: formattedTime,
      },
    });

    await notifyAdmins(
      { role: ["finance", "super_admin"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: "SALES_PAYOUT_ADMIN_ALERT",
        title: "New Sales Payout Processed",
        message: `User ${result.user.uid} successfully withdrew ${amount} iCash to their wallet.`,
        payload: {
          userId: result.user.uid,
          amount,
          payoutId: result.payoutId,
          transactionId: result.transactionId,
        },
      },
      false,
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      newPointsBalance: result.newPointsBalance,
      transactionId: result.transactionId,
    });
  } catch (error) {
    console.error("Payout Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(400).json({ success: false, message: error.message });
  }
};
export const getDropOffStations = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getDropOffStationsController";
  const action = "getDropOffStations";
  try {
    const { lat, lng } = req.query;

    const snapshot = await DropOffStation.get();
    const stations = [];
    snapshot.forEach((doc) => {
      stations.push({ id: doc.id, ...doc.data() });
    });

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
    const userUid = req.user.id || req.user.uid;
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
          const usersSnapshot = await User.get();
          const foundUids = new Set();

          usersSnapshot.forEach((doc) => {
            const u = doc.data();
            const fullName = `${u.firstname || ""} ${u.lastname || ""}`.trim();
            const matches = inputNames.some((name) => {
              const regex = new RegExp(`^${name}$`, "i");
              const subRegex = new RegExp(name, "i");
              return (
                regex.test(u.firstname) ||
                regex.test(u.lastname) ||
                regex.test(u.username) ||
                subRegex.test(fullName)
              );
            });
            if (matches && u.uid) {
              foundUids.add(u.uid);
            }
          });
          lecturerIds = Array.from(foundUids);
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
        amountInStock: Number(req.body.inStock) || 0,
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
    let existingProductData = null;
    let productDocRef = null;

    if (isEditing) {
      const productQuery = await Product.where("productId", "==", productId)
        .where("sellerId", "==", userUid)
        .limit(1)
        .get();

      if (productQuery.empty) {
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

      const productDoc = productQuery.docs[0];
      productDocRef = productDoc.ref;
      existingProductData = productDoc.data();

      if (productType === "file") {
        if (req.file) {
          if (existingProductData.fileDetails?.url) {
            await fs
              .unlink(existingProductData.fileDetails.url)
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
          fileDetails = existingProductData.fileDetails;
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

    let productData;

    if (isEditing) {
      productData = {
        title,
        description,
        productType,
        price: Number(price),
        physicalDetails,
        courseDetails,
        lessons,
        fileDetails,
        mediaUrls: productThumbnails,
        updatedAt: new Date(),
      };

      await productDocRef.update(productData);
      productData = { productId, sellerId: userUid, ...productData };

      const currentDate = new Date();
      const formattedDate = currentDate.toLocaleDateString();
      const formattedTime = currentDate.toLocaleTimeString();

      await createNotification({
        notificationId: generateNotificationId("store"),
        recipientId: userUid,
        recipientEmail: req.user.email,
        category: "store",
        actionType: "PRODUCT_UPDATE",
        title: "Product Updated Successfully",
        message: `Your changes to "${title}" have been successfully saved.`,
        entityId: productId,
        entityType: "product",
        sendEmail: true,
        payload: {
          productId: productId,
          productType: productType,
          productName: title,
          price: Number(price),
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
      productDocRef = Product.doc(newCustomId);
      productData = {
        productId: newCustomId,
        sellerId: userUid,
        title,
        description,
        productType,
        price: Number(price),
        physicalDetails,
        courseDetails,
        lessons,
        fileDetails,
        mediaUrls: productThumbnails,
        impressions: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await productDocRef.set(productData);
    }
    const sellerQuery = await User.where("uid", "==", userUid).limit(1).get();
    const seller = !sellerQuery.empty ? sellerQuery.docs[0].data() : null;
    const sellerName = seller ? seller.firstname : "A creator you follow";

    processNotificationFanOut(
      userUid,
      sellerName,
      productData,
      isEditing,
    ).catch((err) =>
      console.error("Background task pipeline error context captured:", err),
    );

    await notifyAdmins(
      { role: ["super_admin", "moderator"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: isEditing ? "PRODUCT_UPDATE" : "PRODUCT_CREATION",
        title: isEditing ? "Product Updated" : "New Product Listed",
        message: `Product "${title}" was ${isEditing ? "updated" : "listed"} by ${sellerName}.`,
        payload: {
          productId: productData.productId,
          productName: title,
          sellerId: userUid,
        },
      },
      false,
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(isEditing ? 200 : 201).json({
      success: true,
      message: isEditing
        ? "Product entry successfully patched."
        : "Product entry successfully saved.",
      data: productData,
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

  try {
    const userUid = req.user.id || req.user.uid;
    const { productId } = req.params;

    if (!productId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required product identification parameter.",
      );
      return res.status(400).json({
        success: false,
        message: "Missing required product identification parameter.",
      });
    }

    const result = await db.runTransaction(async (transaction) => {
      const productQuery = await Product.where("productId", "==", productId)
        .where("sellerId", "==", userUid)
        .limit(1)
        .get();

      if (productQuery.empty) {
        throw new Error("Product record not found or unauthorized access.");
      }

      const productDoc = productQuery.docs[0];
      const productData = productDoc.data();
      transaction.delete(productDoc.ref);

      return productData;
    });
    if (result.productType === "file" && result.fileDetails?.url) {
      fs.unlink(result.fileDetails.url).catch((err) =>
        console.error(
          `Failed to delete local file asset at ${result.fileDetails.url}:`,
          err,
        ),
      );
    }

    const mediaThumbnails = result.mediaUrls || result.thumbnails;
    if (mediaThumbnails) {
      const thumbnailUrls = Array.isArray(mediaThumbnails)
        ? mediaThumbnails
        : [mediaThumbnails];

      const bucket = storage().bucket();

      thumbnailUrls.forEach((url) => {
        if (url && url.includes("firebasestorage.googleapis.com")) {
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

    // Fetch seller info for notifications
    const sellerQuery = await User.where("uid", "==", userUid).limit(1).get();
    const seller = !sellerQuery.empty ? sellerQuery.docs[0].data() : null;
    const sellerEmail = seller ? seller.email : req.user.email;
    const sellerName = seller ? seller.firstname : req.user.firstname;

    const currentDate = new Date();
    const formattedDate = currentDate.toLocaleDateString();
    const formattedTime = currentDate.toLocaleTimeString();

    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: userUid,
      recipientEmail: sellerEmail,
      category: "store",
      actionType: "PRODUCT_DELETION",
      title: "Product Listing Removed",
      message: `Your marketplace item "${result.title}" has been successfully deleted.`,
      entityId: productId,
      entityType: "product",
      sendEmail: false,
      payload: {
        username: sellerName,
        productId: productId,
        productName: result.title,
        date: formattedDate,
        time: formattedTime,
      },
    }).catch((err) =>
      console.error("Non-blocking deletion log emission failure:", err),
    );

    await notifyAdmins(
      { role: ["super_admin", "moderator"] },
      {
        notificationId: generateNotificationId("store"),
        actionType: "PRODUCT_DELETION_ADMIN",
        title: "Product Deletion Audit",
        message: `Product "${result.title}" was deleted by seller ${userUid}.`,
        payload: { productId, productName: result.title, sellerId: userUid },
      },
      false,
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
    const statusCode = error.message.includes("not found") ? 404 : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "Internal application routing anomaly.",
    });
  }
};
export const togglefavoriteActionController = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "togglefavoriteActionController";
  const action = "togglefavoriteAction";
  const { productId } = req.body;
  const userId = req.user.id || req.user.uid;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userQuery = await User.where("uid", "==", userId).limit(1).get();
      if (userQuery.empty) {
        throw new Error("User not found");
      }

      const userDoc = userQuery.docs[0];
      const userData = userDoc.data();
      const favorites = userData.favorites || [];

      const isFavorited = favorites.includes(productId);
      let updatedFavorites;

      if (isFavorited) {
        updatedFavorites = favorites.filter((id) => id !== productId);
      } else {
        updatedFavorites = [...favorites, productId];
      }

      transaction.update(userDoc.ref, {
        favorites: updatedFavorites,
        updatedAt: new Date(),
      });

      return {
        isFavorited,
        favorites: updatedFavorites,
      };
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({
      success: true,
      favorites: result.favorites,
      message: result.isFavorited
        ? "Removed from favorites"
        : "Added to favorites",
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    const statusCode = error.message === "User not found" ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
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
  const userId = req.user.id || req.user.uid;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userQuery = await User.where("uid", "==", userId).limit(1).get();
      if (userQuery.empty) {
        throw new Error("User not found");
      }

      const userDoc = userQuery.docs[0];
      const userData = userDoc.data();
      const cart = userData.cart || [];
      let updatedCart = [...cart];

      if (action === "add") {
        const existingIndex = updatedCart.findIndex(
          (item) =>
            item.productId === productId &&
            item.selectedSize === selectedSize &&
            item.selectedColor === selectedColor,
        );

        if (existingIndex > -1) {
          updatedCart[existingIndex] = {
            ...updatedCart[existingIndex],
            quantity:
              (updatedCart[existingIndex].quantity || 1) + Number(quantity),
          };
        } else {
          updatedCart.push({
            productId,
            quantity: Number(quantity),
            selectedSize,
            selectedColor,
          });
        }
      } else if (action === "remove") {
        updatedCart = updatedCart.filter(
          (item) => item.productId !== productId,
        );
      } else if (action === "update") {
        const existingIndex = updatedCart.findIndex(
          (item) => item.productId === productId,
        );

        if (existingIndex > -1) {
          updatedCart[existingIndex] = {
            ...updatedCart[existingIndex],
            quantity: Number(quantity),
          };
        }
      }

      transaction.update(userDoc.ref, {
        cart: updatedCart,
        updatedAt: new Date(),
      });

      return updatedCart;
    });

    logControllerPerformance(
      controllerName,
      controllerAction,
      startTime,
      "success",
    );

    res.status(200).json({
      success: true,
      cart: result,
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
    const statusCode = error.message === "User not found" ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};
export const markOrderAsDroppedOff = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markOrderAsDroppedOffController";
  const action = "markOrderAsDroppedOff";
  const { orderId } = req.body;
  const sellerId = req.user.id || req.user.uid;

  try {
    const result = await db.runTransaction(async (transaction) => {
      const orderQuery = await ProductOrder.where("orderId", "==", orderId)
        .limit(1)
        .get();

      if (orderQuery.empty) {
        throw new Error("Order not found.");
      }

      const orderDoc = orderQuery.docs[0];
      const order = orderDoc.data();

      if (order.sellerId !== sellerId) {
        throw new Error("Unauthorized action.");
      }
      if (order.deliveryMethod !== "drop_off") {
        throw new Error("This action is only valid for station drop-offs.");
      }

      const droppedOffAt = new Date().toISOString();
      transaction.update(orderDoc.ref, {
        status: "dropped_off",
        droppedOffAt: droppedOffAt,
        updatedAt: new Date(),
      });
      const buyerQuery = await User.where("uid", "==", order.buyerId)
        .limit(1)
        .get();
      if (buyerQuery.empty) {
        throw new Error("Buyer not found.");
      }
      const buyer = buyerQuery.docs[0].data();
      let agent = null;
      if (order.agentId) {
        const agentQuery = await User.where("uid", "==", order.agentId)
          .limit(1)
          .get();
        if (!agentQuery.empty) {
          agent = agentQuery.docs[0].data();
        }
      }

      return {
        order,
        buyer,
        agent,
      };
    });

    const currentDate = new Date();
    const formattedDate = currentDate.toLocaleDateString();
    const formattedTime = currentDate.toLocaleTimeString();
    await createNotification({
      notificationId: generateNotificationId("store"),
      recipientId: result.order.buyerId,
      recipientEmail: result.buyer.email,
      category: "store",
      actionType: "ORDER_DROPPED_OFF",
      sendEmail: true,
      payload: {
        userName:
          `${result.buyer.firstname || ""} ${result.buyer.lastname || ""}`.trim(),
        productName: result.order.productName,
        orderId: result.order.orderId,
        stationName: result.order.selectedStation?.name || "",
        stationAddress: result.order.selectedStation?.address || "",
      },
    });

    if (result.order.agentId && result.agent?.email) {
      await createNotification({
        notificationId: generateNotificationId("store"),
        recipientId: result.order.agentId,
        recipientEmail: result.agent.email,
        category: "store",
        actionType: "AGENT_AWAITING_PICKUP",
        sendEmail: true,
        payload: {
          agentName: result.agent.firstname || "Agent",
          productName: result.order.productName,
          orderId: result.order.orderId,
          stationName: result.order.selectedStation?.name || "",
          date: formattedDate,
          time: formattedTime,
        },
      });
    }

    logControllerPerformance(controllerName, action, startTime, "success");
    return res.status(200).json({
      success: true,
      message: "Order updated to dropped off. Buyer notified.",
      status: "dropped_off",
    });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    const statusCode = [
      "Order not found.",
      "Unauthorized action.",
      "This action is only valid for station drop-offs.",
    ].includes(error.message)
      ? 400
      : 500;
    return res
      .status(statusCode)
      .json({ success: false, message: error.message });
  }
};