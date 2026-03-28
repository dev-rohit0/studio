// src/lib/game-storage.ts
'use client';

const PLAYER_INFO_KEY = 'math_mania_player_info';

export const savePlayerInfo = (playerId: string, playerName: string): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(PLAYER_INFO_KEY, JSON.stringify({ playerId, playerName }));
  } catch (error) {
    console.error('Error saving player info to sessionStorage:', error);
  }
};

export const getPlayerInfo = (): { playerId: string; playerName: string } | null => {
  if (typeof window === 'undefined') return null;
  try {
    const info = sessionStorage.getItem(PLAYER_INFO_KEY);
    if (!info) return null;
    return JSON.parse(info);
  } catch (error) {
    console.error('Error reading/parsing player info from sessionStorage:', error);
    return null;
  }
};

export const clearPlayerInfo = (): void => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(PLAYER_INFO_KEY);
  } catch (error) {
    console.error('Error clearing player info from sessionStorage:', error);
  }
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};