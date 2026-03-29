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
import { CheckCircle, XCircle, Users, Share2, Clock, LogOut, Loader2, Plus, Trash2, Activity, Trophy, Medal, Award, Target, Zap } from 'lucide-react';
import { getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, serverTimestamp, Timestamp, runTransaction } from 'firebase/firestore';
import type { Player, GameState } from '@/types/game';
import AdBanner from '@/components/ads/AdBanner';
import placeholders from '@/app/lib/placeholder-images.json';
import { ThemeToggle } from '@/components/theme-toggle';

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
      const roomDocRef = doc(db!, 'gameRooms', roomCode);
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

    const roomDocRef = doc(db!, 'gameRooms', roomCode);

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

      const roomDocRef = doc(db!, 'gameRooms', roomCode);
      try {
          await updateDoc(roomDocRef, { players: arrayUnion(newPlayer) });
          toast({ title: `Pulse Sync'd: Welcome ${name}` });
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
      const scoreToAdd = isAnswerCorrect ? Math.max(5, roundTimeLeft * 2 + 10) : 0;

       const roomDocRef = doc(db!, 'gameRooms', roomCode);
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
    const roomDocRef = doc(db!, 'gameRooms', roomCode);
    clearPlayerInfo();
    setLocalPlayerInfo(null);
    try {
        await runTransaction(db!, async (transaction) => {
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
    toast({ title: 'Pulse Link Copied' });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <Loader2 className="animate-spin text-primary h-12 w-12" />
      </div>
    );
  }

  if (isJoining || !localPlayerInfo || !gameState?.players.some(p => p.id === localPlayerInfo?.playerId)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 relative">
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-md shadow-2xl border-none rounded-[2.5rem] bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl animate-in zoom-in-95 duration-500 overflow-hidden">
          <CardHeader className="pt-10">
            <div className="flex justify-center mb-6">
              {!logoError ? (
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-lg ring-1 ring-slate-100 dark:ring-slate-800">
                    <Image 
                      src={placeholders.logo.url} 
                      alt={placeholders.logo.alt} 
                      width={160} 
                      height={50} 
                      priority
                      style={{ height: 'auto' }}
                      className="object-contain dark:invert dark:brightness-200" 
                      onError={() => setLogoError(true)} 
                    />
                  </div>
              ) : <Activity className="h-14 w-14 text-primary animate-pulse" />}
            </div>
            <CardTitle className="text-center text-xl font-black tracking-tighter">Sync Your Pulse</CardTitle>
            <CardDescription className="text-center font-bold text-[10px] uppercase tracking-widest text-muted-foreground pt-1">Room: {roomCode}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pb-12 px-8 sm:px-10">
            <Input 
              placeholder="Enter Callsign" 
              value={inputPlayerName} 
              onChange={(e) => setInputPlayerName(e.target.value)} 
              maxLength={15} 
              onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()} 
              className="h-14 rounded-2xl text-base font-bold border-2 dark:border-slate-800 focus-visible:ring-primary/40 bg-slate-50/50 dark:bg-slate-950/50" 
            />
            <Button 
              onClick={handleJoinGame} 
              className="w-full h-14 text-sm rounded-2xl shadow-xl font-black transition-transform active:scale-95 text-white" 
              disabled={!inputPlayerName.trim() || (gameState?.players.length ?? 0) >= 10}
            >
              JOIN ROUND
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState.isGameOver) {
    const top3 = sortedPlayers.slice(0, 3);
    return (
      <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto p-4 sm:p-6 overflow-y-auto relative">
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>
        <Card className="w-full shadow-2xl rounded-[3rem] overflow-hidden border-none bg-gradient-to-br from-primary/10 via-white to-white dark:from-primary/20 dark:via-slate-900 dark:to-slate-900 animate-in fade-in zoom-in duration-700">
          <CardHeader className="text-center pt-12 pb-6">
            <Trophy className="h-16 w-16 text-yellow-500 mx-auto mb-6 animate-bounce drop-shadow-2xl" />
            <CardTitle className="text-3xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 dark:from-white dark:via-slate-300 dark:to-white">Leaderboard</CardTitle>
            <CardDescription className="font-black uppercase tracking-[0.4em] text-[10px] text-muted-foreground pt-3">Session Champions</CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-10">
            <div className="flex justify-center items-end gap-2 sm:gap-6 pt-12 pb-10">
                {top3[1] && (
                    <div className="flex flex-col items-center gap-3 animate-in slide-in-from-left duration-1000">
                         <div className="relative">
                            <Avatar className="h-12 w-12 sm:h-14 sm:w-14 border-4 border-slate-200 dark:border-slate-700 shadow-2xl">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[1].id}/128/128`} />
                                <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-slate-400 font-black">{top3[1].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1.5 -right-1.5 bg-slate-400 text-white rounded-full p-1 shadow-xl border-2 border-white dark:border-slate-900">
                                <Medal className="h-3 w-3" />
                            </div>
                         </div>
                         <span className="font-black text-[9px] text-slate-700 dark:text-slate-300 uppercase tracking-tighter max-w-[60px] sm:max-w-[80px] truncate">{top3[1].name}</span>
                         <div className="bg-gradient-to-b from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 h-14 sm:h-18 w-14 sm:w-20 rounded-t-2xl flex items-center justify-center text-lg sm:text-xl font-black text-slate-600 dark:text-slate-400 shadow-inner">2nd</div>
                         <span className="text-[9px] font-black font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full text-slate-600 dark:text-slate-400">{top3[1].score}</span>
                    </div>
                )}
                {top3[0] && (
                    <div className="flex flex-col items-center gap-3 -translate-y-12 animate-in slide-in-from-bottom duration-700">
                         <div className="relative">
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2">
                               <CrownIcon className="h-6 w-6 text-yellow-400 animate-pulse drop-shadow-lg" />
                            </div>
                            <Avatar className="h-16 w-16 sm:h-24 sm:w-24 border-4 border-yellow-400 shadow-yellow-200 shadow-[0_0_50px_rgba(250,204,21,0.3)]">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[0].id}/128/128`} />
                                <AvatarFallback className="bg-yellow-50 dark:bg-slate-800 text-yellow-400 font-black">{top3[0].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1.5 -right-1.5 bg-yellow-500 text-white rounded-full p-1.5 shadow-xl border-2 border-white dark:border-slate-900">
                                <Trophy className="h-4 w-4" />
                            </div>
                         </div>
                         <span className="font-black text-[10px] text-yellow-800 dark:text-yellow-400 uppercase tracking-tighter max-w-[80px] sm:max-w-[120px] truncate">{top3[0].name}</span>
                         <div className="bg-gradient-to-b from-yellow-300 to-yellow-500 dark:from-yellow-600 dark:to-yellow-700 h-24 sm:h-32 w-18 sm:w-28 rounded-t-2xl flex items-center justify-center text-2xl sm:text-3xl font-black text-yellow-800 dark:text-yellow-950 shadow-inner">1st</div>
                         <span className="text-[10px] font-black font-mono bg-yellow-100 dark:bg-yellow-900/50 px-3 py-1 rounded-full text-yellow-800 dark:text-yellow-400">{top3[0].score}</span>
                    </div>
                )}
                {top3[2] && (
                    <div className="flex flex-col items-center gap-3 animate-in slide-in-from-right duration-1000">
                         <div className="relative">
                            <Avatar className="h-12 w-12 sm:h-14 sm:w-14 border-4 border-amber-600 shadow-2xl">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[2].id}/128/128`} />
                                <AvatarFallback className="bg-amber-50 dark:bg-slate-800 text-amber-700 font-black">{top3[2].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1.5 -right-1.5 bg-amber-600 text-white rounded-full p-1 shadow-xl border-2 border-white dark:border-slate-900">
                                <Award className="h-3 w-3" />
                            </div>
                         </div>
                         <span className="font-black text-[9px] text-amber-900 dark:text-amber-500 uppercase tracking-tighter max-w-[60px] sm:max-w-[80px] truncate">{top3[2].name}</span>
                         <div className="bg-gradient-to-b from-amber-500 to-amber-700 dark:from-amber-700 dark:to-amber-900 h-12 sm:h-16 w-14 sm:w-20 rounded-t-2xl flex items-center justify-center text-lg sm:text-xl font-black text-white shadow-inner">3rd</div>
                         <span className="text-[9px] font-black font-mono bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded-full text-amber-700 dark:text-amber-500">{top3[2].score}</span>
                    </div>
                )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 pt-8 pb-12 px-8 sm:px-14">
             {isHost && (
                <Button onClick={handleResetLobby} className="w-full h-14 rounded-2xl text-[10px] font-black shadow-xl hover:scale-[1.02] active:scale-95 transition-all bg-primary text-white">LOBBY ACCESS</Button>
             )}
             <Button variant="outline" onClick={handleLeaveGame} className="w-full h-14 rounded-2xl text-[10px] font-bold border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900">DISCONNECT</Button>
          </CardFooter>
        </Card>
        <AdBanner className="mt-8 mx-auto border-none opacity-40 max-w-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto overflow-hidden relative">
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>

        <Card className="m-4 shadow-xl rounded-[2rem] flex-shrink-0 border-none bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl">
         <CardHeader className="p-4 sm:p-5">
             <div className="flex justify-between items-center mb-5">
                 <div className="flex items-center gap-2.5 group cursor-pointer" onClick={() => router.push('/')}>
                    <div className="bg-primary p-1.5 rounded-lg shadow-lg group-hover:animate-pulse">
                        <Activity className="h-4 w-4 text-white" />
                    </div>
                    <CardTitle className="text-base font-black tracking-tighter text-slate-800 dark:text-white">MathPulse</CardTitle>
                 </div>
                 <div className="flex items-center gap-1.5 bg-slate-100/80 dark:bg-slate-800/80 p-1 rounded-xl mr-12">
                    <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(roomCode); toast({ title: 'Code Copied' }); }} className="font-mono font-black h-7 px-2 text-primary dark:text-primary-foreground text-[10px] tracking-widest hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors">
                       {roomCode}
                    </Button>
                    <div className="w-[1px] h-3 bg-slate-300 dark:bg-slate-600 mx-0.5" />
                    <Button variant="ghost" size="sm" onClick={handleCopyLink} className="h-7 w-7 p-0 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors">
                       <Share2 className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleLeaveGame} className="h-7 w-7 p-0 rounded-lg text-destructive hover:bg-destructive/10 transition-colors">
                       <LogOut className="h-3 w-3" />
                    </Button>
                 </div>
             </div>
             <div className="grid grid-cols-3 gap-2.5">
                <div className="bg-slate-50/50 dark:bg-slate-950/50 p-2 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col items-center">
                    <span className="text-[8px] uppercase font-black text-muted-foreground/60 tracking-widest mb-0.5">Round</span>
                    <span className="font-mono font-black text-primary text-xs">{gameState.currentRound > 0 ? gameState.currentRound : '--'}</span>
                </div>
                <div className={`p-2 rounded-xl border flex flex-col items-center transition-all duration-500 ${roundTimeLeft < 5 && gameState.isGameActive ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900 text-red-600 dark:text-red-400 scale-105 shadow-lg' : 'bg-slate-50/50 dark:bg-slate-950/50 border-slate-100 dark:border-slate-800 text-slate-800 dark:text-white'}`}>
                    <span className="text-[8px] uppercase font-black text-muted-foreground/60 tracking-widest mb-0.5">Clock</span>
                    <div className="flex items-center gap-1">
                        <Clock className={`h-3 w-3 ${roundTimeLeft < 5 && gameState.isGameActive ? 'animate-pulse' : ''}`} />
                        <span className="font-mono font-black text-xs">{gameState.isGameActive && !gameState.isShowingResults ? `${roundTimeLeft}s` : '--'}</span>
                    </div>
                </div>
                <div className="bg-slate-50/50 dark:bg-slate-950/50 p-2 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col items-center">
                    <span className="text-[8px] uppercase font-black text-muted-foreground/60 tracking-widest mb-0.5">Players</span>
                    <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span className="font-mono font-black text-xs">{gameState.players?.length ?? 0}</span>
                    </div>
                </div>
             </div>
             {gameState.isGameActive && !gameState.isShowingResults && roundTimeLeft > 0 && (
                <div className="mt-3 px-1">
                   <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-1 bg-slate-100 dark:bg-slate-800" />
                </div>
             )}
         </CardHeader>
        </Card>

        <div className="flex-shrink-0 mx-4">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="ghost" size="sm" className="w-full mb-1 h-6 rounded-lg text-[8px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 hover:text-primary transition-all">
               {showScoreboard ? 'Minimize Feed' : 'Expand Feed'}
           </Button>
           {showScoreboard && (
              <Card className="shadow-lg rounded-[1.5rem] border-none bg-white/60 dark:bg-slate-900/60 backdrop-blur-md overflow-hidden animate-in slide-in-from-top-4 duration-300">
                 <CardContent className="p-0">
                    <ScrollArea className={`px-4 py-3 ${gameState.isGameActive ? 'h-[100px]' : 'h-[160px]'}`}>
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-2 rounded-xl transition-all mb-1 ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 dark:bg-primary/20 border border-primary/20 dark:border-primary/40 shadow-sm' : 'hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>
                          <div className="flex items-center gap-2.5">
                              <span className={`w-3 text-center font-mono font-black text-[9px] ${index < 3 ? 'text-primary' : 'text-muted-foreground/30'}`}>{index + 1}</span>
                              <div className="relative">
                                <Avatar className="h-7 w-7 border-2 border-white dark:border-slate-800 shadow-md">
                                    <AvatarImage src={`https://picsum.photos/seed/${player.id}/64/64`} />
                                    <AvatarFallback className="text-[9px] font-black">{player.name[0]}</AvatarFallback>
                                </Avatar>
                                {player.isHost && (
                                   <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-0.5 shadow-sm border border-white dark:border-slate-900">
                                      <CrownIcon className="h-2 w-2 text-white" />
                                   </div>
                                )}
                              </div>
                              <span className={`truncate max-w-[80px] sm:max-w-[120px] text-[10px] font-black uppercase tracking-tight ${player.id === localPlayerInfo?.playerId ? 'text-primary' : 'text-slate-700 dark:text-slate-300'}`}>{player.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                                {gameState.isGameActive && player.hasAnswered && (
                                     player.isCorrect === true ? <CheckCircle className="h-3 w-3 text-accent fill-accent/10" /> : <XCircle className="h-3 w-3 text-destructive fill-destructive/10" />
                                )}
                                <span className="font-mono font-black w-8 text-right text-[10px] tracking-tighter">{player.score}</span>
                          </div>
                       </div>
                    ))}
                    </ScrollArea>
                 </CardContent>
              </Card>
           )}
        </div>

        <div className="flex-grow flex flex-col justify-center items-center px-4 py-6 sm:px-8">
            {gameState.isGameActive ? (
                <div className="w-full space-y-4 animate-in fade-in zoom-in duration-500 max-w-lg mx-auto">
                    <Card className="w-full bg-white dark:bg-slate-900 shadow-2xl text-center py-8 px-4 rounded-[2.5rem] border-none ring-1 ring-slate-100 dark:ring-slate-800 transition-all">
                        <div className="inline-block px-2.5 py-0.5 rounded-full bg-primary/5 dark:bg-primary/10 border border-primary/10 dark:border-primary/20 mb-4">
                           <span className="text-[8px] font-black text-primary dark:text-primary uppercase tracking-[0.1em]">PULSE CHALLENGE {gameState.currentRound}</span>
                        </div>
                        <CardTitle className={`text-xl sm:text-2xl md:text-3xl font-black font-mono tracking-tighter leading-tight transition-all duration-300 ${isPlayerCorrect ? 'text-accent scale-105' : 'text-slate-900 dark:text-white'}`}>
                           {(gameState.isShowingResults || isPlayerCorrect) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <div className="w-full space-y-3">
                        <Input 
                          ref={answerInputRef} 
                          type="number" 
                          placeholder="SOLVE..." 
                          value={currentAnswer} 
                          onChange={(e) => setCurrentAnswer(e.target.value)} 
                          onKeyDown={(e) => e.key === 'Enter' && handleAnswerSubmit(e as any)}
                          className="text-center text-xl h-14 rounded-[1.5rem] border-2 dark:border-slate-800 font-black shadow-inner bg-white/50 dark:bg-slate-950/50 focus-visible:ring-primary/40 focus-visible:border-primary/40 transition-all" 
                          disabled={isPlayerCorrect || gameState.isShowingResults} 
                        />
                        <Button onClick={handleAnswerSubmit} className="w-full h-14 rounded-[1.5rem] text-[10px] font-black shadow-2xl transition-all hover:scale-[1.02] active:scale-95 bg-primary text-white" disabled={isPlayerCorrect || currentAnswer === '' || gameState.isShowingResults}>
                            {isPlayerCorrect ? (
                               <div className="flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4" />
                                  <span>SYNC LOCKED</span>
                               </div>
                            ) : (
                               <div className="flex items-center gap-2">
                                  <Zap className="h-4 w-4 fill-white" />
                                  <span>SUBMIT PULSE</span>
                               </div>
                            )}
                         </Button>
                    </div>
                </div>
            ) : (
                 <Card className="w-full bg-white dark:bg-slate-900 shadow-2xl p-4 rounded-[2.5rem] border-none backdrop-blur-xl animate-in slide-in-from-bottom-8 duration-500 max-w-lg mx-auto">
                    {isHost ? (
                        <Tabs defaultValue="lobby" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 rounded-[1.2rem] h-12 bg-slate-100/80 dark:bg-slate-800/80 p-1 mb-6">
                                <TabsTrigger value="lobby" className="rounded-xl font-black uppercase text-[8px] tracking-widest data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 data-[state=active]:shadow-lg">Pulse Lobby</TabsTrigger>
                                <TabsTrigger value="custom" className="rounded-xl font-black uppercase text-[8px] tracking-widest data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 data-[state=active]:shadow-lg">Pulse Builder</TabsTrigger>
                            </TabsList>
                            <TabsContent value="lobby" className="space-y-4 text-center py-4">
                                <div className="space-y-1">
                                   <CardTitle className="text-xl font-black tracking-tighter">Prepare for Sync</CardTitle>
                                   <CardDescription className="font-black text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{gameState.customQuestions?.length ? `${gameState.customQuestions.length} Custom Modules Loaded` : 'Standard Global Difficulty'}</CardDescription>
                                </div>
                                <div className="bg-primary/5 dark:bg-primary/10 rounded-[1.5rem] p-5 border border-primary/10 dark:border-primary/20 shadow-inner">
                                    <Target className="h-8 w-8 text-primary dark:text-primary mx-auto mb-3 drop-shadow-md" />
                                    <p className="text-[10px] text-slate-600 dark:text-slate-400 font-bold italic">Competition initiates upon launch.</p>
                                </div>
                                <Button onClick={startGame} className="w-full h-14 text-[10px] rounded-[1.5rem] shadow-2xl font-black hover:scale-105 active:scale-95 transition-all bg-primary text-white">START PULSE</Button>
                            </TabsContent>
                            <TabsContent value="custom" className="space-y-4 pt-1">
                                <div className="space-y-3">
                                    <div className="flex flex-col sm:flex-row gap-2.5">
                                        <div className="flex-grow flex flex-col gap-1">
                                            <Input placeholder="Expression (e.g. 52 x 12)" value={newQ} onChange={e => setNewQ(e.target.value)} className="rounded-xl h-10 text-[10px] font-bold bg-slate-50 dark:bg-slate-950 border-2 dark:border-slate-800" />
                                            {autoCalcAns !== null && (
                                                <div className="flex items-center gap-1.5 ml-2">
                                                   <div className="h-1 w-1 rounded-full bg-accent animate-pulse" />
                                                   <span className="text-[8px] text-accent font-black uppercase tracking-[0.1em]">Computed: {autoCalcAns}</span>
                                                </div>
                                            )}
                                        </div>
                                        <Button size="icon" onClick={handleAddCustomQuestion} disabled={autoCalcAns === null} className="rounded-xl h-10 w-full sm:w-10 shadow-xl shrink-0 text-white"><Plus className="h-4 w-4" /></Button>
                                    </div>
                                    <div className="space-y-2">
                                       <span className="text-[8px] font-black uppercase text-muted-foreground/40 tracking-[0.2em] ml-2">Question Pool</span>
                                       <ScrollArea className="h-[120px] border-2 border-slate-50 dark:border-slate-800 rounded-[1.5rem] p-2 bg-slate-50/30 dark:bg-slate-950/30">
                                           {(gameState.customQuestions || []).map((q, i) => (
                                               <div key={i} className="flex justify-between items-center p-2.5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl mb-1.5 shadow-sm animate-in fade-in duration-300">
                                                   <span className="font-mono font-black text-slate-800 dark:text-slate-200 text-[10px]">{q.question} = {q.answer}</span>
                                                   <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomQuestion(i)} className="h-7 w-7 p-0 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 rounded-lg transition-colors"><Trash2 className="h-3.5 w-3.5" /></Button>
                                               </div>
                                           ))}
                                           {(!gameState.customQuestions || gameState.customQuestions.length === 0) && (
                                              <div className="h-full flex flex-col items-center justify-center py-6 text-center gap-2">
                                                 <Activity className="h-6 w-6 text-slate-200 dark:text-slate-800" />
                                                 <p className="text-[8px] text-muted-foreground/40 font-black uppercase tracking-[0.2em]">Pool Empty</p>
                                              </div>
                                           )}
                                       </ScrollArea>
                                    </div>
                                    <Button onClick={startGame} className="w-full h-14 rounded-[1.5rem] shadow-2xl font-black text-[10px] hover:scale-105 active:scale-95 transition-all text-white">DEPLOY PULSE</Button>
                                </div>
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="text-center space-y-6 py-12 px-4">
                            <div className="relative inline-block">
                               <Activity className="h-12 w-12 animate-pulse text-primary drop-shadow-2xl" />
                               <div className="absolute inset-0 bg-primary/20 blur-[40px] rounded-full -z-10" />
                            </div>
                            <div className="space-y-2">
                                <CardTitle className="text-xl font-black tracking-tighter">Waiting for Host</CardTitle>
                                <CardDescription className="font-black text-[8px] uppercase tracking-[0.3em] text-primary/60">Establishing Global Sync...</CardDescription>
                            </div>
                            <div className="bg-slate-50/50 dark:bg-slate-950/50 rounded-xl p-3 border border-slate-100 dark:border-slate-800 backdrop-blur-sm">
                               <p className="text-[8px] font-black text-muted-foreground/60 tracking-[0.2em] uppercase">Status: Terminal Locked</p>
                            </div>
                        </div>
                    )}
                 </Card>
            )}
        </div>
        <AdBanner className="mx-4 mb-4 border-none opacity-40 bg-transparent flex-shrink-0" style={{minHeight: '60px'}} />
    </div>
  );
};

// Simple inline SVG for Crown
const CrownIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z" />
    <path d="M19 16v3a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-3" />
  </svg>
);

export default GameRoomPage;