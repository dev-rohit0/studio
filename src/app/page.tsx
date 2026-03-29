
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
    if (!db) {
      toast({
        title: 'Connection Error',
        description: 'Database is currently offline.',
        variant: 'destructive',
      });
      return;
    }

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
        description: 'Could not create the game room. Please try again.',
        variant: 'destructive',
      });
      setIsCreatingRoom(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!db) {
      toast({
        title: 'Connection Error',
        description: 'Database is currently offline.',
        variant: 'destructive',
      });
      return;
    }

    const codeToJoin = roomCodeInput.trim();
    if (!/^\d{6}$/.test(codeToJoin)) {
      toast({
        title: 'Invalid Room Code',
        description: 'Please enter a valid 6-digit code.',
        variant: 'destructive',
      });
      return;
    }

    setIsJoiningRoom(true);

    try {
        const roomDocRef = doc(db!, 'gameRooms', codeToJoin);
        const docSnap = await getDoc(roomDocRef);

        if (docSnap.exists()) {
            router.push(`/room/${codeToJoin}`);
        } else {
            toast({
                title: 'Room Not Found',
                description: `Room ${codeToJoin} does not exist.`,
                variant: 'destructive',
            });
            setIsJoiningRoom(false);
        }
    } catch (error: any) {
        toast({
            title: 'Error Joining Room',
            description: 'Could not connect to the room.',
            variant: 'destructive',
        });
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
          <div className="bg-white dark:bg-slate-900 p-6 rounded-[2rem] shadow-2xl ring-1 ring-slate-100 dark:ring-slate-800 transition-transform hover:scale-105">
            <Image 
              src={placeholders.logo.url} 
              alt={placeholders.logo.alt} 
              width={180} 
              height={60} 
              priority
              style={{ height: 'auto' }}
              className="object-contain dark:invert dark:brightness-200"
              onError={() => setLogoError(true)}
            />
          </div>
        ) : (
          <div className="bg-primary/20 p-8 rounded-[2rem] border-2 border-primary/20 backdrop-blur-sm">
            <Activity className="h-14 w-14 text-primary animate-pulse" />
          </div>
        )}
        <div className="mt-4 px-4 py-1.5 bg-white dark:bg-slate-900 rounded-full border border-primary/10 dark:border-primary/20 shadow-md">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/80 dark:text-primary">Precision • Speed • MathPulse</p>
        </div>
      </div>

      <Card className="w-full shadow-2xl rounded-[2rem] border-none bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl overflow-hidden animate-in zoom-in-95 duration-500">
        <CardContent className="space-y-6 pt-10 pb-10 px-6 sm:px-10">
          <Button
            onClick={handleCreateRoom}
            className="w-full text-[10px] py-6 rounded-2xl shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98] group bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest"
            disabled={isCreatingRoom || isJoiningRoom}
          >
            {isCreatingRoom ? <Loader2 className="mr-3 animate-spin" /> : <Zap className="mr-3 fill-white group-hover:animate-bounce h-4 w-4" />}
            {isCreatingRoom ? 'Generating Pulse...' : 'Launch Global Lobby'}
          </Button>

          <div className="relative">
             <div className="absolute inset-0 flex items-center">
               <span className="w-full border-t border-slate-200 dark:border-slate-800" />
             </div>
             <div className="relative flex justify-center text-[8px] uppercase tracking-[0.2em] font-black">
               <span className="bg-white/90 dark:bg-slate-900 px-4 text-muted-foreground/60">
                 Join Active Pulse
               </span>
             </div>
           </div>

          <div className="flex flex-col space-y-4">
            <Input
              type="text"
              placeholder="000000"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-xl sm:text-2xl font-mono tracking-[0.3em] h-14 rounded-2xl border-2 dark:border-slate-800 focus-visible:ring-primary/40 bg-slate-50/50 dark:bg-slate-950/50 font-black"
              maxLength={6}
              inputMode="numeric"
              disabled={isCreatingRoom || isJoiningRoom}
            />
            <Button
              onClick={handleJoinRoom}
              variant="outline"
              className="w-full text-[9px] py-5 rounded-2xl border-2 hover:bg-primary/5 dark:hover:bg-primary/10 hover:border-primary/40 transition-all font-black dark:border-slate-800 uppercase tracking-widest"
              disabled={roomCodeInput.length !== 6 || isJoiningRoom || isCreatingRoom}
            >
               {isJoiningRoom ? <Loader2 className="mr-3 animate-spin h-4 w-4" /> : <Users className="mr-3 h-4 w-4" />}
               {isJoiningRoom ? 'Syncing...' : 'Enter Game'}
            </Button>
          </div>
        </CardContent>
         <CardFooter className="text-[8px] text-muted-foreground/40 text-center justify-center uppercase font-black tracking-[0.4em] pb-8">
            Fastest Finger First Challenge
         </CardFooter>
      </Card>
      
      <AdBanner className="mt-8 w-full max-w-md border-none bg-transparent opacity-40 hover:opacity-100 transition-opacity" />
    </div>
  );
};

export default HomePage;
