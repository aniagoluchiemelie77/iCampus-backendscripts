import {
  Product,
  User,
  ProductOrder,
  Transactions,
  ProductImpression,
  ProductSales,
  Payout,
  DropOffStation,
  Follow,
  TaxEntries,
} from "../tableDeclarations.js";
import { setImmediate } from "timers";
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
  if (!Array.isArray(processedItems) || processedItems.length === 0) {
    return;
  }

  const now = new Date();
  const formattedDate = now.toLocaleDateString();
  const formattedTime = now.toLocaleTimeString();
  const notificationPromises = processedItems.flatMap(
    ({ order, sellerEmail, product, fileUrl, sellerId }) => {
      const deliveryMethod =
        order.deliveryMethod || order.selectedStation
          ? "Station Pickup"
          : "Direct";
      const buyerAddress = buyer.address || order.buyerAddress || "";
      const buyerPhoneNumber = buyer.phoneNumber || buyer.phone || "";

      const sellerNotification =
        typeof createNotification === "function"
          ? createNotification({
              notificationId:
                typeof generateNotificationId === "function"
                  ? generateNotificationId("store")
                  : `NOTIF-SEL-${Date.now()}-${Math.random()}`,
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
                buyerName: buyer.firstname || "Customer",
                amount: order.amountPaid,
                deliveryMethod,
                stationName: order.selectedStation?.name || null,
                stationAddress: order.selectedStation?.address || null,
                buyerAddress,
                buyerPhoneNumber,
                date: formattedDate,
                time: formattedTime,
              },
              sendPush: true,
              sendEmail: true,
              saveToDb: true,
            }).catch((err) =>
              console.error("Seller notification dispatch error:", err),
            )
          : Promise.resolve();

      const buyerNotification =
        typeof createNotification === "function"
          ? createNotification({
              notificationId:
                typeof generateNotificationId === "function"
                  ? generateNotificationId("store")
                  : `NOTIF-BUY-${Date.now()}-${Math.random()}`,
              recipientId: buyer.uid || buyer.id,
              recipientEmail: buyer.email,
              category: "finance",
              actionType: "MARKET_PURCHASE_DEBIT",
              title: "Purchase Confirmed",
              message: `Your purchase of ${product.title} was successful. ${
                fileUrl
                  ? "Download File"
                  : "Scan your QR code at the station or to seller to complete the transaction."
              }`,
              entityId: order.orderId,
              entityType: "order",
              payload: {
                orderId: order.orderId,
                productName: product.title,
                productType: product.type,
                amount: order.amountPaid,
                fileUrl: fileUrl || null,
                userName: buyer.firstname || "User",
                transactionId,
                date: formattedDate,
                time: formattedTime,
              },
              sendPush: true,
              sendEmail: true,
              saveToDb: true,
            }).catch((err) =>
              console.error("Buyer notification dispatch error:", err),
            )
          : Promise.resolve();

      return [sellerNotification, buyerNotification];
    },
  );
  await Promise.all(notificationPromises);
}
async function processNotificationFanOut(
  sellerUid,
  sellerName,
  product,
  isEditing,
) {
  if (isEditing) return;

  try {
    const now = new Date();
    const formattedDate = now.toLocaleDateString();
    const formattedTime = now.toLocaleTimeString();

    const [followSnapshot, sellerQuery] = await Promise.all([
      Follow.where("followingId", "==", sellerUid).get(),
      User.where("uid", "==", sellerUid).limit(1).get(),
    ]);

    const followers = [];
    followSnapshot.forEach((doc) => {
      followers.push(doc.data());
    });

    let sellerEmail = null;
    if (!sellerQuery.empty) {
      sellerEmail = sellerQuery.docs[0].data().email;
    }

    const notificationPromises = [];
    if (sellerEmail && typeof createNotification === "function") {
      notificationPromises.push(
        createNotification({
          notificationId:
            typeof generateNotificationId === "function"
              ? generateNotificationId("store")
              : `NOTIF-PUB-${Date.now()}`,
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
        }).catch((err) => console.error("Seller pub notification error:", err)),
      );
    }
    if (followers.length > 0) {
      const followerIds = followers.map((f) => f.followerId);
      const emailMap = new Map();
      const chunks = [];

      for (let i = 0; i < followerIds.length; i += 30) {
        chunks.push(followerIds.slice(i, i + 30));
      }
      const chunkQueries = chunks.map((chunk) =>
        User.where("uid", "in", chunk).get(),
      );
      const userSnapshots = await Promise.all(chunkQueries);

      userSnapshots.forEach((userSnapshot) => {
        userSnapshot.forEach((doc) => {
          const u = doc.data();
          if (u.uid && u.email) {
            emailMap.set(u.uid, u.email);
          }
        });
      });
      followers.forEach((follower) => {
        const recipientEmail = emailMap.get(follower.followerId);

        if (recipientEmail && typeof createNotification === "function") {
          notificationPromises.push(
            createNotification({
              notificationId:
                typeof generateNotificationId === "function"
                  ? generateNotificationId("store")
                  : `NOTIF-FOLL-${Date.now()}-${Math.random()}`,
              recipientId: follower.followerId,
              recipientEmail: recipientEmail,
              category: "store",
              actionType: "NEW_PRODUCT",
              title: sellerName || "Seller",
              message: `has published a brand new item: "${product.title}"! Check it out now.`,
              entityId: product.productId,
              entityType: "product",
              sendEmail: true,
              payload: {
                productId: product.productId,
                productType: product.productType,
                productName: product.title,
                userName: sellerName || "Seller",
              },
            }).catch((err) =>
              console.error("Follower fan-out notification error:", err),
            ),
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
  const pageLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

  // 1. Log initial incoming request params
  console.log(`[${controllerName}] Incoming Request:`, {
    q,
    category,
    cursor,
    limit: pageLimit,
  });

  try {
    let queryRef = Product.where("isAvailable", "==", true);
    const isPopular = category === "popular";

    if (category && category !== "all" && !isPopular) {
      queryRef = queryRef.where("category", "==", category);
      console.log(`[${controllerName}] Applied category filter:`, category);
    }

    if (isPopular) {
      queryRef = queryRef
        .orderBy("favCount", "desc")
        .orderBy("ratingsAverage", "desc");
      console.log(
        `[${controllerName}] Applied 'popular' sorting (favCount, ratingsAverage)`,
      );
    } else {
      queryRef = queryRef.orderBy("createdAt", "desc");
      console.log(
        `[${controllerName}] Applied default sorting (createdAt desc)`,
      );
    }

    let cursorDoc = null;
    if (cursor) {
      console.log(
        `[${controllerName}] Fetching cursor document reference for ID:`,
        cursor,
      );
      cursorDoc = await Product.doc(cursor).get();
      if (cursorDoc.exists) {
        queryRef = queryRef.startAfter(cursorDoc);
        console.log(`[${controllerName}] Cursor successfully applied.`);
      } else {
        console.warn(
          `[${controllerName}] Warning: Provided cursor ID does not exist:`,
          cursor,
        );
      }
    }

    const fetchLimit = q ? pageLimit * 3 : pageLimit + 1;
    queryRef = queryRef.limit(fetchLimit);
    console.log(
      `[${controllerName}] Final Firestore fetchLimit set to:`,
      fetchLimit,
    );

    const snapshot = await queryRef.get();
    let products = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      products.push({ id: doc.id, productId: doc.id, ...data });
    });

    console.log(
      `[${controllerName}] Raw documents fetched from Firestore:`,
      products.length,
    );

    if (q) {
      const searchTerm = q.toLowerCase().trim();
      console.log(
        `[${controllerName}] Filtering products locally by search term: "${searchTerm}"`,
      );
      products = products.filter((p) => {
        const title = (p.title || "").toLowerCase();
        const description = (p.description || "").toLowerCase();
        return title.includes(searchTerm) || description.includes(searchTerm);
      });
      console.log(
        `[${controllerName}] Products remaining after search filter:`,
        products.length,
      );
    }

    const paginatedProducts = products.slice(0, pageLimit);
    let nextCursor = null;
    if (products.length > pageLimit) {
      nextCursor =
        paginatedProducts[paginatedProducts.length - 1]?.productId || null;
    }

    console.log(
      `[${controllerName}] Response summary -> Returning items: ${paginatedProducts.length}, Next Cursor: ${nextCursor}`,
    );

    res.json({ products: paginatedProducts, nextCursor });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (err) {
    console.error(`[${controllerName}] ❌ Fetch Store Products Error:`, {
      message: err.message,
      code: err.code,
      details: err.details,
      stack: err.stack,
    });
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
    }
    return res
      .status(500)
      .json({ message: err.message || "Failed to fetch store items" });
  }
};
export const fetchAllProducts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllProductsController";
  const action = "fetchAllProducts";
  const CACHE_KEY = "catalog:all_products";

  try {
    const cachedData = await redis.get(CACHE_KEY);
    if (cachedData) {
      res.status(200).json({
        success: true,
        products: JSON.parse(cachedData),
        source: "cache",
      });

      setImmediate(() => {
        if (typeof logControllerPerformance === "function") {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      });
      return;
    }

    const products = [];
    const snapshot = await Product.get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      products.push({
        id: doc.id,
        title: data.title,
        isAvailable: data.isAvailable,
        priceInPoints: data.priceInPoints,
        mediaUrls: data.mediaUrls,
        productId: data.productId,
        category: data.category,
        type: data.type,
      });
    });
    res.status(200).json({
      success: true,
      products,
      source: "database",
    });
    setImmediate(() => {
      const backgroundTasks = [
        redis
          .set(CACHE_KEY, JSON.stringify(products), { EX: 18000 })
          .catch((err) => console.error("Redis cache write error:", err)),
      ];

      if (typeof logControllerPerformance === "function") {
        backgroundTasks.push(
          Promise.resolve().then(() =>
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            ),
          ),
        );
      }

      Promise.all(backgroundTasks);
    });
  } catch (error) {
    console.error("Critical Catalog Fetch Error:", error);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ success: false, message: "Server unable to sync catalog" });
  }
};
export const clearUserCart = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "clearUserCartController";
  const action = "clearUserCart";

  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) throw new Error("Unauthorized");
    const userDocRef = User.doc(userId);
    await userDocRef.update({
      cart: [],
      updatedAt: new Date(),
    });
    res.status(200).json({
      status: true,
      message: "Cart cleared successfully",
      cart: [],
    });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
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
    const statusCode = error.message === "Unauthorized" ? 401 : 500;
    return res.status(statusCode).json({
      status: false,
      message: error.message || "An error occurred while clearing the cart",
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
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      }
      return res.status(404).json({ status: false, message: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    const currentCart = userData.cart || [];
    const existingProductIds = new Set(currentCart.map((i) => i.productId));
    const itemsToAdd = (items || []).filter(
      (item) => !existingProductIds.has(item.productId),
    );

    const updatedCart = [...currentCart, ...itemsToAdd];

    if (itemsToAdd.length > 0) {
      await userDoc.ref.update({
        cart: updatedCart,
        updatedAt: new Date(),
      });
    }
    res.status(200).json({
      status: true,
      cart: updatedCart,
      message: "Successfully added items to cart.",
    });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    console.error("Bulk Add To Cart Error:", error.message);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
    res.status(500).json({ status: false, message: "An error occurred" });
  }
};
export const clearFavorites = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "clearFavoritesController";
  const action = "clearFavorites";

  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized user session",
      });
    }

    const userDocRef = User.doc(userId);
    const userSnap = await userDocRef.get();

    if (!userSnap.exists) {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User not found",
        );
      }
      return res.status(404).json({
        status: false,
        message: "User not found",
      });
    }

    await userDocRef.update({
      favorites: [],
      updatedAt: new Date(),
    });
    res
      .status(200)
      .json({ status: true, message: "Favorites cleared successfully" });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    console.error("Clear Favorites Error:", error.message);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
    return res.status(500).json({
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
      const itemPromises = items.map(async (item) => {
        const [productQuery, sellerQuery] = await Promise.all([
          Product.where("productId", "==", item.productId).limit(1).get(),
          User.where("uid", "==", item.sellerId).limit(1).get(),
        ]);

        if (productQuery.empty || sellerQuery.empty) {
          throw new Error("Product or Seller info not found.");
        }

        return {
          item,
          productDoc: productQuery.docs[0],
          productData: productQuery.docs[0].data(),
          sellerDoc: sellerQuery.docs[0],
          sellerData: sellerQuery.docs[0].data(),
        };
      });

      const resolvedItems = await Promise.all(itemPromises);
      const results = [];

      for (const resolved of resolvedItems) {
        const { item, productDoc, productData, sellerDoc, sellerData } =
          resolved;

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
    res.status(200).json({
      success: true,
      data: processedResults.processedResults.map((r) => r.order),
    });

    setImmediate(async () => {
      try {
        const buyerQuery = await User.where("uid", "==", buyerId)
          .limit(1)
          .get();
        const buyerData = !buyerQuery.empty
          ? buyerQuery.docs[0].data()
          : { uid: buyerId };

        await Promise.all([
          sendOrderNotifications(
            buyerData,
            processedResults.processedResults,
            processedResults.buyerTxId,
          ),
          notifyAdmins(
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
          ),
        ]);

        if (typeof logControllerPerformance === "function") {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      } catch (bgError) {
        console.error("Background Checkout Tasks Error:", bgError);
      }
    });
  } catch (error) {
    console.error("Checkout Initialization Error:", error.message);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
    res.status(500).json({ success: false, message: error.message });
  }
};
export const completeOrderDelivery = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "completeOrderDeliveryController";
  const action = "completeOrderDelivery";
  const { orderId } = req.body;
  const scannerUid = req.user?.id || req.user?.uid;

  if (!scannerUid) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user identifier",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user identifier" });
  }

  if (!orderId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing orderId",
      );
    });
    return res.status(400).json({
      success: false,
      message: "Missing order identification parameter.",
    });
  }

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
      const [productQuery, sellerQuery, buyerQuery, agentQuery] =
        await Promise.all([
          Product.where("productId", "==", order.productId).limit(1).get(),
          User.where("uid", "==", order.sellerId).limit(1).get(),
          User.where("uid", "==", order.buyerId).limit(1).get(),
          order.deliveryMethod === "drop_off" && order.agentId
            ? User.where("uid", "==", order.agentId).limit(1).get()
            : Promise.resolve(null),
        ]);

      if (productQuery.empty) {
        throw new Error("Product not found.");
      }
      if (sellerQuery.empty) {
        throw new Error("Seller account no longer exists.");
      }
      if (
        order.deliveryMethod === "drop_off" &&
        order.agentId &&
        (!agentQuery || agentQuery.empty)
      ) {
        throw new Error("Drop-off agent not found.");
      }

      const productDoc = productQuery.docs[0];
      const productData = productDoc.data();
      const sellerDoc = sellerQuery.docs[0];
      const seller = sellerDoc.data();
      const buyer = !buyerQuery.empty ? buyerQuery.docs[0].data() : null;

      let agentDoc = null;
      let agentData = null;
      if (agentQuery && !agentQuery.empty) {
        agentDoc = agentQuery.docs[0];
        agentData = agentDoc.data();
      }

      const buyerTier = buyer?.tier || "free";
      const deliveryFeeRate =
        DELIVERY_FEES?.[buyerTier]?.[order.deliveryMethod] || 0;
      const deliveryFeeAmount = order.amountPaid * deliveryFeeRate;
      const totalHeld = order.amountPaid;
      const taxAmount = totalHeld * TAX_RATE;
      const payableAmount = totalHeld - taxAmount;

      let sellerEarnings = payableAmount;
      let agentEarnings = 0;

      if (order.deliveryMethod === "drop_off" && order.agentId && agentDoc) {
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
    res.status(200).json({
      success: true,
      orderId,
      settlementAmount: result.isSeller
        ? result.sellerEarnings
        : result.agentEarnings,
      role: result.isSeller ? "seller" : "agent",
      message: "Delivery verified and payments settled.",
      productName: result.productTitle,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
    setImmediate(async () => {
      try {
        const notificationPromises = [];

        notificationPromises.push(
          createNotification({
            notificationId: generateNotificationId("store"),
            recipientId: order.buyerId || result.buyer?.uid,
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
          }),
        );

        notificationPromises.push(
          createNotification({
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
          }),
        );

        if (result.agent) {
          notificationPromises.push(
            createNotification({
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
            }),
          );
        }

        notificationPromises.push(
          notifyAdmins(
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
          ),
        );

        await Promise.all(notificationPromises);
      } catch (err) {
        console.error(
          "Background notification pipeline failure in completeOrderDelivery:",
          err,
        );
      }
    });
  } catch (error) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(400).json({ success: false, message: error.message });
  }
};
export const cancelOrder = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "cancelOrderController";
  const action = "cancelOrder";
  const { orderId, reason } = req.body;
  const userId = req.user?.id || req.user?.uid;

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user identifier",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user identifier" });
  }

  if (!orderId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing orderId",
      );
    });
    return res.status(400).json({
      success: false,
      message: "Missing order identification parameter.",
    });
  }

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
      const [buyerQuery, sellerQuery, productQuery] = await Promise.all([
        User.where("uid", "==", order.buyerId).limit(1).get(),
        User.where("uid", "==", order.sellerId).limit(1).get(),
        Product.where("productId", "==", order.productId).limit(1).get(),
      ]);

      if (buyerQuery.empty) {
        throw new Error("User not found.");
      }
      if (sellerQuery.empty) {
        throw new Error("Seller not found.");
      }

      const buyerDoc = buyerQuery.docs[0];
      const buyer = buyerDoc.data();
      const sellerDoc = sellerQuery.docs[0];
      const seller = sellerDoc.data();

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
    res.status(200).json({
      success: true,
      message: "Order cancelled, buyer refunded, and seller notified.",
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
    setImmediate(async () => {
      try {
        const currentDate = new Date();
        const formattedDate = currentDate.toLocaleDateString();
        const formattedTime = currentDate.toLocaleTimeString();

        await Promise.all([
          createNotification({
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
          }),
          notifyAdmins(
            { role: ["super_admin", "finance"] },
            {
              notificationId: generateNotificationId("store"),
              actionType: "ORDER_CANCELLED_ADMIN",
              title: "Order Cancelled Audit",
              message: `Order #${orderId} has been cancelled. Buyer ${result.buyer.uid} refunded.`,
              payload: { orderId, sellerId: result.seller.uid, reason },
            },
            false,
          ),
        ]);
      } catch (err) {
        console.error(
          "Background notification pipeline failure in cancelOrder:",
          err,
        );
      }
    });
  } catch (error) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    return res.status(400).json({ success: false, message: error.message });
  }
};
export const getPendingOrders = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getPendingOrdersController";
  const action = "getPendingOrders";

  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized user identifier",
        );
      });
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized user identifier" });
    }

    const snapshot = await ProductOrder.where("buyerId", "==", userId)
      .where("status", "in", ["pending_delivery", "dropped_off"])
      .orderBy("createdAt", "desc")
      .get();

    const orders = [];
    snapshot.forEach((doc) => {
      orders.push(doc.data());
    });

    res.status(200).json({ success: true, data: orders });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
      const [impressionQuery, productQuery] = await Promise.all([
        ProductImpression.where("userId", "==", userId)
          .where("productId", "==", productId)
          .where("monthYear", "==", currentMonthYear)
          .limit(1)
          .get(),
        Product.where("productId", "==", productId).limit(1).get(),
      ]);

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
    res.status(200).json({
      success: true,
      message: result.message,
    });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
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
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Unauthorized: Seller ID missing",
        );
      }
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Seller ID missing",
      });
    }

    const snapshot = await ProductSales.where("sellerId", "==", sellerId)
      .orderBy("createdAt", "desc")
      .get();

    const sales = [];
    snapshot.forEach((doc) => {
      sales.push({ id: doc.id, ...doc.data() });
    });
    res.status(200).json({
      success: true,
      count: sales.length,
      data: sales,
    });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    console.error("getSellerSalesHistory Error:", error.message);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
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
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "User identification missing.",
        );
      }
      return res.status(400).json({
        success: false,
        message: "User identification missing.",
      });
    }

    const snapshot = await Payout.where("sellerUid", "==", userUid)
      .orderBy("createdAt", "desc")
      .get();

    const history = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const { __v, ...cleanData } = data;
      history.push({ id: doc.id, ...cleanData });
    });
    res.status(200).json({
      success: true,
      data: history,
      message: "Payout history retrieved successfully.",
    });

    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    console.error("Fetch Payout Error:", error.message);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
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

  if (!userId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user identifier",
      );
    });
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized user identifier" });
  }

  if (!amount || amount <= 0) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Invalid payout amount",
      );
    });
    return res
      .status(400)
      .json({ success: false, message: "Invalid payout amount specified." });
  }

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
    res.status(200).json({
      success: true,
      newPointsBalance: result.newPointsBalance,
      transactionId: result.transactionId,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
    setImmediate(async () => {
      try {
        const currentDate = new Date();
        const formattedDate = currentDate.toLocaleDateString();
        const formattedTime = currentDate.toLocaleTimeString();

        const notificationPromises = [
          createNotification({
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
          }),
          notifyAdmins(
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
          ),
        ];

        await Promise.all(notificationPromises);
      } catch (err) {
        console.error(
          "Background notification pipeline failure in requestPayout:",
          err,
        );
      }
    });
  } catch (error) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
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
      res.status(200).json({
        success: true,
        message: "Stations fetched successfully",
        data: stations,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
      return;
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

    res.status(200).json({
      success: true,
      message: "Closest stations fetched successfully",
      data: stationsWithDistance,
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
  } catch (error) {
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
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing required product fields.",
        );
      });
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

    let productDocRef = null;
    const [productQuery, sellerQuery] = await Promise.all([
      isEditing
        ? Product.where("productId", "==", productId)
            .where("sellerId", "==", userUid)
            .limit(1)
            .get()
        : Promise.resolve(null),
      User.where("uid", "==", userUid).limit(1).get(),
    ]);

    if (isEditing) {
      if (!productQuery || productQuery.empty) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Product not found.",
          );
        });
        return res
          .status(404)
          .json({ success: false, message: "Product not found." });
      }

      const productDoc = productQuery.docs[0];
      productDocRef = productDoc.ref;
    }

    const seller = !sellerQuery.empty ? sellerQuery.docs[0].data() : null;
    const sellerName = seller ? seller.firstname : "A creator you follow";

    let productData;

    if (isEditing) {
      productData = {
        title,
        description,
        productType,
        price: Number(price),
        physicalDetails,
        mediaUrls: productThumbnails,
        updatedAt: new Date(),
      };

      await productDocRef.update(productData);
      await redis.del("catalog:all_products");
      productData = { productId, sellerId: userUid, ...productData };
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
        mediaUrls: productThumbnails,
        impressions: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isAvailable: true,
      };
      await productDocRef.set(productData);
    }
    res.status(isEditing ? 200 : 200).json({
      success: true,
      message: isEditing
        ? "Product entry successfully patched."
        : "Product entry successfully saved.",
      data: productData,
    });
    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
    setImmediate(async () => {
      try {
        const currentDate = new Date();
        const formattedDate = currentDate.toLocaleDateString();
        const formattedTime = currentDate.toLocaleTimeString();

        const bgTasks = [
          notifyAdmins(
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
          ),
          processNotificationFanOut(
            userUid,
            sellerName,
            productData,
            isEditing,
          ),
        ];

        if (isEditing) {
          bgTasks.push(
            createNotification({
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
            }),
          );
        }

        await Promise.allSettled(bgTasks);
      } catch (err) {
        console.error("Background task pipeline error context captured:", err);
      }
    });
  } catch (error) {
    console.error(
      "Global crash layer hit in saveProductController:",
      error.message,
    );
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
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing required product identification parameter.",
        );
      }
      return res.status(400).json({
        success: false,
        message: "Missing required product identification parameter.",
      });
    }

    const [result, sellerQuery] = await Promise.all([
      db.runTransaction(async (transaction) => {
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
      }),
      User.where("uid", "==", userUid).limit(1).get(),
    ]);
    res.status(200).json({
      success: true,
      message: "Product entry successfully unlinked and purged.",
      data: { productId },
    });
    setImmediate(async () => {
      try {
        await redis.del("catalog:all_products");
        const mediaThumbnails = result.mediaUrls || result.thumbnails;
        if (mediaThumbnails) {
          const thumbnailUrls = Array.isArray(mediaThumbnails)
            ? mediaThumbnails
            : [mediaThumbnails];

          const bucket = storage().bucket();

          const deletionPromises = thumbnailUrls.map(async (url) => {
            if (url && url.includes("firebasestorage.googleapis.com")) {
              try {
                const decodedUrl = decodeURIComponent(url);
                const pathStartIndex = decodedUrl.indexOf("/o/") + 3;
                const pathEndIndex = decodedUrl.indexOf("?");
                const filePath =
                  pathEndIndex !== -1
                    ? decodedUrl.substring(pathStartIndex, pathEndIndex)
                    : decodedUrl.substring(pathStartIndex);

                await bucket.file(filePath).delete();
              } catch (parseError) {
                console.error(
                  `Error parsing or deleting Firebase file for URL: ${url}`,
                  parseError,
                );
              }
            }
          });

          await Promise.all(deletionPromises).catch((err) =>
            console.error(
              "Some file deletions failed during parallel cleanup:",
              err,
            ),
          );
        }

        const seller = !sellerQuery.empty ? sellerQuery.docs[0].data() : null;
        const sellerEmail = seller ? seller.email : req.user.email;
        const sellerName = seller ? seller.firstname : req.user.firstname;

        const currentDate = new Date();
        const formattedDate = currentDate.toLocaleDateString();
        const formattedTime = currentDate.toLocaleTimeString();

        await Promise.all([
          createNotification({
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
          ),
          notifyAdmins(
            { role: ["super_admin", "moderator"] },
            {
              notificationId: generateNotificationId("store"),
              actionType: "PRODUCT_DELETION_ADMIN",
              title: "Product Deletion Audit",
              message: `Product "${result.title}" was deleted by seller ${userUid}.`,
              payload: {
                productId,
                productName: result.title,
                sellerId: userUid,
              },
            },
            false,
          ),
        ]);

        if (typeof logControllerPerformance === "function") {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        }
      } catch (bgError) {
        console.error("Background Product Deletion Tasks Error:", bgError);
      }
    });
  } catch (error) {
    console.error(
      "Global crash layer hit in deleteProductController:",
      error.message,
    );
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
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

  if (!productId) {
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required productId.",
      );
    }
    return res
      .status(400)
      .json({ success: false, message: "Missing required productId." });
  }

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
      const updatedFavorites = isFavorited
        ? favorites.filter((id) => id !== productId)
        : [...favorites, productId];

      transaction.update(userDoc.ref, {
        favorites: updatedFavorites,
        updatedAt: new Date(),
      });

      return {
        isFavorited,
        favorites: updatedFavorites,
      };
    });
    res.status(200).json({
      success: true,
      favorites: result.favorites,
      message: result.isFavorited
        ? "Removed from favorites"
        : "Added to favorites",
    });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
    const statusCode = error.message === "User not found" ? 404 : 500;
    return res
      .status(statusCode)
      .json({ success: false, message: error.message });
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

  if (!productId || !action) {
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        controllerAction,
        startTime,
        "error",
        "Missing required productId or action.",
      );
    }
    return res.status(400).json({
      success: false,
      message: "Missing required productId or action.",
    });
  }

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
    res.status(200).json({
      success: true,
      cart: result,
      message: `Cart updated successfully`,
    });
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          controllerAction,
          startTime,
          "success",
        );
      }
    });
  } catch (error) {
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        controllerAction,
        startTime,
        "error",
        error.message,
      );
    }
    const statusCode = error.message === "User not found" ? 404 : 500;
    return res
      .status(statusCode)
      .json({ success: false, message: error.message });
  }
};
export const markOrderAsDroppedOff = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markOrderAsDroppedOffController";
  const action = "markOrderAsDroppedOff";
  const { orderId } = req.body;
  const sellerId = req.user.id || req.user.uid;

  if (!orderId) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Missing required orderId.",
      );
    });
    return res
      .status(400)
      .json({ success: false, message: "Missing required orderId." });
  }

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
      const [buyerQuery, agentQuery] = await Promise.all([
        User.where("uid", "==", order.buyerId).limit(1).get(),
        order.agentId
          ? User.where("uid", "==", order.agentId).limit(1).get()
          : Promise.resolve(null),
      ]);

      if (buyerQuery.empty) {
        throw new Error("Buyer not found.");
      }

      const buyer = buyerQuery.docs[0].data();
      const agent =
        agentQuery && !agentQuery.empty ? agentQuery.docs[0].data() : null;

      return {
        order,
        buyer,
        agent,
      };
    });
    res.status(200).json({
      success: true,
      message: "Order updated to dropped off. Buyer notified.",
      status: "dropped_off",
    });

    setImmediate(() => {
      logControllerPerformance(controllerName, action, startTime, "success");
    });
    setImmediate(async () => {
      try {
        const currentDate = new Date();
        const formattedDate = currentDate.toLocaleDateString();
        const formattedTime = currentDate.toLocaleTimeString();

        const notificationPromises = [
          createNotification({
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
          }),
        ];

        if (result.order.agentId && result.agent?.email) {
          notificationPromises.push(
            createNotification({
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
            }),
          );
        }

        await Promise.all(notificationPromises);
      } catch (err) {
        console.error(
          "Background notification pipeline failure in order drop-off:",
          err,
        );
      }
    });
  } catch (error) {
    setImmediate(() => {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    });
    const clientErrors = [
      "Order not found.",
      "Unauthorized action.",
      "This action is only valid for station drop-offs.",
      "Buyer not found.",
      "Missing required orderId.",
    ];
    const statusCode = clientErrors.includes(error.message) ? 400 : 500;
    return res
      .status(statusCode)
      .json({ success: false, message: error.message });
  }
};