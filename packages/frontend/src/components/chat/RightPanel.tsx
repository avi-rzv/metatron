import { useRef, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faXmark,
  faPlus,
  faMessage,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { api } from '@/api';
import { t } from '@/i18n';
import type { Chat, Provider } from '@/types';

interface RightPanelProps {
  currentProvider: Provider;
  currentModel: string;
}

export function RightPanel({ currentProvider, currentModel }: RightPanelProps) {
  const { rightPanelOpen, setRightPanelOpen } = useUIStore();
  const { activeChatId, setActiveChatId } = useChatStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);

  const { data: chats = [] } = useQuery({
    queryKey: ['chats'],
    queryFn: api.chats.list,
  });

  const createChat = useMutation({
    mutationFn: () =>
      api.chats.create({ provider: currentProvider, model: currentModel }),
    onSuccess: (chat) => {
      qc.invalidateQueries({ queryKey: ['chats'] });
      setActiveChatId(chat.id);
      navigate(`/chat/${chat.id}`);
      setRightPanelOpen(false);
    },
  });

  const deleteChat = useMutation({
    mutationFn: (id: string) => api.chats.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['chats'] });
      if (activeChatId === id) {
        setActiveChatId(null);
        navigate('/chat');
      }
    },
  });

  // Close on outside click
  useEffect(() => {
    if (!rightPanelOpen) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setRightPanelOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [rightPanelOpen, setRightPanelOpen]);

  return (
    <>
      {rightPanelOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/10 backdrop-blur-sm"
          aria-hidden="true"
        />
      )}

      <div
        ref={ref}
        className={[
          'fixed top-0 right-0 h-full z-30 w-72 bg-white border-l border-gray-100 flex flex-col shadow-xl',
          'transition-transform duration-200 ease-in-out',
          rightPanelOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <span className="font-semibold text-sm">{t.chat.pastChats}</span>
          <button
            onClick={() => setRightPanelOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-gray-100 active:scale-95 transition-all duration-150"
            aria-label="Close"
          >
            <FontAwesomeIcon icon={faXmark} className="text-sm text-gray-500" />
          </button>
        </div>

        {/* New Chat button */}
        <div className="px-3 pt-3">
          <button
            onClick={() => createChat.mutate()}
            disabled={createChat.isPending}
            className="flex w-full items-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
          >
            <FontAwesomeIcon icon={faPlus} className="text-xs" />
            {t.chat.newChat}
          </button>
        </div>

        {/* Chat list */}
        <ul className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {chats.length === 0 ? (
            <li className="py-8 text-center">
              <p className="text-sm text-gray-400">{t.chat.noChats}</p>
              <p className="mt-1 text-xs text-gray-300">{t.chat.startNewChat}</p>
            </li>
          ) : (
            chats.map((chat: Chat) => (
              <li key={chat.id}>
                <div
                  className={[
                    'group flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer transition-all duration-150',
                    activeChatId === chat.id
                      ? 'bg-gray-100'
                      : 'hover:bg-gray-50',
                  ].join(' ')}
                  onClick={() => {
                    setActiveChatId(chat.id);
                    navigate(`/chat/${chat.id}`);
                    setRightPanelOpen(false);
                  }}
                >
                  <FontAwesomeIcon icon={faMessage} className="text-xs text-gray-400 shrink-0" />
                  <span className="flex-1 truncate text-sm text-gray-700">{chat.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChat.mutate(chat.id);
                    }}
                    className="hidden group-hover:flex h-6 w-6 items-center justify-center rounded-full hover:bg-gray-200 active:scale-90 transition-all duration-150"
                    aria-label={t.chat.deleteChat}
                  >
                    <FontAwesomeIcon icon={faTrash} className="text-[10px] text-gray-400" />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}
