// src/app/room/[roomCode]/page.tsx
'use client';

import type { NextPage } from 'next';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, ClipboardCopy, Users, Share2, Clock, LogOut, Loader2 } from 'lucide-react';
import { getGameState, saveGameState, getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId, deleteGameState } from '@/lib/game-storage';
import type { Player, GameState } from '@/types/game';

const ROUND_DURATION = 30; // seconds
const RESULTS_DISPLAY_DURATION = 3000; // milliseconds
const SYNC_INTERVAL = 1000; // milliseconds to poll for updates

const GameRoomPage: NextPage = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const roomCode = params.roomCode as string;
  const isInitiallyHost = searchParams.get('host') === 'true';

  const [localPlayerInfo, setLocalPlayerInfo] = useState<{ playerId: string; playerName: string } | null>(null);
  const [inputPlayerName, setInputPlayerName] = useState<string>('');
  const [currentAnswer, setCurrentAnswer] = useState<string>('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(true);
  const [showScoreboard, setShowScoreboard] = useState(true);
  const [isRoundEnding, setIsRoundEnding] = useState(false); // Flag to manage result display timer

  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const roundEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Core Game Logic & State Sync ---

  const fetchAndUpdateState = useCallback(() => {
    if (!roomCode) return;
    const fetchedState = getGameState(roomCode);
    if (fetchedState) {
      setGameState(fetchedState);
    } else {
      // Room might have been deleted or doesn't exist
      console.warn(`Game state for room ${roomCode} not found.`);
      toast({ title: 'Room Not Found', description: 'This game room no longer exists.', variant: 'destructive' });
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      clearPlayerInfo(); // Clean up local session
      router.push('/'); // Redirect home
    }
  }, [roomCode, router, toast]);

  // Load initial state and player info
  useEffect(() => {
    const playerInfo = getPlayerInfo();
    const initialGameState = getGameState(roomCode);

    if (!initialGameState) {
        toast({ title: 'Error', description: 'Game room not found.', variant: 'destructive'});
        router.push('/');
        return;
    }

    if (playerInfo && initialGameState.players.some(p => p.id === playerInfo.playerId)) {
        // Player is rejoining or refreshed the page
        setLocalPlayerInfo(playerInfo);
        setGameState(initialGameState);
        setIsJoining(false);
        setIsLoading(false);
    } else {
        // New player joining or host initial setup
        clearPlayerInfo(); // Clear any old info
        setGameState(initialGameState); // Load state but wait for name input
        setIsJoining(true);
        setIsLoading(false);
    }
  }, [roomCode, router, toast]);

  // Start polling for updates when the player has joined
   useEffect(() => {
     if (!isJoining && !isLoading && roomCode) {
       fetchAndUpdateState(); // Initial fetch after joining

       if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); // Clear any existing interval

       syncIntervalRef.current = setInterval(fetchAndUpdateState, SYNC_INTERVAL);
       console.log("Polling started");

       return () => {
         if (syncIntervalRef.current) {
           clearInterval(syncIntervalRef.current);
           console.log("Polling stopped");
           syncIntervalRef.current = null;
         }
       };
     }
   }, [isJoining, isLoading, roomCode, fetchAndUpdateState]);


  // --- Helper Functions ---

  const generateEquation = (): { question: string; answer: number } => {
      const operations = ['+', '-', '*', '/'];
      let question = '';
      let answer = NaN;
      let attempts = 0;

      while (isNaN(answer) || !Number.isInteger(answer) || attempts > 100) {
        attempts++;
        const op = operations[Math.floor(Math.random() * operations.length)];
        const num1 = Math.floor(Math.random() * (op === '*' || op === '/' ? 15 : 50)) + 1;
        const num2 = Math.floor(Math.random() * (op === '*' || op === '/' ? 15 : 50)) + (op === '/' ? 1 : 0);

        switch (op) {
            case '+':
                question = `${num1} + ${num2}`;
                answer = num1 + num2;
                break;
            case '-':
                const max = Math.max(num1, num2);
                const min = Math.min(num1, num2);
                question = `${max} - ${min}`;
                answer = max - min;
                break;
            case '*':
                question = `${num1} × ${num2}`;
                answer = num1 * num2;
                break;
            case '/':
                const product = num1 * num2;
                question = `${product} ÷ ${num2}`;
                answer = num1;
                break;
        }
      }
       if (attempts > 100) {
           question = '1 + 1';
           answer = 2;
       }
      return { question, answer };
  };

  const updateAndSaveGameState = (updater: (prevState: GameState) => GameState) => {
    setGameState(prevState => {
      if (!prevState) return null;
      const newState = updater(prevState);
      saveGameState(roomCode, newState); // Save updated state to localStorage
      return newState;
    });
  };

  // --- Game Actions (triggered by host or timer) ---

  const startGame = () => {
      if (!gameState || gameState.isGameActive || !isHost) return;
      console.log("Host starting game...");
      const { question, answer } = generateEquation();
      updateAndSaveGameState(prev => ({
          ...prev,
          question,
          answer,
          timeLeft: ROUND_DURATION,
          isGameActive: true,
          currentRound: 1,
          players: prev.players.map(p => ({...p, hasAnswered: false, isCorrect: undefined })), // Reset answer status
          roundStartTime: Date.now(),
      }));
  };

 const nextQuestion = useCallback(() => {
    if (!gameState || !gameState.isGameActive || !isHost) return; // Only host advances
    console.log("Host advancing to next question...");

    // Clear previous round end timeout if exists
    if (roundEndTimeoutRef.current) {
        clearTimeout(roundEndTimeoutRef.current);
        roundEndTimeoutRef.current = null;
    }
    setIsRoundEnding(false); // Reset round ending flag

    const { question, answer } = generateEquation();
    updateAndSaveGameState(prev => ({
        ...prev,
        question,
        answer,
        timeLeft: ROUND_DURATION,
        currentRound: prev.currentRound + 1,
        players: prev.players.map(p => ({ ...p, hasAnswered: false, isCorrect: undefined })), // Reset answer status for new round
        roundStartTime: Date.now(),
    }));
    setCurrentAnswer(''); // Clear input field for the new question (locally)
}, [gameState, isHost, updateAndSaveGameState]);


  // Timer Logic - Managed by Host, Synced to Others
  useEffect(() => {
    if (!gameState || !gameState.isGameActive || !gameState.roundStartTime || isRoundEnding) {
      return; // Only run if game is active, has a start time, and not currently in results display
    }

    const calculateTimeLeft = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - gameState.roundStartTime!) / 1000);
      const remaining = ROUND_DURATION - elapsed;
      return Math.max(0, remaining);
    };

    // Immediate update for responsiveness
    const initialTimeLeft = calculateTimeLeft();
    if (gameState.timeLeft !== initialTimeLeft) {
      // Use a local update first for smoothness, localStorage sync will catch up
       setGameState(prev => prev ? { ...prev, timeLeft: initialTimeLeft } : null);
    }

    if (initialTimeLeft <= 0 && isHost) {
        // Time's up - Host triggers round end sequence
        console.log("Host detected time up, ending round...");
        endRound();
    } else {
      // Regular timer interval (less frequent as sync handles exact state)
      const timerId = setInterval(() => {
        const timeLeft = calculateTimeLeft();
         if (timeLeft <= 0 && isHost) {
           console.log("Host interval detected time up, ending round...");
           clearInterval(timerId); // Stop this timer
           endRound();
         }
      }, 1000); // Check every second

      return () => clearInterval(timerId);
    }
}, [gameState, isHost, nextQuestion, isRoundEnding]); // Rerun when gameState (esp. roundStartTime) or host status changes

  const endRound = () => {
      if (!gameState || !isHost || isRoundEnding) return; // Only host ends, prevent multiple triggers
      console.log("Host ending round - revealing results...");
      setIsRoundEnding(true); // Set flag to prevent timer issues during results

      // Mark unanswered as incorrect and finalize scores for the round
      updateAndSaveGameState(prev => ({
          ...prev,
          players: prev.players.map(p => ({...p, isCorrect: p.hasAnswered ? p.isCorrect : false }))
      }));

      // Schedule the next question after the results display duration
      if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current); // Clear existing timeout if any
      roundEndTimeoutRef.current = setTimeout(() => {
          console.log("Results display time finished, triggering next question.");
          nextQuestion(); // Host triggers the next question
      }, RESULTS_DISPLAY_DURATION);
  };


  // --- Player Actions ---

  const handleJoinGame = () => {
      const name = inputPlayerName.trim();
      if (!name) {
          toast({ title: "Please enter your name", variant: "destructive" });
          return;
      }
      if (!gameState) {
          toast({ title: "Error", description: "Game state not loaded.", variant: "destructive" });
          return;
      }
      if (gameState.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
          toast({ title: "Name Taken", description: "Please choose a different name.", variant: "destructive" });
          return;
      }


      const playerId = generateId();
      const newPlayer: Player = {
          id: playerId,
          name: name,
          score: 0,
          isHost: isInitiallyHost && gameState.players.length === 0, // First player can be host if joining via create link
      };

      // Update local state immediately for UI responsiveness
      setLocalPlayerInfo({ playerId, playerName: name });
      setIsJoining(false);

      // Update shared game state
      updateAndSaveGameState(prev => ({
          ...prev,
          players: [...prev.players, newPlayer],
      }));

      // Save player info to sessionStorage
      savePlayerInfo(playerId, name);

      toast({ title: `Welcome, ${name}!` });
  };


  const handleAnswerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPlayerInfo || !gameState || !gameState.isGameActive || currentAnswer === '' || isRoundEnding) return;

    const currentPlayer = gameState.players.find(p => p.id === localPlayerInfo.playerId);
    if (!currentPlayer || currentPlayer.hasAnswered) return; // Already answered

    const submittedAnswer = parseInt(currentAnswer, 10);
    const isCorrect = submittedAnswer === gameState.answer;

    // Calculate score based on remaining time
    const now = Date.now();
    const elapsed = Math.floor((now - gameState.roundStartTime!) / 1000);
    const timeTaken = ROUND_DURATION - Math.max(0, gameState.timeLeft - elapsed); // More accurate time taken
    const scoreToAdd = isCorrect ? Math.max(5, ROUND_DURATION - timeTaken + 5) : 0; // Faster answers get more points

    toast({
      title: isCorrect ? 'Correct!' : 'Incorrect!',
      description: isCorrect ? `+${scoreToAdd} points!` : `Answer Submitted.`,
      variant: isCorrect ? 'default' : 'destructive',
      className: isCorrect ? 'bg-accent text-accent-foreground border-accent' : '',
      duration: 2000, // Shorter duration for answer feedback
    });

    // Update the player's status in the shared game state
    updateAndSaveGameState(prev => ({
      ...prev,
      players: prev.players.map(p =>
        p.id === localPlayerInfo.playerId
          ? { ...p, score: p.score + scoreToAdd, hasAnswered: true, isCorrect } // Store correctness immediately for feedback
          : p
      ),
    }));
  };

  const handleLeaveGame = () => {
    if (!localPlayerInfo || !gameState) return;

    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);

    updateAndSaveGameState(prev => {
        const remainingPlayers = prev.players.filter(p => p.id !== localPlayerInfo.playerId);
        // If the host leaves, try to assign a new host or end the game
        if (isHost && remainingPlayers.length > 0) {
            remainingPlayers[0].isHost = true; // Assign host to the next player
            return { ...prev, players: remainingPlayers };
        } else if (remainingPlayers.length === 0) {
            // Last player leaving, delete the game state
             deleteGameState(roomCode);
             return { ...prev, players: [] }; // Return state with empty players to trigger redirect
        } else {
             return { ...prev, players: remainingPlayers };
        }
    });

    clearPlayerInfo();
    toast({ title: 'You left the room.' });
    router.push('/');
  };


   const handleCopyLink = () => {
    const link = window.location.href.split('?')[0]; // Remove query params for sharing
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


  // --- Derived State ---
  const isHost = gameState?.players.find(p => p.id === localPlayerInfo?.playerId)?.isHost ?? false;
  const currentPlayer = gameState?.players.find(p => p.id === localPlayerInfo?.playerId);
  const hasPlayerAnswered = currentPlayer?.hasAnswered ?? false;
  const sortedPlayers = gameState ? [...gameState.players].sort((a, b) => b.score - a.score) : [];
  const roundTimeLeft = gameState?.isGameActive && gameState.roundStartTime && !isRoundEnding
    ? Math.max(0, ROUND_DURATION - Math.floor((Date.now() - gameState.roundStartTime) / 1000))
    : gameState?.timeLeft ?? 0;


  // --- Render Logic ---

  if (isLoading) {
      return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (isJoining) {
    return (
      <Card className="w-full max-w-md shadow-lg m-auto">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Join Room: {roomCode}</CardTitle>
          <CardDescription className="text-center">Enter your name to join the game</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Input
             type="text"
             placeholder="Your Name"
             value={inputPlayerName}
             onChange={(e) => setInputPlayerName(e.target.value)}
             maxLength={15}
             aria-label="Enter your name"
             autoFocus
             onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()}
           />
           <Button onClick={handleJoinGame} className="w-full" disabled={!inputPlayerName.trim()}>
             Join Game
           </Button>
        </CardContent>
      </Card>
    );
  }


  if (!gameState || !localPlayerInfo) {
    // Should not happen if loading/joining logic is correct, but acts as a fallback
     console.error("Render error: Game state or player info missing after joining.");
    return <div className="text-center p-4 text-destructive">Error loading game room. Please try returning home.</div>;
  }

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
                 <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={handleCopyCode} title="Copy Room Code">
                       <ClipboardCopy className="h-4 w-4 mr-1"/> {roomCode}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleCopyLink} title="Copy Invite Link">
                       <Share2 className="h-4 w-4" />
                    </Button>
                     <Button variant="ghost" size="sm" onClick={handleLeaveGame} title="Leave Room" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                       <LogOut className="h-4 w-4" />
                    </Button>
                 </div>
             </div>
             <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Round: {gameState.currentRound > 0 ? gameState.currentRound : '-'}</span>
                <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                     {/* Use the calculated roundTimeLeft for display */}
                    <span>{gameState.isGameActive && !isRoundEnding ? `${roundTimeLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1">
                   <Users className="h-4 w-4" />
                   <span>{gameState.players.length}</span>
                </div>
             </div>
             {gameState.isGameActive && !isRoundEnding && (
                 // Use calculated roundTimeLeft for progress bar
                <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-2 mt-2" />
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
                     {/* Adjust height based on whether the game area is active */}
                    <ScrollArea className={`p-2 ${gameState.isGameActive ? 'h-[120px]' : 'h-[200px]'}`}>
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1.5 rounded ${player.id === localPlayerInfo.playerId ? 'bg-primary/10' : ''} text-sm mb-1`}>
                          <div className="flex items-center gap-2">
                              <span className="font-semibold w-5 text-right">{index + 1}.</span>
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={`https://avatar.vercel.sh/${player.name}.png?size=24`} alt={player.name} />
                                <AvatarFallback>{player.name.substring(0, 1).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              <span className="truncate max-w-[100px]">{player.name} {player.isHost ? '(Host)' : ''}</span>
                              {player.id === localPlayerInfo.playerId && <span className="text-xs text-muted-foreground">(You)</span>}
                          </div>
                          <div className="flex items-center gap-2">
                                {/* Show status during active round or if round just ended */}
                                {(gameState.isGameActive || isRoundEnding) && player.hasAnswered !== undefined && (
                                     player.hasAnswered ? (
                                         // If round ended, show correct/incorrect, else show clock
                                         isRoundEnding || roundTimeLeft === 0 ? (
                                             player.isCorrect ? <CheckCircle className="h-4 w-4 text-accent" /> : <XCircle className="h-4 w-4 text-destructive" />
                                         ) : (
                                             <Clock className="h-4 w-4 text-muted-foreground animate-pulse" title="Answered" />
                                         )
                                     ) : (
                                          // Player hasn't answered yet
                                         isRoundEnding || roundTimeLeft === 0 ? <XCircle className="h-4 w-4 text-muted-foreground opacity-50" title="Did not answer"/> : null // Show nothing if round active and not answered
                                     )
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
                            {/* Show answer if round ended */}
                           {isRoundEnding || roundTimeLeft === 0 ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-2">
                        <Input
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9-]*" // Allow digits and minus
                            placeholder="Your Answer"
                            value={currentAnswer}
                            onChange={(e) => setCurrentAnswer(e.target.value.replace(/[^0-9-]/g, ''))}
                            className="text-center text-2xl h-14"
                            // Disable if answered, time is up, or in results display phase
                            disabled={hasPlayerAnswered || roundTimeLeft <= 0 || isRoundEnding}
                            aria-label="Enter your answer"
                            autoFocus
                        />
                        <Button
                            type="submit"
                            className="w-full text-lg py-3"
                            // Disable if answered, no input, time is up, or in results display phase
                            disabled={hasPlayerAnswered || currentAnswer === '' || roundTimeLeft <= 0 || isRoundEnding}
                         >
                            {hasPlayerAnswered ? (isRoundEnding || roundTimeLeft <=0 ? 'Answered' : 'Waiting...' ) : 'Submit'}
                        </Button>
                    </form>
                     {/* Display message during results phase */}
                     {isRoundEnding && (
                        <p className="text-center text-muted-foreground animate-pulse">Next round starting soon...</p>
                     )}
                </>
            ) : (
                 <Card className="w-full bg-card shadow-lg text-center p-6 flex flex-col items-center justify-center min-h-[200px]">
                     {gameState.players.length > 0 ? ( // Show start button if players exist
                         isHost ? (
                             <>
                                 <CardTitle className="mb-4">Ready to Start?</CardTitle>
                                 <Button onClick={startGame} className="text-lg py-3 px-6" disabled={gameState.players.length < 1}>
                                     Start Game ({gameState.players.length} player{gameState.players.length === 1 ? '' : 's'})
                                 </Button>
                             </>
                         ) : (
                             <CardTitle className="text-xl">Waiting for the host<span className="animate-pulse">...</span></CardTitle>
                         )
                     ) : (
                          <CardTitle className="text-xl">Waiting for players<span className="animate-pulse">...</span></CardTitle> // Should ideally not happen if host joins first
                     )}
                      <CardDescription className="mt-4 text-xs">Share the room code or link!</CardDescription>
                 </Card>
            )}
        </div>

    </div>
  );
};

export default GameRoomPage;
