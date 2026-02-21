import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { t } from '@/i18n';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

const MIN_ROWS = 3;
const MAX_ROWS = 9;
const LINE_HEIGHT = 24; // px

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lines = Math.ceil(el.scrollHeight / LINE_HEIGHT);
    const clamped = Math.min(Math.max(lines, MIN_ROWS), MAX_ROWS);
    el.style.height = `${clamped * LINE_HEIGHT}px`;
    el.style.overflowY = lines > MAX_ROWS ? 'auto' : 'hidden';
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    adjustHeight();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !disabled && value.trim()) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = `${MIN_ROWS * LINE_HEIGHT}px`;
    }
  };

  const hasSendable = value.trim().length > 0;

  return (
    <div className="relative flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-md focus-within:border-gray-300 focus-within:shadow-lg transition-all duration-150">
      {/* Attach button */}
      <button
        className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 active:scale-90 transition-all duration-150"
        aria-label={t.chat.attach}
        type="button"
      >
        <FontAwesomeIcon icon={faPlus} className="text-sm" />
      </button>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t.chat.typeMessage}
        disabled={disabled}
        rows={MIN_ROWS}
        style={{ height: `${MIN_ROWS * LINE_HEIGHT}px`, overflowY: 'hidden' }}
        className="flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none leading-6 disabled:opacity-60"
      />

      {/* Send button — only shown when there is text */}
      <div className={`mb-0.5 transition-all duration-150 ${hasSendable ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'}`}>
        <button
          onClick={handleSend}
          disabled={disabled || !hasSendable}
          aria-label={t.chat.send}
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white hover:bg-gray-800 active:scale-90 transition-all duration-150 disabled:opacity-50"
        >
          <FontAwesomeIcon icon={faPaperPlane} className="text-xs" />
        </button>
      </div>
    </div>
  );
}
