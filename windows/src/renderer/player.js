'use strict';

/**
 * Fallback music backend: YouTube's IFrame player in a hidden window.
 *
 * Only used when mpv and yt-dlp are not on PATH. It needs nothing installed,
 * but it is an ordinary embedded player, so ads play without Premium.
 */

let player = null;
let queue = [];
let pendingVolume = 45;
let ready = false;

function videoId(url) {
  const m =
    url.match(/[?&]v=([\w-]{6,})/) ||
    url.match(/youtu\.be\/([\w-]{6,})/) ||
    url.match(/\/(?:embed|live|shorts)\/([\w-]{6,})/);
  return m ? m[1] : null;
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function report() {
  if (!player || !ready) return;
  let title = '';
  try {
    title = player.getVideoData?.().title || '';
  } catch {
    /* not loaded yet */
  }
  let playing = false;
  try {
    playing = player.getPlayerState?.() === 1;
  } catch {
    /* ditto */
  }
  window.notchApi.playerState({ title, playing });
}

function build(ids) {
  if (!window.YT || !window.YT.Player) return;
  if (player) {
    player.loadPlaylist({ playlist: ids });
    player.setVolume(pendingVolume);
    return;
  }
  player = new window.YT.Player('yt', {
    height: '240',
    width: '320',
    playerVars: { autoplay: 1, controls: 0, playsinline: 1, loop: 1 },
    events: {
      onReady: (e) => {
        ready = true;
        e.target.loadPlaylist({ playlist: ids });
        e.target.setVolume(pendingVolume);
        e.target.playVideo();
        setInterval(report, 4000);
      },
      onStateChange: report,
      onError: (e) => console.warn('focusnotch: youtube player error', e.data),
    },
  });
}

window.onYouTubeIframeAPIReady = () => {
  if (queue.length) build(queue);
};

window.notchApi.onPlayer(({ cmd, args }) => {
  switch (cmd) {
    case 'load': {
      const ids = shuffle((args.tracks || []).map((t) => videoId(t.url)).filter(Boolean));
      pendingVolume = args.volume ?? 45;
      queue = ids;
      if (!ids.length) return;
      if (window.YT && window.YT.Player) build(ids);
      break;
    }
    case 'play':
      player?.playVideo?.();
      break;
    case 'pause':
      player?.pauseVideo?.();
      break;
    case 'stop':
      try {
        player?.stopVideo?.();
      } catch {}
      window.notchApi.playerState({ playing: false, title: '' });
      break;
    case 'volume':
      pendingVolume = args.volume ?? pendingVolume;
      player?.setVolume?.(pendingVolume);
      break;
    default:
      break;
  }
});

// The IFrame API has to come from YouTube; nothing else is loaded remotely.
const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.append(tag);
