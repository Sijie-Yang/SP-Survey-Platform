import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

export const HERO_VIDEO_SRC = '/hero/streetscape-loop.mp4';
export const HERO_POSTER_SRC = '/hero/streetscape-poster.jpg';

/**
 * Full-bleed streetscape atmosphere: muted looping video + Ken Burns fallback.
 * Ken Burns runs on the poster layer so the background still moves if autoplay is blocked.
 */
export default function StreetscapeAtmosphere({
  overlay,
  showKenBurns = true,
  zIndex = 0,
}) {
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return undefined;

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    let cancelled = false;
    const tryPlay = () => {
      if (cancelled || !video) return;
      video.muted = true;
      video.volume = 0;
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          if (!cancelled) setPlaying(true);
        }).catch(() => {
          const retry = () => {
            if (cancelled || !video) return;
            video.muted = true;
            video.volume = 0;
            video.play()
              .then(() => { if (!cancelled) setPlaying(true); })
              .catch(() => {});
          };
          video.addEventListener('canplay', retry, { once: true });
          setTimeout(retry, 400);
        });
      }
    };

    tryPlay();
    video.addEventListener('loadeddata', tryPlay);
    video.addEventListener('playing', () => { if (!cancelled) setPlaying(true); });
    const onVis = () => {
      if (document.visibilityState === 'visible') tryPlay();
    };
    const onPointer = () => tryPlay();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointerdown', onPointer, { once: true, passive: true });
    // Second chance after route transitions (client navigate from / → /login).
    const boot = setTimeout(tryPlay, 120);

    return () => {
      cancelled = true;
      clearTimeout(boot);
      video.removeEventListener('loadeddata', tryPlay);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [failed]);

  const mediaStyle = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };

  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        bgcolor: '#0b1210',
        zIndex,
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          background: overlay || [
            'linear-gradient(180deg, rgba(8,14,12,0.55) 0%, rgba(8,14,12,0.35) 42%, rgba(8,14,12,0.72) 100%)',
            'radial-gradient(120% 80% at 50% 20%, rgba(20,40,32,0.15) 0%, rgba(8,14,12,0.55) 70%)',
          ].join(', '),
          pointerEvents: 'none',
        },
      }}
    >
      {/* Poster always present; Ken Burns keeps motion even when video is blocked. */}
      <img
        src={HERO_POSTER_SRC}
        alt=""
        className={showKenBurns ? 'sp-landing-hero-video' : undefined}
        style={{
          ...mediaStyle,
          zIndex: 0,
          opacity: playing && !failed ? 0 : 1,
          transition: 'opacity 0.6s ease',
        }}
      />
      {!failed && (
        <video
          ref={videoRef}
          className={showKenBurns ? 'sp-landing-hero-video' : undefined}
          src={HERO_VIDEO_SRC}
          poster={HERO_POSTER_SRC}
          muted
          defaultMuted
          playsInline
          autoPlay
          loop
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          onError={() => setFailed(true)}
          style={{
            ...mediaStyle,
            zIndex: 1,
            opacity: playing ? 1 : 0,
            transition: 'opacity 0.6s ease',
          }}
        />
      )}
    </Box>
  );
}
