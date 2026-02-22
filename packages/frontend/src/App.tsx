import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '@/components/layout/Layout';
import { ChatPage } from '@/pages/ChatPage';
import { ModelManagerPage } from '@/pages/ModelManagerPage';
import { SystemInstructionPage } from '@/pages/SystemInstructionPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ToolsPage } from '@/pages/ToolsPage';
import { GalleryPage } from '@/pages/GalleryPage';
import { ToastContainer } from '@/components/ui/ToastContainer';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:chatId" element={<ChatPage />} />
            <Route path="/system-instruction" element={<SystemInstructionPage />} />
            <Route path="/models" element={<ModelManagerPage />} />
            <Route path="/tools" element={<ToolsPage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
