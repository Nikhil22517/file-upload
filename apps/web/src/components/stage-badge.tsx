import { Badge } from '@/components/ui/badge';
import { type Tone, stageOf } from '@/lib/stages';
import { cn } from 'cn';

const TONES: Record<Tone, string> = {
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-900',
  error: 'bg-red-100 text-red-800',
  neutral: 'bg-secondary text-secondary-foreground',
};

export function StageBadge({ stage, className }: { stage: string; className?: string }) {
  const s = stageOf(stage);
  return <Badge className={cn(TONES[s.tone], className)}>{s.label}</Badge>;
}
