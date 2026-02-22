import { useEffect, useRef } from 'react';
import { ChatMessage, StreamingMessage } from './ChatMessage';
import { useChatStore } from '@/store/chatStore';
import type { Message } from '@/types';

interface ChatWindowProps {
  messages: Message[];
}

export function ChatWindow({ messages }: ChatWindowProps) {
  const { isStreaming, streamingContent } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

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

      {isStreaming && <StreamingMessage content={streamingContent} />}

      <div ref={bottomRef} />
    </div>
  );
}
