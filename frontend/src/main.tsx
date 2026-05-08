import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import './styles/tokens.css';
import './styles/global.css';

import App from './App';
import { DataProvider } from './context/DataContext';
import RoundsPage from './pages/RoundsPage';
import EventsPage from './pages/EventsPage';
import RoundDetailPage from './pages/RoundDetailPage';
import LeaderboardPage from './pages/LeaderboardPage';
import LandingPage from './pages/LandingPage';
import AgentDetailPage from './pages/AgentDetailPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <LandingPage /> },
      { path: 'arena', element: <Navigate to="/rounds" replace /> },
      { path: 'rounds', element: <RoundsPage /> },
      { path: 'events', element: <EventsPage /> },
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
