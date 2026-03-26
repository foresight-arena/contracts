import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import type { ContractSetName, ContractAddresses } from '../config/contracts';
import { CONTRACT_SETS } from '../config/contracts';

interface ContractContextValue {
  contractSet: ContractSetName;
  setContractSet: (set: ContractSetName) => void;
  addresses: ContractAddresses;
}

const ContractContext = createContext<ContractContextValue | null>(null);

export function ContractProvider({ children }: { children: ReactNode }) {
  const [contractSet, setContractSet] = useState<ContractSetName>('fast');

  const addresses = useMemo(() => CONTRACT_SETS[contractSet], [contractSet]);

  const value = useMemo<ContractContextValue>(
    () => ({ contractSet, setContractSet, addresses }),
    [contractSet, addresses],
  );

  return (
    <ContractContext.Provider value={value}>
      {children}
    </ContractContext.Provider>
  );
}

export function useContractContext(): ContractContextValue {
  const ctx = useContext(ContractContext);
  if (!ctx) {
    throw new Error('useContractContext must be used within a ContractProvider');
  }
  return ctx;
}

export default ContractContext;
