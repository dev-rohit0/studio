// src/app/page.tsx
'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Home, Users, Loader2 } from 'lucide-react';
import { clearPlayerInfo } from '@/lib/game-storage'; // Removed generateId as it's not used here anymore
import { db } from '@/lib/firebase'; // Import Firestore instance
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import type { GameState } from '@/types/game';

const HomePage: NextPage = () => {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    // Clear any lingering player info when returning to the home page
    clearPlayerInfo();
    console.log("Cleared player info on home page load.");
  }, []);

  const generateRoomCode = (): string => {
    // Simple 6-digit numeric code generation
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    const newRoomCode = generateRoomCode();
    console.log(`[CreateRoom] Generated new room code: ${newRoomCode}`);

    // Basic initial game state for Firestore
    // Omit 'roomCode' as it's the document ID itself
    // Add explicit null check for roundStartTime for clarity
    const initialGameState: Omit<GameState, 'roomCode'> & { createdAt: any } = {
        question: 'Waiting for host to start...',
        answer: 0, // Ensure answer is a number
        players: [], // Start with an empty player array
        timeLeft: 0, // Initial time, will be set when round starts
        isGameActive: false,
        currentRound: 0,
        roundStartTime: null, // Explicitly null initially
        createdAt: serverTimestamp(), // Add a creation timestamp
    };

    try {
      // Ensure db is initialized before using it
      if (!db) {
        console.error("[CreateRoom] Firestore database instance is not available.");
        toast({
          title: 'Error Creating Room',
          description: 'Database connection failed. Please try again later.',
          variant: 'destructive',
        });
        setIsCreatingRoom(false);
        return;
      }

      const roomDocRef = doc(db, 'gameRooms', newRoomCode);
      console.log(`[CreateRoom] Attempting to create Firestore document at path: ${roomDocRef.path}`);
      console.log(`[CreateRoom] Data to be written:`, JSON.parse(JSON.stringify(initialGameState, (key, value) => // Use JSON stringify to handle potential non-serializable values in log
        typeof value === 'undefined' ? 'undefined_value' : value
      )));

      // Perform the Firestore write operation
      await setDoc(roomDocRef, initialGameState);
      console.log(`[CreateRoom] Successfully created Firestore document for room: ${newRoomCode}`);

      // Redirect to the room, passing host=true flag
      console.log(`[CreateRoom] Redirecting to /room/${newRoomCode}?host=true`);
      router.push(`/room/${newRoomCode}?host=true`);
      // State will reset on navigation, no need to set isCreatingRoom false here

    } catch (error: any) { // Catch specific error type if possible, otherwise use any
      console.error(`[CreateRoom] Error creating Firestore document for room ${newRoomCode}:`, error);
      // Provide more specific error feedback if possible
      let description = 'Could not create the game room. Please check connection or permissions and try again.';
      if (error.code === 'permission-denied') {
          description = 'Permission denied. Check Firestore rules.';
      } else if (error.message?.includes('offline')) {
           description = 'Network error. Please check your internet connection.';
      } else if (error.message?.includes('INVALID_ARGUMENT')) {
            description = 'Invalid data sent to the server. Please contact support.';
             console.error("[CreateRoom] Detailed error data:", error.details); // Log more details if available
      }

      toast({
        title: 'Error Creating Room',
        description: description,
        variant: 'destructive',
      });
      setIsCreatingRoom(false); // Explicitly reset state on error
    }
    // Removed finally block as state is handled in success (navigation) or error (catch)
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
    console.log(`[JoinRoom] Attempting to join room with code: ${codeToJoin}`);

    try {
        // Ensure db is initialized before using it
        if (!db) {
          console.error("[JoinRoom] Firestore database instance is not available.");
          toast({
            title: 'Error Joining Room',
            description: 'Database connection failed. Please try again later.',
            variant: 'destructive',
          });
          setIsJoiningRoom(false);
          return;
        }

        const roomDocRef = doc(db, 'gameRooms', codeToJoin);
        console.log(`[JoinRoom] Checking Firestore document: gameRooms/${codeToJoin}`);
        const docSnap = await getDoc(roomDocRef);

        if (docSnap.exists()) {
            console.log(`[JoinRoom] Room ${codeToJoin} found in Firestore. Data:`, docSnap.data());
            // Room exists, navigate to it
            console.log(`[JoinRoom] Redirecting to /room/${codeToJoin}`);
            router.push(`/room/${codeToJoin}`);
             // State will reset on navigation
        } else {
            console.warn(`[JoinRoom] Room ${codeToJoin} not found in Firestore.`);
            toast({
                title: 'Room Not Found',
                description: `Could not find a game room with code ${codeToJoin}. Please double-check the code.`,
                variant: 'destructive',
            });
            setIsJoiningRoom(false); // Reset state on error
        }
    } catch (error: any) { // Catch specific error type if possible
        console.error(`[JoinRoom] Error checking Firestore document for room ${codeToJoin}:`, error);
         let description = 'Could not check if the room exists. Please check connection and try again.';
          if (error.code === 'permission-denied') {
              description = 'Permission denied. Check Firestore rules.';
          } else if (error.message?.includes('offline')) {
               description = 'Network error. Please check your internet connection.';
          }
        toast({
            title: 'Error Joining Room',
            description: description,
            variant: 'destructive',
        });
        setIsJoiningRoom(false); // Reset state on error
    }
     // Removed finally block as state is handled in success (navigation) or error (catch)
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full max-w-md p-4">
      <Card className="w-full shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-primary flex items-center justify-center gap-2">
            {/* Reverted to SVG as requested - ensure BrainCircuit is defined or use another icon */}
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
              disabled={isCreatingRoom || isJoiningRoom}
            />
            <Button
              onClick={handleJoinRoom}
              variant="secondary"
              className="w-full text-lg py-6"
              aria-label="Join an existing game room"
              disabled={roomCodeInput.length !== 6 || isJoiningRoom || isCreatingRoom}
            >
               {isJoiningRoom ? <Loader2 className="mr-2 animate-spin" /> : <Users className="mr-2" />}
               {isJoiningRoom ? 'Joining...' : 'Join Room'}
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
