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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  return (
    <div className="flex-1 overflow-y-auto py-4 space-y-2">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}

      {isStreaming && <StreamingMessage content={streamingContent} />}

      <div ref={bottomRef} />
    </div>
  );
}
