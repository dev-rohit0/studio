import type { Timestamp, FieldValue } from 'firebase/firestore';

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
  isShowingResults?: boolean;
  currentRound: number;
  roundStartTime: Timestamp | FieldValue | null;
  createdAt?: Timestamp | FieldValue;
  customQuestions?: CustomQuestion[];
  currentQuestionIndex?: number;
}

export interface DailyChallenge {
  id: string; // YYYY-MM-DD
  questions: CustomQuestion[];
  active: boolean;
  updatedAt: Timestamp | FieldValue;
}