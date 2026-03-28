
'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Users, Loader2, Activity, Zap } from 'lucide-react';
import { clearPlayerInfo } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import placeholders from '@/app/lib/placeholder-images.json';
import { ThemeToggle } from '@/components/theme-toggle';

const HomePage: NextPage = () => {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    clearPlayerInfo();
  }, []);

  const generateRoomCode = () => Math.floor(100000 + Math.random() * 900000).toString();

  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    const code = generateRoomCode();
    try {
      if (!db) throw new Error();
      await setDoc(doc(db, 'gameRooms', code), {
        question: 'Ready...',
        answer: 0,
        players: [],
        timeLeft: 30,
        isGameActive: false,
        isGameOver: false,
        isShowingResults: false,
        currentRound: 0,
        roundStartTime: null,
        createdAt: serverTimestamp(),
        customQuestions: []
      });
      router.push(`/room/${code}?host=true`);
    } catch {
      toast({ title: 'Sync Error', description: 'Could not initialize pulse lobby.', variant: 'destructive' });
      setIsCreatingRoom(false);
    }
  };

  const handleJoinRoom = async () => {
    const code = roomCodeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      toast({ title: 'Invalid Code', description: 'Enter a 6-digit pulse code.', variant: 'destructive' });
      return;
    }
    setIsJoiningRoom(true);
    try {
      if (!db) throw new Error();
      const snap = await getDoc(doc(db, 'gameRooms', code));
      if (snap.exists()) router.push(`/room/${code}`);
      else { 
        toast({ title: 'Room Offline', variant: 'destructive' }); 
        setIsJoiningRoom(false); 
      }
    } catch {
      toast({ title: 'Network Error', variant: 'destructive' });
      setIsJoiningRoom(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh w-full max-w-lg mx-auto p-4 relative">
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="mb-8 w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 mb-4 transition-transform hover:scale-[1.02]">
          {!logoError ? (
            <Image 
              src={placeholders.logo.url} 
              alt="MathPulse" 
              width={160} 
              height={50} 
              className="object-contain" 
              onError={() => setLogoError(true)} 
              priority
            />
          ) : (
            <div className="flex items-center gap-3">
              <Activity className="h-10 w-10 text-primary animate-pulse" />
              <span className="text-2xl font-black tracking-tighter text-primary">MathPulse</span>
            </div>
          )}
        </div>
        <div className="px-4 py-1 bg-primary/5 dark:bg-primary/10 rounded-full border border-primary/10">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">Fastest Finger First Challenge</p>
        </div>
      </div>

      <Card className="w-full shadow-2xl rounded-[2.5rem] border-none bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl animate-in zoom-in-95 duration-500 overflow-hidden">
        <CardContent className="space-y-8 pt-10 pb-8 px-8">
          <Button 
            onClick={handleCreateRoom} 
            className="w-full py-7 rounded-2xl shadow-xl transition-all hover:translate-y-[-2px] bg-primary text-white text-xs font-black" 
            disabled={isCreatingRoom || isJoiningRoom}
          >
            {isCreatingRoom ? <Loader2 className="mr-3 animate-spin h-4 w-4" /> : <Zap className="mr-3 fill-white h-4 w-4" />}
            {isCreatingRoom ? 'INITIALIZING PULSE...' : 'LAUNCH GLOBAL LOBBY'}
          </Button>

          <div className="relative">
             <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-100 dark:border-slate-800" /></div>
             <div className="relative flex justify-center text-[8px] uppercase tracking-[0.3em] font-black">
               <span className="bg-white dark:bg-slate-900 px-4 text-muted-foreground/40">Active Sync</span>
             </div>
           </div>

          <div className="flex flex-col space-y-4">
            <Input 
              type="text" 
              placeholder="000000" 
              value={roomCodeInput} 
              onChange={e => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))} 
              className="text-center text-2xl font-mono tracking-[0.4em] h-14 rounded-2xl border-2 dark:bg-slate-950/50" 
              maxLength={6} 
              disabled={isCreatingRoom || isJoiningRoom} 
            />
            <Button 
              onClick={handleJoinRoom} 
              variant="outline" 
              className="w-full py-6 rounded-2xl border-2 font-black text-xs" 
              disabled={roomCodeInput.length !== 6 || isJoiningRoom || isCreatingRoom}
            >
               {isJoiningRoom ? <Loader2 className="mr-3 animate-spin h-4 w-4" /> : <Users className="mr-3 h-4 w-4" />}
               {isJoiningRoom ? 'SYNCING...' : 'ENTER PULSE'}
            </Button>
          </div>
        </CardContent>
         <CardFooter className="text-[8px] text-muted-foreground/30 text-center justify-center uppercase font-black tracking-[0.4em] pb-8">
           Precision • Speed • MathPulse
         </CardFooter>
      </Card>
    </div>
  );
};

export default HomePage;
