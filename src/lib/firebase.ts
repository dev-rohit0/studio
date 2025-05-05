// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, isSupported } from "firebase/analytics"; // Import getAnalytics and isSupported
import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import type { Analytics } from 'firebase/analytics';


// Your web app's Firebase configuration
// Use environment variables for sensitive information
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID, // Add Measurement ID
};

// Log the configuration during development for verification
if (process.env.NODE_ENV === 'development') {
    console.log('[Firebase] Config loaded:', {
        apiKey: firebaseConfig.apiKey ? '***' : 'MISSING',
        authDomain: firebaseConfig.authDomain || 'MISSING',
        projectId: firebaseConfig.projectId || 'MISSING',
        storageBucket: firebaseConfig.storageBucket || 'MISSING',
        messagingSenderId: firebaseConfig.messagingSenderId || 'MISSING',
        appId: firebaseConfig.appId ? '***' : 'MISSING',
        measurementId: firebaseConfig.measurementId || 'MISSING (Analytics disabled)',
    });
}

// --- Configuration Validation ---
let configError = false;
const missingVars: string[] = [];

if (!firebaseConfig.projectId || firebaseConfig.projectId === 'YOUR_PROJECT_ID') {
    missingVars.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
    configError = true;
}
if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'YOUR_API_KEY') {
     missingVars.push('NEXT_PUBLIC_FIREBASE_API_KEY');
     configError = true;
}
// Add checks for other *essential* keys if needed (e.g., authDomain if using Auth extensively)

if (configError) {
     console.error(
        `[Firebase] ERROR: Critical Firebase configuration missing or invalid: ${missingVars.join(', ')}. ` +
        `Please set these variables in your .env.local file. Firebase services may fail.`
    );
}

// --- Firebase Initialization ---
let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let analytics: Analytics | undefined; // Define analytics variable

// Prevent initialization errors in environments where Firebase might not be needed
// Ensure this runs primarily client-side or in environments where env vars are guaranteed.
if (typeof window !== 'undefined') { // Check if running in a browser context
    if (!configError) {
        if (!getApps().length) {
          try {
            app = initializeApp(firebaseConfig);
            console.log('[Firebase] Initialized successfully.');
          } catch (error) {
            console.error('[Firebase] Error initializing Firebase app:', error);
            app = undefined; // Ensure app is undefined on error
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
            db = undefined; // Ensure db is undefined on error
          }

          // Initialize Analytics only if app exists, Measurement ID is provided, and Analytics is supported
          if (firebaseConfig.measurementId) {
            isSupported().then((supported) => {
              if (supported && app) {
                 try {
                    analytics = getAnalytics(app);
                    console.log('[Firebase] Analytics initialized successfully.');
                 } catch (error) {
                    console.error('[Firebase] Error initializing Analytics:', error);
                    analytics = undefined; // Ensure analytics is undefined on error
                 }
              } else {
                console.log('[Firebase] Analytics is not supported in this environment.');
              }
            }).catch(error => {
                 console.error('[Firebase] Error checking Analytics support:', error);
            });

          } else {
             console.log('[Firebase] Analytics initialization skipped: NEXT_PUBLIC_GA_MEASUREMENT_ID not provided.');
          }

        } else {
            console.error('[Firebase] Cannot initialize Firestore/Analytics because Firebase app failed to initialize.');
        }
    } else {
        console.error('[Firebase] Firebase initialization skipped due to configuration errors. Please check your .env.local file and restart the server/build.');
        // db and analytics will remain undefined
    }
} else {
    console.warn('[Firebase] Firebase initialization skipped. Not in a browser environment or environment variables might not be available yet.');
}


export { db, app, analytics }; // Export analytics instance
