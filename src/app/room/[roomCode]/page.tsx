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
import { CheckCircle, XCircle, ClipboardCopy, Users, Share2, Clock, LogOut, Loader2, Plus, Trash2, Activity, Trophy, Medal, Award, Target, Zap } from 'lucide-react';
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

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin text-primary" /></div>;

  if (isJoining || !localPlayerInfo || !gameState?.players.some(p => p.id === localPlayerInfo?.playerId)) {
    return (
      <Card className="w-full max-w-md shadow-2xl m-auto border-none rounded-3xl bg-white/80 backdrop-blur-md">
        <CardHeader>
          <div className="flex justify-center mb-6">
            {!logoError ? (
                <Image src={placeholders.logo.url} alt={placeholders.logo.alt} width={120} height={40} className="object-contain drop-shadow-md" onError={() => setLogoError(true)} />
            ) : <Activity className="h-12 w-12 text-primary animate-pulse" />}
          </div>
          <CardTitle className="text-center text-2xl font-black">Sync Your Pulse</CardTitle>
          <CardDescription className="text-center">Enter your name to join room {roomCode}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-8">
           <Input placeholder="Enter Callsign" value={inputPlayerName} onChange={(e) => setInputPlayerName(e.target.value)} maxLength={15} onKeyDown={(e) => e.key === 'Enter' && handleJoinGame()} className="h-14 rounded-2xl text-lg font-bold border-2 focus-visible:ring-primary/40" />
           <Button onClick={handleJoinGame} className="w-full h-14 text-lg rounded-2xl shadow-lg transition-transform hover:scale-[1.02]" disabled={!inputPlayerName.trim() || (gameState?.players.length ?? 0) >= 10}>Join Round</Button>
        </CardContent>
      </Card>
    );
  }

  if (gameState.isGameOver) {
    const top3 = sortedPlayers.slice(0, 3);
    return (
      <div className="flex flex-col h-screen w-full max-w-md bg-secondary/30 p-4">
        <Card className="w-full shadow-2xl rounded-[2.5rem] overflow-hidden border-none bg-gradient-to-br from-primary/20 via-white to-white">
          <CardHeader className="text-center pt-10">
            <Trophy className="h-20 w-20 text-yellow-500 mx-auto mb-4 animate-bounce drop-shadow-lg" />
            <CardTitle className="text-4xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">Leaderboard</CardTitle>
            <CardDescription className="font-bold uppercase tracking-widest text-[10px] text-muted-foreground">Session Champions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="flex justify-around items-end pt-12 pb-6 px-2">
                {top3[1] && (
                    <div className="flex flex-col items-center gap-3 animate-in slide-in-from-left duration-1000">
                         <div className="relative group">
                            <Avatar className="h-16 w-16 border-4 border-slate-200 shadow-xl transition-transform group-hover:scale-110">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[1].id}/128/128`} />
                                <AvatarFallback className="bg-slate-100 text-slate-400 font-black">{top3[1].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-slate-400 text-white rounded-full p-1.5 shadow-lg border-2 border-white">
                                <Medal className="h-5 w-5" />
                            </div>
                         </div>
                         <span className="font-black text-xs text-slate-700 uppercase tracking-tighter max-w-[80px] truncate">{top3[1].name}</span>
                         <div className="bg-gradient-to-b from-slate-200 to-slate-300 h-24 w-20 rounded-t-3xl flex items-center justify-center text-2xl font-black text-slate-600 shadow-inner">2nd</div>
                         <span className="text-[10px] font-black font-mono bg-slate-100 px-2 py-0.5 rounded-full">{top3[1].score} PTS</span>
                    </div>
                )}
                {top3[0] && (
                    <div className="flex flex-col items-center gap-3 -translate-y-8 animate-in slide-in-from-bottom duration-700">
                         <div className="relative group">
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2">
                               <CrownIcon className="h-8 w-8 text-yellow-400 animate-pulse fill-yellow-400" />
                            </div>
                            <Avatar className="h-24 w-24 border-4 border-yellow-400 shadow-yellow-200 shadow-2xl transition-transform group-hover:scale-110">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[0].id}/128/128`} />
                                <AvatarFallback className="bg-yellow-50 text-yellow-400 font-black">{top3[0].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-yellow-500 text-white rounded-full p-2 shadow-lg border-2 border-white">
                                <Trophy className="h-6 w-6" />
                            </div>
                         </div>
                         <span className="font-black text-sm text-yellow-700 uppercase tracking-tighter max-w-[100px] truncate">{top3[0].name}</span>
                         <div className="bg-gradient-to-b from-yellow-300 to-yellow-500 h-36 w-24 rounded-t-3xl flex items-center justify-center text-4xl font-black text-yellow-800 shadow-inner">1st</div>
                         <span className="text-xs font-black font-mono bg-yellow-100 px-3 py-1 rounded-full text-yellow-800">{top3[0].score} PTS</span>
                    </div>
                )}
                {top3[2] && (
                    <div className="flex flex-col items-center gap-3 animate-in slide-in-from-right duration-1000">
                         <div className="relative group">
                            <Avatar className="h-16 w-16 border-4 border-amber-500 shadow-xl transition-transform group-hover:scale-110">
                                <AvatarImage src={`https://picsum.photos/seed/${top3[2].id}/128/128`} />
                                <AvatarFallback className="bg-amber-50 text-amber-600 font-black">{top3[2].name[0]}</AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-2 -right-2 bg-amber-600 text-white rounded-full p-1.5 shadow-lg border-2 border-white">
                                <Award className="h-5 w-5" />
                            </div>
                         </div>
                         <span className="font-black text-xs text-amber-800 uppercase tracking-tighter max-w-[80px] truncate">{top3[2].name}</span>
                         <div className="bg-gradient-to-b from-amber-500/60 to-amber-600/80 h-20 w-20 rounded-t-3xl flex items-center justify-center text-2xl font-black text-white shadow-inner">3rd</div>
                         <span className="text-[10px] font-black font-mono bg-amber-100 px-2 py-0.5 rounded-full">{top3[2].score} PTS</span>
                    </div>
                )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3 pt-4 pb-10 px-8">
             {isHost && (
                <Button onClick={handleResetLobby} className="w-full h-14 rounded-2xl text-lg font-black shadow-lg">Lobby Access</Button>
             )}
             <Button variant="outline" onClick={handleLeaveGame} className="w-full h-14 rounded-2xl text-lg font-bold border-2">Disconnect</Button>
          </CardFooter>
        </Card>
        <AdBanner className="mt-auto border-none opacity-40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-h-screen w-full max-w-md bg-secondary/30 overflow-hidden">
        <Card className="m-3 shadow-xl rounded-2xl flex-shrink-0 border-none bg-white/90 backdrop-blur-md">
         <CardHeader className="p-4">
             <div className="flex justify-between items-center mb-4">
                 <div className="flex items-center gap-2 group cursor-pointer" onClick={() => router.push('/')}>
                    <div className="bg-primary p-1.5 rounded-lg shadow-lg group-hover:animate-pulse">
                        <Activity className="h-5 w-5 text-white" />
                    </div>
                    <CardTitle className="text-xl font-black tracking-tighter text-slate-800">MathPulse</CardTitle>
                 </div>
                 <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                    <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(roomCode)} className="font-mono font-black h-8 px-2 text-primary text-xs tracking-widest">
                       {roomCode}
                    </Button>
                    <div className="w-[1px] h-4 bg-slate-300 mx-1" />
                    <Button variant="ghost" size="sm" onClick={handleCopyLink} className="h-8 w-8 p-0 rounded-lg hover:bg-white transition-colors">
                       <Share2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleLeaveGame} className="h-8 w-8 p-0 rounded-lg text-destructive hover:bg-destructive/10 transition-colors">
                       <LogOut className="h-4 w-4" />
                    </Button>
                 </div>
             </div>
             <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 p-2 rounded-xl border border-slate-100 flex flex-col items-center">
                    <span className="text-[9px] uppercase font-black text-muted-foreground tracking-widest">Round</span>
                    <span className="font-mono font-black text-primary">{gameState.currentRound > 0 ? gameState.currentRound : '--'}</span>
                </div>
                <div className={`p-2 rounded-xl border flex flex-col items-center transition-colors duration-500 ${roundTimeLeft < 5 && gameState.isGameActive ? 'bg-red-50 border-red-100 text-red-600' : 'bg-slate-50 border-slate-100 text-slate-800'}`}>
                    <span className="text-[9px] uppercase font-black text-muted-foreground tracking-widest">Clock</span>
                    <div className="flex items-center gap-1">
                        <Clock className={`h-3 w-3 ${roundTimeLeft < 5 && gameState.isGameActive ? 'animate-pulse' : ''}`} />
                        <span className="font-mono font-black">{gameState.isGameActive && !gameState.isShowingResults ? `${roundTimeLeft}s` : '--'}</span>
                    </div>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl border border-slate-100 flex flex-col items-center">
                    <span className="text-[9px] uppercase font-black text-muted-foreground tracking-widest">Active</span>
                    <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        <span className="font-mono font-black">{gameState.players?.length ?? 0}</span>
                    </div>
                </div>
             </div>
             {gameState.isGameActive && !gameState.isShowingResults && roundTimeLeft > 0 && (
                <div className="mt-4 px-1">
                   <Progress value={(roundTimeLeft / ROUND_DURATION) * 100} className="w-full h-1.5 bg-slate-100" />
                </div>
             )}
         </CardHeader>
        </Card>

        <div className="flex-shrink-0 m-3 mt-0">
           <Button onClick={() => setShowScoreboard(!showScoreboard)} variant="ghost" size="sm" className="w-full mb-2 h-6 rounded-lg text-[9px] uppercase font-black tracking-widest text-muted-foreground/60 hover:text-primary">
               {showScoreboard ? 'Minimize Feed' : 'Expand Feed'}
           </Button>
           {showScoreboard && (
              <Card className="shadow-lg rounded-2xl border-none bg-white/60 backdrop-blur-sm overflow-hidden">
                 <CardContent className="p-0">
                    <ScrollArea className={`px-4 py-3 ${gameState.isGameActive ? 'h-[110px]' : 'h-[200px]'}`}>
                    {sortedPlayers.map((player, index) => (
                       <div key={player.id} className={`flex items-center justify-between p-2 rounded-xl transition-all mb-1.5 ${player.id === localPlayerInfo?.playerId ? 'bg-primary/10 border border-primary/20' : 'hover:bg-slate-100/50'}`}>
                          <div className="flex items-center gap-3">
                              <span className={`w-4 text-center font-mono font-black text-[10px] ${index < 3 ? 'text-primary' : 'text-muted-foreground/40'}`}>{index + 1}</span>
                              <div className="relative">
                                <Avatar className="h-8 w-8 border-2 border-white shadow-sm">
                                    <AvatarImage src={`https://picsum.photos/seed/${player.id}/64/64`} />
                                    <AvatarFallback className="text-[10px] font-black">{player.name[0]}</AvatarFallback>
                                </Avatar>
                                {player.isHost && (
                                   <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-0.5 shadow-sm border border-white">
                                      <CrownIcon className="h-2 w-2 text-white" />
                                   </div>
                                )}
                              </div>
                              <span className={`truncate max-w-[110px] text-xs font-bold uppercase tracking-tight ${player.id === localPlayerInfo?.playerId ? 'text-primary' : 'text-slate-700'}`}>{player.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                                {gameState.isGameActive && player.hasAnswered && (
                                     player.isCorrect === true ? <CheckCircle className="h-4 w-4 text-accent fill-accent/20" /> : <XCircle className="h-4 w-4 text-destructive fill-destructive/20" />
                                )}
                                <span className="font-mono font-black w-10 text-right text-sm tracking-tighter">{player.score}</span>
                          </div>
                       </div>
                    ))}
                    </ScrollArea>
                 </CardContent>
              </Card>
           )}
        </div>

        <div className="flex-grow flex flex-col justify-center items-center p-4 m-3 mt-0">
            {gameState.isGameActive ? (
                <div className="w-full space-y-4 animate-in fade-in zoom-in duration-500">
                    <Card className="w-full bg-white shadow-2xl text-center py-10 px-6 rounded-[2rem] border-none ring-1 ring-slate-100">
                        <div className="inline-block px-3 py-1 rounded-full bg-primary/5 border border-primary/10 mb-6">
                           <span className="text-[10px] font-black text-primary uppercase tracking-widest">Question {gameState.currentRound}</span>
                        </div>
                        <CardTitle className={`text-4xl md:text-5xl font-black font-mono tracking-tighter transition-all duration-300 ${isPlayerCorrect ? 'text-accent' : 'text-slate-900'}`}>
                           {(gameState.isShowingResults || isPlayerCorrect) ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
                        </CardTitle>
                    </Card>

                    <form onSubmit={handleAnswerSubmit} className="w-full space-y-4">
                        <Input ref={answerInputRef} type="number" placeholder="PULSE..." value={currentAnswer} onChange={(e) => setCurrentAnswer(e.target.value)} className="text-center text-4xl h-20 rounded-3xl border-2 font-black shadow-inner bg-slate-50 focus-visible:ring-primary/40 focus-visible:border-primary/40" disabled={isPlayerCorrect || gameState.isShowingResults} />
                        <Button type="submit" className="w-full h-16 rounded-3xl text-xl font-black shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]" disabled={isPlayerCorrect || currentAnswer === '' || gameState.isShowingResults}>
                            {isPlayerCorrect ? (
                               <div className="flex items-center gap-2">
                                  <CheckCircle className="h-5 w-5" />
                                  <span>LOCKED IN</span>
                               </div>
                            ) : (
                               <div className="flex items-center gap-2">
                                  <Zap className="h-5 w-5 fill-white" />
                                  <span>SUBMIT PULSE</span>
                               </div>
                            )}
                         </Button>
                    </form>
                </div>
            ) : (
                 <Card className="w-full bg-white/90 shadow-2xl p-4 rounded-[2rem] border-none backdrop-blur-md animate-in slide-in-from-bottom-8 duration-500">
                    {isHost ? (
                        <Tabs defaultValue="lobby" className="w-full">
                            <TabsList className="grid w-full grid-cols-2 rounded-2xl h-14 bg-slate-100 p-1.5 mb-6">
                                <TabsTrigger value="lobby" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:shadow-md">Lobby</TabsTrigger>
                                <TabsTrigger value="custom" className="rounded-xl font-black uppercase text-[10px] tracking-widest data-[state=active]:shadow-md">Builder</TabsTrigger>
                            </TabsList>
                            <TabsContent value="lobby" className="space-y-6 text-center py-6">
                                <div className="space-y-2">
                                   <CardTitle className="text-3xl font-black tracking-tighter">Prepare for Sync</CardTitle>
                                   <CardDescription className="font-bold text-xs uppercase tracking-widest">{gameState.customQuestions?.length ? `${gameState.customQuestions.length} Custom Modules Loaded` : 'Standard Random Difficulty'}</CardDescription>
                                </div>
                                <div className="bg-primary/5 rounded-2xl p-6 border border-primary/10">
                                    <Target className="h-12 w-12 text-primary mx-auto mb-4" />
                                    <p className="text-xs text-muted-foreground font-medium italic">Competition starts immediately upon launch.</p>
                                </div>
                                <Button onClick={startGame} className="w-full h-16 text-xl rounded-3xl shadow-xl font-black">START PULSE</Button>
                            </TabsContent>
                            <TabsContent value="custom" className="space-y-6 pt-2">
                                <div className="space-y-4">
                                    <div className="flex gap-3">
                                        <div className="flex-grow flex flex-col gap-1.5">
                                            <Input placeholder="Enter Expression (e.g. 52 x 12)" value={newQ} onChange={e => setNewQ(e.target.value)} className="rounded-2xl h-12 font-bold bg-slate-50" />
                                            {autoCalcAns !== null && (
                                                <div className="flex items-center gap-1.5 ml-2">
                                                   <div className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                                                   <span className="text-[10px] text-accent font-black uppercase tracking-widest">Computed Answer: {autoCalcAns}</span>
                                                </div>
                                            )}
                                        </div>
                                        <Button size="icon" onClick={handleAddCustomQuestion} disabled={autoCalcAns === null} className="rounded-2xl h-12 w-12 shadow-md"><Plus /></Button>
                                    </div>
                                    <div className="space-y-2">
                                       <span className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest ml-2">Question Pool</span>
                                       <ScrollArea className="h-[180px] border border-slate-100 rounded-[1.5rem] p-3 bg-slate-50/50">
                                           {(gameState.customQuestions || []).map((q, i) => (
                                               <div key={i} className="flex justify-between items-center text-sm p-3 bg-white border border-slate-100 rounded-xl mb-2 shadow-sm animate-in fade-in duration-300">
                                                   <span className="font-mono font-black text-slate-700">{q.question} = {q.answer}</span>
                                                   <Button variant="ghost" size="sm" onClick={() => handleRemoveCustomQuestion(i)} className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-500 rounded-lg"><Trash2 className="h-4 w-4" /></Button>
                                               </div>
                                           ))}
                                           {(!gameState.customQuestions || gameState.customQuestions.length === 0) && (
                                              <div className="h-full flex flex-col items-center justify-center py-8 text-center gap-2">
                                                 <Activity className="h-8 w-8 text-slate-200" />
                                                 <p className="text-xs text-muted-foreground/60 font-medium uppercase tracking-widest">Pool Empty</p>
                                              </div>
                                           )}
                                       </ScrollArea>
                                    </div>
                                    <Button onClick={startGame} className="w-full h-16 rounded-3xl shadow-xl font-black text-lg">DEPLOY POOL</Button>
                                </div>
                            </TabsContent>
                        </Tabs>
                    ) : (
                        <div className="text-center space-y-8 py-14">
                            <div className="relative inline-block">
                               <Activity className="h-20 w-20 animate-pulse text-primary drop-shadow-lg" />
                               <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                            </div>
                            <div className="space-y-3">
                                <CardTitle className="text-3xl font-black tracking-tighter">Waiting for Host</CardTitle>
                                <CardDescription className="font-bold text-xs uppercase tracking-[0.2em] text-primary/60">Establishing Sync with Server...</CardDescription>
                            </div>
                            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                               <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase">Room Status: Locked</p>
                            </div>
                        </div>
                    )}
                 </Card>
            )}
        </div>
        <AdBanner className="mx-3 mb-3 border-none opacity-40 bg-transparent" style={{minHeight: '60px'}} />
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
