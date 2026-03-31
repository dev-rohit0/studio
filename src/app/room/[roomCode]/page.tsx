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
import placeholders from '@/app/lib/placeholder-images.json';
import { ThemeToggle } from '@/components/theme-toggle';

const ROUND_DURATION = 30;
const RESULTS_DISPLAY_DURATION = 3000;
const ALL_CORRECT_SKIP_DELAY = 1500;

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

  const evaluateExpression = (expr: string): number | null => {
    const sanitized = expr.replace(/x/gi, '*').replace(/÷/g, '/').replace(/[^-+*/().0-9 ]/g, '');
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
        const a1 = Math.floor(Math.random() * 9000) + 1000;
        const a2 = Math.floor(Math.random() * 9000) + 1000;
        question = `${a1} + ${a2}`;
        answer = a1 + a2;
        break;
      case '-':
        const s1 = Math.floor(Math.random() * 9000) + 1000;
        const s2 = Math.floor(Math.random() * 900) + 100;
        question = `${s1} - ${s2}`;
        answer = s1 - s2;
        break;
      case '*':
        const m1 = Math.floor(Math.random() * 90) + 10;
        const m2 = Math.floor(Math.random() * 90) + 10;
        question = `${m1} × ${m2}`;
        answer = m1 * m2;
        break;
      case '/':
        const divisor = Math.floor(Math.random() * 20) + 5;
        const quotient = Math.floor(Math.random() * 50) + 10;
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
    const allCorrect = gameState.players.every(p => p.isCorrect === true);

    if (allCorrect) {
       const timer = setTimeout(() => {
          nextQuestion();
       }, ALL_CORRECT_SKIP_DELAY);
       return () => clearTimeout(timer);
    } else if (allAnswered || roundTimeLeft <= 0) {
        endRound();
    }
  }, [gameState?.players, isHost, gameState?.isGameActive, gameState?.isShowingResults, roundTimeLeft, endRound, nextQuestion]);

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
        <Loader2 className="animate-spin text-primary h-10 w-10" />
      </div>
    );
  }

  if (isJoining || !localPlayerInfo || !gameState?.players.some(p => p.id === localPlayerInfo?.playerId)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 relative bg-slate-100 dark:bg-slate-950">
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-md shadow-2xl border-none rounded-[2rem] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl animate-in zoom-in-95 duration-500 overflow-hidden">
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
              ) : <Activity className="h-10 w-10 text-primary animate-pulse" />}
            </div>
            <CardTitle className="text-center text-lg font-black tracking-tighter uppercase">Sync Your Pulse</CardTitle>
            <CardDescription className="text-center font-bold text-[7px] uppercase tracking-widest text-muted-foreground pt-1">Room Code: {roomCode}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pb-12 px-8 sm:px-10">
            <Input 
              placeholder="CALLSIGN..." 
              value={inputPlayerName} 
              onChange={(e) => setInputPlayerName(e.target.value)} 
              maxLength={15} 
              onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()} 
              className="h-12 rounded-xl text-xs font-bold border-2 dark:border-slate-800 focus-visible:ring-primary/40 bg-slate-50/50 dark:bg-slate-950/50 text-center uppercase" 
            />
            <Button 
              onClick={handleJoinGame} 
              className="w-full h-12 text-[8px] rounded-xl shadow-xl font-black transition-transform active:scale-95 text-white uppercase tracking-widest" 
              disabled={!inputPlayerName.trim() || (gameState?.players.length ?? 0) >= 12}
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
      <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto p-4 sm:p-6 overflow-y-auto relative bg-slate-100 dark:bg-slate-950">
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>
        <Card className="w-full shadow-2xl rounded-[2.5rem] overflow-hidden border-none bg-gradient-to-br from-primary/5 via-white to-white dark:from-primary/10 dark:via-slate-900 dark:to-slate-900 animate-in fade-in zoom-in duration-700">
          <CardHeader className="text-center pt-10 pb-6">
            <Trophy className="h-10 w-10 text-yellow-500 mx-auto mb-4 animate-bounce" />
            <CardTitle className="text-xl font-black tracking-tighter uppercase">Leaderboard</CardTitle>
            <CardDescription className="font-black uppercase tracking-[0.3em] text-[7px] text-muted-foreground pt-2">Pulse Champions</CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-10">
            <div className="flex justify-center items-end gap-2 sm:gap-6 pt-10 pb-10">
                {top3[1] && (
                    <div className="flex flex-col items-center gap-2 animate-in slide-in-from-left duration-1000">
                         <div className="relative">
                            <Avatar className="h-10 w-10 border-2 border-slate-200 dark:border-slate-700">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[1].id}/128/128`} />
                                <AvatarFallback className="text-[8px] font-black">{top3[1].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1 bg-slate-400 text-white rounded-full p-0.5 shadow-md border border-white dark:border-slate-900">
                                <Medal className="h-2 w-2" />
                            </div>
                         </div>
                         <span className="font-black text-[7px] text-slate-700 dark:text-slate-300 uppercase truncate max-w-[50px]">{top3[1].name}</span>
                         <div className="bg-slate-200 dark:bg-slate-800 h-10 w-12 rounded-t-xl flex items-center justify-center text-[10px] font-black text-slate-600">2nd</div>
                         <span className="text-[7px] font-black font-mono bg-slate-100 dark:bg-slate-800 px-2 rounded-full">{top3[1].score}</span>
                    </div>
                )}
                {top3[0] && (
                    <div className="flex flex-col items-center gap-2 -translate-y-6 animate-in slide-in-from-bottom duration-700">
                         <div className="relative">
                            <Avatar className="h-14 w-14 border-2 border-yellow-400 shadow-lg shadow-yellow-200/20">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[0].id}/128/128`} />
                                <AvatarFallback className="text-[10px] font-black text-yellow-500">{top3[0].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1 bg-yellow-500 text-white rounded-full p-0.5 shadow-md border border-white dark:border-slate-900">
                                <Trophy className="h-2.5 w-2.5" />
                            </div>
                         </div>
                         <span className="font-black text-[8px] text-yellow-700 dark:text-yellow-400 uppercase truncate max-w-[60px]">{top3[0].name}</span>
                         <div className="bg-yellow-400 dark:bg-yellow-600 h-16 w-16 rounded-t-xl flex items-center justify-center text-sm font-black text-yellow-900">1st</div>
                         <span className="text-[8px] font-black font-mono bg-yellow-100 dark:bg-yellow-900/40 px-3 py-0.5 rounded-full">{top3[0].score}</span>
                    </div>
                )}
                {top3[2] && (
                    <div className="flex flex-col items-center gap-2 animate-in slide-in-from-right duration-1000">
                         <div className="relative">
                            <Avatar className="h-10 w-10 border-2 border-amber-600">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[2].id}/128/128`} />
                                <AvatarFallback className="text-[8px] font-black">{top3[2].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1 bg-amber-600 text-white rounded-full p-0.5 shadow-md border border-white dark:border-slate-900">
                                <Award className="h-2 w-2" />
                            </div>
                         </div>
                         <span className="font-black text-[7px] text-amber-700 dark:text-amber-500 uppercase truncate max-w-[50px]">{top3[2].name}</span>
                         <div className="bg-amber-500 dark:bg-amber-700 h-8 w-12 rounded-t-xl flex items-center justify-center text-[10px] font-black text-white">3rd</div>
                         <span className="text-[7px] font-black font-mono bg-amber-100 dark:bg-amber-900/40 px-2 rounded-full">{top3[2].score}</span>
                    </div>
                )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 pt-6 pb-10 px-8 sm:px-14">
             {isHost && (
                <Button onClick={handleResetLobby} className="w-full h-11 rounded-xl text-[8px] font-black shadow-xl uppercase tracking-widest text-white">LOBBY ACCESS</Button>
             )}
             <Button variant="outline" onClick={handleLeaveGame} className="w-full h-11 rounded-xl text-[7px] font-bold uppercase border-2 dark:border-slate-800">DISCONNECT</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto overflow-hidden relative bg-slate-100 dark:bg-slate-950">
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>

        <Card className="m-4 shadow-xl rounded-[1.5rem] flex-shrink-0 border-none bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl">
         <CardHeader className="p-4">
             <div className="flex justify-between items-center mb-4">
                 <div className="flex items-center gap-2 group cursor-pointer" onClick={() => router.push('/')}>
                    <Activity className="h-4 w-4 text-primary" />
                    <CardTitle className="text-xs font-black tracking-tighter uppercase text-slate-800 dark:text-white">MathPulse</CardTitle>
                 </div>
                 <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg mr-12">
                    <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(roomCode); toast({ title: 'Code Copied' }); }} className="font-mono font-black h-6 px-1.5 text-primary text-[7px] tracking-widest rounded transition-colors uppercase">
                       {roomCode}
                    </Button>
                    <div className="w-[1px] h-3 bg-slate-300 dark:bg-slate-600 mx-0.5" />
                    <Button variant="ghost" size="sm" onClick={handleCopyLink} className="h-6 w-6 p-0 rounded hover:bg-white dark:hover:bg-slate-700 transition-colors">
                       <Share2 className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleLeaveGame} className="h-6 w-6 p-0 rounded text-destructive hover:bg-destructive/10 transition-colors">
                       <LogOut className="h-3 w-3" />
                    </Button>
                 </div>
             </div>
             <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50/50 dark:bg-slate-950/50 p-1.5 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col items-center">
                    <span className="text-[6px] uppercase font-black text-muted-foreground/60 tracking-widest">Round</span>
                    <span className="font-mono font-black text-primary text-[9px]">{gameState.currentRound > 0 ? gameState.currentRound : '--'}</span>
                </div>
                <div className={`p-1.5 rounded-xl border flex flex-col items-center transition-all ${roundTimeLeft < 5 && gameState.isGameActive ? 'bg-red-50 dark:bg-red-950/20 border-red-200 text-red-600' : 'bg-slate-50/50 dark:bg-slate-950/50 border-slate-100 dark:border-slate-800'}`}>
                    <span className="text-[6px] uppercase font-black text-muted-foreground/60 tracking-widest">Clock</span>
                    <div className="flex items-center gap-1">
                        <Clock className="h-2 w-2" />
                        <span className="font-mono font-black text-[9px]">{gameState.isGameActive && !gameState.isShowingResults ? `${roundTimeLeft}s` : '--'}</span>
                    </div>
                </div>
                <div className="bg-slate-50/50 dark:bg-slate-950/50 p-1.5 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col items-center">
                    <span className="text-[6px] uppercase font-black text-muted-foreground/60 tracking-widest">Users</span>
                    <div className="flex items-center gap-1">
                        <Users className="h-2 w-2" />
                        <span className="font-mono font-black text-[9px]">{gameState.players?.length ?? 0}</span>
                    </div>
                </div>
             </div>
             {gameState.isGameActive && !gameState.isShowingResults && roundTimeLeft > 0 && (
                <div className="mt-2 px-1">
                   <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-1" />
                </div>
             )}
         </CardHeader>
        </Card>

        <div className="flex-shrink-0 mx-4">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="ghost" size="sm" className="w-full mb-1 h-5 text-[6px] font-black uppercase tracking-[0.2em] text-muted-foreground/40 hover:text-primary">
               {showScoreboard ? 'Hide Standings' : 'Show Standings'}
           </Button>
           {showScoreboard && (
              <Card className="shadow-lg rounded-[1rem] border-none bg-white/70 dark:bg-slate-900/70 backdrop-blur-md overflow-hidden animate-in slide-in-from-top-2">
                 <CardContent className="p-0">
                    <ScrollArea className={`px-4 py-2 ${gameState.isGameActive ? 'h-[70px]' : 'h-[100px]'}`}>
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-1 rounded-lg transition-all mb-1 ${player.id === localPlayerInfo?.playerId ? 'bg-primary/5 border border-primary/20' : 'hover:bg-white/50 dark:hover:bg-slate-800/50'}`}>
                          <div className="flex items-center gap-2">
                              <span className={`w-3 text-center font-mono font-black text-[7px] ${index < 3 ? 'text-primary' : 'text-muted-foreground/40'}`}>{index + 1}</span>
                              <Avatar className="h-5 w-5 border border-white dark:border-slate-800">
                                  <AvatarImage src={`https://picsum.photos/seed/${player.id}/64/64`} />
                                  <AvatarFallback className="text-[6px] font-black">{player.name[0]}</AvatarFallback>
                              </Avatar>
                              <span className={`truncate max-w-[70px] text-[8px] font-black uppercase ${player.id === localPlayerInfo?.playerId ? 'text-primary' : ''}`}>{player.name}</span>
                              {player.isHost && <Zap className="h-2 w-2 text-yellow-500 fill-yellow-500" />}
                          </div>
                          <div className="flex items-center gap-1.5">
                                {gameState.isGameActive && player.hasAnswered && (
                                     player.isCorrect === true ? <CheckCircle className="h-2 w-2 text-accent" /> : <XCircle className="h-2 w-2 text-destructive" />
                                )}
                                <span className="font-mono font-black text-[8px] w-5 text-right">{player.score}</span>
                          </div>
                       </div>
                    ))}
                    </ScrollArea>
                 </CardContent>
              </Card>
           )}
        </div>

        <div className="flex-grow flex flex-col justify-center items-center px-4 py-4 sm:px-8">
            {gameState.isGameActive ? (
                <div className="w-full space-y-4 animate-in fade-in zoom-in duration-500 max-w-lg mx-auto">
                    <Card className="w-full bg-white dark:bg-slate-900 shadow-xl text-center py-6 px-4 rounded-[1.5rem] border-none ring-1 ring-slate-100 dark:ring-slate-800 relative">
                        <div className="inline-block px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 mb-3">
                           <span className="text-[6px] font-black text-primary uppercase tracking-widest">Target Locked Round {gameState.currentRound}</span>
                        </div>
                        <CardTitle className={`text-2xl sm:text-3xl font-black font-mono tracking-tighter leading-tight ${isPlayerCorrect ? 'text-accent' : ''}`}>
                           {(gameState.isShowingResults || isPlayerCorrect) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <div className="w-full space-y-3">
                        <form onSubmit={handleAnswerSubmit} className="space-y-3">
                            <Input 
                              type="number" 
                              placeholder="ANSWER..." 
                              value={currentAnswer} 
                              onChange={(e) => setCurrentAnswer(e.target.value)} 
                              className="text-center text-lg h-12 rounded-xl border-2 dark:border-slate-800 font-black shadow-inner bg-white/50 dark:bg-slate-950/50 focus-visible:ring-primary/40 uppercase" 
                              disabled={isPlayerCorrect || gameState.isShowingResults} 
                            />
                            <Button type="submit" className="w-full h-12 rounded-xl text-[8px] font-black shadow-lg transition-transform active:scale-95 text-white uppercase tracking-widest" disabled={isPlayerCorrect || currentAnswer === '' || gameState.isShowingResults}>
                                {isPlayerCorrect ? 'SYNC LOCKED' : 'SUBMIT PULSE'}
                             </Button>
                        </form>
                    </div>
                </div>
            ) : (
                 <Card className="w-full bg-white dark:bg-slate-900 shadow-xl p-4 rounded-[1.5rem] border-none backdrop-blur-xl animate-in slide-in-from-bottom-4 duration-500 max-w-lg mx-auto">
                    {isHost ? (
                        <Tabs defaultValue="lobby" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 rounded-xl h-10 bg-slate-100 dark:bg-slate-800 p-0.5 mb-4">
                                <TabsTrigger value="lobby" className="rounded-lg font-black uppercase text-[6px] tracking-widest">Lobby</TabsTrigger>
                                <TabsTrigger value="custom" className="rounded-lg font-black uppercase text-[6px] tracking-widest">Builder</TabsTrigger>
                            </TabsList>
                            <TabsContent value="lobby" className="space-y-4 text-center py-2">
                                <CardTitle className="text-lg font-black tracking-tighter uppercase">Ready for Sync</CardTitle>
                                <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
                                    <Target className="h-5 w-5 text-primary mx-auto mb-2" />
                                    <p className="text-[7px] text-muted-foreground font-black uppercase tracking-widest">Establishing Connection...</p>
                                </div>
                                <Button onClick={startGame} className="w-full h-12 text-[8px] rounded-xl shadow-lg font-black text-white uppercase tracking-widest">START PULSE</Button>
                            </TabsContent>
                            <TabsContent value="custom" className="space-y-3">
                                <div className="flex gap-2">
                                    <Input placeholder="E.g. 15 x 12" value={newQ} onChange={e => setNewQ(e.target.value)} className="rounded-lg h-10 text-[8px] font-bold bg-slate-50 dark:bg-slate-950 border-2 dark:border-slate-800 uppercase" />
                                    <Button size="icon" onClick={handleAddCustomQuestion} disabled={autoCalcAns === null} className="rounded-lg h-10 w-10 shadow-lg text-white"><Plus className="h-4 w-4" /></Button>
                                </div>
                                <ScrollArea className="h-[90px] border-2 border-slate-50 dark:border-slate-800 rounded-xl p-2 bg-slate-50/30 dark:bg-slate-950/30">
                                    {(gameState.customQuestions || []).map((q, i) => (
                                        <div key={i} className="flex justify-between items-center p-2 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-lg mb-1.5 shadow-sm">
                                            <span className="font-mono font-black text-[8px]">{q.question} = {q.answer}</span>
                                            <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomQuestion(i)} className="h-6 w-6 p-0 hover:text-red-500"><Trash2 className="h-3 w-3" /></Button>
                                        </div>
                                    ))}
                                </ScrollArea>
                                <Button onClick={startGame} className="w-full h-12 rounded-xl shadow-lg font-black text-[8px] text-white uppercase tracking-widest">DEPLOY POOL</Button>
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="text-center space-y-4 py-8 px-4">
                            <Activity className="h-8 w-8 animate-pulse text-primary mx-auto" />
                            <div className="space-y-1">
                                <CardTitle className="text-lg font-black tracking-tighter uppercase">Waiting for Sync</CardTitle>
                                <CardDescription className="font-black text-[6px] uppercase tracking-widest text-primary/60">Establishing Global Link...</CardDescription>
                            </div>
                        </div>
                    )}
                 </Card>
            )}
        </div>

        {isHost && gameState.isGameActive && (
          <div className="px-4 pb-8 mt-auto w-full max-w-lg mx-auto">
             <Button 
               onClick={endGame}
               variant="outline"
               className="w-full h-10 rounded-xl text-[7px] font-black border-2 border-destructive/20 text-destructive hover:bg-destructive/10 uppercase tracking-widest"
             >
               <Trash2 className="mr-2 h-3 w-3" />
               End Challenge Session
             </Button>
          </div>
        )}
    </div>
  );
};

export default GameRoomPage;