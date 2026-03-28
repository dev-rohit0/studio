
'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Home, Users, Loader2, Activity } from 'lucide-react';
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
        question: 'Waiting for host to start...',
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
          title: 'Error Creating Room',
          description: 'Database connection failed. Please try again later.',
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
        description: 'Please enter a valid 6-digit room code.',
        variant: 'destructive',
      });
      return;
    }

    setIsJoiningRoom(true);

    try {
        if (!db) {
          toast({
            title: 'Error Joining Room',
            description: 'Database connection failed. Please try again later.',
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
                description: `Could not find a game room with code ${codeToJoin}.`,
                variant: 'destructive',
            });
            setIsJoiningRoom(false);
        }
    } catch (error: any) {
        toast({
            title: 'Error Joining Room',
            description: 'Could not check if the room exists.',
            variant: 'destructive',
        });
        setIsJoiningRoom(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full max-w-md p-4">
      <Card className="w-full shadow-lg border-none">
        <CardHeader className="text-center space-y-4">
          <div className="flex flex-col items-center gap-2">
            {!logoError ? (
              <Image 
                src={placeholders.logo.url} 
                alt={placeholders.logo.alt} 
                width={120} 
                height={40} 
                className="object-contain mb-2"
                onError={() => setLogoError(true)}
              />
            ) : (
              <div className="bg-primary/10 p-4 rounded-full mb-2">
                <Activity className="h-12 w-12 text-primary animate-pulse" />
              </div>
            )}
          </div>
          <CardDescription className="text-base font-medium">Fastest Finger First Challenge!</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button
            onClick={handleCreateRoom}
            className="w-full text-lg py-7 rounded-xl"
            aria-label="Create a new game room"
            disabled={isCreatingRoom || isJoiningRoom}
          >
            {isCreatingRoom ? <Loader2 className="mr-2 animate-spin" /> : <Home className="mr-2" />}
            {isCreatingRoom ? 'Creating...' : 'Create Room'}
          </Button>
          <div className="relative">
             <div className="absolute inset-0 flex items-center">
               <span className="w-full border-t" />
             </div>
             <div className="relative flex justify-center text-xs uppercase">
               <span className="bg-card px-2 text-muted-foreground font-semibold">
                 Or join a room
               </span>
             </div>
           </div>
          <div className="flex flex-col space-y-2">
            <Input
              type="text"
              placeholder="Enter 6-digit Room Code"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center text-xl tracking-widest h-14 rounded-xl border-2 focus-visible:ring-primary"
              maxLength={6}
              inputMode="numeric"
              disabled={isCreatingRoom || isJoiningRoom}
            />
            <Button
              onClick={handleJoinRoom}
              variant="secondary"
              className="w-full text-lg py-7 rounded-xl"
              disabled={roomCodeInput.length !== 6 || isJoiningRoom || isCreatingRoom}
            >
               {isJoiningRoom ? <Loader2 className="mr-2 animate-spin" /> : <Users className="mr-2" />}
               {isJoiningRoom ? 'Joining...' : 'Join Room'}
            </Button>
          </div>
        </CardContent>
         <CardFooter className="text-xs text-muted-foreground text-center justify-center italic">
            Test your pulse, solve the equations.
         </CardFooter>
      </Card>
      <AdBanner className="mt-8 w-full max-w-md" />
    </div>
  );
};

export default HomePage;
