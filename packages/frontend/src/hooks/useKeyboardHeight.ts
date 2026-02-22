import { useState, useEffect } from 'react';

/**
 * Detects the virtual keyboard height on mobile using the Visual Viewport API.
 *
 * Relies on `interactive-widget=resizes-visual` in the viewport meta tag
 * (Chrome Android) and Safari's default behavior (iOS) where
 * `window.innerHeight` stays constant while `visualViewport.height` shrinks
 * when the keyboard appears.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const diff = window.innerHeight - viewport.height;
      setHeight(diff > 0 ? Math.round(diff) : 0);
    };

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return height;
}
