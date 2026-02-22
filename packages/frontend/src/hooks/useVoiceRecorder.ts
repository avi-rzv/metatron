import { useState, useRef, useCallback, useEffect } from 'react';

function getPreferredMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return 'audio/webm';
}

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
    setDuration(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const startRecording = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeType = getPreferredMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = chunksRef.current.length > 0
        ? new Blob(chunksRef.current, { type: mimeType.split(';')[0] })
        : null;
      cleanup();
      resolveRef.current?.(blob);
      resolveRef.current = null;
    };

    recorder.start();
    setIsRecording(true);
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((d) => d + 1);
    }, 1000);
  }, [cleanup]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
        cleanup();
        resolve(null);
        return;
      }
      resolveRef.current = resolve;
      mediaRecorderRef.current.stop();
    });
  }, [cleanup]);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      // Clear chunks before stopping so onstop produces null
      chunksRef.current = [];
      mediaRecorderRef.current.stop();
    } else {
      cleanup();
    }
    resolveRef.current?.(null);
    resolveRef.current = null;
  }, [cleanup]);

  return { isRecording, duration, startRecording, stopRecording, cancelRecording };
}
