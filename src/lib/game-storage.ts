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
  try {
    const storedState = localStorage.getItem(getStorageKey(roomCode));
    return storedState ? (JSON.parse(storedState) as GameState) : null;
  } catch (error) {
    console.error('Error reading game state from localStorage:', error);
    return null;
  }
};

/**
 * Saves the game state for a specific room to localStorage.
 * MUST be called client-side.
 */
export const saveGameState = (roomCode: string, state: GameState): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(roomCode), JSON.stringify(state));
  } catch (error) {
    console.error('Error saving game state to localStorage:', error);
  }
};

/**
 * Deletes the game state for a specific room from localStorage.
 * MUST be called client-side.
 */
export const deleteGameState = (roomCode: string): void => {
   if (typeof window === 'undefined') return;
   try {
     localStorage.removeItem(getStorageKey(roomCode));
   } catch (error) {
     console.error('Error deleting game state from localStorage:', error);
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
    return Math.random().toString(36).substring(2, 9);
}
