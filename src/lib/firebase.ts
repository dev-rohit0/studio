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
// Avoid logging sensitive keys directly in production environments
if (process.env.NODE_ENV === 'development') {
    console.log('[Firebase] Config loaded:', {
        apiKey: firebaseConfig.apiKey ? '***' : 'MISSING',
        authDomain: firebaseConfig.authDomain || 'MISSING',
        projectId: firebaseConfig.projectId || 'MISSING',
        storageBucket: firebaseConfig.storageBucket || 'MISSING',
        messagingSenderId: firebaseConfig.messagingSenderId || 'MISSING',
        appId: firebaseConfig.appId ? '***' : 'MISSING',
    });
}

// Check if critical configuration values are missing or still placeholders
let configError = false;
if (!firebaseConfig.projectId || firebaseConfig.projectId === 'YOUR_PROJECT_ID') {
    console.error(
        '[Firebase] ERROR: Firebase Project ID is missing or not configured.' +
        ' Please set NEXT_PUBLIC_FIREBASE_PROJECT_ID in your .env.local file with the correct value from your Firebase project settings.' +
        ' Firestore operations will fail.'
    );
    configError = true;
}
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY') {
     console.error(
        '[Firebase] ERROR: Firebase API Key is missing.' +
        ' Please set NEXT_PUBLIC_FIREBASE_API_KEY in your .env.local file.'
    );
     configError = true;
}
// Add checks for other required keys if necessary, like authDomain, appId depending on usage.

// Initialize Firebase
let app;
let db;

// Prevent initialization errors in environments where Firebase might not be needed
// or if running in contexts like server-side rendering without env vars available immediately.
// Ensure this runs primarily client-side or in environments where env vars are guaranteed.
if (typeof window !== 'undefined') { // Basic check if running in a browser context
    if (!configError) {
        if (!getApps().length) {
          try {
            app = initializeApp(firebaseConfig);
            console.log('[Firebase] Initialized successfully.');
          } catch (error) {
            console.error('[Firebase] Error initializing Firebase app:', error);
          }
        } else {
          app = getApp();
          console.log('[Firebase] Using existing app instance.');
        }

        // Initialize Firestore only if app initialization was successful
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
    } else {
        console.error('[Firebase] Firebase initialization skipped due to configuration errors. Please check your .env.local file and restart the server/build.');
        // db will remain undefined, Firestore operations using it will fail safely later
    }
} else {
    console.warn('[Firebase] Firebase initialization skipped. Not in a browser environment or environment variables might not be available yet.');
}


export { db, app };
