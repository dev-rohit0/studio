'use client';

import type { NextPage } from 'next';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Link as LinkIcon, ClipboardCopy, Users, Share2, Clock } from 'lucide-react';

interface Player {
  id: string;
  name: string;
  score: number;
  isHost?: boolean;
  hasAnswered?: boolean;
  isCorrect?: boolean;
}

interface GameState {
  question: string;
  answer: number;
  players: Player[];
  timeLeft: number;
  isGameActive: boolean;
  currentRound: number;
}

const GameRoomPage: NextPage = () => {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const roomCode = params.roomCode as string;

  const [playerName, setPlayerName] = useState<string>(''); // Will be set upon joining
  const [currentAnswer, setCurrentAnswer] = useState<string>('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isJoining, setIsJoining] = useState(true); // Start in joining state
  const [showScoreboard, setShowScoreboard] = useState(true); // Show scoreboard by default

  // --- Mock Game Logic ---
  // In a real app, this would be managed via WebSockets/Realtime Database

  const generateEquation = (): { question: string; answer: number } => {
      const operations = ['+', '-', '*', '/'];
      let question = '';
      let answer = NaN;
      let attempts = 0;

      while (isNaN(answer) || !Number.isInteger(answer) || attempts > 100) {
        attempts++;
        const op = operations[Math.floor(Math.random() * operations.length)];
        const num1 = Math.floor(Math.random() * (op === '*' || op === '/' ? 15 : 50)) + 1; // Smaller numbers for mult/div
        const num2 = Math.floor(Math.random() * (op === '*' || op === '/' ? 15 : 50)) + (op === '/' ? 1 : 0); // Avoid division by zero

        switch (op) {
            case '+':
                question = `${num1} + ${num2}`;
                answer = num1 + num2;
                break;
            case '-':
                // Ensure positive result for simplicity
                const max = Math.max(num1, num2);
                const min = Math.min(num1, num2);
                question = `${max} - ${min}`;
                answer = max - min;
                break;
            case '*':
                question = `${num1} × ${num2}`; // Use multiplication symbol
                answer = num1 * num2;
                break;
            case '/':
                // Ensure integer division result
                const product = num1 * num2;
                question = `${product} ÷ ${num2}`; // Use division symbol
                answer = num1;
                break;
        }
      }
       if (attempts > 100) { // Fallback if generation fails repeatedly
           question = '1 + 1';
           answer = 2;
       }

      return { question, answer };
  };

  const initializeGame = (initialPlayerName: string): GameState => {
    const { question, answer } = generateEquation();
    const initialPlayerId = Math.random().toString(36).substring(7); // Mock player ID
    setPlayerName(initialPlayerName);
    return {
      question: 'Waiting for players...',
      answer: 0, // No answer initially
      players: [
        { id: initialPlayerId, name: initialPlayerName, score: 0, isHost: true }, // First player is host
        // Add more mock players for testing if needed
        // { id: 'p2', name: 'Bot Alice', score: 0 },
        // { id: 'p3', name: 'Bot Bob', score: 0 },
      ],
      timeLeft: 0, // Timer starts when game starts
      isGameActive: false, // Starts inactive
      currentRound: 0,
    };
  };

  const startGame = () => {
      if (!gameState) return;
      const { question, answer } = generateEquation();
      setGameState(prev => prev ? {
          ...prev,
          question,
          answer,
          timeLeft: 30,
          isGameActive: true,
          currentRound: 1,
          players: prev.players.map(p => ({...p, hasAnswered: false, isCorrect: undefined })) // Reset answer status
      } : null);
  };

  const nextQuestion = useCallback(() => {
    if (!gameState || !gameState.isGameActive) return;
    const { question, answer } = generateEquation();
    setGameState(prev => prev ? {
      ...prev,
      question,
      answer,
      timeLeft: 30,
      currentRound: prev.currentRound + 1,
      players: prev.players.map(p => ({ ...p, hasAnswered: false, isCorrect: undefined })), // Reset answer status
    } : null);
    setCurrentAnswer(''); // Clear input field for the new question
  }, [gameState]);


  // Timer Logic
  useEffect(() => {
    if (!gameState || !gameState.isGameActive || gameState.timeLeft <= 0) {
      if (gameState?.isGameActive && gameState.timeLeft <= 0) {
           // Time's up, reveal answers (if not already) and prepare for next round
            setGameState(prev => prev ? {
                ...prev,
                players: prev.players.map(p => ({...p, isCorrect: p.hasAnswered ? p.isCorrect : false })) // Mark unanswered as incorrect
            } : null);
           const timer = setTimeout(nextQuestion, 3000); // Show results for 3s, then next question
           return () => clearTimeout(timer);
      }
      return;
    }

    const timer = setInterval(() => {
      setGameState(prev => {
        if (!prev || !prev.isGameActive || prev.timeLeft <= 0) {
          clearInterval(timer);
          return prev;
        }
        return { ...prev, timeLeft: prev.timeLeft - 1 };
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, nextQuestion]);


  const handleAnswerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameState || !gameState.isGameActive || currentAnswer === '' || gameState.players.find(p => p.name === playerName)?.hasAnswered) return;

    const submittedAnswer = parseInt(currentAnswer, 10);
    const isCorrect = submittedAnswer === gameState.answer;
    const scoreToAdd = isCorrect ? Math.max(5, Math.floor(gameState.timeLeft * 0.5)) : 0; // Faster answers get more points (min 5)

    toast({
      title: isCorrect ? 'Correct!' : 'Incorrect!',
      description: isCorrect ? `+${scoreToAdd} points!` : `The answer was ${gameState.answer}`,
      variant: isCorrect ? 'default' : 'destructive', // Use default (green accent) for correct
      className: isCorrect ? 'bg-accent text-accent-foreground border-accent' : '',
    });

    setGameState(prev => prev ? {
      ...prev,
      players: prev.players.map(p =>
        p.name === playerName
          ? { ...p, score: p.score + scoreToAdd, hasAnswered: true, isCorrect }
          : p
      ),
    } : null);

     // Optionally clear answer field after submit, or keep it to show what was submitted
     // setCurrentAnswer('');
  };

  const handleJoinGame = (name: string) => {
      if (!name.trim()) {
          toast({ title: "Please enter your name", variant: "destructive" });
          return;
      }
      // In real app: send join request to server
      const newState = initializeGame(name);
      setGameState(newState);
      setIsJoining(false); // Move to waiting/game state
  };

   const handleCopyLink = () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link).then(() => {
      toast({ title: 'Link Copied!', description: 'Share it with your friends.' });
    }).catch(err => {
      console.error('Failed to copy link: ', err);
      toast({ title: 'Failed to copy link', variant: 'destructive' });
    });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode).then(() => {
      toast({ title: 'Room Code Copied!' });
    }).catch(err => {
      console.error('Failed to copy code: ', err);
      toast({ title: 'Failed to copy code', variant: 'destructive' });
    });
  };

  const isHost = gameState?.players.find(p => p.name === playerName)?.isHost ?? false;
  const currentPlayer = gameState?.players.find(p => p.name === playerName);
  const hasPlayerAnswered = currentPlayer?.hasAnswered ?? false;

  // --- Render Logic ---

  if (isJoining) {
    return (
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Join Room: {roomCode}</CardTitle>
          <CardDescription className="text-center">Enter your name to join the game</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Input
             type="text"
             placeholder="Your Name"
             value={playerName}
             onChange={(e) => setPlayerName(e.target.value)}
             maxLength={15}
             aria-label="Enter your name"
           />
           <Button onClick={() => handleJoinGame(playerName)} className="w-full" disabled={!playerName.trim()}>
             Join Game
           </Button>
        </CardContent>
      </Card>
    );
  }


  if (!gameState) {
    // Could show a loading state or error
    return <div className="text-center p-4">Loading game room...</div>;
  }

  const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col h-screen max-h-screen w-full max-w-md bg-secondary">

        {/* Header Area */}
        <Card className="m-2 shadow rounded-lg flex-shrink-0">
         <CardHeader className="p-3">
             <div className="flex justify-between items-center mb-2">
                 <CardTitle className="text-xl flex items-center gap-1">
                     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-brain-circuit"><path d="M12 5a3 3 0 1 0-5.997.142"/><path d="M18 5a3 3 0 1 0-5.997.142"/><path d="M12 12a3 3 0 1 0-5.997.142"/><path d="M18 12a3 3 0 1 0-5.997.142"/><path d="M12 19a3 3 0 1 0-5.997.142"/><path d="M18 19a3 3 0 1 0-5.997.142"/><path d="M12 8V5"/><path d="M18 8V5"/><path d="M12 15v-3"/><path d="M18 15v-3"/><path d="M12 22v-3"/><path d="M18 22v-3"/><path d="m15 6-3-1-3 1"/><path d="m15 13-3-1-3 1"/><path d="m15 20-3-1-3 1"/><path d="M9 6.14A3 3 0 0 0 9 5"/><path d="M9 13.14A3 3 0 0 0 9 12"/><path d="M9 20.14A3 3 0 0 0 9 19"/><path d="M15 6.14A3 3 0 0 1 15 5"/><path d="M15 13.14A3 3 0 0 1 15 12"/><path d="M15 20.14A3 3 0 0 1 15 19"/></svg>
                     Math Mania
                 </CardTitle>
                 <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={handleCopyCode} title="Copy Room Code">
                       <ClipboardCopy className="h-4 w-4 mr-1"/> {roomCode}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleCopyLink} title="Copy Invite Link">
                       <Share2 className="h-4 w-4" />
                    </Button>
                 </div>
             </div>
             <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Round: {gameState.currentRound > 0 ? gameState.currentRound : '-'}</span>
                <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{gameState.isGameActive ? `${gameState.timeLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1">
                   <Users className="h-4 w-4" />
                   <span>{gameState.players.length}</span>
                </div>
             </div>
             {gameState.isGameActive && (
                <Progress value={(gameState.timeLeft / 30) * 100} className="w-full h-2 mt-2" />
             )}
         </CardHeader>
        </Card>

        {/* Scoreboard / Player List */}
       <div className="flex-shrink-0 m-2 mt-0">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="outline" size="sm" className="w-full mb-1">
               {showScoreboard ? 'Hide Scores' : 'Show Scores'} ({sortedPlayers.length} Players)
           </Button>
           {showScoreboard && (
              <Card className="shadow rounded-lg">
                 <CardContent className="p-0">
                    <ScrollArea className="h-[150px] p-2"> {/* Adjust height as needed */}
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1.5 rounded ${player.name === playerName ? 'bg-blue-100 dark:bg-blue-900' : ''} text-sm mb-1`}>
                          <div className="flex items-center gap-2">
                              <span className="font-semibold w-5 text-right">{index + 1}.</span>
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={`https://avatar.vercel.sh/${player.name}.png`} alt={player.name} />
                                <AvatarFallback>{player.name.substring(0, 1).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              <span className="truncate max-w-[100px]">{player.name} {player.isHost ? '(Host)' : ''}</span>
                          </div>
                          <div className="flex items-center gap-2">
                                {player.hasAnswered && player.isCorrect !== undefined && (
                                    player.isCorrect
                                    ? <CheckCircle className="h-4 w-4 text-accent" />
                                    : <XCircle className="h-4 w-4 text-destructive" />
                                )}
                                {player.hasAnswered && player.isCorrect === undefined && gameState.isGameActive && ( // Answered but waiting for round end
                                     <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />
                                )}
                                <span className="font-mono font-semibold w-10 text-right">{player.score}</span>
                          </div>
                       </div>
                    ))}
                    </ScrollArea>
                 </CardContent>
              </Card>
           )}
        </div>

        {/* Game Area */}
        <div className="flex-grow flex flex-col justify-center items-center p-4 space-y-4 m-2 mt-0">
            {gameState.isGameActive ? (
                <>
                    <Card className="w-full bg-card shadow-lg text-center p-6">
                        <CardDescription className="mb-2">Question {gameState.currentRound}</CardDescription>
                        <CardTitle className="text-4xl font-mono tracking-wider">
                            {gameState.question} = ?
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-2">
                        <Input
                            type="number" // Use number type for better mobile input
                            inputMode="numeric" // Explicitly suggest numeric keyboard
                            pattern="[0-9]*" // Pattern for numeric input
                            placeholder="Your Answer"
                            value={currentAnswer}
                            onChange={(e) => setCurrentAnswer(e.target.value.replace(/[^0-9-]/g, ''))} // Allow digits and minus sign
                            className="text-center text-2xl h-14"
                            disabled={hasPlayerAnswered || gameState.timeLeft <= 0}
                            aria-label="Enter your answer"
                        />
                        <Button
                            type="submit"
                            className="w-full text-lg py-3"
                            disabled={hasPlayerAnswered || currentAnswer === '' || gameState.timeLeft <= 0}
                         >
                            {hasPlayerAnswered ? (gameState.timeLeft > 0 ? 'Waiting...' : 'Answered') : 'Submit'}
                        </Button>
                    </form>
                </>
            ) : (
                 <Card className="w-full bg-card shadow-lg text-center p-6 flex flex-col items-center justify-center min-h-[200px]">
                     {gameState.players.length > 1 ? (
                         isHost ? (
                             <>
                                 <CardTitle className="mb-4">Ready to Start?</CardTitle>
                                 <Button onClick={startGame} className="text-lg py-3 px-6">
                                     Start Game ({gameState.players.length} players)
                                 </Button>
                             </>
                         ) : (
                             <CardTitle className="text-xl">Waiting for the host to start the game...</CardTitle>
                         )
                     ) : (
                          <CardTitle className="text-xl">Waiting for more players...</CardTitle>
                     )}
                      <CardDescription className="mt-4 text-xs">Share the room code or link!</CardDescription>
                 </Card>
            )}
        </div>

    </div>
  );
};

export default GameRoomPage;

