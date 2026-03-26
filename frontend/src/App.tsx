import { Outlet } from 'react-router-dom';
import Header from './components/Header';
import TabNav from './components/TabNav';

import type { CSSProperties } from 'react';

const shellStyle: CSSProperties = {
  minHeight: '100vh',
};

export default function App() {
  return (
    <div style={shellStyle}>
      <Header />
      <TabNav />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
