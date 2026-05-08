import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import Footer from './Footer';
import ErrorBanner from '../ErrorBanner';
import RefreshOverlay from '../RefreshOverlay';
import { ScrollToTop } from '../ScrollToTop';
import { useDataContext } from '../../context/DataContext';

export default function Layout() {
  const { refreshing } = useDataContext();
  return (
    <>
      <ScrollToTop />
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
