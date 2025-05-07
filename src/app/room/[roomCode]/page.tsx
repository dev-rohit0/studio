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
import { getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, deleteDoc, getDoc, writeBatch, serverTimestamp, Timestamp, runTransaction } from 'firebase/firestore';
import type { Player, GameState } from '@/types/game';
import AdBanner from '@/components/ads/AdBanner'; // Import AdBanner

const ROUND_DURATION = 30; // seconds
const RESULTS_DISPLAY_DURATION = 3000; // milliseconds
const INACTIVITY_CLEANUP_INTERVAL = 30000; // 30 seconds
const PLAYER_INACTIVITY_TIMEOUT = 60000; // 60 seconds (1 minute) for a player to be considered inactive


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
  const [isRoundEnding, setIsRoundEnding] = useState(false);

  const roundEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);
  const inactivityCleanupIntervalRef = useRef<NodeJS.Timeout | null>(null);


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
          if (num2 === 0) continue;
          const product = num1 * num2;
          question = `${product} ÷ ${num2}`;
          answer = num1;
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

  const updateFirestoreState = useCallback(async (updates: Partial<GameState>) => {
      if (!roomCode) return;
      const roomDocRef = doc(db, 'gameRooms', roomCode);
      try {
          console.log(`[updateFirestoreState] Updating Firestore (room: ${roomCode}) with:`, JSON.parse(JSON.stringify(updates))); // Clone for logging
          await updateDoc(roomDocRef, updates);
          console.log(`[updateFirestoreState] Firestore update successful for room: ${roomCode}`);
      } catch (error) {
          console.error(`[updateFirestoreState] Error updating Firestore for room ${roomCode}:`, error);
          toast({
              title: "Sync Error",
              description: "Could not save changes to the game. Please check connection.",
              variant: "destructive"
          });
      }
  }, [roomCode, toast]);

  const currentPlayer = gameState?.players?.find(p => p.id === localPlayerInfo?.playerId);
  const isHost = currentPlayer?.isHost ?? false;
  const hasPlayerAnswered = currentPlayer?.hasAnswered ?? false;
  const isPlayerCorrect = currentPlayer?.isCorrect === true;
  const sortedPlayers = gameState?.players ? [...gameState.players].sort((a, b) => b.score - a.score) : [];

  const calculateRoundTimeLeft = useCallback(() => {
    if (!gameState?.isGameActive || isRoundEnding || !gameState.roundStartTime) {
        return gameState?.timeLeft ?? 0;
    }
    const startTimeMillis = gameState.roundStartTime instanceof Timestamp
        ? gameState.roundStartTime.toMillis()
        : typeof gameState.roundStartTime === 'number'
        ? gameState.roundStartTime
        : Date.now();

    const elapsed = Math.floor((Date.now() - startTimeMillis) / 1000);
    return Math.max(0, ROUND_DURATION - elapsed);
  }, [gameState?.isGameActive, gameState?.roundStartTime, gameState?.timeLeft, isRoundEnding]);

  const [roundTimeLeft, setRoundTimeLeft] = useState(() => calculateRoundTimeLeft());

  useEffect(() => {
    setRoundTimeLeft(calculateRoundTimeLeft());
  }, [calculateRoundTimeLeft]);

  useEffect(() => {
    if (gameState?.isGameActive && !isRoundEnding && gameState.roundStartTime) {
      const intervalId = setInterval(() => {
        setRoundTimeLeft(calculateRoundTimeLeft());
      }, 500);
      return () => clearInterval(intervalId);
    }
  }, [gameState?.isGameActive, isRoundEnding, gameState?.roundStartTime, calculateRoundTimeLeft]);

  useEffect(() => {
    if (!roomCode) {
        console.error("Room code is missing, cannot set up listener.");
        toast({ title: 'Error', description: 'Invalid room code.', variant: 'destructive' });
        router.push('/');
        return;
    }

    const savedPlayerInfo = getPlayerInfo();
    if (!localPlayerInfo && savedPlayerInfo) {
      setLocalPlayerInfo(savedPlayerInfo);
    }

    console.log(`[Listener Setup] Setting up Firestore listener for room: ${roomCode}`);
    const roomDocRef = doc(db, 'gameRooms', roomCode);

    unsubscribeRef.current = onSnapshot(roomDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data() as Omit<GameState, 'roomCode'>;
             const validatedData: GameState = {
                 roomCode: roomCode,
                 question: data.question ?? 'Error loading question',
                 answer: typeof data.answer === 'number' ? data.answer : 0,
                 players: Array.isArray(data.players) ? data.players.map(p => ({
                      id: p?.id ?? '',
                      name: p?.name ?? 'Unknown',
                      score: typeof p?.score === 'number' ? p?.score : 0,
                      isHost: typeof p?.isHost === 'boolean' ? p?.isHost : false,
                      hasAnswered: typeof p?.hasAnswered === 'boolean' ? p?.hasAnswered : false,
                      isCorrect: typeof p?.isCorrect === 'boolean' ? p.isCorrect : null,
                      lastActive: p?.lastActive instanceof Timestamp ? p.lastActive : null, // Validate lastActive
                 })).filter(p => p.id) : [],
                 timeLeft: typeof data.timeLeft === 'number' ? data.timeLeft : 0,
                 isGameActive: typeof data.isGameActive === 'boolean' ? data.isGameActive : false,
                 currentRound: typeof data.currentRound === 'number' ? data.currentRound : 0,
                 roundStartTime: data.roundStartTime instanceof Timestamp ? data.roundStartTime : null,
                 createdAt: data.createdAt instanceof Timestamp ? data.createdAt : undefined,
             };

            setGameState(validatedData);
            setIsLoading(false);

            const playerInfo = getPlayerInfo();
            if (playerInfo && validatedData.players.some(p => p.id === playerInfo.playerId)) {
                 if (!localPlayerInfo || localPlayerInfo.playerId !== playerInfo.playerId) {
                    setLocalPlayerInfo(playerInfo);
                 }
                 setIsJoining(false);
            } else {
                setIsJoining(true);
                if(playerInfo && !validatedData.players.some(p => p.id === playerInfo.playerId)) {
                    console.warn(`[onSnapshot] Local player ${playerInfo.playerId} exists but not in Firestore state for room ${roomCode}. Clearing local info.`);
                    clearPlayerInfo();
                    setLocalPlayerInfo(null);
                } else if (!playerInfo) {
                    setLocalPlayerInfo(null);
                }
            }

        } else {
            console.warn(`[onSnapshot] Game room ${roomCode} document does not exist.`);
            toast({ title: 'Room Not Found', description: 'This game room no longer exists or was deleted.', variant: 'destructive' });
            if (unsubscribeRef.current) unsubscribeRef.current();
            clearPlayerInfo();
            router.push('/');
        }
    }, (error) => {
        console.error(`[onSnapshot] Error listening to Firestore room ${roomCode}:`, error);
        toast({ title: 'Connection Error', description: 'Lost connection to the game room.', variant: 'destructive' });
        setIsLoading(false);
    });

    return () => {
        if (unsubscribeRef.current) {
            console.log(`[Listener Cleanup] Unsubscribing from Firestore listener for room: ${roomCode}`);
            unsubscribeRef.current();
            unsubscribeRef.current = null;
        }
         if (roundEndTimeoutRef.current) {
            clearTimeout(roundEndTimeoutRef.current);
            roundEndTimeoutRef.current = null;
        }
    };
  }, [roomCode, router, toast, localPlayerInfo]); // Added localPlayerInfo

   const startGame = useCallback(async () => {
       if (!gameState || !localPlayerInfo || !isHost || gameState.isGameActive || !gameState.players || gameState.players.length === 0) {
            console.log(`[startGame] Aborted: gameState=${!!gameState}, localPlayerInfo=${!!localPlayerInfo}, isHost=${isHost}, isGameActive=${gameState?.isGameActive}, players=${gameState?.players?.length}`);
            return;
       }
       console.log(`[startGame] Host (${localPlayerInfo?.playerId}) starting game in room ${roomCode}...`);
       const { question, answer } = generateEquation();
        const resetPlayers = gameState.players.map(p => ({
           ...p,
           score: 0,
           hasAnswered: false,
           isCorrect: null,
           lastActive: serverTimestamp() // Update lastActive on game start
       }));
       const newState: Partial<GameState> = {
           question,
           answer,
           timeLeft: ROUND_DURATION,
           isGameActive: true,
           currentRound: 1,
           players: resetPlayers,
           roundStartTime: serverTimestamp(),
       };
       await updateFirestoreState(newState);
   }, [gameState, isHost, updateFirestoreState, roomCode, localPlayerInfo]);


   const nextQuestion = useCallback(async (triggeredByAllCorrect = false) => {
       if (!gameState || !localPlayerInfo || !isHost || !gameState.isGameActive || isRoundEnding) {
           console.log(`[nextQuestion] Aborted: gameState=${!!gameState}, localPlayerInfo=${!!localPlayerInfo}, isHost=${isHost}, isGameActive=${gameState?.isGameActive}, isRoundEnding=${isRoundEnding}`);
           return;
       }
       console.log(`[nextQuestion] Host (${localPlayerInfo?.playerId}) advancing to next question in room ${roomCode} (triggeredByAllCorrect: ${triggeredByAllCorrect})...`);

       if (roundEndTimeoutRef.current) {
           clearTimeout(roundEndTimeoutRef.current);
           roundEndTimeoutRef.current = null;
       }
       setIsRoundEnding(false);

       const { question, answer } = generateEquation();
       const nextRoundNumber = (gameState.currentRound || 0) + 1;
       const resetPlayers = gameState.players.map(p => ({
           ...p,
           hasAnswered: false,
           isCorrect: null,
           lastActive: serverTimestamp() // Update lastActive on new round
       }));
       const newState: Partial<GameState> = {
           question,
           answer,
           timeLeft: ROUND_DURATION,
           currentRound: nextRoundNumber,
           players: resetPlayers,
           roundStartTime: serverTimestamp(),
       };
       await updateFirestoreState(newState);
       setCurrentAnswer('');
       setIsRoundEnding(false);
   }, [gameState, isHost, updateFirestoreState, roomCode, localPlayerInfo, isRoundEnding]);


  const endRound = useCallback(async () => {
      if (!gameState || !localPlayerInfo || !isHost || isRoundEnding || !gameState.isGameActive) {
          console.log(`[endRound] Aborted: gameState=${!!gameState}, localPlayerInfo=${!!localPlayerInfo}, isHost=${isHost}, isRoundEnding=${isRoundEnding}, isGameActive=${gameState?.isGameActive}`);
          return;
      }
      console.log(`[endRound] Host (${localPlayerInfo?.playerId}) ending round ${gameState.currentRound} in room ${roomCode} - revealing results...`);
      setIsRoundEnding(true);

       const roomDocRef = doc(db, 'gameRooms', roomCode);
       try {
           const currentDoc = await getDoc(roomDocRef);
           if (!currentDoc.exists()) {
                console.error("[endRound] Room document disappeared before update.");
                setIsRoundEnding(false);
                return;
           }
           const currentState = currentDoc.data() as GameState;
            if (!currentState.isGameActive) {
                console.warn("[endRound] Game became inactive before update could be applied.");
                 setIsRoundEnding(false);
                return;
            }

           const updatedPlayers = currentState.players.map(p => ({
               ...p,
               isCorrect: p.hasAnswered ? p.isCorrect : false,
               lastActive: serverTimestamp() // Update lastActive
           }));
           const newState: Partial<GameState> = {
               players: updatedPlayers,
               timeLeft: 0,
           };
            console.log(`[endRound] Updating Firestore state for results display:`, newState);
           await updateFirestoreState(newState);

           if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
           console.log(`[endRound] Scheduling next question trigger in ${RESULTS_DISPLAY_DURATION}ms.`);
           roundEndTimeoutRef.current = setTimeout(() => {
               console.log(`[endRound] Results display timer finished for round ${currentState.currentRound}. Triggering next question.`);
               nextQuestion();
           }, RESULTS_DISPLAY_DURATION);

       } catch (error) {
            console.error(`[endRound] Error fetching or updating document during endRound for room ${roomCode}:`, error);
            setIsRoundEnding(false);
             toast({
                title: "Error Ending Round",
                description: "Could not finalize the round scores.",
                variant: "destructive"
            });
       }
  }, [gameState, isHost, isRoundEnding, updateFirestoreState, nextQuestion, roomCode, localPlayerInfo, toast]);


  useEffect(() => {
    if (!isHost || !gameState || !gameState.isGameActive || isRoundEnding || !gameState.roundStartTime) {
      return;
    }
    const checkTimeUp = () => {
        const timeLeftNow = calculateRoundTimeLeft();
        if (timeLeftNow <= 0) {
            console.log(`[TimerCheck] Host (${localPlayerInfo?.playerId}) detected time is up for round ${gameState.currentRound}. Ending round.`);
            endRound();
        }
    };
    const checkIntervalId = setInterval(checkTimeUp, 1000);
    return () => clearInterval(checkIntervalId);
  }, [isHost, gameState, isRoundEnding, endRound, calculateRoundTimeLeft, localPlayerInfo?.playerId]);

   useEffect(() => {
       if (!isHost || !gameState || !gameState.isGameActive || isRoundEnding || !gameState.players || gameState.players.length === 0) {
           return;
       }

       const allAnswered = gameState.players.every(p => p.hasAnswered);
       const allCorrect = allAnswered && gameState.players.every(p => p.isCorrect === true);

       if (allCorrect) {
           console.log(`[AllCorrectCheck] Host (${localPlayerInfo?.playerId}) detected all players answered correctly for round ${gameState.currentRound}. Advancing to next question.`);
           const advanceTimeout = setTimeout(() => {
               if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
               nextQuestion(true);
           }, 500);
           return () => clearTimeout(advanceTimeout);
       }
   }, [gameState?.players, isHost, gameState?.isGameActive, gameState?.currentRound, isRoundEnding, localPlayerInfo?.playerId, nextQuestion]);


  const handleJoinGame = async () => {
      const name = inputPlayerName.trim();
      if (!name) {
          toast({ title: "Please enter your name", variant: "destructive" });
          return;
      }
      if (!gameState || isLoading) {
          toast({ title: "Loading...", description: "Please wait for the game to load.", variant: "default" });
          return;
      }
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
          hasAnswered: false,
          isCorrect: null,
          lastActive: serverTimestamp() // Set lastActive on join
      };

      savePlayerInfo(playerId, name);
      setLocalPlayerInfo({ playerId, playerName: name });
      // Do not set isJoining to false here. Let the Firestore listener update handle it
      // This prevents race conditions where local state changes before Firestore confirms.

      const roomDocRef = doc(db, 'gameRooms', roomCode);
      try {
          console.log(`[handleJoinGame] Updating Firestore: Adding player ${JSON.stringify(newPlayer)} to room ${roomCode}`);
           await updateDoc(roomDocRef, {
              players: arrayUnion(newPlayer)
           });
          console.log(`[handleJoinGame] Successfully added player ${playerId} to Firestore room ${roomCode}`);
          toast({ title: `Welcome, ${name}!` });
          // isJoining will be set to false by the onSnapshot listener when the player appears in gameState.players
      } catch (error) {
          console.error(`[handleJoinGame] Error adding player ${playerId} to Firestore room ${roomCode}:`, error);
           clearPlayerInfo();
           setLocalPlayerInfo(null);
           // setIsJoining(true); // Keep isJoining true on error
          toast({
              title: "Error Joining Game",
              description: "Could not add you to the room. Please try again.",
              variant: "destructive",
          });
      }
  };

  const handleAnswerSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!localPlayerInfo || !gameState || !gameState.isGameActive || currentAnswer === '' || isRoundEnding || roundTimeLeft <= 0) {
           console.log(`[handleAnswerSubmit] Aborted: localPlayerInfo=${!!localPlayerInfo}, gameState=${!!gameState}, isGameActive=${gameState?.isGameActive}, currentAnswer=${currentAnswer}, isRoundEnding=${isRoundEnding}, roundTimeLeft=${roundTimeLeft}`);
           return;
      }

      const playerInState = gameState.players.find(p => p.id === localPlayerInfo.playerId);
      if (!playerInState || (playerInState.hasAnswered && playerInState.isCorrect === true)) {
           console.log(`[handleAnswerSubmit] Aborted: playerInState=${!!playerInState}, hasAnswered=${playerInState?.hasAnswered}, isCorrect=${playerInState?.isCorrect}`);
           return;
      }
      console.log(`[handleAnswerSubmit] Player ${localPlayerInfo.playerId} submitting answer: ${currentAnswer} for round ${gameState.currentRound}`);

      const submittedAnswer = parseInt(currentAnswer, 10);
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
      let scoreToAdd = 0;
      if (isAnswerCorrect && !(playerInState.hasAnswered && playerInState.isCorrect === true)) {
            const startTimeMillis = gameState.roundStartTime instanceof Timestamp
                  ? gameState.roundStartTime.toMillis()
                  : typeof gameState.roundStartTime === 'number'
                  ? gameState.roundStartTime
                  : Date.now();
            const timeElapsed = Math.floor((Date.now() - startTimeMillis) / 1000);
            const timeTaken = Math.min(ROUND_DURATION, Math.max(0, timeElapsed));
            scoreToAdd = Math.max(5, (ROUND_DURATION - timeTaken) * 2 + 10);
            console.log(`[handleAnswerSubmit] Player ${localPlayerInfo.playerId} - Correct! ScoreToAdd: ${scoreToAdd}, TimeTaken: ${timeTaken}s`);
      } else if (!isAnswerCorrect) {
          console.log(`[handleAnswerSubmit] Player ${localPlayerInfo.playerId} - Incorrect.`);
      } else {
          console.log(`[handleAnswerSubmit] Player ${localPlayerInfo.playerId} - Already answered correctly.`);
      }

      toast({
        title: isAnswerCorrect ? 'Correct!' : 'Incorrect',
        description: isAnswerCorrect ? `+${scoreToAdd} points!` : `Try again!`,
        variant: isAnswerCorrect ? 'default' : 'destructive',
        className: isAnswerCorrect ? 'bg-accent text-accent-foreground border-accent' : '',
        duration: isAnswerCorrect ? 2000 : 1500,
      });

       const roomDocRef = doc(db, 'gameRooms', roomCode);
       try {
             const currentDoc = await getDoc(roomDocRef);
             if (!currentDoc.exists()) throw new Error("Room document not found during answer submit");
             const currentPlayers = (currentDoc.data() as GameState)?.players;
             if (!Array.isArray(currentPlayers)) {
                 throw new Error("Players data is missing or not an array in Firestore during answer submit");
             }
              const updatedPlayers = currentPlayers.map(p =>
                 p.id === localPlayerInfo.playerId
                 ? {
                     ...p,
                     score: (p.score ?? 0) + scoreToAdd,
                     hasAnswered: true,
                     isCorrect: isAnswerCorrect,
                     lastActive: serverTimestamp() // Update lastActive on answer
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
            return;
       }

      if (isAnswerCorrect) {
          setCurrentAnswer('');
      }
  };

  const handleLeaveGame = useCallback(async () => {
    if (!localPlayerInfo || !gameState || !roomCode) {
        console.warn("[handleLeaveGame] Aborted: Missing localPlayerInfo, gameState, or roomCode.");
        clearPlayerInfo();
        router.push('/');
        return;
    }

    console.log(`[handleLeaveGame] Player ${localPlayerInfo.playerId} attempting to leave room ${roomCode}. isHost=${isHost}`);

    // Clear local timers/listeners immediately
    if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
    }
    if (roundEndTimeoutRef.current) {
        clearTimeout(roundEndTimeoutRef.current);
        roundEndTimeoutRef.current = null;
    }
    if (inactivityCleanupIntervalRef.current) {
        clearInterval(inactivityCleanupIntervalRef.current);
        inactivityCleanupIntervalRef.current = null;
    }

    const leavingPlayerId = localPlayerInfo.playerId;
    const roomDocRef = doc(db, 'gameRooms', roomCode);

    // Clear local session info *before* async operations
    const localPlayerNameForToast = localPlayerInfo.playerName; // Capture for toast
    clearPlayerInfo();
    setLocalPlayerInfo(null);

    try {
        await runTransaction(db, async (transaction) => {
            const currentDoc = await transaction.get(roomDocRef);
            if (!currentDoc.exists()) {
                console.warn(`[handleLeaveGame Tran] Room ${roomCode} already deleted or not found.`);
                return; // Exit transaction if room doesn't exist
            }

            const currentState = currentDoc.data() as GameState;
            if (!Array.isArray(currentState?.players)) {
                console.warn(`[handleLeaveGame Tran] Players data missing or invalid in room ${roomCode}.`);
                return; // Exit if player data is bad
            }

            const leavingPlayerInFirestore = currentState.players.find(p => p.id === leavingPlayerId);
            if (!leavingPlayerInFirestore) {
                console.warn(`[handleLeaveGame Tran] Player ${leavingPlayerId} not found in Firestore state for room ${roomCode}.`);
                return; // Player already removed or never fully joined
            }

            const remainingPlayers = currentState.players.filter(p => p.id !== leavingPlayerId);
            const wasHostInFirestore = leavingPlayerInFirestore.isHost;

            if (remainingPlayers.length === 0) {
                console.log(`[handleLeaveGame Tran] Last player (${leavingPlayerId}) leaving. Deleting room ${roomCode}.`);
                transaction.delete(roomDocRef);
            } else {
                let playersToUpdate = [...remainingPlayers];
                if (wasHostInFirestore) {
                    // Host leaving, assign new host if not already assigned
                    const currentHost = playersToUpdate.find(p => p.isHost);
                    if (!currentHost && playersToUpdate.length > 0) {
                        console.log(`[handleLeaveGame Tran] Host (${leavingPlayerId}) leaving. Assigning new host: ${playersToUpdate[0].id} (${playersToUpdate[0].name}).`);
                        playersToUpdate = playersToUpdate.map((p, index) =>
                            index === 0 ? { ...p, isHost: true, lastActive: serverTimestamp() } : { ...p, lastActive: serverTimestamp() }
                        );
                    } else {
                        // Update lastActive for remaining players
                        playersToUpdate = playersToUpdate.map(p => ({ ...p, lastActive: serverTimestamp()}));
                    }
                } else {
                     // Non-host leaving, just update lastActive for remaining players
                    playersToUpdate = playersToUpdate.map(p => ({ ...p, lastActive: serverTimestamp()}));
                }
                transaction.update(roomDocRef, { players: playersToUpdate });
            }
        });
        console.log(`[handleLeaveGame] Firestore transaction successful for player ${leavingPlayerId} leaving.`);
        toast({ title: `You left the room.` });
    } catch (error) {
        console.error(`[handleLeaveGame] Error in transaction for player ${leavingPlayerId} or deleting room ${roomCode} from Firestore:`, error);
        toast({
            title: 'Error Leaving Room',
            description: 'Could not update the room status. You have been removed locally.',
            variant: 'destructive',
        });
    } finally {
        router.push('/'); // Always navigate home
    }
  }, [localPlayerInfo, gameState, roomCode, isHost, router, toast]); // isHost is fine here as it's derived from localPlayerInfo + gameState


   const handleCopyLink = () => {
    const link = window.location.href.split('?')[0];
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

  useEffect(() => {
    if (
      gameState?.isGameActive &&
      !isRoundEnding &&
      roundTimeLeft > 0 &&
      !isPlayerCorrect &&
      answerInputRef.current
    ) {
      const focusTimer = setTimeout(() => {
         answerInputRef.current?.focus();
         console.log("[FocusInput] Attempted to focus answer input.");
      }, 50);
      return () => clearTimeout(focusTimer);
    }
  }, [gameState?.isGameActive, gameState?.currentRound, isRoundEnding, roundTimeLeft, isPlayerCorrect]);


  // Host: Inactivity Cleanup Logic
  useEffect(() => {
    if (!isHost || !db || !roomCode) {
        if (inactivityCleanupIntervalRef.current) {
            clearInterval(inactivityCleanupIntervalRef.current);
            inactivityCleanupIntervalRef.current = null;
        }
        return;
    }

    console.log(`[Host Cleanup] Setting up inactivity cleanup interval for room ${roomCode}. Interval: ${INACTIVITY_CLEANUP_INTERVAL}ms, Timeout: ${PLAYER_INACTIVITY_TIMEOUT}ms`);

    const cleanupInactivePlayers = async () => {
        console.log(`[Host Cleanup] Running cleanup for room ${roomCode} at ${new Date().toISOString()}`);
        const roomDocRef = doc(db, 'gameRooms', roomCode);

        try {
            await runTransaction(db, async (transaction) => {
                const currentDoc = await transaction.get(roomDocRef);
                if (!currentDoc.exists()) {
                    console.warn(`[Host Cleanup Tran] Room ${roomCode} not found during cleanup transaction. Stopping interval.`);
                    if (inactivityCleanupIntervalRef.current) clearInterval(inactivityCleanupIntervalRef.current);
                    return;
                }

                const currentState = currentDoc.data() as GameState;
                if (!Array.isArray(currentState?.players) || currentState.players.length === 0) {
                    console.log(`[Host Cleanup Tran] No players in room ${roomCode} or invalid player data.`);
                    // If no players and room still exists, and game is not active, maybe delete room?
                    if (!currentState.isGameActive && currentState.players.length === 0) {
                        console.log(`[Host Cleanup Tran] Room ${roomCode} is empty and game not active. Deleting room.`);
                        transaction.delete(roomDocRef);
                    }
                    return;
                }

                const now = Date.now();
                const activePlayers: Player[] = [];
                let wasHostRemoved = false;
                let removedPlayerCount = 0;

                currentState.players.forEach(player => {
                    const lastActiveTime = player.lastActive instanceof Timestamp ? player.lastActive.toMillis() : 0;
                    if ((now - lastActiveTime) < PLAYER_INACTIVITY_TIMEOUT) {
                        activePlayers.push(player);
                    } else {
                        console.log(`[Host Cleanup Tran] Player ${player.name} (${player.id}) in room ${roomCode} is inactive. Last active: ${new Date(lastActiveTime).toISOString()}. Removing.`);
                        if (player.isHost) {
                            wasHostRemoved = true;
                        }
                        removedPlayerCount++;
                    }
                });

                if (removedPlayerCount === 0 && !currentState.isGameActive && currentState.players.length === 0) {
                     // This case is for when a game was never started and the last player left normally,
                     // but somehow the room still exists. The interval might keep running.
                     console.log(`[Host Cleanup Tran] Room ${roomCode} is empty (potentially from normal leave), game not active. Deleting room.`);
                     transaction.delete(roomDocRef);
                     if (inactivityCleanupIntervalRef.current) clearInterval(inactivityCleanupIntervalRef.current);
                     return;
                }


                if (removedPlayerCount > 0) {
                    if (activePlayers.length === 0) {
                        console.log(`[Host Cleanup Tran] All players in room ${roomCode} became inactive. Deleting room.`);
                        transaction.delete(roomDocRef);
                        if (inactivityCleanupIntervalRef.current) clearInterval(inactivityCleanupIntervalRef.current); // Stop interval as room is gone
                    } else {
                        let newPlayersArray = [...activePlayers];
                        if (wasHostRemoved) {
                            // If host was removed, assign a new host from the remaining active players
                            const currentActiveHost = newPlayersArray.find(p => p.isHost);
                            if (!currentActiveHost && newPlayersArray.length > 0) {
                                console.log(`[Host Cleanup Tran] Original host removed due to inactivity in room ${roomCode}. Assigning new host: ${newPlayersArray[0].name} (${newPlayersArray[0].id}).`);
                                newPlayersArray[0] = { ...newPlayersArray[0], isHost: true, lastActive: serverTimestamp() };
                                // Ensure other players are not hosts and update their lastActive
                                for (let i = 1; i < newPlayersArray.length; i++) {
                                    newPlayersArray[i] = { ...newPlayersArray[i], isHost: false, lastActive: serverTimestamp() };
                                }
                            }
                        } else {
                            // Update lastActive for all remaining players if no host change
                            newPlayersArray = newPlayersArray.map(p => ({...p, lastActive: serverTimestamp()}));
                        }
                        console.log(`[Host Cleanup Tran] Updating players in room ${roomCode} after removing ${removedPlayerCount} inactive player(s). New player count: ${newPlayersArray.length}`);
                        transaction.update(roomDocRef, { players: newPlayersArray });
                    }
                } else if (activePlayers.length === 0 && currentState.players.length > 0) {
                    // This edge case: if all players were in currentState.players, but activePlayers is empty
                    // (meaning all timed out simultaneously), delete the room.
                     console.log(`[Host Cleanup Tran] All players in room ${roomCode} appear to have timed out simultaneously. Deleting room.`);
                     transaction.delete(roomDocRef);
                     if (inactivityCleanupIntervalRef.current) clearInterval(inactivityCleanupIntervalRef.current);
                }
                 else {
                    console.log(`[Host Cleanup Tran] No inactive players found in room ${roomCode}.`);
                }
            });
        } catch (error) {
            console.error(`[Host Cleanup] Error during inactivity cleanup transaction for room ${roomCode}:`, error);
        }
    };

    // Clear any existing interval before setting a new one
    if (inactivityCleanupIntervalRef.current) {
        clearInterval(inactivityCleanupIntervalRef.current);
    }
    inactivityCleanupIntervalRef.current = setInterval(cleanupInactivePlayers, INACTIVITY_CLEANUP_INTERVAL);

    // Cleanup interval on component unmount or if host status changes
    return () => {
        if (inactivityCleanupIntervalRef.current) {
            console.log(`[Host Cleanup] Clearing inactivity cleanup interval for room ${roomCode}.`);
            clearInterval(inactivityCleanupIntervalRef.current);
            inactivityCleanupIntervalRef.current = null;
        }
    };
  }, [isHost, db, roomCode]); // Dependencies for setting up/tearing down the interval


  // Player: Update lastActive timestamp periodically
  useEffect(() => {
    if (!isHost && localPlayerInfo && gameState && gameState.players.some(p => p.id === localPlayerInfo.playerId)) {
        const updateInterval = setInterval(async () => {
            if (!db || !roomCode || !localPlayerInfo?.playerId) return;
            const roomDocRef = doc(db, 'gameRooms', roomCode);
            try {
                // Fetch current players to update only this player's lastActive
                const currentDoc = await getDoc(roomDocRef);
                if (currentDoc.exists()) {
                    const currentPlayers = (currentDoc.data() as GameState)?.players || [];
                    const playerIndex = currentPlayers.findIndex(p => p.id === localPlayerInfo.playerId);

                    if (playerIndex !== -1) {
                        const updatedPlayers = [...currentPlayers];
                        updatedPlayers[playerIndex] = { ...updatedPlayers[playerIndex], lastActive: serverTimestamp() };
                        await updateDoc(roomDocRef, { players: updatedPlayers });
                        // console.log(`[Player Activity] Player ${localPlayerInfo.playerId} updated lastActive in room ${roomCode}.`);
                    } else {
                        // console.warn(`[Player Activity] Player ${localPlayerInfo.playerId} not found in room ${roomCode} for activity update.`);
                    }
                }
            } catch (error) {
                console.error(`[Player Activity] Error updating lastActive for player ${localPlayerInfo.playerId} in room ${roomCode}:`, error);
            }
        }, PLAYER_INACTIVITY_TIMEOUT / 2); // Update more frequently than the timeout

        return () => clearInterval(updateInterval);
    }
  }, [isHost, localPlayerInfo, gameState, roomCode, db]);



  if (isLoading) {
      return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /> <span className="ml-2">Loading Room...</span></div>;
  }

  if (isJoining || !localPlayerInfo || (gameState && !gameState.players.some(p => p.id === localPlayerInfo?.playerId))) {
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
             id="playerNameInput"
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

  if (!gameState && localPlayerInfo) {
     console.error("Render error: Game state missing but player info exists after loading/joining phase.");
     useEffect(() => {
        const timer = setTimeout(() => {
           console.log("Redirecting home due to missing game state.");
            clearPlayerInfo();
           router.push('/');
        }, 3000);
        return () => clearTimeout(timer);
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

  if (!gameState || !localPlayerInfo) {
      console.error("Critical Render Error: Game state or local player info is unexpectedly null/undefined.");
       useEffect(() => {
          const timer = setTimeout(() => {
             console.log("Redirecting home due to critical render state error.");
              clearPlayerInfo();
             router.push('/');
          }, 3000);
          return () => clearTimeout(timer);
       }, [router]);
      return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-destructive" /> <span className="ml-2 text-destructive">Critical Error - Redirecting...</span></div>;
  }

  return (
    <div className="flex flex-col h-screen max-h-screen w-full max-w-md bg-secondary">
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
                    <span>{gameState.isGameActive && !isRoundEnding && gameState.roundStartTime ? `${roundTimeLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1" title="Players Online">
                   <Users className="h-4 w-4" />
                   <span>{gameState.players?.length ?? 0}</span>
                </div>
             </div>
             {gameState.isGameActive && !isRoundEnding && roundTimeLeft > 0 && gameState.roundStartTime && (
                <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-2 mt-2" aria-label={`Time left: ${roundTimeLeft} seconds`} />
             )}
         </CardHeader>
        </Card>

       <div className="flex-shrink-0 m-2 mt-0">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="outline" size="sm" className="w-full mb-1" aria-expanded={showScoreboard}>
               {showScoreboard ? 'Hide Scores' : 'Show Scores'} ({sortedPlayers.length} Player{sortedPlayers.length === 1 ? '' : 's'})
           </Button>
           {showScoreboard && (
              <Card className="shadow rounded-lg">
                 <CardContent className="p-0">
                    <ScrollArea className={`p-2 ${gameState.isGameActive ? 'h-[100px]' : 'h-[180px]'}`} aria-label="Scoreboard">
                    {sortedPlayers.length > 0 ? sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1.5 rounded ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 font-semibold' : ''} text-sm mb-1`}>
                          <div className="flex items-center gap-2 overflow-hidden min-w-0">
                              <span className="font-normal w-5 text-right text-muted-foreground flex-shrink-0">{index + 1}.</span>
                              <Avatar className="h-6 w-6 flex-shrink-0">
                                <AvatarImage src={`https://avatar.vercel.sh/${encodeURIComponent(player.name)}.png?size=24`} alt={player.name} />
                                <AvatarFallback>{player.name.substring(0, 1).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              <span className="truncate flex-1 min-w-0">{player.name ?? 'Loading...'} {player.isHost ? <span className="text-xs text-primary/80">(Host)</span> : ''}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                {(gameState.isGameActive || isRoundEnding) && player.hasAnswered !== undefined && (
                                     player.hasAnswered ? (
                                         (isRoundEnding || (roundTimeLeft <= 0 && gameState.roundStartTime) || player.isCorrect === true) ? (
                                             player.isCorrect === true ?
                                                <CheckCircle className="h-4 w-4 text-accent flex-shrink-0" title="Correct"/> :
                                                player.isCorrect === false ?
                                                <XCircle className="h-4 w-4 text-destructive flex-shrink-0" title="Incorrect"/> :
                                                <XCircle className="h-4 w-4 text-muted-foreground opacity-60 flex-shrink-0" title="Result Pending/Error" />
                                         ) : (
                                             <Clock className="h-4 w-4 text-muted-foreground animate-pulse flex-shrink-0" title="Answered (Incorrect - Retrying)" />
                                         )
                                     ) : (
                                         (isRoundEnding || (roundTimeLeft <= 0 && gameState.roundStartTime)) ?
                                            <XCircle className="h-4 w-4 text-muted-foreground opacity-50 flex-shrink-0" title="Did not answer"/> :
                                            null
                                     )
                                )}
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

        {/* Ad Banner - Smaller for game screen */}
        <AdBanner className="mx-2 my-1" style={{minHeight: '50px'}} />


        <div className="flex-grow flex flex-col justify-center items-center p-4 space-y-4 m-2 mt-0">
            {gameState.isGameActive ? (
                <>
                    <Card className="w-full bg-card shadow-lg text-center p-6">
                        <CardDescription className="mb-2">Question {gameState.currentRound}</CardDescription>
                        <CardTitle className="text-4xl font-mono tracking-wider">
                           {(isRoundEnding || (roundTimeLeft <= 0 && gameState.roundStartTime)) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-2">
                        <Input
                            ref={answerInputRef}
                            type="number"
                            inputMode="numeric"
                            pattern="[0-9-]*"
                            placeholder="Your Answer"
                            value={currentAnswer}
                            onChange={(e) => setCurrentAnswer(e.target.value.replace(/[^0-9-]/g, ''))}
                            className="text-center text-2xl h-14"
                            disabled={isPlayerCorrect || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
                            aria-label="Enter your answer"
                            aria-disabled={isPlayerCorrect || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
                        />
                        <Button
                            type="submit"
                            className="w-full text-lg py-3"
                            disabled={isPlayerCorrect || currentAnswer === '' || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
                            aria-disabled={isPlayerCorrect || currentAnswer === '' || (roundTimeLeft <= 0 && gameState.roundStartTime) || isRoundEnding}
                         >
                            {isPlayerCorrect ? 'Correct!' : (hasPlayerAnswered ? 'Submit Again' : 'Submit Answer')}
                         </Button>
                    </form>
                     {isRoundEnding && (
                        <p className="text-center text-muted-foreground animate-pulse">Revealing results... Next round soon!</p>
                     )}
                     {isPlayerCorrect && !isRoundEnding && roundTimeLeft > 0 && (
                         <p className="text-center text-accent font-medium">Correct! Waiting for others...</p>
                     )}
                     {hasPlayerAnswered && !isPlayerCorrect && !isRoundEnding && roundTimeLeft > 0 && (
                         <p className="text-center text-destructive">Incorrect. Keep trying!</p>
                     )}
                     {!isPlayerCorrect && roundTimeLeft <= 0 && gameState.roundStartTime && !isRoundEnding && (
                         <p className="text-center text-destructive font-medium">Time's up! Answer was: {gameState.answer}</p>
                     )}
                </>
            ) : (
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
