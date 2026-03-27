import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { Round, AgentRoundData, AgentInfo } from '../types';
import { useContractContext } from './ContractContext';

interface DataContextValue {
  rounds: Round[];
  agents: Map<string, AgentInfo>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

// Convert the JSON format (agents as array) to the app format (agents as Map)
function parseRounds(raw: any[]): Round[] {
  return raw.map((r) => ({
    ...r,
    agents: new Map<string, AgentRoundData>(
      (r.agents || []).map((a: AgentRoundData) => [a.address, a])
    ),
  }));
}

function parseAgents(raw: any[]): Map<string, AgentInfo> {
  return new Map<string, AgentInfo>(
    (raw || []).map((a: AgentInfo) => [a.address, a])
  );
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { contractSet } = useContractContext();

  const [rounds, setRounds] = useState<Round[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // Load static JSON
        const resp = await fetch('/data.json');
        if (!resp.ok) {
          throw new Error(`Failed to load data: ${resp.status}`);
        }

        const text = await resp.text();
        if (!text.startsWith('{')) {
          throw new Error('data.json not found — run the indexer first');
        }

        const data = JSON.parse(text);
        if (cancelled) return;

        setRounds(parseRounds(data.rounds || []));
        setAgents(parseAgents(data.agents || []));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [contractSet, refreshKey]);

  const value = useMemo<DataContextValue>(
    () => ({ rounds, agents, loading, error, refresh }),
    [rounds, agents, loading, error, refresh],
  );

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export function useDataContext(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error('useDataContext must be used within a DataProvider');
  }
  return ctx;
}

export default DataContext;
