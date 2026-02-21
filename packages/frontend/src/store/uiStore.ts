import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  isMobile: boolean;
  setSidebarOpen: (open: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setIsMobile: (mobile: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  // On desktop (>= 768px) open by default; mobile closed by default
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  rightPanelOpen: false,
  isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setIsMobile: (mobile) => {
    set({ isMobile: mobile });
    // On resize to desktop, open sidebar; on mobile, close it
    if (!mobile && !get().sidebarOpen) {
      set({ sidebarOpen: true });
    }
  },
}));
