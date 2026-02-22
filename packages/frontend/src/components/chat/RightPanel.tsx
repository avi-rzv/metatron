import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faXmark,
  faPlus,
  faEllipsisVertical,
  faPen,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { api, getMediaUrl } from '@/api';
import { t } from '@/i18n';
import type { Chat, Provider, Media } from '@/types';

type DateGroup = 'today' | 'yesterday' | 'pastWeek' | 'older';

const GROUP_ORDER: DateGroup[] = ['today', 'yesterday', 'pastWeek', 'older'];

const GROUP_LABELS: Record<DateGroup, string> = {
  today: t.chat.today,
  yesterday: t.chat.yesterday,
  pastWeek: t.chat.pastWeek,
  older: t.chat.older,
};

function getDateGroup(dateString: string): DateGroup {
  const date = new Date(dateString);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  if (date >= startOfToday) return 'today';
  if (date >= startOfYesterday) return 'yesterday';
  if (date >= startOfWeek) return 'pastWeek';
  return 'older';
}

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

  // Dropdown state
  const [dropdownChatId, setDropdownChatId] = useState<string | null>(null);
  // Inline rename state
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Mobile bottom sheet state
  const [bottomSheetChat, setBottomSheetChat] = useState<Chat | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: chats = [] } = useQuery({
    queryKey: ['chats'],
    queryFn: api.chats.list,
  });

  const { data: recentMedia = [] } = useQuery({
    queryKey: ['recentMedia'],
    queryFn: () => api.media.list(6),
  });

  const grouped = useMemo(() => {
    const groups: Record<DateGroup, Chat[]> = {
      today: [],
      yesterday: [],
      pastWeek: [],
      older: [],
    };
    for (const chat of chats) {
      const group = getDateGroup(chat.updatedAt);
      groups[group].push(chat);
    }
    return groups;
  }, [chats]);

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

  const renameChat = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.chats.patch(id, { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  const resetState = useCallback(() => {
    setDropdownChatId(null);
    setRenamingChatId(null);
    setRenameValue('');
    setBottomSheetChat(null);
  }, []);

  // Reset all state when panel closes
  useEffect(() => {
    if (!rightPanelOpen) resetState();
  }, [rightPanelOpen, resetState]);

  // Close on outside click
  useEffect(() => {
    if (!rightPanelOpen) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setRightPanelOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [rightPanelOpen, setRightPanelOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownChatId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dropdown]')) setDropdownChatId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownChatId]);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingChatId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingChatId]);

  function startRename(chat: Chat) {
    setDropdownChatId(null);
    setBottomSheetChat(null);
    setRenamingChatId(chat.id);
    setRenameValue(chat.title);
  }

  function commitRename() {
    if (!renamingChatId) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== chats.find((c) => c.id === renamingChatId)?.title) {
      renameChat.mutate({ id: renamingChatId, title: trimmed });
    }
    setRenamingChatId(null);
    setRenameValue('');
  }

  function handleDelete(chat: Chat) {
    setDropdownChatId(null);
    setBottomSheetChat(null);
    if (confirm(t.chat.deleteChatConfirm)) {
      deleteChat.mutate(chat.id);
    }
  }

  // Long-press handlers for mobile
  function onTouchStart(chat: Chat) {
    longPressTimer.current = setTimeout(() => {
      setBottomSheetChat(chat);
    }, 500);
  }

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function renderChatItem(chat: Chat) {
    const isActive = activeChatId === chat.id;
    const isRenaming = renamingChatId === chat.id;
    const isDropdownOpen = dropdownChatId === chat.id;

    return (
      <li key={chat.id}>
        <div
          className={[
            'group relative flex items-center gap-2 rounded-xl px-3 py-2 cursor-pointer transition-all duration-150',
            isActive ? 'bg-gray-100' : 'hover:bg-gray-50',
          ].join(' ')}
          onClick={() => {
            if (isRenaming) return;
            setActiveChatId(chat.id);
            navigate(`/chat/${chat.id}`);
            setRightPanelOpen(false);
          }}
          onTouchStart={() => onTouchStart(chat)}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
        >
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setRenamingChatId(null);
                  setRenameValue('');
                }
              }}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 text-sm text-gray-700 bg-white border border-gray-300 rounded-md px-2 py-0.5 outline-none focus:border-gray-500"
            />
          ) : (
            <span className="flex-1 truncate text-sm text-gray-700">{chat.title}</span>
          )}

          {/* Desktop 3-dot menu */}
          {!isRenaming && (
            <div className="relative" data-dropdown>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownChatId(isDropdownOpen ? null : chat.id);
                }}
                className={[
                  'h-6 w-6 items-center justify-center rounded-full hover:bg-gray-200 active:scale-90 transition-all duration-150',
                  isDropdownOpen ? 'flex bg-gray-200' : 'flex opacity-0 group-hover:opacity-100',
                ].join(' ')}
                aria-label="Chat options"
              >
                <FontAwesomeIcon icon={faEllipsisVertical} className="text-[10px] text-gray-400" />
              </button>

              {isDropdownOpen && (
                <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(chat);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <FontAwesomeIcon icon={faPen} className="text-[10px] text-gray-400" />
                    {t.chat.renameChat}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(chat);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    <FontAwesomeIcon icon={faTrash} className="text-[10px] text-red-400" />
                    {t.chat.deleteChat}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </li>
    );
  }

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

        {/* Chat list with date groups */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {chats.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-400">{t.chat.noChats}</p>
              <p className="mt-1 text-xs text-gray-300">{t.chat.startNewChat}</p>
            </div>
          ) : (
            GROUP_ORDER.map((group) => {
              const groupChats = grouped[group];
              if (groupChats.length === 0) return null;
              return (
                <div key={group} className="mb-2">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    {GROUP_LABELS[group]}
                  </div>
                  <ul className="space-y-0.5">
                    {groupChats.map((chat) => renderChatItem(chat))}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        {/* Recent Media */}
        {recentMedia.length > 0 && (
          <div className="border-t border-gray-100 px-3 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500">{t.gallery.recentMedia}</span>
              <button
                onClick={() => {
                  navigate('/gallery');
                  setRightPanelOpen(false);
                }}
                className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors"
              >
                {t.gallery.viewAll}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {recentMedia.map((m: Media) => (
                <button
                  key={m.id}
                  onClick={() => {
                    navigate(`/chat/${m.chatId}`);
                    setRightPanelOpen(false);
                  }}
                  className="aspect-square rounded-lg overflow-hidden border border-gray-200 hover:border-gray-300 transition-colors"
                >
                  <img
                    src={getMediaUrl(m.id)}
                    alt={m.prompt}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Mobile bottom sheet */}
      {bottomSheetChat && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setBottomSheetChat(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-t-2xl bg-white px-4 pb-6 pt-4 shadow-2xl animate-[slideUp_0.2s_ease-out]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-300" />
            <p className="mb-4 truncate text-sm font-medium text-gray-700 px-1">
              {bottomSheetChat.title}
            </p>
            <button
              onClick={() => startRename(bottomSheetChat)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100"
            >
              <FontAwesomeIcon icon={faPen} className="text-xs text-gray-400" />
              {t.chat.renameChat}
            </button>
            <button
              onClick={() => handleDelete(bottomSheetChat)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 active:bg-red-100"
            >
              <FontAwesomeIcon icon={faTrash} className="text-xs text-red-400" />
              {t.chat.deleteChat}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
