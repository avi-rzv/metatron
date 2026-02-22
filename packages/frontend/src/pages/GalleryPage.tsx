import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { api, getMediaUrl } from '@/api';
import { ImageLightbox } from '@/components/chat/ImageLightbox';
import { t } from '@/i18n';
import type { Media } from '@/types';

export function GalleryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: mediaItems = [] } = useQuery({
    queryKey: ['allMedia'],
    queryFn: () => api.media.list(100),
  });

  const lightboxMedia = lightboxIndex !== null ? mediaItems[lightboxIndex] ?? null : null;
  const hasPrev = lightboxIndex !== null && lightboxIndex > 0;
  const hasNext = lightboxIndex !== null && lightboxIndex < mediaItems.length - 1;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.media.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allMedia'] });
      qc.invalidateQueries({ queryKey: ['recentMedia'] });
      setDeleteConfirmId(null);
    },
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-100 px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">{t.gallery.title}</h1>
      </div>

      {/* Gallery grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {mediaItems.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-400">{t.gallery.noMedia}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {mediaItems.map((m: Media, index: number) => (
              <div
                key={m.id}
                className="group relative rounded-xl overflow-hidden border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all duration-150"
              >
                <button
                  onClick={() => setLightboxIndex(index)}
                  className="w-full aspect-square"
                >
                  <img
                    src={getMediaUrl(m.id)}
                    alt={m.prompt}
                    className="w-full h-full object-cover"
                  />
                </button>

                {/* Overlay info */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <p className="text-xs text-white leading-snug line-clamp-2">{m.shortDescription || m.prompt}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-white/70">{m.model}</span>
                    <span className="text-[10px] text-white/70">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/chat/${m.chatId}`);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors text-[10px]"
                    title="Go to chat"
                  >
                    &rarr;
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmId(m.id);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-red-600 transition-colors"
                    title={t.gallery.deleteMedia}
                  >
                    <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <p className="text-sm text-gray-800">{t.gallery.deleteConfirm}</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirmId)}
                className="px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxMedia && (
        <ImageLightbox
          media={lightboxMedia}
          onClose={() => setLightboxIndex(null)}
          onPrev={hasPrev ? () => setLightboxIndex((i) => i! - 1) : undefined}
          onNext={hasNext ? () => setLightboxIndex((i) => i! + 1) : undefined}
          onDelete={(id) => {
            deleteMutation.mutate(id);
            // Move to next image, or prev, or close
            if (hasNext) { /* index stays, list shrinks so next image slides in */ }
            else if (hasPrev) setLightboxIndex((i) => i! - 1);
            else setLightboxIndex(null);
          }}
        />
      )}
    </div>
  );
}
