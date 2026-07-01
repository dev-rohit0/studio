'use client';

import type { NextPage } from 'next';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle, XCircle, Users, Share2, Clock, LogOut,
  Loader2, Plus, Trash2, Activity, Trophy, Medal, Award, Target, Zap,
} from 'lucide-react';
import { getPlayerInfo, savePlayerInfo, clearPlayerInfo, generateId } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import {
  doc, onSnapshot, updateDoc, arrayUnion,
  serverTimestamp, Timestamp, runTransaction,
} from 'firebase/firestore';
import type { Player, GameState } from '@/types/game';
import placeholders from '@/app/lib/placeholder-images.json';
import { ThemeToggle } from '@/components/theme-toggle';

/* ─────────────────────────────── constants ─── */
const ROUND_DURATION = 30;
const RESULTS_DISPLAY_DURATION = 3000;
const ALL_CORRECT_SKIP_DELAY = 1500;

/* ─────────────────────────────── style tokens ─── */
const T = {
  ink:       'var(--ink)',
  panel:     'var(--panel)',
  line:      'var(--panel-line)',
  paper:     'var(--paper)',
  dim:       'var(--paper-dim)',
  lime:      'var(--lime)',
  limeDim:   'var(--lime-dim)',
  signal:    'var(--signal)',
  fontMono:  'var(--font-jetbrains-mono), JetBrains Mono, monospace',
  fontDisp:  'var(--font-space-grotesk), Space Grotesk, sans-serif',
  fontBody:  'var(--font-inter), Inter, sans-serif',
};

/* ─────────────────────────────── reusable styles ─── */
const S: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh', background: T.ink, color: T.paper,
    fontFamily: T.fontBody, position: 'relative', overflowX: 'hidden',
  },
  grid: {
    position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
    backgroundImage: `linear-gradient(${T.line} 1px, transparent 1px), linear-gradient(90deg, ${T.line} 1px, transparent 1px)`,
    backgroundSize: '64px 64px', opacity: .35,
    maskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, black 40%, transparent 90%)',
  },
  card: {
    background: T.panel, border: `1px solid ${T.line}`,
    borderRadius: 14, padding: 24, position: 'relative',
  },
  btnFill: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontWeight: 600, fontSize: 14, padding: '11px 18px',
    borderRadius: 9, border: 'none', cursor: 'pointer',
    background: T.lime, color: T.ink, fontFamily: T.fontBody,
    transition: 'opacity .15s ease',
  },
  btnGhost: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontWeight: 600, fontSize: 14, padding: '11px 18px',
    borderRadius: 9, cursor: 'pointer', background: 'transparent',
    color: T.paper, border: `1px solid ${T.line}`, fontFamily: T.fontBody,
    transition: 'border-color .15s ease',
  },
  btnDanger: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontWeight: 600, fontSize: 13, padding: '9px 16px',
    borderRadius: 9, cursor: 'pointer', background: 'transparent',
    color: T.signal, border: `1px solid rgba(255,77,94,.3)`, fontFamily: T.fontBody,
  },
  input: {
    background: T.ink, border: `1px solid ${T.line}`,
    borderRadius: 9, padding: '12px 14px', color: T.paper,
    fontFamily: T.fontMono, fontSize: 16, outline: 'none', width: '100%',
  },
  eyebrow: {
    fontFamily: T.fontMono, fontSize: 11, letterSpacing: '.12em',
    textTransform: 'uppercase' as const, color: T.lime,
    display: 'inline-flex', alignItems: 'center', gap: 8,
    border: `1px solid ${T.limeDim}`, padding: '3px 10px', borderRadius: 99,
  },
  monoSm: {
    fontFamily: T.fontMono, fontSize: 11,
    letterSpacing: '.1em', textTransform: 'uppercase' as const, color: T.dim,
  },
};

/* ─────────────────────────────── small atoms ─── */
const Pill = ({ children, style }: { children: React.ReactNode; style?: CSSProperties }) => (
  <span style={{ ...S.eyebrow, ...style }}>{children}</span>
);

const MonoLabel = ({ children, style }: { children: React.ReactNode; style?: CSSProperties }) => (
  <div style={{ ...S.monoSm, ...style }}>{children}</div>
);

/* animated timer bar */
const TimerBar = ({ pct, urgent }: { pct: number; urgent: boolean }) => (
  <div style={{ height: 6, background: T.ink, borderRadius: 99, overflow: 'hidden', border: `1px solid ${T.line}` }}>
    <div style={{
      height: '100%', width: `${pct}%`,
      background: urgent ? T.signal : T.lime,
      transition: 'width .1s linear, background .3s ease',
      boxShadow: urgent ? `0 0 8px ${T.signal}` : `0 0 8px ${T.lime}`,
    }} />
  </div>
);

/* stat tile used in top bar */
const StatTile = ({ label, value, urgent }: { label: string; value: React.ReactNode; urgent?: boolean }) => (
  <div style={{
    flex: 1, padding: '10px 12px', borderRadius: 10,
    border: `1px solid ${urgent ? 'rgba(255,77,94,.4)' : T.line}`,
    background: urgent ? 'rgba(255,77,94,.05)' : 'rgba(0,0,0,.2)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
  }}>
    <MonoLabel style={{ fontSize: 10 }}>{label}</MonoLabel>
    <div style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 14, color: urgent ? T.signal : T.lime }}>
      {value}
    </div>
  </div>
);

/* leaderboard row */
const LbRow = ({ rank, name, score, isMe, hasAnswered, isCorrect, isActive }:
  { rank: number; name: string; score: number; isMe: boolean; isHost?: boolean; hasAnswered?: boolean; isCorrect?: boolean | null; isActive?: boolean }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', borderRadius: 9, marginBottom: 4,
    border: isMe ? `1px solid ${T.limeDim}` : '1px solid transparent',
    background: isMe ? 'rgba(200,255,77,.04)' : 'transparent',
    transition: 'background .2s',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, width: 18, color: rank <= 3 ? T.lime : T.dim }}>
        {rank}
      </span>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: T.line,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: T.fontMono, fontWeight: 700, fontSize: 11, color: T.lime,
        border: `1px solid ${T.line}`, overflow: 'hidden',
      }}>
        {name[0].toUpperCase()}
      </div>
      <span style={{ fontFamily: T.fontMono, fontSize: 12, color: isMe ? T.lime : T.paper, fontWeight: isMe ? 700 : 400 }}>
        {name}{isMe ? ' (you)' : ''}
      </span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {isActive && hasAnswered && (
        isCorrect === true
          ? <CheckCircle style={{ width: 13, height: 13, color: T.lime }} />
          : <XCircle style={{ width: 13, height: 13, color: T.signal }} />
      )}
      <span style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 13, color: T.paper }}>{score}</span>
    </div>
  </div>
);

/* ─────────────────────────────── page ─── */
const GameRoomPage: NextPage = () => {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const roomCode = params.roomCode as string;
  const isInitiallyHost = searchParams.get('host') === 'true';

  const [localPlayerInfo, setLocalPlayerInfo] = useState<{ playerId: string; playerName: string } | null>(null);
  const [inputPlayerName, setInputPlayerName] = useState('');
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(true);
  const [showScoreboard, setShowScoreboard] = useState(true);
  const [roundTimeLeft, setRoundTimeLeft] = useState(ROUND_DURATION);
  const [logoError, setLogoError] = useState(false);
  const [activeTab, setActiveTab] = useState<'lobby' | 'builder'>('lobby');
  const [newQ, setNewQ] = useState('');
  const [autoCalcAns, setAutoCalcAns] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);

  const roundEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const skipTransitionRef = useRef<boolean>(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  const evaluateExpression = (expr: string): number | null => {
    const san = expr.replace(/x/gi, '*').replace(/÷/g, '/').replace(/[^-+*/().0-9 ]/g, '');
    try {
      if (!san.trim()) return null;
      if (/[^0-9+\-*/(). ]/.test(san)) return null;
      const r = new Function(`return ${san}`)();
      return typeof r === 'number' && isFinite(r) ? Math.round(r * 100) / 100 : null;
    } catch { return null; }
  };

  useEffect(() => { setAutoCalcAns(evaluateExpression(newQ)); }, [newQ]);

  /* round timer */
  useEffect(() => {
    if (gameState?.isGameActive && !gameState?.isGameOver && !gameState?.isShowingResults && gameState?.currentRound > 0) {
      const id = setInterval(() => setRoundTimeLeft(p => p <= 0 ? (clearInterval(id), 0) : p - 1), 1000);
      return () => clearInterval(id);
    }
  }, [gameState?.currentRound, gameState?.isGameActive, gameState?.isGameOver, gameState?.isShowingResults]);

  const generateEquation = () => {
    const ops = ['+', '-', '*', '/'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    switch (op) {
      case '+': { const a = Math.floor(Math.random() * 9000) + 1000, b = Math.floor(Math.random() * 9000) + 1000; return { question: `${a} + ${b}`, answer: a + b }; }
      case '-': { const a = Math.floor(Math.random() * 9000) + 1000, b = Math.floor(Math.random() * 900) + 100; return { question: `${a} - ${b}`, answer: a - b }; }
      case '*': { const a = Math.floor(Math.random() * 90) + 10, b = Math.floor(Math.random() * 90) + 10; return { question: `${a} × ${b}`, answer: a * b }; }
      default:  { const d = Math.floor(Math.random() * 20) + 5, q = Math.floor(Math.random() * 50) + 10; return { question: `${d * q} ÷ ${d}`, answer: q }; }
    }
  };

  const updateFS = useCallback(async (updates: Partial<GameState>) => {
    if (!roomCode || !db) return;
    try { await updateDoc(doc(db!, 'gameRooms', roomCode), updates); } catch (e) { console.error(e); }
  }, [roomCode]);

  const currentPlayer = gameState?.players?.find(p => p.id === localPlayerInfo?.playerId);
  const isHost = currentPlayer?.isHost ?? false;
  const isPlayerCorrect = currentPlayer?.isCorrect === true;
  const sortedPlayers = gameState?.players ? [...gameState.players].sort((a, b) => b.score - a.score) : [];

  /* firestore listener */
  useEffect(() => {
    if (!roomCode || !db) return;
    const saved = getPlayerInfo();
    if (!localPlayerInfo && saved) setLocalPlayerInfo(saved);
    unsubscribeRef.current = onSnapshot(doc(db!, 'gameRooms', roomCode), snap => {
      if (snap.exists()) {
        const data = snap.data() as GameState;
        setGameState(prev => {
          if (prev?.currentRound !== data.currentRound && data.isGameActive && !data.isShowingResults) {
            setRoundTimeLeft(ROUND_DURATION);
            skipTransitionRef.current = false;
            setFeedback(null);
            setTimeout(() => answerInputRef.current?.focus(), 100);
          }
          return { ...data, roomCode };
        });
        setIsLoading(false);
        const p = getPlayerInfo();
        setIsJoining(!(p && data.players?.some(pl => pl.id === p.playerId)));
      } else { clearPlayerInfo(); router.push('/'); }
    }, () => setIsLoading(false));
    return () => {
      unsubscribeRef.current?.();
      if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
    };
  }, [roomCode, router, localPlayerInfo]);

  const endGame = useCallback(async () => {
    await updateFS({ isGameActive: false, isGameOver: true, isShowingResults: false, timeLeft: 0 });
  }, [updateFS]);

  const startGame = useCallback(async () => {
    if (!gameState || !isHost || gameState.isGameActive || !db) return;
    let q: string, a: number, idx = 0;
    if (gameState.customQuestions?.length) { q = gameState.customQuestions[0].question; a = gameState.customQuestions[0].answer; idx = 1; }
    else { const g = generateEquation(); q = g.question; a = g.answer; }
    const reset = gameState.players.map(p => ({ ...p, score: 0, hasAnswered: false, isCorrect: null, lastActive: Timestamp.now() }));
    setRoundTimeLeft(ROUND_DURATION);
    await updateFS({ question: q, answer: a, timeLeft: ROUND_DURATION, isGameActive: true, isGameOver: false, isShowingResults: false, currentRound: 1, players: reset, roundStartTime: serverTimestamp(), currentQuestionIndex: idx });
  }, [gameState, isHost, updateFS]);

  const nextQuestion = useCallback(async () => {
    if (!gameState || !isHost || !gameState.isGameActive || !db) return;
    if (roundEndTimeoutRef.current) clearTimeout(roundEndTimeoutRef.current);
    let q: string, a: number, idx = gameState.currentQuestionIndex ?? 0;
    if (gameState.customQuestions?.length && idx >= gameState.customQuestions.length) { endGame(); return; }
    if (gameState.customQuestions && idx < gameState.customQuestions.length) { q = gameState.customQuestions[idx].question; a = gameState.customQuestions[idx].answer; idx++; }
    else { const g = generateEquation(); q = g.question; a = g.answer; }
    const reset = gameState.players.map(p => ({ ...p, hasAnswered: false, isCorrect: null, lastActive: Timestamp.now() }));
    setRoundTimeLeft(ROUND_DURATION); setCurrentAnswer(''); setFeedback(null);
    await updateFS({ question: q, answer: a, timeLeft: ROUND_DURATION, isShowingResults: false, currentRound: (gameState.currentRound || 0) + 1, players: reset, roundStartTime: serverTimestamp(), currentQuestionIndex: idx });
  }, [gameState, isHost, updateFS, endGame]);

  const endRound = useCallback(async () => {
    if (!gameState || !isHost || gameState.isShowingResults || !gameState.isGameActive || !db) return;
    const updated = gameState.players.map(p => ({ ...p, isCorrect: p.hasAnswered ? p.isCorrect : false, lastActive: Timestamp.now() }));
    await updateFS({ players: updated, isShowingResults: true, timeLeft: 0 });
    roundEndTimeoutRef.current = setTimeout(() => nextQuestion(), RESULTS_DISPLAY_DURATION);
  }, [gameState, isHost, updateFS, nextQuestion]);

  useEffect(() => {
    if (!isHost || !gameState?.isGameActive || gameState.isShowingResults || !gameState.players?.length || skipTransitionRef.current) return;
    const allCorrect = gameState.players.every(p => p.isCorrect === true);
    const allAnswered = gameState.players.every(p => p.hasAnswered);
    if (allCorrect) { skipTransitionRef.current = true; setTimeout(() => nextQuestion(), ALL_CORRECT_SKIP_DELAY); }
    else if (allAnswered || roundTimeLeft <= 0) endRound();
  }, [gameState?.players, isHost, gameState?.isGameActive, gameState?.isShowingResults, roundTimeLeft, endRound, nextQuestion]);

  const handleJoinGame = async () => {
    const name = inputPlayerName.trim();
    if (!name || !db) return;
    const playerId = generateId();
    const shouldBeHost = isInitiallyHost && (gameState?.players?.length ?? 0) === 0;
    const newPlayer: Player = { id: playerId, name, score: 0, isHost: shouldBeHost, hasAnswered: false, isCorrect: null, lastActive: Timestamp.now() };
    savePlayerInfo(playerId, name);
    setLocalPlayerInfo({ playerId, playerName: name });
    try {
      await updateDoc(doc(db!, 'gameRooms', roomCode), { players: arrayUnion(newPlayer) });
      toast({ title: `Pulse sync'd · welcome ${name}` });
    } catch { toast({ title: 'Error joining', variant: 'destructive' }); }
  };

  const handleAnswerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPlayerInfo || !gameState?.isGameActive || gameState.isShowingResults || !currentAnswer || roundTimeLeft <= 0 || !db) return;
    const player = gameState.players.find(p => p.id === localPlayerInfo.playerId);
    if (!player || (player.hasAnswered && player.isCorrect)) return;
    const correct = parseFloat(currentAnswer) === gameState.answer;
    const scoreToAdd = correct ? Math.max(5, roundTimeLeft * 2 + 10) : 0;
    setFeedback(correct ? { text: `✓ correct +${scoreToAdd}`, ok: true } : { text: `✕ wrong — try again`, ok: false });
    try {
      await updateDoc(doc(db!, 'gameRooms', roomCode), {
        players: gameState.players.map(p => p.id === localPlayerInfo.playerId
          ? { ...p, score: (p.score ?? 0) + scoreToAdd, hasAnswered: true, isCorrect: correct, lastActive: Timestamp.now() } : p)
      });
    } catch (e) { console.error(e); }
    if (correct) setCurrentAnswer('');
  };

  const handleLeaveGame = useCallback(async () => {
    if (!localPlayerInfo || !roomCode || !db) return;
    const leaving = localPlayerInfo.playerId;
    clearPlayerInfo(); setLocalPlayerInfo(null);
    try {
      await runTransaction(db!, async tx => {
        const snap = await tx.get(doc(db!, 'gameRooms', roomCode));
        if (!snap.exists()) return;
        const d = snap.data() as GameState;
        const remaining = d.players.filter(p => p.id !== leaving);
        if (!remaining.length) { tx.delete(doc(db!, 'gameRooms', roomCode)); return; }
        const wasHost = d.players.find(p => p.id === leaving)?.isHost;
        tx.update(doc(db!, 'gameRooms', roomCode), {
          players: wasHost && !remaining.some(p => p.isHost) ? remaining.map((p, i) => i === 0 ? { ...p, isHost: true } : p) : remaining
        });
      });
    } catch (e) { console.error(e); }
    router.push('/');
  }, [localPlayerInfo, roomCode, router]);

  const handleAddCustomQuestion = async () => {
    if (!newQ.trim() || autoCalcAns === null || !gameState) return;
    await updateFS({ customQuestions: [...(gameState.customQuestions || []), { question: newQ, answer: autoCalcAns }] });
    setNewQ('');
  };

  const handleRemoveCustomQuestion = async (i: number) => {
    if (!gameState?.customQuestions) return;
    await updateFS({ customQuestions: gameState.customQuestions.filter((_, idx) => idx !== i) });
  };

  const handleResetLobby = async () => {
    await updateFS({ isGameOver: false, isGameActive: false, isShowingResults: false, currentRound: 0, players: gameState?.players.map(p => ({ ...p, score: 0, hasAnswered: false, isCorrect: null })) || [] });
  };

  const copyCode = () => { navigator.clipboard.writeText(roomCode); toast({ title: 'Code copied' }); };
  const copyLink = () => { navigator.clipboard.writeText(window.location.href.split('?')[0]); toast({ title: 'Link copied' }); };

  /* ── LOADING ───────────────────────────────────────── */
  if (isLoading) return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: T.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.fontMono, fontWeight: 700, color: T.ink, fontSize: 20 }}>+</div>
        <Loader2 style={{ width: 22, height: 22, color: T.lime, animation: 'spin 1s linear infinite' }} />
        <MonoLabel>connecting…</MonoLabel>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  /* ── JOIN SCREEN ───────────────────────────────────── */
  if (isJoining || !localPlayerInfo || !gameState?.players.some(p => p.id === localPlayerInfo?.playerId)) return (
    <div style={{ ...S.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={S.grid} />
      <div style={{ position: 'absolute', top: 16, right: 16 }}><ThemeToggle /></div>

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 2 }}>
        {/* brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          {!logoError ? (
            <div style={{ display: 'inline-block', background: T.panel, border: `1px solid ${T.line}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
              <Image src={placeholders.logo.url} alt={placeholders.logo.alt} width={130} height={40} priority style={{ height: 'auto' }} className="dark:invert dark:brightness-200" onError={() => setLogoError(true)} />
            </div>
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(200,255,77,.1)', border: `1px solid ${T.limeDim}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Activity style={{ width: 24, height: 24, color: T.lime }} />
            </div>
          )}
          <h1 style={{ fontFamily: T.fontDisp, fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>Sync your pulse</h1>
          <Pill>Room · {roomCode}</Pill>
        </div>

        {/* join card */}
        <div style={{ ...S.card, padding: 28 }}>
          <MonoLabel style={{ marginBottom: 8 }}>Your callsign</MonoLabel>
          <input
            style={{ ...S.input, textAlign: 'center', fontSize: 18, marginBottom: 14 }}
            placeholder="Enter your name"
            value={inputPlayerName}
            onChange={e => setInputPlayerName(e.target.value)}
            maxLength={15}
            onKeyDown={e => e.key === 'Enter' && handleJoinGame()}
            onFocus={e => { e.target.style.borderColor = T.lime; }}
            onBlur={e => { e.target.style.borderColor = T.line; }}
            autoFocus
          />
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <MonoLabel>{gameState?.players?.length ?? 0} / 12 players</MonoLabel>
              <MonoLabel>{gameState?.isGameActive ? '● round live' : '○ waiting'}</MonoLabel>
            </div>
            {/* player preview */}
            {(gameState?.players?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 0' }}>
                {gameState?.players.map(p => (
                  <div key={p.id} style={{ fontFamily: T.fontMono, fontSize: 11, padding: '3px 8px', borderRadius: 99, background: p.isHost ? 'rgba(200,255,77,.1)' : 'rgba(255,255,255,.04)', border: `1px solid ${p.isHost ? T.limeDim : T.line}`, color: p.isHost ? T.lime : T.paper }}>
                    {p.name}{p.isHost ? ' ⚡' : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            style={{ ...S.btnFill, width: '100%', justifyContent: 'center', height: 48, fontSize: 15, opacity: (!inputPlayerName.trim() || (gameState?.players?.length ?? 0) >= 12) ? .45 : 1 }}
            onClick={handleJoinGame}
            disabled={!inputPlayerName.trim() || (gameState?.players?.length ?? 0) >= 12}
          >
            Join round →
          </button>
        </div>
      </div>
    </div>
  );

  /* ── GAME OVER / PODIUM ────────────────────────────── */
  if (gameState.isGameOver) {
    const top3 = sortedPlayers.slice(0, 3);
    const podiumOrder = [top3[1], top3[0], top3[2]]; // 2nd, 1st, 3rd
    const heights = [80, 112, 56];
    const rankLabels = ['2nd', '1st', '3rd'];
    const rankColors = [T.dim, T.lime, '#F59E0B'];
    const icons = [
      <Medal key="m" style={{ width: 14, height: 14 }} />,
      <Trophy key="t" style={{ width: 14, height: 14 }} />,
      <Award key="a" style={{ width: 14, height: 14 }} />,
    ];

    return (
      <div style={{ ...S.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, minHeight: '100dvh' }}>
        <div style={S.grid} />
        <div style={{ position: 'absolute', top: 16, right: 16 }}><ThemeToggle /></div>

        <div style={{ width: '100%', maxWidth: 540, position: 'relative', zIndex: 2 }}>
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            {/* header */}
            <div style={{ padding: '32px 28px 24px', textAlign: 'center', borderBottom: `1px solid ${T.line}` }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(200,255,77,.1)', border: `1px solid ${T.limeDim}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <Trophy style={{ width: 22, height: 22, color: T.lime }} />
              </div>
              <h2 style={{ fontFamily: T.fontDisp, fontSize: 24, fontWeight: 700, margin: '0 0 6px' }}>Round complete</h2>
              <MonoLabel>Pulse champions · {roomCode}</MonoLabel>
            </div>

            {/* podium */}
            <div style={{ padding: '32px 28px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 12, borderBottom: `1px solid ${T.line}` }}>
              {podiumOrder.map((player, i) => {
                const actualRank = i === 0 ? 1 : i === 1 ? 0 : 2; // maps display pos to rank index
                if (!player) return <div key={i} style={{ width: 72 }} />;
                return (
                  <div key={player.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    {/* avatar */}
                    <div style={{ position: 'relative' }}>
                      <div style={{
                        width: actualRank === 0 ? 52 : 40, height: actualRank === 0 ? 52 : 40,
                        borderRadius: '50%', background: T.line,
                        border: `2px solid ${rankColors[actualRank]}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: T.fontMono, fontWeight: 700,
                        fontSize: actualRank === 0 ? 18 : 14,
                        color: rankColors[actualRank],
                      }}>
                        {player.name[0].toUpperCase()}
                      </div>
                      <div style={{
                        position: 'absolute', bottom: -2, right: -2,
                        width: 18, height: 18, borderRadius: '50%',
                        background: T.panel, border: `1px solid ${T.line}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: rankColors[actualRank],
                      }}>
                        {icons[actualRank]}
                      </div>
                    </div>
                    {/* name */}
                    <span style={{ fontFamily: T.fontMono, fontSize: 11, color: rankColors[actualRank], fontWeight: 700, maxWidth: 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {player.name}
                    </span>
                    {/* podium block */}
                    <div style={{
                      width: actualRank === 0 ? 72 : 56, height: heights[actualRank],
                      background: `rgba(${actualRank === 0 ? '200,255,77' : actualRank === 2 ? '245,158,11' : '168,174,186'},.1)`,
                      border: `1px solid ${rankColors[actualRank]}`,
                      borderBottom: 'none', borderRadius: '6px 6px 0 0',
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10,
                    }}>
                      <span style={{ fontFamily: T.fontMono, fontSize: 12, fontWeight: 700, color: rankColors[actualRank] }}>
                        {rankLabels[actualRank]}
                      </span>
                    </div>
                    {/* score */}
                    <span style={{ fontFamily: T.fontMono, fontSize: 13, fontWeight: 700, color: rankColors[actualRank] }}>
                      {player.score}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* full rankings */}
            <div style={{ padding: '16px 20px 8px' }}>
              <MonoLabel style={{ marginBottom: 10 }}>Full standings</MonoLabel>
              {sortedPlayers.map((p, i) => (
                <LbRow key={p.id} rank={i + 1} name={p.name} score={p.score}
                  isMe={p.id === localPlayerInfo?.playerId} isHost={p.isHost} />
              ))}
            </div>

            {/* actions */}
            <div style={{ padding: '16px 20px 28px', display: 'flex', gap: 10 }}>
              {isHost && (
                <button style={{ ...S.btnFill, flex: 1, justifyContent: 'center' }} onClick={handleResetLobby}>
                  Back to lobby
                </button>
              )}
              <button style={{ ...S.btnGhost, flex: 1, justifyContent: 'center' }} onClick={handleLeaveGame}>
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── ACTIVE ROOM ───────────────────────────────────── */
  const timerPct = (roundTimeLeft / ROUND_DURATION) * 100;
  const urgent = roundTimeLeft < 7 && gameState.isGameActive;

  return (
    <div style={{ ...S.page, display: 'flex', flexDirection: 'column', maxWidth: 680, margin: '0 auto' }}>
      <div style={S.grid} />
      <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 10 }}><ThemeToggle /></div>

      {/* ── TOP BAR ── */}
      <div style={{ position: 'relative', zIndex: 2, padding: '16px 16px 0' }}>
        <div style={{ ...S.card, padding: '16px 18px' }}>
          {/* brand + controls row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <button onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: T.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.fontMono, fontWeight: 700, color: T.ink, fontSize: 14 }}>+</div>
              <span style={{ fontFamily: T.fontDisp, fontWeight: 700, fontSize: 15 }}>Math<span style={{ color: T.lime }}>Pulse</span></span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: T.ink, borderRadius: 9, padding: '3px 4px', border: `1px solid ${T.line}` }}>
              <button onClick={copyCode} style={{ fontFamily: T.fontMono, fontWeight: 700, fontSize: 12, color: T.lime, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', letterSpacing: '.12em' }}>
                {roomCode}
              </button>
              <div style={{ width: 1, height: 14, background: T.line }} />
              <button onClick={copyLink} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.dim, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                <Share2 style={{ width: 13, height: 13 }} />
              </button>
              <button onClick={handleLeaveGame} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.signal, padding: '4px 6px', display: 'flex', alignItems: 'center' }}>
                <LogOut style={{ width: 13, height: 13 }} />
              </button>
            </div>
          </div>

          {/* stat tiles */}
          <div style={{ display: 'flex', gap: 8 }}>
            <StatTile label="Round" value={gameState.currentRound > 0 ? gameState.currentRound : '—'} />
            <StatTile
              label="Clock"
              urgent={urgent}
              value={
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock style={{ width: 11, height: 11 }} />
                  {gameState.isGameActive && !gameState.isShowingResults ? `${roundTimeLeft}s` : '—'}
                </span>
              }
            />
            <StatTile label="Players" value={
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Users style={{ width: 11, height: 11 }} />
                {gameState.players?.length ?? 0}
              </span>
            } />
          </div>

          {/* progress bar */}
          {gameState.isGameActive && !gameState.isShowingResults && roundTimeLeft > 0 && (
            <div style={{ marginTop: 12 }}>
              <TimerBar pct={timerPct} urgent={urgent} />
            </div>
          )}
        </div>
      </div>

      {/* ── SCOREBOARD ── */}
      <div style={{ position: 'relative', zIndex: 2, padding: '8px 16px 0' }}>
        <button
          onClick={() => setShowScoreboard(s => !s)}
          style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', color: T.dim, fontFamily: T.fontMono, fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', padding: '6px 0', opacity: .5 }}
          onMouseEnter={e => (e.currentTarget.style.color = T.lime)}
          onMouseLeave={e => (e.currentTarget.style.color = T.dim)}
        >
          {showScoreboard ? 'Hide standings ↑' : 'Show standings ↓'}
        </button>

        {showScoreboard && (
          <div style={{ ...S.card, padding: '8px 10px', maxHeight: gameState.isGameActive ? 110 : 160, overflowY: 'auto' }}>
            {sortedPlayers.map((p, i) => (
              <LbRow key={p.id} rank={i + 1} name={p.name} score={p.score}
                isMe={p.id === localPlayerInfo?.playerId}
                isHost={p.isHost}
                hasAnswered={p.hasAnswered}
                isCorrect={p.isCorrect}
                isActive={gameState.isGameActive} />
            ))}
          </div>
        )}
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', position: 'relative', zIndex: 2 }}>

        {gameState.isGameActive ? (
          /* ── LIVE QUESTION ── */
          <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* question card */}
            <div style={{
              ...S.card,
              textAlign: 'center', padding: '32px 24px',
              border: isPlayerCorrect ? `1px solid ${T.limeDim}` : `1px solid ${T.line}`,
              background: isPlayerCorrect ? 'rgba(200,255,77,.04)' : T.panel,
              transition: 'border-color .3s ease, background .3s ease',
            }}>
              <Pill style={{ marginBottom: 16 }}>
                Target locked · round {gameState.currentRound}
              </Pill>
              <div style={{
                fontFamily: T.fontMono, fontWeight: 700,
                fontSize: 'clamp(32px, 7vw, 52px)',
                letterSpacing: '.02em',
                color: isPlayerCorrect ? T.lime : T.paper,
                transition: 'color .3s ease',
                lineHeight: 1.1, margin: '8px 0',
              }}>
                {(gameState.isShowingResults || isPlayerCorrect)
                  ? `${gameState.question} = ${gameState.answer}`
                  : `${gameState.question} = ?`}
              </div>
              {gameState.isShowingResults && (
                <MonoLabel style={{ marginTop: 12, color: T.lime }}>Result revealed · next question incoming…</MonoLabel>
              )}
            </div>

            {/* answer form */}
            <form onSubmit={handleAnswerSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                ref={answerInputRef}
                type="number"
                placeholder="Your answer"
                value={currentAnswer}
                onChange={e => { setCurrentAnswer(e.target.value); if (feedback?.ok === false) setFeedback(null); }}
                disabled={isPlayerCorrect || gameState.isShowingResults}
                style={{
                  ...S.input,
                  textAlign: 'center', fontSize: 22, fontWeight: 700,
                  padding: '16px', height: 60,
                  borderColor: isPlayerCorrect ? T.limeDim : T.line,
                  opacity: (isPlayerCorrect || gameState.isShowingResults) ? .5 : 1,
                }}
                onFocus={e => { if (!isPlayerCorrect) e.target.style.borderColor = T.lime; }}
                onBlur={e => { e.target.style.borderColor = isPlayerCorrect ? T.limeDim : T.line; }}
              />
              {/* feedback */}
              <div style={{ height: 18, textAlign: 'center', fontFamily: T.fontMono, fontSize: 13, color: feedback?.ok ? T.lime : T.signal, transition: 'color .2s' }}>
                {feedback?.text ?? ''}
              </div>
              <button
                type="submit"
                disabled={isPlayerCorrect || !currentAnswer || gameState.isShowingResults}
                style={{
                  ...S.btnFill, width: '100%', justifyContent: 'center',
                  height: 52, fontSize: 15,
                  opacity: (isPlayerCorrect || !currentAnswer || gameState.isShowingResults) ? .45 : 1,
                }}
              >
                {isPlayerCorrect ? '✓ Sync locked' : 'Submit pulse'}
              </button>
            </form>

            {/* host end-game button */}
            {isHost && (
              <button style={{ ...S.btnDanger, width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={endGame}>
                <Trash2 style={{ width: 14, height: 14 }} /> End challenge session
              </button>
            )}
          </div>
        ) : (
          /* ── LOBBY / PRE-GAME ── */
          <div style={{ width: '100%', maxWidth: 520 }}>
            <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
              {isHost ? (
                <>
                  {/* tabs */}
                  <div style={{ display: 'flex', borderBottom: `1px solid ${T.line}` }}>
                    {(['lobby', 'builder'] as const).map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        style={{
                          flex: 1, padding: '14px 0', background: 'none', border: 'none', cursor: 'pointer',
                          fontFamily: T.fontMono, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase',
                          color: activeTab === tab ? T.lime : T.dim,
                          borderBottom: activeTab === tab ? `2px solid ${T.lime}` : '2px solid transparent',
                          transition: 'color .2s, border-color .2s',
                        }}>
                        {tab === 'lobby' ? 'Lobby' : 'Question Builder'}
                      </button>
                    ))}
                  </div>

                  {activeTab === 'lobby' && (
                    <div style={{ padding: '28px 24px', textAlign: 'center' }}>
                      <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(200,255,77,.08)', border: `1px solid ${T.limeDim}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                        <Target style={{ width: 22, height: 22, color: T.lime }} />
                      </div>
                      <h3 style={{ fontFamily: T.fontDisp, fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Ready for sync</h3>
                      <MonoLabel style={{ marginBottom: 20 }}>{gameState.players?.length ?? 0} player{gameState.players?.length !== 1 ? 's' : ''} in room · share code to invite</MonoLabel>

                      {/* share row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24, padding: '12px 16px', background: T.ink, borderRadius: 10, border: `1px solid ${T.line}` }}>
                        <span style={{ fontFamily: T.fontMono, fontSize: 22, fontWeight: 700, color: T.lime, letterSpacing: '.1em' }}>{roomCode}</span>
                        <button onClick={copyCode} style={{ background: 'none', border: `1px solid ${T.line}`, borderRadius: 7, padding: '4px 10px', cursor: 'pointer', color: T.dim, fontFamily: T.fontMono, fontSize: 11 }}>copy</button>
                      </div>

                      <button style={{ ...S.btnFill, width: '100%', justifyContent: 'center', height: 52, fontSize: 15 }} onClick={startGame}>
                        <Zap style={{ width: 16, height: 16 }} /> Start pulse
                      </button>
                    </div>
                  )}

                  {activeTab === 'builder' && (
                    <div style={{ padding: '20px 24px' }}>
                      <MonoLabel style={{ marginBottom: 10 }}>Custom question pool ({(gameState.customQuestions || []).length})</MonoLabel>
                      <p style={{ fontSize: 13, color: T.dim, marginBottom: 16, lineHeight: 1.5 }}>
                        Add your own equations — answer is auto-calculated. Leave empty to use random generated questions.
                      </p>

                      {/* add row */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                        <input
                          placeholder="e.g. 15 × 12"
                          value={newQ}
                          onChange={e => setNewQ(e.target.value)}
                          style={{ ...S.input, flex: 1, fontSize: 14, padding: '10px 12px' }}
                          onFocus={e => { e.target.style.borderColor = T.lime; }}
                          onBlur={e => { e.target.style.borderColor = T.line; }}
                        />
                        {autoCalcAns !== null && (
                          <div style={{ display: 'flex', alignItems: 'center', fontFamily: T.fontMono, fontSize: 14, color: T.lime, fontWeight: 700, minWidth: 36 }}>= {autoCalcAns}</div>
                        )}
                        <button
                          onClick={handleAddCustomQuestion}
                          disabled={autoCalcAns === null}
                          style={{ ...S.btnFill, padding: '10px 14px', opacity: autoCalcAns === null ? .4 : 1 }}
                        >
                          <Plus style={{ width: 16, height: 16 }} />
                        </button>
                      </div>

                      {/* list */}
                      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                        {(gameState.customQuestions || []).length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '20px 0', color: T.dim, fontFamily: T.fontMono, fontSize: 12 }}>
                            No custom questions yet — random questions will be used
                          </div>
                        ) : (gameState.customQuestions || []).map((q, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: `1px solid ${T.line}`, borderRadius: 9, background: T.ink }}>
                            <span style={{ fontFamily: T.fontMono, fontSize: 13 }}>
                              {q.question} = <span style={{ color: T.lime, fontWeight: 700 }}>{q.answer}</span>
                            </span>
                            <button onClick={() => handleRemoveCustomQuestion(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.signal, padding: '2px 6px', display: 'flex', alignItems: 'center' }}>
                              <Trash2 style={{ width: 13, height: 13 }} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <button style={{ ...S.btnFill, width: '100%', justifyContent: 'center', height: 48 }} onClick={startGame}>
                        <Zap style={{ width: 15, height: 15 }} />
                        {(gameState.customQuestions || []).length > 0 ? 'Deploy custom pool' : 'Start with random questions'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* waiting (non-host) */
                <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(200,255,77,.08)', border: `1px solid ${T.limeDim}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <Activity style={{ width: 22, height: 22, color: T.lime, animation: 'pulse 2s ease-in-out infinite' }} />
                  </div>
                  <h3 style={{ fontFamily: T.fontDisp, fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Waiting for sync</h3>
                  <MonoLabel style={{ marginBottom: 20 }}>Host is setting up the round…</MonoLabel>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: T.lime, animation: `bounce 1.2s ease-in-out ${i * .2}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100% { opacity:1; } 50% { opacity:.4; } }
        @keyframes bounce  { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }
      `}</style>
    </div>
  );
};

export default GameRoomPage;
