import type { Round } from '../types';

export type PhaseKey = 'commit' | 'buffer' | 'reveal' | 'triggered' | 'scored';
export type StepStatus = 'past' | 'active' | 'pending';

export type AnomalyInfo = {
  precedes: PhaseKey;
  message: string;
};

export type PhaseStep = {
  key: PhaseKey;
  label: string;
  timestamp: number | null;    // null when event has not occurred yet
  status: StepStatus;
  anomaly: AnomalyInfo | null;
};

const LABELS: Record<PhaseKey, string> = {
  commit: 'Commit', buffer: 'Buffer', reveal: 'Reveal',
  triggered: 'Triggered', scored: 'Scored',
};

const CANONICAL: PhaseKey[] = ['commit', 'buffer', 'reveal', 'triggered', 'scored'];

export function buildPhaseSteps(round: Round, now = Math.floor(Date.now() / 1000)): PhaseStep[] {
  const hasScores = Array.from(round.agents.values()).some(a => a.scoredMarkets > 0);

  // revealComplete: either deadline passed or every committed agent revealed
  const revealedCount = Array.from(round.agents.values()).filter(a => a.revealed).length;
  const agentCount = round.agents.size;
  const allRevealed = agentCount > 0 && revealedCount === agentCount;
  const revealComplete = now > round.revealDeadline || allRevealed;

  // Timestamps per canonical step; null = event not occurred
  const tsByKey: Partial<Record<PhaseKey, number | null>> = {
    commit:    round.createdAt,
    buffer:    round.revealStart > round.commitDeadline ? round.commitDeadline : null,
    reveal:    round.revealStart,
    triggered: round.outcomesTriggeredAt > 0 ? round.outcomesTriggeredAt : null,
    scored:    hasScores && round.outcomesTriggeredAt > 0 ? round.outcomesTriggeredAt + 1 : null,
  };

  // Build steps — buffer is omitted when there is no gap
  const steps: PhaseStep[] = [];
  for (const key of CANONICAL) {
    if (key === 'buffer' && tsByKey.buffer === null) continue;

    const ts = tsByKey[key] ?? null;
    const prev = steps[steps.length - 1];

    // Anomaly: this step's timestamp precedes the previous step's
    let anomaly: AnomalyInfo | null = null;
    if (ts !== null && prev !== undefined && prev.timestamp !== null && ts < prev.timestamp) {
      anomaly = {
        precedes: prev.key,
        message: `Occurred before ${LABELS[prev.key]} · atypical sequence`,
      };
    }

    const happened = ts !== null && ts <= now;
    steps.push({
      key,
      label: LABELS[key],
      timestamp: ts,
      status: happened ? 'past' : 'pending', // revised below
      anomaly,
    });
  }

  // Find the last "happened" step as the baseline active index
  let activeIndex = steps.findIndex(s => s.status === 'past') >= 0
    ? steps.reduce((best, s, i) => (s.status === 'past' ? i : best), 0)
    : 0;

  // Promote active forward when reveal is logically complete but trigger hasn't fired
  if (steps[activeIndex]?.key === 'reveal' && revealComplete) {
    const next = steps.findIndex((s, i) => i > activeIndex && s.key === 'triggered');
    if (next >= 0) activeIndex = next;
  }

  // Assign final statuses relative to activeIndex
  for (let i = 0; i < steps.length; i++) {
    steps[i].status = i < activeIndex ? 'past' : i === activeIndex ? 'active' : 'pending';
  }

  return steps;
}

/** Returns the full active PhaseStep, or null for invalidated rounds. */
export function getActiveStep(
  round: Round,
  now = Math.floor(Date.now() / 1000),
): PhaseStep | null {
  if (round.invalidated) return null;
  const steps = buildPhaseSteps(round, now);
  return steps.find(s => s.status === 'active') ?? null;
}

/** Backward-compat: returns just the phase key. */
export function getActivePhase(
  round: Round,
  now = Math.floor(Date.now() / 1000),
): PhaseKey | 'void' {
  if (round.invalidated) return 'void';
  return getActiveStep(round, now)?.key ?? 'commit';
}

export function formatPhaseTimestamp(ts: number): { date: string; time: string } {
  const d = new Date(ts * 1000);
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}
