/**
 * Benchmark agents are highlighted on the leaderboard and round detail pages.
 * Configured via the VITE_BENCHMARK_ADDRESSES env var (comma-separated 0x addresses).
 */

const raw = (import.meta.env.VITE_BENCHMARK_ADDRESSES || '') as string;

const benchmarkSet = new Set(
  raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s)),
);

export function isBenchmarkAgent(address: string): boolean {
  return benchmarkSet.has(address.toLowerCase());
}
