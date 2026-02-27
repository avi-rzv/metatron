import { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent, DragEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faPaperPlane, faXmark, faFile, faMicrophone, faStop } from '@fortawesome/free-solid-svg-icons';
import { t } from '@/i18n';
import { showToast } from '@/utils/toast';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_FILES = 10;
const ACCEPTED_TYPES = [
  'image/*', 'audio/*', 'video/*',
  'application/pdf', 'text/plain', 'text/csv',
];
const ACCEPT_STRING = 'image/*,audio/*,video/*,.pdf,.txt,.csv';

function isAcceptedType(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/') ||
    mimeType === 'application/pdf' ||
    mimeType === 'text/plain' ||
    mimeType === 'text/csv'
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ChatInputHandle {
  addFiles: (files: FileList | File[]) => void;
}

interface ChatInputProps {
  onSend: (content: string, files: File[]) => void;
  onSendVoice?: (audioBlob: Blob) => void;
  disabled?: boolean;
  isDraggingOver?: boolean;
}

const MOBILE_MIN_ROWS = 1;
const DESKTOP_MIN_ROWS = 3;
const DESKTOP_MAX_ROWS = 9;
const LINE_HEIGHT = 24; // px

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { onSend, onSendVoice, disabled, isDraggingOver },
  ref,
) {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCountRef = useRef(0);
  const { isRecording, duration, startRecording, stopRecording, cancelRecording, getElapsedMs } = useVoiceRecorder();
  const pointerTypeRef = useRef<string>('');
  const isMobileRef = useRef(window.matchMedia('(max-width: 767px)').matches);

  // Generate image previews
  useEffect(() => {
    const newPreviews = new Map<File, string>();
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const existing = previews.get(file);
        if (existing) {
          newPreviews.set(file, existing);
        } else {
          const url = URL.createObjectURL(file);
          newPreviews.set(file, url);
        }
      }
    }
    // Revoke old URLs no longer in use
    for (const [file, url] of previews) {
      if (!newPreviews.has(file)) {
        URL.revokeObjectURL(url);
      }
    }
    setPreviews(newPreviews);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const url of previews.values()) {
        URL.revokeObjectURL(url);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (isMobileRef.current) {
      // Mobile: fixed 1-line height, scroll for overflow
      el.style.height = `${MOBILE_MIN_ROWS * LINE_HEIGHT}px`;
      el.style.overflowY = 'auto';
    } else {
      // Desktop: auto-expand between min/max rows
      el.style.height = 'auto';
      const lines = Math.ceil(el.scrollHeight / LINE_HEIGHT);
      const clamped = Math.min(Math.max(lines, DESKTOP_MIN_ROWS), DESKTOP_MAX_ROWS);
      el.style.height = `${clamped * LINE_HEIGHT}px`;
      el.style.overflowY = lines > DESKTOP_MAX_ROWS ? 'auto' : 'hidden';
    }
  }, []);

  // Re-adjust textarea height when breakpoint changes
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => {
      isMobileRef.current = e.matches;
      adjustHeight();
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [adjustHeight]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    adjustHeight();
  };

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const newFiles = Array.from(incoming);
    setFiles((prev) => {
      const combined = [...prev];
      for (const file of newFiles) {
        if (combined.length >= MAX_FILES) {
          showToast(t.chat.tooManyFiles);
          break;
        }
        if (file.size > MAX_FILE_SIZE) {
          showToast(t.chat.fileTooBig);
          continue;
        }
        if (!isAcceptedType(file.type)) {
          showToast(t.chat.unsupportedFile);
          continue;
        }
        combined.push(file);
      }
      return combined;
    });
  }, []);

  // Expose addFiles to parent via ref
  useImperativeHandle(ref, () => ({ addFiles }), [addFiles]);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled && (value.trim() || files.length > 0)) {
      e.preventDefault();
      handleSend();
    }
  };

  // Refocus textarea when streaming ends (disabled goes false)
  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  const handleSend = () => {
    const trimmed = value.trim();
    if ((!trimmed && files.length === 0) || disabled) return;
    onSend(trimmed, files);
    setValue('');
    setFiles([]);
    if (textareaRef.current) {
      const minRows = isMobileRef.current ? MOBILE_MIN_ROWS : DESKTOP_MIN_ROWS;
      textareaRef.current.style.height = `${minRows * LINE_HEIGHT}px`;
    }
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const tryStartRecording = async () => {
    if (disabled || isRecording) return;
    try {
      await startRecording();
    } catch {
      showToast(t.chat.microphoneError);
    }
  };

  const stopAndSend = async () => {
    if (!isRecording) return;
    if (getElapsedMs() < 500) {
      cancelRecording();
      return;
    }
    const blob = await stopRecording();
    if (blob && onSendVoice) {
      onSendVoice(blob);
    }
  };

  // Mic button (not recording): onPointerDown stores pointerType, starts on touch
  const handleMicPointerDown = async (e: React.PointerEvent) => {
    pointerTypeRef.current = e.pointerType;
    if (e.pointerType === 'touch') {
      await tryStartRecording();
    }
  };

  // Mic button click: starts recording for non-touch (mouse/pen)
  const handleMicClick = async () => {
    if (pointerTypeRef.current !== 'touch') {
      await tryStartRecording();
    }
  };

  // Stop button click: works for both desktop and mobile tap
  const handleStopClick = async () => {
    await stopAndSend();
  };

  const handleCancelRecording = () => {
    cancelRecording();
  };

  // Document pointerup listener for mobile press-and-hold release
  useEffect(() => {
    if (!isRecording || pointerTypeRef.current !== 'touch') return;
    const handler = () => { stopAndSend(); };
    document.addEventListener('pointerup', handler);
    return () => { document.removeEventListener('pointerup', handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const formatRecordingDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const hasSendable = value.trim().length > 0 || files.length > 0;

  return (
    <div
      className="relative rounded-2xl border border-gray-200 bg-white shadow-md focus-within:border-gray-300 focus-within:shadow-lg transition-all duration-150"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay — shown when dragging over this component OR anywhere on the chat page */}
      {(isDragging || isDraggingOver) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-gray-400 bg-gray-50/80">
          <span className="text-sm font-medium text-gray-500">{t.chat.dropFiles}</span>
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${file.size}-${i}`}
              className="relative flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600"
            >
              {file.type.startsWith('image/') && previews.get(file) ? (
                <img
                  src={previews.get(file)}
                  alt={file.name}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <FontAwesomeIcon icon={faFile} className="text-gray-400" />
              )}
              <div className="max-w-[100px]">
                <div className="truncate text-xs font-medium">{file.name}</div>
                <div className="text-[10px] text-gray-400">{formatFileSize(file.size)}</div>
              </div>
              <button
                onClick={() => removeFile(i)}
                className="ms-1 flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
                aria-label={t.chat.removeFile}
                type="button"
              >
                <FontAwesomeIcon icon={faXmark} className="text-[10px]" />
              </button>
            </div>
          ))}
        </div>
      )}

      {isRecording ? (
        /* Recording indicator */
        <div className="flex items-center gap-3 px-3 py-3">
          <button
            onClick={handleCancelRecording}
            className="flex h-10 w-10 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-90 transition-all duration-150"
            aria-label={t.chat.cancelRecording}
            type="button"
          >
            <FontAwesomeIcon icon={faXmark} className="text-base md:text-sm" />
          </button>
          <div className="flex flex-1 items-center justify-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-600 tabular-nums">
              {formatRecordingDuration(duration)}
            </span>
          </div>
          <button
            onClick={handleStopClick}
            className="flex h-10 w-10 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-full bg-black text-white hover:bg-gray-800 active:scale-90 transition-all duration-150"
            aria-label={t.chat.send}
            type="button"
          >
            <FontAwesomeIcon icon={faStop} className="text-sm md:text-xs" />
          </button>
        </div>
      ) : (
        <div className="px-3 py-2 md:py-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_STRING}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* Input row: attach (desktop) | textarea | mic/send (desktop) */}
          <div className="flex items-end gap-2">
            {/* Attach — desktop only, inline left */}
            <button
              className="mb-0.5 hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-90 transition-all duration-150"
              aria-label={t.chat.attach}
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <FontAwesomeIcon icon={faPlus} className="text-sm" />
            </button>

            {/* Textarea — single element, responsive height */}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={t.chat.typeMessage}
              disabled={disabled}
              rows={1}
              style={{ height: `${(isMobileRef.current ? MOBILE_MIN_ROWS : DESKTOP_MIN_ROWS) * LINE_HEIGHT}px`, overflowY: 'hidden' }}
              className="flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none leading-6 disabled:opacity-60"
            />

            {/* Mic/Send — desktop only, inline right */}
            <div className="mb-0.5 hidden md:block">
              {hasSendable ? (
                <button
                  onClick={handleSend}
                  disabled={disabled}
                  aria-label={t.chat.send}
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white hover:bg-gray-800 active:scale-90 transition-all duration-150 disabled:opacity-50"
                >
                  <FontAwesomeIcon icon={faPaperPlane} className="text-xs" />
                </button>
              ) : (
                <button
                  onPointerDown={handleMicPointerDown}
                  onClick={handleMicClick}
                  disabled={disabled}
                  aria-label={t.chat.recordVoice}
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-90 transition-all duration-150 disabled:opacity-50"
                >
                  <FontAwesomeIcon icon={faMicrophone} className="text-sm" />
                </button>
              )}
            </div>
          </div>

          {/* Mobile tools row — attach (left) | mic/send (right) */}
          <div className="flex md:hidden items-center justify-between mt-1">
            <button
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-90 transition-all duration-150"
              aria-label={t.chat.attach}
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <FontAwesomeIcon icon={faPlus} className="text-sm" />
            </button>
            {hasSendable ? (
              <button
                onClick={handleSend}
                disabled={disabled}
                aria-label={t.chat.send}
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white hover:bg-gray-800 active:scale-90 transition-all duration-150 disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faPaperPlane} className="text-sm" />
              </button>
            ) : (
              <button
                onPointerDown={handleMicPointerDown}
                onClick={handleMicClick}
                disabled={disabled}
                aria-label={t.chat.recordVoice}
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-90 transition-all duration-150 disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faMicrophone} className="text-sm" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
