import { Outlet } from 'react-router-dom';
import Header from './components/Header';
import TabNav from './components/TabNav';
import ErrorBanner from './components/ErrorBanner';
import RefreshOverlay from './components/RefreshOverlay';
import { useDataContext } from './context/DataContext';

import type { CSSProperties } from 'react';

const shellStyle: CSSProperties = {
  minHeight: '100vh',
};

export default function App() {
  const { refreshing } = useDataContext();
  return (
    <div style={shellStyle}>
      <Header />
      <TabNav />
      <ErrorBanner />
      {refreshing && <RefreshOverlay />}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
