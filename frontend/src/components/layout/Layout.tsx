import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import Footer from './Footer';
import ErrorBanner from '../ErrorBanner';
import RefreshOverlay from '../RefreshOverlay';
import { useDataContext } from '../../context/DataContext';

export default function Layout(): JSX.Element {
  const { refreshing } = useDataContext();
  return (
    <>
      <TopNav />
      <ErrorBanner />
      {refreshing && <RefreshOverlay />}
      <main>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
