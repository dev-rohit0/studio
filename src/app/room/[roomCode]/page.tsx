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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, ClipboardCopy, Users, Share2, Clock, LogOut, Loader2, Plus, Trash2, BrainCircuit } from 'lucide-react';
import { getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, getDoc, serverTimestamp, Timestamp, runTransaction } from 'firebase/firestore';
import type { Player, GameState, CustomQuestion } from '@/types/game';
import AdBanner from '@/components/ads/AdBanner';

const ROUND_DURATION = 30;
const RESULTS_DISPLAY_DURATION = 3000;
const INACTIVITY_CLEANUP_INTERVAL = 30000;
const PLAYER_INACTIVITY_TIMEOUT = 60000;

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
  
  // Custom question form state
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');

  const roundEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);
  const inactivityCleanupIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const generateEquation = (): { question: string; answer: number } => {
    const operations = ['+', '-', '*', '/'];
    const op = operations[Math.floor(Math.random() * operations.length)];
    let question = '';
    let answer = 0;

    switch (op) {
      case '+':
        // Hard Addition: 4-digit + 4-digit
        const a1 = Math.floor(Math.random() * 9000) + 1000;
        const a2 = Math.floor(Math.random() * 9000) + 1000;
        question = `${a1} + ${a2}`;
        answer = a1 + a2;
        break;
      case '-':
        // Hard Subtraction: 5-digit - 4-digit
        const s1 = Math.floor(Math.random() * 90000) + 10000;
        const s2 = Math.floor(Math.random() * 9000) + 1000;
        question = `${s1} - ${s2}`;
        answer = s1 - s2;
        break;
      case '*':
        // Hard Multiplication: 3-digit * 2-digit
        const m1 = Math.floor(Math.random() * 900) + 100;
        const m2 = Math.floor(Math.random() * 90) + 10;
        question = `${m1} × ${m2}`;
        answer = m1 * m2;
        break;
      case '/':
        // Hard Division: 4 or 5 digit result from division
        const divisor = Math.floor(Math.random() * 89) + 10; // 10-98
        const quotient = Math.floor(Math.random() * 900) + 100; // 100-999
        const dividend = divisor * quotient;
        question = `${dividend} ÷ ${divisor}`;
        answer = quotient;
        break;
    }
    return { question, answer };
  };

  const updateFirestoreState = useCallback(async (updates: Partial<GameState>) => {
      if (!roomCode || !db) return;
      const roomDocRef = doc(db, 'gameRooms', roomCode);
      try {
          await updateDoc(roomDocRef, updates);
      } catch (error) {
          console.error(`[updateFirestoreState] Error updating Firestore:`, error);
      }
  }, [roomCode]);

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
    if (!roomCode || !db) return;

    const savedPlayerInfo = getPlayerInfo();
    if (!localPlayerInfo && savedPlayerInfo) {
      setLocalPlayerInfo(savedPlayerInfo);
      setIsJoining(false);
    }

    const roomDocRef = doc(db, 'gameRooms', roomCode);

    unsubscribeRef.current = onSnapshot(roomDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data() as GameState;
            setGameState({ ...data, roomCode });
            setIsLoading(false);

            const pInfo = getPlayerInfo();
            if (pInfo && data.players?.some(p => p.id === pInfo.playerId)) {
                setIsJoining(false);
            } else {
                setIsJoining(true);
            }
        } else {
            clearPlayerInfo();
            router.push('/');
        }
    }, (error) => {
        console.error(`[onSnapshot] Error:`, error);
        setIsLoading(false);
    });

    return () => {
        if (unsubscribeRef.current) unsubscribeRef.current();
        if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
    };
  }, [roomCode, router, localPlayerInfo]);

  const handleAddCustomQuestion = async () => {
    if (!newQ.trim() || !newA.trim() || !gameState) return;
    const ansNum = parseInt(newA, 10);
    if (isNaN(ansNum)) return;

    const updatedQuestions = [...(gameState.customQuestions || []), { question: newQ, answer: ansNum }];
    await updateFirestoreState({ customQuestions: updatedQuestions });
    setNewQ('');
    setNewA('');
  };

  const handleRemoveCustomQuestion = async (index: number) => {
    if (!gameState?.customQuestions) return;
    const updatedQuestions = gameState.customQuestions.filter((_, i) => i !== index);
    await updateFirestoreState({ customQuestions: updatedQuestions });
  };

  const startGame = useCallback(async () => {
    if (!gameState || !isHost || gameState.isGameActive) return;

    let nextQ: string;
    let nextA: number;
    let nextIdx = 0;

    if (gameState.customQuestions && gameState.customQuestions.length > 0) {
      nextQ = gameState.customQuestions[0].question;
      nextA = gameState.customQuestions[0].answer;
      nextIdx = 1;
    } else {
      const generated = generateEquation();
      nextQ = generated.question;
      nextA = generated.answer;
    }

    const resetPlayers = gameState.players.map(p => ({
        ...p,
        score: 0,
        hasAnswered: false,
        isCorrect: null,
        lastActive: serverTimestamp()
    }));

    await updateFirestoreState({
        question: nextQ,
        answer: nextA,
        timeLeft: ROUND_DURATION,
        isGameActive: true,
        currentRound: 1,
        players: resetPlayers,
        roundStartTime: serverTimestamp(),
        currentQuestionIndex: nextIdx
    });
  }, [gameState, isHost, updateFirestoreState]);

  const nextQuestion = useCallback(async () => {
    if (!gameState || !isHost || !gameState.isGameActive || isRoundEnding) return;

    setIsRoundEnding(false);
    if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);

    let nextQ: string;
    let nextA: number;
    let nextIdx = gameState.currentQuestionIndex ?? 0;

    if (gameState.customQuestions && nextIdx < gameState.customQuestions.length) {
      nextQ = gameState.customQuestions[nextIdx].question;
      nextA = gameState.customQuestions[nextIdx].answer;
      nextIdx++;
    } else {
      const generated = generateEquation();
      nextQ = generated.question;
      nextA = generated.answer;
    }

    const resetPlayers = gameState.players.map(p => ({
        ...p,
        hasAnswered: false,
        isCorrect: null,
        lastActive: serverTimestamp()
    }));

    await updateFirestoreState({
        question: nextQ,
        answer: nextA,
        timeLeft: ROUND_DURATION,
        currentRound: (gameState.currentRound || 0) + 1,
        players: resetPlayers,
        roundStartTime: serverTimestamp(),
        currentQuestionIndex: nextIdx
    });
    setCurrentAnswer('');
    setIsRoundEnding(false);
  }, [gameState, isHost, isRoundEnding, updateFirestoreState]);

  const endRound = useCallback(async () => {
    if (!gameState || !isHost || isRoundEnding || !gameState.isGameActive) return;
    setIsRoundEnding(true);

    const updatedPlayers = gameState.players.map(p => ({
        ...p,
        isCorrect: p.hasAnswered ? p.isCorrect : false,
        lastActive: serverTimestamp()
    }));

    await updateFirestoreState({
        players: updatedPlayers,
        timeLeft: 0,
    });

    roundEndTimeoutRef.current = setTimeout(() => {
        nextQuestion();
    }, RESULTS_DISPLAY_DURATION);
  }, [gameState, isHost, isRoundEnding, updateFirestoreState, nextQuestion]);

  useEffect(() => {
    if (!isHost || !gameState?.isGameActive || isRoundEnding || !gameState.roundStartTime) return;
    const interval = setInterval(() => {
        if (calculateRoundTimeLeft() <= 0) {
            endRound();
        }
    }, 1000);
    return () => clearInterval(interval);
  }, [isHost, gameState, isRoundEnding, endRound, calculateRoundTimeLeft]);

  useEffect(() => {
    if (!isHost || !gameState?.isGameActive || isRoundEnding || !gameState.players) return;
    const allAnswered = gameState.players.every(p => p.hasAnswered);
    const allCorrect = allAnswered && gameState.players.every(p => p.isCorrect === true);

    if (allCorrect) {
        if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
        const advanceTimeout = setTimeout(() => nextQuestion(), 800);
        return () => clearTimeout(advanceTimeout);
    } else if (allAnswered) {
        if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
        endRound();
    }
  }, [gameState?.players, isHost, gameState?.isGameActive, isRoundEnding, nextQuestion, endRound]);

  const handleJoinGame = async () => {
      const name = inputPlayerName.trim();
      if (!name || !db) return;
      const playerId = generateId();
      const shouldBeHost = isInitiallyHost && (gameState?.players?.length ?? 0) === 0;

      const newPlayer: Player = {
          id: playerId,
          name: name,
          score: 0,
          isHost: shouldBeHost,
          hasAnswered: false,
          isCorrect: null,
          lastActive: Timestamp.now()
      };

      savePlayerInfo(playerId, name);
      setLocalPlayerInfo({ playerId, playerName: name });

      const roomDocRef = doc(db, 'gameRooms', roomCode);
      try {
          await updateDoc(roomDocRef, { players: arrayUnion(newPlayer) });
          toast({ title: `Welcome, ${name}!` });
      } catch (error) {
          console.error(error);
          toast({ title: "Error Joining Game", variant: "destructive" });
      }
  };

  const handleAnswerSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!localPlayerInfo || !gameState?.isGameActive || currentAnswer === '' || isRoundEnding || roundTimeLeft <= 0 || !db) return;

      const playerInState = gameState.players.find(p => p.id === localPlayerInfo.playerId);
      if (!playerInState || (playerInState.hasAnswered && playerInState.isCorrect)) return;

      const submittedAnswer = parseInt(currentAnswer, 10);
      const isAnswerCorrect = submittedAnswer === gameState.answer;
      let scoreToAdd = 0;

      if (isAnswerCorrect) {
            const startTimeMillis = gameState.roundStartTime instanceof Timestamp ? gameState.roundStartTime.toMillis() : Date.now();
            const timeElapsed = Math.floor((Date.now() - startTimeMillis) / 1000);
            scoreToAdd = Math.max(5, (ROUND_DURATION - timeElapsed) * 2 + 10);
      }

      toast({
        title: isAnswerCorrect ? 'Correct!' : 'Incorrect',
        variant: isAnswerCorrect ? 'default' : 'destructive',
        duration: 1500,
      });

       const roomDocRef = doc(db, 'gameRooms', roomCode);
       try {
              const updatedPlayers = gameState.players.map(p => {
                 if (p.id === localPlayerInfo.playerId) {
                    return {
                       ...p,
                       score: (p.score ?? 0) + scoreToAdd,
                       hasAnswered: true,
                       isCorrect: isAnswerCorrect,
                       lastActive: serverTimestamp()
                      };
                 }
                 return p;
              });
              await updateDoc(roomDocRef, { players: updatedPlayers });
       } catch (error) {
            console.error(error);
       }

      if (isAnswerCorrect) setCurrentAnswer('');
  };

  const handleLeaveGame = useCallback(async () => {
    if (!localPlayerInfo || !roomCode || !db) return;
    const leavingPlayerId = localPlayerInfo.playerId;
    const roomDocRef = doc(db, 'gameRooms', roomCode);

    clearPlayerInfo();
    setLocalPlayerInfo(null);

    try {
        await runTransaction(db, async (transaction) => {
            const docSnap = await transaction.get(roomDocRef);
            if (!docSnap.exists()) return;
            const data = docSnap.data() as GameState;
            const remainingPlayers = data.players.filter(p => p.id !== leavingPlayerId);

            if (remainingPlayers.length === 0) {
                transaction.delete(roomDocRef);
            } else {
                let playersToUpdate = remainingPlayers;
                const wasHost = data.players.find(p => p.id === leavingPlayerId)?.isHost;
                if (wasHost && !playersToUpdate.some(p => p.isHost)) {
                    playersToUpdate = playersToUpdate.map((p, i) => i === 0 ? { ...p, isHost: true } : p);
                }
                transaction.update(roomDocRef, { players: playersToUpdate });
            }
        });
    } catch (e) { console.error(e); }
    router.push('/');
  }, [localPlayerInfo, roomCode, router]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href.split('?')[0]);
    toast({ title: 'Link Copied!' });
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-primary" /></div>;

  if (isJoining || !localPlayerInfo || !gameState?.players.some(p => p.id === localPlayerInfo?.playerId)) {
    return (
      <Card className="w-full max-w-md shadow-lg m-auto">
        <CardHeader>
          <CardTitle className="text-center">Join Room: {roomCode}</CardTitle>
          <CardDescription className="text-center">Enter your name to join the challenge</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Input placeholder="Your Name" value={inputPlayerName} onChange={(e) => setInputPlayerName(e.target.value)} maxLength={15} onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()} />
           <Button onClick={handleJoinGame} className="w-full" disabled={!inputPlayerName.trim() || (gameState?.players.length ?? 0) >= 10}>Join Game</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-screen max-h-screen w-full max-w-md bg-secondary">
        <Card className="m-2 shadow rounded-lg flex-shrink-0">
         <CardHeader className="p-3">
             <div className="flex justify-between items-center mb-2">
                 <CardTitle className="text-xl flex items-center gap-1">
                     <BrainCircuit className="text-primary h-5 w-5" />
                     Math Mania
                 </CardTitle>
                 <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(roomCode)}>
                       <ClipboardCopy className="h-4 w-4 mr-1"/> {roomCode}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleCopyLink}>
                       <Share2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleLeaveGame} className="text-destructive">
                       <LogOut className="h-4 w-4" />
                    </Button>
                 </div>
             </div>
             <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Round: {gameState.currentRound > 0 ? gameState.currentRound : '-'}</span>
                <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{gameState.isGameActive && !isRoundEnding ? `${roundTimeLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1">
                   <Users className="h-4 w-4" />
                   <span>{gameState.players?.length ?? 0}</span>
                </div>
             </div>
             {gameState.isGameActive && !isRoundEnding && roundTimeLeft > 0 && (
                <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-2 mt-2" />
             )}
         </CardHeader>
        </Card>

        <div className="flex-shrink-0 m-2 mt-0">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="outline" size="sm" className="w-full mb-1">
               {showScoreboard ? 'Hide Scores' : 'Show Scores'}
           </Button>
           {showScoreboard && (
              <Card className="shadow rounded-lg">
                 <CardContent className="p-0">
                    <ScrollArea className={`p-2 ${gameState.isGameActive ? 'h-[100px]' : 'h-[180px]'}`}>
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1.5 rounded ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 font-semibold' : ''} text-sm mb-1`}>
                          <div className="flex items-center gap-2">
                              <span className="w-5 text-right text-muted-foreground">{index + 1}.</span>
                              <Avatar className="h-6 w-6">
                                <AvatarImage src={`https://picsum.photos/seed/${player.id}/24/24`} />
                                <AvatarFallback>{player.name[0]}</AvatarFallback>
                              </Avatar>
                              <span className="truncate max-w-[120px]">{player.name} {player.isHost && '👑'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                                {gameState.isGameActive && player.hasAnswered && (
                                     player.isCorrect === true ? <CheckCircle className="h-4 w-4 text-accent" /> : <XCircle className="h-4 w-4 text-destructive" />
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

        <div className="flex-grow flex flex-col justify-center items-center p-4 space-y-4 m-2 mt-0">
            {gameState.isGameActive ? (
                <>
                    <Card className="w-full bg-card shadow-lg text-center p-6">
                        <CardDescription className="mb-2">Question {gameState.currentRound}</CardDescription>
                        <CardTitle className="text-3xl font-mono">
                           {(isRoundEnding || isPlayerCorrect) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-2">
                        <Input ref={answerInputRef} type="number" placeholder="Your Answer" value={currentAnswer} onChange={(e) => setCurrentAnswer(e.target.value)} className="text-center text-2xl h-14" disabled={isPlayerCorrect || isRoundEnding} />
                        <Button type="submit" className="w-full text-lg py-3" disabled={isPlayerCorrect || currentAnswer === '' || isRoundEnding}>
                            {isPlayerCorrect ? 'Correct!' : (hasPlayerAnswered ? 'Submit Again' : 'Submit Answer')}
                         </Button>
                    </form>
                </>
            ) : (
                 <Card className="w-full bg-card shadow-lg p-4">
                    {isHost ? (
                        <Tabs defaultValue="lobby" className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="lobby">Lobby</TabsTrigger>
                                <TabsTrigger value="custom">Custom Pool</TabsTrigger>
                            </TabsList>
                            <TabsContent value="lobby" className="space-y-4 pt-4 text-center">
                                <CardTitle>Ready to Start?</CardTitle>
                                <CardDescription>All set! {gameState.customQuestions?.length ? `${gameState.customQuestions.length} custom questions added.` : 'Using random hard questions.'}</CardDescription>
                                <Button onClick={startGame} className="w-full text-lg">Start Game</Button>
                            </TabsContent>
                            <TabsContent value="custom" className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <Input placeholder="Question (e.g. 5+5)" value={newQ} onChange={e => setNewQ(e.target.value)} />
                                        <Input type="number" placeholder="Ans" className="w-20" value={newA} onChange={e => setNewA(e.target.value)} />
                                        <Button size="icon" onClick={handleAddCustomQuestion}><Plus /></Button>
                                    </div>
                                    <ScrollArea className="h-[150px] border rounded-md p-2">
                                        {(gameState.customQuestions || []).map((q, i) => (
                                            <div key={i} className="flex justify-between items-center text-sm p-1 border-b last:border-0">
                                                <span>{q.question} = {q.answer}</span>
                                                <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomQuestion(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                            </div>
                                        ))}
                                        {(!gameState.customQuestions || gameState.customQuestions.length === 0) && <p className="text-center text-muted-foreground text-xs p-4">No custom questions. Random will be used.</p>}
                                    </ScrollArea>
                                </div>
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="text-center space-y-4 py-8">
                            <CardTitle>Waiting for host...</CardTitle>
                            <Loader2 className="animate-spin m-auto text-primary" />
                            <CardDescription>The host will start the challenge shortly.</CardDescription>
                        </div>
                    )}
                 </Card>
            )}
        </div>
        <AdBanner className="mx-2 my-1" style={{minHeight: '60px'}} />
    </div>
  );
};

export default GameRoomPage;
