// src/lib/game-storage.ts
'use client';

// Keep player info in sessionStorage as it's specific to the user's current session
// Game state is now handled by Firestore (see room page)
const PLAYER_INFO_KEY = 'math_mania_player_info';

/**
 * Saves player's ID and name to sessionStorage for the current browser session.
 * MUST be called client-side.
 */
export const savePlayerInfo = (playerId: string, playerName: string): void => {
  if (typeof window === 'undefined') return;
  try {
    console.log(`[savePlayerInfo] Saving to sessionStorage:`, { playerId, playerName });
    sessionStorage.setItem(PLAYER_INFO_KEY, JSON.stringify({ playerId, playerName }));
    // Verify save
    const verifyRaw = sessionStorage.getItem(PLAYER_INFO_KEY);
    console.log(`[savePlayerInfo] Verified raw data saved:`, verifyRaw);
    if (JSON.stringify({ playerId, playerName }) !== verifyRaw) {
        console.error(`[savePlayerInfo] Verification failed! Saved data does not match.`);
    } else {
         console.log(`[savePlayerInfo] Successfully verified saved player info.`);
    }
  } catch (error) {
    console.error('Error saving player info to sessionStorage:', error);
  }
};

/**
 * Retrieves player's ID and name from sessionStorage.
 * MUST be called client-side.
 */
export const getPlayerInfo = (): { playerId: string; playerName: string } | null => {
  if (typeof window === 'undefined') return null;
  try {
    console.log(`[getPlayerInfo] Attempting to read from sessionStorage key: ${PLAYER_INFO_KEY}`);
    const info = sessionStorage.getItem(PLAYER_INFO_KEY);
    console.log(`[getPlayerInfo] Fetched raw data:`, info);
    if (!info) {
        console.warn(`[getPlayerInfo] No player info found in sessionStorage.`);
        return null;
    }
    const parsedInfo = JSON.parse(info);
    console.log(`[getPlayerInfo] Successfully parsed player info:`, parsedInfo);
    return parsedInfo;
  } catch (error) {
    console.error('Error reading/parsing player info from sessionStorage:', error);
        // Attempt to remove potentially corrupted data
    try {
        sessionStorage.removeItem(PLAYER_INFO_KEY);
        console.warn(`[getPlayerInfo] Removed potentially corrupted data from sessionStorage.`);
    } catch (removeError) {
        console.error(`[getPlayerInfo] Failed to remove corrupted data from sessionStorage`, removeError);
    }
    return null;
  }
};

/**
 * Clears player info from sessionStorage.
 * MUST be called client-side.
 */
export const clearPlayerInfo = (): void => {
  if (typeof window === 'undefined') return;
  try {
    console.log(`[clearPlayerInfo] Removing player info from sessionStorage.`);
    sessionStorage.removeItem(PLAYER_INFO_KEY);
    console.log(`[clearPlayerInfo] Player info removed.`);
  } catch (error) {
    console.error('Error clearing player info from sessionStorage:', error);
  }
};

/**
 * Generates a simple unique ID.
 * This is fine for non-critical IDs like player IDs within a session.
 */
export const generateId = (): string => {
    // Simple, non-cryptographically secure ID generation
    return Math.random().toString(36).substring(2, 11);
}
