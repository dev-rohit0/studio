'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Users, Loader2, Activity, Zap, Calendar, ArrowRight } from 'lucide-react';
import { clearPlayerInfo } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import type { GameState } from '@/types/game';
import AdBanner from '@/components/ads/AdBanner';
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

  const generateRoomCode = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const handleCreateRoom = async () => {
    if (!db) return;
    setIsCreatingRoom(true);
    const newRoomCode = generateRoomCode();

    const initialGameState: Omit<GameState, 'roomCode'> & { createdAt: any } = {
        question: 'Waiting for host...',
        answer: 0,
        players: [],
        timeLeft: 0,
        isGameActive: false,
        currentRound: 0,
        roundStartTime: null,
        createdAt: serverTimestamp(),
    };

    try {
      const roomDocRef = doc(db!, 'gameRooms', newRoomCode);
      await setDoc(roomDocRef, initialGameState);
      router.push(`/room/${newRoomCode}?host=true`);
    } catch (error: any) {
      toast({
        title: 'Error Creating Room',
        description: 'Could not create the game room.',
        variant: 'destructive',
      });
      setIsCreatingRoom(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!db) return;
    const codeToJoin = roomCodeInput.trim();
    if (!/^\d{6}$/.test(codeToJoin)) {
      toast({ title: 'Invalid Room Code', variant: 'destructive' });
      return;
    }

    setIsJoiningRoom(true);
    try {
        const roomDocRef = doc(db!, 'gameRooms', codeToJoin);
        const docSnap = await getDoc(roomDocRef);
        if (docSnap.exists()) {
            router.push(`/room/${codeToJoin}`);
        } else {
            toast({ title: 'Room Not Found', variant: 'destructive' });
            setIsJoiningRoom(false);
        }
    } catch (error: any) {
        toast({ title: 'Connection Error', variant: 'destructive' });
        setIsJoiningRoom(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh w-full max-w-lg mx-auto p-4 relative">
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      <div className="mb-6 w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-700">
        {!logoError ? (
          <div className="bg-white dark:bg-slate-900 p-4 rounded-[1.5rem] shadow-2xl ring-1 ring-slate-100 dark:ring-slate-800">
            <Image 
              src={placeholders.logo.url} 
              alt={placeholders.logo.alt} 
              width={140} 
              height={40} 
              priority
              style={{ height: 'auto' }}
              className="object-contain dark:invert dark:brightness-200"
              onError={() => setLogoError(true)}
            />
          </div>
        ) : (
          <div className="bg-primary/20 p-6 rounded-[1.5rem] border-2 border-primary/20">
            <Activity className="h-10 w-10 text-primary animate-pulse" />
          </div>
        )}
        <div className="mt-4 px-4 py-1.5 bg-white dark:bg-slate-900 rounded-full border border-primary/10 shadow-md">
          <p className="text-[7px] font-black uppercase tracking-[0.2em] text-primary/80">Precision • Speed • MathPulse</p>
        </div>
      </div>

      <Card className="w-full shadow-2xl rounded-[2rem] border-none bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl overflow-hidden mb-6">
        <CardContent className="space-y-4 pt-8 pb-8 px-6 sm:px-10">
          <div className="bg-primary/5 dark:bg-primary/10 p-4 rounded-2xl border border-primary/10 flex items-center justify-between group cursor-pointer hover:bg-primary/10 transition-colors" onClick={() => router.push('/daily')}>
             <div className="flex items-center gap-3">
                <div className="bg-primary p-2 rounded-xl shadow-lg shadow-primary/20">
                   <Calendar className="h-4 w-4 text-white" />
                </div>
                <div>
                   <h3 className="text-[10px] font-black uppercase tracking-tight">Today's Pulse</h3>
                   <p className="text-[6px] font-bold text-muted-foreground uppercase">Daily Practice Set</p>
                </div>
             </div>
             <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-1 transition-transform" />
          </div>

          <Button
            onClick={handleCreateRoom}
            className="w-full text-[8px] py-6 rounded-2xl shadow-xl transition-all hover:scale-[1.01] active:scale-[0.98] group bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest"
            disabled={isCreatingRoom || isJoiningRoom}
          >
            {isCreatingRoom ? <Loader2 className="mr-3 animate-spin" /> : <Zap className="mr-3 fill-white h-3 w-3" />}
            {isCreatingRoom ? 'Generating...' : 'Host Global Lobby'}
          </Button>

          <div className="relative py-2">
             <div className="absolute inset-0 flex items-center">
               <span className="w-full border-t border-slate-100 dark:border-slate-800" />
             </div>
             <div className="relative flex justify-center text-[6px] uppercase tracking-[0.2em] font-black">
               <span className="bg-white/95 dark:bg-slate-900 px-4 text-muted-foreground/40">
                 Sync Active Link
               </span>
             </div>
           </div>

          <div className="flex flex-col space-y-3">
            <Input
              type="text"
              placeholder="000000"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-xl font-mono tracking-[0.3em] h-12 rounded-xl border-2 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 font-black"
              maxLength={6}
              disabled={isCreatingRoom || isJoiningRoom}
            />
            <Button
              onClick={handleJoinRoom}
              variant="outline"
              className="w-full text-[8px] py-5 rounded-xl border-2 hover:bg-primary/5 transition-all font-black dark:border-slate-800 uppercase tracking-widest"
              disabled={roomCodeInput.length !== 6 || isJoiningRoom || isCreatingRoom}
            >
               {isJoiningRoom ? <Loader2 className="mr-2 animate-spin h-3 w-3" /> : <Users className="mr-2 h-3 w-3" />}
               Join Game
            </Button>
          </div>
        </CardContent>
      </Card>
      
      <div className="w-full flex justify-center opacity-30 hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="sm" className="text-[6px] font-black uppercase tracking-[0.3em]" onClick={() => router.push('/admin/daily')}>Owner Portal</Button>
      </div>
      <AdBanner className="mt-6 w-full border-none bg-transparent opacity-40" />
    </div>
  );
};

export default HomePage;