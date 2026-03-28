
'use client';

import type { NextPage } from 'next';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, ClipboardCopy, Users, Share2, Clock, LogOut, Loader2, Plus, Trash2, Activity, Trophy, Medal, Award } from 'lucide-react';
import { getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, serverTimestamp, Timestamp, runTransaction } from 'firebase/firestore';
import type { Player, GameState } from '@/types/game';
import AdBanner from '@/components/ads/AdBanner';
import placeholders from '@/app/lib/placeholder-images.json';

const ROUND_DURATION = 30;
const RESULTS_DISPLAY_DURATION = 3000;

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
  const [roundTimeLeft, setRoundTimeLeft] = useState(ROUND_DURATION);
  const [logoError, setLogoError] = useState(false);
  
  const [newQ, setNewQ] = useState('');
  const [autoCalcAns, setAutoCalcAns] = useState<number | null>(null);

  const roundEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  const evaluateExpression = (expr: string): number | null => {
    const sanitized = expr.replace(/x/g, '*').replace(/÷/g, '/').replace(/[^-+*/().0-9 ]/g, '');
    try {
      if (!sanitized.trim()) return null;
      if (/[^0-9+\-*/(). ]/.test(sanitized)) return null;
      const result = new Function(`return ${sanitized}`)();
      return typeof result === 'number' && isFinite(result) ? Math.round(result * 100) / 100 : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const ans = evaluateExpression(newQ);
    setAutoCalcAns(ans);
  }, [newQ]);

  useEffect(() => {
    if (gameState?.isGameActive && !gameState?.isGameOver && !gameState?.isShowingResults && gameState?.currentRound > 0) {
      const intervalId = setInterval(() => {
        setRoundTimeLeft((prev) => {
          if (prev <= 0) {
            clearInterval(intervalId);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(intervalId);
    } else if (gameState?.isShowingResults) {
      setRoundTimeLeft(0);
    }
  }, [gameState?.currentRound, gameState?.isGameActive, gameState?.isGameOver, gameState?.isShowingResults]);

  const generateEquation = (): { question: string; answer: number } => {
    const operations = ['+', '-', '*', '/'];
    const op = operations[Math.floor(Math.random() * operations.length)];
    let question = '';
    let answer = 0;

    switch (op) {
      case '+':
        const a1 = Math.floor(Math.random() * 90000) + 10000;
        const a2 = Math.floor(Math.random() * 90000) + 10000;
        question = `${a1} + ${a2}`;
        answer = a1 + a2;
        break;
      case '-':
        const s1 = Math.floor(Math.random() * 90000) + 10000;
        const s2 = Math.floor(Math.random() * 9000) + 1000;
        question = `${s1} - ${s2}`;
        answer = s1 - s2;
        break;
      case '*':
        const m1 = Math.floor(Math.random() * 900) + 100;
        const m2 = Math.floor(Math.random() * 90) + 10;
        question = `${m1} × ${m2}`;
        answer = m1 * m2;
        break;
      case '/':
        const divisor = Math.floor(Math.random() * 89) + 10;
        const quotient = Math.floor(Math.random() * 900) + 100;
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
          console.error(error);
      }
  }, [roomCode]);

  const currentPlayer = gameState?.players?.find(p => p.id === localPlayerInfo?.playerId);
  const isHost = currentPlayer?.isHost ?? false;
  const isPlayerCorrect = currentPlayer?.isCorrect === true;
  const sortedPlayers = gameState?.players ? [...gameState.players].sort((a, b) => b.score - a.score) : [];

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
            setGameState(prev => {
                if (prev?.currentRound !== data.currentRound && data.isGameActive && !data.isShowingResults) {
                    setRoundTimeLeft(ROUND_DURATION);
                }
                return { ...data, roomCode };
            });
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
        setIsLoading(false);
    });

    return () => {
        if (unsubscribeRef.current) unsubscribeRef.current();
        if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
    };
  }, [roomCode, router, localPlayerInfo]);

  const handleAddCustomQuestion = async () => {
    if (!newQ.trim() || autoCalcAns === null || !gameState) return;
    const updatedQuestions = [...(gameState.customQuestions || []), { question: newQ, answer: autoCalcAns }];
    await updateFirestoreState({ customQuestions: updatedQuestions });
    setNewQ('');
  };

  const handleRemoveCustomQuestion = async (index: number) => {
    if (!gameState?.customQuestions) return;
    const updatedQuestions = gameState.customQuestions.filter((_, i) => i !== index);
    await updateFirestoreState({ customQuestions: updatedQuestions });
  };

  const endGame = useCallback(async () => {
    await updateFirestoreState({
        isGameActive: false,
        isGameOver: true,
        isShowingResults: false,
        timeLeft: 0
    });
  }, [updateFirestoreState]);

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
        lastActive: Timestamp.now()
    }));

    setRoundTimeLeft(ROUND_DURATION);
    await updateFirestoreState({
        question: nextQ,
        answer: nextA,
        timeLeft: ROUND_DURATION,
        isGameActive: true,
        isGameOver: false,
        isShowingResults: false,
        currentRound: 1,
        players: resetPlayers,
        roundStartTime: serverTimestamp(),
        currentQuestionIndex: nextIdx
    });
  }, [gameState, isHost, updateFirestoreState]);

  const nextQuestion = useCallback(async () => {
    if (!gameState || !isHost || !gameState.isGameActive) return;
    if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);

    let nextQ: string;
    let nextA: number;
    let nextIdx = gameState.currentQuestionIndex ?? 0;

    if (gameState.customQuestions && gameState.customQuestions.length > 0 && nextIdx >= gameState.customQuestions.length) {
      endGame();
      return;
    }

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
        lastActive: Timestamp.now()
    }));

    setRoundTimeLeft(ROUND_DURATION);
    await updateFirestoreState({
        question: nextQ,
        answer: nextA,
        timeLeft: ROUND_DURATION,
        isShowingResults: false,
        currentRound: (gameState.currentRound || 0) + 1,
        players: resetPlayers,
        roundStartTime: serverTimestamp(),
        currentQuestionIndex: nextIdx
    });
    setCurrentAnswer('');
  }, [gameState, isHost, updateFirestoreState, endGame]);

  const endRound = useCallback(async () => {
    if (!gameState || !isHost || gameState.isShowingResults || !gameState.isGameActive) return;

    const updatedPlayers = gameState.players.map(p => ({
        ...p,
        isCorrect: p.hasAnswered ? p.isCorrect : false,
        lastActive: Timestamp.now()
    }));

    await updateFirestoreState({
        players: updatedPlayers,
        isShowingResults: true,
        timeLeft: 0,
    });

    roundEndTimeoutRef.current = setTimeout(() => {
        nextQuestion();
    }, RESULTS_DISPLAY_DURATION);
  }, [gameState, isHost, updateFirestoreState, nextQuestion]);

  useEffect(() => {
    if (!isHost || !gameState?.isGameActive || gameState.isShowingResults || !gameState.players || gameState.players.length === 0) return;
    
    const allAnswered = gameState.players.every(p => p.hasAnswered);
    const allCorrect = allAnswered && gameState.players.every(p => p.isCorrect === true);

    if (allCorrect) {
        if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
        const autoAdvance = setTimeout(() => nextQuestion(), 1000);
        return () => clearTimeout(autoAdvance);
    } else if (allAnswered || roundTimeLeft <= 0) {
        endRound();
    }
  }, [gameState?.players, isHost, gameState?.isGameActive, gameState?.isShowingResults, roundTimeLeft, nextQuestion, endRound]);

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
          toast({ title: `Welcome to MathPulse, ${name}!` });
      } catch (error) {
          toast({ title: "Error Joining Game", variant: "destructive" });
      }
  };

  const handleAnswerSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!localPlayerInfo || !gameState?.isGameActive || gameState.isShowingResults || currentAnswer === '' || roundTimeLeft <= 0 || !db) return;

      const playerInState = gameState.players.find(p => p.id === localPlayerInfo.playerId);
      if (!playerInState || (playerInState.hasAnswered && playerInState.isCorrect)) return;

      const submittedAnswer = parseFloat(currentAnswer);
      const isAnswerCorrect = submittedAnswer === gameState.answer;
      let scoreToAdd = 0;

      if (isAnswerCorrect) {
            scoreToAdd = Math.max(5, roundTimeLeft * 2 + 10);
      }

       const roomDocRef = doc(db, 'gameRooms', roomCode);
       try {
              const updatedPlayers = gameState.players.map(p => {
                 if (p.id === localPlayerInfo.playerId) {
                    return {
                       ...p,
                       score: (p.score ?? 0) + scoreToAdd,
                       hasAnswered: true,
                       isCorrect: isAnswerCorrect,
                       lastActive: Timestamp.now()
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

  const handleResetLobby = async () => {
    await updateFirestoreState({
        isGameOver: false,
        isGameActive: false,
        isShowingResults: false,
        currentRound: 0,
        players: gameState?.players.map(p => ({ ...p, score: 0, hasAnswered: false, isCorrect: null })) || []
    });
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-primary" /></div>;

  if (isJoining || !localPlayerInfo || !gameState?.players.some(p => p.id === localPlayerInfo?.playerId)) {
    return (
      <Card className="w-full max-w-md shadow-lg m-auto border-none">
        <CardHeader>
          <div className="flex justify-center mb-4">
            {!logoError ? (
                <Image src={placeholders.logo.url} alt={placeholders.logo.alt} width={100} height={30} className="object-contain" onError={() => setLogoError(true)} />
            ) : <Activity className="h-10 w-10 text-primary" />}
          </div>
          <CardTitle className="text-center">Join Room: {roomCode}</CardTitle>
          <CardDescription className="text-center">Enter your name to start the pulse</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <Input placeholder="Your Name" value={inputPlayerName} onChange={(e) => setInputPlayerName(e.target.value)} maxLength={15} onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()} className="h-12 rounded-xl text-lg" />
           <Button onClick={handleJoinGame} className="w-full h-12 text-lg rounded-xl" disabled={!inputPlayerName.trim() || (gameState?.players.length ?? 0) >= 10}>Join Game</Button>
        </CardContent>
      </Card>
    );
  }

  if (gameState.isGameOver) {
    const top3 = sortedPlayers.slice(0, 3);
    return (
      <div className="flex flex-col h-screen w-full max-w-md bg-secondary p-4">
        <Card className="w-full shadow-xl rounded-2xl overflow-hidden border-none bg-gradient-to-b from-primary/10 to-card">
          <CardHeader className="text-center pb-2">
            <Trophy className="h-16 w-16 text-yellow-500 mx-auto mb-2 animate-bounce" />
            <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-600 to-yellow-400">Final Results</CardTitle>
            <CardDescription>MathPulse Champions!</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-around items-end pt-8 pb-4">
                {top3[1] && (
                    <div className="flex flex-col items-center gap-2">
                         <div className="relative">
                            <Avatar className="h-16 w-16 border-4 border-slate-300">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[1].id}/64/64`} />
                                <AvatarFallback>{top3[1].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-slate-400 text-white rounded-full p-1 shadow-lg">
                                <Medal className="h-5 w-5" />
                            </div>
                         </div>
                         <span className="font-bold text-slate-700">{top3[1].name}</span>
                         <div className="bg-slate-300 h-20 w-16 rounded-t-lg flex items-center justify-center text-xl font-bold text-slate-600 shadow-inner">2nd</div>
                         <span className="text-sm font-mono">{top3[1].score} pts</span>
                    </div>
                )}
                {top3[0] && (
                    <div className="flex flex-col items-center gap-2 -translate-y-4">
                         <div className="relative">
                            <Avatar className="h-20 w-20 border-4 border-yellow-400 shadow-yellow-200 shadow-lg">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[0].id}/80/80`} />
                                <AvatarFallback>{top3[0].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-yellow-500 text-white rounded-full p-1 shadow-lg">
                                <Trophy className="h-6 w-6" />
                            </div>
                         </div>
                         <span className="font-bold text-yellow-700">{top3[0].name}</span>
                         <div className="bg-yellow-400 h-28 w-20 rounded-t-lg flex items-center justify-center text-2xl font-bold text-yellow-800 shadow-inner">1st</div>
                         <span className="text-sm font-mono font-bold">{top3[0].score} pts</span>
                    </div>
                )}
                {top3[2] && (
                    <div className="flex flex-col items-center gap-2">
                         <div className="relative">
                            <Avatar className="h-16 w-16 border-4 border-amber-600">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[2].id}/64/64`} />
                                <AvatarFallback>{top3[2].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-amber-700 text-white rounded-full p-1 shadow-lg">
                                <Award className="h-5 w-5" />
                            </div>
                         </div>
                         <span className="font-bold text-amber-800">{top3[2].name}</span>
                         <div className="bg-amber-600/70 h-16 w-16 rounded-t-lg flex items-center justify-center text-xl font-bold text-white shadow-inner">3rd</div>
                         <span className="text-sm font-mono">{top3[2].score} pts</span>
                    </div>
                )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 pt-0">
             {isHost && (
                <Button onClick={handleResetLobby} className="w-full rounded-xl py-6 text-lg">Return to Lobby</Button>
             )}
             <Button variant="outline" onClick={handleLeaveGame} className="w-full rounded-xl py-6 text-lg">Exit Room</Button>
          </CardFooter>
        </Card>
        <AdBanner className="mt-auto" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-h-screen w-full max-w-md bg-secondary">
        <Card className="m-2 shadow rounded-xl flex-shrink-0 border-none">
         <CardHeader className="p-3">
             <div className="flex justify-between items-center mb-2">
                 <CardTitle className="text-xl flex items-center gap-1 font-black text-primary">
                     <Activity className="h-5 w-5" />
                     MathPulse
                 </CardTitle>
                 <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(roomCode)} className="font-mono font-bold">
                       {roomCode}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleCopyLink}>
                       <Share2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleLeaveGame} className="text-destructive">
                       <LogOut className="h-4 w-4" />
                    </Button>
                 </div>
             </div>
             <div className="flex items-center justify-between text-sm text-muted-foreground font-medium">
                <span>Round: {gameState.currentRound > 0 ? gameState.currentRound : '-'}</span>
                <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{gameState.isGameActive && !gameState.isShowingResults ? `${roundTimeLeft}s` : '--'}</span>
                </div>
                <div className="flex items-center gap-1">
                   <Users className="h-4 w-4" />
                   <span>{gameState.players?.length ?? 0}</span>
                </div>
             </div>
             {gameState.isGameActive && !gameState.isShowingResults && roundTimeLeft > 0 && (
                <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-2 mt-2" />
             )}
         </CardHeader>
        </Card>

        <div className="flex-shrink-0 m-2 mt-0">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="outline" size="sm" className="w-full mb-1 rounded-lg">
               {showScoreboard ? 'Hide Pulse' : 'Show Pulse'}
           </Button>
           {showScoreboard && (
              <Card className="shadow rounded-xl border-none">
                 <CardContent className="p-0">
                    <ScrollArea className={`p-2 ${gameState.isGameActive ? 'h-[100px]' : 'h-[180px]'}`}>
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1.5 rounded-lg ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 font-bold' : ''} text-sm mb-1`}>
                          <div className="flex items-center gap-2">
                              <span className="w-5 text-right text-muted-foreground font-mono">{index + 1}</span>
                              <Avatar className="h-7 w-7">
                                <AvatarImage src={`https://picsum.photos/seed/${player.id}/28/28`} />
                                <AvatarFallback className="text-[10px]">{player.name[0]}</AvatarFallback>
                              </Avatar>
                              <span className="truncate max-w-[120px]">{player.name} {player.isHost && '👑'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                                {gameState.isGameActive && player.hasAnswered && (
                                     player.isCorrect === true ? <CheckCircle className="h-4 w-4 text-accent" /> : <XCircle className="h-4 w-4 text-destructive" />
                                )}
                                <span className="font-mono font-black w-10 text-right">{player.score}</span>
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
                    <Card className="w-full bg-card shadow-lg text-center p-8 rounded-2xl border-none">
                        <CardDescription className="mb-4 font-bold text-primary/60">QUESTION {gameState.currentRound}</CardDescription>
                        <CardTitle className="text-4xl font-black font-mono tracking-tight">
                           {(gameState.isShowingResults || isPlayerCorrect) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-3">
                        <Input ref={answerInputRef} type="number" placeholder="Pulse your answer..." value={currentAnswer} onChange={(e) => setCurrentAnswer(e.target.value)} className="text-center text-3xl h-16 rounded-2xl border-2 font-black" disabled={isPlayerCorrect || gameState.isShowingResults} />
                        <Button type="submit" className="w-full text-xl py-8 rounded-2xl shadow-lg" disabled={isPlayerCorrect || currentAnswer === '' || gameState.isShowingResults}>
                            {isPlayerCorrect ? 'Locked In!' : 'Submit'}
                         </Button>
                    </form>
                </>
            ) : (
                 <Card className="w-full bg-card shadow-lg p-4 rounded-2xl border-none">
                    {isHost ? (
                        <Tabs defaultValue="lobby" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 rounded-xl h-12">
                                <TabsTrigger value="lobby" className="rounded-lg">Lobby</TabsTrigger>
                                <TabsTrigger value="custom" className="rounded-lg">Custom Pool</TabsTrigger>
                            </TabsList>
                            <TabsContent value="lobby" className="space-y-4 pt-4 text-center">
                                <CardTitle className="text-2xl font-black">Ready to Pulse?</CardTitle>
                                <CardDescription className="font-medium">{gameState.customQuestions?.length ? `${gameState.customQuestions.length} custom questions loaded.` : 'Random hard mode enabled.'}</CardDescription>
                                <Button onClick={startGame} className="w-full py-8 text-xl rounded-2xl shadow-lg">Start Game</Button>
                            </TabsContent>
                            <TabsContent value="custom" className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <div className="flex-grow flex flex-col">
                                            <Input placeholder="Expr (e.g. 25 * 4)" value={newQ} onChange={e => setNewQ(e.target.value)} className="rounded-xl" />
                                            {autoCalcAns !== null && (
                                                <span className="text-[10px] text-accent font-black mt-1 ml-1 uppercase">Computed Answer: {autoCalcAns}</span>
                                            )}
                                        </div>
                                        <Button size="icon" onClick={handleAddCustomQuestion} disabled={autoCalcAns === null} className="rounded-xl h-10 w-10"><Plus /></Button>
                                    </div>
                                    <ScrollArea className="h-[150px] border rounded-xl p-2 bg-secondary/50">
                                        {(gameState.customQuestions || []).map((q, i) => (
                                            <div key={i} className="flex justify-between items-center text-sm p-2 bg-card rounded-lg mb-1 shadow-sm">
                                                <span className="font-mono font-bold">{q.question} = {q.answer}</span>
                                                <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomQuestion(i)} className="h-8 w-8 p-0"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                            </div>
                                        ))}
                                        {(!gameState.customQuestions || gameState.customQuestions.length === 0) && <p className="text-center text-muted-foreground text-xs p-8 italic">No custom questions added yet.</p>}
                                    </ScrollArea>
                                    <Button onClick={startGame} className="w-full mt-4 py-8 text-xl rounded-2xl shadow-lg" variant="default">Start Game</Button>
                                </div>
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="text-center space-y-6 py-12">
                            <Activity className="h-16 w-16 animate-pulse m-auto text-primary" />
                            <div className="space-y-2">
                                <CardTitle className="text-2xl font-black">Waiting for Host</CardTitle>
                                <CardDescription className="font-medium">Get your fingers ready for the pulse...</CardDescription>
                            </div>
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
