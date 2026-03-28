// src/types/game.ts
import type { Timestamp } from 'firebase/firestore';

export interface CustomQuestion {
  question: string;
  answer: number;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost?: boolean;
  hasAnswered?: boolean;
  isCorrect?: boolean | null;
  lastActive?: Timestamp | null;
}

export interface GameState {
  roomCode: string;
  question: string;
  answer: number;
  players: Player[];
  timeLeft: number;
  isGameActive: boolean;
  isGameOver?: boolean;
  currentRound: number;
  roundStartTime: Timestamp | number | null;
  createdAt?: Timestamp;
  customQuestions?: CustomQuestion[];
  currentQuestionIndex?: number;
}
