'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calendar, Trophy, ArrowLeft, Activity } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { DailyChallenge } from '@/types/game';
import { ThemeToggle } from '@/components/theme-toggle';

const DailyPulsePage: NextPage = () => {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [isStarted, setIsStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const fetchDailyChallenge = async () => {
      if (!db) return;
      const today = new Date().toISOString().split('T')[0];
      const docRef = doc(db!, 'dailyChallenges', today);
      try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setChallenge(docSnap.data() as DailyChallenge);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchDailyChallenge();
  }, []);

  const handleStart = () => {
    setIsStarted(true);
    setStartTime(Date.now());
  };

  const handleAnswerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || !currentAnswer) return;

    const correctAns = challenge.questions[currentIndex].answer;
    if (parseFloat(currentAnswer) === correctAns) {
      setScore(prev => prev + 100);
      if (currentIndex + 1 < challenge.questions.length) {
        setCurrentIndex(prev => prev + 1);
        setCurrentAnswer('');
      } else {
        setIsFinished(true);
      }
    } else {
      toast({ title: "Incorrect Pulse", variant: "destructive" });
      setCurrentAnswer('');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <Loader2 className="animate-spin text-primary h-10 w-10" />
      </div>
    );
  }

  if (!challenge || challenge.questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh p-4 space-y-6">
        <Activity className="h-12 w-12 text-primary/20" />
        <h2 className="text-sm font-black uppercase tracking-widest text-center">No Daily Pulse Found</h2>
        <Button variant="outline" onClick={() => router.push('/')} className="text-[8px] font-black uppercase rounded-xl border-2">Return to Base</Button>
      </div>
    );
  }

  if (isFinished) {
    const timeTaken = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 bg-slate-50 dark:bg-slate-950">
        <Card className="w-full max-w-md shadow-2xl border-none rounded-[2.5rem] bg-white/95 dark:bg-slate-900/95 p-8 text-center animate-in zoom-in-95 duration-500">
           <Trophy className="h-12 w-12 text-yellow-500 mx-auto mb-6" />
           <CardTitle className="text-lg font-black uppercase tracking-tighter mb-2">Pulse Completed</CardTitle>
           <div className="grid grid-cols-2 gap-4 my-8">
              <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                 <p className="text-[7px] font-black text-muted-foreground uppercase mb-1">Score</p>
                 <p className="text-lg font-black text-primary">{score}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                 <p className="text-[7px] font-black text-muted-foreground uppercase mb-1">Time</p>
                 <p className="text-lg font-black text-primary">{timeTaken}s</p>
              </div>
           </div>
           <Button onClick={() => router.push('/')} className="w-full h-12 rounded-xl text-[8px] font-black uppercase tracking-widest text-white">Back to Lobby</Button>
        </Card>
      </div>
    );
  }

  if (!isStarted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 bg-slate-50 dark:bg-slate-950">
        <Card className="w-full max-w-md shadow-2xl border-none rounded-[2.5rem] bg-white/95 dark:bg-slate-900/95 p-10 text-center">
           <Calendar className="h-10 w-10 text-primary mx-auto mb-6" />
           <CardTitle className="text-lg font-black uppercase tracking-tighter mb-2">Daily Pulse Challenge</CardTitle>
           <CardDescription className="text-[8px] font-bold uppercase tracking-widest mb-8">Set for {new Date().toLocaleDateString()}</CardDescription>
           <div className="bg-primary/5 p-4 rounded-2xl border border-primary/10 mb-8">
              <p className="text-[8px] font-black uppercase text-primary leading-relaxed">
                 {challenge.questions.length} Equations • No Timers • Pure Precision
              </p>
           </div>
           <Button onClick={handleStart} className="w-full h-14 rounded-xl text-[9px] font-black uppercase tracking-widest text-white shadow-xl">INITIATE PULSE</Button>
           <Button variant="ghost" onClick={() => router.push('/')} className="mt-4 text-[7px] font-black uppercase text-muted-foreground"><ArrowLeft className="mr-2 h-3 w-3" /> Abort</Button>
        </Card>
      </div>
    );
  }

  const currentQ = challenge.questions[currentIndex];

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 bg-slate-50 dark:bg-slate-950">
      <div className="absolute top-4 left-4">
         <Button variant="ghost" size="sm" onClick={() => router.push('/')} className="h-8 w-8 p-0 rounded-full bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm"><ArrowLeft className="h-4 w-4" /></Button>
      </div>
      <div className="absolute top-4 right-4">
         <ThemeToggle />
      </div>

      <div className="w-full max-w-lg space-y-6">
         <div className="flex justify-between items-center px-4">
            <span className="text-[7px] font-black uppercase tracking-widest text-muted-foreground">Pulse Progression</span>
            <span className="text-[8px] font-black font-mono">{currentIndex + 1} / {challenge.questions.length}</span>
         </div>
         <Progress value={((currentIndex) / challenge.questions.length) * 100} className="h-1.5 mx-4" />

         <Card className="shadow-2xl border-none rounded-[2.5rem] bg-white/95 dark:bg-slate-900/95 overflow-hidden">
            <CardContent className="p-8 sm:p-12 text-center space-y-8">
               <div className="inline-block px-3 py-1 rounded-full bg-primary/5 border border-primary/10">
                  <span className="text-[7px] font-black text-primary uppercase tracking-[0.2em]">Target Identification</span>
               </div>
               <h2 className="text-3xl sm:text-4xl font-black font-mono tracking-tighter">{currentQ.question} = ?</h2>
               
               <form onSubmit={handleAnswerSubmit} className="space-y-4">
                  <Input 
                    type="number"
                    value={currentAnswer}
                    onChange={(e) => setCurrentAnswer(e.target.value)}
                    placeholder="RESULT..."
                    className="h-14 rounded-2xl text-center text-xl font-black border-2 bg-slate-50/50 dark:bg-slate-950/50 dark:border-slate-800"
                    autoFocus
                  />
                  <Button type="submit" className="w-full h-14 rounded-2xl text-[9px] font-black uppercase tracking-widest text-white shadow-lg shadow-primary/20">CONFIRM RESULT</Button>
               </form>
            </CardContent>
         </Card>
      </div>
    </div>
  );
};

export default DailyPulsePage;