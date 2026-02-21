import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faCheck } from '@fortawesome/free-solid-svg-icons';
import type { Message } from '@/types';
import { t } from '@/i18n';

interface ChatMessageProps {
  message: Message;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 transition-colors duration-150"
      aria-label={t.chat.copy}
    >
      <FontAwesomeIcon icon={copied ? faCheck : faCopy} className="text-[11px]" />
      <span>{copied ? t.chat.copied : t.chat.copy}</span>
    </button>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="group flex justify-end px-4 py-1 animate-fade-in">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-tr-sm bg-gray-100 px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
          <div className="mt-1 flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <CopyButton text={message.content} />
            <span className="text-[11px] text-gray-400">{formatTime(message.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start px-4 py-1 animate-fade-in">
      <div className="max-w-[80%] w-full">
        <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className ?? '');
                const isBlock = match !== null;
                return isBlock ? (
                  <SyntaxHighlighter
                    style={oneLight as Record<string, React.CSSProperties>}
                    language={match[1]}
                    PreTag="div"
                    className="!rounded-xl !text-xs !my-2"
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-4 border-gray-200 pl-3 text-gray-500 italic my-2">
                    {children}
                  </blockquote>
                );
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 underline hover:text-blue-700"
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <CopyButton text={message.content} />
          <span className="text-[11px] text-gray-400">{formatTime(message.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

export function StreamingMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-start px-4 py-1 animate-fade-in">
      <div className="max-w-[80%] w-full">
        <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
          {content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <span className="inline-flex items-center gap-1 text-gray-400 text-sm">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
