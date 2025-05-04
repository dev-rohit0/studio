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
                // Ensure non-negative result for subtraction
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
                 // Ensure integer division result
                 // Make sure num2 is not zero to avoid division by zero, although the generation logic already prevents it
                 if (num2 === 0) {
                    answer = NaN; // Force regeneration if num2 is somehow 0
                    continue;
                 }
                const product = num1 * num2;
                question = `${product} ÷ ${num2}`;
                answer = num1;
                break;
        }
      }
       if (attempts > 100) { // Fallback in case of too many attempts
           console.warn("Could not generate valid equation after 100 attempts, using fallback.");
           question = '1 + 1';
           answer = 2;
       }
      return { question, answer };
  };

  // Memoized state update function
  const updateAndSaveGameState = useCallback((updater: (prevState: GameState | null) => GameState | null) => {
      setGameState(prevState => {
        // Pass the previous state to the updater function
        const newState = updater(prevState);
        // Only save if the new state is not null
        if (newState) {
            saveGameState(roomCode, newState);
        } else {
            // If updater returns null, it might mean the state should be cleared or deleted
            // Handle this case as needed, maybe delete the game state?
             console.warn("Updater function returned null. Game state not saved.");
             // deleteGameState(roomCode); // Example: uncomment to delete state if updater returns null
        }
        return newState; // Return the new state (or null) to update React's state
      });
    }, [roomCode]); // roomCode should not change, but good practice

  // --- Derived State ---
  // Calculate derived state AFTER gameState and localPlayerInfo are potentially updated
  const isHost = gameState?.players.find(p => p.id === localPlayerInfo?.playerId)?.isHost ?? false;
  const currentPlayer = gameState?.players.find(p => p.id === localPlayerInfo?.playerId);
  const hasPlayerAnswered = currentPlayer?.hasAnswered ?? false;
  const sortedPlayers = gameState ? [...gameState.players].sort((a, b) => b.score - a.score) : [];
  const roundTimeLeft = gameState?.isGameActive && gameState.roundStartTime && !isRoundEnding
    ? Math.max(0, ROUND_DURATION - Math.floor((Date.now() - gameState.roundStartTime) / 1000))
    : gameState?.timeLeft ?? 0;


  // --- Core Game Logic & State Sync ---

  const fetchAndUpdateState = useCallback(() => {
    if (!roomCode) return;
    const fetchedState = getGameState(roomCode);
    if (fetchedState) {
      // Update local state only if fetched state is different
      // This prevents unnecessary re-renders if nothing changed
      setGameState(currentState => {
          // Deep comparison might be needed for complex objects if performance is an issue
          if (JSON.stringify(currentState) !== JSON.stringify(fetchedState)) {
            return fetchedState;
          }
          return currentState;
      });
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

    setGameState(initialGameState); // Set initial state first

    // Check if the player is already in the game state (e.g., page refresh)
    const playerExistsInGame = playerInfo && initialGameState.players.some(p => p.id === playerInfo.playerId);

    if (playerExistsInGame) {
        setLocalPlayerInfo(playerInfo);
        setIsJoining(false); // Already joined
    } else {
        // New player joining or host initial setup
        clearPlayerInfo(); // Clear any potentially stale info
        setIsJoining(true); // Needs to join
    }
    setIsLoading(false); // Loading finished

  }, [roomCode, router, toast]); // Only run on initial load


  // Start polling for updates when the player has joined and is not loading
   useEffect(() => {
     if (!isJoining && !isLoading && roomCode && localPlayerInfo) { // Ensure player info is set
       fetchAndUpdateState(); // Initial fetch right after joining/loading

       if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); // Clear potential duplicate interval

       console.log(`Polling started for room ${roomCode}`);
       syncIntervalRef.current = setInterval(fetchAndUpdateState, SYNC_INTERVAL);

       // Cleanup function
       return () => {
         if (syncIntervalRef.current) {
           clearInterval(syncIntervalRef.current);
           console.log(`Polling stopped for room ${roomCode}`);
           syncIntervalRef.current = null;
         }
       };
     }
   }, [isJoining, isLoading, roomCode, fetchAndUpdateState, localPlayerInfo]); // Added localPlayerInfo


  // --- Game Actions (triggered by host or timer) ---

  const startGame = useCallback(() => {
      // Guard clauses
      if (!gameState || gameState.isGameActive || !isHost || gameState.players.length === 0) return;

      console.log("Host starting game...");
      const { question, answer } = generateEquation();
      updateAndSaveGameState(prev => {
          if (!prev) return null; // Should not happen, but type safety
          return {
            ...prev,
            question,
            answer,
            timeLeft: ROUND_DURATION,
            isGameActive: true,
            currentRound: 1,
            players: prev.players.map(p => ({...p, hasAnswered: false, isCorrect: undefined })), // Reset answer status
            roundStartTime: Date.now(),
          };
      });
  }, [gameState, isHost, updateAndSaveGameState]); // Add gameState and isHost dependencies

 const nextQuestion = useCallback(() => {
    // Guard clauses: Only host advances, only if game is active
    if (!gameState || !gameState.isGameActive || !isHost) return;
    console.log("Host advancing to next question...");

    // Clear previous round end timeout if exists
    if (roundEndTimeoutRef.current) {
        clearTimeout(roundEndTimeoutRef.current);
        roundEndTimeoutRef.current = null;
    }
    setIsRoundEnding(false); // Reset round ending flag

    const { question, answer } = generateEquation();
    updateAndSaveGameState(prev => {
        if (!prev) return null; // Should not happen, but type safety
        return {
            ...prev,
            question,
            answer,
            timeLeft: ROUND_DURATION,
            currentRound: prev.currentRound + 1,
            players: prev.players.map(p => ({ ...p, hasAnswered: false, isCorrect: undefined })), // Reset answer status for new round
            roundStartTime: Date.now(),
        };
    });
    setCurrentAnswer(''); // Clear input field for the new question (locally for current player)
  }, [gameState, isHost, updateAndSaveGameState]); // Use derived isHost


  const endRound = useCallback(() => {
      // Guard clauses: Only host ends, prevent multiple triggers, only if game active
      if (!gameState || !isHost || isRoundEnding || !gameState.isGameActive) return;
      console.log("Host ending round - revealing results...");
      setIsRoundEnding(true); // Set flag to prevent timer issues during results

      // Mark unanswered as incorrect and finalize scores for the round
      updateAndSaveGameState(prev => {
        if (!prev || !prev.isGameActive) return prev; // Ensure game is active during update
        return {
            ...prev,
            // Only update players if the game is still considered active during this update
            players: prev.players.map(p => ({...p, isCorrect: p.hasAnswered ? p.isCorrect : false })),
            // isGameActive: false, // Maybe set game inactive briefly during results? Depends on flow.
            timeLeft: 0, // Explicitly set time to 0
        };
      });

      // Schedule the next question after the results display duration
      if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current); // Clear existing timeout if any
      roundEndTimeoutRef.current = setTimeout(() => {
          console.log("Results display time finished, triggering next question.");
          // Ensure nextQuestion uses the latest state if it changed during the timeout
          nextQuestion(); // Host triggers the next question
      }, RESULTS_DISPLAY_DURATION);
  }, [gameState, isHost, isRoundEnding, updateAndSaveGameState, nextQuestion]); // Added dependencies


  // Timer Logic - Managed by Host, Synced to Others via localStorage polling
  useEffect(() => {
    // Conditions to run the timer logic (only for the host)
    if (!gameState || !gameState.isGameActive || !gameState.roundStartTime || isRoundEnding || !isHost) {
      return;
    }

    const calculateTimeLeft = () => {
      const now = Date.now();
      // Ensure roundStartTime is not null before calculation
      const elapsed = Math.floor((now - (gameState.roundStartTime ?? now)) / 1000);
      const remaining = ROUND_DURATION - elapsed;
      return Math.max(0, remaining);
    };

    // Check time immediately
    const timeLeft = calculateTimeLeft();

    // Host updates the official timeLeft in storage if it has changed
    if (gameState.timeLeft !== timeLeft) {
        updateAndSaveGameState(prev => {
            if (!prev || !prev.isGameActive || prev.timeLeft === timeLeft) return prev; // Avoid update if no change or inactive
            return { ...prev, timeLeft: timeLeft };
        });
    }

    // If time is up, the host ends the round
    if (timeLeft <= 0) {
        console.log("Host detected time up, ending round...");
        endRound(); // Call the memoized endRound function
        return; // Stop the interval setup for this cycle
    }

    // Set up an interval to check time periodically
    // This acts as a fallback and ensures the timer progresses even if polling is delayed
    const timerId = setInterval(() => {
      // Fetch the latest state inside the interval to get the most recent roundStartTime
       const currentState = getGameState(roomCode);
       if (!currentState || !currentState.isGameActive || !currentState.roundStartTime || isRoundEnding || !isHost) {
           clearInterval(timerId);
           return;
       }

      const currentLeft = Math.max(0, ROUND_DURATION - Math.floor((Date.now() - currentState.roundStartTime) / 1000));

       if (currentLeft <= 0) {
           console.log("Host interval detected time up, ending round...");
           clearInterval(timerId); // Stop this timer
           endRound(); // Call the memoized endRound function
       } else if (currentState.timeLeft !== currentLeft) {
           // Update state if interval detects change faster than polling
           updateAndSaveGameState(prev => {
               if (!prev || !prev.isGameActive || prev.timeLeft === currentLeft) return prev;
               return { ...prev, timeLeft: currentLeft };
           });
       }
    }, 500); // Check more frequently

    return () => clearInterval(timerId); // Cleanup interval on effect re-run or unmount

}, [gameState, isHost, isRoundEnding, endRound, updateAndSaveGameState, roomCode]); // Rerun when relevant state changes


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
      // Prevent joining with an existing name (case-insensitive check)
      if (gameState.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
          toast({ title: "Name Taken", description: "That name is already in use. Please choose another.", variant: "destructive" });
          return;
      }


      const playerId = generateId();
       // Determine if this player should be the host.
      // Only the first player joining (if they used the 'create' link) becomes host.
      // If the room already has players, this new player cannot become host via the ?host=true link.
      const shouldBeHost = isInitiallyHost && gameState.players.length === 0;

      const newPlayer: Player = {
          id: playerId,
          name: name,
          score: 0,
          isHost: shouldBeHost, // Set host status based on calculation
      };

      // Save player info to sessionStorage FIRST, so it's available if update fails
      savePlayerInfo(playerId, name);
      // Update local state immediately for UI responsiveness before saving
      setLocalPlayerInfo({ playerId, playerName: name });
      setIsJoining(false); // Transition out of joining state

      // Update shared game state via localStorage
      updateAndSaveGameState(prev => {
          if (!prev) return null; // Should have state by now
          // Ensure no duplicate player ID (highly unlikely but safe)
          if (prev.players.some(p => p.id === playerId)) return prev;

          // If this player is the host, ensure no other host exists
           let playersList = [...prev.players];
           if (shouldBeHost) {
               playersList = playersList.map(p => ({ ...p, isHost: false }));
           }

          return {
                ...prev,
                players: [...playersList, newPlayer],
          };
      });

      toast({ title: `Welcome, ${name}!` });
  };


  const handleAnswerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Guard clauses: Ensure player, game state, game active, answer exists, and round not ending
    if (!localPlayerInfo || !gameState || !gameState.isGameActive || currentAnswer === '' || isRoundEnding) return;

    const currentPlayerState = gameState.players.find(p => p.id === localPlayerInfo.playerId);
    // Ensure player exists in state and hasn't answered yet
    if (!currentPlayerState || currentPlayerState.hasAnswered) return;

    const submittedAnswer = parseInt(currentAnswer, 10);
    const isAnswerCorrect = submittedAnswer === gameState.answer;

    // Calculate score based on remaining time (more accurately using server's roundStartTime)
    const now = Date.now();
    const timeElapsed = gameState.roundStartTime ? Math.floor((now - gameState.roundStartTime) / 1000) : ROUND_DURATION;
    const timeTaken = Math.min(ROUND_DURATION, Math.max(0, timeElapsed)); // Clamp time taken between 0 and round duration
    const scoreToAdd = isAnswerCorrect ? Math.max(5, (ROUND_DURATION - timeTaken) * 2 + 10) : 0; // Example scoring: More points for speed

    toast({
      title: isAnswerCorrect ? 'Correct!' : 'Incorrect',
      description: isAnswerCorrect ? `+${scoreToAdd} points!` : `Answer: ${gameState.answer}`,
      variant: isAnswerCorrect ? 'default' : 'destructive',
      className: isAnswerCorrect ? 'bg-accent text-accent-foreground border-accent' : '',
      duration: 2000, // Shorter duration for answer feedback
    });

    // Update the player's status in the shared game state
    updateAndSaveGameState(prev => {
        if (!prev || !prev.isGameActive) return prev; // Ensure game active during update
        return {
            ...prev,
            players: prev.players.map(p =>
                p.id === localPlayerInfo.playerId
                // Store correctness immediately for feedback and mark as answered
                ? { ...p, score: p.score + scoreToAdd, hasAnswered: true, isCorrect: isAnswerCorrect }
                : p
            ),
        };
    });

    // Clear the input field locally AFTER submitting
    setCurrentAnswer('');

  };

  const handleLeaveGame = () => {
    if (!localPlayerInfo || !gameState) return;

    // Clear intervals and timeouts immediately
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
    syncIntervalRef.current = null;
    roundEndTimeoutRef.current = null;

    const leavingPlayerId = localPlayerInfo.playerId;
    const wasHost = isHost; // Capture host status before modifying state

    let shouldDeleteGame = false;
    let newHostId: string | null = null;

    // Get the current state directly for modification, as setGameState is async
    let currentGameState = getGameState(roomCode);

    if (!currentGameState) {
        console.error("Could not get current game state for leaving player.");
        clearPlayerInfo();
        router.push('/');
        return;
    }

    const remainingPlayers = currentGameState.players.filter(p => p.id !== leavingPlayerId);

    if (remainingPlayers.length === 0) {
        // Last player leaving
        shouldDeleteGame = true;
        currentGameState = { ...currentGameState, players: [] }; // Update state to be saved/deleted
    } else if (wasHost) {
        // Host leaving, assign new host (e.g., the player who joined earliest among remaining)
        // Simple approach: assign to the first player in the remaining list
        newHostId = remainingPlayers[0].id;
        remainingPlayers[0].isHost = true;
        currentGameState = { ...currentGameState, players: remainingPlayers }; // Update state
    } else {
        // Non-host leaving
        currentGameState = { ...currentGameState, players: remainingPlayers }; // Update state
    }

    // Save the updated state or delete the game
    if (shouldDeleteGame) {
        deleteGameState(roomCode);
        console.log(`Game room ${roomCode} deleted as last player left.`);
    } else {
        saveGameState(roomCode, currentGameState); // Save the state with the player removed/new host assigned
        if (newHostId) {
            console.log(`Host left, new host assigned: ${newHostId}`);
            // Optionally toast the new host assignment (might require player name lookup from the updated state)
            const newHost = remainingPlayers.find(p => p.id === newHostId);
            if (newHost) {
                toast({ title: "Host Changed", description: `${newHost.name} is the new host.`});
            }
        }
    }

    clearPlayerInfo(); // Clear local session storage
    toast({ title: 'You left the room.' });
    router.push('/'); // Redirect to home page
  };


   const handleCopyLink = () => {
    const link = window.location.href.split('?')[0]; // Remove query params like ?host=true
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


  // --- Render Logic ---

  if (isLoading) {
      return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Loading Room...</span></div>;
  }

  // Join Screen
  if (isJoining) {
    return (
      <Card className="w-full max-w-md shadow-lg m-auto">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Join Room: {roomCode}</CardTitle>
          <CardDescription className="text-center">Enter your name to join the game</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Input
             id="playerNameInput" // Add id for label association
             type="text"
             placeholder="Your Name"
             value={inputPlayerName}
             onChange={(e) => setInputPlayerName(e.target.value)}
             maxLength={15}
             aria-label="Enter your name" // Keep aria-label for screen readers
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


  // Error state if game state is missing after loading/joining
  if (!gameState || !localPlayerInfo) {
     console.error("Render error: Game state or player info missing after loading/joining.");
     // Attempt to redirect home after showing an error
     // Use useEffect to avoid calling router during render
     useEffect(() => {
        const timer = setTimeout(() => {
           router.push('/');
        }, 3000);
        return () => clearTimeout(timer); // Cleanup timeout
     }, [router]);

     return (
         <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
            <XCircle className="h-12 w-12 text-destructive mb-4" />
            <h1 className="text-2xl font-semibold text-destructive mb-2">Error Loading Game</h1>
            <p className="text-muted-foreground">Could not load the game room data. You will be redirected home shortly.</p>
            <Button onClick={() => router.push('/')} variant="outline" className="mt-4">Go Home Now</Button>
         </div>
     );
  }

  // Main Game Screen
  return (
    <div className="flex flex-col h-screen max-h-screen w-full max-w-md bg-secondary">

        {/* Header Area */}
        <Card className="m-2 shadow rounded-lg flex-shrink-0">
         <CardHeader className="p-3">
             <div className="flex justify-between items-center mb-2">
                 <CardTitle className="text-xl flex items-center gap-1">
                     {/* Replaced SVG with Lucide icon */}
                     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-brain-circuit text-primary"><path d="M12 5a3 3 0 1 0-5.997.142"/><path d="M18 5a3 3 0 1 0-5.997.142"/><path d="M12 12a3 3 0 1 0-5.997.142"/><path d="M18 12a3 3 0 1 0-5.997.142"/><path d="M12 19a3 3 0 1 0-5.997.142"/><path d="M18 19a3 3 0 1 0-5.997.142"/><path d="M12 8V5"/><path d="M18 8V5"/><path d="M12 15v-3"/><path d="M18 15v-3"/><path d="M12 22v-3"/><path d="M18 22v-3"/><path d="m15 6-3-1-3 1"/><path d="m15 13-3-1-3 1"/><path d="m15 20-3-1-3 1"/><path d="M9 6.14A3 3 0 0 0 9 5"/><path d="M9 13.14A3 3 0 0 0 9 12"/><path d="M9 20.14A3 3 0 0 0 9 19"/><path d="M15 6.14A3 3 0 0 1 15 5"/><path d="M15 13.14A3 3 0 0 1 15 12"/><path d="M15 20.14A3 3 0 0 1 15 19"/></svg>
                     Math Mania
                 </CardTitle>
                 <div className="flex items-center gap-1">
                    {/* Tooltip for Room Code */}
                    <Button variant="ghost" size="sm" onClick={handleCopyCode} title="Copy Room Code">
                       <ClipboardCopy className="h-4 w-4 mr-1"/> {roomCode}
                    </Button>
                    {/* Tooltip for Invite Link */}
                    <Button variant="ghost" size="sm" onClick={handleCopyLink} title="Copy Invite Link">
                       <Share2 className="h-4 w-4" />
                    </Button>
                     {/* Tooltip for Leave Button */}
                    <Button variant="ghost" size="sm" onClick={handleLeaveGame} title="Leave Room" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                       <LogOut className="h-4 w-4" />
                    </Button>
                 </div>
             </div>
             <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Round: {gameState.currentRound > 0 ? gameState.currentRound : '-'}</span>
                <div className="flex items-center gap-1" title="Time Remaining">
                    <Clock className="h-4 w-4" />
                     {/* Use the calculated roundTimeLeft state for display */}
                    <span>{gameState.isGameActive && !isRoundEnding ? `${roundTimeLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1" title="Players Online">
                   <Users className="h-4 w-4" />
                   <span>{gameState.players.length}</span>
                </div>
             </div>
             {/* Progress Bar: Show only during active, non-ending rounds */}
             {gameState.isGameActive && !isRoundEnding && roundTimeLeft > 0 && (
                 // Use calculated roundTimeLeft for progress bar value
                <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-2 mt-2" aria-label={`Time left: ${roundTimeLeft} seconds`} />
             )}
         </CardHeader>
        </Card>

        {/* Scoreboard / Player List */}
       <div className="flex-shrink-0 m-2 mt-0">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="outline" size="sm" className="w-full mb-1" aria-expanded={showScoreboard}>
               {showScoreboard ? 'Hide Scores' : 'Show Scores'} ({sortedPlayers.length} Player{sortedPlayers.length === 1 ? '' : 's'})
           </Button>
           {showScoreboard && (
              <Card className="shadow rounded-lg">
                 <CardContent className="p-0">
                     {/* Adjust scroll area height based on whether the game area is active */}
                    <ScrollArea className={`p-2 ${gameState.isGameActive ? 'h-[120px]' : 'h-[200px]'}`} aria-label="Scoreboard">
                    {sortedPlayers.length > 0 ? sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1.5 rounded ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 font-semibold' : ''} text-sm mb-1`}>
                          <div className="flex items-center gap-2 overflow-hidden min-w-0"> {/* Ensure min-width */}
                              <span className="font-normal w-5 text-right text-muted-foreground flex-shrink-0">{index + 1}.</span>
                              <Avatar className="h-6 w-6 flex-shrink-0">
                                <AvatarImage src={`https://avatar.vercel.sh/${encodeURIComponent(player.name)}.png?size=24`} alt={player.name} />
                                <AvatarFallback>{player.name.substring(0, 1).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              {/* Added truncate and min-w-0 to the name span */}
                              <span className="truncate flex-1 min-w-0">{player.name} {player.isHost ? <span className="text-xs text-primary/80">(Host)</span> : ''}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                {/* Status Indicator: Show during active rounds or result phase */}
                                {(gameState.isGameActive || isRoundEnding) && player.hasAnswered !== undefined && (
                                     player.hasAnswered ? (
                                         // If round ended or time is up, show correct/incorrect
                                         (isRoundEnding || roundTimeLeft === 0) ? (
                                             player.isCorrect ?
                                                <CheckCircle className="h-4 w-4 text-accent flex-shrink-0" title="Correct"/> :
                                                <XCircle className="h-4 w-4 text-destructive flex-shrink-0" title="Incorrect"/>
                                         ) : (
                                             // Answered, but round still active
                                             <Clock className="h-4 w-4 text-muted-foreground animate-pulse flex-shrink-0" title="Answered" />
                                         )
                                     ) : (
                                          // Player hasn't answered yet
                                         (isRoundEnding || roundTimeLeft === 0) ?
                                            // Round ended, didn't answer
                                            <XCircle className="h-4 w-4 text-muted-foreground opacity-50 flex-shrink-0" title="Did not answer"/> :
                                            null // Round active, not answered - show nothing
                                     )
                                )}
                                <span className="font-mono font-semibold w-10 text-right flex-shrink-0">{player.score}</span>
                          </div>
                       </div>
                    )) : (
                        <p className="text-center text-muted-foreground p-4 text-sm">No players yet.</p>
                    )}
                    </ScrollArea>
                 </CardContent>
              </Card>
           )}
        </div>

        {/* Game Area */}
        <div className="flex-grow flex flex-col justify-center items-center p-4 space-y-4 m-2 mt-0">
            {/* Active Game State */}
            {gameState.isGameActive ? (
                <>
                    <Card className="w-full bg-card shadow-lg text-center p-6">
                        <CardDescription className="mb-2">Question {gameState.currentRound}</CardDescription>
                        <CardTitle className="text-4xl font-mono tracking-wider">
                            {/* Show answer ONLY if round ended or time is 0 */}
                           {(isRoundEnding || roundTimeLeft === 0) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-2">
                        <Input
                            type="number" // Use number for better mobile keyboards potentially
                            inputMode="numeric" // Explicitly suggest numeric keyboard
                            pattern="[0-9-]*" // Allow digits and minus sign
                            placeholder="Your Answer"
                            value={currentAnswer}
                            onChange={(e) => setCurrentAnswer(e.target.value.replace(/[^0-9-]/g, ''))} // Basic sanitization
                            className="text-center text-2xl h-14"
                            // Disable if player has answered, time is up, or in results display phase
                            disabled={hasPlayerAnswered || roundTimeLeft <= 0 || isRoundEnding}
                            aria-label="Enter your answer"
                            aria-disabled={hasPlayerAnswered || roundTimeLeft <= 0 || isRoundEnding}
                            autoFocus // Keep focus here when question appears
                        />
                        <Button
                            type="submit"
                            className="w-full text-lg py-3"
                            // Disable if answered, no input, time is up, or in results display phase
                            disabled={hasPlayerAnswered || currentAnswer === '' || roundTimeLeft <= 0 || isRoundEnding}
                            aria-disabled={hasPlayerAnswered || currentAnswer === '' || roundTimeLeft <= 0 || isRoundEnding}
                         >
                             {/* Clearer button text based on state */}
                            {hasPlayerAnswered ? 'Answer Submitted' : 'Submit Answer'}
                         </Button>
                    </form>
                     {/* Display message during results phase */}
                     {isRoundEnding && (
                        <p className="text-center text-muted-foreground animate-pulse">Revealing results... Next round soon!</p>
                     )}
                     {/* Display message if answered but waiting for others */}
                     {hasPlayerAnswered && !isRoundEnding && roundTimeLeft > 0 && (
                        <p className="text-center text-muted-foreground">Answer locked in! Waiting for others...</p>
                     )}
                </>
            ) : (
                 /* Waiting Lobby State */
                 <Card className="w-full bg-card shadow-lg text-center p-6 flex flex-col items-center justify-center min-h-[200px]">
                     {gameState.players.length > 0 ? (
                         isHost ? (
                             <>
                                 <CardTitle className="mb-4 text-xl">Ready to Start?</CardTitle>
                                 <CardDescription className="mb-4 text-sm">Waiting for players to join. Click start when ready!</CardDescription>
                                 <Button onClick={startGame} className="text-lg py-3 px-6" disabled={gameState.players.length < 1}>
                                     Start Game ({gameState.players.length} player{gameState.players.length === 1 ? '' : 's'})
                                 </Button>
                             </>
                         ) : (
                             <>
                                <CardTitle className="text-xl mb-2">Waiting for the host</CardTitle>
                                <Loader2 className="h-6 w-6 animate-spin text-primary mb-4"/>
                                <CardDescription className="text-sm">The host ({gameState.players.find(p=>p.isHost)?.name || '...'}) will start the game soon.</CardDescription>
                             </>
                         )
                     ) : (
                          // This case should ideally not happen if host joins first via create
                          <>
                            <CardTitle className="text-xl mb-4">Waiting for players<span className="animate-pulse">...</span></CardTitle>
                            <Loader2 className="h-6 w-6 animate-spin text-primary mb-4"/>
                          </>
                     )}
                      <CardDescription className="mt-4 text-xs text-muted-foreground">
                        Share the Room Code: <strong className="text-foreground">{roomCode}</strong> or copy the link!
                      </CardDescription>
                 </Card>
            )}
        </div>

    </div>
  );
};

export default GameRoomPage;
