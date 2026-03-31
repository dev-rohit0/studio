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
      toast({ title: 'Daily Challenge Deployed' });
    } catch (e) {
      toast({ title: 'Deployment Error', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh p-4">
        <Card className="w-full max-w-sm shadow-2xl border-none rounded-[2rem] bg-white/95 dark:bg-slate-900/95 p-8 text-center">
           <Lock className="h-8 w-8 text-primary mx-auto mb-4" />
           <CardTitle className="text-sm font-black uppercase tracking-widest mb-6">Owner Authorization</CardTitle>
           <Input 
             type="password" 
             placeholder="ENTER ACCESS KEY..." 
             value={passKey} 
             onChange={(e) => setPassKey(e.target.value)}
             className="text-center h-12 rounded-xl border-2 mb-4 font-bold"
           />
           <Button onClick={() => passKey === 'pulse-owner-2024' ? setIsAuthorized(true) : toast({ title: 'Invalid Key', variant: 'destructive' })} className="w-full h-12 rounded-xl text-[8px] font-black uppercase tracking-widest text-white">ACCESS PORTAL</Button>
           <Button variant="ghost" onClick={() => router.push('/')} className="mt-2 text-[6px] font-bold uppercase text-muted-foreground">Return Home</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh w-full max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
         <Button variant="ghost" onClick={() => router.push('/')} className="h-9 rounded-xl text-[7px] font-black uppercase"><ArrowLeft className="mr-2 h-3 w-3" /> Dashboard</Button>
         <div className="bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10">
            <span className="text-[7px] font-black text-primary uppercase tracking-widest">Global Pulse Console</span>
         </div>
      </div>

      <Card className="shadow-2xl border-none rounded-[2.5rem] bg-white/95 dark:bg-slate-900/95 overflow-hidden">
         <CardHeader className="pt-8 pb-4 text-center">
            <CardTitle className="text-lg font-black uppercase tracking-tighter">Daily Challenge Builder</CardTitle>
            <CardDescription className="text-[7px] font-bold uppercase tracking-widest text-primary">Deploying for: {today}</CardDescription>
         </CardHeader>
         <CardContent className="p-6 sm:p-10 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
               <Input placeholder="EQUATION (e.g. 15 x 12)" value={newQ} onChange={(e) => setNewQ(e.target.value)} className="h-12 rounded-xl border-2 text-[8px] font-bold uppercase" />
               <div className="flex gap-2">
                  <Input type="number" placeholder="ANSWER" value={newA} onChange={(e) => setNewA(e.target.value)} className="h-12 rounded-xl border-2 text-[8px] font-bold uppercase" />
                  <Button onClick={handleAddQuestion} className="h-12 w-12 rounded-xl text-white shadow-lg"><Plus className="h-5 w-5" /></Button>
               </div>
            </div>

            <div className="space-y-2">
               <p className="text-[6px] font-black uppercase tracking-widest text-muted-foreground mb-2">Deployed Stack ({questions.length})</p>
               <ScrollArea className="h-[250px] rounded-2xl border-2 border-slate-50 dark:border-slate-800 p-2 bg-slate-50/50 dark:bg-slate-950/50">
                  {questions.length === 0 ? (
                    <div className="flex items-center justify-center h-[200px] text-[7px] font-black uppercase text-muted-foreground/40 italic">Empty Pulse Stack</div>
                  ) : (
                    questions.map((q, i) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl mb-2 shadow-sm">
                         <span className="font-mono font-black text-[9px]">{q.question} = {q.answer}</span>
                         <Button variant="ghost" size="sm" onClick={() => handleRemove(i)} className="text-destructive hover:bg-destructive/10 rounded-lg"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    ))
                  )}
               </ScrollArea>
            </div>

            <Button onClick={handleSave} disabled={isSaving || questions.length === 0} className="w-full h-14 rounded-2xl text-[9px] font-black uppercase tracking-widest text-white shadow-xl shadow-primary/20">
               {isSaving ? <Loader2 className="mr-3 animate-spin" /> : <Save className="mr-3 h-4 w-4" />}
               DEPLOY TO GLOBAL PULSE
            </Button>
         </CardContent>
      </Card>
    </div>
  );
};

export default DailyAdminPage;