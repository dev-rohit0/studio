// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Your web app's Firebase configuration
// It's recommended to use environment variables for sensitive information
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Log the configuration to verify environment variables are loaded
console.log('[Firebase] Config loaded:', {
    apiKey: firebaseConfig.apiKey ? '***' : 'MISSING', // Hide API key in logs
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId ? '***' : 'MISSING', // Hide App ID in logs
});

// Check if the Project ID is missing or still the placeholder
if (!firebaseConfig.projectId || firebaseConfig.projectId === 'YOUR_PROJECT_ID') {
    console.error(
        '[Firebase] ERROR: Firebase Project ID is missing or not configured.' +
        ' Please set NEXT_PUBLIC_FIREBASE_PROJECT_ID environment variable.' +
        ' Firestore operations will likely fail.'
    );
    // Optionally throw an error to halt initialization if configuration is critical
    // throw new Error("Firebase Project ID is not configured.");
}


// Initialize Firebase
let app;
if (!getApps().length) {
  try {
    app = initializeApp(firebaseConfig);
    console.log('[Firebase] Initialized successfully.');
  } catch (error) {
    console.error('[Firebase] Error initializing Firebase app:', error);
    // Handle initialization error appropriately, maybe prevent app from fully loading
  }
} else {
  app = getApp();
  console.log('[Firebase] Using existing app instance.');
}

// Initialize Firestore only if app initialization was successful
let db;
if (app) {
  try {
    db = getFirestore(app);
    console.log('[Firebase] Firestore instance created.');
  } catch (error) {
    console.error('[Firebase] Error getting Firestore instance:', error);
  }
} else {
    console.error('[Firebase] Cannot initialize Firestore because Firebase app failed to initialize.');
}


export { db, app };
