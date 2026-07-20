import mongoose from 'mongoose';
import { db } from './config/firebaseAdmin.js'; 


const MONGO_URI = 'mongodb://localhost:27017/icampus';

async function migrateData() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB for migration...");

    const usersCollection = mongoose.connection.collection('users');
    const users = await usersCollection.find({}).toArray();
    console.log(`Migrating ${users.length} users to Firestore...`);
    for (const user of users) {
      const docId = user.uid || user._id.toString();
      const firestoreData = {
        ...user,
        _id: undefined,
        createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
      };
      await db.collection('users').doc(docId).set(firestoreData, { merge: true });
    }
    console.log("User migration completed successfully!");

    const postsCollection = mongoose.connection.collection('posts');
    const posts = await postsCollection.find({}).toArray();
    console.log(`Migrating ${posts.length} posts to Firestore...`);
    for (const post of posts) {
      const docId = post.postId || post._id.toString();
      const firestoreData = {
        ...post,
        _id: undefined,
        createdAt: post.createdAt ? new Date(post.createdAt) : new Date(),
      };
      await db.collection('posts').doc(docId).set(firestoreData, { merge: true });
    }
    console.log("Post migration completed successfully!");

    const productsCollection = mongoose.connection.collection('store-products');
    const products = await productsCollection.find({}).toArray();
    console.log(`Migrating ${products.length} products to Firestore...`);
    for (const product of products) {
      const docId = product.productId || product._id.toString();
      const firestoreData = {
        ...product,
        _id: undefined,
        createdAt: product.createdAt ? new Date(product.createdAt) : new Date(),
      };
      await db.collection('products').doc(docId).set(firestoreData, { merge: true });
    }

    console.log("Product migration completed successfully!");

    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrateData();