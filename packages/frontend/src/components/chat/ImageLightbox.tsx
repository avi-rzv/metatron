import { useState, useEffect, useRef, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark, faDownload, faChevronLeft, faChevronRight, faTrash } from '@fortawesome/free-solid-svg-icons';
import { getMediaUrl } from '@/api';
import { t } from '@/i18n';
import type { Media } from '@/types';

interface ImageLightboxProps {
  media: Media;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onDelete?: (id: string) => void;
}

export function ImageLightbox({ media, onClose, onPrev, onNext, onDelete }: ImageLightboxProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext]);

  // Touch swipe support
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    // Only trigger if horizontal swipe is dominant and long enough
    if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;

    if (dx > 0 && onPrev) onPrev();
    else if (dx < 0 && onNext) onNext();
  }, [onPrev, onNext]);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = getMediaUrl(media.id);
    a.download = media.filename;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Prev button — hugs the left edge of the image */}
        {onPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute -start-12 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-10 w-10 items-center justify-center rounded-full bg-white text-black hover:bg-gray-200 transition-colors shadow-lg"
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
        )}

        {/* Next button — hugs the right edge of the image */}
        {onNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute -end-12 top-1/2 -translate-y-1/2 z-10 hidden sm:flex h-10 w-10 items-center justify-center rounded-full bg-white text-black hover:bg-gray-200 transition-colors shadow-lg"
          >
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        )}
        {/* Controls */}
        <div className="absolute top-2 end-2 flex gap-2 z-10">
          {onDelete && (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white hover:bg-red-600 transition-colors"
              title={t.gallery.deleteMedia}
            >
              <FontAwesomeIcon icon={faTrash} className="text-sm" />
            </button>
          )}
          <button
            onClick={handleDownload}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            title={t.gallery.downloadImage}
          >
            <FontAwesomeIcon icon={faDownload} className="text-sm" />
          </button>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          >
            <FontAwesomeIcon icon={faXmark} className="text-sm" />
          </button>
        </div>

        {/* Image */}
        <img
          src={getMediaUrl(media.id)}
          alt={media.prompt}
          className="max-w-full max-h-[80vh] rounded-lg object-contain"
        />

        {/* Info */}
        <div className="mt-3 text-center max-w-lg">
          <p className="text-sm text-white/90 leading-relaxed">{media.shortDescription || media.prompt}</p>
          <p className="mt-1 text-xs text-white/50">
            {t.gallery.generatedWith} {media.model} &middot; {new Date(media.createdAt).toLocaleString()}
          </p>
        </div>

        {/* Delete confirmation */}
        {confirmingDelete && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-black/60">
            <div className="bg-white rounded-2xl p-6 max-w-xs w-full mx-4 shadow-xl">
              <p className="text-sm text-gray-800">{t.gallery.deleteConfirm}</p>
              <div className="mt-4 flex gap-2 justify-end">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                  {t.gallery.cancel}
                </button>
                <button
                  onClick={() => {
                    onDelete!(media.id);
                    setConfirmingDelete(false);
                  }}
                  className="px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors"
                >
                  {t.gallery.delete}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
