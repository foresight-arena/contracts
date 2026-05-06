// Stub committed so `graph build` works without first running
// scripts/gen-config.mjs. The real list of relayer addresses is injected
// at deploy time by `npm run gen-config` (or any `npm run build` /
// `npm run deploy`), which reads the RELAYER_ADDRESSES env var.
//
// Do NOT commit a populated version of this file unless you intend to
// hard-code the production relayer addresses. Run
//   git checkout subgraph/src/config.ts
// to revert if your local build regenerated it.

export const KNOWN_RELAYER_ADDRESSES: string[] = [
]
