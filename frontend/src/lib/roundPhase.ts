import type { Round } from '../types';

export type PhaseKey = 'commit' | 'buffer' | 'reveal' | 'triggered' | 'scored';

export type AnomalyInfo = {
  precedes: PhaseKey;
  message: string;
};

export type PhaseStep = {
  key: PhaseKey;
  label: string;
  timestamp: number | null;    // UNIX seconds; null when phase has not occurred yet
  anomaly: AnomalyInfo | null; // non-null when timestamp violates canonical ordering
};

const LABELS: Record<PhaseKey, string> = {
  commit: 'Commit', buffer: 'Buffer', reveal: 'Reveal',
  triggered: 'Triggered', scored: 'Scored',
};

export function buildPhaseSteps(round: Round): PhaseStep[] {
  const hasScores = Array.from(round.agents.values()).some(a => a.scoredMarkets > 0);

  const tsByKey: Partial<Record<PhaseKey, number | null>> = {
    commit:    round.createdAt,
    buffer:    round.revealStart > round.commitDeadline ? round.commitDeadline : null,
    reveal:    round.revealStart,
    triggered: round.outcomesTriggeredAt > 0 ? round.outcomesTriggeredAt : null,
    scored:    hasScores && round.outcomesTriggeredAt > 0 ? round.outcomesTriggeredAt + 1 : null,
  };

  const CANONICAL: PhaseKey[] = ['commit', 'buffer', 'reveal', 'triggered', 'scored'];
  const steps: PhaseStep[] = [];

  for (const key of CANONICAL) {
    const ts = tsByKey[key] ?? null;
    if (ts === null) continue;

    const prev = steps[steps.length - 1];
    let anomaly: AnomalyInfo | null = null;
    if (prev?.timestamp !== null && ts < prev.timestamp!) {
      anomaly = {
        precedes: prev.key,
        message: `Occurred before ${LABELS[prev.key]} · atypical sequence`,
      };
    }

    steps.push({ key, label: LABELS[key], timestamp: ts, anomaly });
  }

  return steps; // canonical order, no sort
}

/** Returns the index of the last step whose timestamp is ≤ now. */
export function getActivePhaseIndex(steps: PhaseStep[], now: number): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    const ts = steps[i].timestamp;
    if (ts !== null && ts <= now) return i;
  }
  return 0;
}

/** Single source of truth for the current phase key, used by pills and the timeline. */
export function getActivePhase(
  round: Round,
  now = Math.floor(Date.now() / 1000),
): PhaseKey | 'void' {
  if (round.invalidated) return 'void';
  const steps = buildPhaseSteps(round);
  const idx = getActivePhaseIndex(steps, now);
  return steps[idx].key;
}

export function formatPhaseTimestamp(ts: number): { date: string; time: string } {
  const d = new Date(ts * 1000);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}
