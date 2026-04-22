import { Outlet } from 'react-router-dom';
import Header from './components/Header';
import TabNav from './components/TabNav';
import ErrorBanner from './components/ErrorBanner';

import type { CSSProperties } from 'react';

const shellStyle: CSSProperties = {
  minHeight: '100vh',
};

export default function App() {
  return (
    <div style={shellStyle}>
      <Header />
      <TabNav />
      <ErrorBanner />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
