import { useEffect, useRef, useState } from 'react';
import { S } from '../strings';

// The Abaseria intro video, played once each time the app is freshly opened (not when switching back to it).
// The app loads underneath while it plays. A tap anywhere skips it. If the video can't play, the app shows at once.

const SEEN_KEY = 'launchSeen';
const VIDEO_SECONDS = 5;
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

export function LaunchScreen() {
  const [state, setState] = useState<'playing' | 'fading' | 'done'>(() => (alreadySeen() ? 'done' : 'playing'));
  const video = useRef<HTMLVideoElement>(null);

  function finish() {
    setState((s) => (s === 'playing' ? 'fading' : s));
  }

  useEffect(() => {
    if (state === 'playing') {
      markSeen();
      const v = video.current;
      if (v && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // No animation: show the finished logo frame briefly, then go.
        v.pause();
        v.currentTime = VIDEO_SECONDS - 0.1;
        const t = setTimeout(finish, 1200);
        return () => clearTimeout(t);
      }
      // Safety net if autoplay is blocked or the video stalls.
      const t = setTimeout(finish, (VIDEO_SECONDS + 2) * 1000);
      return () => clearTimeout(t);
    }
    if (state === 'fading') {
      const t = setTimeout(() => setState('done'), FADE_MS);
      return () => clearTimeout(t);
    }
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
      <video
        ref={video}
        src={`${import.meta.env.BASE_URL}launch.mp4`}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
      />
    </div>
  );
}
