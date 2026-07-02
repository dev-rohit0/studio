'use client';

/**
 * ─── BEFORE YOU DROP THIS IN ──────────────────────────────────
 * 1. npm install canvas-confetti @types/canvas-confetti
 *
 * 2. Add these fields to src/types/game.ts → GameState:
 *    difficulty:           'easy' | 'medium' | 'hard'
 *    roundCount:           number
 *    roundType:            'exact' | 'estimation'
 *    estimationOptions:    string[]
 *    firstCorrectPlayerId: string | null
 *    reactions:            ReactionEvent[]
 *
 * 3. Add to src/types/game.ts → Player:
 *    stolenPoints: number   (running total stolen from this player)
 * ──────────────────────────────────────────────────────────────
 */

import type { NextPage } from 'next';
import { useState, useEffect, useCallback, useRef, CSSProperties } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle, XCircle, Users, Share2, Clock, LogOut,
  Loader2, Plus, Trash2, Activity, Trophy, Medal, Award,
  Target, Zap, Mic, MicOff, BarChart2,
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

/* ─────────────────── types ─── */
type Difficulty = 'easy' | 'medium' | 'hard';
type RoundCount  = 5 | 10 | 20;
type RoundType   = 'exact' | 'estimation';
interface ReactionEvent { id: string; playerId: string; playerName: string; emoji: string; ts: number; }

/* ─────────────────── constants ─── */
const ROUND_DURATION          = 30;
const RESULTS_DISPLAY_DURATION = 3000;
const ALL_CORRECT_SKIP_DELAY  = 1500;
const STEAL_AMOUNT            = 5;
const REACTION_EMOJIS         = ['🔥','💀','⚡','🧠'] as const;
const REACTION_TTL_MS         = 3500;
/* estimation round fires every N-th round */
const ESTIMATION_EVERY        = 3;

/* ─────────────────── style tokens ─── */
const T = {
  ink:      'var(--ink)',
  panel:    'var(--panel)',
  line:     'var(--panel-line)',
  paper:    'var(--paper)',
  dim:      'var(--paper-dim)',
  lime:     'var(--lime)',
  limeDim:  'var(--lime-dim)',
  signal:   'var(--signal)',
  mono:     'var(--font-jetbrains-mono), JetBrains Mono, monospace',
  disp:     'var(--font-space-grotesk), Space Grotesk, sans-serif',
  body:     'var(--font-inter), Inter, sans-serif',
};

const S: Record<string, CSSProperties> = {
  page:     { minHeight:'100dvh', background:T.ink, color:T.paper, fontFamily:T.body, position:'relative', overflowX:'hidden' },
  grid:     { position:'fixed', inset:0, zIndex:0, pointerEvents:'none', backgroundImage:`linear-gradient(${T.line} 1px,transparent 1px),linear-gradient(90deg,${T.line} 1px,transparent 1px)`, backgroundSize:'64px 64px', opacity:.35, maskImage:'radial-gradient(ellipse 90% 60% at 50% 0%,black 40%,transparent 90%)' },
  card:     { background:T.panel, border:`1px solid ${T.line}`, borderRadius:14, padding:24, position:'relative' },
  btnFill:  { display:'inline-flex', alignItems:'center', gap:8, fontWeight:600, fontSize:14, padding:'11px 18px', borderRadius:9, border:'none', cursor:'pointer', background:T.lime, color:T.ink, fontFamily:T.body, transition:'opacity .15s ease' },
  btnGhost: { display:'inline-flex', alignItems:'center', gap:8, fontWeight:600, fontSize:14, padding:'11px 18px', borderRadius:9, cursor:'pointer', background:'transparent', color:T.paper, border:`1px solid ${T.line}`, fontFamily:T.body },
  btnDanger:{ display:'inline-flex', alignItems:'center', gap:8, fontWeight:600, fontSize:13, padding:'9px 16px', borderRadius:9, cursor:'pointer', background:'transparent', color:T.signal, border:`1px solid rgba(255,77,94,.3)`, fontFamily:T.body },
  input:    { background:T.ink, border:`1px solid ${T.line}`, borderRadius:9, padding:'12px 14px', color:T.paper, fontFamily:T.mono, fontSize:16, outline:'none', width:'100%' },
  monoSm:   { fontFamily:T.mono, fontSize:11, letterSpacing:'.1em', textTransform:'uppercase' as const, color:T.dim },
  eyebrow:  { fontFamily:T.mono, fontSize:11, letterSpacing:'.12em', textTransform:'uppercase' as const, color:T.lime, display:'inline-flex', alignItems:'center', gap:8, border:`1px solid ${T.limeDim}`, padding:'3px 10px', borderRadius:99 },
};

/* ─────────────────── atoms ─── */
const MonoLabel = ({ children, style }: { children: React.ReactNode; style?: CSSProperties }) =>
  <div style={{ ...S.monoSm, ...style }}>{children}</div>;

const Pill = ({ children, style }: { children: React.ReactNode; style?: CSSProperties }) =>
  <span style={{ ...S.eyebrow, ...style }}>{children}</span>;

const TimerBar = ({ pct, urgent }: { pct: number; urgent: boolean }) => (
  <div style={{ height:6, background:T.ink, borderRadius:99, overflow:'hidden', border:`1px solid ${T.line}` }}>
    <div style={{ height:'100%', width:`${pct}%`, background: urgent ? T.signal : T.lime, transition:'width .1s linear,background .3s ease', boxShadow: urgent ? `0 0 8px ${T.signal}` : `0 0 8px ${T.lime}` }} />
  </div>
);

const StatTile = ({ label, value, urgent }: { label: string; value: React.ReactNode; urgent?: boolean }) => (
  <div style={{ flex:1, padding:'10px 12px', borderRadius:10, border:`1px solid ${urgent ? 'rgba(255,77,94,.4)' : T.line}`, background: urgent ? 'rgba(255,77,94,.05)' : 'rgba(0,0,0,.2)', display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
    <MonoLabel style={{ fontSize:10 }}>{label}</MonoLabel>
    <div style={{ fontFamily:T.mono, fontWeight:700, fontSize:14, color: urgent ? T.signal : T.lime }}>{value}</div>
  </div>
);

/* ── Scoreboard row ── */
const LbRow = ({ rank, player, isMe, isActive, firstCorrectId }: {
  rank: number; player: Player; isMe: boolean; isActive?: boolean; firstCorrectId?: string | null;
}) => {
  const isFastest = firstCorrectId && player.id === firstCorrectId;
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', borderRadius:9, marginBottom:4, border: isMe ? `1px solid ${T.limeDim}` : '1px solid transparent', background: isMe ? 'rgba(200,255,77,.04)' : 'transparent', transition:'background .2s' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, width:18, color: rank <= 3 ? T.lime : T.dim }}>{rank}</span>
        <div style={{ width:28, height:28, borderRadius:'50%', background:T.line, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:T.mono, fontWeight:700, fontSize:11, color:T.lime }}>
          {player.name[0].toUpperCase()}
        </div>
        <span style={{ fontFamily:T.mono, fontSize:12, color: isMe ? T.lime : T.paper, fontWeight: isMe ? 700 : 400 }}>
          {player.name}{isMe ? ' (you)' : ''}
        </span>
        {player.isHost && <Zap style={{ width:11, height:11, color:T.lime }} />}
        {isFastest && <span title="Fastest finger" style={{ fontSize:12 }}>⚡</span>}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        {isActive && player.hasAnswered && (
          player.isCorrect === true
            ? <CheckCircle style={{ width:13, height:13, color:T.lime }} />
            : <XCircle    style={{ width:13, height:13, color:T.signal }} />
        )}
        {(player as any).stolenPoints > 0 && (
          <span title={`Lost ${(player as any).stolenPoints} pts to pulse steals`} style={{ fontFamily:T.mono, fontSize:10, color:T.signal }}>-{(player as any).stolenPoints}</span>
        )}
        <span style={{ fontFamily:T.mono, fontWeight:700, fontSize:13, color:T.paper }}>{player.score}</span>
      </div>
    </div>
  );
};

/* ── Floating reactions overlay ── */
const ReactionsOverlay = ({ reactions, myId }: { reactions: ReactionEvent[]; myId: string }) => {
  const now = Date.now();
  const visible = reactions.filter(r => now - r.ts < REACTION_TTL_MS);
  if (!visible.length) return null;
  return (
    <div style={{ position:'fixed', bottom:100, right:20, zIndex:99, display:'flex', flexDirection:'column-reverse', gap:8, pointerEvents:'none' }}>
      {visible.slice(-6).map(r => (
        <div key={r.id} style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(17,22,31,.9)', border:`1px solid ${T.line}`, borderRadius:99, padding:'4px 12px', backdropFilter:'blur(8px)', animation:'floatUp .4s ease' }}>
          <span style={{ fontSize:18 }}>{r.emoji}</span>
          <span style={{ fontFamily:T.mono, fontSize:11, color: r.playerId === myId ? T.lime : T.dim }}>{r.playerName}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Reaction bar ── */
const ReactionBar = ({ onReact }: { onReact: (emoji: string) => void }) => (
  <div style={{ display:'flex', gap:6, justifyContent:'center', padding:'10px 0' }}>
    {REACTION_EMOJIS.map(e => (
      <button key={e} onClick={() => onReact(e)}
        style={{ fontSize:20, background:'rgba(255,255,255,.04)', border:`1px solid ${T.line}`, borderRadius:10, padding:'8px 14px', cursor:'pointer', transition:'transform .1s ease, background .1s ease' }}
        onMouseEnter={el => { (el.currentTarget as HTMLElement).style.background = 'rgba(200,255,77,.08)'; (el.currentTarget as HTMLElement).style.transform = 'scale(1.15)'; }}
        onMouseLeave={el => { (el.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.04)'; (el.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
      >{e}</button>
    ))}
  </div>
);

/* ── Estimation options ── */
const EstimationOptions = ({ answer, options, disabled, onSelect, selected }: {
  answer: number; options: string[]; disabled: boolean; onSelect: (opt: string) => void; selected: string | null;
}) => (
  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
    {options.map(opt => {
      const [lo, hi] = opt.split('–').map(Number);
      const isCorrect = answer >= lo && answer <= hi;
      const isPicked  = selected === opt;
      return (
        <button key={opt} onClick={() => !disabled && onSelect(opt)} disabled={disabled}
          style={{ padding:'16px 12px', borderRadius:11, fontFamily:T.mono, fontSize:15, fontWeight:700, cursor: disabled ? 'default' : 'pointer', border: isPicked ? (isCorrect ? `2px solid ${T.lime}` : `2px solid ${T.signal}`) : `1px solid ${T.line}`, background: isPicked ? (isCorrect ? 'rgba(200,255,77,.08)' : 'rgba(255,77,94,.08)') : 'rgba(0,0,0,.2)', color: isPicked ? (isCorrect ? T.lime : T.signal) : T.paper, transition:'all .15s ease' }}>
          {opt}
        </button>
      );
    })}
  </div>
);

/* ── Voice button ── */
const VoiceButton = ({ onResult, disabled }: { onResult: (val: string) => void; disabled: boolean }) => {
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);

  const toggle = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Voice input not supported in this browser.'); return; }
    if (listening) { recogRef.current?.stop(); return; }
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    r.onstart  = () => setListening(true);
    r.onend    = () => setListening(false);
    r.onerror  = () => setListening(false);
    r.onresult = (e: any) => {
      const raw = e.results[0][0].transcript.trim();
      const num = raw.replace(/[^0-9.\-]/g, '');
      if (num) onResult(num);
    };
    recogRef.current = r;
    r.start();
  };

  return (
    <button type="button" onClick={toggle} disabled={disabled} title={listening ? 'Listening…' : 'Voice input'}
      style={{ padding:'0 14px', height:60, borderRadius:9, border:`1px solid ${listening ? T.lime : T.line}`, background: listening ? 'rgba(200,255,77,.08)' : T.ink, cursor: disabled ? 'default' : 'pointer', color: listening ? T.lime : T.dim, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s ease', flexShrink:0, animation: listening ? 'pulseBorder 1s ease-in-out infinite' : 'none' }}>
      {listening ? <Mic style={{ width:18, height:18 }} /> : <MicOff style={{ width:18, height:18 }} />}
    </button>
  );
};

/* ── Difficulty badge ── */
const DiffBadge = ({ d }: { d: Difficulty }) => {
  const map = { easy: { label:'Easy', color:'#4ADE80' }, medium: { label:'Medium', color:T.lime }, hard: { label:'Hard', color:T.signal } };
  return <span style={{ fontFamily:T.mono, fontSize:11, letterSpacing:'.1em', textTransform:'uppercase', color: map[d].color, border:`1px solid ${map[d].color}44`, padding:'2px 8px', borderRadius:99 }}>{map[d].label}</span>;
};

/* ─────────────────── helpers ─── */

function generateEquation(difficulty: Difficulty = 'medium'): { question: string; answer: number } {
  const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  switch (difficulty) {
    case 'easy': {
      const ops = ['+', '-'];
      const op  = ops[rand(0,1)];
      if (op === '+') { const a=rand(1,50),b=rand(1,50); return { question:`${a} + ${b}`, answer:a+b }; }
      else            { const a=rand(10,99),b=rand(1,a);  return { question:`${a} − ${b}`, answer:a-b }; }
    }
    case 'hard': {
      const ops = ['+','-','×','÷'];
      const op  = ops[rand(0,3)];
      if (op==='+') { const a=rand(1000,9999),b=rand(1000,9999); return { question:`${a} + ${b}`, answer:a+b }; }
      if (op==='-') { const a=rand(1000,9999),b=rand(100,999);   return { question:`${a} − ${b}`, answer:a-b }; }
      if (op==='×') { const a=rand(11,99),b=rand(11,99);         return { question:`${a} × ${b}`, answer:a*b }; }
      const d=rand(5,25),q=rand(10,99); return { question:`${d*q} ÷ ${d}`, answer:q };
    }
    default: { // medium
      const ops = ['+','-','×'];
      const op  = ops[rand(0,2)];
      if (op==='+') { const a=rand(100,999),b=rand(100,999); return { question:`${a} + ${b}`, answer:a+b }; }
      if (op==='-') { const a=rand(200,999),b=rand(50,200);  return { question:`${a} − ${b}`, answer:a-b }; }
      const a=rand(11,49),b=rand(11,49); return { question:`${a} × ${b}`, answer:a*b };
    }
  }
}

function generateEstimationOptions(answer: number): string[] {
  const step   = answer < 50 ? 10 : answer < 500 ? 50 : answer < 5000 ? 500 : 5000;
  const bucket = Math.floor(answer / step) * step;
  // build 4 consecutive buckets, correct one somewhere in them
  const correctIdx = 1; // put correct bucket at index 1 → not always first
  const start = bucket - correctIdx * step;
  const opts  = Array.from({ length: 4 }, (_, i) => `${start + i*step}–${start + (i+1)*step - 1}`);
  // shuffle so correct isn't always in same position
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}

async function fireConfetti() {
  try {
    const { default: confetti } = await import('canvas-confetti');
    confetti({ particleCount: 180, spread: 80, origin: { y: 0.6 }, colors: ['#C8FF4D','#FFFFFF','#FF4D5E','#3D6BFF'] });
    setTimeout(() => confetti({ particleCount: 80, spread: 120, origin: { y: 0.5 }, colors: ['#C8FF4D','#8FB838'] }), 300);
  } catch {}
}

/* ─────────────────── PAGE ─── */
const GameRoomPage: NextPage = () => {
  const params       = useParams();
  const searchParams = useSearchParams();
  const router       = useRouter();
  const { toast }    = useToast();
  const roomCode     = params.roomCode as string;
  const isInitHost   = searchParams.get('host') === 'true';

  /* ── state ── */
  const [localPlayerInfo, setLocalPlayerInfo] = useState<{ playerId: string; playerName: string } | null>(null);
  const [inputName,       setInputName]        = useState('');
  const [currentAnswer,   setCurrentAnswer]    = useState('');
  const [estimSelected,   setEstimSelected]    = useState<string | null>(null);
  const [gameState,       setGameState]        = useState<GameState | null>(null);
  const [isLoading,       setIsLoading]        = useState(true);
  const [isJoining,       setIsJoining]        = useState(true);
  const [showScoreboard,  setShowScoreboard]   = useState(true);
  const [roundTimeLeft,   setRoundTimeLeft]    = useState(ROUND_DURATION);
  const [logoError,       setLogoError]        = useState(false);
  const [activeTab,       setActiveTab]        = useState<'lobby'|'builder'>('lobby');
  const [newQ,            setNewQ]             = useState('');
  const [autoCalcAns,     setAutoCalcAns]      = useState<number | null>(null);
  const [feedback,        setFeedback]         = useState<{ text: string; ok: boolean } | null>(null);
  const [localReactions,  setLocalReactions]   = useState<ReactionEvent[]>([]);
  /* lobby settings (host only, written to FS on start) */
  const [selectedDiff,    setSelectedDiff]     = useState<Difficulty>('medium');
  const [selectedCount,   setSelectedCount]    = useState<RoundCount>(10);

  const roundEndRef  = useRef<NodeJS.Timeout | null>(null);
  const skipRef      = useRef(false);
  const unsub        = useRef<(() => void) | null>(null);
  const answerRef    = useRef<HTMLInputElement>(null);

  /* ── auto-calc ── */
  useEffect(() => {
    const san = newQ.replace(/x/gi,'*').replace(/÷/g,'/').replace(/[^-+*/().0-9 ]/g,'');
    try {
      if (!san.trim()) { setAutoCalcAns(null); return; }
      const r = new Function(`return ${san}`)();
      setAutoCalcAns(typeof r==='number' && isFinite(r) ? Math.round(r*100)/100 : null);
    } catch { setAutoCalcAns(null); }
  }, [newQ]);

  /* ── round timer ── */
  useEffect(() => {
    if (gameState?.isGameActive && !gameState.isGameOver && !gameState.isShowingResults && gameState.currentRound > 0) {
      const id = setInterval(() => setRoundTimeLeft(p => p <= 0 ? (clearInterval(id), 0) : p - 1), 1000);
      return () => clearInterval(id);
    }
  }, [gameState?.currentRound, gameState?.isGameActive, gameState?.isGameOver, gameState?.isShowingResults]);

  /* ── reaction GC (keep UI fresh) ── */
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setLocalReactions(r => r.filter(x => now - x.ts < REACTION_TTL_MS));
    }, 500);
    return () => clearInterval(id);
  }, []);

  /* ── merge incoming reactions from FS ── */
  useEffect(() => {
    if (!gameState) return;
    const fsReactions: ReactionEvent[] = (gameState as any).reactions || [];
    if (fsReactions.length) {
      setLocalReactions(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const fresh = fsReactions.filter(r => !existingIds.has(r.id) && Date.now() - r.ts < REACTION_TTL_MS);
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    }
  }, [(gameState as any)?.reactions]);

  const updateFS = useCallback(async (updates: Partial<GameState>) => {
    if (!roomCode || !db) return;
    try { await updateDoc(doc(db!, 'gameRooms', roomCode), updates); } catch (e) { console.error(e); }
  }, [roomCode]);

  const currentPlayer   = gameState?.players?.find(p => p.id === localPlayerInfo?.playerId);
  const isHost          = currentPlayer?.isHost ?? false;
  const isPlayerCorrect = currentPlayer?.isCorrect === true;
  const sortedPlayers   = gameState?.players ? [...gameState.players].sort((a,b) => b.score - a.score) : [];
  const difficulty      = ((gameState as any)?.difficulty as Difficulty) || 'medium';
  const roundCount      = ((gameState as any)?.roundCount as RoundCount) || 10;
  const roundType       = ((gameState as any)?.roundType as RoundType) || 'exact';
  const estOptions      = ((gameState as any)?.estimationOptions as string[]) || [];
  const firstCorrectId  = ((gameState as any)?.firstCorrectPlayerId as string | null) || null;
  const isEstimRound    = roundType === 'estimation';

  /* ── firestore listener ── */
  useEffect(() => {
    if (!roomCode || !db) return;
    const saved = getPlayerInfo();
    if (!localPlayerInfo && saved) setLocalPlayerInfo(saved);
    unsub.current = onSnapshot(doc(db!, 'gameRooms', roomCode), snap => {
      if (snap.exists()) {
        const data = snap.data() as GameState;
        setGameState(prev => {
          if (prev?.currentRound !== data.currentRound && data.isGameActive && !data.isShowingResults) {
            setRoundTimeLeft(ROUND_DURATION);
            skipRef.current = false;
            setFeedback(null);
            setEstimSelected(null);
            setTimeout(() => answerRef.current?.focus(), 80);
          }
          return { ...data, roomCode };
        });
        setIsLoading(false);
        const p = getPlayerInfo();
        setIsJoining(!(p && data.players?.some(pl => pl.id === p.playerId)));
      } else { clearPlayerInfo(); router.push('/'); }
    }, () => setIsLoading(false));
    return () => { unsub.current?.(); if (roundEndRef.current) clearTimeout(roundEndRef.current); };
  }, [roomCode, router, localPlayerInfo]);

  /* ── game flow ── */
  const endGame = useCallback(async () => {
    await updateFS({ isGameActive:false, isGameOver:true, isShowingResults:false, timeLeft:0 });
  }, [updateFS]);

  const buildNextQuestion = useCallback((gs: GameState, nextIdx: number) => {
    const diff     = ((gs as any).difficulty as Difficulty) || 'medium';
    const rCount   = ((gs as any).roundCount as number) || 10;
    const nextRound = (gs.currentRound || 0) + 1;

    // custom pool
    if (gs.customQuestions?.length) {
      if (nextIdx >= gs.customQuestions.length) return null; // signal end
      return { q: gs.customQuestions[nextIdx].question, a: gs.customQuestions[nextIdx].answer, idx: nextIdx + 1, isEnd: false };
    }
    // round count limit (only for random)
    if (nextRound > rCount) return null;
    const { question, answer } = generateEquation(diff);
    return { q: question, a: answer, idx: nextIdx, isEnd: false };
  }, []);

  const nextQuestion = useCallback(async () => {
    if (!gameState || !isHost || !gameState.isGameActive || !db) return;
    if (roundEndRef.current) clearTimeout(roundEndRef.current);

    const nextIdx = (gameState.currentQuestionIndex ?? 0);
    const built = buildNextQuestion(gameState, nextIdx);
    if (!built) { endGame(); return; }

    const nextRound = (gameState.currentRound || 0) + 1;
    const isEstim   = nextRound % ESTIMATION_EVERY === 0;
    const opts      = isEstim ? generateEstimationOptions(built.a) : [];

    const reset = gameState.players.map(p => ({ ...p, hasAnswered:false, isCorrect:null, lastActive:Timestamp.now() }));
    setRoundTimeLeft(ROUND_DURATION); setCurrentAnswer(''); setFeedback(null); setEstimSelected(null);

    await updateFS({
      question: built.q, answer: built.a, timeLeft: ROUND_DURATION,
      isShowingResults: false, currentRound: nextRound,
      players: reset, roundStartTime: serverTimestamp(),
      currentQuestionIndex: built.idx,
      firstCorrectPlayerId: null,
      roundType: isEstim ? 'estimation' : 'exact',
      estimationOptions: opts,
    } as any);
  }, [gameState, isHost, updateFS, endGame, buildNextQuestion]);

  const startGame = useCallback(async () => {
    if (!gameState || !isHost || gameState.isGameActive || !db) return;
    let q: string, a: number, idx = 0;
    if (gameState.customQuestions?.length) {
      q = gameState.customQuestions[0].question; a = gameState.customQuestions[0].answer; idx = 1;
    } else {
      const gen = generateEquation(selectedDiff); q = gen.question; a = gen.answer;
    }
    const isEstim = false; // round 1 is always exact
    const reset = gameState.players.map(p => ({ ...p, score:0, hasAnswered:false, isCorrect:null, lastActive:Timestamp.now(), stolenPoints:0 }));
    setRoundTimeLeft(ROUND_DURATION);
    await updateFS({
      question:q, answer:a, timeLeft:ROUND_DURATION, isGameActive:true, isGameOver:false,
      isShowingResults:false, currentRound:1, players:reset, roundStartTime:serverTimestamp(),
      currentQuestionIndex:idx, difficulty:selectedDiff, roundCount:selectedCount,
      firstCorrectPlayerId:null, roundType:'exact', estimationOptions:[], reactions:[],
    } as any);
  }, [gameState, isHost, updateFS, selectedDiff, selectedCount]);

  const endRound = useCallback(async () => {
    if (!gameState || !isHost || gameState.isShowingResults || !gameState.isGameActive || !db) return;
    const updated = gameState.players.map(p => ({ ...p, isCorrect: p.hasAnswered ? p.isCorrect : false, lastActive:Timestamp.now() }));
    await updateFS({ players:updated, isShowingResults:true, timeLeft:0 });
    roundEndRef.current = setTimeout(() => nextQuestion(), RESULTS_DISPLAY_DURATION);
  }, [gameState, isHost, updateFS, nextQuestion]);

  /* all-answered trigger */
  useEffect(() => {
    if (!isHost || !gameState?.isGameActive || gameState.isShowingResults || !gameState.players?.length || skipRef.current) return;
    const allCorrect  = gameState.players.every(p => p.isCorrect === true);
    const allAnswered = gameState.players.every(p => p.hasAnswered);
    if (allCorrect) { skipRef.current = true; setTimeout(() => nextQuestion(), ALL_CORRECT_SKIP_DELAY); }
    else if (allAnswered || roundTimeLeft <= 0) endRound();
  }, [gameState?.players, isHost, gameState?.isGameActive, gameState?.isShowingResults, roundTimeLeft, endRound, nextQuestion]);

  /* ── confetti on perfect game over ── */
  useEffect(() => {
    if (gameState?.isGameOver && currentPlayer && currentPlayer.score > 0) {
      const myRank = sortedPlayers.findIndex(p => p.id === currentPlayer.id);
      if (myRank === 0) fireConfetti();
    }
  }, [gameState?.isGameOver]);

  /* ── join ── */
  const handleJoinGame = async () => {
    const name = inputName.trim(); if (!name || !db) return;
    const playerId    = generateId();
    const shouldHost  = isInitHost && (gameState?.players?.length ?? 0) === 0;
    const newPlayer: Player = { id:playerId, name, score:0, isHost:shouldHost, hasAnswered:false, isCorrect:null, lastActive:Timestamp.now(), stolenPoints:0 } as any;
    savePlayerInfo(playerId, name); setLocalPlayerInfo({ playerId, playerName:name });
    try {
      await updateDoc(doc(db!, 'gameRooms', roomCode), { players: arrayUnion(newPlayer) });
      toast({ title:`Pulse sync'd · welcome ${name}` });
    } catch { toast({ title:'Error joining', variant:'destructive' }); }
  };

  /* ── answer submit (exact) ── */
  const handleAnswerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localPlayerInfo || !gameState?.isGameActive || gameState.isShowingResults || !currentAnswer || roundTimeLeft<=0 || !db) return;
    const me = gameState.players.find(p => p.id === localPlayerInfo.playerId);
    if (!me || (me.hasAnswered && me.isCorrect)) return;

    const correct    = parseFloat(currentAnswer) === gameState.answer;
    const scoreGain  = correct ? Math.max(5, roundTimeLeft*2+10) : 0;
    const isFirst    = correct && !firstCorrectId;

    // pulse steal: steal from highest-scoring wrong player (min 0)
    let stealTarget: string | null = null;
    let stealAmount = 0;
    if (correct) {
      const wrongPlayers = gameState.players.filter(p => p.hasAnswered && p.isCorrect===false && p.score>0);
      if (wrongPlayers.length) {
        wrongPlayers.sort((a,b) => b.score-a.score);
        stealTarget = wrongPlayers[0].id;
        stealAmount = Math.min(STEAL_AMOUNT, wrongPlayers[0].score);
      }
    }

    setFeedback(correct
      ? { text:`✓ correct +${scoreGain}${stealTarget ? ` • stole ${stealAmount}pts ⚡` : ''}`, ok:true }
      : { text:`✗ wrong — try again`, ok:false });

    const updatedPlayers = gameState.players.map(p => {
      if (p.id === localPlayerInfo.playerId) return { ...p, score:(p.score??0)+scoreGain+(stealTarget&&stealTarget!==p.id?0:0), hasAnswered:true, isCorrect:correct, lastActive:Timestamp.now() };
      if (p.id === stealTarget) return { ...p, score:Math.max(0, (p.score??0)-stealAmount), stolenPoints:((p as any).stolenPoints||0)+stealAmount };
      return p;
    });

    // also add our own steal gain
    const finalPlayers = updatedPlayers.map(p =>
      p.id === localPlayerInfo.playerId ? { ...p, score: p.score + stealAmount } : p
    );

    try {
      await updateDoc(doc(db!, 'gameRooms', roomCode), {
        players: finalPlayers,
        ...(isFirst ? { firstCorrectPlayerId: localPlayerInfo.playerId } : {}),
      });
    } catch (err) { console.error(err); }
    if (correct) setCurrentAnswer('');
  };

  /* ── estimation select ── */
  const handleEstimationSelect = async (opt: string) => {
    if (!localPlayerInfo || !gameState?.isGameActive || gameState.isShowingResults || roundTimeLeft<=0 || !db) return;
    const me = gameState.players.find(p => p.id === localPlayerInfo.playerId);
    if (!me || me.hasAnswered) return;
    setEstimSelected(opt);
    const [lo, hi] = opt.split('–').map(Number);
    const correct  = gameState.answer >= lo && gameState.answer <= hi;
    const scoreGain = correct ? Math.max(5, roundTimeLeft+5) : 0; // slightly less than exact
    const isFirst  = correct && !firstCorrectId;
    setFeedback(correct ? { text:`✓ correct range +${scoreGain}`, ok:true } : { text:`✗ wrong range`, ok:false });
    const updatedPlayers = gameState.players.map(p =>
      p.id === localPlayerInfo.playerId ? { ...p, score:(p.score??0)+scoreGain, hasAnswered:true, isCorrect:correct, lastActive:Timestamp.now() } : p
    );
    try {
      await updateDoc(doc(db!, 'gameRooms', roomCode), {
        players: updatedPlayers,
        ...(isFirst ? { firstCorrectPlayerId: localPlayerInfo.playerId } : {}),
      });
    } catch (e) { console.error(e); }
  };

  /* ── reactions ── */
  const handleReact = async (emoji: string) => {
    if (!localPlayerInfo || !db) return;
    const ev: ReactionEvent = { id:generateId(), playerId:localPlayerInfo.playerId, playerName:localPlayerInfo.playerName, emoji, ts:Date.now() };
    // optimistic local
    setLocalReactions(r => [...r, ev]);
    // prune old reactions in FS (keep last 20)
    const existing: ReactionEvent[] = ((gameState as any)?.reactions || []).slice(-19);
    try { await updateDoc(doc(db!, 'gameRooms', roomCode), { reactions: [...existing, ev] }); } catch {}
  };

  /* ── leave / reset ── */
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
          players: wasHost && !remaining.some(p=>p.isHost) ? remaining.map((p,i) => i===0 ? {...p,isHost:true} : p) : remaining
        });
      });
    } catch (e) { console.error(e); }
    router.push('/');
  }, [localPlayerInfo, roomCode, router]);

  const handleResetLobby = async () => {
    await updateFS({ isGameOver:false, isGameActive:false, isShowingResults:false, currentRound:0, players: gameState?.players.map(p=>({...p,score:0,hasAnswered:false,isCorrect:null,stolenPoints:0}))||[] } as any);
  };

  const handleAddCustomQ = async () => {
    if (!newQ.trim() || autoCalcAns===null || !gameState) return;
    await updateFS({ customQuestions:[...(gameState.customQuestions||[]), { question:newQ, answer:autoCalcAns }] });
    setNewQ('');
  };
  const handleRemoveCustomQ = async (i:number) => {
    if (!gameState?.customQuestions) return;
    await updateFS({ customQuestions: gameState.customQuestions.filter((_,idx)=>idx!==i) });
  };
  const copyCode = () => { navigator.clipboard.writeText(roomCode); toast({ title:'Code copied' }); };
  const copyLink = () => { navigator.clipboard.writeText(window.location.href.split('?')[0]); toast({ title:'Link copied' }); };

  const timerPct = (roundTimeLeft / ROUND_DURATION) * 100;
  const urgent   = roundTimeLeft < 7 && !!gameState?.isGameActive;

  /* ══════════════════════════════════════════════════
     LOADING
  ══════════════════════════════════════════════════ */
  if (isLoading) return (
    <div style={{ ...S.page, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16 }}>
        <div style={{ width:44,height:44,borderRadius:12,background:T.lime,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:T.mono,fontWeight:700,color:T.ink,fontSize:22 }}>+</div>
        <Loader2 style={{ width:22,height:22,color:T.lime,animation:'spin 1s linear infinite' }} />
        <MonoLabel>connecting…</MonoLabel>
      </div>
      <GlobalStyles />
    </div>
  );

  /* ══════════════════════════════════════════════════
     JOIN SCREEN
  ══════════════════════════════════════════════════ */
  if (isJoining || !localPlayerInfo || !gameState?.players.some(p=>p.id===localPlayerInfo?.playerId)) return (
    <div style={{ ...S.page, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={S.grid} />
      <div style={{ position:'absolute', top:16, right:16 }}><ThemeToggle /></div>
      <GlobalStyles />
      <div style={{ width:'100%', maxWidth:420, position:'relative', zIndex:2 }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          {!logoError
            ? <div style={{ display:'inline-block', background:T.panel, border:`1px solid ${T.line}`, borderRadius:16, padding:16, marginBottom:16 }}>
                <Image src={placeholders.logo.url} alt={placeholders.logo.alt} width={130} height={40} priority style={{ height:'auto' }} className="dark:invert dark:brightness-200" onError={()=>setLogoError(true)} />
              </div>
            : <div style={{ width:52,height:52,borderRadius:14,background:'rgba(200,255,77,.1)',border:`1px solid ${T.limeDim}`,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:16 }}>
                <Activity style={{ width:22,height:22,color:T.lime }} />
              </div>
          }
          <h1 style={{ fontFamily:T.disp, fontSize:22, fontWeight:700, margin:'0 0 8px' }}>Sync your pulse</h1>
          <Pill>Room · {roomCode}</Pill>
          {(gameState as any)?.difficulty && (
            <div style={{ marginTop:8 }}><DiffBadge d={(gameState as any).difficulty} /></div>
          )}
        </div>

        <div style={{ ...S.card, padding:28 }}>
          <MonoLabel style={{ marginBottom:8 }}>Your callsign</MonoLabel>
          <input style={{ ...S.input, textAlign:'center', fontSize:18, marginBottom:14 }}
            placeholder="Enter your name" value={inputName} onChange={e=>setInputName(e.target.value)}
            maxLength={15} onKeyDown={e=>e.key==='Enter'&&handleJoinGame()}
            onFocus={e=>{e.target.style.borderColor=T.lime;}} onBlur={e=>{e.target.style.borderColor=T.line;}}
            autoFocus />
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
            <MonoLabel>{gameState?.players?.length??0}/12 players</MonoLabel>
            <MonoLabel style={{ color: gameState?.isGameActive ? T.signal : T.lime }}>
              {gameState?.isGameActive ? '● round live' : '○ waiting'}
            </MonoLabel>
          </div>
          {(gameState?.players?.length??0)>0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, paddingBottom:14 }}>
              {gameState?.players.map(p=>(
                <div key={p.id} style={{ fontFamily:T.mono, fontSize:11, padding:'3px 8px', borderRadius:99, background: p.isHost?'rgba(200,255,77,.1)':'rgba(255,255,255,.04)', border:`1px solid ${p.isHost?T.limeDim:T.line}`, color: p.isHost?T.lime:T.paper }}>
                  {p.name}{p.isHost?' ⚡':''}
                </div>
              ))}
            </div>
          )}
          <button style={{ ...S.btnFill, width:'100%', justifyContent:'center', height:48, fontSize:15, opacity:(!inputName.trim()||(gameState?.players?.length??0)>=12)?.45:1 }}
            onClick={handleJoinGame} disabled={!inputName.trim()||(gameState?.players?.length??0)>=12}>
            Join round →
          </button>
        </div>
      </div>
    </div>
  );

  /* ══════════════════════════════════════════════════
     GAME OVER / PODIUM
  ══════════════════════════════════════════════════ */
  if (gameState.isGameOver) {
    const top3 = sortedPlayers.slice(0,3);
    const display = [top3[1],top3[0],top3[2]];
    const rnkColors = [T.dim, T.lime, '#F59E0B'];
    const rnkH     = [80, 116, 56];
    const rnkLabel = ['2nd','1st','3rd'];
    const rnkIcon  = [<Medal key="m" style={{width:13,height:13}}/>,<Trophy key="t" style={{width:13,height:13}}/>,<Award key="a" style={{width:13,height:13}}/>];

    return (
      <div style={{ ...S.page, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:20 }}>
        <div style={S.grid} />
        <div style={{ position:'absolute',top:16,right:16 }}><ThemeToggle /></div>
        <GlobalStyles />
        <div style={{ width:'100%', maxWidth:540, position:'relative', zIndex:2 }}>
          <div style={{ ...S.card, padding:0, overflow:'hidden' }}>
            <div style={{ padding:'32px 28px 20px', textAlign:'center', borderBottom:`1px solid ${T.line}` }}>
              <div style={{ width:48,height:48,borderRadius:14,background:'rgba(200,255,77,.1)',border:`1px solid ${T.limeDim}`,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:14 }}>
                <Trophy style={{ width:22,height:22,color:T.lime }} />
              </div>
              <h2 style={{ fontFamily:T.disp, fontSize:24, fontWeight:700, margin:'0 0 6px' }}>Round complete</h2>
              <MonoLabel>Pulse champions · {roomCode}</MonoLabel>
              {currentPlayer && (
                <div style={{ marginTop:12, fontFamily:T.mono, fontSize:22, fontWeight:700, color:T.lime }}>
                  {currentPlayer.score} pts
                  {sortedPlayers[0]?.id===currentPlayer.id && <span style={{ fontSize:14, marginLeft:8 }}>🏆 winner</span>}
                </div>
              )}
            </div>
            {/* podium */}
            <div style={{ padding:'28px 24px', display:'flex', alignItems:'flex-end', justifyContent:'center', gap:12, borderBottom:`1px solid ${T.line}` }}>
            {display.map((player, i) => {
  if (!player) return <div key={i} style={{ width:72 }}/>;
  return (
    <div key={player.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <div style={{ position:'relative' }}>
        <div style={{
          width: i===1 ? 52 : 40,
          height: i===1 ? 52 : 40,
          borderRadius:'50%', background:T.line,
          border:`2px solid ${rnkColors[i]}`,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontFamily:T.mono, fontWeight:700,
          fontSize: i===1 ? 18 : 14,
          color: rnkColors[i],
        }}>
          {player.name[0].toUpperCase()}
        </div>
        <div style={{
          position:'absolute', bottom:-2, right:-2,
          width:18, height:18, borderRadius:'50%',
          background:T.panel, border:`1px solid ${T.line}`,
          display:'flex', alignItems:'center', justifyContent:'center',
          color: rnkColors[i],
        }}>
          {rnkIcon[i]}
        </div>
      </div>
      <span style={{
        fontFamily:T.mono, fontSize:11,
        color: rnkColors[i], fontWeight:700,
        maxWidth:60, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
      }}>
        {player.name}
      </span>
      <div style={{
        width: i===1 ? 72 : 56,
        height: rnkH[i],
        background:`rgba(${i===1?'200,255,77':i===2?'245,158,11':'168,174,186'},.1)`,
        border:`1px solid ${rnkColors[i]}`,
        borderBottom:'none', borderRadius:'6px 6px 0 0',
        display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:10,
      }}>
        <span style={{ fontFamily:T.mono, fontSize:12, fontWeight:700, color:rnkColors[i] }}>
          {rnkLabel[i]}
        </span>
      </div>
      <span style={{ fontFamily:T.mono, fontSize:13, fontWeight:700, color:rnkColors[i] }}>
        {player.score}
      </span>
    </div>
  );
})}
            </div>
            {/* full standings */}
            <div style={{ padding:'14px 18px 8px' }}>
              <MonoLabel style={{ marginBottom:10 }}>Full standings</MonoLabel>
              {sortedPlayers.map((p,i)=><LbRow key={p.id} rank={i+1} player={p} isMe={p.id===localPlayerInfo?.playerId} />)}
            </div>
            <div style={{ padding:'14px 20px 28px', display:'flex', gap:10 }}>
              {isHost && <button style={{ ...S.btnFill,flex:1,justifyContent:'center' }} onClick={handleResetLobby}>Back to lobby</button>}
              <button style={{ ...S.btnGhost,flex:1,justifyContent:'center' }} onClick={handleLeaveGame}>Disconnect</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════
     ACTIVE ROOM
  ══════════════════════════════════════════════════ */
  return (
    <div style={{ ...S.page, display:'flex', flexDirection:'column', maxWidth:680, margin:'0 auto' }}>
      <div style={S.grid} />
      <div style={{ position:'absolute',top:14,right:14,zIndex:10 }}><ThemeToggle /></div>
      <GlobalStyles />

      {/* reactions overlay */}
      {localPlayerInfo && <ReactionsOverlay reactions={localReactions} myId={localPlayerInfo.playerId} />}

      {/* ── TOP BAR ── */}
      <div style={{ position:'relative',zIndex:2,padding:'16px 16px 0' }}>
        <div style={{ ...S.card, padding:'16px 18px' }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
            <button onClick={()=>router.push('/')} style={{ display:'flex',alignItems:'center',gap:8,background:'none',border:'none',color:'inherit',cursor:'pointer' }}>
              <div style={{ width:26,height:26,borderRadius:7,background:T.lime,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:T.mono,fontWeight:700,color:T.ink,fontSize:14 }}>+</div>
              <span style={{ fontFamily:T.disp,fontWeight:700,fontSize:15 }}>Math<span style={{ color:T.lime }}>Pulse</span></span>
            </button>
            <div style={{ display:'flex',alignItems:'center',gap:6 }}>
              <DiffBadge d={difficulty} />
              <MonoLabel style={{ color:T.paper }}>{roundCount}Q</MonoLabel>
              <div style={{ width:1,height:14,background:T.line,margin:'0 4px' }} />
              <div style={{ display:'flex',alignItems:'center',gap:4,background:T.ink,borderRadius:9,padding:'3px 4px',border:`1px solid ${T.line}` }}>
                <button onClick={copyCode} style={{ fontFamily:T.mono,fontWeight:700,fontSize:12,color:T.lime,background:'none',border:'none',cursor:'pointer',padding:'4px 8px',letterSpacing:'.12em' }}>{roomCode}</button>
                <div style={{ width:1,height:14,background:T.line }} />
                <button onClick={copyLink} style={{ background:'none',border:'none',cursor:'pointer',color:T.dim,padding:'4px 6px',display:'flex',alignItems:'center' }}><Share2 style={{ width:13,height:13 }} /></button>
                <button onClick={handleLeaveGame} style={{ background:'none',border:'none',cursor:'pointer',color:T.signal,padding:'4px 6px',display:'flex',alignItems:'center' }}><LogOut style={{ width:13,height:13 }} /></button>
              </div>
            </div>
          </div>

          <div style={{ display:'flex',gap:8 }}>
            <StatTile label="Round" value={`${gameState.currentRound>0?gameState.currentRound:'—'}/${roundCount}`} />
            <StatTile label="Clock" urgent={urgent} value={<span style={{ display:'flex',alignItems:'center',gap:4 }}><Clock style={{ width:11,height:11 }} />{gameState.isGameActive&&!gameState.isShowingResults?`${roundTimeLeft}s`:'—'}</span>} />
            <StatTile label="Players" value={<span style={{ display:'flex',alignItems:'center',gap:4 }}><Users style={{ width:11,height:11 }} />{gameState.players?.length??0}</span>} />
            {isEstimRound&&gameState.isGameActive&&<StatTile label="Mode" value="estimate" />}
          </div>

          {gameState.isGameActive&&!gameState.isShowingResults&&roundTimeLeft>0&&(
            <div style={{ marginTop:12 }}><TimerBar pct={timerPct} urgent={urgent} /></div>
          )}
        </div>
      </div>

      {/* ── SCOREBOARD ── */}
      <div style={{ position:'relative',zIndex:2,padding:'8px 16px 0' }}>
        <button onClick={()=>setShowScoreboard(s=>!s)} style={{ width:'100%',background:'none',border:'none',cursor:'pointer',color:T.dim,fontFamily:T.mono,fontSize:10,letterSpacing:'.16em',textTransform:'uppercase',padding:'6px 0',opacity:.5 }}
          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.color=T.lime;}}
          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.color=T.dim;}}>
          {showScoreboard?'Hide standings ↑':'Show standings ↓'}
        </button>
        {showScoreboard&&(
          <div style={{ ...S.card,padding:'8px 10px',maxHeight:gameState.isGameActive?120:180,overflowY:'auto' }}>
            {sortedPlayers.map((p,i)=>(
              <LbRow key={p.id} rank={i+1} player={p}
                isMe={p.id===localPlayerInfo?.playerId}
                isActive={gameState.isGameActive}
                firstCorrectId={firstCorrectId} />
            ))}
          </div>
        )}
      </div>

      {/* ── MAIN PLAY AREA ── */}
      <div style={{ flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:16,position:'relative',zIndex:2 }}>
        {gameState.isGameActive ? (
          <div style={{ width:'100%',maxWidth:520,display:'flex',flexDirection:'column',gap:14 }}>

            {/* question card */}
            <div style={{ ...S.card,textAlign:'center',padding:'28px 24px',border: isPlayerCorrect?`1px solid ${T.limeDim}`:`1px solid ${T.line}`, background: isPlayerCorrect?'rgba(200,255,77,.04)':T.panel,transition:'border-color .3s ease' }}>
              <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
                <Pill>{isEstimRound?'Estimation round':'Target locked'} · R{gameState.currentRound}</Pill>
                {isEstimRound&&<span style={{ fontFamily:T.mono,fontSize:11,color:T.lime }}>Pick a range ↓</span>}
              </div>
              <div style={{ fontFamily:T.mono,fontWeight:700,fontSize:'clamp(28px,7vw,48px)',letterSpacing:'.02em',color: isPlayerCorrect?T.lime:T.paper,transition:'color .3s ease',lineHeight:1.1,margin:'8px 0' }}>
                {(gameState.isShowingResults||isPlayerCorrect)
                  ? `${gameState.question} = ${gameState.answer}`
                  : isEstimRound
                    ? `${gameState.question} ≈ ?`
                    : `${gameState.question} = ?`}
              </div>
              {gameState.isShowingResults&&<MonoLabel style={{ marginTop:10,color:T.lime }}>Revealed · next question incoming…</MonoLabel>}
              {firstCorrectId&&!gameState.isShowingResults&&(
                <MonoLabel style={{ marginTop:8 }}>
                  ⚡ {sortedPlayers.find(p=>p.id===firstCorrectId)?.name??'Someone'} got it first
                </MonoLabel>
              )}
            </div>

            {/* answer area */}
            {isEstimRound ? (
              /* estimation options */
              !isPlayerCorrect&&!gameState.isShowingResults
                ? <EstimationOptions answer={gameState.answer} options={estOptions} disabled={!!estimSelected||(gameState.isShowingResults??false)} onSelect={handleEstimationSelect} selected={estimSelected} />
                : null
            ) : (
              /* exact answer form */
              <form onSubmit={handleAnswerSubmit} style={{ display:'flex',flexDirection:'column',gap:10 }}>
                <div style={{ display:'flex',gap:8 }}>
                  <input ref={answerRef} type="number" placeholder="Your answer" value={currentAnswer}
                    onChange={e=>{setCurrentAnswer(e.target.value);if(feedback?.ok===false)setFeedback(null);}}
                    disabled={isPlayerCorrect||gameState.isShowingResults}
                    style={{ ...S.input,textAlign:'center',fontSize:22,fontWeight:700,padding:16,height:60,borderColor:isPlayerCorrect?T.limeDim:T.line,opacity:(isPlayerCorrect||gameState.isShowingResults)?.5:1,flex:1 }}
                    onFocus={e=>{if(!isPlayerCorrect)e.target.style.borderColor=T.lime;}}
                    onBlur={e=>{e.target.style.borderColor=isPlayerCorrect?T.limeDim:T.line;}} />
                  <VoiceButton onResult={v=>{setCurrentAnswer(v); setTimeout(()=>answerRef.current?.focus(),50);}} disabled={isPlayerCorrect||(gameState.isShowingResults??false)} />
                </div>
                <div style={{ height:18,textAlign:'center',fontFamily:T.mono,fontSize:13,color:feedback?.ok?T.lime:T.signal }}>
                  {feedback?.text??''}
                </div>
                <button type="submit" disabled={isPlayerCorrect||!currentAnswer||gameState.isShowingResults}
                  style={{ ...S.btnFill,width:'100%',justifyContent:'center',height:52,fontSize:15,opacity:(isPlayerCorrect||!currentAnswer||gameState.isShowingResults)?.45:1 }}>
                  {isPlayerCorrect?'✓ Sync locked':'Submit pulse'}
                </button>
              </form>
            )}

            {/* reactions */}
            <div style={{ ...S.card,padding:'6px 12px' }}>
              <MonoLabel style={{ marginBottom:4,textAlign:'center' }}>React</MonoLabel>
              <ReactionBar onReact={handleReact} />
            </div>

            {/* host controls */}
            {isHost&&(
              <button style={{ ...S.btnDanger,width:'100%',justifyContent:'center' }} onClick={endGame}>
                <Trash2 style={{ width:14,height:14 }} /> End challenge session
              </button>
            )}
          </div>
        ) : (
          /* ── LOBBY ── */
          <div style={{ width:'100%',maxWidth:520 }}>
            <div style={{ ...S.card,padding:0,overflow:'hidden' }}>
              {isHost ? (
                <>
                  <div style={{ display:'flex',borderBottom:`1px solid ${T.line}` }}>
                    {(['lobby','builder'] as const).map(tab=>(
                      <button key={tab} onClick={()=>setActiveTab(tab)}
                        style={{ flex:1,padding:'14px 0',background:'none',border:'none',cursor:'pointer',fontFamily:T.mono,fontSize:11,letterSpacing:'.12em',textTransform:'uppercase',color:activeTab===tab?T.lime:T.dim,borderBottom:activeTab===tab?`2px solid ${T.lime}`:'2px solid transparent',transition:'color .2s,border-color .2s' }}>
                        {tab==='lobby'?'Lobby':'Builder'}
                      </button>
                    ))}
                  </div>

                  {activeTab==='lobby'&&(
                    <div style={{ padding:'24px 24px' }}>
                      <div style={{ textAlign:'center',marginBottom:22 }}>
                        <div style={{ width:44,height:44,borderRadius:12,background:'rgba(200,255,77,.08)',border:`1px solid ${T.limeDim}`,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:12 }}>
                          <Target style={{ width:20,height:20,color:T.lime }} />
                        </div>
                        <h3 style={{ fontFamily:T.disp,fontSize:20,fontWeight:700,marginBottom:4 }}>Ready for sync</h3>
                        <MonoLabel>{gameState.players?.length??0} player{gameState.players?.length!==1?'s':''} in room</MonoLabel>
                      </div>

                      {/* difficulty selector */}
                      <div style={{ marginBottom:18 }}>
                        <MonoLabel style={{ marginBottom:8 }}>Difficulty</MonoLabel>
                        <div style={{ display:'flex',gap:8 }}>
                          {(['easy','medium','hard'] as Difficulty[]).map(d=>(
                            <button key={d} onClick={()=>setSelectedDiff(d)}
                              style={{ flex:1,padding:'10px 0',borderRadius:9,border:`1px solid ${selectedDiff===d?T.limeDim:T.line}`,background: selectedDiff===d?'rgba(200,255,77,.08)':'transparent',fontFamily:T.mono,fontSize:12,letterSpacing:'.08em',textTransform:'uppercase',color: selectedDiff===d?T.lime:T.dim,cursor:'pointer',transition:'all .15s' }}>
                              {d}
                            </button>
                          ))}
                        </div>
                        <div style={{ marginTop:8, fontFamily:T.mono,fontSize:11,color:T.dim }}>
                          {selectedDiff==='easy'&&'Addition & subtraction · small numbers'}
                          {selectedDiff==='medium'&&'+ − × · 3-digit numbers · includes estimation rounds'}
                          {selectedDiff==='hard'&&'All ops · 4-digit numbers · estimation rounds'}
                        </div>
                      </div>

                      {/* round count */}
                      <div style={{ marginBottom:22 }}>
                        <MonoLabel style={{ marginBottom:8 }}>Round count</MonoLabel>
                        <div style={{ display:'flex',gap:8 }}>
                          {([5,10,20] as RoundCount[]).map(n=>(
                            <button key={n} onClick={()=>setSelectedCount(n)}
                              style={{ flex:1,padding:'10px 0',borderRadius:9,border:`1px solid ${selectedCount===n?T.limeDim:T.line}`,background: selectedCount===n?'rgba(200,255,77,.08)':'transparent',fontFamily:T.mono,fontSize:14,fontWeight:700,color: selectedCount===n?T.lime:T.dim,cursor:'pointer',transition:'all .15s' }}>
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* share code */}
                      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'12px 16px',background:T.ink,borderRadius:10,border:`1px solid ${T.line}`,marginBottom:18 }}>
                        <span style={{ fontFamily:T.mono,fontSize:22,fontWeight:700,color:T.lime,letterSpacing:'.1em' }}>{roomCode}</span>
                        <button onClick={copyCode} style={{ background:'none',border:`1px solid ${T.line}`,borderRadius:7,padding:'4px 10px',cursor:'pointer',color:T.dim,fontFamily:T.mono,fontSize:11 }}>copy</button>
                      </div>

                      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',gap:6,marginBottom:18 }}>
                        <BarChart2 style={{ width:13,height:13,color:T.dim }} />
                        <MonoLabel>Every {ESTIMATION_EVERY}rd round is estimation mode</MonoLabel>
                      </div>

                      <button style={{ ...S.btnFill,width:'100%',justifyContent:'center',height:52,fontSize:15 }} onClick={startGame}>
                        <Zap style={{ width:16,height:16 }} /> Start pulse
                      </button>
                    </div>
                  )}

                  {activeTab==='builder'&&(
                    <div style={{ padding:'20px 24px' }}>
                      <MonoLabel style={{ marginBottom:10 }}>Custom question pool ({(gameState.customQuestions||[]).length})</MonoLabel>
                      <p style={{ fontSize:13,color:T.dim,marginBottom:16,lineHeight:1.5 }}>Auto-calculates the answer. Leave pool empty to use random generated questions.</p>
                      <div style={{ display:'flex',gap:8,marginBottom:14 }}>
                        <input placeholder="e.g. 15 × 12" value={newQ} onChange={e=>setNewQ(e.target.value)}
                          style={{ ...S.input,flex:1,fontSize:14,padding:'10px 12px' }}
                          onFocus={e=>{e.target.style.borderColor=T.lime;}} onBlur={e=>{e.target.style.borderColor=T.line;}} />
                        {autoCalcAns!==null&&<div style={{ display:'flex',alignItems:'center',fontFamily:T.mono,fontSize:14,color:T.lime,fontWeight:700,minWidth:40 }}>= {autoCalcAns}</div>}
                        <button onClick={handleAddCustomQ} disabled={autoCalcAns===null} style={{ ...S.btnFill,padding:'10px 14px',opacity:autoCalcAns===null?.4:1 }}><Plus style={{ width:16,height:16 }} /></button>
                      </div>
                      <div style={{ maxHeight:180,overflowY:'auto',display:'flex',flexDirection:'column',gap:6,marginBottom:16 }}>
                        {(gameState.customQuestions||[]).length===0
                          ? <div style={{ textAlign:'center',padding:'20px 0',color:T.dim,fontFamily:T.mono,fontSize:12 }}>No custom questions — random questions will be used</div>
                          : (gameState.customQuestions||[]).map((q,i)=>(
                              <div key={i} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',border:`1px solid ${T.line}`,borderRadius:9,background:T.ink }}>
                                <span style={{ fontFamily:T.mono,fontSize:13 }}>{q.question} = <span style={{ color:T.lime,fontWeight:700 }}>{q.answer}</span></span>
                                <button onClick={()=>handleRemoveCustomQ(i)} style={{ background:'none',border:'none',cursor:'pointer',color:T.signal,padding:'2px 6px',display:'flex',alignItems:'center' }}><Trash2 style={{ width:13,height:13 }} /></button>
                              </div>
                            ))
                        }
                      </div>
                      <button style={{ ...S.btnFill,width:'100%',justifyContent:'center',height:48 }} onClick={startGame}>
                        <Zap style={{ width:15,height:15 }} />
                        {(gameState.customQuestions||[]).length>0?'Deploy custom pool':'Start with random questions'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ padding:'48px 24px',textAlign:'center' }}>
                  <div style={{ width:48,height:48,borderRadius:14,background:'rgba(200,255,77,.08)',border:`1px solid ${T.limeDim}`,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:16 }}>
                    <Activity style={{ width:22,height:22,color:T.lime,animation:'pulse 2s ease-in-out infinite' }} />
                  </div>
                  <h3 style={{ fontFamily:T.disp,fontSize:20,fontWeight:700,marginBottom:8 }}>Waiting for sync</h3>
                  <MonoLabel style={{ marginBottom:20 }}>Host is setting up the round…</MonoLabel>
                  {(gameState as any)?.difficulty&&<div style={{ marginBottom:16 }}><DiffBadge d={(gameState as any).difficulty} /></div>}
                  <div style={{ display:'flex',justifyContent:'center',gap:4 }}>
                    {[0,1,2].map(i=><div key={i} style={{ width:6,height:6,borderRadius:'50%',background:T.lime,animation:`bounce 1.2s ease-in-out ${i*.2}s infinite` }} />)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────────── injected keyframes ─── */
const GlobalStyles = () => (
  <style>{`
    @keyframes spin       { to { transform: rotate(360deg); } }
    @keyframes pulse      { 0%,100%{opacity:1} 50%{opacity:.4} }
    @keyframes bounce     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
    @keyframes floatUp    { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes pulseBorder{ 0%,100%{box-shadow:0 0 0 0 rgba(200,255,77,.4)} 50%{box-shadow:0 0 0 6px rgba(200,255,77,.1)} }
  `}</style>
);

export default GameRoomPage;