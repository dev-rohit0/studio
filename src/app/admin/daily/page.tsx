'use client';

import type { NextPage } from 'next';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Save, ArrowLeft, Loader2, Lock } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import type { DailyChallenge, CustomQuestion } from '@/types/game';
import { useRouter } from 'next/navigation';

const DailyAdminPage: NextPage = () => {
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [passKey, setPassKey] = useState('');

  const router = useRouter();
  const { toast } = useToast();
  const today = new Date().toISOString().split('T')[0];

  // Auto-calculator logic
  const evaluateExpression = (expr: string): number | null => {
    const sanitized = expr.replace(/x/gi, '*').replace(/÷/g, '/').replace(/[^-+*/().0-9 ]/g, '');
    try {
      if (!sanitized.trim()) return null;
      if (/[^0-9+\-*/(). ]/.test(sanitized)) return null;
      const result = new Function(`return ${sanitized}`)();
      return typeof result === 'number' && isFinite(result) ? Math.round(result * 100) / 100 : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const calculatedAns = evaluateExpression(newQ);
    if (calculatedAns !== null) {
      setNewA(calculatedAns.toString());
    }
  }, [newQ]);

  useEffect(() => {
    const fetchExisting = async () => {
      if (!db) return;
      try {
        const docRef = doc(db!, 'dailyChallenges', today);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setQuestions(docSnap.data().questions || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchExisting();
  }, [today]);

  const handleAddQuestion = () => {
    if (!newQ || !newA) return;
    setQuestions([...questions, { question: newQ, answer: parseFloat(newA) }]);
    setNewQ('');
    setNewA('');
  };

  const handleRemove = (idx: number) => {
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!db) return;
    setIsSaving(true);
    try {
      const challenge: DailyChallenge = {
        id: today,
        questions,
        active: true,
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db!, 'dailyChallenges', today), challenge);
      toast({ title: 'Daily Pulse Deployed' });
    } catch (e) {
      toast({ title: 'Deployment Error', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh p-4 bg-ink relative overflow-hidden">
        {/* faint grid backdrop, matches landing hero */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              'linear-gradient(#1E2530 1px, transparent 1px), linear-gradient(90deg, #1E2530 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 90%)',
          }}
        />
        <Card className="relative w-full max-w-sm border border-panelLine rounded-2xl bg-panel p-8 text-center">
          <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-limeDim bg-lime/10">
            <Lock className="h-5 w-5 text-lime" />
          </div>
          <CardTitle className="font-display text-lg font-bold text-paper mb-1">Owner Authorization</CardTitle>
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-paperDim mb-6">
            Restricted · global pulse console
          </p>
          <Input
            type="password"
            placeholder="Enter access key"
            value={passKey}
            onChange={(e) => setPassKey(e.target.value)}
            className="h-12 rounded-lg border border-panelLine bg-ink text-center font-mono text-sm text-paper placeholder:text-paperDim mb-4 focus-visible:ring-lime focus-visible:ring-offset-0"
          />
          <Button
            onClick={() =>
              passKey === 'pulse-owner-2024'
                ? setIsAuthorized(true)
                : toast({ title: 'Invalid Key', variant: 'destructive' })
            }
            className="w-full h-12 rounded-lg bg-lime text-ink hover:bg-limeDim font-semibold text-sm tracking-wide"
          >
            Access portal
          </Button>
          <Button
            variant="ghost"
            onClick={() => router.push('/')}
            className="mt-2 text-xs font-medium text-paperDim hover:text-paper hover:bg-transparent"
          >
            Return home
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto p-4 sm:p-6 space-y-6 bg-ink">
      <div className="flex items-center justify-between pt-4">
        <Button
          variant="ghost"
          onClick={() => router.push('/')}
          className="h-9 rounded-lg text-xs font-semibold text-paperDim hover:text-paper hover:bg-panel"
        >
          <ArrowLeft className="mr-2 h-3.5 w-3.5" /> Dashboard
        </Button>
        <div className="flex items-center gap-2 rounded-full border border-limeDim bg-lime/5 px-4 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-signal animate-pulse" />
          <span className="font-mono text-[11px] font-medium tracking-[0.12em] uppercase text-lime">
            Global Pulse Console
          </span>
        </div>
      </div>

      <Card className="border border-panelLine rounded-2xl bg-panel overflow-hidden">
        <CardHeader className="pt-8 pb-4 text-center">
          <CardTitle className="font-display text-xl font-bold tracking-tight text-paper">
            Daily Challenge Builder
          </CardTitle>
          <CardDescription className="font-mono text-[11px] font-medium tracking-[0.12em] uppercase text-lime mt-1">
            Auto-calculating pool · {today}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 sm:p-10 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              placeholder="Equation (e.g. 15 × 12)"
              value={newQ}
              onChange={(e) => setNewQ(e.target.value)}
              className="h-12 rounded-lg border border-panelLine bg-ink font-mono text-sm text-paper placeholder:text-paperDim focus-visible:ring-lime focus-visible:ring-offset-0"
            />
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="Result"
                value={newA}
                onChange={(e) => setNewA(e.target.value)}
                className="h-12 rounded-lg border border-panelLine bg-ink font-mono text-sm text-paper placeholder:text-paperDim focus-visible:ring-lime focus-visible:ring-offset-0"
              />
              <Button
                onClick={handleAddQuestion}
                className="h-12 w-12 shrink-0 rounded-lg bg-lime text-ink hover:bg-limeDim"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-mono text-[11px] font-medium tracking-[0.12em] uppercase text-paperDim mb-2">
              Deployed stack ({questions.length})
            </p>
            <ScrollArea className="h-[250px] rounded-xl border border-panelLine bg-ink/40 p-2">
              {questions.length === 0 ? (
                <div className="flex items-center justify-center h-[200px] font-mono text-xs uppercase tracking-wide text-paperDim/50 italic">
                  Empty pulse stack
                </div>
              ) : (
                questions.map((q, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center p-3 bg-panel border border-panelLine rounded-lg mb-2"
                  >
                    <span className="font-mono text-sm font-medium text-paper">
                      {q.question} = <span className="text-lime">{q.answer}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(i)}
                      className="text-signal hover:bg-signal/10 hover:text-signal rounded-md"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>

          <Button
            onClick={handleSave}
            disabled={isSaving || questions.length === 0}
            className="w-full h-14 rounded-xl bg-lime text-ink hover:bg-limeDim font-semibold text-sm tracking-wide disabled:opacity-40"
          >
            {isSaving ? (
              <Loader2 className="mr-3 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-3 h-4 w-4" />
            )}
            Deploy to global pulse
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default DailyAdminPage;