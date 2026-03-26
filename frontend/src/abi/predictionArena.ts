export const predictionArenaAbi = [
  {
    type: 'function',
    name: 'commit',
    inputs: [
      { name: 'roundId', type: 'uint256', internalType: 'uint256' },
      { name: 'commitHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getCommitCount',
    inputs: [{ name: 'roundId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCommitment',
    inputs: [
      { name: 'roundId', type: 'uint256', internalType: 'uint256' },
      { name: 'agent', type: 'address', internalType: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IPredictionArena.Commitment',
        components: [
          { name: 'commitHash', type: 'bytes32', internalType: 'bytes32' },
          { name: 'revealed', type: 'bool', internalType: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRevealedPredictions',
    inputs: [
      { name: 'roundId', type: 'uint256', internalType: 'uint256' },
      { name: 'agent', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint16[]', internalType: 'uint16[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getScore',
    inputs: [
      { name: 'roundId', type: 'uint256', internalType: 'uint256' },
      { name: 'agent', type: 'address', internalType: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct IPredictionArena.Score',
        components: [
          { name: 'brierScore', type: 'uint256', internalType: 'uint256' },
          { name: 'alphaScore', type: 'int256', internalType: 'int256' },
          { name: 'scoredMarkets', type: 'uint16', internalType: 'uint16' },
          { name: 'totalMarkets', type: 'uint16', internalType: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasCommitted',
    inputs: [
      { name: 'roundId', type: 'uint256', internalType: 'uint256' },
      { name: 'agent', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'hasRevealed',
    inputs: [
      { name: 'roundId', type: 'uint256', internalType: 'uint256' },
      { name: 'agent', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'reveal',
    inputs: [
      { name: 'roundId', type: 'uint256', internalType: 'uint256' },
      { name: 'predictions', type: 'uint16[]', internalType: 'uint16[]' },
      { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Committed',
    inputs: [
      { name: 'roundId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'agent', type: 'address', indexed: true, internalType: 'address' },
      { name: 'commitHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Revealed',
    inputs: [
      { name: 'roundId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'agent', type: 'address', indexed: true, internalType: 'address' },
      { name: 'predictions', type: 'uint16[]', indexed: false, internalType: 'uint16[]' },
      { name: 'scoredMarkets', type: 'uint16', indexed: false, internalType: 'uint16' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ScoreComputed',
    inputs: [
      { name: 'roundId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'agent', type: 'address', indexed: true, internalType: 'address' },
      { name: 'brierScore', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'alphaScore', type: 'int256', indexed: false, internalType: 'int256' },
      { name: 'scoredMarkets', type: 'uint16', indexed: false, internalType: 'uint16' },
    ],
    anonymous: false,
  },
] as const;
