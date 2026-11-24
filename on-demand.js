import { el, esc, norm, read, save } from './ui.js';

const slug = (value) => norm(value).replaceAll(' ', '-');
const stamp = (seconds) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');

export function onDemandItems(programs, runtime) {
  return programs
    .filter((p) => ['podcast', 'show'].includes(p.kind) && p.audioUrl && p.endSeconds > p.startSeconds)
    .map((p) => ({
      ...p,
      id: p.id || slug(p.title),
      duration: p.endSeconds - p.startSeconds,
      url: p.kind === 'podcast'
        ? runtime.podcasts.includes(p.id) ? p.audioUrl : p.source
        : runtime.proxy ? '/signal/talk/' + slug(p.station) : p.audioUrl,
    }));
}

export function savedPosition(item) {
  let value = read('episode:' + item.id, null);
  if (value === null && item.previousEnd !== undefined) {
    // Older versions saved one position per show, sometimes in a two-episode video.
    const previous = Number(read('episode:' + slug(item.series), 0));
    if (previous > 1 && previous >= item.previousStart && previous < item.previousEnd) {
      value = previous - item.previousStart;
      save('episode:' + item.id, value);
    }
  }
  return Number.isFinite(value) && value > 1 && value < item.duration - 2 ? value : 0;
}

export function onDemandView(programs, { runtime, takeOver, release }) {
  const items = onDemandItems(programs, runtime);
  const podcasts = items.filter((item) => item.kind === 'podcast');
  const series = [...new Set(podcasts.map((item) => item.series))];
  let active = null;

  function episodeRow(item) {
    const label = item.kind === 'show' ? item.station + ' · ' + item.episodeLabel : item.episodeLabel;
    return (
      '<button type="button" class="episode-row" data-episode="' +
      esc(item.id) +
      '" aria-pressed="false"><span><strong>' +
      esc(item.title) +
      '</strong>' +
      (label ? '<small>' + esc(label) + '</small>' : '') +
      '</span><span class="episode-length"></span></button>'
    );
  }
  el('podcasts').innerHTML = series
    .map((name) => {
      const episodes = podcasts.filter((item) => item.series === name);
      return (
        '<details class="podcast-series"><summary><strong>' +
        esc(name) +
        '</strong><span>' +
        episodes.length +
        ' episodes</span></summary>' +
        episodes.map(episodeRow).join('') +
        '</details>'
      );
    })
    .join('');
  el('specials').innerHTML = items
    .filter((item) => item.kind === 'show')
    .map(episodeRow)
    .join('');
  el('podcast-count').textContent = podcasts.length + ' episodes across ' + series.length + ' series';
  const buttons = new Map(
    [...el('demand-view').querySelectorAll('[data-episode]')].map((b) => [b.dataset.episode, b]),
  );
  function updateRow(item) {
    const button = buttons.get(item.id);
    const selected = active?.item === item;
    button.setAttribute('aria-pressed', String(selected));
    const pos = savedPosition(item);
    button.querySelector('.episode-length').textContent = selected
      ? 'Selected'
      : pos
        ? 'Resume at ' + stamp(pos)
        : stamp(item.duration);
  }

  function position(s) {
    return Math.max(0, Math.min(s.item.duration, s.audio.currentTime - s.item.startSeconds));
  }
  function remember(s, force = false) {
    if (!s.played) return;
    const n = position(s);
    if (!Number.isFinite(n) || (!force && Math.abs(n - s.saved) < 3)) return;
    save('episode:' + s.item.id, n);
    s.saved = n;
  }
  function stop(completed = false) {
    const s = active;
    if (!s) return;
    active = null;
    if (completed) save('episode:' + s.item.id, 0);
    else remember(s, true);
    clearTimeout(s.deadline);
    s.audio.pause();
    s.audio.removeAttribute('src');
    s.audio.load();
    el('episode-panel').hidden = true;
    updateRow(s.item);
  }
  function finish(s) {
    if (active !== s) return;
    stop(true);
    release();
  }
  function status(s, text) {
    if (active === s) el('episode-status').textContent = text;
  }
  function progress(s) {
    if (active !== s || !s.played) return;
    if (position(s) >= s.item.duration - 0.06) finish(s);
    else remember(s);
  }
  function listen(id) {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    stop();
    const pos = savedPosition(item);
    const a = new Audio();
    const s = (active = { item, audio: a, saved: pos, played: false });
    takeOver();
    updateRow(item);
    const group = buttons.get(id).closest('details');
    if (group) group.open = true;
    el('episode-panel').hidden = false;
    el('episode-title').textContent = item.title;
    el('episode-title').focus({ preventScroll: true });
    el('episode-kind').textContent =
      item.kind === 'show'
        ? item.station + ' · Recorded excerpt'
        : [item.series, item.episodeLabel].filter(Boolean).join(' · ');
    el('episode-source').href = item.source;
    el('episode-source').textContent = 'Recording source';
    status(s, 'Loading recording…');
    a.preload = 'auto';
    const start = item.startSeconds + pos;
    a.addEventListener('loadedmetadata', () => {
      if (active === s && Math.abs(a.currentTime - start) > 0.2) a.currentTime = start;
    });
    a.addEventListener('playing', () => {
      if (active !== s) return;
      s.played = true;
      status(
        s,
        item.kind === 'podcast' ? 'Listening to the podcast.' : 'Listening to the recorded broadcast.',
      );
      clearTimeout(s.deadline);
      s.deadline = setTimeout(() => progress(s), Math.max(0, item.endSeconds - a.currentTime) * 1000);
    });
    a.addEventListener('waiting', () => {
      clearTimeout(s.deadline);
      status(s, 'Buffering the recording…');
    });
    a.addEventListener('timeupdate', () => progress(s));
    a.addEventListener('pause', () => progress(s));
    a.addEventListener('ended', () => finish(s));
    a.addEventListener('error', () =>
      status(s, 'The recording could not load. Select it again to retry, or open its source.'),
    );
    a.src = item.kind === 'show' ? item.url + '#t=' + start + ',' + item.endSeconds : item.url;
    a.play().catch((error) => {
      if (error.name !== 'AbortError') status(s, 'Select the recording again to listen, or open its source.');
    });
    el('episode-panel').scrollIntoView({ block: 'nearest' });
  }
  for (const id of ['podcasts', 'specials'])
    el(id).onclick = (e) => {
      const button = e.target.closest('[data-episode]');
      if (button) listen(button.dataset.episode);
    };
  window.addEventListener('pagehide', () => stop());
  items.forEach(updateRow);
  return {
    listen,
    stop,
    get active() {
      return Boolean(active);
    },
  };
}
