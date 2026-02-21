import { useState, useEffect } from 'react';
import { subscribeToast } from '@/utils/toast';

export function ToastContainer() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return subscribeToast((msg) => {
      setMessage(msg);
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    });
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-4 py-2 rounded-full shadow-lg animate-fade-in pointer-events-none select-none">
      {message}
    </div>
  );
}
