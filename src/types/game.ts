// src/types/game.ts

export interface Player {
  id: string;
  name: string;
  score: number;
  isHost?: boolean;
  hasAnswered?: boolean; // Has the player submitted an answer for the current round?
  isCorrect?: boolean;   // Was their submitted answer correct? (Set at round end)
}

export interface GameState {
  roomCode: string;
  question: string;
  answer: number;
  players: Player[];
  timeLeft: number;
  isGameActive: boolean;
  currentRound: number;
  roundStartTime: number | null; // Timestamp when the current round/timer started
  // Optional: Add game settings like round duration, max rounds etc.
}
