'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Calendar, Trophy, ArrowLeft, Activity, Clock } from 'lucide-react';
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
  const [timeLeft, setTimeLeft] = useState(20);

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

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isStarted && !isFinished && !isLoading) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            toast({ title: "Time's Up!", variant: 'destructive' });
            moveToNext();
            return 20;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isStarted, isFinished, isLoading, currentIndex]);

  const handleStart = () => {
    setIsStarted(true);
    setStartTime(Date.now());
    setTimeLeft(20);
  };

  const moveToNext = () => {
    if (challenge && currentIndex + 1 < challenge.questions.length) {
      setCurrentIndex((prev) => prev + 1);
      setCurrentAnswer('');
      setTimeLeft(20);
    } else {
      setIsFinished(true);
    }
  };

  const handleAnswerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || !currentAnswer) return;

    const correctAns = challenge.questions[currentIndex].answer;
    if (parseFloat(currentAnswer) === correctAns) {
      setScore((prev) => prev + 100);
      moveToNext();
    } else {
      toast({ title: 'Incorrect Pulse', variant: 'destructive' });
      setCurrentAnswer('');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-ink">
        <Loader2 className="animate-spin text-lime h-9 w-9" />
      </div>
    );
  }

  if (!challenge || challenge.questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh p-4 space-y-6 bg-ink">
        <Activity className="h-12 w-12 text-paperDim/30" />
        <h2 className="font-display text-lg font-bold text-paper text-center">No Daily Pulse Found</h2>
        <Button
          variant="outline"
          onClick={() => router.push('/')}
          className="rounded-lg border border-panelLine bg-transparent text-xs font-semibold text-paperDim hover:text-paper hover:border-paper"
        >
          Return to base
        </Button>
      </div>
    );
  }

  if (isFinished) {
    const timeTaken = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 bg-ink">
        <Card className="w-full max-w-md border border-panelLine rounded-2xl bg-panel p-8 text-center animate-in zoom-in-95 duration-500">
          <Trophy className="h-11 w-11 text-lime mx-auto mb-6" />
          <CardTitle className="font-display text-xl font-bold text-paper mb-1">Pulse Completed</CardTitle>
          <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-paperDim mb-6">
            Daily set · {new Date().toLocaleDateString()}
          </p>
          <div className="grid grid-cols-2 gap-3 my-2 border-t border-panelLine pt-6">
            <div className="bg-ink/50 p-4 rounded-xl border border-panelLine">
              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-paperDim mb-1">Score</p>
              <p className="font-mono text-2xl font-bold text-lime">{score}</p>
            </div>
            <div className="bg-ink/50 p-4 rounded-xl border border-panelLine">
              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-paperDim mb-1">Total time</p>
              <p className="font-mono text-2xl font-bold text-lime">{timeTaken}s</p>
            </div>
          </div>
          <Button
            onClick={() => router.push('/')}
            className="w-full h-12 mt-6 rounded-lg bg-lime text-ink hover:bg-limeDim font-semibold text-sm tracking-wide"
          >
            Back to lobby
          </Button>
        </Card>
      </div>
    );
  }

  if (!isStarted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 bg-ink">
        <Card className="w-full max-w-md border border-panelLine rounded-2xl bg-panel p-10 text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-limeDim bg-lime/10">
            <Calendar className="h-6 w-6 text-lime" />
          </div>
          <CardTitle className="font-display text-xl font-bold text-paper mb-1">Daily Pulse Challenge</CardTitle>
          <CardDescription className="font-mono text-[11px] tracking-[0.12em] uppercase text-paperDim mb-8">
            Set for {new Date().toLocaleDateString()}
          </CardDescription>
          <div className="bg-lime/5 p-4 rounded-xl border border-limeDim mb-8">
            <p className="font-mono text-[11px] tracking-[0.06em] uppercase text-lime leading-relaxed">
              {challenge.questions.length} equations · 20s per question · high speed
            </p>
          </div>
          <Button
            onClick={handleStart}
            className="w-full h-14 rounded-xl bg-lime text-ink hover:bg-limeDim font-semibold text-sm tracking-wide"
          >
            Initiate pulse
          </Button>
          <Button
            variant="ghost"
            onClick={() => router.push('/')}
            className="mt-4 text-xs font-medium text-paperDim hover:text-paper hover:bg-transparent"
          >
            <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Abort
          </Button>
        </Card>
      </div>
    );
  }

  const currentQ = challenge.questions[currentIndex];

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh w-full p-4 bg-ink relative">
      <div className="absolute top-4 left-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/')}
          className="h-8 w-8 p-0 rounded-full bg-panel border border-panelLine text-paperDim hover:text-paper"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-lg space-y-6">
        <div className="flex justify-between items-center px-4">
          <div className="flex items-center gap-2">
            <Clock className={`h-3.5 w-3.5 ${timeLeft < 5 ? 'text-signal animate-pulse' : 'text-lime'}`} />
            <span className={`font-mono text-xs font-bold ${timeLeft < 5 ? 'text-signal' : 'text-lime'}`}>
              {timeLeft}s
            </span>
          </div>
          <span className="font-mono text-xs font-bold text-paperDim">
            {currentIndex + 1} / {challenge.questions.length}
          </span>
        </div>
        <Progress
          value={(currentIndex / challenge.questions.length) * 100}
          className="h-1.5 mx-4 bg-panelLine [&>div]:bg-lime"
        />

        <Card className="border border-panelLine rounded-2xl bg-panel overflow-hidden">
          <CardContent className="p-8 sm:p-12 text-center space-y-8">
            <div className="inline-block px-3 py-1 rounded-full bg-lime/5 border border-limeDim">
              <span className="font-mono text-[11px] font-medium text-lime uppercase tracking-[0.18em]">
                Target identification
              </span>
            </div>
            <h2 className="font-mono text-3xl sm:text-4xl font-bold tracking-tight text-paper">
              {currentQ.question} = ?
            </h2>

            <form onSubmit={handleAnswerSubmit} className="space-y-4">
              <Input
                type="number"
                value={currentAnswer}
                onChange={(e) => setCurrentAnswer(e.target.value)}
                placeholder="Result"
                className="h-14 rounded-xl text-center text-xl font-bold border border-panelLine bg-ink text-paper placeholder:text-paperDim focus-visible:ring-lime focus-visible:ring-offset-0"
                autoFocus
              />
              <Button
                type="submit"
                className="w-full h-14 rounded-xl bg-lime text-ink hover:bg-limeDim font-semibold text-sm tracking-wide"
              >
                Confirm result
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DailyPulsePage;