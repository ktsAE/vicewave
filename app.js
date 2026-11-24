import { el, decorate, esc, read, save } from './ui.js';
import { genre } from './stations.js';
import { recording } from './recordings.js';
import { measureAudio, saveDuration, durationFor, recordingKey, importFolder } from './imports.js';
import { buildStation, nativeAds, reelKey, stationOrigin } from './broadcast.js';
import { Receiver } from './player.js';
import { cover, dial } from './dial.js';
import { catalogView } from './catalog-view.js';
import { connectGamepad } from './gamepad.js';
import { onDemandView } from './on-demand.js';
import { connectMediaControls } from './media-controls.js';

const files = [
  'catalog',
  'media',
  'programs',
  'talk-chapters',
  'broadcasts',
  'native-tracks',
  'broadcast-chapters',
  'captures',
  'game-recordings',
  'runtime',
  'artwork',
];
async function getFile(name) {
  const response = await fetch('data/' + name + '.json');
  if (!response.ok) throw Error('Could not read ' + name);
  return response.json();
}
function clock() {
  el('clock').textContent = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(Date.now());
}
decorate();
const landscapeDash = matchMedia('(min-width: 540px) and (max-height: 740px) and (min-aspect-ratio: 8/5)');
let dashPreference = read('dashboard', null);
function dashboardLayout() {
  const enabled = dashPreference ?? landscapeDash.matches;
  document.body.classList.toggle('dashboard', enabled);
  const toggle = el('dash-toggle');
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.title = enabled ? 'Use standard layout' : 'Use dashboard layout';
  toggle.setAttribute('aria-label', toggle.title);
}
el('dash-toggle').onclick = () => {
  const enabled = !document.body.classList.contains('dashboard');
  dashPreference = enabled === landscapeDash.matches ? null : enabled;
  save('dashboard', dashPreference);
  dashboardLayout();
};
landscapeDash.addEventListener('change', dashboardLayout);
dashboardLayout();
document.addEventListener('error', (event) => {
  if (event.target.matches?.('.station-cover img')) event.target.remove();
}, true);
clock();
setInterval(clock, 15000);

async function init() {
  const [
    catalog,
    media,
    programs,
    talkChapters,
    broadcasts,
    nativeTracks,
    chapters,
    captures,
    gameRecordings,
    runtime,
    artwork,
  ] = await Promise.all(files.map(getFile));
  const direct = !runtime.proxy;
  const scene = runtime.localScene ? 'assets/scenes/vice-city-dusk.webp' : artwork.scene;
  document.querySelector('.scenery').style.setProperty('--scene', 'url("' + scene + '")');
  for (const station of catalog.stations) {
    station.artwork = runtime.covers.includes(station.id)
      ? 'assets/covers/' + station.id + '.webp'
      : artwork.covers[station.id];
  }
  const talk = Object.fromEntries(
    catalog.stations
      .filter((s) => s.kind === 'talk')
      .map((s) => [s.id, programs.find((x) => x.station === s.name && x.audioUrl)]),
  );
  const sources = {
    direct,
    acceptsGameAudio: Boolean(document.createElement('audio').canPlayType('audio/ogg; codecs="opus"')),
    catalog,
    media,
    programs,
    talkChapters,
    broadcasts,
    nativeTracks,
    gameRecordings,
    chapters,
    captures,
    talk,
    ads: nativeAds(programs, false, direct),
  };
  const stations = catalog.stations;
  let index = stations.findIndex((s) => s.id === read('station', 'flash-fm'));
  if (index < 0) index = 0;
  let wanted = read('power', true),
    importTarget,
    libraryScope = '',
    receiver,
    demand,
    syncMedia;
  function message(state) {
    const gesture = state.phase === 'gesture',
      live = state.phase === 'live';
    const labels = {
      off: 'RECEIVER OFF',
      gesture: 'READY TO TUNE',
      tuning: 'TUNING',
      buffering: 'BUFFERING',
      unavailable: 'RETRYING AUDIO',
      missing: 'NO RECORDING',
    };
    const status = live
      ? state.kind === 'ad'
        ? 'COMMERCIAL BREAK'
        : state.kind === 'dj'
          ? 'ON AIR · DJ'
          : state.kind === 'show'
            ? 'ON AIR · TALK'
            : 'ON AIR'
      : labels[state.phase];
    const standby = {
      off: 'Turn the radio on to listen',
      gesture: 'Touch the dial to turn on the radio',
      tuning: 'Tuning to ' + stations[index].name + '…',
      buffering: 'Rejoining ' + stations[index].name + ' on air…',
      unavailable: 'The recording could not play. Retrying automatically…',
      missing: 'Add a station recording in Tracklists to listen.',
    };
    el('air-label').textContent = status;
    el('air-title').textContent = live
      ? [state.title, state.artist].filter((v, i, a) => v && a.indexOf(v) === i).join('  ·  ')
      : standby[state.phase];
    el('on-air').classList.toggle('live', live);
    document.body.classList.toggle('radio-live', live);
    const episode = demand?.active;
    const enabled = episode ? !episode.paused : state.powered && !gesture;
    el('power').setAttribute('aria-pressed', String(enabled));
    el('power-text').textContent = (episode ? 'Audio ' : 'Radio ') + (enabled ? 'on' : 'off');
    el('power').setAttribute('aria-label', 'Turn ' + (episode ? 'audio ' : 'radio ') + (enabled ? 'off' : 'on'));
    const station = (live && stations.find((s) => s.id === state.audible)) || stations[index];
    syncMedia?.(episode ? {
      title: episode.item.title, artist: episode.group.name, album: 'Vicewave · On Demand',
      artwork: episode.group.artwork, playing: enabled && !episode.audio.paused, episode,
    } : {
      title: live && state.title ? state.title : station.name,
      artist: live ? [state.artist, station.name].filter((v, i, a) => v && a.indexOf(v) === i).join(' · ') : 'Vicewave',
      album: 'Vicewave · Live radio', artwork: station.artwork, playing: enabled && Boolean(state.audible),
    });
  }
  const plans = stations.map((s) => buildStation(s, sources));
  const archives = direct ? [] : broadcasts.filter((b) => b.nativeRange).map((b) => [b.stationId, b.audioUrl]);
  receiver = new Receiver(plans, message, stationOrigin(plans[index]), archives, {
    direct,
    onInterruption: () => {
      wanted = false;
      save('power', false);
    },
  });
  receiver.selected = index;
  function restoreRadio() {
    receiver.power(wanted);
    receiver.emit(true);
  }
  demand = onDemandView(programs, {
    runtime, stations, acceptsOpus: sources.acceptsGameAudio, changed: () => receiver.emit(true),
    takeOver: () => {
      receiver.unlock();
      receiver.power(false);
      receiver.emit(true);
    },
    release: restoreRadio,
  });
  function listenGesture() {
    if (!wanted) return;
    receiver.unlock();
    receiver.power(true, true);
  }
  function setPower(on) {
    if (demand.active) {
      if (on) demand.resume();
      else demand.pause();
      return;
    }
    wanted = on;
    save('power', wanted);
    receiver.power(wanted, on);
  }
  function togglePower() {
    setPower(demand.active ? demand.active.paused : receiver.phase === 'gesture' || !wanted);
  }
  function display(next) {
    index = next;
    const s = stations[index];
    save('station', s.id);
    el('station-title').textContent = s.name;
    el('station-title').classList.toggle('long', s.name.length > 16);
    el('channel').textContent = 'CH ' + String(index + 1).padStart(2, '0');
    el('scale-count').textContent = String(index + 1).padStart(2, '0') + ' / ' + stations.length;
    el('genre').textContent = genre(s);
    el('hosts').textContent = s.hosts.length
      ? 'With ' +
        s.hosts
          .slice(0, 3)
          .map((host) => {
            const [performer, character] = host.split(' as ');
            return character && !/^(himself|herself|themselves)$/i.test(character) ? character : performer;
          })
          .join(' & ')
      : 'Thrillbilly Mud Club, Leonida';
    el('back-to-station').textContent = 'Back to ' + s.name;
    el('demand-back').textContent = 'Back to ' + s.name;
    receiver.tune(index);
  }
  const carousel = dial(el('radio-view'), stations, index, {
    live: true, change: display, activate: listenGesture, preview: (i) => receiver.preview(i),
  });
  syncMedia = connectMediaControls({
    play: () => setPower(true), pause: () => setPower(false),
    stop: () => {
      wanted = false;
      save('power', false);
      demand.stop();
      receiver.power(false);
      receiver.emit(true);
    },
    skip: (direction) => {
      if (demand.active) demand.skip(direction);
      else carousel.step(direction);
    },
    seek: (seconds, relative) => demand.seek(seconds, relative),
  });
  for (const [i, station] of stations.entries()) {
    if (!station.unlockable && !station.local) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'episode-row';
    button.dataset.station = station.id;
    button.innerHTML =
      cover(station) +
      '<span><strong>' +
      esc(station.name) +
      '</strong><small>' +
      (station.local ? 'Local signal' : 'Unlockable station') +
      ' · Tune live</small></span>';
    button.onclick = () => {
      demand.stop();
      wanted = true;
      save('power', true);
      if (!receiver.powered) receiver.tune(i);
      carousel.jump(i);
      location.hash = 'radio';
    };
    el('special-stations').append(button);
  }
  const guide = catalogView(sources, {
    selected: () => stations[index],
    listen: (x) => {
      el('details').close();
      location.hash = 'on-demand';
      route();
      demand.listen(x);
    },
    import: (id, x) => {
      importTarget = { id, track: x };
      el('audio-file').click();
    },
  });
  function route() {
    const library = ['#library', '#tracklists'].includes(location.hash);
    const shows = location.hash === '#on-demand';
    if (!shows && demand.active) {
      if (demand.active.paused) {
        wanted = false;
        save('power', false);
      }
      demand.stop();
      restoreRadio();
    }
    el('demand-view').hidden = !shows;
    el('radio-view').hidden = library || shows;
    el('guide-view').hidden = !library;
    document.body.classList.toggle('guide-open', library);
    el('nav-radio').setAttribute('aria-current', library || shows ? 'false' : 'page');
    el('nav-demand').setAttribute('aria-current', shows ? 'page' : 'false');
    el('nav-guide').setAttribute('aria-current', library ? 'page' : 'false');
    if (library) guide.open(libraryScope);
    else requestAnimationFrame(() => (shows ? demand.carousel : carousel).layout());
    window.scrollTo(0, 0);
  }
  el('nav-guide').onclick = () => {
    libraryScope = '';
    if (['#tracklists', '#library'].includes(location.hash)) guide.open();
  };
  el('station-guide').onclick = () => {
    libraryScope = stations[index].id;
  };
  addEventListener('hashchange', route);
  addEventListener('pageshow', (e) => {
    if (e.persisted && !demand.active) restoreRadio();
  });
  el('power').onclick = togglePower;
  addEventListener('keydown', (e) => {
    if (
      el('details').open ||
      !el('guide-view').hidden ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.target.matches('input,select,textarea')
    )
      return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.target.closest('#episode-list, #special-stations')) el('show-strip').focus({ preventScroll: true });
      activeDial().step(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  function activeDial() { return el('demand-view').hidden ? carousel : demand.carousel; }
  connectGamepad({ isOpen: () => el('guide-view').hidden, browse: (d) => activeDial().step(d), togglePower });
  el('strip').addEventListener('pointerup', listenGesture);
  async function localPlans(affected) {
    const keys = new Set(await recording('keys')),
      locals = {};
    const reel = keys.has(reelKey);
    sources.ads = nativeAds(programs, reel, direct);
    // Older saved blobs are measured once and keep their original keys.
    for (const s of stations) {
      if (affected && !affected.has(s.id)) continue;
      const list = [];
      if (keys.has(s.id)) {
        const dur = await durationFor(s.id).catch(() => null);
        if (dur)
          locals[s.id] = {
            capture: {
              kind: 'recording',
              fileKey: s.id,
              title: s.name,
              description: 'My station recording',
              duration: dur,
            },
          };
      } else {
        for (const t of s.tracks) {
          const key = recordingKey(s.id, t);
          if (!keys.has(key)) continue;
          const dur = await durationFor(key).catch(() => null);
          if (dur) list.push({ ...t, fileKey: key, duration: dur });
        }
        if (list.length) locals[s.id] = { tracks: list };
      }
    }
    if (Object.keys(locals).length || reel)
      receiver.replace(
        stations.map((s, i) =>
          (affected ? affected.has(s.id) : locals[s.id] || reel)
            ? buildStation(s, sources, locals[s.id])
            : receiver.stations[i],
        ),
      );
  }
  el('reel-import').onclick = () => {
    importTarget = { id: reelKey };
    el('audio-file').click();
  };
  el('audio-file').onchange = async (e) => {
    const file = e.target.files[0],
      target = importTarget;
    e.target.value = '';
    if (!file || !target) return;
    try {
      const duration = await measureAudio(file),
        key = target.track ? recordingKey(target.id, target.track) : target.id;
      if (key === reelKey && Math.abs(duration - 8615) > 2) {
        el('import-status').textContent =
          'Choose the indexed commercial reel (2h 23m 35s) so every break starts in the right place.';
        return;
      }
      await recording('put', key, file);
      await saveDuration(key, file, duration);
      await localPlans(key === reelKey ? undefined : new Set([target.id]));
      el('import-status').textContent =
        key === reelKey
          ? 'Commercial reel saved. All 170 breaks are in rotation.'
          : 'Recording saved to ' + stations.find((s) => s.id === target.id).name + '.';
      if (el('details').open) el('details').close();
    } catch {
      el('import-status').textContent = 'Could not read or store this audio file.';
    }
  };
  el('folder-import').onclick = () => el('folder').click();
  el('folder').onchange = async (e) => {
    const input = e.target,
      list = [...input.files];
    input.value = '';
    if (!list.length) return;
    try {
      const result = await importFolder(list, stations, (p) => {
        el('import-status').textContent = 'Matching ' + p.processed + ' / ' + p.total + ' files…';
      });
      if (result.imported.length) await localPlans(new Set(result.imported.map((x) => x.stationId)));
      el('import-status').textContent =
        result.matched +
        ' matched · ' +
        result.unmatched +
        ' unmatched · ' +
        result.skipped +
        ' already saved · ' +
        result.failed +
        ' failed.';
    } catch {
      el('import-status').textContent = 'Import could not finish. Check the files and available storage.';
    }
  };
  display(index);
  route();
  if (wanted) receiver.unlock();
  receiver.power(wanted);
  receiver.tick();
  localPlans().catch(() => {});
}
init().catch((e) => {
  el('air-label').textContent = 'RECEIVER OFF';
  el('air-title').textContent = 'The station catalog could not load. Refresh to try again.';
  console.error(e);
});
