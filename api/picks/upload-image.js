// FILE LOCATION: api/picks/upload-image.js
// Uploads bet slip image to Firebase Storage and creates Firestore record

import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}');

let app;
try {
  app = initializeApp({
    credential: cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  });
} catch (err) {
  // App already initialized
  app = require('firebase-admin/app').getApp();
}

const storage = getStorage(app);
const db = getFirestore(app);

export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, imageBase64, fileName } = req.body;

  try {
    // Validate inputs
    if (!userId || !imageBase64 || !fileName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, imageBase64, fileName'
      });
    }

    // Decode base64
    const buffer = Buffer.from(imageBase64, 'base64');

    // Determine file type from filename
    const fileExtension = fileName.split('.').pop().toLowerCase();
    const mimeType = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp'
    }[fileExtension] || 'image/jpeg';

    // Create unique filename
    const timestamp = Date.now();
    const storagePath = `bet_slips/${userId}/${timestamp}_${Math.random().toString(36).substr(2, 9)}.jpg`;

    // Upload to Firebase Storage
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    console.log(`📤 Uploading image to: ${storagePath}`);

    await file.save(buffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          userId,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    // Get signed URL (valid for 7 days)
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    console.log(`✅ Image uploaded successfully`);

    // Create Firestore document for this bet
    const betDocRef = await db.collection('users').doc(userId).collection('bets').add({
      image_url: signedUrl,
      storage_path: storagePath,
      image_uploaded_at: new Date(),
      status: 'extracted', // Will be updated by extract-picks endpoint
      created_at: new Date(),
      fileName,
      fileSize: buffer.length
    });

    console.log(`📝 Firestore document created: ${betDocRef.id}`);

    return res.status(200).json({
      success: true,
      betId: betDocRef.id,
      image_url: signedUrl,
      storage_path: storagePath
    });

  } catch (error) {
    console.error('❌ Error uploading image:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to upload image'
    });
  }
}
