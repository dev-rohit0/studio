
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

  if (isLoading) return <div className="flex items-center justify-center min-h-dvh"><Loader2 className="animate-spin text-primary h-12 w-12" /></div>;

  if (isJoining || !localPlayerInfo || !gameState?.players.some(p => p.id === localPlayerInfo?.playerId)) {
    return (
      <div className="flex items-center justify-center min-h-dvh w-full p-4 relative">
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-md shadow-2xl border-none rounded-[2.5rem] bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl animate-in zoom-in-95 duration-500">
          <CardHeader className="pt-10">
            <div className="flex justify-center mb-8">
              {!logoError ? (
                  <Image src={placeholders.logo.url} alt={placeholders.logo.alt} width={160} height={50} className="object-contain drop-shadow-lg dark:invert dark:brightness-200" onError={() => setLogoError(true)} />
              ) : <Activity className="h-14 w-14 text-primary animate-pulse" />}
            </div>
            <CardTitle className="text-center text-3xl font-black tracking-tighter">Sync Your Pulse</CardTitle>
            <CardDescription className="text-center font-bold text-xs uppercase tracking-widest text-muted-foreground pt-2">Enter Room: {roomCode}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-12 px-8 sm:px-10">
            <Input placeholder="Enter Callsign" value={inputPlayerName} onChange={(e) => setInputPlayerName(e.target.value)} maxLength={15} onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()} className="h-16 rounded-3xl text-xl font-bold border-2 dark:border-slate-800 focus-visible:ring-primary/40 bg-slate-50/50 dark:bg-slate-950/50" />
            <Button onClick={handleJoinGame} className="w-full h-16 text-xl rounded-3xl shadow-xl font-black transition-transform active:scale-95 text-white" disabled={!inputPlayerName.trim() || (gameState?.players.length ?? 0) >= 10}>JOIN ROUND</Button>
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
            <Trophy className="h-24 w-24 text-yellow-500 mx-auto mb-6 animate-bounce drop-shadow-2xl" />
            <CardTitle className="text-5xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 dark:from-white dark:via-slate-300 dark:to-white">Leaderboard</CardTitle>
            <CardDescription className="font-black uppercase tracking-[0.4em] text-[10px] text-muted-foreground pt-3">Session Champions</CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-10">
            <div className="flex justify-center items-end gap-2 sm:gap-6 pt-16 pb-10">
                {top3[1] && (
                    <div className="flex flex-col items-center gap-4 animate-in slide-in-from-left duration-1000">
                         <div className="relative">
                            <Avatar className="h-16 w-16 sm:h-20 sm:w-20 border-4 border-slate-200 dark:border-slate-700 shadow-2xl">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[1].id}/128/128`} />
                                <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-slate-400 font-black">{top3[1].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-slate-400 text-white rounded-full p-2 shadow-xl border-2 border-white dark:border-slate-900">
                                <Medal className="h-5 w-5" />
                            </div>
                         </div>
                         <span className="font-black text-[10px] sm:text-xs text-slate-700 dark:text-slate-300 uppercase tracking-tighter max-w-[70px] sm:max-w-[100px] truncate">{top3[1].name}</span>
                         <div className="bg-gradient-to-b from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800 h-24 sm:h-32 w-20 sm:w-28 rounded-t-[2rem] flex items-center justify-center text-3xl sm:text-4xl font-black text-slate-600 dark:text-slate-400 shadow-inner">2nd</div>
                         <span className="text-[10px] font-black font-mono bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-slate-600 dark:text-slate-400">{top3[1].score} PTS</span>
                    </div>
                )}
                {top3[0] && (
                    <div className="flex flex-col items-center gap-4 -translate-y-12 animate-in slide-in-from-bottom duration-700">
                         <div className="relative">
                            <div className="absolute -top-10 left-1/2 -translate-x-1/2">
                               <CrownIcon className="h-10 w-10 sm:h-12 sm:w-12 text-yellow-400 animate-pulse drop-shadow-lg" />
                            </div>
                            <Avatar className="h-24 w-24 sm:h-32 sm:w-32 border-4 border-yellow-400 shadow-yellow-200 shadow-[0_0_50px_rgba(250,204,21,0.3)]">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[0].id}/128/128`} />
                                <AvatarFallback className="bg-yellow-50 dark:bg-slate-800 text-yellow-400 font-black">{top3[0].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-yellow-500 text-white rounded-full p-2.5 shadow-xl border-2 border-white dark:border-slate-900">
                                <Trophy className="h-6 w-6" />
                            </div>
                         </div>
                         <span className="font-black text-xs sm:text-sm text-yellow-800 dark:text-yellow-400 uppercase tracking-tighter max-w-[90px] sm:max-w-[140px] truncate">{top3[0].name}</span>
                         <div className="bg-gradient-to-b from-yellow-300 to-yellow-500 dark:from-yellow-600 dark:to-yellow-700 h-40 sm:h-52 w-24 sm:w-36 rounded-t-[2rem] flex items-center justify-center text-5xl sm:text-6xl font-black text-yellow-800 dark:text-yellow-950 shadow-inner">1st</div>
                         <span className="text-xs font-black font-mono bg-yellow-100 dark:bg-yellow-900/50 px-4 py-1.5 rounded-full text-yellow-800 dark:text-yellow-400">{top3[0].score} PTS</span>
                    </div>
                )}
                {top3[2] && (
                    <div className="flex flex-col items-center gap-4 animate-in slide-in-from-right duration-1000">
                         <div className="relative">
                            <Avatar className="h-16 w-16 sm:h-20 sm:w-20 border-4 border-amber-600 shadow-2xl">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[2].id}/128/128`} />
                                <AvatarFallback className="bg-amber-50 dark:bg-slate-800 text-amber-700 font-black">{top3[2].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-amber-600 text-white rounded-full p-2 shadow-xl border-2 border-white dark:border-slate-900">
                                <Award className="h-5 w-5" />
                            </div>
                         </div>
                         <span className="font-black text-[10px] sm:text-xs text-amber-900 dark:text-amber-500 uppercase tracking-tighter max-w-[70px] sm:max-w-[100px] truncate">{top3[2].name}</span>
                         <div className="bg-gradient-to-b from-amber-500 to-amber-700 dark:from-amber-700 dark:to-amber-900 h-20 sm:h-24 w-20 sm:w-28 rounded-t-[2rem] flex items-center justify-center text-3xl sm:text-4xl font-black text-white shadow-inner">3rd</div>
                         <span className="text-[10px] font-black font-mono bg-amber-100 dark:bg-amber-900/50 px-3 py-1 rounded-full text-amber-700 dark:text-amber-500">{top3[2].score} PTS</span>
                    </div>
                )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4 pt-10 pb-12 px-8 sm:px-14">
             {isHost && (
                <Button onClick={handleResetLobby} className="w-full h-16 rounded-3xl text-xl font-black shadow-xl hover:scale-[1.02] active:scale-95 transition-all bg-primary text-white">LOBBY ACCESS</Button>
             )}
             <Button variant="outline" onClick={handleLeaveGame} className="w-full h-16 rounded-3xl text-lg font-bold border-2 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900">DISCONNECT</Button>
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
         <CardHeader className="p-5 sm:p-6">
             <div className="flex justify-between items-center mb-6">
                 <div className="flex items-center gap-3 group cursor-pointer" onClick={() => router.push('/')}>
                    <div className="bg-primary p-2 rounded-xl shadow-lg group-hover:animate-pulse">
                        <Activity className="h-6 w-6 text-white" />
                    </div>
                    <CardTitle className="text-2xl font-black tracking-tighter text-slate-800 dark:text-white">MathPulse</CardTitle>
                 </div>
                 <div className="flex items-center gap-2 bg-slate-100/80 dark:bg-slate-800/80 p-1.5 rounded-2xl mr-12">
                    <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(roomCode); toast({ title: 'Code Copied' }); }} className="font-mono font-black h-9 px-3 text-primary dark:text-primary-foreground text-sm tracking-widest hover:bg-white dark:hover:bg-slate-700 rounded-xl transition-colors">
                       {roomCode}
                    </Button>
                    <div className="w-[1px] h-5 bg-slate-300 dark:bg-slate-600 mx-1" />
                    <Button variant="ghost" size="sm" onClick={handleCopyLink} className="h-9 w-9 p-0 rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-colors">
                       <Share2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleLeaveGame} className="h-9 w-9 p-0 rounded-xl text-destructive hover:bg-destructive/10 transition-colors">
                       <LogOut className="h-4 w-4" />
                    </Button>
                 </div>
             </div>
             <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50/50 dark:bg-slate-950/50 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center">
                    <span className="text-[10px] uppercase font-black text-muted-foreground/60 tracking-widest mb-1">Round</span>
                    <span className="font-mono font-black text-primary text-lg">{gameState.currentRound > 0 ? gameState.currentRound : '--'}</span>
                </div>
                <div className={`p-3 rounded-2xl border flex flex-col items-center transition-all duration-500 ${roundTimeLeft < 5 && gameState.isGameActive ? 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900 text-red-600 dark:text-red-400 scale-105 shadow-lg' : 'bg-slate-50/50 dark:bg-slate-950/50 border-slate-100 dark:border-slate-800 text-slate-800 dark:text-white'}`}>
                    <span className="text-[10px] uppercase font-black text-muted-foreground/60 tracking-widest mb-1">Clock</span>
                    <div className="flex items-center gap-1.5">
                        <Clock className={`h-4 w-4 ${roundTimeLeft < 5 && gameState.isGameActive ? 'animate-pulse' : ''}`} />
                        <span className="font-mono font-black text-lg">{gameState.isGameActive && !gameState.isShowingResults ? `${roundTimeLeft}s` : '--'}</span>
                    </div>
                </div>
                <div className="bg-slate-50/50 dark:bg-slate-950/50 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center">
                    <span className="text-[10px] uppercase font-black text-muted-foreground/60 tracking-widest mb-1">Players</span>
                    <div className="flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        <span className="font-mono font-black text-lg">{gameState.players?.length ?? 0}</span>
                    </div>
                </div>
             </div>
             {gameState.isGameActive && !gameState.isShowingResults && roundTimeLeft > 0 && (
                <div className="mt-6 px-1">
                   <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-2 bg-slate-100 dark:bg-slate-800" />
                </div>
             )}
         </CardHeader>
        </Card>

        <div className="flex-shrink-0 mx-4">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="ghost" size="sm" className="w-full mb-2 h-8 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 hover:text-primary transition-all">
               {showScoreboard ? 'Minimize Live Feed' : 'Expand Live Feed'}
           </Button>
           {showScoreboard && (
              <Card className="shadow-lg rounded-[2rem] border-none bg-white/60 dark:bg-slate-900/60 backdrop-blur-md overflow-hidden animate-in slide-in-from-top-4 duration-300">
                 <CardContent className="p-0">
                    <ScrollArea className={`px-5 py-4 ${gameState.isGameActive ? 'h-[140px]' : 'h-[240px]'}`}>
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-3 rounded-2xl transition-all mb-2 ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 dark:bg-primary/20 border border-primary/20 dark:border-primary/40 shadow-sm' : 'hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>
                          <div className="flex items-center gap-4">
                              <span className={`w-5 text-center font-mono font-black text-xs ${index < 3 ? 'text-primary' : 'text-muted-foreground/30'}`}>{index + 1}</span>
                              <div className="relative">
                                <Avatar className="h-10 w-10 border-2 border-white dark:border-slate-800 shadow-md">
                                    <AvatarImage src={`https://picsum.photos/seed/${player.id}/64/64`} />
                                    <AvatarFallback className="text-xs font-black">{player.name[0]}</AvatarFallback>
                                </Avatar>
                                {player.isHost && (
                                   <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-1 shadow-sm border border-white dark:border-slate-900">
                                      <CrownIcon className="h-2.5 w-2.5 text-white" />
                                   </div>
                                )}
                              </div>
                              <span className={`truncate max-w-[120px] sm:max-w-[180px] text-xs font-black uppercase tracking-tight ${player.id === localPlayerInfo?.playerId ? 'text-primary' : 'text-slate-700 dark:text-slate-300'}`}>{player.name}</span>
                          </div>
                          <div className="flex items-center gap-4">
                                {gameState.isGameActive && player.hasAnswered && (
                                     player.isCorrect === true ? <CheckCircle className="h-5 w-5 text-accent fill-accent/10" /> : <XCircle className="h-5 w-5 text-destructive fill-destructive/10" />
                                )}
                                <span className="font-mono font-black w-14 text-right text-base tracking-tighter">{player.score}</span>
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
                <div className="w-full space-y-6 animate-in fade-in zoom-in duration-500 max-w-lg mx-auto">
                    <Card className="w-full bg-white dark:bg-slate-900 shadow-2xl text-center py-12 px-6 rounded-[2.5rem] border-none ring-1 ring-slate-100 dark:ring-slate-800 transition-all">
                        <div className="inline-block px-4 py-1.5 rounded-full bg-primary/5 dark:bg-primary/10 border border-primary/10 dark:border-primary/20 mb-8">
                           <span className="text-[10px] font-black text-primary dark:text-primary uppercase tracking-[0.2em]">PULSE CHALLENGE {gameState.currentRound}</span>
                        </div>
                        <CardTitle className={`text-4xl sm:text-5xl md:text-6xl font-black font-mono tracking-tighter leading-tight transition-all duration-300 ${isPlayerCorrect ? 'text-accent scale-105' : 'text-slate-900 dark:text-white'}`}>
                           {(gameState.isShowingResults || isPlayerCorrect) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-5">
                        <Input ref={answerInputRef} type="number" placeholder="SOLVE PULSE..." value={currentAnswer} onChange={(e) => setCurrentAnswer(e.target.value)} className="text-center text-4xl h-24 rounded-[2rem] border-2 dark:border-slate-800 font-black shadow-inner bg-white/50 dark:bg-slate-950/50 focus-visible:ring-primary/40 focus-visible:border-primary/40 transition-all" disabled={isPlayerCorrect || gameState.isShowingResults} />
                        <Button type="submit" className="w-full h-20 rounded-[2rem] text-2xl font-black shadow-2xl transition-all hover:scale-[1.02] active:scale-95 bg-primary text-white" disabled={isPlayerCorrect || currentAnswer === '' || gameState.isShowingResults}>
                            {isPlayerCorrect ? (
                               <div className="flex items-center gap-3">
                                  <CheckCircle className="h-7 w-7" />
                                  <span>SYNC LOCKED</span>
                               </div>
                            ) : (
                               <div className="flex items-center gap-3">
                                  <Zap className="h-7 w-7 fill-white" />
                                  <span>SUBMIT PULSE</span>
                               </div>
                            )}
                         </Button>
                    </form>
                </div>
            ) : (
                 <Card className="w-full bg-white dark:bg-slate-900 shadow-2xl p-6 rounded-[2.5rem] border-none backdrop-blur-xl animate-in slide-in-from-bottom-8 duration-500 max-w-lg mx-auto">
                    {isHost ? (
                        <Tabs defaultValue="lobby" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 rounded-[1.5rem] h-16 bg-slate-100/80 dark:bg-slate-800/80 p-1.5 mb-8">
                                <TabsTrigger value="lobby" className="rounded-2xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 data-[state=active]:shadow-lg">Pulse Lobby</TabsTrigger>
                                <TabsTrigger value="custom" className="rounded-2xl font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-white dark:data-[state=active]:bg-slate-900 data-[state=active]:shadow-lg">Pulse Builder</TabsTrigger>
                            </TabsList>
                            <TabsContent value="lobby" className="space-y-8 text-center py-6">
                                <div className="space-y-3">
                                   <CardTitle className="text-4xl font-black tracking-tighter">Prepare for Sync</CardTitle>
                                   <CardDescription className="font-black text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">{gameState.customQuestions?.length ? `${gameState.customQuestions.length} Custom Modules Loaded` : 'Standard Global Difficulty'}</CardDescription>
                                </div>
                                <div className="bg-primary/5 dark:bg-primary/10 rounded-[2rem] p-8 border border-primary/10 dark:border-primary/20 shadow-inner">
                                    <Target className="h-16 w-16 text-primary dark:text-primary mx-auto mb-6 drop-shadow-md" />
                                    <p className="text-sm text-slate-600 dark:text-slate-400 font-bold italic">Competition initiates immediately upon pulse launch.</p>
                                </div>
                                <Button onClick={startGame} className="w-full h-20 text-2xl rounded-[2.5rem] shadow-2xl font-black hover:scale-105 active:scale-95 transition-all bg-primary text-white">START PULSE</Button>
                            </TabsContent>
                            <TabsContent value="custom" className="space-y-8 pt-2">
                                <div className="space-y-6">
                                    <div className="flex flex-col sm:flex-row gap-4">
                                        <div className="flex-grow flex flex-col gap-2">
                                            <Input placeholder="Expression (e.g. 52 x 12)" value={newQ} onChange={e => setNewQ(e.target.value)} className="rounded-2xl h-14 font-bold bg-slate-50 dark:bg-slate-950 border-2 dark:border-slate-800" />
                                            {autoCalcAns !== null && (
                                                <div className="flex items-center gap-2 ml-3">
                                                   <div className="h-2 w-2 rounded-full bg-accent animate-pulse" />
                                                   <span className="text-[10px] text-accent font-black uppercase tracking-[0.2em]">Computed Pulse: {autoCalcAns}</span>
                                                </div>
                                            )}
                                        </div>
                                        <Button size="icon" onClick={handleAddCustomQuestion} disabled={autoCalcAns === null} className="rounded-2xl h-14 w-full sm:w-14 shadow-xl shrink-0 text-white"><Plus /></Button>
                                    </div>
                                    <div className="space-y-3">
                                       <span className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-[0.3em] ml-3">Question Pool</span>
                                       <ScrollArea className="h-[200px] border-2 border-slate-50 dark:border-slate-800 rounded-[2rem] p-4 bg-slate-50/30 dark:bg-slate-950/30">
                                           {(gameState.customQuestions || []).map((q, i) => (
                                               <div key={i} className="flex justify-between items-center text-sm p-4 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl mb-3 shadow-sm animate-in fade-in duration-300">
                                                   <span className="font-mono font-black text-slate-800 dark:text-slate-200 text-base">{q.question} = {q.answer}</span>
                                                   <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomQuestion(i)} className="h-10 w-10 p-0 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 rounded-xl transition-colors"><Trash2 className="h-5 w-5" /></Button>
                                               </div>
                                           ))}
                                           {(!gameState.customQuestions || gameState.customQuestions.length === 0) && (
                                              <div className="h-full flex flex-col items-center justify-center py-10 text-center gap-4">
                                                 <Activity className="h-10 w-10 text-slate-200 dark:text-slate-800" />
                                                 <p className="text-[10px] text-muted-foreground/40 font-black uppercase tracking-[0.3em]">Pool Interface Empty</p>
                                              </div>
                                           )}
                                       </ScrollArea>
                                    </div>
                                    <Button onClick={startGame} className="w-full h-20 rounded-[2.5rem] shadow-2xl font-black text-xl hover:scale-105 active:scale-95 transition-all text-white">DEPLOY PULSE</Button>
                                </div>
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="text-center space-y-10 py-20 px-4">
                            <div className="relative inline-block">
                               <Activity className="h-24 w-24 animate-pulse text-primary drop-shadow-2xl" />
                               <div className="absolute inset-0 bg-primary/20 blur-[60px] rounded-full -z-10" />
                            </div>
                            <div className="space-y-4">
                                <CardTitle className="text-4xl font-black tracking-tighter">Waiting for Host</CardTitle>
                                <CardDescription className="font-black text-[10px] uppercase tracking-[0.5em] text-primary/60">Establishing Global Sync...</CardDescription>
                            </div>
                            <div className="bg-slate-50/50 dark:bg-slate-950/50 rounded-2xl p-5 border border-slate-100 dark:border-slate-800 backdrop-blur-sm">
                               <p className="text-[10px] font-black text-muted-foreground/60 tracking-[0.3em] uppercase">Status: Terminal Locked</p>
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
