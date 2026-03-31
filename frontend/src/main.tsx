import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './styles/global.css';

import App from './App';
import { ContractProvider } from './context/ContractContext';
import { DataProvider } from './context/DataContext';
import ArenaPage from './pages/ArenaPage';
import RoundDetailPage from './pages/RoundDetailPage';
import LeaderboardPage from './pages/LeaderboardPage';
import AboutPage from './pages/AboutPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <AboutPage /> },
      { path: 'arena', element: <ArenaPage /> },
      { path: 'round/:roundId', element: <RoundDetailPage /> },
      { path: 'leaderboard', element: <LeaderboardPage /> },
    ],
  },
]);

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ContractProvider>
      <DataProvider>
        <RouterProvider router={router} />
      </DataProvider>
    </ContractProvider>
  </StrictMode>,
);
