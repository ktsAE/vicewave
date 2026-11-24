import { norm, esc, icon, el, outside } from './ui.js';
import { cover } from './dial.js';
import { genre } from './stations.js';
export function catalogView(
  { catalog, media, programs, broadcasts, chapters, nativeTracks, captures, gameRecordings },
  actions,
) {
  const songKey = (s, t, a) => [s, norm(t), norm(a)].join('|');
  const songMap = new Map(media.songs.map((x) => [songKey(x.stationId, x.title, x.artist), x]));
  function createRows() {
    const all = [];
    for (const s of catalog.stations) {
      for (const r of s.tracks) {
        const matched = songMap.get(songKey(s.id, r.title, r.artist));
        all.push({
          ...r,
          ...matched,
          kind: 'track',
          stationId: s.id,
          stationName: s.name,
          source: r.source || s.source || catalog.source,
        });
      }
      for (const p of s.programs) {
        if (programs.some((x) => x.kind === 'show' && x.station === s.name && norm(x.title) === norm(p.name)))
          continue;
        all.push({
          kind: 'program',
          title: p.name,
          artist: p.hosts?.join(', '),
          stationId: s.id,
          stationName: s.name,
          source: p.placementSource || catalog.source,
        });
      }
      for (const x of s.imaging || []) {
        all.push({
          kind: 'program',
          title: x.title || x.name || x.role || 'Station imaging',
          artist: (x.credits || [])
            .map((c) => c.names?.join(', '))
            .filter(Boolean)
            .join(' · '),
          stationId: s.id,
          stationName: s.name,
          source: catalog.source,
        });
      }
    }
    for (const p of programs) {
      const s = catalog.stations.find((s) => s.name === p.station);
      all.push({
        ...p,
        stationId: s?.id,
        stationName: p.station || (p.kind === 'ad' ? 'Ad archive' : 'On demand'),
        artist:
          p.kind === 'podcast'
            ? [p.series, p.episodeLabel].filter(Boolean).join(' · ')
            : p.kind === 'ad'
              ? p.spotCount > 1
                ? p.spotCount + ' ad variants'
                : 'Commercial'
              : p.note,
      });
    }
    for (const x of catalog.adSamples || [])
      all.push({ ...x, kind: 'sample', stationName: 'Ad music credit', source: catalog.source });
    for (const x of catalog.unverifiedPlacements || [])
      all.push({
        ...x,
        kind: 'reported',
        stationName: catalog.stations.find((s) => s.id === x.stationId)?.name,
      });
    return all;
  }
  const categories = {
    Tracks: ['track'],
    Commercials: ['ad', 'sample'],
    Shows: ['show', 'program', 'podcast'],
    Reported: ['reported'],
  };
  const rows = createRows(),
    options = Object.keys(categories);
  let tab = 'Tracks',
    scope = '',
    limit = 60,
    matches = [];
  const select = el('station-select');
  select.innerHTML =
    '<option value="">All stations</option>' +
    catalog.stations.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('');
  function render() {
    const q = norm(el('search').value);
    matches = rows.filter(
      (x) =>
        categories[tab].includes(x.kind) &&
        (!scope || x.stationId === scope) &&
        (!q || norm([x.title, x.artist, x.stationName, x.program, x.note].join(' ')).includes(q)),
    );
    el('count').textContent = matches.length + ' ' + (matches.length === 1 ? 'entry' : 'entries');
    el('filters').innerHTML = options
      .map(
        (k) =>
          '<button aria-pressed="' +
          (tab === k) +
          '" class="' +
          (tab === k ? 'active' : '') +
          '" data-tab="' +
          k +
          '">' +
          k +
          '</button>',
      )
      .join('');
    el('results').innerHTML =
      matches
        .slice(0, limit)
        .map(
          (x, i) =>
            '<button class="entry" data-result="' +
            i +
            '"><div><strong>' +
            esc(x.title) +
            '</strong><small>' +
            esc(x.artist || x.program || x.placementStatus || '') +
            '</small></div><em>' +
            esc(x.stationName) +
            '</em>' +
            icon('chevron') +
            '</button>',
        )
        .join('') || '<p>No entries match this search.</p>';
    el('more').hidden = matches.length <= limit;
    renderStation();
  }
  function renderStation() {
    const s = catalog.stations.find((x) => x.id === scope) || actions.selected();
    const lists = media.playlists.filter((x) => x.stationId === s.id);
    const fan = lists.find((x) => !x.official),
      short = lists.find((x) => x.official);
    const spotify = (x, label, cls) =>
      x
        ? '<a class="' +
          cls +
          '" href="' +
          esc(x.url) +
          '" target="_blank" rel="noopener">' +
          label +
          ' ' +
          icon('link') +
          '</a>'
        : '';
    const feed = broadcasts.find((x) => x.stationId === s.id);
    const separate = nativeTracks.filter((x) => x.stationId === s.id);
    const reconstruction = captures.find((x) => x.stationId === s.id);
    el('station-card').innerHTML =
      '<div class="cover">' +
      cover(s) +
      '</div><h2>' +
      esc(s.name) +
      '</h2><p>' +
      esc(genre(s)) +
      ' · ' +
      s.tracks.length +
      ' track credits</p>' +
      (lists.length
        ? '<div class="links">' +
          spotify(fan || short, 'Open playlist on Spotify', 'spotify') +
          (fan && short ? spotify(short, 'Spotify selection', '') : '') +
          '</div><p>Use + in Spotify to save the playlist.</p>'
        : '') +
      '<details class="local"><summary>Broadcast sources</summary><p>' +
      esc(s.hosts.join(' · ')) +
      '</p><div class="links">' +
      outside(s.source || catalog.source, 'Station credits') +
      outside(feed?.source, 'Station mix') +
      (gameRecordings.tracks.some((x) => x.stations.includes(s.id))
        ? outside(gameRecordings.source, 'Individual game recordings')
        : '') +
      outside(chapters[s.id]?.source, 'Chapter timings') +
      outside(reconstruction?.source, 'Station reconstruction') +
      separate.map((x) => outside(x.source, x.title)).join('') +
      outside(media.promos.find((x) => x.stationId === s.id)?.sourceUrl, 'Rockstar preview') +
      outside(programs.find((x) => x.station === s.name && x.audioUrl)?.source, 'Recorded broadcast') +
      '</div></details>';
  }
  function selectedForGuide() {
    return catalog.stations.find((s) => s.id === scope) || actions.selected();
  }
  function details(x) {
    el('detail-kind').textContent = x.kind === 'ad' ? 'COMMERCIAL' : x.kind.toUpperCase();
    el('detail-title').textContent = x.title;
    const parts = [x.artist, x.stationName, x.program, x.placementStatus, x.note].filter(
      (v, i, a) => v && a.indexOf(v) === i,
    );
    el('detail-content').innerHTML =
      parts.map((v) => '<p>' + esc(v) + '</p>').join('') +
      '<div class="links">' +
      outside(x.spotifyUrl, 'Spotify') +
      outside(x.appleMusicUrl, 'Apple Music') +
      outside(x.youtubeUrl, 'YouTube') +
      outside(x.source || catalog.source, 'Source') +
      '</div>' +
      (x.kind === 'track'
        ? '<button class="plain-btn" id="import-track">Add my recording of this track</button>'
        : '');
    if (x.kind === 'track') el('import-track').onclick = () => actions.import(x.stationId, x);
    if (['show', 'podcast'].includes(x.kind) && x.endSeconds > x.startSeconds) {
      const button = document.createElement('button');
      button.className = 'plain-btn';
      button.textContent = 'Listen on demand';
      button.onclick = () => actions.listen(x.id || norm(x.title).replaceAll(' ', '-'));
      el('detail-content').append(button);
    }
    el('details').showModal();
  }
  el('filters').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) {
      tab = b.dataset.tab;
      limit = 60;
      render();
    }
  };
  el('results').onclick = (e) => {
    const b = e.target.closest('[data-result]');
    if (b) details(matches[+b.dataset.result]);
  };
  el('search').oninput = () => {
    limit = 60;
    render();
  };
  select.onchange = () => {
    scope = select.value;
    limit = 60;
    render();
  };
  el('more').onclick = () => {
    limit += 75;
    render();
  };
  el('close').onclick = () => el('details').close();
  el('capture-import').onclick = () => actions.import(selectedForGuide().id);
  return {
    open(stationId = '') {
      scope = stationId;
      tab = 'Tracks';
      limit = 60;
      el('search').value = '';
      select.value = scope;
      render();
    },
    renderStation,
  };
}
