// Logo loader and renderer
// Preloads logo images and draws them on canvas with dynamic color

const LOGO_DEFS = {
  'sony-alpha': {
    src: 'assets/sony-alpha.png',
    // Original is orange on transparent, aspect ratio ~960x680
    aspect: 960 / 680,
  },
  'sony': {
    src: 'assets/sony.svg',
    // SONY wordmark, aspect ~1280x225
    aspect: 1280 / 225,
  },
  'pixel': {
    src: 'assets/pixel-wordmark.png',
    // "Pixel" wordmark, original is gray + transparent (1280×512)
    aspect: 1280 / 512,
  },
  'google-g': {
    src: 'assets/google-g.webp',
    // Multicolor "G" — never tint, render as-is.
    aspect: 1,
    multicolor: true,
  },
};

const logoCache = {};

// Preload all logos
export function preloadLogos() {
  for (const [key, def] of Object.entries(LOGO_DEFS)) {
    const img = new Image();
    img.src = def.src;
    logoCache[key] = { img, def };
  }
}

// Draw a logo centered at (cx, cy) with a given height, tinted to `color`.
// Returns the width of the drawn logo.
export function drawLogo(ctx, logoKey, cx, cy, height, color) {
  const entry = logoCache[logoKey];
  if (!entry || !entry.img.complete || !entry.img.naturalWidth) {
    return 0;
  }

  const { img, def } = entry;
  const w = height * def.aspect;
  const x = cx - w / 2;
  const y = cy - height / 2;

  // Multicolor logos (e.g. Google G) must keep their original colors —
  // skip the tint pass and draw directly.
  if (def.multicolor) {
    ctx.drawImage(img, x, y, w, height);
    return w;
  }

  // Draw logo to offscreen canvas, then tint with source-in composite to
  // replace the color while preserving alpha.
  const off = new OffscreenCanvas(Math.ceil(w), Math.ceil(height));
  const octx = off.getContext('2d');
  octx.drawImage(img, 0, 0, w, height);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = color;
  octx.fillRect(0, 0, w, height);
  ctx.drawImage(off, x, y);

  return w;
}

// Width of a logo at a given draw height — needed so callers can left-align
// without a measure-then-draw round trip.
export function getLogoAspect(logoKey) {
  const def = LOGO_DEFS[logoKey];
  return def ? def.aspect : 0;
}

// Initialize on module load
preloadLogos();
