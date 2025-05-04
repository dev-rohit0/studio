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
    *   Enable Firestore database in your project settings.
    *   Go to Project Settings > General. Under "Your apps", add a web app.
    *   Copy the `firebaseConfig` object provided.
    *   Create a `.env.local` file in the root of your project (if it doesn't exist).
    *   Add the following environment variables to your `.env.local` file, replacing the placeholder values with your actual Firebase config values:

        ```env
        NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_AUTH_DOMAIN
        NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=YOUR_STORAGE_BUCKET
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID
        NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_APP_ID
        ```
        **IMPORTANT:** Ensure your Project ID (`NEXT_PUBLIC_FIREBASE_PROJECT_ID`) is correctly set. The application will log an error and Firestore operations will fail if this is missing or incorrect.

    *   **Firestore Security Rules:** For development, you can start with open rules, but **ensure you secure these for production**:
        *   Go to Firestore Database > Rules.
        *   Use rules like this for initial testing (ALLOWS ANYONE TO READ/WRITE):
            ```
            rules_version = '2';
            service cloud.firestore {
              match /databases/{database}/documents {
                // Allow read/write access to all documents for now
                // WARNING: Secure this before deploying to production!
                match /{document=**} {
                  allow read, write: if true;
                }
              }
            }
            ```
        *   For production, you'll need rules that restrict access based on authentication or specific logic.

4.  **Run the development server:**
    ```bash
    npm run dev
    # or
    yarn dev
    # or
    pnpm dev
    ```
5.  Open [http://localhost:9002](http://localhost:9002) (or your specified port) in your browser.

## How to Play

1.  **Create a Room:** Click "Create Room". A unique 6-digit code will be generated, and you'll be taken to the game room as the host.
2.  **Join a Room:**
    *   Enter the 6-digit room code provided by the host and click "Join Room".
    *   Alternatively, the host can share the room link directly.
3.  **Enter Your Name:** Once in the room, enter your name.
4.  **Start Game (Host):** The host clicks "Start Game" when ready.
5.  **Answer Questions:** Solve the math equation displayed and submit your answer before the 30-second timer runs out.
6.  **Scoreboard:** Scores are updated in real-time. Faster correct answers get more points.
7.  **Next Round:** The host controls advancing to the next round after results are shown briefly.

## Project Structure

*   `src/app/`: Next.js App Router pages.
    *   `page.tsx`: The home/landing page for creating/joining rooms.
    *   `room/[roomCode]/page.tsx`: The game room page.
    *   `layout.tsx`: Root layout.
    *   `globals.css`: Global styles and Tailwind CSS setup.
*   `src/components/`: Reusable UI components (using shadcn/ui).
*   `src/hooks/`: Custom React hooks.
*   `src/lib/`: Utility functions and library configurations.
    *   `firebase.ts`: Firebase initialization and configuration.
    *   `game-storage.ts`: Handles saving/retrieving player session info (like name/ID).
    *   `utils.ts`: General utility functions (like `cn` for Tailwind).
*   `src/types/`: TypeScript type definitions.
    *   `game.ts`: Defines `Player` and `GameState` interfaces.
*   `public/`: Static assets.
*   `.env.local`: Environment variables (Firebase config).
*   `next.config.ts`: Next.js configuration.
*   `tsconfig.json`: TypeScript configuration.
*   `tailwind.config.ts`: Tailwind CSS configuration.

## Key Technologies

*   Next.js (App Router)
*   React
*   TypeScript
*   Firebase Firestore (Real-time Database)
*   Tailwind CSS
*   shadcn/ui (UI Components)
*   Lucide React (Icons)
