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

  // Draw logo to offscreen canvas, then tint
  const off = new OffscreenCanvas(Math.ceil(w), Math.ceil(height));
  const octx = off.getContext('2d');

  // Draw the original logo
  octx.drawImage(img, 0, 0, w, height);

  // Tint: use source-in composite to replace color while keeping alpha
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = color;
  octx.fillRect(0, 0, w, height);

  // Draw tinted logo onto main canvas
  ctx.drawImage(off, x, y);

  return w;
}

// Initialize on module load
preloadLogos();
