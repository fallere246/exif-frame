// Template Definitions and Canvas Rendering
import { drawLogo as drawLogoImage, getLogoAspect } from './logos.js';
import { FIELDS, SLOT_LIMITS, SLOTS } from './fields.js';

// Sans is the workhorse — Noto Sans + Noto Sans JP keep latin and Japanese
// glyphs metrically aligned. Mono is reserved for camera parameters where
// tabular alignment matters (f/5.6 · 1/160s · ISO 640).
const FONT_SANS = '"Noto Sans", "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
const FONT_MONO = '"SF Mono", Menlo, Consolas, "Noto Sans JP", monospace';
// Legacy alias retained — older templates still reference FONT_STACK.
const FONT_STACK = FONT_SANS;

function fontSize(baseHeight, ratio) {
  return Math.max(Math.round(baseHeight * ratio), 12);
}

function extractBrand(camera) {
  if (!camera) return '';
  const brands = ['Sony', 'Canon', 'Nikon', 'Fujifilm', 'Hasselblad', 'Leica', 'Panasonic', 'Olympus', 'Pentax', 'Sigma'];
  for (const b of brands) {
    if (camera.toLowerCase().includes(b.toLowerCase())) return b.toUpperCase();
  }
  return camera.split(' ')[0].toUpperCase();
}

function extractModel(camera) {
  if (!camera) return '';
  const brands = ['Sony', 'Canon', 'Nikon', 'Fujifilm', 'Hasselblad', 'Leica', 'Panasonic', 'Olympus', 'Pentax', 'Sigma'];
  let model = camera;
  for (const b of brands) {
    if (camera.toLowerCase().startsWith(b.toLowerCase())) {
      model = camera.slice(b.length).trim();
      break;
    }
  }
  return model || camera;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "2026-10-18" → "October 18, 2026". Returns input unchanged if not parseable.
function formatDate(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const month = MONTHS[parseInt(m[2], 10) - 1];
  if (!month) return s;
  return `${month} ${parseInt(m[3], 10)}, ${m[1]}`;
}

// Map cornerRadius preset → ratio of min(w,h)
const CORNER_RADII = { none: 0, small: 0.008, medium: 0.018, large: 0.035 };

function getImageRadius(meta, w, h) {
  const ratio = CORNER_RADII[meta.cornerRadius] ?? 0;
  return Math.round(Math.min(w, h) * ratio);
}

// Draw image at (x, y) with optional rounded-corner clipping.
// bgFill (optional): color to fill the rectangular area before clipping —
// needed for templates without a surrounding canvas-wide background, so the
// exposed corners don't render as transparent (=> black on JPEG export).
function drawImageMaybeRounded(ctx, img, meta, x, y, w, h, bgFill) {
  const r = getImageRadius(meta, w, h);
  if (r > 0) {
    if (bgFill) {
      ctx.fillStyle = bgFill;
      ctx.fillRect(x, y, w, h);
    }
    ctx.save();
    roundedRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, x, y, w, h);
  }
}

// Editorial-style bar layout. Left=brand+camera info, right=date/meta stack.
// Content is driven by the FIELDS slot system so the user's "表示" toggles
// continue to control what appears.
//
//   LEFT_TOP  → first text line (sans, primary)            "α7 V · Tamron 25-200mm"
//   LEFT_BOTTOM → second text line (mono, tabular)         "146mm · f/5.6 · 1/160s · ISO 640"
//   RIGHT_TOP → first right-side line (sans, primary)      "May 3, 2026 · Tokyo"
//   RIGHT_BOTTOM → each item on its own meta line below    "© 2026 NISHIMURA, Sota"
//                                                          "DaVinci Resolve"

function slotItems(meta, slot) {
  const items = [];
  for (const f of FIELDS) {
    if (f.slot !== slot) continue;
    if (!meta['show_' + f.id]) continue;
    let v = meta[f.id];
    if (!v) continue;
    if (f.id === 'date') v = formatDate(v);
    if (f.id === 'author') v = `© ${v}`;
    if (f.id === 'copyright' && !v.includes('©')) v = `© ${v}`;
    items.push(v);
    if (items.length >= SLOT_LIMITS[slot]) break;
  }
  return items;
}

function barColors(style) {
  if (style === 'white') {
    return { main: '#1a1a1a', secondary: '#888888', meta: '#aaaaaa', metaSoft: '#bbbbbb', brand: '#1a1a1a' };
  }
  if (style === 'gray') {
    return { main: '#ffffff', secondary: '#dddddd', meta: '#aaaaaa', metaSoft: '#999999', brand: '#ffffff' };
  }
  // black, blur
  return { main: '#ffffff', secondary: '#cccccc', meta: '#999999', metaSoft: '#888888', brand: '#ffffff' };
}

function drawBarContent(ctx, img, meta, x, y, w, h, style) {
  const imgH = img.naturalHeight;
  const colors = barColors(style);

  // Sizes — design pixel values (13/11/10) × 2 for SNS-frame legibility,
  // interpreted as ratios of imgH so they scale to any resolution.
  const padH = Math.round(imgH * 0.030);
  const padV = Math.round(imgH * 0.020);
  const logoH = Math.max(Math.round(imgH * 0.036), 20);
  const mainSize = fontSize(imgH, 0.028);
  const secSize = fontSize(imgH, 0.022);
  const metaSize = fontSize(imgH, 0.020);
  const lineGap = Math.max(Math.round(imgH * 0.010), 4);

  ctx.save();
  ctx.textBaseline = 'top';
  // Subtle letter-spacing throughout. ctx.letterSpacing supported in modern
  // browsers (Chrome 99+, Safari 15.4+, Firefox 113+).
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.02em';

  // ── LEFT COLUMN ──
  // Pulled from FIELDS slot mappings so the user's show_* toggles take effect.
  const leftTopText = slotItems(meta, SLOTS.LEFT_TOP).join(' · ');
  const leftBottomText = slotItems(meta, SLOTS.LEFT_BOTTOM).join(' · ');

  const showLogo = meta.show_logo !== false && meta.logo && meta.logo !== 'none';

  const leftLines = [];
  if (leftTopText) leftLines.push({ text: leftTopText, size: mainSize, color: colors.main, font: FONT_SANS });
  if (leftBottomText) leftLines.push({ text: leftBottomText, size: secSize, color: colors.secondary, font: FONT_MONO, mono: true });

  const leftTextH = leftLines.length
    ? leftLines.reduce((s, l) => s + l.size, 0) + (leftLines.length - 1) * lineGap
    : 0;
  const leftBlockH = Math.max(showLogo ? logoH : 0, leftTextH);
  const leftTop = y + (h - leftBlockH) / 2;

  let leftX = x + padH;

  // Logo: vertically centered with the entire left text block (not just the
  // first line). Aligning to line 1 made it visually float toward the top.
  if (showLogo) {
    const aspect = getLogoAspect(meta.logo);
    const logoW = aspect > 0 ? logoH * aspect : 0;
    const logoCY = leftTop + leftBlockH / 2;
    if (logoW > 0) {
      drawBrand(ctx, meta, leftX + logoW / 2, logoCY, logoH, colors.brand);
      leftX += logoW + Math.round(padH * 0.85);
    } else {
      // text-fallback brand mark — let drawBrand center then advance by its return
      const w = drawBrand(ctx, meta, leftX, logoCY, logoH, colors.brand);
      if (w > 0) leftX += w + Math.round(padH * 0.85);
    }
  }

  // Stack camera line then params line, vertically aligned to the block top
  let textY = leftTop + (leftBlockH - leftTextH) / 2;
  ctx.textAlign = 'left';
  for (const line of leftLines) {
    ctx.font = `400 ${line.size}px ${line.font}`;
    ctx.fillStyle = line.color;
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = line.mono ? '0.04em' : '0.02em';
    }
    if (line.mono && 'fontVariantCaps' in ctx) {
      // Tabular numerals via OpenType feature — supported in newer Canvas.
      ctx.font = `400 ${line.size}px ${line.font}`;
    }
    ctx.fillText(line.text, leftX, textY);
    textY += line.size + lineGap;
  }

  // ── RIGHT COLUMN ──
  // RIGHT_TOP fields share one joined line (date · location · …); RIGHT_BOTTOM
  // fields each get their own meta line below.
  const rightTopText = slotItems(meta, SLOTS.RIGHT_TOP).join(' · ');
  const rightStackItems = slotItems(meta, SLOTS.RIGHT_BOTTOM);

  const rightLines = [];
  if (rightTopText) {
    rightLines.push({ text: rightTopText, size: mainSize, color: colors.main });
  }
  rightStackItems.forEach((text, i) => {
    // Slight progressive de-emphasis when there are several stacked metas.
    const color = i === rightStackItems.length - 1 ? colors.metaSoft : colors.meta;
    rightLines.push({ text, size: metaSize, color });
  });

  if (rightLines.length) {
    const rightX = x + w - padH;
    const rightTextH = rightLines.reduce((s, l) => s + l.size, 0) + (rightLines.length - 1) * lineGap;
    let rTextY = y + (h - rightTextH) / 2;
    // Top-align the right column with the left's first line for visual rhyme.
    if (leftLines.length) {
      const leftFirstLineTop = leftTop + (leftBlockH - leftTextH) / 2;
      rTextY = leftFirstLineTop;
    }
    ctx.textAlign = 'right';
    for (const line of rightLines) {
      ctx.font = `400 ${line.size}px ${FONT_SANS}`;
      ctx.fillStyle = line.color;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0.02em';
      ctx.fillText(line.text, rightX, rTextY);
      rTextY += line.size + lineGap;
    }
  }

  // Suppress unused-var warning for padV (kept as design hint for callers).
  void padV;

  ctx.restore();
}

// Draw brand area: logo image if selected, otherwise text fallback
// cx, cy = center point, size = height of the logo/text
// Returns width of drawn element. Skipped entirely if show_logo is unchecked.
function drawBrand(ctx, meta, cx, cy, size, color) {
  if (meta.show_logo === false) return 0;
  const logo = meta.logo;

  // Try drawing logo image
  if (logo && logo !== 'none') {
    const w = drawLogoImage(ctx, logo, cx, cy, size, color);
    if (w > 0) return w;
  }

  // Fallback: brand name as text
  const brand = extractBrand(meta.camera);
  if (!brand) return 0;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  ctx.fillStyle = color;
  ctx.letterSpacing = `${Math.round(size * 0.08)}px`;
  ctx.fillText(brand, cx, cy);
  ctx.letterSpacing = '0px';
  const w = ctx.measureText(brand).width;
  ctx.restore();
  return w;
}

export const templates = {

  // ─── Template 1: Minimal White Bottom Bar ───
  'minimal-white': {
    name: 'Minimal White',
    render(ctx, img, meta, cw, ch, frameH) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      ctx.drawImage(img, 0, 0, w, h);

      // White bar
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, h, cw, frameH);

      // Thin separator
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = Math.max(1, Math.round(h * 0.0008));
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(cw, h);
      ctx.stroke();

      drawBarContent(ctx, img, meta, 0, h, cw, frameH, 'white');
    },
  },

  // ─── Template 2: Black Bar ───
  'black-bar': {
    name: 'Black Bar',
    render(ctx, img, meta, cw, ch, frameH) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      ctx.drawImage(img, 0, 0, w, h);

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, h, cw, frameH);

      drawBarContent(ctx, img, meta, 0, h, cw, frameH, 'black');
    },
  },

  // ─── Template 2b: Gray Bar ───
  'gray-bar': {
    name: 'Gray Bar',
    render(ctx, img, meta, cw, ch, frameH) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      ctx.drawImage(img, 0, 0, w, h);

      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(0, h, cw, frameH);

      drawBarContent(ctx, img, meta, 0, h, cw, frameH, 'gray');
    },
  },

  // ─── Template 3: Gallery Frame ───
  // White frame all around image + unified white bar layout
  'gallery-frame': {
    name: 'Gallery Frame',
    render(ctx, img, meta, cw, ch, padding) {
      const h = img.naturalHeight;
      const w = img.naturalWidth;

      // White background (full canvas)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);

      ctx.drawImage(img, padding, padding, w, h);

      // Thin border around the image
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = Math.max(1, Math.round(h * 0.0005));
      ctx.strokeRect(padding, padding, w, h);

      // Unified bar layout in the bottom area
      const barY = padding + h;
      const barH = ch - barY;
      drawBarContent(ctx, img, meta, padding, barY, w, barH, 'white');
    },
  },

  // ─── Template 4: Dark Cinematic ───
  // Blurred photo background extends as the bar; image inset with rounded corners.
  'dark-cinematic': {
    name: 'Dark Cinematic',
    render(ctx, img, meta, cw, ch, frameH) {
      const h = img.naturalHeight;
      const w = img.naturalWidth;
      const imgPad = Math.round(w * 0.03);
      const radius = Math.round(h * 0.015);

      // --- Blurred background: draw image scaled to fill, then blur + darken ---
      ctx.save();
      const scale = Math.max(cw / w, ch / h) * 1.1;
      const bw = w * scale;
      const bh = h * scale;
      const bx = (cw - bw) / 2;
      const by = (ch - bh) / 2;
      ctx.filter = `blur(${Math.round(h * 0.02)}px)`;
      ctx.drawImage(img, bx, by, bw, bh);
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();

      // Main image with rounded corners (template default)
      ctx.save();
      roundedRectPath(ctx, imgPad, imgPad, w, h, radius);
      ctx.clip();
      ctx.drawImage(img, imgPad, imgPad, w, h);
      ctx.restore();

      // Subtle rounded border
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = Math.max(1, Math.round(h * 0.001));
      roundedRectPath(ctx, imgPad, imgPad, w, h, radius);
      ctx.stroke();
      ctx.restore();

      // Unified bar layout in the bottom blurred area
      const barY = imgPad + h;
      const barH = ch - barY;
      drawBarContent(ctx, img, meta, imgPad, barY, w, barH, 'blur');
    },
  },

  // ─── Template 5: Info Card ───
  // Based on: 025317 (Fujifilm cherry blossom) style
  // Right side panel with labeled key-value pairs
  'info-card': {
    name: 'Info Card',
    render(ctx, img, meta, cw, ch, stripW) {
      const h = img.naturalHeight;
      const w = img.naturalWidth;
      const pad = Math.round(stripW * 0.12);
      const labelSize = fontSize(h, 0.014);
      const valueSize = fontSize(h, 0.018);
      const brandSize = fontSize(h, 0.022);

      ctx.drawImage(img, 0, 0, w, h);

      // Light gray panel for strip
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(w, 0, stripW, ch);

      const x = w + pad;
      const xVal = w + stripW * 0.55;
      let y = pad * 2;
      const rowH = valueSize * 2.4;

      ctx.textBaseline = 'top';

      const drawRow = (label, value) => {
        if (!value) return;
        // Label (right-aligned)
        ctx.textAlign = 'right';
        ctx.font = `400 ${labelSize}px ${FONT_STACK}`;
        ctx.fillStyle = '#999999';
        ctx.fillText(label, xVal - pad * 0.5, y + 2);
        // Value (left-aligned)
        ctx.textAlign = 'left';
        ctx.font = `500 ${valueSize}px ${FONT_STACK}`;
        ctx.fillStyle = '#1a1a1a';
        ctx.fillText(value, xVal, y);
        // Separator line
        y += rowH;
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - rowH * 0.25);
        ctx.lineTo(w + stripW - pad, y - rowH * 0.25);
        ctx.stroke();
      };

      drawRow('TakenAt', formatDate(meta.date));
      drawRow('Location', meta.location);

      y += rowH * 0.3; // gap between sections
      drawRow('Focal', meta.focalLength);
      drawRow('Aperture', meta.aperture);
      drawRow('Shutter', meta.shutter);
      drawRow('ISO', meta.iso);

      y += rowH * 0.3;
      drawRow('PhotoBy', meta.author);
      drawRow('ShotOn', extractModel(meta.camera));

      // Brand logo at bottom
      const brandCenterY = ch - pad * 2;
      drawBrand(ctx, meta, w + stripW / 2, brandCenterY, brandSize, '#1a1a1a');
    },
  },

  // ─── Template 6: Elegant Dark ───
  // Based on: 025245 (Leica flower) style
  // Black frame all around, centered brand logo, pipe-separated info, © author
  'elegant-dark': {
    name: 'Elegant Dark',
    render(ctx, img, meta, cw, ch, padding) {
      const h = img.naturalHeight;
      const w = img.naturalWidth;

      // Black background
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, cw, ch);

      ctx.drawImage(img, padding, padding, w, h);

      // Unified bar layout in the bottom area
      const barY = padding + h;
      const barH = ch - barY;
      drawBarContent(ctx, img, meta, padding, barY, w, barH, 'black');
    },
  },

  // ─── Template 7: Overlay ───
  // Based on: 025328 (Lumix cat) style
  // No frame, text overlaid on photo. Brand top center, © author bottom center.
  'overlay': {
    name: 'Overlay',
    render(ctx, img, meta, cw, ch) {
      const h = img.naturalHeight;
      const w = img.naturalWidth;
      const borderW = Math.max(2, Math.round(Math.min(w, h) * 0.008));
      const brandSize = fontSize(h, 0.032);
      const subSize = fontSize(h, 0.018);
      const pad = Math.round(Math.min(w, h) * 0.04);

      // Black border
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, cw, ch);

      // Draw image inset by border
      ctx.drawImage(img, borderW, borderW, w - borderW * 2, h - borderW * 2);

      // Brand logo at top center
      const brandY = pad + brandSize * 0.5;
      drawBrand(ctx, meta, w / 2, brandY, brandSize, '#ffffff');

      // © Author at bottom center
      if (meta.author) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `400 ${subSize}px ${FONT_STACK}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillText(`\u00A9  ${meta.author}  all rights reserved`, w / 2, h - pad);
        ctx.restore();
      }
    },
  },

  // \u2500\u2500\u2500 Template 8: Photo Overlay \u2500\u2500\u2500
  // Based on: 031754 (Sony \u03B1 / N Seoul Tower) style
  // Thin white border (print/polaroid edge feel). Brand top-center, italic location +
  // bold-italic params bottom-center, all overlaid on the image.
  'photo-overlay': {
    name: 'Photo Overlay',
    render(ctx, img, meta, cw, ch, borderW) {
      const h = img.naturalHeight;
      const w = img.naturalWidth;
      const ix = borderW;
      const iy = borderW;
      const iw = w;
      const ih = h;
      const brandSize = fontSize(h, 0.038);
      const paramsSize = fontSize(h, 0.024);
      const locSize = fontSize(h, 0.018);
      const pad = Math.round(Math.min(w, h) * 0.035);

      // White border background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);

      ctx.drawImage(img, ix, iy, iw, ih);

      // Top gradient (for brand logo legibility on bright skies)
      const topGrad = ctx.createLinearGradient(ix, iy, ix, iy + ih * 0.18);
      topGrad.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
      topGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(ix, iy, iw, ih * 0.18);

      // Bottom gradient (for text legibility)
      const botGrad = ctx.createLinearGradient(ix, iy + ih * 0.78, ix, iy + ih);
      botGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      botGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(ix, iy + ih * 0.78, iw, ih * 0.22);

      // Brand logo at top center (within image area)
      const centerX = ix + iw / 2;
      const brandY = iy + pad + brandSize * 0.5;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = Math.round(h * 0.006);
      drawBrand(ctx, meta, centerX, brandY, brandSize, '#ffffff');
      ctx.restore();

      // Bottom text (italic), centered within image area
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = Math.round(h * 0.004);

      const params = [meta.focalLength, meta.aperture, meta.shutter, meta.iso].filter(Boolean).join('   ');
      const paramsY = iy + ih - pad;
      if (params) {
        ctx.font = `italic 700 ${paramsSize}px ${FONT_STACK}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(params, centerX, paramsY);
      }

      if (meta.location) {
        ctx.font = `italic 400 ${locSize}px ${FONT_STACK}`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fillText(meta.location, centerX, paramsY - paramsSize * 1.6);
      }
      ctx.restore();
    },
  },

  // \u2500\u2500\u2500 Template 9: Polaroid Card \u2500\u2500\u2500
  // Based on: 031804 (Fujifilm Sydney) style
  // White rounded card with drop shadow. Image has rounded corners.
  // Bottom info: brand logo, then date | params | location with pipe separators, then \u00A9 author.
  'polaroid-card': {
    name: 'Polaroid Card',
    render(ctx, img, meta, cw, ch, layout) {
      const h = img.naturalHeight;
      const w = img.naturalWidth;
      const { shadowMargin, cardPad, bottomH } = layout;
      const cardX = shadowMargin;
      const cardY = shadowMargin;
      const cardW = cw - shadowMargin * 2;
      const cardH = ch - shadowMargin * 2;
      const cardRadius = Math.round(Math.min(w, h) * 0.012);
      const imgRadius = Math.round(Math.min(w, h) * 0.008);
      const imgX = cardX + cardPad;
      const imgY = cardY + cardPad;

      // Draw drop shadow then white card
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
      ctx.shadowBlur = Math.round(shadowMargin * 0.9);
      ctx.shadowOffsetY = Math.round(shadowMargin * 0.25);
      ctx.fillStyle = '#ffffff';
      roundedRectPath(ctx, cardX, cardY, cardW, cardH, cardRadius);
      ctx.fill();
      ctx.restore();

      // Clip image with rounded corners (template default)
      ctx.save();
      roundedRectPath(ctx, imgX, imgY, w, h, imgRadius);
      ctx.clip();
      ctx.drawImage(img, imgX, imgY, w, h);
      ctx.restore();

      // Subtle border around image
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
      ctx.lineWidth = Math.max(1, Math.round(h * 0.0006));
      roundedRectPath(ctx, imgX, imgY, w, h, imgRadius);
      ctx.stroke();
      ctx.restore();

      // Unified bar layout in the bottom info area
      const infoTop = imgY + h;
      drawBarContent(ctx, img, meta, imgX, infoTop, w, bottomH, 'white');
    },
  },

  // ─── Template 10: Custom ───
  // User-controlled frame (none/white/black/gray/blur), bar (same set), and corner radius.
  // Layout/colors derive from those three knobs only.
  'custom': {
    name: 'Custom',
    render(ctx, img, meta, cw, ch, layout) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const { framePad, barH, frame, bar } = layout;

      // ── Frame background ──
      const FRAME_BG = { white: '#ffffff', black: '#0a0a0a', gray: '#3a3a3a' };
      if (FRAME_BG[frame]) {
        ctx.fillStyle = FRAME_BG[frame];
        ctx.fillRect(0, 0, cw, ch);
      } else if (frame === 'blur') {
        drawBlurredFill(ctx, img, 0, 0, cw, ch, w, h);
      }

      // ── Image (with optional rounded corners) ──
      const imgX = framePad;
      const imgY = framePad;
      const imgBg = FRAME_BG[frame] || null;
      drawImageMaybeRounded(ctx, img, meta, imgX, imgY, w, h, imgBg);

      // ── Bar ──
      if (bar !== 'none') {
        const barX = frame === 'none' ? 0 : framePad;
        const barW = frame === 'none' ? cw : w;
        const barY = imgY + h + (frame === 'none' ? 0 : framePad);

        if (FRAME_BG[bar]) {
          ctx.fillStyle = FRAME_BG[bar];
          ctx.fillRect(barX, barY, barW, barH);
        } else if (bar === 'blur' && frame !== 'blur') {
          drawBlurredFill(ctx, img, barX, barY, barW, barH, w, h, cw, ch);
        }
        // bar === 'blur' && frame === 'blur': background already drawn

        drawBarContent(ctx, img, meta, barX, barY, barW, barH, bar);
      }
    },
  },
};

// Fill a rect with a blurred + darkened version of the image (cinematic look).
// When canvasW/canvasH are given, the blur is scaled to cover the whole canvas
// and clipped to the rect, so the bar's blur stays continuous with a frame blur.
function drawBlurredFill(ctx, img, x, y, w, h, imgW, imgH, canvasW, canvasH) {
  const refW = canvasW || w;
  const refH = canvasH || h;
  const scale = Math.max(refW / imgW, refH / imgH) * 1.1;
  const bw = imgW * scale;
  const bh = imgH * scale;
  const bx = (refW - bw) / 2;
  const by = (refH - bh) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = `blur(${Math.round(imgH * 0.02)}px)`;
  ctx.drawImage(img, bx, by, bw, bh);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function getCanvasDimensions(img, templateId, meta = {}) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  if (templateId === 'custom') {
    const frame = meta.customFrame || 'none';
    const bar = meta.customBar || 'none';
    const framePad = frame === 'none' ? 0 : Math.round(Math.min(w, h) * 0.04);
    const barH = bar === 'none' ? 0 : Math.round(h * 0.13);
    const bottomFramePad = frame === 'none' ? 0 : framePad;
    return {
      width: w + framePad * 2,
      height: framePad + h + bottomFramePad + barH,
      extra: { framePad, barH, frame, bar },
    };
  }

  if (templateId === 'overlay') {
    return { width: w, height: h, extra: 0 };
  }

  if (templateId === 'photo-overlay') {
    // Thin white border around image (print/polaroid edge)
    const borderW = Math.round(Math.min(w, h) * 0.018);
    return { width: w + borderW * 2, height: h + borderW * 2, extra: borderW };
  }

  if (templateId === 'polaroid-card') {
    // White card with drop shadow + bottom info area
    const shadowMargin = Math.round(Math.min(w, h) * 0.03);
    const cardPad = Math.round(Math.min(w, h) * 0.04);
    const bottomH = Math.round(h * 0.16);
    return {
      width: w + cardPad * 2 + shadowMargin * 2,
      height: h + cardPad + bottomH + shadowMargin * 2,
      extra: { shadowMargin, cardPad, bottomH },
    };
  }

  if (templateId === 'info-card') {
    // Right side strip (wider for labeled data)
    const stripW = Math.round(w * 0.35);
    return { width: w + stripW, height: h, extra: stripW };
  }

  if (templateId === 'gallery-frame' || templateId === 'elegant-dark') {
    // Padding all around + bottom info area
    const padding = Math.round(Math.min(w, h) * 0.05);
    const bottomExtra = Math.round(h * 0.16);
    return {
      width: w + padding * 2,
      height: h + padding * 2 + bottomExtra,
      extra: padding,
    };
  }

  if (templateId === 'dark-cinematic') {
    // Dark frame with inset image + bottom info
    const imgPad = Math.round(w * 0.03);
    const bottomExtra = Math.round(h * 0.17);
    return {
      width: w + imgPad * 2,
      height: h + imgPad + bottomExtra,
      extra: bottomExtra,
    };
  }

  // Bottom bar templates (minimal-white, black-bar, gray-bar)
  const frameH = Math.round(h * 0.13);
  return { width: w, height: h + frameH, extra: frameH };
}
