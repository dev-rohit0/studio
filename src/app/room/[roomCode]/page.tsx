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
import { getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId } from '@/lib/game-storage'; // Keep sessionStorage functions
import { db } from '@/lib/firebase'; // Import Firestore instance
import { doc, onSnapshot, updateDoc, arrayUnion, arrayRemove, deleteDoc, getDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import type { Player, GameState } from '@/types/game';

const ROUND_DURATION = 30; // seconds
const RESULTS_DISPLAY_DURATION = 3000; // milliseconds
// SYNC_INTERVAL is no longer needed as Firestore provides real-time updates

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
  const [gameState, setGameState] = useState<GameState | null>(null); // Includes roomCode now
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(true); // Tracks if user needs to enter name
  const [showScoreboard, setShowScoreboard] = useState(true);
  const [isRoundEnding, setIsRoundEnding] = useState(false); // Flag to manage result display timer

  // const syncIntervalRef = useRef<NodeJS.Timeout | null>(null); // No longer needed
  const roundEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null); // For Firestore listener cleanup

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
      const num2 = Math.floor(Math.random() * (op === '*' || op === '/' ? 15 : 50)) + (op === '/' ? 1 : 0); // Ensure divisor > 0

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
          // Ensure integer division result
          if (num2 === 0) continue; // Should be prevented by +1 above, but safety check
          const product = num1 * num2;
          question = `${product} ÷ ${num2}`;
          answer = num1; // num1 is the correct integer answer
          break;
      }
    }
    if (attempts > 100) {
      console.warn("Could not generate valid equation after 100 attempts, using fallback.");
      question = '1 + 1';
      answer = 2;
    }
    return { question, answer };
  };


  // --- Firestore Update Function ---
  const updateFirestoreState = useCallback(async (updates: Partial<GameState>) => {
      if (!roomCode) return;
      const roomDocRef = doc(db, 'gameRooms', roomCode);
      try {
          console.log(`[updateFirestoreState] Updating Firestore (room: ${roomCode}) with:`, updates);
          // Convert Timestamps back if necessary, though usually not needed for updates unless reading first
          const updatesToSend = { ...updates };
          if (updatesToSend.roundStartTime && typeof updatesToSend.roundStartTime === 'number') {
            // Keep serverTimestamp logic separate if possible, handle numbers here if needed
            console.log("Converting roundStartTime number to Firestore Timestamp potentially (check usage)");
            // updatesToSend.roundStartTime = Timestamp.fromMillis(updatesToSend.roundStartTime); // Example, verify necessity
          }

          await updateDoc(roomDocRef, updatesToSend);
          console.log(`[updateFirestoreState] Firestore update successful for room: ${roomCode}`);
      } catch (error) {
          console.error(`[updateFirestoreState] Error updating Firestore for room ${roomCode}:`, error);
          // Consider adding a toast notification for the user if the update fails
          toast({
              title: "Sync Error",
              description: "Could not save changes to the game. Please check connection.",
              variant: "destructive"
          });
      }
  }, [roomCode, toast]); // Include toast in dependencies


  // --- Derived State ---
  // Important: Ensure gameState is not null before accessing its properties
  const currentPlayer = gameState?.players?.find(p => p.id === localPlayerInfo?.playerId);
  const isHost = currentPlayer?.isHost ?? false; // Get isHost from the current player in the state
  const hasPlayerAnswered = currentPlayer?.hasAnswered ?? false;
  const sortedPlayers = gameState?.players ? [...gameState.players].sort((a, b) => b.score - a.score) : [];

  // Calculate roundTimeLeft based on Firestore timestamp or local state if timestamp not yet available
  const calculateRoundTimeLeft = useCallback(() => {
    if (!gameState?.isGameActive || isRoundEnding || !gameState.roundStartTime) {
        return gameState?.timeLeft ?? 0; // Return stored timeLeft if not active or no start time
    }
    // Firestore Timestamps need to be converted
    const startTimeMillis = gameState.roundStartTime instanceof Timestamp
        ? gameState.roundStartTime.toMillis()
        : typeof gameState.roundStartTime === 'number' // Handle potential initial number state
        ? gameState.roundStartTime
        : Date.now(); // Fallback if type is unexpected

    const elapsed = Math.floor((Date.now() - startTimeMillis) / 1000);
    return Math.max(0, ROUND_DURATION - elapsed);
  }, [gameState?.isGameActive, gameState?.roundStartTime, gameState?.timeLeft, isRoundEnding]); // Ensure all deps are included

  const [roundTimeLeft, setRoundTimeLeft] = useState(() => calculateRoundTimeLeft());

  // Update roundTimeLeft whenever gameState or isRoundEnding changes
  useEffect(() => {
    setRoundTimeLeft(calculateRoundTimeLeft());
  }, [calculateRoundTimeLeft]);

  // Local interval to update the visual timer display frequently
  useEffect(() => {
    if (gameState?.isGameActive && !isRoundEnding && gameState.roundStartTime) {
      const intervalId = setInterval(() => {
        setRoundTimeLeft(calculateRoundTimeLeft());
      }, 500); // Update display every 500ms

      return () => clearInterval(intervalId);
    }
  }, [gameState?.isGameActive, isRoundEnding, gameState?.roundStartTime, calculateRoundTimeLeft]);


  // --- Firestore Real-time Listener ---
  useEffect(() => {
    if (!roomCode) {
        console.error("Room code is missing, cannot set up listener.");
        toast({ title: 'Error', description: 'Invalid room code.', variant: 'destructive' });
        router.push('/');
        return;
    }

    // Ensure player info is loaded before setting listener
    const savedPlayerInfo = getPlayerInfo();
    // Only set localPlayerInfo here if it's not already set,
    // joining logic below will handle setting it after state loads.
    if (!localPlayerInfo && savedPlayerInfo) {
      setLocalPlayerInfo(savedPlayerInfo);
    }


    console.log(`[Listener Setup] Setting up Firestore listener for room: ${roomCode}`);
    const roomDocRef = doc(db, 'gameRooms', roomCode);

    unsubscribeRef.current = onSnapshot(roomDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data() as Omit<GameState, 'roomCode'>; // Data from Firestore doesn't have roomCode
            // console.log(`[onSnapshot] Raw Firestore data for room ${roomCode}:`, data);
             // Explicitly handle potential undefined or incorrect types from Firestore
             const validatedData: GameState = {
                 roomCode: roomCode, // Add roomCode back
                 question: data.question ?? 'Error loading question',
                 answer: typeof data.answer === 'number' ? data.answer : 0,
                 players: Array.isArray(data.players) ? data.players.map(p => ({ // Validate players array and structure
                      id: p?.id ?? '',
                      name: p?.name ?? 'Unknown',
                      score: typeof p?.score === 'number' ? p?.score : 0,
                      isHost: typeof p?.isHost === 'boolean' ? p?.isHost : false,
                      hasAnswered: typeof p?.hasAnswered === 'boolean' ? p?.hasAnswered : false,
                      isCorrect: typeof p?.isCorrect === 'boolean' ? p?.isCorrect : null, // Default to null if missing/invalid
                 })).filter(p => p.id) : [], // Filter out players with missing IDs
                 timeLeft: typeof data.timeLeft === 'number' ? data.timeLeft : 0,
                 isGameActive: typeof data.isGameActive === 'boolean' ? data.isGameActive : false,
                 currentRound: typeof data.currentRound === 'number' ? data.currentRound : 0,
                 roundStartTime: data.roundStartTime instanceof Timestamp ? data.roundStartTime : null, // Expect Timestamp or null
                 createdAt: data.createdAt instanceof Timestamp ? data.createdAt : undefined,
             };
            // console.log(`[onSnapshot] Validated game state for room ${roomCode}:`, validatedData);

            setGameState(validatedData); // Update local state with validated Firestore data + roomCode
            setIsLoading(false); // Mark loading as complete once data is received

            // Determine if the current user needs to join (enter name)
            // This check needs to happen *after* game state is loaded
             const playerInfo = getPlayerInfo(); // Get current info again
             // Check if playerInfo exists AND if a player with that ID is in the validated game state
            if (playerInfo && validatedData.players.some(p => p.id === playerInfo.playerId)) {
                 // console.log(`[onSnapshot] Player ${playerInfo.playerId} already in game state. Setting isJoining=false.`);
                 // Ensure local player info is set correctly if not already
                 if (!localPlayerInfo || localPlayerInfo.playerId !== playerInfo.playerId) {
                    setLocalPlayerInfo(playerInfo);
                 }
                 setIsJoining(false); // Player is already part of the game
            } else {
                // console.log(`[onSnapshot] Player not found in game state or no player info stored. Setting isJoining=true.`);
                setIsJoining(true); // Player needs to enter their name
                // If player info exists locally but they aren't in the game state (e.g., got removed), clear local info.
                if(playerInfo && !validatedData.players.some(p => p.id === playerInfo.playerId)) {
                    console.warn(`[onSnapshot] Local player ${playerInfo.playerId} exists but not in Firestore state for room ${roomCode}. Clearing local info.`);
                    clearPlayerInfo();
                    setLocalPlayerInfo(null);
                } else if (!playerInfo) {
                    // No local info, definitely need to join
                    setLocalPlayerInfo(null);
                }
            }

        } else {
            console.warn(`[onSnapshot] Game room ${roomCode} document does not exist.`);
            toast({ title: 'Room Not Found', description: 'This game room no longer exists or was deleted.', variant: 'destructive' });
            if (unsubscribeRef.current) unsubscribeRef.current(); // Clean up listener
            clearPlayerInfo(); // Clean up local session
            router.push('/'); // Redirect home
        }
    }, (error) => {
        console.error(`[onSnapshot] Error listening to Firestore room ${roomCode}:`, error);
        toast({ title: 'Connection Error', description: 'Lost connection to the game room.', variant: 'destructive' });
        setIsLoading(false);
        // Optionally attempt to reconnect or redirect
        // router.push('/');
    });

    // Cleanup function to unsubscribe when component unmounts or roomCode changes
    return () => {
        if (unsubscribeRef.current) {
            console.log(`[Listener Cleanup] Unsubscribing from Firestore listener for room: ${roomCode}`);
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
         // Clear round end timeout on unmount
         if (roundEndTimeoutRef.current) {
            clearTimeout(roundEndTimeoutRef.current);
            roundEndTimeoutRef.current = null;
        }
    };
    // Add localPlayerInfo to dependency array? Maybe not, could cause loop if set inside. Check carefully.
  }, [roomCode, router, toast]);


  // --- Game Actions (triggered by host or timer) ---

   const startGame = useCallback(async () => {
       // Guard clauses: Ensure gameState, player exists, is host, game not active, players exist
       if (!gameState || !localPlayerInfo || !isHost || gameState.isGameActive || !gameState.players || gameState.players.length === 0) {
            console.log(`[startGame] Aborted: gameState=${!!gameState}, localPlayerInfo=${!!localPlayerInfo}, isHost=${isHost}, isGameActive=${gameState?.isGameActive}, players=${gameState?.players?.length}`);
            return;
       }


       console.log(`[startGame] Host (${localPlayerInfo?.playerId}) starting game in room ${roomCode}...`);
       const { question, answer } = generateEquation();

       // Reset player statuses for the new game
        const resetPlayers = gameState.players.map(p => ({
           ...p,
           score: 0, // Reset score for a completely new game
           hasAnswered: false,
           isCorrect: null, // Reset correctness to null
       }));

       const newState: Partial<GameState> = {
           question,
           answer,
           timeLeft: ROUND_DURATION,
           isGameActive: true,
           currentRound: 1,
           players: resetPlayers,
           roundStartTime: serverTimestamp(), // Use Firestore server timestamp
       };
       await updateFirestoreState(newState);
   }, [gameState, isHost, updateFirestoreState, roomCode, localPlayerInfo]); // Added localPlayerInfo dependency


   const nextQuestion = useCallback(async () => {
       // Guard clauses: Ensure gameState, player exists, is host, game is active
       if (!gameState || !localPlayerInfo || !isHost || !gameState.isGameActive) {
            console.log(`[nextQuestion] Aborted: gameState=${!!gameState}, localPlayerInfo=${!!localPlayerInfo}, isHost=${isHost}, isGameActive=${gameState?.isGameActive}`);
            return;
       }
       console.log(`[nextQuestion] Host (${localPlayerInfo?.playerId}) advancing to next question in room ${roomCode}...`);

       // Clear previous round end timeout if exists
       if (roundEndTimeoutRef.current) {
           clearTimeout(roundEndTimeoutRef.current);
           roundEndTimeoutRef.current = null;
       }
       setIsRoundEnding(false); // Reset round ending flag locally

       const { question, answer } = generateEquation();
       const nextRoundNumber = (gameState.currentRound || 0) + 1;

       // Reset player statuses for the new round
       const resetPlayers = gameState.players.map(p => ({
           ...p,
           hasAnswered: false,
           isCorrect: null, // Reset correctness to null
       }));

       const newState: Partial<GameState> = {
           question,
           answer,
           timeLeft: ROUND_DURATION,
           currentRound: nextRoundNumber,
           players: resetPlayers,
           roundStartTime: serverTimestamp(), // Use Firestore server timestamp
           // Keep isGameActive: true
       };
       await updateFirestoreState(newState);
       setCurrentAnswer(''); // Clear input field for the new question (locally for current player)
   }, [gameState, isHost, updateFirestoreState, roomCode, localPlayerInfo]); // Added localPlayerInfo dependency


  const endRound = useCallback(async () => {
      // Guard clauses: Ensure gameState, player exists, is host, game active, not already ending
      if (!gameState || !localPlayerInfo || !isHost || isRoundEnding || !gameState.isGameActive) {
          console.log(`[endRound] Aborted: gameState=${!!gameState}, localPlayerInfo=${!!localPlayerInfo}, isHost=${isHost}, isRoundEnding=${isRoundEnding}, isGameActive=${gameState?.isGameActive}`);
          return;
      }
      console.log(`[endRound] Host (${localPlayerInfo?.playerId}) ending round ${gameState.currentRound} in room ${roomCode} - revealing results...`);
      setIsRoundEnding(true); // Set flag immediately to prevent race conditions

      // Fetch the latest state directly before update to avoid stale data race conditions
       const roomDocRef = doc(db, 'gameRooms', roomCode);
       try {
           const currentDoc = await getDoc(roomDocRef);
           if (!currentDoc.exists()) {
                console.error("[endRound] Room document disappeared before update.");
                setIsRoundEnding(false); // Reset flag if room gone
                return;
           }
           const currentState = currentDoc.data() as GameState;
            if (!currentState.isGameActive) {
                console.warn("[endRound] Game became inactive before update could be applied.");
                 setIsRoundEnding(false); // Reset flag if game already inactive
                return; // Avoid updating if game is no longer active
            }


           const updatedPlayers = currentState.players.map(p => ({
               ...p,
               // Mark unanswered as incorrect (false). If answered, keep their calculated isCorrect value.
               isCorrect: p.hasAnswered ? p.isCorrect : false,
           }));

           const newState: Partial<GameState> = {
               players: updatedPlayers,
               timeLeft: 0, // Explicitly set time to 0
               // Keep isGameActive true; nextQuestion handles transition
           };

            console.log(`[endRound] Updating Firestore state for results display:`, newState);
           await updateFirestoreState(newState); // Use the shared update function

           // Schedule the next question after the results display duration
           if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current); // Clear existing timeout if any
           console.log(`[endRound] Scheduling next question trigger in ${RESULTS_DISPLAY_DURATION}ms.`);
           roundEndTimeoutRef.current = setTimeout(() => {
               console.log(`[endRound] Results display timer finished for round ${currentState.currentRound}. Triggering next question.`);
               // Firestore listener updates gameState, so nextQuestion should have latest state.
               setIsRoundEnding(false); // Reset flag BEFORE calling nextQuestion
               nextQuestion(); // Host triggers the next question
           }, RESULTS_DISPLAY_DURATION);

       } catch (error) {
            console.error(`[endRound] Error fetching or updating document during endRound for room ${roomCode}:`, error);
            setIsRoundEnding(false); // Reset flag on error
             toast({
                title: "Error Ending Round",
                description: "Could not finalize the round scores.",
                variant: "destructive"
            });
       }

  }, [gameState, isHost, isRoundEnding, updateFirestoreState, nextQuestion, roomCode, localPlayerInfo, toast]); // Added localPlayerInfo dependency


  // Timer Check Logic - simplified for Firestore
  // Host checks if time is up based on roundStartTime from Firestore state
  useEffect(() => {
    // Run only for the host when the game is active and not in the results display phase
    if (!isHost || !gameState || !gameState.isGameActive || isRoundEnding || !gameState.roundStartTime) {
      return;
    }

    const checkTimeUp = () => {
        const timeLeftNow = calculateRoundTimeLeft();
        // console.log(`[TimerCheck] Host (${localPlayerInfo?.playerId}) checking time. Left: ${timeLeftNow}`); // Frequent log, disable if noisy

        if (timeLeftNow <= 0) {
            console.log(`[TimerCheck] Host (${localPlayerInfo?.playerId}) detected time is up for round ${gameState.currentRound}. Ending round.`);
            endRound(); // Call the memoized endRound function
        }
    };

    // Set up an interval to check the time condition
    // This ensures the host calls endRound reasonably promptly after time expires
    const checkIntervalId = setInterval(checkTimeUp, 1000); // Check every second

    // Cleanup function
    return () => clearInterval(checkIntervalId);

    // Include localPlayerInfo in dependencies if used inside checkTimeUp (it is, for logging)
  }, [isHost, gameState, isRoundEnding, endRound, calculateRoundTimeLeft, localPlayerInfo?.playerId]);


  // --- Player Actions ---

  const handleJoinGame = async () => {
      const name = inputPlayerName.trim();
      if (!name) {
          toast({ title: "Please enter your name", variant: "destructive" });
          return;
      }
       // Ensure game state is loaded before allowing join
      if (!gameState || isLoading) {
          toast({ title: "Loading...", description: "Please wait for the game to load.", variant: "default" });
          return;
      }

       // Check for existing name (case-insensitive) using the latest gameState
      if (gameState.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
          toast({ title: "Name Taken", description: "That name is already in use. Please choose another.", variant: "destructive" });
          return;
      }

      const playerId = generateId();
      const shouldBeHost = isInitiallyHost && gameState.players.length === 0;
      console.log(`[handleJoinGame] Attempting to join room ${roomCode} as ${name} (playerId: ${playerId}, shouldBeHost: ${shouldBeHost})`);

      const newPlayer: Player = {
          id: playerId,
          name: name,
          score: 0,
          isHost: shouldBeHost,
          hasAnswered: false, // Initialize answer status
          isCorrect: null // Initialize correctness to null, not undefined
      };

      // Save player info to sessionStorage FIRST
      savePlayerInfo(playerId, name);
       // Update local state immediately for UI responsiveness before Firestore update
      setLocalPlayerInfo({ playerId, playerName: name });
      setIsJoining(false); // Transition out of joining state locally

      // Update Firestore using arrayUnion
      const roomDocRef = doc(db, 'gameRooms', roomCode);
      try {
          console.log(`[handleJoinGame] Updating Firestore: Adding player ${JSON.stringify(newPlayer)} to room ${roomCode}`);
           // If this player IS the host, we might need to ensure no one else is host.
           // This is complex with arrayUnion. It's safer to fetch and write if host logic is critical.
           // For this app, we assume the `isInitiallyHost && players.length === 0` check is sufficient.
           // If race conditions are a concern, use a transaction here.
           await updateDoc(roomDocRef, {
              players: arrayUnion(newPlayer) // Atomically add the new player
           });

          console.log(`[handleJoinGame] Successfully added player ${playerId} to Firestore room ${roomCode}`);
          toast({ title: `Welcome, ${name}!` });
      } catch (error) {
          console.error(`[handleJoinGame] Error adding player ${playerId} to Firestore room ${roomCode}:`, error);
           // Revert local state changes if Firestore update fails
           clearPlayerInfo();
           setLocalPlayerInfo(null);
           setIsJoining(true);
          toast({
              title: "Error Joining Game",
              description: "Could not add you to the room. Please try again.",
              variant: "destructive",
          });
      }
  };


  const handleAnswerSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      // Guard clauses: Ensure player, game state, game active, answer exists, and round not ending/time left
      if (!localPlayerInfo || !gameState || !gameState.isGameActive || currentAnswer === '' || isRoundEnding || roundTimeLeft <= 0) {
           console.log(`[handleAnswerSubmit] Aborted: localPlayerInfo=${!!localPlayerInfo}, gameState=${!!gameState}, isGameActive=${gameState?.isGameActive}, currentAnswer=${currentAnswer}, isRoundEnding=${isRoundEnding}, roundTimeLeft=${roundTimeLeft}`);
           return;
      }

      const playerInState = gameState.players.find(p => p.id === localPlayerInfo.playerId);
      // Ensure player exists in state and hasn't answered yet
      if (!playerInState || playerInState.hasAnswered) {
           console.log(`[handleAnswerSubmit] Aborted: playerInState=${!!playerInState}, hasAnswered=${playerInState?.hasAnswered}`);
           return;
      }

      console.log(`[handleAnswerSubmit] Player ${localPlayerInfo.playerId} submitting answer: ${currentAnswer} for round ${gameState.currentRound}`);

      const submittedAnswer = parseInt(currentAnswer, 10);
      // Handle NaN case from parseInt if input is invalid (e.g., just "-")
      if (isNaN(submittedAnswer)) {
          toast({
              title: "Invalid Answer",
              description: "Please enter a valid number.",
              variant: "destructive",
              duration: 2000,
          });
          return;
      }

      const isAnswerCorrect = submittedAnswer === gameState.answer;

      // Calculate score based on remaining time (using the accurate server timestamp)
      const startTimeMillis = gameState.roundStartTime instanceof Timestamp
            ? gameState.roundStartTime.toMillis()
            : typeof gameState.roundStartTime === 'number'
            ? gameState.roundStartTime
            : Date.now(); // Fallback

      const timeElapsed = Math.floor((Date.now() - startTimeMillis) / 1000);
      const timeTaken = Math.min(ROUND_DURATION, Math.max(0, timeElapsed)); // Clamp time
      // More robust scoring: ensure positive score for correct, handle edge cases
      const scoreToAdd = isAnswerCorrect ? Math.max(5, (ROUND_DURATION - timeTaken) * 2 + 10) : 0; // Example scoring

      console.log(`[handleAnswerSubmit] Player ${localPlayerInfo.playerId} - Correct: ${isAnswerCorrect}, ScoreToAdd: ${scoreToAdd}, TimeTaken: ${timeTaken}s`);

      toast({
        title: isAnswerCorrect ? 'Correct!' : 'Incorrect',
        description: isAnswerCorrect ? `+${scoreToAdd} points!` : `Answer was: ${gameState.answer}`,
        variant: isAnswerCorrect ? 'default' : 'destructive',
        className: isAnswerCorrect ? 'bg-accent text-accent-foreground border-accent' : '',
        duration: 2000, // Shorter duration for answer feedback
      });

       // Update Firestore: Find the player and update their score, hasAnswered, isCorrect
       // This requires reading the current array, modifying it, and writing it back.
       // Using a transaction is safer for score updates, but requires more setup.
       // Read-modify-write approach (less safe with high concurrency):
       const roomDocRef = doc(db, 'gameRooms', roomCode);
       try {
             // Get current players array directly from Firestore to minimize race condition
             const currentDoc = await getDoc(roomDocRef);
             if (!currentDoc.exists()) throw new Error("Room document not found during answer submit");
              // Ensure players array exists and is an array
             const currentPlayers = (currentDoc.data() as GameState)?.players;
             if (!Array.isArray(currentPlayers)) {
                 throw new Error("Players data is missing or not an array in Firestore during answer submit");
             }

              // Find and update the specific player
              const updatedPlayers = currentPlayers.map(p =>
                 p.id === localPlayerInfo.playerId
                 ? {
                     ...p,
                     score: (p.score ?? 0) + scoreToAdd, // Ensure score is treated as number
                     hasAnswered: true,
                     isCorrect: isAnswerCorrect // Set correctness based on calculation
                    }
                 : p
              );

              console.log(`[handleAnswerSubmit] Updating Firestore players array for player ${localPlayerInfo.playerId}. New array:`, updatedPlayers);
              await updateDoc(roomDocRef, { players: updatedPlayers });
              console.log(`[handleAnswerSubmit] Firestore update successful for player ${localPlayerInfo.playerId}`);

       } catch (error) {
            console.error(`[handleAnswerSubmit] Error updating Firestore for player ${localPlayerInfo.playerId}'s answer:`, error);
             toast({
                title: "Error Submitting Answer",
                description: "Could not save your answer. Please try again.",
                variant: "destructive",
            });
            // Do NOT clear the input locally if submit failed
            return; // Prevent clearing input
       }


      // Clear the input field locally AFTER successful Firestore update
      setCurrentAnswer('');
  };


  const handleLeaveGame = async () => {
      if (!localPlayerInfo || !gameState) return;

      console.log(`[handleLeaveGame] Player ${localPlayerInfo.playerId} attempting to leave room ${roomCode}. isHost=${isHost}`);

      // Clear local timers/listeners immediately
      if (unsubscribeRef.current) unsubscribeRef.current();
      if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
      unsubscribeRef.current = null;
      roundEndTimeoutRef.current = null;

      const leavingPlayerId = localPlayerInfo.playerId;
      const leavingPlayerName = localPlayerInfo.playerName; // For toast message
      const roomDocRef = doc(db, 'gameRooms', roomCode);

      // Clear local session info *before* async operations, in case they fail
      clearPlayerInfo();
      setLocalPlayerInfo(null); // Update local state immediately

      try {
         // Use a batch write or transaction for atomicity, especially for host transfer
         const batch = writeBatch(db);

         // Get the current state to determine remaining players and host status
         const currentDoc = await getDoc(roomDocRef);
          if (!currentDoc.exists()) {
              console.warn(`[handleLeaveGame] Room ${roomCode} already deleted.`);
              router.push('/'); // Already gone, just navigate home
              return;
          }
          const currentState = currentDoc.data() as GameState;
           if (!Array.isArray(currentState?.players)) {
               console.warn(`[handleLeaveGame] Players data missing or invalid in room ${roomCode}. Navigating home.`);
                router.push('/'); // Can't process leave without player data
                return;
           }

          const leavingPlayer = currentState.players.find(p => p.id === leavingPlayerId);

          if (!leavingPlayer) {
                console.warn(`[handleLeaveGame] Player ${leavingPlayerId} not found in Firestore state. Navigating home.`);
                router.push('/');
                return;
          }

          const remainingPlayers = currentState.players.filter(p => p.id !== leavingPlayerId);
          const wasHost = leavingPlayer.isHost; // Check the host status from Firestore state

          if (remainingPlayers.length === 0) {
              // Last player leaving - delete the room document
              console.log(`[handleLeaveGame] Last player (${leavingPlayerId}) leaving. Deleting room ${roomCode}.`);
              batch.delete(roomDocRef);
          } else {
              let newHostAssigned = false;
              if (wasHost) {
                  // Host leaving, assign new host (e.g., first remaining player)
                  // Ensure there are remaining players before accessing [0]
                  if (remainingPlayers.length > 0) {
                      const newHost = remainingPlayers[0];
                      console.log(`[handleLeaveGame] Host (${leavingPlayerId}) leaving. Assigning new host: ${newHost.id} (${newHost.name}).`);
                      // Create a new array with the updated host status
                       const playersWithNewHost = remainingPlayers.map((p, index) =>
                          index === 0 ? { ...p, isHost: true } : { ...p, isHost: false } // Ensure only one host
                      );
                       batch.update(roomDocRef, { players: playersWithNewHost });
                       newHostAssigned = true;
                   } else {
                        // This case should be covered by the remainingPlayers.length === 0 check above,
                        // but adding safety log here.
                         console.warn(`[handleLeaveGame] Host was leaving, but remainingPlayers array is unexpectedly empty. Deleting room.`);
                        batch.delete(roomDocRef); // Delete if host leaves and somehow no one is left
                   }
              } else {
                  // Non-host leaving, just update the players array
                   console.log(`[handleLeaveGame] Non-host player (${leavingPlayerId}) leaving room ${roomCode}.`);
                  batch.update(roomDocRef, { players: remainingPlayers }); // Update with filtered list
              }
          }
             // Commit the batch write (either delete or update)
             await batch.commit();
             console.log(`[handleLeaveGame] Firestore batch commit successful for player ${leavingPlayerId} leaving.`);
             // This section for host change toast is problematic as the leaving client won't see it.
             // The new host/other clients will see the change via the listener.
             /*
             if (newHostAssigned) {
                 // Toast locally about host change - other clients will see via listener
                 const newHost = remainingPlayers.find(p => p.isHost);
                 if (newHost) {
                    toast({ title: "Host Changed", description: `${newHost.name} is the new host.`});
                 }
             }
             */


      } catch (error) {
          console.error(`[handleLeaveGame] Error removing player ${leavingPlayerId} or deleting room ${roomCode} from Firestore:`, error);
          // Even if Firestore fails, navigate away as local info is cleared
          toast({
              title: 'Error Leaving Room',
              description: 'Could not update the room status. You have been removed locally.',
              variant: 'destructive',
          });
      } finally {
            // Always navigate home after attempting to leave
            toast({ title: `You left the room "${leavingPlayerName || 'Player'}".` });
            router.push('/');
      }
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
     if (!roomCode) return;
    navigator.clipboard.writeText(roomCode).then(() => {
      toast({ title: 'Room Code Copied!' });
    }).catch(err => {
      console.error('Failed to copy code: ', err);
      toast({ title: 'Failed to copy code', variant: 'destructive' });
    });
  };


  // --- Render Logic ---

  // Initial Loading State
  if (isLoading) {
      return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Loading Room...</span></div>;
  }

  // Join Screen (if player hasn't entered name yet OR if gameState indicates they need to join again)
  if (isJoining || !localPlayerInfo || (gameState && !gameState.players.some(p => p.id === localPlayerInfo?.playerId))) {
     // Add a check to ensure we don't show join screen if game state hasn't loaded yet
     if (!gameState) {
        return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Initializing...</span></div>;
     }

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


  // Error state if game state is missing after loading/joining attempt but player info exists
  // This state should ideally not be reached if listener/joining works correctly.
  if (!gameState && localPlayerInfo) {
     console.error("Render error: Game state missing but player info exists after loading/joining phase.");
     // Use useEffect to avoid calling router during render
     useEffect(() => {
        const timer = setTimeout(() => {
           console.log("Redirecting home due to missing game state.");
            clearPlayerInfo(); // Ensure cleanup before redirect
           router.push('/');
        }, 3000);
        return () => clearTimeout(timer); // Cleanup timeout
     }, [router]);

     return (
         <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
            <XCircle className="h-12 w-12 text-destructive mb-4" />
            <h1 className="text-2xl font-semibold text-destructive mb-2">Error Loading Game Data</h1>
            <p className="text-muted-foreground">Could not load game data. You will be redirected home shortly.</p>
            <Button onClick={() => { clearPlayerInfo(); router.push('/'); }} variant="outline" className="mt-4">Go Home Now</Button>
         </div>
     );
  }

  // Main Game Screen Render (requires gameState and localPlayerInfo to be present)
  if (!gameState || !localPlayerInfo) {
      // This should theoretically not be hit if the above checks work, but acts as a final safety net.
      console.error("Critical Render Error: Game state or local player info is unexpectedly null/undefined.");
       useEffect(() => {
          const timer = setTimeout(() => {
             console.log("Redirecting home due to critical render state error.");
              clearPlayerInfo(); // Ensure cleanup before redirect
             router.push('/');
          }, 3000);
          return () => clearTimeout(timer); // Cleanup timeout
       }, [router]);
      return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-destructive" /> <span className="ml-2 text-destructive">Critical Error - Redirecting...</span></div>;
  }


  // == Main Game Screen ==
  return (
    <div className="flex flex-col h-screen max-h-screen w-full max-w-md bg-secondary">

        {/* Header Area */}
        <Card className="m-2 shadow rounded-lg flex-shrink-0">
         <CardHeader className="p-3">
             <div className="flex justify-between items-center mb-2">
                 <CardTitle className="text-xl flex items-center gap-1">
                     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-brain-circuit text-primary"><path d="M12 5a3 3 0 1 0-5.997.142"/><path d="M18 5a3 3 0 1 0-5.997.142"/><path d="M12 12a3 3 0 1 0-5.997.142"/><path d="M18 12a3 3 0 1 0-5.997.142"/><path d="M12 19a3 3 0 1 0-5.997.142"/><path d="M18 19a3 3 0 1 0-5.997.142"/><path d="M12 8V5"/><path d="M18 8V5"/><path d="M12 15v-3"/><path d="M18 15v-3"/><path d="M12 22v-3"/><path d="M18 22v-3"/><path d="m15 6-3-1-3 1"/><path d="m15 13-3-1-3 1"/><path d="m15 20-3-1-3 1"/><path d="M9 6.14A3 3 0 0 0 9 5"/><path d="M9 13.14A3 3 0 0 0 9 12"/><path d="M9 20.14A3 3 0 0 0 9 19"/><path d="M15 6.14A3 3 0 0 1 15 5"/><path d="M15 13.14A3 3 0 0 1 15 12"/><path d="M15 20.14A3 3 0 0 1 15 19"/></svg>
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
                <div className="flex items-center gap-1" title="Time Remaining">
                    <Clock className="h-4 w-4" />
                     {/* Use the calculated roundTimeLeft state for display */}
                    <span>{gameState.isGameActive && !isRoundEnding && gameState.roundStartTime ? `${roundTimeLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1" title="Players Online">
                   <Users className="h-4 w-4" />
                   <span>{gameState.players?.length ?? 0}</span>
                </div>
             </div>
             {/* Progress Bar: Show only during active, non-ending rounds */}
             {gameState.isGameActive && !isRoundEnding && roundTimeLeft > 0 && gameState.roundStartTime && (
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
                    <ScrollArea className={`p-2 ${gameState.isGameActive ? 'h-[120px]' : 'h-[200px]'}`} aria-label="Scoreboard">
                    {sortedPlayers.length > 0 ? sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1.5 rounded ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 font-semibold' : ''} text-sm mb-1`}>
                          <div className="flex items-center gap-2 overflow-hidden min-w-0"> {/* Ensure min-width */}
                              <span className="font-normal w-5 text-right text-muted-foreground flex-shrink-0">{index + 1}.</span>
                              <Avatar className="h-6 w-6 flex-shrink-0">
                                {/* Use a deterministic avatar based on player name */}
                                <AvatarImage src={`https://avatar.vercel.sh/${encodeURIComponent(player.name)}.png?size=24`} alt={player.name} />
                                <AvatarFallback>{player.name.substring(0, 1).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              {/* Ensure player.name is defined before accessing */}
                              <span className="truncate flex-1 min-w-0">{player.name ?? 'Loading...'} {player.isHost ? <span className="text-xs text-primary/80">(Host)</span> : ''}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                {/* Status Indicator: Show during active rounds or result phase */}
                                {(gameState.isGameActive || isRoundEnding) && player.hasAnswered !== undefined && ( // Check hasAnswered is not undefined
                                     player.hasAnswered ? (
                                         // If round ended or time is up, show correct/incorrect
                                         (isRoundEnding || (roundTimeLeft <= 0 && gameState.roundStartTime)) ? ( // Check round end OR time up (with start time)
                                             player.isCorrect === true ? // Explicit boolean check
                                                <CheckCircle className="h-4 w-4 text-accent flex-shrink-0" title="Correct"/> :
                                                player.isCorrect === false ? // Explicit boolean check (covers null/undefined indirectly if logic above is correct)
                                                <XCircle className="h-4 w-4 text-destructive flex-shrink-0" title="Incorrect"/> :
                                                // Fallback if isCorrect is somehow still null/undefined after round end
                                                <XCircle className="h-4 w-4 text-muted-foreground opacity-60 flex-shrink-0" title="Result Pending/Error" />
                                         ) : (
                                             // Answered, but round still active
                                             <Clock className="h-4 w-4 text-muted-foreground animate-pulse flex-shrink-0" title="Answered" />
                                         )
                                     ) : (
                                          // Player hasn't answered yet
                                         (isRoundEnding || (roundTimeLeft <= 0 && gameState.roundStartTime)) ? // Check round end OR time up
                                            // Round ended, didn't answer
                                            <XCircle className="h-4 w-4 text-muted-foreground opacity-50 flex-shrink-0" title="Did not answer"/> :
                                            null // Round active, not answered - show nothing
                                     )
                                )}
                                {/* Ensure player.score is defined before accessing */}
                                <span className="font-mono font-semibold w-10 text-right flex-shrink-0">{player.score ?? 0}</span>
                          </div>
                       </div>
                    )) : (
                        <p className="text-center text-muted-foreground p-4 text-sm">Waiting for players...</p>
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
                            {/* Show answer ONLY if round ended or time is 0 (and round started) */}
                           {(isRoundEnding || (roundTimeLeft <= 0 && gameState.roundStartTime)) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-2">
                        <Input
                            type="number" // Use number for better mobile keyboards potentially
                            inputMode="numeric" // Explicitly suggest numeric keyboard
                            pattern="[0-9-]*" // Allow digits and minus sign
                            placeholder="Your Answer"
                            value={currentAnswer}
                             // Basic sanitization - allow negative numbers
                            onChange={(e) => setCurrentAnswer(e.target.value.replace(/[^0-9-]/g, ''))}
                            className="text-center text-2xl h-14"
                            // Disable if player has answered, time is up, or in results display phase
                            disabled={hasPlayerAnswered || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
                            aria-label="Enter your answer"
                            aria-disabled={hasPlayerAnswered || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
                            autoFocus // Keep focus here when question appears
                        />
                        <Button
                            type="submit"
                            className="w-full text-lg py-3"
                            // Disable if answered, no input, time is up, or in results display phase
                            disabled={hasPlayerAnswered || currentAnswer === '' || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
                            aria-disabled={hasPlayerAnswered || currentAnswer === '' || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
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
                     {/* Message if time ran out and player didn't answer */}
                     {!hasPlayerAnswered && !isRoundEnding && roundTimeLeft <= 0 && gameState.roundStartTime && (
                         <p className="text-center text-destructive font-medium">Time's up!</p>
                     )}
                </>
            ) : (
                 /* Waiting Lobby State */
                 <Card className="w-full bg-card shadow-lg text-center p-6 flex flex-col items-center justify-center min-h-[200px]">
                     {gameState.players && gameState.players.length > 0 ? (
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
                          // No players yet
                          <>
                            <CardTitle className="text-xl mb-4">Waiting for players<span className="animate-pulse">...</span></CardTitle>
                            <Loader2 className="h-6 w-6 animate-spin text-primary mb-4"/>
                            <CardDescription className="mt-2 text-xs text-muted-foreground">
                                Share the Room Code or Link below!
                            </CardDescription>
                          </>
                     )}
                      <CardDescription className="mt-4 text-xs text-muted-foreground">
                        Room Code: <strong className="text-foreground">{roomCode}</strong>
                        <Button variant="link" size="sm" onClick={handleCopyCode} className="p-1 h-auto ml-1">Copy Code</Button>
                        <Button variant="link" size="sm" onClick={handleCopyLink} className="p-1 h-auto ml-1">Copy Link</Button>
                      </CardDescription>
                 </Card>
            )}
        </div>

    </div>
  );
};

export default GameRoomPage;
