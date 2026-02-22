import { useState, useEffect, useRef } from 'react';

/**
 * Returns the current visual viewport height (in px).
 *
 * On mobile, this shrinks when the virtual keyboard opens — by setting
 * the chat container height to this value the input always sits right
 * above the keyboard while the top bar stays pinned at the top.
 *
 * Updates are batched via requestAnimationFrame for smoothness.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Set initial value
    setHeight(Math.round(vv.height));

    const update = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setHeight(Math.round(vv.height));
      });
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return height;
}
