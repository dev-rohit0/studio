# Math Mania - Firebase Multiplayer Game

This is a Next.js application for a real-time multiplayer math game built with Firebase Firestore.

## Getting Started

1.  **Clone the repository.**
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    ```
3.  **Configure Firebase:**
    *   Create a Firebase project at [https://console.firebase.google.com/](https://console.firebase.google.com/).
    *   Enable **Firestore Database** in your project settings (choose **Start in test mode** for initial development, but secure your rules for production).
    *   **(Optional but Recommended) Enable Google Analytics:** In your Firebase project settings (Project Settings > Integrations), ensure Google Analytics is enabled. This allows Firebase to automatically track usage data.
    *   Go to Project Settings > General. Under "Your apps", click the "</>" icon to add a web app.
    *   Register your app. Give it a nickname (e.g., "Math Mania Web"). **Firebase Hosting is NOT required for this step.**
    *   After registering, Firebase will show you a `firebaseConfig` object. Copy these values.
    *   Create a file named `.env.local` in the **root** of your project directory (if it doesn't already exist).
    *   Add the following environment variables to your `.env.local` file, **carefully replacing the placeholder values (`YOUR_...`) with your actual Firebase config values**:

        ```env
        # --- IMPORTANT: REPLACE THESE VALUES ---
        NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN
        NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=YOUR_STORAGE_BUCKET
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID
        NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_APP_ID

        # Optional: Add your Google Analytics Measurement ID for tracking
        # Get this from your Google Analytics 4 property settings (Admin > Data Streams > Web)
        # OR from your Firebase project settings (Project Settings > General > Your Apps > SDK setup and configuration > measurementId)
        NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
        # ---------------------------------------
        ```
        **CRITICAL:** Ensure your Project ID (`NEXT_PUBLIC_FIREBASE_PROJECT_ID`) and API Key (`NEXT_PUBLIC_FIREBASE_API_KEY`) are correctly set. **Do not leave them as placeholders.** If these values are missing or incorrect, the application will log errors, and Firebase operations (like creating/joining rooms or analytics) will fail.

    *   **Firestore Security Rules:** For development, you can start with open rules, but **ensure you secure these for production**:
        *   Go to your Firebase project: Build > Firestore Database > Rules.
        *   Use rules like this for initial testing (ALLOWS ANYONE TO READ/WRITE - **INSECURE FOR PRODUCTION**):
            ```
            rules_version = '2';
            service cloud.firestore {
              match /databases/{database}/documents {
                // Allow read/write access to all documents for DEVELOPMENT ONLY
                // WARNING: Secure this before deploying to production!
                match /{document=**} {
                  allow read, write: if true;
                  // For production, you might use rules based on authentication:
                  // allow read, write: if request.auth != null;
                }
              }
            }
            ```
        *   Click **Publish**.

4.  **Run the development server:**
    ```bash
    npm run dev
    # or
    yarn dev
    # or
    pnpm dev
    ```
    **Note:** After creating or modifying `.env.local`, you **must restart** your development server (`npm run dev`) for the changes to take effect.

5.  Open [http://localhost:9002](http://localhost:9002) (or your specified port) in your browser.

## How to Play

1.  **Create a Room:** Click "Create Room". A unique 6-digit code will be generated, and you'll be taken to the game room as the host.
2.  **Join a Room:**
    *   Enter the 6-digit room code provided by the host and click "Join Room".
    *   Alternatively, the host can share the room link directly.
3.  **Enter Your Name:** Once in the room, enter your name.
4.  **Start Game (Host):** The host clicks "Start Game" when ready.
5.  **Answer Questions:** Solve the math equation displayed and submit your answer before the 30-second timer runs out. Incorrect answers can be retried if time permits.
6.  **Scoreboard:** Scores are updated in real-time. Faster correct answers get more points.
7.  **Next Round:** The host controls advancing to the next round after results are shown briefly, or automatically if all players answer correctly.

## Project Structure

*   `src/app/`: Next.js App Router pages.
    *   `page.tsx`: The home/landing page for creating/joining rooms.
    *   `room/[roomCode]/page.tsx`: The game room page.
    *   `layout.tsx`: Root layout.
    *   `globals.css`: Global styles and Tailwind CSS setup.
*   `src/components/`: Reusable UI components (using shadcn/ui).
*   `src/hooks/`: Custom React hooks.
*   `src/lib/`: Utility functions and library configurations.
    *   `firebase.ts`: Firebase initialization (including Firestore and Analytics).
    *   `game-storage.ts`: Handles saving/retrieving player session info (like name/ID) using `sessionStorage`.
    *   `utils.ts`: General utility functions (like `cn` for Tailwind).
*   `src/types/`: TypeScript type definitions.
    *   `game.ts`: Defines `Player` and `GameState` interfaces.
*   `public/`: Static assets.
*   `.env.local`: Environment variables (Firebase config - **MUST BE CONFIGURED CORRECTLY**).
*   `next.config.ts`: Next.js configuration.
*   `tsconfig.json`: TypeScript configuration.
*   `tailwind.config.ts`: Tailwind CSS configuration.

## Key Technologies

*   Next.js (App Router)
*   React
*   TypeScript
*   Firebase Firestore (Real-time Database)
*   Firebase Analytics (via Google Analytics)
*   Tailwind CSS
*   shadcn/ui (UI Components)
*   Lucide React (Icons)

## Troubleshooting

*   **"Firebase Project ID is missing..." Error:** This means you haven't correctly configured your `.env.local` file. Double-check that the file exists in the project root, that the variable names start with `NEXT_PUBLIC_`, and that you've replaced placeholders like `YOUR_PROJECT_ID`, `YOUR_API_KEY` etc. with your actual Firebase credentials. Remember to **restart the development server** after changing `.env.local`.
*   **Creating/Joining Room Fails Silently or with Network Errors:** This is often caused by incorrect Firebase configuration (`.env.local`) or restrictive Firestore security rules. Verify your `.env.local` settings (especially Project ID and API Key) and ensure your Firestore rules allow writes (at least for development). Check the browser's developer console for more specific error messages from Firebase (e.g., "Bad Request", "Permission Denied").
*   **Firestore Permissions Errors:** If you see "permission denied" errors in the console, check your Firestore Security Rules in the Firebase console. Ensure they allow the necessary read/write operations for the `gameRooms` collection. For development, the open rules provided above should work.
*   **Analytics Not Working:** Ensure `NEXT_PUBLIC_GA_MEASUREMENT_ID` is correctly set in `.env.local` and matches the Measurement ID from your Firebase/Google Analytics settings. Verify that Analytics is enabled in your Firebase project settings. Check the browser console for any Firebase Analytics related errors.
