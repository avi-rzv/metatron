import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faCheck, faFile, faTrash, faDownload } from '@fortawesome/free-solid-svg-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { Message, Citation, Media, Attachment } from '@/types';
import { api, getMediaUrl, getUploadUrl } from '@/api';
import { ImageLightbox } from './ImageLightbox';
import { AudioPlayer } from './AudioPlayer';
import { t } from '@/i18n';
import { showToast } from '@/utils/toast';

interface ChatMessageProps {
  message: Message;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for browsers that block clipboard API
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    showToast('Message copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors duration-150"
      aria-label={t.chat.copy}
    >
      <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="text-[11px]" />
      <span>{copied ? t.chat.copied : t.chat.copy}</span>
    </button>
  );
}

function CitationChips({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="text-[11px] text-gray-400 mb-1.5">{t.chat.sources}</p>
      <div className="flex flex-wrap gap-1.5">
        {citations.map((cite, i) => {
          let domain = '';
          try {
            domain = new URL(cite.url).hostname.replace(/^www\./, '');
          } catch { /* ignore */ }
          return (
            <a
              key={i}
              href={cite.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-colors duration-150 max-w-[260px]"
              title={cite.title || cite.url}
            >
              <img
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                alt=""
                className="w-3.5 h-3.5 rounded-sm flex-shrink-0"
              />
              <span className="truncate">{cite.title || domain}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function MediaThumbnails({ mediaItems }: { mediaItems: Media[] }) {
  const [lightboxMedia, setLightboxMedia] = useState<Media | null>(null);
  const qc = useQueryClient();

  if (mediaItems.length === 0) return null;

  const handleDelete = async (id: string) => {
    await api.media.delete(id);
    qc.invalidateQueries({ queryKey: ['chat'] });
    qc.invalidateQueries({ queryKey: ['allMedia'] });
    qc.invalidateQueries({ queryKey: ['recentMedia'] });
    setLightboxMedia(null);
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {mediaItems.map((m) => (
          <button
            key={m.id}
            onClick={() => setLightboxMedia(m)}
            className="group/img relative rounded-lg overflow-hidden border border-gray-200 hover:border-gray-300 transition-colors"
          >
            <img
              src={getMediaUrl(m.id)}
              alt={m.prompt}
              className="w-48 h-48 object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-end">
              <span className="hidden group-hover/img:block text-[10px] text-white bg-black/60 px-2 py-1 w-full truncate">
                {m.model}
              </span>
            </div>
          </button>
        ))}
      </div>
      {lightboxMedia && (
        <ImageLightbox
          media={lightboxMedia}
          onClose={() => setLightboxMedia(null)}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}

function AttachmentPreviews({ items }: { items: Attachment[] }) {
  const qc = useQueryClient();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (items.length === 0) return null;

  const handleDelete = async (att: Attachment) => {
    if (!confirm(t.chat.deleteAttachmentConfirm)) return;
    await api.uploads.delete(att.id);
    qc.invalidateQueries({ queryKey: ['chat'] });
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((att) => {
          const url = getUploadUrl(att.id);

          // Images
          if (att.mimeType.startsWith('image/')) {
            return (
              <div key={att.id} className="group/att relative">
                <button
                  onClick={() => setLightboxUrl(url)}
                  className="rounded-lg overflow-hidden border border-gray-200 hover:border-gray-300 transition-colors"
                >
                  <img src={url} alt={att.originalName} className="w-48 h-48 object-cover" />
                </button>
                <button
                  onClick={() => handleDelete(att)}
                  className="absolute top-1 right-1 hidden group-hover/att:flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 transition-colors"
                  aria-label={t.chat.deleteAttachment}
                >
                  <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                </button>
              </div>
            );
          }

          // Audio
          if (att.mimeType.startsWith('audio/')) {
            return (
              <div key={att.id} className="group/att relative rounded-lg border border-gray-200 p-2">
                <div className="text-xs text-gray-500 mb-1 truncate max-w-[200px]">{att.originalName}</div>
                <audio controls src={url} className="h-8 w-[200px]" preload="metadata" />
                <button
                  onClick={() => handleDelete(att)}
                  className="absolute top-1 right-1 hidden group-hover/att:flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 transition-colors"
                  aria-label={t.chat.deleteAttachment}
                >
                  <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                </button>
              </div>
            );
          }

          // Video
          if (att.mimeType.startsWith('video/')) {
            return (
              <div key={att.id} className="group/att relative rounded-lg border border-gray-200 overflow-hidden">
                <video controls src={url} className="w-64 max-h-48" preload="metadata" />
                <button
                  onClick={() => handleDelete(att)}
                  className="absolute top-1 right-1 hidden group-hover/att:flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 transition-colors"
                  aria-label={t.chat.deleteAttachment}
                >
                  <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
                </button>
              </div>
            );
          }

          // Documents (PDF, TXT, CSV)
          return (
            <div
              key={att.id}
              className="group/att relative flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600"
            >
              <FontAwesomeIcon icon={faFile} className="text-gray-400" />
              <span className="truncate max-w-[120px]">{att.originalName}</span>
              <a
                href={url}
                download={att.originalName}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                aria-label="Download"
              >
                <FontAwesomeIcon icon={faDownload} className="text-[10px]" />
              </a>
              <button
                onClick={() => handleDelete(att)}
                className="hidden group-hover/att:flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:text-red-600 transition-colors"
                aria-label={t.chat.deleteAttachment}
              >
                <FontAwesomeIcon icon={faTrash} className="text-[10px]" />
              </button>
            </div>
          );
        })}
      </div>
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg" />
        </div>
      )}
    </>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    const audioAttachment = message.attachments?.find((a) => a.mimeType.startsWith('audio/'));
    const nonAudioAttachments = message.attachments?.filter((a) => !a.mimeType.startsWith('audio/')) ?? [];

    if (audioAttachment) {
      return (
        <div className="group flex justify-end px-4 py-1 animate-fade-in">
          <div className="max-w-[75%]">
            <div className="rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-3">
              <AudioPlayer src={getUploadUrl(audioAttachment.id)} />
              {message.content && (
                <p className="mt-2 text-xs italic text-gray-500 leading-relaxed">{message.content}</p>
              )}
            </div>
            <div className="mt-1 flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <CopyButton text={message.content} />
              <span className="text-[11px] text-gray-400">{formatTime(message.createdAt)}</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="group flex justify-end px-4 py-1 animate-fade-in">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
            {nonAudioAttachments.length > 0 && (
              <AttachmentPreviews items={nonAudioAttachments} />
            )}
          </div>
          <div className="mt-1 flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <CopyButton text={message.content} />
            <span className="text-[11px] text-gray-400">{formatTime(message.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start px-4 py-1 animate-fade-in">
      <div className="max-w-[80%] w-full">
        <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className ?? '');
                const isBlock = match !== null;
                return isBlock ? (
                  <SyntaxHighlighter
                    style={oneLight as Record<string, React.CSSProperties>}
                    language={match[1]}
                    PreTag="div"
                    className="!rounded-xl !text-xs !my-2"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-4 border-gray-200 pl-3 text-gray-500 italic my-2">
                    {children}
                  </blockquote>
                );
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 underline hover:text-blue-700"
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {message.media && message.media.length > 0 && (
          <MediaThumbnails mediaItems={message.media} />
        )}
        {message.citations && message.citations.length > 0 && (
          <CitationChips citations={message.citations} />
        )}
        <div className="mt-2 flex items-center gap-3">
          <CopyButton text={message.content} />
          <span className="text-[11px] text-gray-400">{formatTime(message.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

interface StreamingMediaItem {
  mediaId: string;
  filename: string;
  prompt: string;
  model: string;
}

export function StreamingMessage({
  content,
  citations,
  streamingMedia,
}: {
  content: string;
  citations?: Citation[];
  streamingMedia?: StreamingMediaItem[];
}) {
  return (
    <div className="flex justify-start px-4 py-1 animate-fade-in">
      <div className="max-w-[80%] w-full">
        <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
          {content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <span className="inline-flex items-center gap-1 text-gray-400 text-sm">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
            </span>
          )}
        </div>
        {streamingMedia && streamingMedia.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {streamingMedia.map((m) => (
              <div
                key={m.mediaId}
                className="relative rounded-lg overflow-hidden border border-gray-200"
              >
                <img
                  src={getMediaUrl(m.mediaId)}
                  alt={m.prompt}
                  className="w-48 h-48 object-cover"
                />
              </div>
            ))}
          </div>
        )}
        {citations && citations.length > 0 && (
          <CitationChips citations={citations} />
        )}
      </div>
    </div>
  );
}
