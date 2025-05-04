// src/lib/game-storage.ts
'use client';

import type { GameState } from '@/types/game'; // Assuming types are defined here

const getStorageKey = (roomCode: string) => `math_mania_room_${roomCode}`;
const PLAYER_INFO_KEY = 'math_mania_player_info';

/**
 * Retrieves the game state for a specific room from localStorage.
 * MUST be called client-side.
 */
export const getGameState = (roomCode: string): GameState | null => {
  if (typeof window === 'undefined') return null;
  const storageKey = getStorageKey(roomCode);
  console.log(`[getGameState] Attempting to read from localStorage with key: ${storageKey}`);
  try {
    const storedState = localStorage.getItem(storageKey);
    console.log(`[getGameState] Fetched raw state for ${roomCode} (key: ${storageKey}):`, storedState);
    if (!storedState) {
        console.warn(`[getGameState] No state found in localStorage for key: ${storageKey}`);
        return null;
    }
    const parsedState = JSON.parse(storedState) as GameState;
    console.log(`[getGameState] Successfully parsed state for ${roomCode}:`, parsedState);
    return parsedState;
  } catch (error) {
    console.error(`Error reading/parsing game state from localStorage (key: ${storageKey}):`, error);
    // Attempt to remove potentially corrupted data
    try {
        localStorage.removeItem(storageKey);
        console.warn(`[getGameState] Removed potentially corrupted data for key: ${storageKey}`);
    } catch (removeError) {
        console.error(`[getGameState] Failed to remove corrupted data for key: ${storageKey}`, removeError);
    }
    return null;
  }
};

/**
 * Saves the game state for a specific room to localStorage.
 * MUST be called client-side.
 */
export const saveGameState = (roomCode: string, state: GameState): void => {
  if (typeof window === 'undefined') return;
   const storageKey = getStorageKey(roomCode);
   console.log(`[saveGameState] Attempting to save to localStorage with key: ${storageKey}`);
  try {
    const stateString = JSON.stringify(state);
    console.log(`[saveGameState] Saving state string for ${roomCode} (key: ${storageKey}):`, stateString);
    localStorage.setItem(storageKey, stateString);
    // Verify save immediately after setting
    const verifyRaw = localStorage.getItem(storageKey);
    console.log(`[saveGameState] Verified raw state saved for ${roomCode} (key: ${storageKey}):`, verifyRaw);
    if (stateString !== verifyRaw) {
        console.error(`[saveGameState] Verification failed! Saved data does not match for key: ${storageKey}. Got:`, verifyRaw);
    } else {
         console.log(`[saveGameState] Successfully verified saved state for ${roomCode}.`);
    }
  } catch (error) {
    console.error(`Error saving game state to localStorage (key: ${storageKey}):`, error);
  }
};

/**
 * Deletes the game state for a specific room from localStorage.
 * MUST be called client-side.
 */
export const deleteGameState = (roomCode: string): void => {
   if (typeof window === 'undefined') return;
   const storageKey = getStorageKey(roomCode);
   console.log(`[deleteGameState] Attempting to remove from localStorage with key: ${storageKey}`);
   try {
     localStorage.removeItem(storageKey);
     console.log(`[deleteGameState] Successfully removed state for key: ${storageKey}`);
   } catch (error) {
     console.error(`Error deleting game state from localStorage (key: ${storageKey}):`, error);
   }
};

/**
 * Saves player's ID and name to sessionStorage for the current browser session.
 */
export const savePlayerInfo = (playerId: string, playerName: string): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PLAYER_INFO_KEY, JSON.stringify({ playerId, playerName }));
  } catch (error) {
    console.error('Error saving player info to sessionStorage:', error);
  }
};

/**
 * Retrieves player's ID and name from sessionStorage.
 */
export const getPlayerInfo = (): { playerId: string; playerName: string } | null => {
  if (typeof window === 'undefined') return null;
  try {
    const info = sessionStorage.getItem(PLAYER_INFO_KEY);
    return info ? JSON.parse(info) : null;
  } catch (error) {
    console.error('Error reading player info from sessionStorage:', error);
    return null;
  }
};

/**
 * Clears player info from sessionStorage.
 */
export const clearPlayerInfo = (): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PLAYER_INFO_KEY);
  } catch (error) {
    console.error('Error clearing player info from sessionStorage:', error);
  }
};

/**
 * Generates a simple unique ID.
 */
export const generateId = (): string => {
    // Simple, non-cryptographically secure ID generation
    return Math.random().toString(36).substring(2, 11);
}
