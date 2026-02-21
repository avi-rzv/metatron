import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { SidePanel } from './SidePanel';
import { useUIStore } from '@/store/uiStore';

export function Layout() {
  const { setIsMobile } = useUIStore();

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setIsMobile]);

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <SidePanel />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
