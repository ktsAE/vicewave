import { el, esc, norm, read, save } from './ui.js';
import { dial } from './dial.js';

const slug = (value) => norm(value).replaceAll(' ', '-');
const stamp = (seconds) => Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');

export function onDemandItems(programs, runtime, acceptsOpus = true) {
  return programs
    .filter((p) => ['podcast', 'show'].includes(p.kind) && p.audioUrl && p.endSeconds > p.startSeconds)
    .map((p) => {
      const item = { ...p, id: p.id || slug(p.title), duration: p.endSeconds - p.startSeconds };
      if (p.kind === 'show') {
        item.url = runtime.proxy ? '/signal/talk/' + slug(p.station) : p.audioUrl;
      } else {
        const mp3 = runtime.podcasts.includes(p.id) ? p.audioUrl : null;
        item.url = mp3 || p.source;
        if (acceptsOpus && runtime.opusPodcasts?.includes(p.id)) {
          item.url = 'assets/podcasts/' + p.id + '.ogg';
          item.fallback = mp3;
        }
      }
      return item;
    });
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

export function onDemandView(programs, { runtime, stations, acceptsOpus, takeOver, release, changed }) {
  const items = onDemandItems(programs, runtime, acceptsOpus);
  const collections = [];
  for (const item of items) {
    const name = item.series || item.station;
    let group = collections.find((g) => g.name === name);
    if (!group) {
      const podcast = item.kind === 'podcast';
      const id = slug(name);
      group = {
        id, name, kind: podcast ? 'Podcast' : 'Talk radio', episodes: [],
        artwork: podcast ? 'assets/shows/' + id + '.webp' : stations.find((s) => s.name === name)?.artwork,
      };
      collections.push(group);
    }
    group.episodes.push(item);
  }
  collections.sort((a, b) => Number(b.kind === 'Podcast') - Number(a.kind === 'Podcast'));
  const specials = { id: 'special-stations', name: 'Special Stations', kind: 'Live radio',
    artwork: 'assets/shows/special-stations.webp', stations: stations.filter((s) => s.unlockable || s.local) };
  collections.push(specials);
  let browsing = Math.max(0, collections.findIndex((c) => c.id === read('show-collection', 'drunk-kings')));
  let active = null;
  const buttons = new Map();
  for (const item of items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'episode-row';
    row.dataset.episode = item.id;
    const label = item.episodeLabel;
    row.innerHTML = '<span><strong>' + esc(item.title) + '</strong>' +
      (label ? '<small>' + esc(label) + '</small>' : '') + '</span><span class="episode-length"></span>';
    buttons.set(item.id, row);
    updateRow(item);
  }

  function display(index) {
    browsing = index;
    const group = collections[index];
    const isLive = group === specials;
    el('series-title').textContent = group.name;
    el('series-title').classList.toggle('long', group.name.length > 16);
    el('series-kind').textContent = group.kind;
    el('series-count').textContent = isLive ? group.stations.length + ' stations' : group.episodes.length + ' episodes';
    el('series-number').textContent = (index + 1) + ' / ' + collections.length;
    el('collection-heading').textContent = isLive ? 'Tune live' : 'Episodes';
    el('special-stations').hidden = !isLive;
    el('episode-list').replaceChildren(...(group.episodes || []).map((item) => buttons.get(item.id)));
    save('show-collection', group.id);
  }
  const carousel = dial(el('demand-view'), collections, browsing, { change: display });
  display(browsing);

  function updateRow(item) {
    const button = buttons.get(item.id);
    const selected = active?.item === item;
    button.setAttribute('aria-pressed', String(selected));
    const pos = savedPosition(item);
    button.querySelector('.episode-length').textContent = selected
      ? active.paused ? 'Paused' : 'Selected'
      : pos ? 'Resume at ' + stamp(pos) : stamp(item.duration);
  }
  function position(s) {
    return Math.max(0, Math.min(s.item.duration, s.audio.currentTime - s.item.startSeconds));
  }
  function remember(s, force = false) {
    if (!s.played || s.audio.seeking || (s.audio.error && s.audio.currentTime === 0)) return;
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
    changed();
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
  function requestPlay(s) {
    s.paused = false;
    updateRow(s.item);
    changed();
    s.audio.play().catch((error) => {
      if (active !== s || error.name === 'AbortError') return;
      if ((error.name === 'NotSupportedError' || s.audio.error) && retryFallback(s)) return;
      s.paused = true;
      updateRow(s.item);
      status(s, 'Select the episode again to retry, or open its source.');
      changed();
    });
  }
  function retryFallback(s) {
    if (!s.fallback) return false;
    listen(s.item.id, s.paused, s.fallback);
    return true;
  }
  function listen(id, startPaused = false, fallbackUrl = null) {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    const index = collections.findIndex((g) => g.episodes?.includes(item));
    if (index !== browsing) carousel.jump(index);
    if (!fallbackUrl && active?.item === item && !active.audio.error) {
      if (active.paused) requestPlay(active);
      return;
    }
    stop();
    const pos = savedPosition(item);
    const a = new Audio();
    const s = (active = { item, group: collections[index], audio: a, saved: pos, played: false, paused: startPaused,
      fallback: fallbackUrl ? null : item.fallback });
    takeOver();
    el('episode-panel').hidden = false;
    el('episode-title').textContent = item.title;
    el('episode-kind').textContent = item.series || item.station;
    el('episode-source').href = item.source;
    el('episode-panel').classList.remove('live');
    status(s, 'Loading recording…');
    a.preload = startPaused ? 'metadata' : 'auto';
    const start = item.startSeconds + pos;
    a.addEventListener('loadedmetadata', () => {
      if (active === s && Math.abs(a.currentTime - start) > 0.2) a.currentTime = start;
    });
    a.addEventListener('playing', () => {
      if (active !== s || s.paused) return;
      s.played = true;
      el('episode-panel').classList.add('live');
      status(s, item.kind === 'podcast' ? 'Listening to the podcast.' : 'Listening to the recorded broadcast.');
      clearTimeout(s.deadline);
      s.deadline = setTimeout(() => progress(s), Math.max(0, item.endSeconds - a.currentTime) * 1000);
      changed();
    });
    a.addEventListener('waiting', () => {
      if (active !== s || s.paused) return;
      clearTimeout(s.deadline);
      el('episode-panel').classList.remove('live');
      status(s, 'Buffering the recording…');
    });
    a.addEventListener('timeupdate', () => progress(s));
    a.addEventListener('seeked', () => { if (active === s) changed(); });
    a.addEventListener('pause', () => {
      if (active === s && a.paused && !a.ended && !a.error) pause();
    });
    a.addEventListener('ended', () => finish(s));
    a.addEventListener('error', () => {
      if (active !== s || retryFallback(s)) return;
      pause();
      status(s, 'The recording could not load. Select it again to retry, or open its source.');
    });
    a.src = item.kind === 'show' ? item.url + '#t=' + start + ',' + item.endSeconds : fallbackUrl || item.url;
    if (startPaused) {
      status(s, 'Paused');
      updateRow(item);
      changed();
    } else requestPlay(s);
  }
  function pause() {
    const s = active;
    if (!s || s.paused) return;
    s.paused = true;
    clearTimeout(s.deadline);
    s.audio.pause();
    remember(s, true);
    updateRow(s.item);
    el('episode-panel').classList.remove('live');
    status(s, 'Paused');
    changed();
  }
  function resume() {
    if (active?.paused) listen(active.item.id);
  }
  function skip(direction) {
    if (!active) return;
    const episodes = active.group.episodes;
    listen(episodes[(episodes.indexOf(active.item) + direction + episodes.length) % episodes.length].id, active.paused);
  }
  el('episode-list').onclick = (e) => {
    const row = e.target.closest('[data-episode]');
    if (row) listen(row.dataset.episode);
  };
  window.addEventListener('pagehide', () => stop());
  return {
    listen, stop, pause, resume, skip, carousel,
    seek(seconds, relative) {
      const s = active;
      if (!s || !s.audio.readyState || !Number.isFinite(seconds)) return;
      const offset = relative ? position(s) + seconds : seconds;
      s.audio.currentTime = s.item.startSeconds + Math.max(0, Math.min(s.item.duration, offset));
    },
    get active() { return active; },
  };
}
