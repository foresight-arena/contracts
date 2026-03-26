import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { Round, AgentInfo } from '../types';
import { publicClient } from '../config/client';
import { useContractContext } from './ContractContext';
import { getCached, setCache } from '../services/cache';
import {
  fetchAllEvents,
  serializeRounds,
  deserializeRounds,
  serializeAgents,
  deserializeAgents,
} from '../services/events';

interface DataContextValue {
  rounds: Round[];
  agents: Map<string, AgentInfo>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { contractSet, addresses } = useContractContext();

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

      // Try cache first
      const cached = getCached(contractSet);
      if (cached) {
        try {
          const cachedRounds = deserializeRounds(cached.rounds);
          const cachedAgents = deserializeAgents(cached.agents);
          if (!cancelled) {
            setRounds(cachedRounds);
            setAgents(cachedAgents);
          }
        } catch {
          // Cache corrupt; ignore and fetch fresh
        }
      }

      try {
        const result = await fetchAllEvents(publicClient, addresses);
        if (cancelled) return;

        setRounds(result.rounds);
        setAgents(result.agents);

        // Persist to cache
        setCache(
          contractSet,
          result.lastBlock,
          serializeRounds(result.rounds),
          serializeAgents(result.agents),
        );
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
  }, [contractSet, addresses, refreshKey]);

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
