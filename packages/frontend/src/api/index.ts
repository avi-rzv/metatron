import type { Chat, AppSettings, Message } from '../types';

const BASE = '/api';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// --- Chats ---
export const api = {
  chats: {
    list: () => request<Chat[]>('/chats'),
    get: (id: string) => request<Chat & { messages: Message[] }>(`/chats/${id}`),
    create: (data: { provider: string; model: string; title?: string }) =>
      request<Chat>('/chats', { method: 'POST', body: JSON.stringify(data) }),
    patch: (id: string, data: { title: string }) =>
      request<Chat>(`/chats/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) =>
      fetch(`${BASE}/chats/${id}`, { method: 'DELETE' }),
  },

  settings: {
    get: () => request<AppSettings>('/settings'),
    update: (data: Partial<AppSettings>) =>
      request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },
};

// SSE streaming
export function streamMessage(
  chatId: string,
  content: string,
  options: { provider: string; model: string },
  callbacks: {
    onStart?: (data: { messageId: string; userMessageId: string }) => void;
    onChunk: (text: string) => void;
    onDone?: (data: { messageId: string }) => void;
    onError?: (message: string) => void;
  }
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/chats/${chatId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, provider: options.provider, model: options.model }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      callbacks.onError?.('Failed to connect to stream');
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (eventType === 'start') callbacks.onStart?.(data);
          else if (eventType === 'chunk') callbacks.onChunk(data.text);
          else if (eventType === 'done') callbacks.onDone?.(data);
          else if (eventType === 'error') callbacks.onError?.(data.message);
          eventType = '';
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      callbacks.onError?.(err.message);
    }
  });

  return controller;
}
