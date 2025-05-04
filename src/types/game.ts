// src/types/game.ts
import type { Timestamp } from 'firebase/firestore'; // Import Timestamp type

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost?: boolean;
  hasAnswered?: boolean; // Has the player submitted an answer for the current round?
  isCorrect?: boolean | null;   // Was their submitted answer correct? (Set at round end, null initially/if not answered)
}

export interface GameState {
  roomCode: string; // Keep roomCode for reference if needed, though Firestore doc ID is the primary key
  question: string;
  answer: number;
  players: Player[];
  timeLeft: number; // Can still be useful for quick display, but derived from roundStartTime primarily
  isGameActive: boolean;
  currentRound: number;
  roundStartTime: Timestamp | number | null; // Use Firestore Timestamp for accurate server time, allow number for initial state before server write, null if not started
  createdAt?: Timestamp; // Optional: Track when the room was created
  // Optional: Add game settings like round duration, max rounds etc.
}
