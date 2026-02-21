import { create } from 'zustand';
import type { Chat, Message } from '../types';

interface StreamingState {
  isStreaming: boolean;
  streamingContent: string;
  streamingMessageId: string | null;
}

interface ChatState extends StreamingState {
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  setStreaming: (s: StreamingState) => void;
  appendStreamChunk: (text: string) => void;
  stopStreaming: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: null,
  isStreaming: false,
  streamingContent: '',
  streamingMessageId: null,

  setActiveChatId: (id) => set({ activeChatId: id }),

  setStreaming: (s) => set(s),

  appendStreamChunk: (text) =>
    set((state) => ({ streamingContent: state.streamingContent + text })),

  stopStreaming: () =>
    set({ isStreaming: false, streamingContent: '', streamingMessageId: null }),
}));
