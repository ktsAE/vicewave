// Each station frame contains a square cover inside a landscape image.
// Display the crop directly. Only system media controls need a separate square file.
const frames = new Map();
const localFallbacks = new Map();
let mediaSource, mediaTimer;

export function squareArtwork(source) {
  const frame = frames.get(source);
  if (mediaSource !== source) {
    mediaSource = source;
    clearTimeout(mediaTimer);
    // Rapid tuning only needs system artwork for the station the listener lands on.
    if (frame && !frame.pending) mediaTimer = setTimeout(() => loadSquare(frame), 200);
  }
  return frame ? frame.square || frame.fallback : source;
}

export function stationFrame(source) {
  return frames.get(source);
}

export function fallbackArtwork(source) {
  return localFallbacks.get(source) || frames.get(source)?.fallback;
}

async function extractSquare(source, box) {
  const frame = new Image();
  frame.crossOrigin = 'anonymous';
  frame.src = source;
  await frame.decode();
  if (frame.naturalWidth !== box.width || frame.naturalHeight !== box.height)
    throw new Error('Unexpected station frame dimensions');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = box.size;
  canvas.getContext('2d').drawImage(frame, box.left, box.top, box.size, box.size, 0, 0, box.size, box.size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not read station artwork');
  return URL.createObjectURL(blob);
}

function loadSquare(frame) {
  frame.pending ??= extractSquare(frame.source, frame.box)
    .catch(() => frame.fallback)
    .then((url) => {
      frame.square = url;
      frame.changed(frame.source);
      return url;
    });
  return frame.pending;
}

export function configureArtwork(stations, catalog, localCovers, changed) {
  const box = catalog.dialFrame;
  if (box) {
    const style = document.documentElement.style;
    style.setProperty('--frame-width', 100 * box.width / box.size + '%');
    style.setProperty('--frame-height', 100 * box.height / box.size + '%');
    style.setProperty('--frame-left', -100 * box.left / box.size + '%');
    style.setProperty('--frame-top', -100 * box.top / box.size + '%');
  }
  const local = (key) => 'assets/covers/' + key + '.webp';
  for (const station of stations) {
    const id = station.id;
    const fallback = localCovers.includes(id) ? local(id) : catalog.covers[id];
    const frame = catalog.frames?.[id];
    if (!frame) {
      station.artwork = fallback;
      continue;
    }
    frames.set(frame, { source: frame, fallback, box, changed });
    station.artwork = frame;
    for (const suffix of [box.size, 'mix', 'restored']) {
      const name = id + '-' + suffix;
      if (localCovers.includes(name)) {
        const source = local(name);
        localFallbacks.set(source, station.artwork);
        station.artwork = source;
      }
    }
  }
}
