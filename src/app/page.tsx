'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Home, Users, Loader2, Activity, Zap } from 'lucide-react';
import { clearPlayerInfo } from '@/lib/game-storage';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import type { GameState } from '@/types/game';
import AdBanner from '@/components/ads/AdBanner';
import placeholders from '@/app/lib/placeholder-images.json';

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
      if (!db) {
        toast({
          title: 'Connection Error',
          description: 'Database is currently offline.',
          variant: 'destructive',
        });
        setIsCreatingRoom(false);
        return;
      }

      const roomDocRef = doc(db, 'gameRooms', newRoomCode);
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
        if (!db) {
          toast({
            title: 'Connection Error',
            description: 'Database is currently offline.',
            variant: 'destructive',
          });
          setIsJoiningRoom(false);
          return;
        }

        const roomDocRef = doc(db, 'gameRooms', codeToJoin);
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
    <div className="flex flex-col items-center justify-center min-h-screen w-full max-w-md p-4 bg-secondary/50">
      <div className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex flex-col items-center">
          {!logoError ? (
            <Image 
              src={placeholders.logo.url} 
              alt={placeholders.logo.alt} 
              width={220} 
              height={80} 
              className="object-contain drop-shadow-xl"
              onError={() => setLogoError(true)}
            />
          ) : (
            <div className="bg-primary/20 p-6 rounded-3xl border-2 border-primary/20 backdrop-blur-sm">
              <Activity className="h-20 w-20 text-primary animate-pulse" />
            </div>
          )}
          <div className="mt-4 px-4 py-1.5 bg-primary/10 rounded-full border border-primary/10">
            <p className="text-xs font-black uppercase tracking-widest text-primary/80">Fastest Finger First</p>
          </div>
        </div>
      </div>

      <Card className="w-full shadow-2xl rounded-3xl border-none bg-white/80 backdrop-blur-md overflow-hidden animate-in zoom-in-95 duration-500">
        <CardContent className="space-y-6 pt-8 pb-8 px-8">
          <Button
            onClick={handleCreateRoom}
            className="w-full text-xl py-8 rounded-2xl shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] group"
            disabled={isCreatingRoom || isJoiningRoom}
          >
            {isCreatingRoom ? <Loader2 className="mr-2 animate-spin" /> : <Zap className="mr-2 group-hover:animate-bounce" />}
            {isCreatingRoom ? 'Creating...' : 'Launch Lobby'}
          </Button>

          <div className="relative">
             <div className="absolute inset-0 flex items-center">
               <span className="w-full border-t border-slate-200" />
             </div>
             <div className="relative flex justify-center text-xs uppercase tracking-tighter">
               <span className="bg-white/80 px-4 text-muted-foreground font-bold">
                 Join Active Pulse
               </span>
             </div>
           </div>

          <div className="flex flex-col space-y-3">
            <Input
              type="text"
              placeholder="000000"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-3xl font-mono tracking-[0.5em] h-16 rounded-2xl border-2 focus-visible:ring-primary/40 bg-slate-50"
              maxLength={6}
              inputMode="numeric"
              disabled={isCreatingRoom || isJoiningRoom}
            />
            <Button
              onClick={handleJoinRoom}
              variant="outline"
              className="w-full text-lg py-8 rounded-2xl border-2 hover:bg-primary/5 hover:border-primary/40 transition-all"
              disabled={roomCodeInput.length !== 6 || isJoiningRoom || isCreatingRoom}
            >
               {isJoiningRoom ? <Loader2 className="mr-2 animate-spin" /> : <Users className="mr-2" />}
               {isJoiningRoom ? 'Joining...' : 'Enter Game'}
            </Button>
          </div>
        </CardContent>
         <CardFooter className="text-[10px] text-muted-foreground/60 text-center justify-center uppercase font-black tracking-widest pb-6">
            Precision • Speed • MathPulse
         </CardFooter>
      </Card>
      
      <AdBanner className="mt-8 w-full max-w-md border-none bg-transparent opacity-60" />
    </div>
  );
};

export default HomePage;
