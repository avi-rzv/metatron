type Listener = (message: string) => void;

const listeners: Listener[] = [];

export function showToast(message: string) {
  listeners.forEach((l) => l(message));
}

export function subscribeToast(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx > -1) listeners.splice(idx, 1);
  };
}
