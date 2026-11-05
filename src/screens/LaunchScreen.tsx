import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';

// The Abaseria intro video, played once each time the app is freshly opened (not when switching back to it).
// The app loads underneath while it plays. A tap anywhere skips it. If the video can't play, the app shows at once.

const SEEN_KEY = 'launchSeen';
const VIDEO_URL = `${import.meta.env.BASE_URL}launch.mp4`;
const VIDEO_SECONDS = 5;
// The video's first 1.2 s are blank white; start where the logo begins drawing in.
const START_SECONDS = 1.2;
const FADE_MS = 250;

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode or storage blocked: the intro may play again on reload, which is harmless.
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function LaunchScreen() {
  const [state, setState] = useState<'playing' | 'fading' | 'done'>(() => (alreadySeen() ? 'done' : 'playing'));
  // The video is loaded into memory first. The offline cache serves it whole (no byte ranges), and Chrome
  // won't jump into a video served that way, so a memory copy is what lets it start at START_SECONDS.
  const [src, setSrc] = useState<string | null>(null);
  const still = useRef(reducedMotion());

  function finish() {
    setState((s) => (s === 'playing' ? 'fading' : s));
  }

  useEffect(() => {
    if (state !== 'playing') return;
    markSeen();
    let url: string | null = null;
    let cancelled = false;
    fetch(VIDEO_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`launch video ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(finish);
    // Safety net if loading or autoplay stalls; with reduced motion, the still frame shows for about a second.
    const t = setTimeout(finish, still.current ? 1500 : (VIDEO_SECONDS - START_SECONDS + 3) * 1000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [state === 'playing']); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state !== 'fading') return;
    const t = setTimeout(() => setState('done'), FADE_MS);
    return () => clearTimeout(t);
  }, [state]);

  if (state === 'done') return null;

  return (
    <div
      className={`launch ${state === 'fading' ? 'out' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={S.launch.skip}
      onClick={finish}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && finish()}
    >
      {src && (
        <video
          src={src}
          autoPlay={!still.current}
          muted
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (still.current) {
              // No animation: show the finished logo frame.
              v.pause();
              v.currentTime = VIDEO_SECONDS - 0.1;
            } else if (v.currentTime < START_SECONDS) {
              v.currentTime = START_SECONDS;
            }
          }}
          onEnded={finish}
          onError={finish}
        />
      )}
    </div>
  );
}
