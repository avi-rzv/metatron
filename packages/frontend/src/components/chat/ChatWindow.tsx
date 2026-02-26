import { useEffect, useRef } from 'react';
import { ChatMessage, StreamingMessage } from './ChatMessage';
import { useChatStore } from '@/store/chatStore';
import type { Message } from '@/types';

interface ChatWindowProps {
  messages: Message[];
}

export function ChatWindow({ messages }: ChatWindowProps) {
  const { isStreaming, streamingContent, streamingCitations, streamingMedia } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(messages.length);

  // Smooth-scroll to bottom when a new message is added (user sends)
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  // Keep pinned to bottom during streaming (instant to avoid lag)
  useEffect(() => {
    if (isStreaming) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [isStreaming, streamingContent]);

  return (
    <div className="py-4 space-y-2">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}

      {isStreaming && (
        <StreamingMessage
          content={streamingContent}
          citations={streamingCitations}
          streamingMedia={streamingMedia}
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
