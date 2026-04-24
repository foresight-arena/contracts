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
import { fetchAllData } from '../services/subgraph';

interface DataContextValue {
  rounds: Round[];
  agents: Map<string, AgentInfo>;
  loading: boolean;      // true only on initial load (no data yet)
  refreshing: boolean;   // true during background refresh (data still visible)
  error: string | null;
  refresh: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {

  const [rounds, setRounds] = useState<Round[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasData = rounds.length > 0;

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (hasData) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const data = await fetchAllData();
        if (cancelled) return;
        setRounds(data.rounds);
        setAgents(data.agents);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const value = useMemo<DataContextValue>(
    () => ({ rounds, agents, loading, refreshing, error, refresh }),
    [rounds, agents, loading, refreshing, error, refresh],
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
