// EXIF Reader — uses exifr (https://github.com/MikeKovarik/exifr).
//
// Why exifr over @uswriting/exiftool: empirical testing on Sony ARW showed
// exifr ~5ms / file vs ExifTool WASM ~700ms, with more accurate results
// (ExifTool WASM had bugs producing ExposureTime=Bulb, FocalLength=25.9mm,
// and a thinned-out Sony lens dictionary). MakerNote-only fields like
// CreativeStyle/PictureProfile were unreliable on the WASM build and are
// not displayed in this app.

import exifr from 'https://esm.sh/exifr@7.1.3';

// ─── ExifTool WASM (lazy, only for RAW preview extraction) ───────────────
//
// EXIF tag reading happens entirely in exifr (fast, accurate). ExifTool WASM
// is loaded only when we need to pull an embedded high-resolution preview JPEG
// from a RAW file (`-b -JpgFromRaw` etc.) — exifr's public thumbnail() returns
// only the small ~160×120 IFD1 thumbnail.
//
// First RAW load pays the WASM init cost (~2-5s). Subsequent loads in the same
// session reuse the in-memory module; subsequent visits hit the browser HTTP
// cache for the CDN bundles (esm.sh sets long max-age), so re-fetching is fast.

// 1.0.9 has a separate zeroperl-ts dependency that fetches "./zeroperl.wasm"
// against the page origin (404 on our deploy). We redirect via patchedFetch.
// Kept on 1.0.9 because the committed reference implementation that handled
// these previews was on this version.
const EXIFTOOL_CDN = 'https://esm.sh/@uswriting/exiftool@1.0.9';
const ZEROPERL_WASM_URL = 'https://esm.sh/@6over3/zeroperl-ts@1.0.10/dist/esm/zeroperl.wasm';

let exiftoolPromise = null;
function getExiftool() {
  if (!exiftoolPromise) {
    exiftoolPromise = import(/* @vite-ignore */ EXIFTOOL_CDN);
  }
  return exiftoolPromise;
}

// zeroperl-ts resolves "./zeroperl.wasm" against the page origin, which 404s
// when loaded via CDN. Patch the fetch zeroperl uses to redirect that one URL.
function patchedFetch(input, init) {
  let url;
  if (typeof input === 'string') url = input;
  else if (input instanceof URL) url = input.href;
  else if (input && typeof input.url === 'string') url = input.url;
  else url = '';
  if (url.endsWith('zeroperl.wasm')) {
    return globalThis.fetch(ZEROPERL_WASM_URL, init);
  }
  return globalThis.fetch(input, init);
}

// Optional caller-provided lifecycle hook so the UI can display a message
// during WASM init (which is the slow part).
let processingListener = null;
export function onPreviewProcessing(fn) {
  processingListener = fn;
  return () => { if (processingListener === fn) processingListener = null; };
}
function emitProcessing(state) {
  if (processingListener) {
    try { processingListener(state); } catch { /* ignore */ }
  }
}

// ─── Format helpers ──────────────────────────────────────────────────────

const CAMERA_NAME_MAP = {
  'ILCE-7M5': 'Sony α7 V',
  'ILCE-7M4': 'Sony α7 IV',
  'ILCE-7M3': 'Sony α7 III',
  'ILCE-7RM5': 'Sony α7R V',
  'ILCE-7RM4': 'Sony α7R IV',
  'ILCE-7SM3': 'Sony α7S III',
  'ILCE-1': 'Sony α1',
  'ILCE-9M3': 'Sony α9 III',
};

const EXPOSURE_PROGRAMS = {
  // Numeric (raw EXIF)
  1: 'M', 2: 'P', 3: 'Av', 4: 'Tv',
  5: 'Creative', 6: 'Sports', 7: 'Portrait', 8: 'Landscape',
  // String (in case exifr translates)
  'Manual': 'M',
  'Program AE': 'P',
  'Aperture-priority AE': 'Av',
  'Aperture Priority': 'Av',
  'Shutter speed priority AE': 'Tv',
  'Shutter Priority': 'Tv',
};

const METERING_MODES = {
  1: '平均', 2: '中央重点', 3: 'スポット', 4: 'マルチスポット',
  5: 'マルチ', 6: '部分',
  'Average': '平均',
  'Center-weighted average': '中央重点',
  'Spot': 'スポット',
  'Multi-spot': 'マルチスポット',
  'Multi-segment': 'マルチ',
  'Pattern': 'マルチ',
  'Partial': '部分',
};

const WHITE_BALANCES = {
  0: 'AWB', 1: 'MWB',
  'Auto': 'AWB',
  'Manual': 'MWB',
};

const COLOR_SPACES = {
  1: 'sRGB', 2: 'Adobe RGB', 65535: 'Uncalibrated',
};

function normalizeCamera(make, model) {
  if (!model) return make || '';
  if (CAMERA_NAME_MAP[model]) return CAMERA_NAME_MAP[model];
  // ARW gives "SONY", JPEG gives "Sony" — case differences harmless once joined.
  if (make && model.toLowerCase().includes(make.toLowerCase())) return model;
  if (make) return `${make} ${model}`;
  return model;
}

function cleanLensName(name) {
  if (!name) return '';
  // exifr returns LensInfo as [25, 200, 2.8, 5.6] for variable-aperture zooms
  if (Array.isArray(name)) return name.join(' ');
  return name
    .replace(/\s+[A-Z]\d{3,}\s*[A-Z]?$/, '')  // "A075 E" 等のSKU除去
    .replace(/^TAMRON/, 'Tamron')
    .replace(/^SONY/, 'Sony')
    .trim();
}

// exifr reliably returns LensModel as a marketing name for most files.
// For Resolve-stripped JPEGs LensModel may be missing — fall back to LensInfo.
function pickLens(e) {
  if (e.LensModel) return cleanLensName(e.LensModel);
  if (e.LensInfo) return cleanLensName(e.LensInfo);
  return '';
}

function getFocalLength(e) {
  if (e.FocalLength === undefined || e.FocalLength === null) return '';
  const f = parseFloat(e.FocalLength);
  if (isNaN(f)) return '';
  return `${Math.round(f)}mm`;
}

function getFocalLength35mm(e) {
  if (e.FocalLengthIn35mmFormat === undefined || e.FocalLengthIn35mmFormat === null) return '';
  const f = parseFloat(e.FocalLengthIn35mmFormat);
  if (isNaN(f)) return '';
  return `${Math.round(f)}mm`;
}

// exifr returns ExposureTime as seconds (number, e.g. 0.00625 = 1/160s).
function getShutter(e) {
  if (e.ExposureTime === undefined || e.ExposureTime === null) return '';
  const t = parseFloat(e.ExposureTime);
  if (isNaN(t) || t <= 0) return '';
  if (t >= 1) return `${t.toFixed(1)}s`;
  return `1/${Math.round(1 / t)}s`;
}

function getFNumber(e) {
  if (e.FNumber === undefined || e.FNumber === null) return '';
  const f = parseFloat(e.FNumber);
  if (isNaN(f)) return '';
  return `f/${f}`;
}

function getISO(e) {
  let iso = e.ISO ?? e.ISOSpeedRatings ?? e.RecommendedExposureIndex;
  if (Array.isArray(iso)) iso = iso[0];
  return iso ? `ISO ${iso}` : '';
}

function formatDate(s) {
  if (!s) return '';
  if (s instanceof Date) {
    if (isNaN(s.getTime())) return '';
    return s.toISOString().split('T')[0];
  }
  // Defensive: handle "2026:05:03 11:26:41" string format too
  const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(String(s));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return '';
}

function formatExposureBias(v) {
  if (v === undefined || v === null || v === '') return '';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '±0 EV';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} EV`;
}

function formatFlash(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') {
    const lc = v.toLowerCase();
    if (lc.includes('no flash')) return 'No flash';
    if (lc.includes('did not')) return 'Not fired';
    if (lc.includes('fired')) return 'Fired';
    return v;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n & 0x20) return 'No flash';
  return (n & 0x01) ? 'Fired' : 'Not fired';
}

function formatGPS(lat, lon) {
  if (lat === undefined || lat === null || lon === undefined || lon === null) return '';
  const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
  const lonNum = typeof lon === 'string' ? parseFloat(lon) : lon;
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return '';
  const ns = latNum >= 0 ? 'N' : 'S';
  const ew = lonNum >= 0 ? 'E' : 'W';
  return `${Math.abs(latNum).toFixed(4)}°${ns} ${Math.abs(lonNum).toFixed(4)}°${ew}`;
}

function formatColorSpace(v) {
  if (v === undefined || v === null) return '';
  return COLOR_SPACES[v] || (typeof v === 'string' ? v : String(v));
}

function formatDimensions(w, h) {
  if (!w || !h) return '';
  return `${w}×${h}`;
}

function formatMegapixels(w, h) {
  if (!w || !h) return '';
  return `${((w * h) / 1_000_000).toFixed(1)}MP`;
}

function formatStabilization(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') return v;
  return v ? 'On' : 'Off';
}

function formatBattery(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'string') return v.includes('%') ? v : `${v}%`;
  return `${Math.round(v)}%`;
}

function formatFocusDistance(v) {
  if (v === undefined || v === null) return '';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n) || n === 0) return '';
  return `${n.toFixed(2)}m`;
}

function mapOrPassthrough(map, v) {
  if (v === undefined || v === null || v === '') return '';
  if (Object.prototype.hasOwnProperty.call(map, v)) return map[v];
  return typeof v === 'string' ? v : String(v);
}

// ─── Public API ──────────────────────────────────────────────────────────

const EMPTY_METADATA = {
  camera: '', lens: '',
  focalLength: '', focalLength35mm: '',
  aperture: '', shutter: '', iso: '',
  exposureBias: '', exposureProgram: '', meteringMode: '',
  whiteBalance: '', flash: '',
  date: '', location: '',
  gps: '', altitude: '',
  author: '', copyright: '',
  dimensions: '', megapixels: '', colorSpace: '',
  imageStabilization: '', driveMode: '', batteryLevel: '',
  focusDistance: '', quality: '',
};

export async function readExif(file) {
  const out = { ...EMPTY_METADATA };
  let e;
  try {
    e = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      iptc: true,
      xmp: true,
      icc: true,
      makerNote: true,
      userComment: true,
      multiSegment: true,
      mergeOutput: true,
    });
  } catch (err) {
    console.warn('EXIF extraction failed:', err);
    return out;
  }
  if (!e) return out;

  console.group('[exifr Diagnostic]');
  console.log('Make:', e.Make);
  console.log('Model:', e.Model);
  console.log('LensModel:', e.LensModel);
  console.log('FocalLength:', e.FocalLength);
  console.log('FocalLengthIn35mmFormat:', e.FocalLengthIn35mmFormat);
  console.log('ExposureTime:', e.ExposureTime, '→', getShutter(e));
  console.log('FNumber:', e.FNumber);
  console.log('ISO:', e.ISO);
  console.log('DateTimeOriginal:', e.DateTimeOriginal);
  console.log('--- All keys ---');
  console.log(Object.keys(e).sort());
  console.groupEnd();

  out.camera = normalizeCamera(e.Make, e.Model);
  out.lens = pickLens(e);
  out.focalLength = getFocalLength(e);
  out.focalLength35mm = getFocalLength35mm(e);
  out.aperture = getFNumber(e);
  out.shutter = getShutter(e);
  out.iso = getISO(e);
  out.exposureBias = formatExposureBias(e.ExposureCompensation);
  out.exposureProgram = mapOrPassthrough(EXPOSURE_PROGRAMS, e.ExposureProgram);
  out.meteringMode = mapOrPassthrough(METERING_MODES, e.MeteringMode);
  out.whiteBalance = mapOrPassthrough(WHITE_BALANCES, e.WhiteBalance);
  out.flash = formatFlash(e.Flash);
  out.date = formatDate(e.DateTimeOriginal || e.CreateDate || e.ModifyDate);
  out.gps = formatGPS(e.GPSLatitude, e.GPSLongitude);
  if (e.GPSAltitude !== undefined && e.GPSAltitude !== null) {
    const altNum = typeof e.GPSAltitude === 'string' ? parseFloat(e.GPSAltitude) : e.GPSAltitude;
    out.altitude = Number.isFinite(altNum) ? `${Math.round(altNum)}m` : '';
  }
  out.author = e.Artist || '';
  out.copyright = e.Copyright || '';

  const w = e.ExifImageWidth || e.ImageWidth;
  const h = e.ExifImageHeight || e.ImageHeight;
  out.dimensions = formatDimensions(w, h);
  out.megapixels = formatMegapixels(w, h);
  out.colorSpace = formatColorSpace(e.ColorSpace);

  // MakerNote-derived fields — exifr exposes some Sony tags but coverage varies.
  // If a tag isn't present these stay empty and the row stays empty.
  out.imageStabilization = formatStabilization(e.ImageStabilization);
  out.driveMode = e.ReleaseMode2 || e.DriveMode2 || e.DriveMode || '';
  out.batteryLevel = formatBattery(e.BatteryLevel);
  out.focusDistance = formatFocusDistance(e.FocusDistance2 || e.FocusDistance || e.SubjectDistance);
  out.quality = e.Quality || '';

  return out;
}

// Extract embedded preview JPEG from a RAW file (used for RAW-only display).
//
// Cascade:
//   1. exifr.thumbnail — fast, no WASM cost. Use immediately if >50 KB.
//   2. ExifTool WASM `-j -b -JpgFromRaw` — full-size camera JPEG (~2 MB).
//   3. ExifTool WASM `-j -b -PreviewImage` — mid-size preview (~200 KB).
//   4. exifr.thumbnail (last resort) — even small thumbnails are better than nothing.
// Returns { blob, label } or null.
//
// We use `-j -b` (JSON with base64-encoded binary) instead of plain `-b`:
// parseMetadata's stdout passes through TextDecoder, which corrupts raw binary
// JPEG bytes; base64 strings survive the text channel.
export async function extractRawPreview(file) {
  console.log('[Preview] starting extraction for', file.name, `(${file.size} bytes)`);

  // 1. exifr's lightweight path
  let exifrThumb = null;
  try {
    exifrThumb = await exifr.thumbnail(file);
    if (exifrThumb) {
      console.log('[Preview] exifr.thumbnail returned', exifrThumb.byteLength, 'bytes');
      if (exifrThumb.byteLength > 50000) {
        return { blob: new Blob([exifrThumb], { type: 'image/jpeg' }), label: 'exifr thumbnail' };
      }
    } else {
      console.log('[Preview] exifr.thumbnail returned null/empty');
    }
  } catch (e) {
    console.warn('[Preview] exifr.thumbnail threw:', e);
  }

  // 2-4. Lazy-load WASM and try preview tags in priority order. ThumbnailImage
  // is the smallest (~10 KB IFD1 thumb) but always present — keeps us from
  // returning null when the larger embedded JPEGs aren't extractable.
  emitProcessing(true);
  try {
    for (const tag of ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage']) {
      try {
        console.log(`[Preview] attempting WASM ExifTool ${tag}…`);
        const blob = await extractViaExifTool(file, tag);
        if (blob && blob.size > 0) {
          console.log(`[Preview] WASM ${tag} succeeded:`, blob.size, 'bytes');
          return { blob, label: `ExifTool ${tag}` };
        }
        console.log(`[Preview] WASM ${tag}: no usable data`);
      } catch (e) {
        console.warn(`[Preview] WASM ${tag} threw:`, e);
      }
    }
  } finally {
    emitProcessing(false);
  }

  // 4. Last-resort: small exifr thumbnail (better than null)
  if (exifrThumb && exifrThumb.byteLength > 0) {
    console.log('[Preview] using small exifr thumbnail as fallback:', exifrThumb.byteLength, 'bytes');
    return { blob: new Blob([exifrThumb], { type: 'image/jpeg' }), label: 'exifr thumbnail (low-res)' };
  }

  console.warn('[Preview] all sources failed');
  return null;
}

async function extractViaExifTool(file, tag) {
  let exiftool;
  try {
    exiftool = await getExiftool();
  } catch (err) {
    console.warn(`[Preview] WASM ExifTool import failed for ${tag}:`, err);
    return null;
  }

  let result;
  try {
    result = await exiftool.parseMetadata(file, {
      args: ['-j', '-b', '-q', '-m', `-${tag}`],
      fetch: patchedFetch,
    });
  } catch (err) {
    console.warn(`[Preview] parseMetadata threw for ${tag}:`, err);
    return null;
  }

  if (!result) {
    console.log(`[Preview] ${tag}: parseMetadata returned falsy`);
    return null;
  }
  if (!result.success) {
    console.log(`[Preview] ${tag}: success=false, error=${result.error || '(none)'}`);
    return null;
  }
  if (!result.data) {
    console.log(`[Preview] ${tag}: data is empty`);
    return null;
  }

  // Quick visual check of what came back so we can spot encoding issues.
  const dataStr = typeof result.data === 'string' ? result.data : '';
  console.log(`[Preview] ${tag}: data length=${dataStr.length}, head:`, dataStr.slice(0, 120));

  let parsed;
  try {
    parsed = JSON.parse(dataStr);
  } catch (e) {
    console.warn(`[Preview] ${tag}: JSON parse failed:`, e);
    return null;
  }

  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!obj) {
    console.log(`[Preview] ${tag}: parsed object empty`);
    return null;
  }

  const value = obj[tag];
  if (value == null) {
    console.log(`[Preview] ${tag}: tag missing from response. Keys:`, Object.keys(obj));
    return null;
  }
  if (typeof value !== 'string') {
    console.log(`[Preview] ${tag}: value is not a string (type: ${typeof value})`);
    return null;
  }
  if (!value.startsWith('base64:')) {
    console.log(`[Preview] ${tag}: value lacks base64: prefix. Head:`, value.slice(0, 80));
    return null;
  }

  // Native base64 decode via data: URL fetch is much faster than atob() loops
  // for multi-MB strings.
  const res = await fetch(`data:image/jpeg;base64,${value.slice('base64:'.length)}`);
  return res.blob();
}
