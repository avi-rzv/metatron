import { useState, useEffect, useRef, useCallback, DragEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClockRotateLeft, faBars } from '@fortawesome/free-solid-svg-icons';
import { ModelSelector } from '@/components/chat/ModelSelector';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { ChatInput, type ChatInputHandle } from '@/components/chat/ChatInput';
import { RightPanel } from '@/components/chat/RightPanel';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { api, streamMessage } from '@/api';
import { t } from '@/i18n';
import type { Provider, Message } from '@/types';
import { ALL_MODELS, getProviderForModel } from '@/types';

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toggleRightPanel, isMobile, toggleSidebar } = useUIStore();
  const { isStreaming, setStreaming, appendStreamChunk, setStreamingCitations, addStreamingMedia, stopStreaming } = useChatStore();

  // Default provider/model from settings if available
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });

  const [provider, setProvider] = useState<Provider>('gemini');
  const [model, setModel] = useState<string>(ALL_MODELS[0].id);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const dragCountRef = useRef(0);

  const handlePageDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    if (dragCountRef.current === 1) setIsDraggingOver(true);
  }, []);

  const handlePageDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current === 0) setIsDraggingOver(false);
  }, []);

  const handlePageDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handlePageDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setIsDraggingOver(false);
    if (e.dataTransfer.files.length > 0) {
      chatInputRef.current?.addFiles(e.dataTransfer.files);
    }
  }, []);

  // Restore last visited chat when landing on /chat with no chatId
  useEffect(() => {
    if (!chatId) {
      const lastId = localStorage.getItem('lastChatId');
      if (lastId) navigate(`/chat/${lastId}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the last visited chatId
  useEffect(() => {
    if (chatId) localStorage.setItem('lastChatId', chatId);
  }, [chatId]);

  // Only apply settings defaults once per new-chat session (not on every settings refetch)
  const settingsInitialized = useRef(false);

  // When navigating to a new chat (no chatId), allow re-initialization from settings
  useEffect(() => {
    if (!chatId) settingsInitialized.current = false;
  }, [chatId]);

  // Sync provider/model from settings only on first load (or when opening a new chat)
  useEffect(() => {
    if (!settings || settingsInitialized.current) return;
    if (!chatId) {
      settingsInitialized.current = true;
      const defaultModelId = settings.primaryModel.modelId;
      const defaultProvider = getProviderForModel(defaultModelId) ?? 'gemini';
      setProvider(defaultProvider);
      setModel(defaultModelId);
    }
  }, [settings, chatId]);

  // Load existing chat messages
  const { data: chatData } = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => api.chats.get(chatId!),
    enabled: !!chatId,
  });

  // Track whether we've already initialized model from this chat — prevents
  // the chatData refetch after each message from resetting user's model selection.
  const chatModelInitialized = useRef(false);
  useEffect(() => {
    chatModelInitialized.current = false;
  }, [chatId]);

  useEffect(() => {
    if (!chatData?.messages) return;
    setLocalMessages(chatData.messages);
    if (!chatModelInitialized.current) {
      chatModelInitialized.current = true;
      if (chatData.provider) setProvider(chatData.provider as Provider);
      if (chatData.model) setModel(chatData.model);
    }
  }, [chatData]);

  const createChat = useMutation({
    mutationFn: () => api.chats.create({ provider, model }),
    onSuccess: (chat) => {
      qc.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/chat/${chat.id}`, { replace: true });
    },
  });

  const handleModelChange = (p: Provider, m: string) => {
    setProvider(p);
    setModel(m);
  };

  const handleSend = async (content: string, files?: File[]) => {
    if (isStreaming) return;

    // Convert files to base64 attachments
    let fileAttachments: Array<{ name: string; mimeType: string; data: string }> | undefined;
    if (files && files.length > 0) {
      fileAttachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<{ name: string; mimeType: string; data: string }>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve({ name: file.name, mimeType: file.type, data: base64 });
              };
              reader.readAsDataURL(file);
            })
        )
      );
    }

    let currentChatId = chatId;

    // Create chat if needed
    if (!currentChatId) {
      const chat = await api.chats.create({ provider, model });
      qc.invalidateQueries({ queryKey: ['chats'] });
      currentChatId = chat.id;
      navigate(`/chat/${chat.id}`, { replace: true });
    }

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: 'temp-user-' + Date.now(),
      chatId: currentChatId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, tempUserMsg]);

    setStreaming({ isStreaming: true, streamingContent: '', streamingMessageId: null });

    streamMessage(currentChatId, content, { provider, model, attachments: fileAttachments }, {
      onStart: ({ messageId, userMessageId }) => {
        setStreaming({ isStreaming: true, streamingContent: '', streamingMessageId: messageId });
        // Replace temp user message id
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.id === tempUserMsg.id ? { ...m, id: userMessageId } : m
          )
        );
      },
      onChunk: (text) => {
        appendStreamChunk(text);
      },
      onImage: (data) => {
        addStreamingMedia(data);
      },
      onDone: ({ messageId, citations }) => {
        if (citations?.length) setStreamingCitations(citations);
        // Refresh from server to get the saved assistant message
        qc.invalidateQueries({ queryKey: ['chat', currentChatId] });
        qc.invalidateQueries({ queryKey: ['chats'] });
        stopStreaming();
      },
      onError: (message) => {
        console.error('Stream error:', message);
        stopStreaming();
      },
    });
  };

  const handleSendVoice = async (audioBlob: Blob) => {
    if (isStreaming || isTranscribing) return;

    setIsTranscribing(true);

    let transcription: string;
    let audioMeta: { filename: string; mimeType: string; size: number };

    try {
      const result = await api.voice.transcribe(audioBlob);
      transcription = result.transcription;
      audioMeta = { filename: result.filename, mimeType: result.mimeType, size: result.size };
    } catch (err) {
      console.error('Transcription failed:', err);
      setIsTranscribing(false);
      return;
    }

    setIsTranscribing(false);

    if (!transcription.trim()) return;

    let currentChatId = chatId;

    if (!currentChatId) {
      const chat = await api.chats.create({ provider, model });
      qc.invalidateQueries({ queryKey: ['chats'] });
      currentChatId = chat.id;
      navigate(`/chat/${chat.id}`, { replace: true });
    }

    const tempUserMsg: Message = {
      id: 'temp-user-' + Date.now(),
      chatId: currentChatId,
      role: 'user',
      content: transcription,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, tempUserMsg]);

    setStreaming({ isStreaming: true, streamingContent: '', streamingMessageId: null });

    streamMessage(currentChatId, transcription, { provider, model, audio: audioMeta }, {
      onStart: ({ messageId, userMessageId }) => {
        setStreaming({ isStreaming: true, streamingContent: '', streamingMessageId: messageId });
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.id === tempUserMsg.id ? { ...m, id: userMessageId } : m
          )
        );
      },
      onChunk: (text) => {
        appendStreamChunk(text);
      },
      onImage: (data) => {
        addStreamingMedia(data);
      },
      onDone: ({ messageId, citations }) => {
        if (citations?.length) setStreamingCitations(citations);
        qc.invalidateQueries({ queryKey: ['chat', currentChatId] });
        qc.invalidateQueries({ queryKey: ['chats'] });
        stopStreaming();
      },
      onError: (message) => {
        console.error('Stream error:', message);
        stopStreaming();
      },
    });
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRestored = useRef(false);

  // Reset restored flag whenever we switch to a different chat
  useEffect(() => {
    scrollRestored.current = false;
  }, [chatId]);

  // Save scroll position to sessionStorage as the user scrolls
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !chatId) return;
    const onScroll = () => sessionStorage.setItem(`chat-scroll:${chatId}`, String(el.scrollTop));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [chatId]);

  // Once messages first load for this chatId, restore saved position (or jump to bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || scrollRestored.current) return;
    if (localMessages.length === 0) return;
    scrollRestored.current = true;
    const saved = chatId ? sessionStorage.getItem(`chat-scroll:${chatId}`) : null;
    el.scrollTop = saved !== null ? Number(saved) : el.scrollHeight;
  }, [localMessages, chatId]);

  const messages = localMessages;

  return (
    <div
      className="flex h-full flex-col"
      onDragEnter={handlePageDragEnter}
      onDragLeave={handlePageDragLeave}
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              onClick={toggleSidebar}
              className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black active:scale-95 transition-all duration-150"
              aria-label={t.sidebar.open}
            >
              <FontAwesomeIcon icon={faBars} className="text-sm" />
            </button>
          )}
          <ModelSelector provider={provider} model={model} onChange={handleModelChange} />
        </div>
        <button
          onClick={toggleRightPanel}
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black active:scale-95 transition-all duration-150"
          aria-label={t.chat.pastChats}
        >
          <FontAwesomeIcon icon={faClockRotateLeft} className="text-sm" />
        </button>
      </div>

      {/* Scrollable messages area — full width so scrollbar sits at the far right */}
      <div ref={scrollRef} className="flex flex-1 overflow-y-auto chat-scrollbar justify-center">
        <div className="w-full max-w-3xl">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center py-16">
              <p className="text-2xl font-semibold text-gray-800">{t.appName}</p>
              <p className="text-sm text-gray-400">{t.chat.startNewChat}</p>
            </div>
          ) : (
            <ChatWindow messages={messages} />
          )}
        </div>
      </div>

      {/* Input — outside the scroll container, always anchored at the bottom */}
      <div className="flex justify-center bg-white px-4 pb-4 pt-2">
        <div className="w-full max-w-3xl">
          <ChatInput ref={chatInputRef} onSend={handleSend} onSendVoice={handleSendVoice} disabled={isStreaming || isTranscribing} isDraggingOver={isDraggingOver} />
        </div>
      </div>

      <RightPanel currentProvider={provider} currentModel={model} />
    </div>
  );
}
