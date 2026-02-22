import { useState, useRef, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons';

interface AudioPlayerProps {
  src: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ src }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => setDuration(audio.duration);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }, [duration]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 w-64">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={togglePlay}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white hover:bg-gray-800 active:scale-95 transition-all duration-150"
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        <FontAwesomeIcon icon={isPlaying ? faPause : faPlay} className="text-xs" />
      </button>
      <div className="flex flex-1 flex-col gap-1">
        <div
          ref={progressRef}
          className="relative h-1 w-full cursor-pointer rounded-full bg-gray-200"
          onClick={handleSeek}
        >
          <div
            className="absolute top-0 left-0 h-full rounded-full bg-black transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-400 tabular-nums">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
}
