// Each station frame contains a square cover inside a landscape image.
// Decode the square once and share it with the dial, tracklists and media controls.
const frames = new Map();

export function squareArtwork(source) {
  const frame = frames.get(source);
  if (!frame) return source;
  loadSquare(frame);
  return frame.square || frame.fallback;
}

export function usesFrame(source) {
  return frames.has(source);
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
  const local = (key) => 'assets/covers/' + key + '.webp';
  for (const station of stations) {
    const id = station.id;
    const fallback = localCovers.includes(id) ? local(id) : catalog.covers[id];
    const frame = catalog.frames?.[id];
    if (!frame) {
      station.artwork = fallback;
      continue;
    }
    const cached = id + '-' + catalog.dialFrame.size;
    if (localCovers.includes(cached)) station.artwork = local(cached);
    else {
      station.artwork = frame;
      frames.set(frame, { source: frame, fallback, box: catalog.dialFrame, changed });
    }
  }
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const { isIntersecting, target } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      target.show();
    }
  }, { rootMargin: '0px 160px' }) : null;
  customElements.define('station-picture', class extends HTMLElement {
    connectedCallback() {
      if (observer) observer.observe(this);
      else this.show();
    }
    disconnectedCallback() { observer?.unobserve(this); }
    async show() {
      const url = await loadSquare(frames.get(this.dataset.frame));
      if (!url || !this.isConnected) return;
      const img = new Image();
      img.draggable = false;
      img.alt = '';
      img.onload = () => this.replaceWith(img);
      img.src = url;
    }
  });
}
