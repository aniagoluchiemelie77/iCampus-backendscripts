import {
  Product,
  User,
  ProductOrder,
  Transactions,
  ProductImpression,
  ProductSales,
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
import axios from "axios";
import { convertAmount, currencyForCountry } from "../utils/currency.js";
import {
  PaymentError,
  flutterwaveSecret,
  flwRequest,
  roundMoney,
} from "../utils/flutterwave.js";

//Tested and trusted using jest
export async function sendOrderNotifications(buyer, processedItems, transactionId) {
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
              isRead: false,
              recipientEmail: sellerEmail,
              category: "store",
              actionType: "NEW_ORDER",
              title: "New Sale",
              message: `Item: ${product.title}. Deliver to: ${order.selectedStation?.name || "Assigned Station"}.`,
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
                currency: order.amountPaidCurrencyCode,
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
              isRead: false,
              recipientEmail: buyer.email,
              category: "finance",
              actionType: "MARKET_PURCHASE_DEBIT",
              title: "Purchase Confirmed",
              message: `Your purchase of ${product.title} was successful.`,
              entityId: order.orderId,
              entityType: "order",
              payload: {
                orderId: order.orderId,
                productName: product.title,
                amount: order.amountPaid,
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
          isRead: false,
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
            productType: product.type,
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
              isRead: false,
              category: "store",
              actionType: "NEW_PRODUCT",
              title: sellerName || "Seller",
              entityId: product.productId,
              entityType: "product",
              sendEmail: true,
              payload: {
                productId: product.productId,
                productType: product.type,
                productName: product.title,
                userName: sellerName || "Seller",
                followerFirstname: follower.firstname || "Follower",
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
export const cancelOrder = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "cancelOrderController";
  const action = "cancelOrder";
  const { orderId, reason } = req.body;
  const userId = req.user?.id || req.user?.uid;
  const SECRET_KEY = flutterwaveSecret();

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
    const orderDocRef = ProductOrder.doc(orderId);
    const orderDoc = await orderDocRef.get();

    if (!orderDoc.exists) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found." });
    }

    const order = orderDoc.data();

    if (order.buyerId !== userId || order.status !== "pending_delivery") {
      return res.status(403).json({
        success: false,
        message: "Order not found or you do not have permission to cancel it.",
      });
    }

    const [buyerQuery, sellerQuery, productQuery] = await Promise.all([
      User.where("uid", "==", order.buyerId).limit(1).get(),
      User.where("uid", "==", order.sellerId).limit(1).get(),
      Product.where("productId", "==", order.productId).limit(1).get(),
    ]);

    if (buyerQuery.empty || sellerQuery.empty) {
      return res.status(404).json({
        success: false,
        message: "Buyer or seller profile not found.",
      });
    }

    const buyerDoc = buyerQuery.docs[0];
    const buyer = buyerDoc.data();
    const sellerDoc = sellerQuery.docs[0];
    const seller = sellerDoc.data();

    const productDoc = !productQuery.empty ? productQuery.docs[0] : null;
    const productData = productDoc ? productDoc.data() : null;
    const productTitle = productData ? productData.title : "Product";
    const flwTransactionId = order.flwRef || order.transactionReference;
    if (!/^\d+$/.test(String(flwTransactionId || ""))) {
      throw new Error(
        "This order has no gateway transaction to refund. Please contact support.",
      );
    }
    // The buyer gets back the item price and its delivery fee.
    const refundAmount =
      Math.round(((order.amountPaid || 0) + (order.deliveryFee || 0)) * 100) / 100;

    // Claim the cancellation first so a double tap can't refund twice.
    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(orderDocRef);
      if (!fresh.exists || fresh.data().status !== "pending_delivery") {
        throw new Error("This order can no longer be cancelled.");
      }
      transaction.update(orderDocRef, { status: "cancelling", updatedAt: new Date() });
    });

    let refundData = {};
    let refundOk = false;
    try {
      const refund = await flwRequest(
        `/transactions/${flwTransactionId}/refund`,
        { method: "POST", body: { amount: refundAmount } },
      );
      refundData = refund.data || {};
      refundOk = refund.ok && refundData.status === "success";
    } catch (refundErr) {
      refundData = { message: refundErr.message };
    }

    if (!refundOk) {
      console.error("Flutterwave Refund Failed:", refundData);
      await orderDocRef.update({ status: "pending_delivery", updatedAt: new Date() });
      return res.status(400).json({
        success: false,
        message:
          refundData.message ||
          "Failed to process gateway refund. Order cancellation aborted.",
      });
    }
    const refundTxId = generateTransactionId("refund");
    const refundTxRef = Transactions.doc(refundTxId);

    await db.runTransaction(async (transaction) => {
      const freshProduct = productDoc ? await transaction.get(productDoc.ref) : null;
      if (freshProduct?.exists) {
        const currentStock = Number(freshProduct.data().amountInStock) || 0;
        transaction.update(productDoc.ref, {
          amountInStock: currentStock + (order.quantity || 1),
          isAvailable: true,
          updatedAt: new Date(),
        });
      }
      transaction.update(orderDocRef, {
        status: "cancelled",
        cancellationReason: String(reason || "").slice(0, 500),
        refundAmount,
        updatedAt: new Date(),
      });
      transaction.set(refundTxRef, {
        transactionId: refundTxId,
        userId: buyer.uid,
        type: "refund",
        amount: refundAmount,
        currency: order.amountPaidCurrencyCode || "NGN",
        status: "success",
        payType: "in",
        title: `Gateway Refund for ${productTitle}`,
        reference: `REF-${orderId}`,
        createdAt: new Date(),
      });
    });
    // Stock was restored: drop the cached catalog so apps see it.
    redis.del("catalog:all_products:v2").catch(() => {});

    res.status(200).json({
      success: true,
      message:
        "Order successfully cancelled and monetary refund initiated via payment gateway.",
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
            recipientId: seller.uid,
            recipientEmail: seller.email,
            isRead: false,
            category: "store",
            actionType: "ORDER_CANCELLED",
            title: "Order Cancelled by Buyer",
            message: `The order for "${productTitle}" (#${orderId}) was cancelled. Reason: ${reason}`,
            payload: {
              orderId: orderId,
              productName: productTitle,
              reason: reason,
              buyerName: buyer.firstname || "Buyer",
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
              title: "Order Cancelled & Gateway Refunded",
              message: `Order #${orderId} has been cancelled. Gateway refund processed for buyer ${buyer.uid}.`,
              payload: { orderId, sellerId: seller.uid, reason },
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
    console.error("Cancel Order Error:", error.message);
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
export const saveProductController = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "saveProductController";
  const action = "saveProduct";
  try {
    const userUid = req.user.id || req.user.uid;
    const { productId } = req.params;
    const isEditing = !!productId;
    // Express 5 leaves req.body undefined when no parser matched the request
    // (e.g. a multipart body on this JSON-only route).
    const body = req.body ?? {};
    const { title, mediaUrls, niche } = body;
    const description = typeof body.description === "string" ? body.description : "";
    const type = body.type || body.productType;
    const price = body.price;
    // Older clients send list fields as JSON strings, newer ones as arrays.
    const parseList = (value) => {
      if (Array.isArray(value)) return value;
      if (typeof value !== "string" || !value.trim()) return [];
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [value];
      }
    };
    console.log("Step 1...");

    const amountInStock = Number(body.amountInStock ?? body.inStock) || 0;

    if (!title || !type || !price || !niche) {
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

    const productThumbnails = parseList(mediaUrls).filter(Boolean);

    let physicalDetails = null;
    if (type === "physical") {
      console.log("Step 2...");
      physicalDetails = {
        weightKg: Number(body.weightKg) || 0,
        inStock: Number(body.inStock) || 0,
        colors: parseList(body.colors),
        sizes: parseList(body.sizes),
        sellerGateways: parseList(body.sellerGateways),
        dropOffAddress: parseList(body.dropOffAddress),
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

    console.log("Step 3...");
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
    const sellerNationality = seller?.country || "Nigeria";
    const sellerCurrency = seller?.currencyCode || "NGN";

    let productData;

    if (isEditing) {
      console.log("Editing...");
      productData = {
        title,
        description,
        type,
        amountInStock,
        price: Number(price),
        currency: sellerCurrency,
        nationalityOfSeller: sellerNationality,
        physicalDetails,
        mediaUrls: productThumbnails,
        updatedAt: new Date(),
        niche,
      };

      await productDocRef.update(productData);
      await redis.del("catalog:all_products:v2");
      productData = { productId, sellerId: userUid, ...productData };
    } else {
      console.log("Creating new product...");
      const newCustomId = generateProductId(userUid);
      productDocRef = Product.doc(newCustomId);
      productData = {
        productId: newCustomId,
        sellerId: userUid,
        title,
        description,
        type,
        amountInStock,
        price: Number(price),
        currency: sellerCurrency,
        nationalityOfSeller: sellerNationality,
        physicalDetails,
        mediaUrls: productThumbnails,
        impressions: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        isAvailable: true,
        niche,
      };
      await productDocRef.set(productData);
    }
    console.log("Step 4...");
    console.log("New Product: ", productData);

    res.status(200).json({
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
              isRead: false,
              category: "store",
              actionType: "PRODUCT_UPDATE",
              title: "Product Updated Successfully",
              message: `Your changes to "${title}" have been successfully saved.`,
              entityId: productId,
              entityType: "product",
              sendEmail: true,
              payload: {
                productId: productId,
                productType: type,
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
export const fetchAllProducts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchAllProductsController";
  const action = "fetchAllProducts";
  const CACHE_KEY = "catalog:all_products:v2";

  try {
    const cachedData = await redis.get(CACHE_KEY);
    if (cachedData) {
      let parsedProducts;
      try {
        parsedProducts =
          typeof cachedData === "string" ? JSON.parse(cachedData) : cachedData;
      } catch (parseError) {
        parsedProducts = null;
      }

      if (parsedProducts) {
        res.status(200).json({
          success: true,
          products: parsedProducts,
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
    }
    const products = [];
    const snapshot = await Product.get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      products.push({
        id: doc.id,
        title: data.title,
        isAvailable: data.isAvailable,
        price: data.price,
        mediaUrls: data.mediaUrls,
        productId: data.productId,
        sellerId: data.sellerId,
        physicalDetails: data.physicalDetails,
        nationalityOfSeller: data.nationalityOfSeller,
        amountInStock: Number(data.amountInStock) || 0,
        // Without these the app's local cache overwrote them with NULL on
        // every sync (and "physical vs digital" stock logic broke).
        type: data.type ?? null,
        category: data.category ?? null,
        description: data.description ?? null,
        schoolName: data.schoolName ?? null,
        currency: data.currency,
        niche: data.niche,
        impressions: data.impressions,
        favCount: data.favCount,
        ratings: data.ratings,
        createdAt: data.createdAt,
        sales: data.sales,
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
          .set(CACHE_KEY, JSON.stringify(products), { ex: 1800 }) // Upstash expects lowercase "ex"
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
export const fetchStoreProducts = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "fetchStoreProductsController";
  const action = "fetchStoreProducts";
  const { q, category, cursor, limit = 10 } = req.query;
  const pageLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

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
      queryRef = queryRef.where("niche", "==", category);
      console.log(`[${controllerName}] Applied category filter:`, category);
    }

    if (isPopular) {
      queryRef = queryRef.orderBy("favCount", "desc");
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
    console.log("Missing required productId or action.");
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
/**
 * Replaced by POST /users/payments/intent + /users/payments/confirm
 * (controllers/paymentsController.js). The old version trusted the
 * client's totals and delivery fee and accepted the same Flutterwave
 * transaction any number of times.
 */
export const initializeCheckout = async (req, res) =>
  res.status(410).json({
    success: false,
    message: "Please update the app to complete checkout.",
  });
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
    // "completed" is included so a delivered order comes back with its new
    // status instead of the client keeping its stale "pending_delivery" copy
    // (which kept offering "Cancel Order" on orders already paid out).
    const ORDER_STATUSES = [
      "pending_delivery",
      "dropped_off",
      "cancelling",
      "cancelled",
      "completed",
    ];
    const [buyerSnapshot, sellerSnapshot] = await Promise.all([
      ProductOrder.where("buyerId", "==", userId)
        .where("status", "in", ORDER_STATUSES)
        .get(),
      ProductOrder.where("sellerId", "==", userId)
        .where("status", "in", ORDER_STATUSES)
        .get(),
    ]);

    const orderMap = new Map();

    buyerSnapshot.forEach((doc) => {
      orderMap.set(doc.id, { id: doc.id, ...doc.data() });
    });

    sellerSnapshot.forEach((doc) => {
      if (orderMap.has(doc.id)) return;
      // The verification code is the buyer's proof of delivery; the seller
      // must scan it from the buyer's phone, so it is never sent to them.
      const { verificationQrCode, ...order } = doc.data();
      orderMap.set(doc.id, { id: doc.id, ...order });
    });
    const orders = Array.from(orderMap.values()).sort((a, b) => {
      const timeA = a.createdAt?.toMillis
        ? a.createdAt.toMillis()
        : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toMillis
        ? b.createdAt.toMillis()
        : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
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
export const completeOrderDelivery = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "completeOrderDeliveryController";
  const action = "completeOrderDelivery";
  const { orderId: scannedCode } = req.body;
  let orderId = scannedCode;
  const scannerUid = req.user?.id || req.user?.uid;
  let orderDetails;

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
    // The scanned value is the buyer's secret verification code. Orders made
    // before that change used the order id itself as the code.
    const scanned = String(scannedCode).trim();
    let orderDocRef = ProductOrder.doc(scanned);
    const directSnap = await orderDocRef.get();
    if (directSnap.exists) {
      const direct = directSnap.data();
      if (direct.verificationQrCode && direct.verificationQrCode !== direct.orderId) {
        return res.status(403).json({
          success: false,
          message: "Scan the QR code on the buyer's phone to confirm delivery.",
        });
      }
    } else {
      const byCode = await ProductOrder.where("verificationQrCode", "==", scanned)
        .limit(1)
        .get();
      if (byCode.empty) {
        return res.status(404).json({ success: false, message: "Product order not found." });
      }
      orderDocRef = byCode.docs[0].ref;
    }

    const result = await db.runTransaction(async (transaction) => {
      const orderDoc = await transaction.get(orderDocRef);

      if (!orderDoc.exists) {
        throw new Error("Product order not found.");
      }

      const order = orderDoc.data();
      orderDetails = order;
      orderId = order.orderId || orderDoc.id;
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
          // Read inside the transaction so two deliveries completing at the
          // same time can't overwrite each other's balance update.
          transaction.get(Product.where("productId", "==", order.productId).limit(1)),
          transaction.get(User.where("uid", "==", order.sellerId).limit(1)),
          transaction.get(User.where("uid", "==", order.buyerId).limit(1)),
          order.deliveryMethod === "drop_off" && order.agentId
            ? transaction.get(User.where("uid", "==", order.agentId).limit(1))
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

      // Settle in the seller's currency. Orders created through payment
      // intents store it; older orders only have the buyer-currency amount.
      const hasSellerAmounts = typeof order.sellerAmount === "number";
      const buyerTier = buyer?.tier || "free";
      const deliveryFeeRate =
        DELIVERY_FEES?.[buyerTier]?.[order.deliveryMethod] || 0;
      const deliveryFeeAmount = hasSellerAmounts
        ? order.sellerDeliveryFee || 0
        : order.amountPaid * deliveryFeeRate;
      const totalHeld = hasSellerAmounts ? order.sellerAmount : order.amountPaid;
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
            recipientId: orderDetails.buyerId || result.buyer?.uid,
            category: "store",
            actionType: "ORDER_REVIEW_REQUEST",
            title: "Share your experience",
            isRead: false,
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
            isRead: false,
            category: "finance",
            actionType: "ORDER_COMPLETED",
            title: "Payment Received",
            message: `Your sale for ${result.productTitle} has been completed and funds released, proceed to payout to withdraw to your added bank account.`,
            payload: {
              amount: result.sellerEarnings,
              userName: result.seller.firstname,
              productName: result.productTitle,
              orderId: orderId,
              role: "seller",
              currency: orderDetails.amountPaidCurrencyCode,
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
              isRead: false,
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
            isRead: false,
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
              isRead: false,
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

    // --- DEBUG LOG 2 ---
    console.log(`DEBUG - Fetched ${sales.length} sales records for seller.`);
    if (sales.length > 0) {
      console.log("DEBUG - First sale record sample:", {
        id: sales[0].id,
        createdAt: sales[0].createdAt,
        type: typeof sales[0].createdAt,
      });
    }

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
    const limit = parseInt(req.query.limit) || 15;
    const lastCreatedAt = req.query.lastCreatedAt;

    let query = Transactions.where("userId", "==", userUid)
      .where("type", "==", "payout")
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (lastCreatedAt) {
      const cursorDate = new Date(lastCreatedAt);
      if (!isNaN(cursorDate.getTime())) {
        query = query.startAfter(cursorDate);
      }
    }

    const snapshot = await query.get();

    const history = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      const { __v, ...cleanData } = data;
      history.push({ id: doc.id, ...cleanData });
    });
    const hasMore = history.length === limit;
    // ISO string, not a Firestore Timestamp: the Timestamp reached the app as
    // {_seconds,_nanoseconds}, came back as "[object Object]", was ignored,
    // and every "load more" returned page one again.
    const lastCreatedAtValue = hasMore
      ? history[history.length - 1].createdAt
      : null;
    const nextCursor = lastCreatedAtValue
      ? (typeof lastCreatedAtValue.toDate === "function"
          ? lastCreatedAtValue.toDate()
          : new Date(lastCreatedAtValue)
        ).toISOString()
      : null;

    // Lifetime total of successful payouts (first page only) for the seller
    // overview's "Total generated" figure.
    let totalPaidOut;
    if (!lastCreatedAt) {
      const allPayouts = await Transactions.where("userId", "==", userUid)
        .where("type", "==", "payout")
        .select("amount", "status")
        .get();
      totalPaidOut = allPayouts.docs.reduce((sum, doc) => {
        const { amount, status } = doc.data();
        return status === "success" ? sum + (Number(amount) || 0) : sum;
      }, 0);
    }

    res.status(200).json({
      success: true,
      data: history,
      hasMore,
      nextCursor,
      ...(totalPaidOut !== undefined ? { totalPaidOut } : {}),
      message: "Payout history retrieved successfully.",
    });

    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    console.error("Fetch Payout History Error:", error.message);
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
  const userId = req.user?.id || req.user?.uid;
  const amount = roundMoney(req.body?.amount);

  const fail = (status, message) => {
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "error", message),
    );
    return res.status(status).json({ success: false, message });
  };

  if (!userId) return fail(401, "Unauthorized user identifier");
  if (!(amount > 0)) return fail(400, "Invalid payout amount specified.");
  if (!flutterwaveSecret()) {
    return fail(503, "Payouts are not available yet. Please try again later.");
  }

  try {
    const userQuery = await User.where("uid", "==", userId).limit(1).get();
    if (userQuery.empty) return fail(404, "User not found.");
    const userRef = userQuery.docs[0].ref;
    const user = userQuery.docs[0].data();

    if (!user.isVerified) {
      return fail(403, "Verify your identity before withdrawing.");
    }
    const account = user.payoutAccount || {
      bankCode: user.bankCode,
      accountNumber: user.accountNumber,
    };
    if (!account?.bankCode || !account?.accountNumber) {
      return fail(400, "Add a payout bank account before withdrawing.");
    }
    const currency = account.currency || currencyForCountry(user.country);

    const payoutId = generatePayoutId(userId);
    const reference = `REF-${payoutId}`;
    const transactionId = generateTransactionId("payment");
    const transactionRef = Transactions.doc(transactionId);
    const now = new Date();

    // 1. Reserve the money first. Two taps at once can't both pass this,
    //    because the balance is read and written in one transaction.
    await db.runTransaction(async (transaction) => {
      const fresh = (await transaction.get(userRef)).data();
      const balance = Number(fresh.pendingSalesBalance) || 0;
      if (balance + 0.001 < amount) {
        throw new PaymentError("Insufficient balance for this payout.");
      }
      transaction.update(userRef, {
        pendingSalesBalance: roundMoney(balance - amount),
        payoutHistory: [...(fresh.payoutHistory || []), payoutId],
        updatedAt: now,
      });
      transaction.set(transactionRef, {
        transactionId,
        userId,
        type: "payout",
        amount,
        currency,
        // Becomes "success" or "failed" when Flutterwave reports the
        // transfer result (transfer.completed webhook).
        status: "pending",
        payType: "out",
        title: "Sales Payout to Bank",
        reference,
        payoutId,
        createdAt: now,
        updatedAt: now,
      });
    });

    // 2. Ask Flutterwave to send it.
    let transfer;
    try {
      transfer = await flwRequest("/transfers", {
        method: "POST",
        body: {
          account_bank: account.bankCode,
          account_number: account.accountNumber,
          amount,
          currency,
          debit_currency: currency,
          reference,
          narration: `iCampus sales payout ${payoutId}`,
        },
      });
    } catch (err) {
      transfer = { ok: false, data: { message: err.message } };
    }

    // 3. Flutterwave refused it: put the money back.
    if (!transfer.ok || transfer.data?.status !== "success") {
      console.error("Flutterwave Transfer Failed:", transfer.data);
      await releaseFailedPayout(transactionRef, transfer.data?.message);
      return fail(
        400,
        transfer.data?.message
          ? `Payout failed: ${transfer.data.message}. Your balance was not deducted.`
          : "Payout failed. Your balance was not deducted.",
      );
    }

    await transactionRef.update({
      gatewayTransferId: transfer.data?.data?.id ?? null,
      updatedAt: new Date(),
    });

    const newBalance = roundMoney((Number(user.pendingSalesBalance) || 0) - amount);
    res.status(200).json({
      success: true,
      message: "Payout initiated. It usually reaches your bank within minutes.",
      transactionId,
      status: "pending",
      newPendingSalesBalance: newBalance,
    });

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    setImmediate(async () => {
      try {
        const currentDate = new Date();
        await Promise.all([
          createNotification({
            notificationId: generateNotificationId("store"),
            recipientId: userId,
            isRead: false,
            category: "finance",
            actionType: "SALES_PAYOUT_SUCCESS",
            title: "Payout Initiated",
            message: `Your withdrawal of ${currency} ${amount.toLocaleString()} is being processed to your bank account.`,
            recipientEmail: user.email,
            sendEmail: true,
            sendPush: true,
            payload: {
              username: user.firstname || user.lastname || "User",
              amount,
              payoutId,
              transactionId,
              date: currentDate.toLocaleDateString(),
              time: currentDate.toLocaleTimeString(),
              currency,
            },
          }),
          notifyAdmins(
            { role: ["finance", "super_admin"] },
            {
              notificationId: generateNotificationId("store"),
              actionType: "SALES_PAYOUT_ADMIN_ALERT",
              title: "New Bank Payout Disbursed",
              message: `User ${userId} withdrew ${currency} ${amount.toLocaleString()} via Flutterwave transfer.`,
              payload: { userId, amount, payoutId, transactionId, currency },
            },
            false,
          ),
        ]);
      } catch (err) {
        console.error("Background notification failure in requestPayout:", err);
      }
    });
  } catch (error) {
    if (error instanceof PaymentError) return fail(error.status, error.message);
    console.error("Payout Server Error:", error.message);
    return fail(500, "Something went wrong processing the payout.");
  }
};

/**
 * Marks a pending payout failed and returns its amount to the seller's
 * balance. Does nothing if the payout is no longer pending, so the request
 * handler and the webhook can't both refund it.
 */
export async function releaseFailedPayout(transactionRef, reason) {
  return db.runTransaction(async (transaction) => {
    const txSnap = await transaction.get(transactionRef);
    if (!txSnap.exists || txSnap.data().status !== "pending") return false;
    const payout = txSnap.data();
    const userSnap = await transaction.get(
      User.where("uid", "==", payout.userId).limit(1),
    );
    if (!userSnap.empty) {
      const userDoc = userSnap.docs[0];
      transaction.update(userDoc.ref, {
        pendingSalesBalance: roundMoney(
          (Number(userDoc.data().pendingSalesBalance) || 0) + payout.amount,
        ),
        updatedAt: new Date(),
      });
    }
    transaction.update(transactionRef, {
      status: "failed",
      failureReason: reason || null,
      updatedAt: new Date(),
    });
    return true;
  });
}
export const getDropOffStations = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "getDropOffStationsController";
  const action = "getDropOffStations";
  const CACHE_KEY = "stations:all_drop_off";

  try {
    const { lat, lng } = req.query;
    let stations = [];
    try {
      const cachedData = await redis.get(CACHE_KEY);
      if (cachedData) {
        stations =
          typeof cachedData === "string" ? JSON.parse(cachedData) : cachedData;
      }
    } catch (cacheError) {
      console.error("Cache read error, falling back to database:", cacheError);
    }
    if (!stations || stations.length === 0) {
      const snapshot = await DropOffStation.get();
      snapshot.forEach((doc) => {
        stations.push({ id: doc.id, ...doc.data() });
      });
      try {
        await redis.setex(CACHE_KEY, 1800, JSON.stringify(stations));
      } catch (cacheSetError) {
        console.error("Cache write error:", cacheSetError);
      }
    }

    if (!lat || !lng) {
      res.status(200).json({
        success: true,
        message: "Stations fetched successfully",
        data: stations,
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
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(controllerName, action, startTime, "success");
      }
    });
  } catch (error) {
    setImmediate(() => {
      if (typeof logControllerPerformance === "function") {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          error.message,
        );
      }
    });
    return res.status(500).json({
      success: false,
      message: "Internal server error processing station data",
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

    res.status(200).json({
      success: true,
      message: "Product entry successfully unlinked and purged.",
      data: { productId },
    });

    setImmediate(async () => {
      try {
        await redis.del("catalog:all_products:v2");

        const sellerQuery = await User.where("uid", "==", userUid)
          .limit(1)
          .get();
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