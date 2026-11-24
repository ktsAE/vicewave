// One system media session follows whichever source owns the speakers.
export function connectMediaControls({ play, pause, stop, skip, seek }) {
  const session = navigator.mediaSession;
  if (!session) return () => {};
  function bind(action, handler) {
    try { session.setActionHandler(action, handler); } catch {}
  }
  bind('play', play);
  bind('pause', pause);
  bind('stop', stop);
  bind('nexttrack', () => skip(1));
  bind('previoustrack', () => skip(-1));
  let previousMetadata, previousMode;
  return ({ title, artist, album, artwork, playing, episode }) => {
    const metadata = { title, artist, album, artwork: artwork ? [{ src: new URL(artwork, document.baseURI).href }] : [] };
    const key = JSON.stringify(metadata);
    if (key !== previousMetadata && typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata(metadata);
      previousMetadata = key;
    }
    session.playbackState = playing ? 'playing' : 'paused';
    const mode = episode ? 'episode' : 'radio';
    if (mode !== previousMode) {
      bind('seekto', episode ? (event) => seek(event.seekTime, false) : null);
      bind('seekbackward', episode ? (event) => seek(-(event.seekOffset || 10), true) : null);
      bind('seekforward', episode ? (event) => seek(event.seekOffset || 10, true) : null);
      previousMode = mode;
    }
    try {
      if (episode) {
        const { audio, item } = episode;
        const position = Math.min(item.duration, Math.max(0, audio.currentTime - item.startSeconds));
        session.setPositionState({ duration: item.duration, position, playbackRate: audio.playbackRate });
      } else {
        session.setPositionState({ duration: Infinity, position: 0, playbackRate: 1 });
      }
    } catch {
      // Clear an episode’s timeline when this browser cannot represent a live stream.
      if (!episode) session.setPositionState?.();
    }
  };
}
