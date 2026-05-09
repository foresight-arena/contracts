import type { Round } from '../types';

export type PhaseKey = 'commit' | 'buffer' | 'reveal' | 'triggered' | 'scored';

export interface PhaseStep {
  key: PhaseKey;
  label: string;
  /** UNIX seconds — when this phase began; used for sort + active detection */
  timestamp: number;
  show: boolean;
}

export function buildPhaseSteps(round: Round): PhaseStep[] {
  const steps: PhaseStep[] = [];
  const hasScores = Array.from(round.agents.values()).some(a => a.scoredMarkets > 0);

  steps.push({
    key: 'commit',
    label: 'Commit',
    timestamp: round.createdAt,
    show: true,
  });

  // Buffer exists only when reveal doesn't start immediately after commit close
  if (round.revealStart > round.commitDeadline) {
    steps.push({
      key: 'buffer',
      label: 'Buffer',
      timestamp: round.commitDeadline,
      show: true,
    });
  }

  steps.push({
    key: 'reveal',
    label: 'Reveal',
    timestamp: round.revealStart,
    show: true,
  });

  // Use actual on-chain timestamp if available, otherwise place in the future
  const triggeredTs =
    round.outcomesTriggered && round.outcomesTriggeredAt > 0
      ? round.outcomesTriggeredAt
      : round.revealDeadline + 86400;

  steps.push({
    key: 'triggered',
    label: 'Triggered',
    timestamp: triggeredTs,
    show: true,
  });

  // No on-chain scoredAt — place 1 second after trigger (scoring is atomic with trigger tx)
  const scoredTs =
    hasScores && round.outcomesTriggeredAt > 0
      ? round.outcomesTriggeredAt + 1
      : round.revealDeadline + 86400 * 2;

  steps.push({
    key: 'scored',
    label: 'Scored',
    timestamp: scoredTs,
    show: true,
  });

  // Sort by actual timestamp — handles out-of-order on-chain events correctly
  steps.sort((a, b) => a.timestamp - b.timestamp);

  return steps;
}

/** Returns the index of the last step whose timestamp is ≤ now (= current active phase). */
export function getActivePhaseIndex(steps: PhaseStep[], now: number): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].timestamp <= now) return i;
  }
  return 0;
}

/** Single source of truth for the current phase key, used by all pills and the timeline. */
export function getActivePhase(
  round: Round,
  now = Math.floor(Date.now() / 1000),
): PhaseKey | 'void' {
  if (round.invalidated) return 'void';
  const steps = buildPhaseSteps(round);
  const idx = getActivePhaseIndex(steps, now);
  return steps[idx].key;
}
