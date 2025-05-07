// src/types/game.ts
import type { Timestamp } from 'firebase/firestore'; // Import Timestamp type

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost?: boolean;
  hasAnswered?: boolean;
  isCorrect?: boolean | null;
  lastActive?: Timestamp | null; // Timestamp of the player's last known activity
}

export interface GameState {
  roomCode: string;
  question: string;
  answer: number;
  players: Player[];
  timeLeft: number;
  isGameActive: boolean;
  currentRound: number;
  roundStartTime: Timestamp | number | null;
  createdAt?: Timestamp;
}
