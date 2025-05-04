// src/app/page.tsx
'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Home, Users } from 'lucide-react';
import { getGameState, saveGameState, generateId, clearPlayerInfo } from '@/lib/game-storage';
import type { GameState, Player } from '@/types/game';

const HomePage: NextPage = () => {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    // Clear any lingering player info when returning to the home page
    clearPlayerInfo();
  }, []);

  const generateRoomCode = (): string => {
    // Simple 6-digit numeric code generation
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const handleCreateRoom = () => {
    const newRoomCode = generateRoomCode();
    // Basic initial game state - player joins on the next screen
    const initialGameState: GameState = {
        roomCode: newRoomCode,
        question: 'Waiting for host to start...',
        answer: 0,
        players: [], // Host will join in the room page
        timeLeft: 0,
        isGameActive: false,
        currentRound: 0,
        roundStartTime: null,
    };

    // Save the initial state to localStorage
    saveGameState(newRoomCode, initialGameState);

    console.log(`Creating room with code: ${newRoomCode}`);
    // Redirect to the room, the host will join there
    router.push(`/room/${newRoomCode}?host=true`);
  };

  const handleJoinRoom = () => {
    const codeToJoin = roomCodeInput.trim();
    if (!/^\d{6}$/.test(codeToJoin)) {
      toast({
        title: 'Invalid Room Code',
        description: 'Please enter a valid 6-digit room code.',
        variant: 'destructive',
      });
      return;
    }

    // Check if the room exists in localStorage
    const existingGameState = getGameState(codeToJoin);

    if (!existingGameState) {
      toast({
        title: 'Room Not Found',
        description: `Could not find a game room with code ${codeToJoin}.`,
        variant: 'destructive',
      });
      return;
    }

    // Room exists, navigate to it
    console.log(`Joining room with code: ${codeToJoin}`);
    router.push(`/room/${codeToJoin}`);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full max-w-md p-4">
      <Card className="w-full shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-primary flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-brain-circuit"><path d="M12 5a3 3 0 1 0-5.997.142"/><path d="M18 5a3 3 0 1 0-5.997.142"/><path d="M12 12a3 3 0 1 0-5.997.142"/><path d="M18 12a3 3 0 1 0-5.997.142"/><path d="M12 19a3 3 0 1 0-5.997.142"/><path d="M18 19a3 3 0 1 0-5.997.142"/><path d="M12 8V5"/><path d="M18 8V5"/><path d="M12 15v-3"/><path d="M18 15v-3"/><path d="M12 22v-3"/><path d="M18 22v-3"/><path d="m15 6-3-1-3 1"/><path d="m15 13-3-1-3 1"/><path d="m15 20-3-1-3 1"/><path d="M9 6.14A3 3 0 0 0 9 5"/><path d="M9 13.14A3 3 0 0 0 9 12"/><path d="M9 20.14A3 3 0 0 0 9 19"/><path d="M15 6.14A3 3 0 0 1 15 5"/><path d="M15 13.14A3 3 0 0 1 15 12"/><path d="M15 20.14A3 3 0 0 1 15 19"/></svg>
            Math Mania
          </CardTitle>
          <CardDescription>Fastest Finger First!</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Button
            onClick={handleCreateRoom}
            className="w-full text-lg py-6"
            aria-label="Create a new game room"
          >
            <Home className="mr-2" /> Create Room
          </Button>
          <div className="relative">
             <div className="absolute inset-0 flex items-center">
               <span className="w-full border-t" />
             </div>
             <div className="relative flex justify-center text-xs uppercase">
               <span className="bg-card px-2 text-muted-foreground">
                 Or join a room
               </span>
             </div>
           </div>
          <div className="flex flex-col space-y-2">
            <Input
              type="text"
              placeholder="Enter 6-digit Room Code"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))} // Allow only 6 digits
              className="text-center text-lg tracking-widest"
              maxLength={6}
              pattern="\d{6}"
              inputMode="numeric" // Suggest numeric keyboard on mobile
              aria-label="Enter 6-digit room code"
            />
            <Button
              onClick={handleJoinRoom}
              variant="secondary"
              className="w-full text-lg py-6"
              aria-label="Join an existing game room"
              disabled={roomCodeInput.length !== 6}
            >
              <Users className="mr-2" /> Join Room
            </Button>
          </div>
        </CardContent>
         <CardFooter className="text-xs text-muted-foreground text-center justify-center">
            Get ready to test your math skills!
         </CardFooter>
      </Card>
    </div>
  );
};

export default HomePage;
