import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faClockRotateLeft } from '@fortawesome/free-solid-svg-icons';
import { ModelSelector } from '@/components/chat/ModelSelector';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { ChatInput } from '@/components/chat/ChatInput';
import { RightPanel } from '@/components/chat/RightPanel';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { api, streamMessage } from '@/api';
import { t } from '@/i18n';
import type { Provider, Message } from '@/types';
import { GEMINI_MODELS } from '@/types';

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toggleRightPanel } = useUIStore();
  const { isStreaming, setStreaming, appendStreamChunk, stopStreaming } = useChatStore();

  // Default provider/model from settings if available
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });

  const [provider, setProvider] = useState<Provider>('gemini');
  const [model, setModel] = useState<string>(GEMINI_MODELS[0].id);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);

  // Sync provider/model from settings once loaded
  useEffect(() => {
    if (!settings) return;
    setProvider('gemini');
    setModel(settings.gemini.defaultModel ?? GEMINI_MODELS[0].id);
  }, [settings]);

  // Load existing chat messages
  const { data: chatData } = useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => api.chats.get(chatId!),
    enabled: !!chatId,
  });

  useEffect(() => {
    if (chatData?.messages) {
      setLocalMessages(chatData.messages);
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

  const handleSend = async (content: string) => {
    if (isStreaming) return;

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

    streamMessage(currentChatId, content, {
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
      onDone: ({ messageId }) => {
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

  const messages = localMessages;

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <ModelSelector provider={provider} model={model} onChange={handleModelChange} />
        <button
          onClick={toggleRightPanel}
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-black active:scale-95 transition-all duration-150"
          aria-label={t.chat.pastChats}
        >
          <FontAwesomeIcon icon={faClockRotateLeft} className="text-sm" />
        </button>
      </div>

      {/* Chat area — centered on desktop */}
      <div className="flex flex-1 overflow-hidden justify-center">
        <div className="flex flex-1 flex-col w-full max-w-3xl overflow-hidden">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <p className="text-2xl font-semibold text-gray-800">{t.appName}</p>
              <p className="text-sm text-gray-400">{t.chat.startNewChat}</p>
            </div>
          ) : (
            <ChatWindow messages={messages} />
          )}

          {/* Input */}
          <div className="px-4 pb-4 pt-2">
            <ChatInput onSend={handleSend} disabled={isStreaming} />
          </div>
        </div>
      </div>

      <RightPanel currentProvider={provider} currentModel={model} />
    </div>
  );
}
