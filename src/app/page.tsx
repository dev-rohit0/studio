'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { clearPlayerInfo } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import type { GameState } from '@/types/game';
import placeholders from '@/app/lib/placeholder-images.json';
import { ThemeToggle } from '@/components/theme-toggle';

/* ── Pulse waveform strip ─────────────────────────────── */
const WAVE_PTS = '0,70 60,70 90,70 110,40 130,100 150,20 170,70 230,70 300,70 330,70 350,40 370,100 390,20 410,70 470,70 540,70 570,70 590,40 610,100 630,20 650,70 710,70 780,70 810,70 830,40 850,100 870,20 890,70 950,70 1020,70 1050,70 1070,40 1090,100 1110,20 1130,70 1190,70 1200,70';

function PulseStrip({ sessionSolves, sessionStart }: { sessionSolves: number; sessionStart: number }) {
  const [clock, setClock] = useState('00:00');
  const [bpm, setBpm] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const sec = Math.floor((Date.now() - sessionStart) / 1000);
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      setClock(`${m}:${s}`);
      const mins = Math.max(sec / 60, 1 / 60);
      setBpm(sessionSolves > 0 ? Math.round(sessionSolves / mins) : null);
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStart, sessionSolves]);

  return (
    <div style={{
      position: 'relative', marginTop: '42px', height: '140px',
      border: '1px solid var(--panel-line)', borderRadius: '14px',
      background: 'linear-gradient(180deg, rgba(200,255,77,0.04), transparent 60%)',
      overflow: 'hidden',
    }}>
      <svg viewBox="0 0 1200 140" preserveAspectRatio="none" style={{ display: 'block', width: '200%', height: '100%' }}>
        <polyline points={`${WAVE_PTS.replace(/(\d+),(\d+)/g, (_, x, y) => `${+x + 600},${y}`)}`}
          fill="none" stroke="var(--panel-line)" strokeWidth="1.5" strokeLinecap="round"
          className="animate-wave-scroll" />
        <polyline points={WAVE_PTS}
          fill="none" stroke="var(--lime)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 6px rgba(200,255,77,.55))' }}
          className="animate-wave-scroll" />
      </svg>
      {/* readout left */}
      <div style={{ position: 'absolute', left: 20, top: 16, fontFamily: 'var(--font-jetbrains-mono),monospace' }}>
        <div style={{ fontSize: 34, fontWeight: 700, color: 'var(--paper)', lineHeight: 1 }}>
          {bpm ?? '—'}
          <span style={{ color: 'var(--lime)', fontSize: 14, fontWeight: 500, marginLeft: 6 }}>solves/min</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--paper-dim)', letterSpacing: '.1em', marginTop: 6, textTransform: 'uppercase' }}>
          Your pace · this session
        </div>
      </div>
      {/* readout right */}
      <div style={{ position: 'absolute', right: 20, top: 16, textAlign: 'right', fontFamily: 'var(--font-jetbrains-mono),monospace' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--paper)' }}>{clock}</div>
        <div style={{ fontSize: 11, color: 'var(--paper-dim)', letterSpacing: '.1em', marginTop: 6, textTransform: 'uppercase' }}>
          Session clock
        </div>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────── */
const HomePage: NextPage = () => {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [sessionStart] = useState(() => Date.now());
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => { clearPlayerInfo(); }, []);

  const generateRoomCode = () => Math.floor(100000 + Math.random() * 900000).toString();

  const handleCreateRoom = async () => {
    if (!db) return;
    setIsCreatingRoom(true);
    const code = generateRoomCode();
    const init: Omit<GameState, 'roomCode'> & { createdAt: any } = {
      question: 'Waiting for host...', answer: 0, players: [], timeLeft: 0,
      isGameActive: false, currentRound: 0, roundStartTime: null,
      createdAt: serverTimestamp(), customQuestions: [], currentQuestionIndex: 0,
      // v2 feature fields
      difficulty: 'medium',
      roundCount: 10,
      roundType: 'exact',
      estimationOptions: [],
      firstCorrectPlayerId: null,
      reactions: [],
    };
    try {
      await setDoc(doc(db!, 'gameRooms', code), init);
      router.push(`/room/${code}?host=true`);
    } catch {
      toast({ title: 'Error creating room', variant: 'destructive' });
      setIsCreatingRoom(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!db) return;
    const code = roomCodeInput.trim();
    if (!/^\d{6}$/.test(code)) { setSyncMsg({ text: 'Enter a 6-digit room code.', ok: false }); return; }
    setIsJoiningRoom(true);
    setSyncMsg({ text: `Looking up ${code}…`, ok: true });
    try {
      const snap = await getDoc(doc(db!, 'gameRooms', code));
      if (snap.exists()) { router.push(`/room/${code}`); }
      else { setSyncMsg({ text: 'Room not found.', ok: false }); setIsJoiningRoom(false); }
    } catch {
      setSyncMsg({ text: 'Connection error.', ok: false });
      setIsJoiningRoom(false);
    }
  };

  const busy = isCreatingRoom || isJoiningRoom;

  /* ── shared inline style helpers ── */
  const S = {
    card: {
      background: 'var(--panel)', border: '1px solid var(--panel-line)',
      borderRadius: '14px', padding: '30px', position: 'relative' as const,
      overflow: 'hidden', transition: 'border-color .25s ease',
    } as React.CSSProperties,
    tag: {
      fontFamily: 'var(--font-jetbrains-mono),monospace', fontSize: 11,
      letterSpacing: '.1em', textTransform: 'uppercase' as const,
      color: 'var(--lime)', display: 'inline-block',
      border: '1px solid var(--lime-dim)', padding: '3px 9px',
      borderRadius: 99, marginBottom: 14,
    } as React.CSSProperties,
    btnFill: {
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontWeight: 600, fontSize: 14.5, padding: '12px 20px',
      borderRadius: 9, border: 'none', cursor: 'pointer',
      background: 'var(--lime)', color: 'var(--ink)',
      transition: 'transform .15s ease',
      fontFamily: 'var(--font-inter),Inter,sans-serif',
    } as React.CSSProperties,
    btnGhost: {
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontWeight: 600, fontSize: 14.5, padding: '12px 20px',
      borderRadius: 9, cursor: 'pointer', background: 'transparent',
      color: 'var(--paper)', border: '1px solid var(--panel-line)',
      transition: 'border-color .15s ease',
      fontFamily: 'var(--font-inter),Inter,sans-serif',
    } as React.CSSProperties,
    input: {
      flex: 1, background: 'var(--ink)', border: '1px solid var(--panel-line)',
      borderRadius: 9, padding: '12px 14px', color: 'var(--paper)',
      fontFamily: 'var(--font-jetbrains-mono),monospace', fontSize: 14,
      letterSpacing: '.06em', outline: 'none',
    } as React.CSSProperties,
    sectionLabel: {
      fontFamily: 'var(--font-jetbrains-mono),monospace', fontSize: 12,
      letterSpacing: '.14em', textTransform: 'uppercase' as const,
      color: 'var(--paper-dim)', marginBottom: 18,
      display: 'flex', alignItems: 'center', gap: 10,
    } as React.CSSProperties,
  };

  return (
    <div style={{ background: 'var(--ink)', color: 'var(--paper)', minHeight: '100dvh', position: 'relative', overflowX: 'hidden' }}>

      {/* bg grid */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(var(--panel-line) 1px, transparent 1px), linear-gradient(90deg, var(--panel-line) 1px, transparent 1px)',
        backgroundSize: '64px 64px', opacity: .35,
        maskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, black 40%, transparent 90%)',
      }} />

      {/* nav */}
      <header style={{ position: 'relative', zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 28px', maxWidth: 1180, margin: '0 auto' }}>
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--lime)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-jetbrains-mono),monospace', fontWeight: 700, color: 'var(--ink)', fontSize: 15 }}>+</div>
          <span style={{ fontFamily: 'var(--font-space-grotesk),Space Grotesk,sans-serif', fontWeight: 700, fontSize: 17 }}>
            Math<span style={{ color: 'var(--lime)' }}>Pulse</span>
          </span>
        </button>
        <ThemeToggle />
      </header>

      {/* hero */}
      <section style={{ position: 'relative', zIndex: 2, padding: '50px 0 40px', maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ padding: '0 28px' }}>
          {/* eyebrow */}
          <div style={{ fontFamily: 'var(--font-jetbrains-mono),monospace', fontSize: 12.5, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--lime)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--signal)', display: 'inline-block' }} className="animate-dot-pulse" />
            Fastest finger math · live
          </div>

          {/* headline */}
          <h1 style={{ fontFamily: 'var(--font-space-grotesk),Space Grotesk,sans-serif', fontWeight: 700, fontSize: 'clamp(36px,6vw,76px)', lineHeight: .98, letterSpacing: '-.02em', maxWidth: 920 }}>
            Fast hands.<br />Faster minds.{' '}
            <em style={{ fontStyle: 'normal', color: 'var(--lime)' }}>One pulse.</em>
          </h1>
          <p style={{ marginTop: 24, fontSize: 'clamp(15px,1.5vw,18px)', color: 'var(--paper-dim)', maxWidth: 560, lineHeight: 1.6 }}>
            MathPulse is a real-time arithmetic duel — solve, tap, win. Host a lobby, drop the code, and watch the leaderboard move in milliseconds.
          </p>

          <PulseStrip sessionSolves={0} sessionStart={sessionStart} />

          {/* stats row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 18, borderTop: '1px solid var(--panel-line)' }}>
            {[
              { num: '—', lbl: 'Pulses played (this device)' },
              { num: '—', lbl: 'Your fastest solve' },
              { num: '—', lbl: 'Lobbies live right now' },
              { num: '—', lbl: 'Your accuracy' },
            ].map((s) => (
              <div key={s.lbl} style={{ flex: 1, minWidth: 140, padding: '18px 0 4px', borderRight: '1px solid var(--panel-line)' }}
                className="last:border-r-0">
                <div style={{ fontFamily: 'var(--font-jetbrains-mono),monospace', fontSize: 24, fontWeight: 700, color: 'var(--lime)' }}>{s.num}</div>
                <div style={{ fontSize: 12.5, color: 'var(--paper-dim)', marginTop: 4 }}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* today's pulse */}
      <section style={{ position: 'relative', zIndex: 2, padding: '50px 0' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 28px' }}>
          <div style={S.sectionLabel}>
            Today's pulse
            <span style={{ flex: 1, height: 1, background: 'var(--panel-line)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18 }}
            className="[&]:max-[760px]:grid-cols-1">
            {/* daily */}
            <div style={{ ...S.card, background: 'linear-gradient(155deg, rgba(200,255,77,.04) 0%, var(--panel) 60%)' }}>
              <span style={S.tag}>Daily set</span>
              <h3 style={{ fontFamily: 'var(--font-space-grotesk),sans-serif', fontSize: 24, fontWeight: 600, marginBottom: 10, letterSpacing: '-.01em' }}>
                Today's Pulse — Daily Practice Set
              </h3>
              <p style={{ color: 'var(--paper-dim)', fontSize: 14.5, lineHeight: 1.6, marginBottom: 22, maxWidth: '46ch' }}>
                A fresh set of timed problems, same seed for everyone today. Beat your own pace and climb the daily leaderboard.
              </p>
              <button style={S.btnFill} onClick={() => router.push('/daily')}>
                Start daily set →
              </button>
            </div>
            {/* host */}
            <div style={S.card}>
              <span style={S.tag}>Multiplayer</span>
              <h3 style={{ fontFamily: 'var(--font-space-grotesk),sans-serif', fontSize: 24, fontWeight: 600, marginBottom: 10, letterSpacing: '-.01em' }}>
                Host a Global Lobby
              </h3>
              <p style={{ color: 'var(--paper-dim)', fontSize: 14.5, lineHeight: 1.6, marginBottom: 22, maxWidth: '46ch' }}>
                Open a room, set the difficulty, and let anyone with the code drop in. Live ranks update as answers land.
              </p>
              <button style={S.btnGhost} onClick={handleCreateRoom} disabled={busy}>
                {isCreatingRoom ? <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : null}
                {isCreatingRoom ? 'Creating…' : 'Host lobby →'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* join section */}
      <section style={{ position: 'relative', zIndex: 2, padding: '0 0 50px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 28px' }}>
          <div style={S.sectionLabel}>
            Jump into a room
            <span style={{ flex: 1, height: 1, background: 'var(--panel-line)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}
            className="[&]:max-[560px]:grid-cols-1">
            {/* sync */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--panel-line)', borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(200,255,77,.08)', border: '1px solid var(--lime-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--lime)', fontFamily: 'var(--font-jetbrains-mono),monospace', fontWeight: 700, fontSize: 14 }}>⇄</div>
              <h4 style={{ fontFamily: 'var(--font-space-grotesk),sans-serif', fontSize: 16, fontWeight: 600 }}>Sync active link</h4>
              <p style={{ fontSize: 13.5, color: 'var(--paper-dim)', lineHeight: 1.5 }}>Have a 6-digit room code? Enter it to join instantly.</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 483921"
                  value={roomCodeInput}
                  onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && roomCodeInput.length === 6 && handleJoinRoom()}
                  maxLength={6}
                  disabled={busy}
                  style={{ ...S.input }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--lime)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--panel-line)')}
                />
                <button style={{ ...S.btnFill, padding: '10px 18px' }} onClick={handleJoinRoom} disabled={roomCodeInput.length !== 6 || busy}>
                  {isJoiningRoom ? <Loader2 style={{ width: 14, height: 14 }} /> : 'Sync'}
                </button>
              </div>
              {syncMsg && (
                <div style={{ fontFamily: 'var(--font-jetbrains-mono),monospace', fontSize: 12.5, color: syncMsg.ok ? 'var(--lime)' : 'var(--signal)' }}>
                  {syncMsg.text}
                </div>
              )}
            </div>

            {/* owner portal / admin */}
            <div style={{ background: 'var(--panel)', border: '1px solid var(--panel-line)', borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(200,255,77,.08)', border: '1px solid var(--lime-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--lime)', fontFamily: 'var(--font-jetbrains-mono),monospace', fontWeight: 700, fontSize: 14 }}>⚙</div>
              <h4 style={{ fontFamily: 'var(--font-space-grotesk),sans-serif', fontSize: 16, fontWeight: 600 }}>Owner portal</h4>
              <p style={{ fontSize: 13.5, color: 'var(--paper-dim)', lineHeight: 1.5 }}>Deploy today's daily set, monitor live lobbies, and manage the global pulse from the admin console.</p>
              <button style={{ ...S.btnGhost, padding: '10px 18px', width: 'fit-content' }} onClick={() => router.push('/admin/daily')}>
                Open portal →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer style={{ position: 'relative', zIndex: 2, borderTop: '1px solid var(--panel-line)', padding: '30px 0 40px' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ fontFamily: 'var(--font-jetbrains-mono),monospace', fontSize: 13, color: 'var(--paper-dim)' }}>
            MathPulse · precision, speed, repeat.
          </div>
          <div style={{ display: 'flex', gap: 22 }}>
            {[
              { label: 'Daily Pulse', path: '/daily' },
              { label: 'Owner Portal', path: '/admin/daily' },
              { label: 'Host Lobby', action: handleCreateRoom },
            ].map((l) => (
              <button
                key={l.label}
                onClick={() => l.path ? router.push(l.path) : l.action?.()}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--paper-dim)', fontSize: 13.5, fontFamily: 'inherit', transition: 'color .2s ease' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--lime)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--paper-dim)')}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </footer>

    </div>
  );
};

export default HomePage;