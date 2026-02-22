import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { SidePanel } from './SidePanel';
import { useUIStore } from '@/store/uiStore';

export function Layout() {
  const { setIsMobile, isMobile } = useUIStore();

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setIsMobile]);

  // On mobile, continuously sync two CSS custom properties on :root so that
  // every `position:fixed` element (sidebar, right-panel, etc.) can size
  // itself to the *visible* area even when the virtual keyboard is open.
  useEffect(() => {
    if (!isMobile) {
      document.documentElement.style.removeProperty('--vvh');
      document.documentElement.style.removeProperty('--vvt');
      return;
    }

    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
        document.documentElement.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
      });
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);

    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      cancelAnimationFrame(raf);
      document.documentElement.style.removeProperty('--vvh');
      document.documentElement.style.removeProperty('--vvt');
    };
  }, [isMobile]);

  return (
    <div
      className={`flex overflow-hidden bg-white ${isMobile ? '' : 'h-dvh'}`}
      style={
        isMobile
          ? {
              position: 'fixed',
              top: 'var(--vvt, 0px)',
              left: 0,
              right: 0,
              height: 'var(--vvh, 100dvh)',
            }
          : undefined
      }
    >
      <SidePanel />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
