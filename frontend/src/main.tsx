import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './styles/global.css';

import App from './App';
import { DataProvider } from './context/DataContext';
import ArenaPage from './pages/ArenaPage';
import RoundDetailPage from './pages/RoundDetailPage';
import LeaderboardPage from './pages/LeaderboardPage';
import AboutPage from './pages/AboutPage';
import AgentDetailPage from './pages/AgentDetailPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <AboutPage /> },
      { path: 'arena', element: <ArenaPage /> },
      { path: 'round/:roundId', element: <RoundDetailPage /> },
      { path: 'agent/:address', element: <AgentDetailPage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
    ],
  },
]);

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <DataProvider>
      <RouterProvider router={router} />
    </DataProvider>
  </StrictMode>,
);
