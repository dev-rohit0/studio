
'use client';

import type { NextPage } from 'next';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, XCircle, Share2, Clock, LogOut, Loader2, Plus, Trash2, Activity, Trophy, Target, Users } from 'lucide-react';
import { getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, updateDoc, arrayUnion, serverTimestamp, Timestamp, runTransaction } from 'firebase/firestore';
import type { Player, GameState } from '@/types/game';
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
      const result = new Function(`return ${sanitized}`)();
      return typeof result === 'number' && isFinite(result) ? Math.round(result * 100) / 100 : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    setAutoCalcAns(evaluateExpression(newQ));
  }, [newQ]);

  useEffect(() => {
    const handleFocus = () => {
      if (gameState?.isGameActive && !gameState?.isShowingResults && answerInputRef.current) {
        answerInputRef.current.focus();
      }
    };
    const interval = setInterval(handleFocus, 500);
    return () => clearInterval(interval);
  }, [gameState?.isGameActive, gameState?.isShowingResults]);

  useEffect(() => {
    if (gameState?.isGameActive && !gameState?.isGameOver && !gameState?.isShowingResults) {
      const intervalId = setInterval(() => {
        setRoundTimeLeft((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(intervalId);
    }
  }, [gameState?.currentRound, gameState?.isGameActive, gameState?.isGameOver, gameState?.isShowingResults]);

  const generateEquation = (): { question: string; answer: number } => {
    const operations = ['+', '-', '*', '/'];
    const op = operations[Math.floor(Math.random() * operations.length)];
    let q = '';
    let a = 0;
    const r = (max: number) => Math.floor(Math.random() * max);

    if (op === '+') { const n1 = r(900) + 100; const n2 = r(900) + 100; q = `${n1} + ${n2}`; a = n1 + n2; }
    else if (op === '-') { const n1 = r(900) + 100; const n2 = r(90) + 10; q = `${n1} - ${n2}`; a = n1 - n2; }
    else if (op === '*') { const n1 = r(90) + 10; const n2 = r(9) + 2; q = `${n1} × ${n2}`; a = n1 * n2; }
    else { const d = r(12) + 2; const qt = r(50) + 5; const dd = d * qt; q = `${dd} ÷ ${d}`; a = qt; }
    return { question: q, answer: a };
  };

  const updateFirestoreState = useCallback(async (updates: Partial<GameState>) => {
    if (!roomCode || !db) return;
    try { await updateDoc(doc(db, 'gameRooms', roomCode), updates); } 
    catch (e) { console.error('[Firestore] Update Error:', e); }
  }, [roomCode]);

  const currentPlayer = gameState?.players?.find(p => p.id === localPlayerInfo?.playerId);
  const isHost = currentPlayer?.isHost ?? false;
  const isPlayerCorrect = currentPlayer?.isCorrect === true;
  const sortedPlayers = gameState?.players ? [...gameState.players].sort((a, b) => b.score - a.score) : [];

  useEffect(() => {
    if (!roomCode || !db) return;
    const saved = getPlayerInfo();
    if (!localPlayerInfo && saved) { setLocalPlayerInfo(saved); setIsJoining(false); }

    unsubscribeRef.current = onSnapshot(doc(db, 'gameRooms', roomCode), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as GameState;
        setGameState(prev => {
          if (prev?.currentRound !== data.currentRound && data.isGameActive && !data.isShowingResults) {
            setRoundTimeLeft(ROUND_DURATION);
          }
          return { ...data, roomCode };
        });
        setIsLoading(false);
        const pInfo = getPlayerInfo();
        setIsJoining(!pInfo || !data.players?.some(p => p.id === pInfo.playerId));
      } else {
        clearPlayerInfo();
        router.push('/');
      }
    });

    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
      if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
    };
  }, [roomCode, router, localPlayerInfo]);

  const startGame = useCallback(async () => {
    if (!gameState || !isHost || gameState.isGameActive) return;
    const { question: nextQ, answer: nextA } = (gameState.customQuestions?.[0]) || generateEquation();
    await updateFirestoreState({
      question: nextQ, answer: nextA, isGameActive: true, isGameOver: false, isShowingResults: false,
      currentRound: 1, currentQuestionIndex: gameState.customQuestions?.length ? 1 : 0,
      players: gameState.players.map(p => ({ ...p, score: 0, hasAnswered: false, isCorrect: null }))
    });
  }, [gameState, isHost, updateFirestoreState]);

  const nextQuestion = useCallback(async () => {
    if (!gameState || !isHost) return;
    let nextQ: string, nextA: number, nextIdx = gameState.currentQuestionIndex ?? 0;
    if (gameState.customQuestions?.length && nextIdx >= gameState.customQuestions.length) {
      updateFirestoreState({ isGameActive: false, isGameOver: true });
      return;
    }
    if (gameState.customQuestions?.[nextIdx]) {
      const q = gameState.customQuestions[nextIdx]; nextQ = q.question; nextA = q.answer; nextIdx++;
    } else {
      const gen = generateEquation(); nextQ = gen.question; nextA = gen.answer;
    }
    await updateFirestoreState({
      question: nextQ, answer: nextA, isShowingResults: false, currentRound: (gameState.currentRound || 0) + 1,
      currentQuestionIndex: nextIdx, players: gameState.players.map(p => ({ ...p, hasAnswered: false, isCorrect: null }))
    });
    setCurrentAnswer('');
  }, [gameState, isHost, updateFirestoreState]);

  useEffect(() => {
    if (!isHost || !gameState?.isGameActive || gameState.isShowingResults) return;
    const allAnswered = gameState.players.every(p => p.hasAnswered);
    const allCorrect = allAnswered && gameState.players.every(p => p.isCorrect);
    if (allCorrect || allAnswered || roundTimeLeft <= 0) {
      updateFirestoreState({ isShowingResults: true });
      roundEndTimeoutRef.current = setTimeout(nextQuestion, RESULTS_DISPLAY_DURATION);
    }
  }, [gameState?.players, isHost, gameState?.isGameActive, gameState?.isShowingResults, roundTimeLeft, nextQuestion, updateFirestoreState]);

  const handleJoinGame = async () => {
    const name = inputPlayerName.trim();
    if (!name || !db) return;
    const playerId = generateId();
    const isFirst = (gameState?.players?.length ?? 0) === 0;
    const newPlayer: Player = { id: playerId, name, score: 0, isHost: isFirst, hasAnswered: false, isCorrect: null };
    savePlayerInfo(playerId, name);
    setLocalPlayerInfo({ playerId, playerName: name });
    await updateDoc(doc(db, 'gameRooms', roomCode), { players: arrayUnion(newPlayer) });
  };

  const handleAnswerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPlayerInfo || !gameState?.isGameActive || gameState.isShowingResults || !currentAnswer) return;
    const isCorrect = parseFloat(currentAnswer) === gameState.answer;
    const score = isCorrect ? Math.max(5, roundTimeLeft * 2 + 10) : 0;
    const updated = gameState.players.map(p => p.id === localPlayerInfo.playerId ? { ...p, score: p.score + score, hasAnswered: true, isCorrect } : p);
    await updateDoc(doc(db, 'gameRooms', roomCode), { players: updated });
    if (isCorrect) setCurrentAnswer('');
  };

  const handleLeaveGame = async () => {
    if (!localPlayerInfo) return;
    clearPlayerInfo(); router.push('/');
    try {
      await runTransaction(db!, async (tx) => {
        const snap = await tx.get(doc(db!, 'gameRooms', roomCode));
        if (!snap.exists()) return;
        const players = (snap.data() as GameState).players.filter(p => p.id !== localPlayerInfo.playerId);
        if (players.length === 0) tx.delete(doc(db!, 'gameRooms', roomCode));
        else tx.update(doc(db!, 'gameRooms', roomCode), { players: players.map((p, i) => i === 0 ? { ...p, isHost: true } : p) });
      });
    } catch (e) { console.error(e); }
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-dvh"><Loader2 className="animate-spin text-primary h-8 w-8" /></div>;

  if (isJoining || !localPlayerInfo) {
    return (
      <div className="flex items-center justify-center min-h-dvh w-full p-4 relative">
        <div className="absolute top-4 right-4 z-50"><ThemeToggle /></div>
        <Card className="w-full max-w-sm shadow-2xl border-none rounded-[1.5rem] bg-white dark:bg-slate-900 animate-in zoom-in-95 duration-500 overflow-hidden">
          <CardHeader className="pt-8 text-center">
            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl w-fit mx-auto mb-4 border border-slate-100 dark:border-slate-700 shadow-sm">
              {!logoError ? <Image src={placeholders.logo.url} alt="Logo" width={100} height={30} onError={() => setLogoError(true)} /> : <Activity className="h-8 w-8 text-primary" />}
            </div>
            <CardTitle className="text-xl font-black tracking-tight">Sync Callsign</CardTitle>
            <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lobby: {roomCode}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pb-10 px-8">
            <Input placeholder="Enter Callsign" value={inputPlayerName} onChange={e => setInputPlayerName(e.target.value)} maxLength={15} onKeyDown={e => e.key === 'Enter' && handleJoinGame()} className="h-10 rounded-xl text-xs font-bold bg-slate-50/50 dark:bg-slate-950/50" />
            <Button onClick={handleJoinGame} className="w-full h-10 rounded-xl text-xs font-black text-white" disabled={!inputPlayerName.trim()}>ENTER ROUND</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState?.isGameOver) {
    const top3 = sortedPlayers.slice(0, 3);
    return (
      <div className="flex flex-col min-h-dvh w-full max-w-lg mx-auto p-4 sm:p-6 justify-center relative">
        <div className="absolute top-4 right-4 z-50"><ThemeToggle /></div>
        <Card className="w-full shadow-2xl rounded-[2rem] border-none bg-white dark:bg-slate-900 animate-in fade-in zoom-in duration-700">
          <CardHeader className="text-center pt-8">
            <Trophy className="h-8 w-8 text-yellow-500 mx-auto mb-2 animate-bounce" />
            <CardTitle className="text-xl font-black tracking-tight">Final Standings</CardTitle>
          </CardHeader>
          <CardContent className="px-6 py-8">
            <div className="flex justify-center items-end gap-3 h-48">
              {top3[1] && <div className="flex flex-col items-center gap-1 w-20">
                <Avatar className="h-10 w-10 border-2 border-slate-200"><AvatarImage src={`https://picsum.photos/seed/${top3[1].id}/64`} /><AvatarFallback>{top3[1].name[0]}</AvatarFallback></Avatar>
                <div className="bg-slate-100 dark:bg-slate-800 h-20 w-full rounded-t-lg flex items-center justify-center font-black text-lg">2</div>
                <span className="text-[8px] font-bold uppercase truncate w-full text-center">{top3[1].name}</span>
              </div>}
              {top3[0] && <div className="flex flex-col items-center gap-1 w-24">
                <Avatar className="h-14 w-14 border-4 border-yellow-400"><AvatarImage src={`https://picsum.photos/seed/${top3[0].id}/64`} /><AvatarFallback>{top3[0].name[0]}</AvatarFallback></Avatar>
                <div className="bg-yellow-400 dark:bg-yellow-600 h-32 w-full rounded-t-lg flex items-center justify-center font-black text-2xl">1</div>
                <span className="text-[9px] font-black uppercase truncate w-full text-center text-yellow-700 dark:text-yellow-400">{top3[0].name}</span>
              </div>}
              {top3[2] && <div className="flex flex-col items-center gap-1 w-20">
                <Avatar className="h-10 w-10 border-2 border-amber-600"><AvatarImage src={`https://picsum.photos/seed/${top3[2].id}/64`} /><AvatarFallback>{top3[2].name[0]}</AvatarFallback></Avatar>
                <div className="bg-amber-600 h-14 w-full rounded-t-lg flex items-center justify-center font-black text-lg text-white">3</div>
                <span className="text-[8px] font-bold uppercase truncate w-full text-center">{top3[2].name}</span>
              </div>}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 pb-10 px-10">
            {isHost && <Button onClick={() => updateFirestoreState({ isGameOver: false, isGameActive: false })} className="w-full h-11 rounded-xl font-black text-xs text-white">RESTART</Button>}
            <Button variant="outline" onClick={handleLeaveGame} className="w-full h-11 rounded-xl font-bold text-xs">EXIT</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh w-full max-w-xl mx-auto p-4 relative">
      <div className="absolute top-4 right-4 z-50"><ThemeToggle /></div>
      <header className="flex justify-between items-center mb-6 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-black tracking-tight">MathPulse</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-[6px] font-black uppercase text-muted-foreground">Pulse Rate</span>
            <span className={`text-xs font-mono font-black ${roundTimeLeft < 5 ? 'text-red-500 animate-pulse' : 'text-primary'}`}>{roundTimeLeft}s</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLeaveGame} className="h-8 w-8 p-0 text-destructive"><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      {showScoreboard && <Card className="mb-6 border-none shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-md rounded-2xl">
        <ScrollArea className="h-24 px-4 py-2">
          {sortedPlayers.map((p, i) => (
            <div key={p.id} className={`flex items-center justify-between p-1.5 rounded-lg mb-1 ${p.id === localPlayerInfo.playerId ? 'bg-primary/5 border border-primary/20' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="text-[7px] font-black text-muted-foreground w-3">{i + 1}</span>
                <Avatar className="h-5 w-5"><AvatarImage src={`https://picsum.photos/seed/${p.id}/64`} /><AvatarFallback>{p.name[0]}</AvatarFallback></Avatar>
                <span className="text-[9px] font-bold uppercase truncate max-w-[80px]">{p.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {gameState?.isGameActive && p.hasAnswered && (p.isCorrect ? <CheckCircle className="h-2 w-2 text-accent" /> : <XCircle className="h-2 w-2 text-destructive" />)}
                <span className="text-[10px] font-mono font-black">{p.score}</span>
              </div>
            </div>
          ))}
        </ScrollArea>
      </Card>}

      <main className="flex-grow flex flex-col items-center justify-center space-y-6">
        {gameState?.isGameActive ? (
          <div className="w-full max-w-sm space-y-6 animate-in fade-in zoom-in">
            <Card className="p-8 text-center border-none shadow-xl bg-white dark:bg-slate-900 rounded-[2rem]">
              <div className="text-[8px] font-black uppercase text-primary/60 tracking-widest mb-2">Round {gameState.currentRound}</div>
              <div className={`text-4xl font-mono font-black tracking-tighter ${isPlayerCorrect ? 'text-accent' : ''}`}>
                {gameState.isShowingResults || isPlayerCorrect ? `${gameState.question} = ${gameState.answer}` : `${gameState.question} = ?`}
              </div>
            </Card>
            <form onSubmit={handleAnswerSubmit} className="space-y-4">
              <Input ref={answerInputRef} type="number" placeholder="SOLVE..." value={currentAnswer} onChange={e => setCurrentAnswer(e.target.value)} disabled={isPlayerCorrect || gameState.isShowingResults} className="h-14 text-center text-xl font-black rounded-2xl border-2 dark:bg-slate-950" />
              <Button type="submit" disabled={isPlayerCorrect || !currentAnswer || gameState.isShowingResults} className="w-full h-12 rounded-2xl font-black text-xs text-white">SUBMIT PULSE</Button>
            </form>
          </div>
        ) : (
          <Card className="w-full max-w-sm p-6 border-none shadow-xl bg-white dark:bg-slate-900 rounded-[2rem]">
            {isHost ? (
              <Tabs defaultValue="lobby">
                <TabsList className="grid grid-cols-2 mb-6 rounded-xl h-10 p-1">
                  <TabsTrigger value="lobby" className="text-[8px] font-black uppercase">Lobby</TabsTrigger>
                  <TabsTrigger value="custom" className="text-[8px] font-black uppercase">Builder</TabsTrigger>
                </TabsList>
                <TabsContent value="lobby" className="text-center py-4 space-y-6">
                  <Target className="h-10 w-10 text-primary mx-auto opacity-20" />
                  <div className="space-y-1">
                    <h2 className="text-xl font-black tracking-tight">Ready for Sync?</h2>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase">{gameState?.players?.length} Players Connected</p>
                  </div>
                  <Button onClick={startGame} className="w-full h-11 rounded-xl font-black text-xs text-white">START PULSE</Button>
                </TabsContent>
                <TabsContent value="custom" className="space-y-4">
                   <div className="flex gap-2">
                      <Input placeholder="Expression (e.g. 52 * 4)" value={newQ} onChange={e => setNewQ(e.target.value)} className="text-[10px] h-9" />
                      <Button size="icon" onClick={() => { if(autoCalcAns!==null){ updateFirestoreState({ customQuestions: [...(gameState.customQuestions||[]), {question: newQ, answer: autoCalcAns}] }); setNewQ(''); } }} disabled={autoCalcAns===null} className="h-9 w-9 text-white"><Plus className="h-3 w-3" /></Button>
                   </div>
                   <ScrollArea className="h-28 border rounded-xl p-2 bg-slate-50/50 dark:bg-slate-950/50">
                      {(gameState.customQuestions||[]).map((q, i) => (
                        <div key={i} className="flex justify-between items-center text-[9px] p-2 bg-white dark:bg-slate-800 rounded-lg mb-1 border shadow-sm">
                          <span className="font-mono font-black">{q.question} = {q.answer}</span>
                          <Button variant="ghost" size="sm" onClick={() => updateFirestoreState({ customQuestions: gameState.customQuestions?.filter((_, idx)=>idx!==i) })} className="h-5 w-5 p-0 text-destructive"><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      ))}
                   </ScrollArea>
                   <Button onClick={startGame} className="w-full h-11 rounded-xl font-black text-xs text-white">START CUSTOM PULSE</Button>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-10 space-y-6">
                <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto opacity-20" />
                <div className="space-y-1">
                  <h2 className="text-xl font-black tracking-tight">Syncing with Host</h2>
                  <p className="text-[9px] font-bold text-primary/60 uppercase animate-pulse">Establishing Session Connection...</p>
                </div>
              </div>
            )}
          </Card>
        )}
      </main>
      <footer className="mt-8 text-center"><Button variant="ghost" size="sm" onClick={() => setShowScoreboard(!showScoreboard)} className="text-[7px] font-black uppercase tracking-widest text-muted-foreground/40">{showScoreboard ? 'Hide Feed' : 'Show Feed'}</Button></footer>
    </div>
  );
};

export default GameRoomPage;
