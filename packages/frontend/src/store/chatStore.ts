import { create } from 'zustand';
import type { Chat, Message, Citation, Media } from '../types';

interface StreamingMedia {
  mediaId: string;
  filename: string;
  prompt: string;
  model: string;
}

interface StreamingState {
  isStreaming: boolean;
  streamingContent: string;
  streamingMessageId: string | null;
}

interface ChatState extends StreamingState {
  activeChatId: string | null;
  streamingCitations: Citation[];
  streamingMedia: StreamingMedia[];
  setActiveChatId: (id: string | null) => void;
  setStreaming: (s: StreamingState) => void;
  appendStreamChunk: (text: string) => void;
  setStreamingCitations: (citations: Citation[]) => void;
  addStreamingMedia: (media: StreamingMedia) => void;
  stopStreaming: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: null,
  isStreaming: false,
  streamingContent: '',
  streamingMessageId: null,
  streamingCitations: [],
  streamingMedia: [],

  setActiveChatId: (id) => set({ activeChatId: id }),

  setStreaming: (s) => set(s),

  appendStreamChunk: (text) =>
    set((state) => ({ streamingContent: state.streamingContent + text })),

  setStreamingCitations: (citations) => set({ streamingCitations: citations }),

  addStreamingMedia: (media) =>
    set((state) => ({ streamingMedia: [...state.streamingMedia, media] })),

  stopStreaming: () =>
    set({
      isStreaming: false,
      streamingContent: '',
      streamingMessageId: null,
      streamingCitations: [],
      streamingMedia: [],
    }),
}));
