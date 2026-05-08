// EXIF Reader — uses @uswriting/exiftool (WebAssembly ExifTool 13.42)
//
// Why ExifTool over exifr: Resolve-exported JPEGs corrupt FNumber and drop
// LensModel; exifr inherits those gaps. Real ExifTool reads every tag the
// camera/Resolve actually wrote, so we get accurate f-stop and lens names
// from the ARW.

const EXIFTOOL_CDN = 'https://esm.sh/@uswriting/exiftool@1.0.9';
// zeroperl-ts 1.0.10 fetches "./zeroperl.wasm" with no base URL — in the
// browser that resolves to the page origin (404). We redirect that one
// request to the CDN copy via a custom fetch passed to parseMetadata.
const ZEROPERL_WASM_URL = 'https://esm.sh/@6over3/zeroperl-ts@1.0.10/dist/esm/zeroperl.wasm';

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

// Always include `fetch: patchedFetch` so zeroperl picks it up on first WASM load.
function withPatchedFetch(options = {}) {
  return { ...options, fetch: patchedFetch };
}

// Lazy-loaded module + warmup. Started by readyPromise() at boot.
let exiftoolModulePromise = null;
let readyState = 'pending'; // 'pending' | 'ready' | 'error'
let readyError = null;
const readyListeners = new Set();

export function getReadyState() { return readyState; }
export function getReadyError() { return readyError; }

export function onReadyStateChange(fn) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

function setReadyState(state, err = null) {
  readyState = state;
  readyError = err;
  for (const fn of readyListeners) {
    try { fn(state, err); } catch { /* ignore */ }
  }
}

// Begin WASM init in the background. Idempotent.
//
// Note: we used to do a "-ver" warmup against a 1-byte blob, but that left the
// embedded Perl interpreter in a corrupt state (subsequent zeroperl_reset crashed
// with "memory access out of bounds"). Now we just import the module; the first
// real parseMetadata call performs the WASM init itself.
export function preloadExiftool() {
  if (exiftoolModulePromise) return exiftoolModulePromise;
  exiftoolModulePromise = (async () => {
    try {
      const mod = await import(/* @vite-ignore */ EXIFTOOL_CDN);
      setReadyState('ready');
      return mod;
    } catch (err) {
      console.error('ExifTool preload failed:', err);
      setReadyState('error', err);
      throw err;
    }
  })();
  return exiftoolModulePromise;
}

async function getExiftool() {
  if (!exiftoolModulePromise) preloadExiftool();
  return exiftoolModulePromise;
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

// Without -n, ExifTool returns these as descriptive strings — we map them to
// short codes typical on photo bars. Numeric keys remain as a fallback in case
// any caller switches back to -n mode.
const EXPOSURE_PROGRAMS = {
  // Numeric (-n)
  1: 'M', 2: 'P', 3: 'Av', 4: 'Tv',
  5: 'Creative', 6: 'Sports', 7: 'Portrait', 8: 'Landscape',
  // String (default print conversion)
  'Manual': 'M',
  'Program AE': 'P',
  'Aperture-priority AE': 'Av',
  'Aperture Priority': 'Av',
  'Shutter speed priority AE': 'Tv',
  'Shutter Priority': 'Tv',
  'Creative (Slow speed)': 'Creative',
  'Action (High speed)': 'Sports',
  'Portrait': 'Portrait',
  'Landscape': 'Landscape',
  'Bulb': 'Bulb',
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

// LensType2 / LensType3 carry the marketing name ("Tamron 25-200mm F2.8-5.6 Di III VXD G2");
// LensModel often holds the SKU-style code ("TAMRON 25-200mm F2.8-5.6 A075 E");
// LensType (without 2/3) is sometimes a numeric Sony code (e.g. 49479) — skip it.
function pickLens(e) {
  return e.LensType2 || e.LensType3 || e.LensModel || e.LensSpec || e.LensInfo || '';
}

// Lookup map; if value isn't mapped, pass through the string (so unknown values
// still display rather than vanish).
function mapOrPassthrough(map, v) {
  if (v === undefined || v === null || v === '') return '';
  if (Object.prototype.hasOwnProperty.call(map, v)) return map[v];
  return typeof v === 'string' ? v : String(v);
}

// Without -n, ExifTool returns "1/160" (string) for fractional shutter and
// "2.5" for ≥1s. With -n, it's a decimal like 0.00625. Handle all three.
function formatShutter(t) {
  if (t === undefined || t === null || t === '') return '';
  // Already formatted as a fraction "1/160"
  if (typeof t === 'string' && t.includes('/')) {
    return t.endsWith('s') ? t : `${t}s`;
  }
  // Number or numeric string
  const n = typeof t === 'string' ? parseFloat(t) : t;
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1) return `${n}s`;
  return `1/${Math.round(1 / n)}s`;
}

// FNumber fallback: Resolve-exported JPEGs drop the FNumber tag and keep
// only ApertureValue (APEX). f = 2^(AV/2).
function pickFNumber(e) {
  const direct = e.FNumber;
  if (direct !== undefined && direct !== null && direct !== '') {
    const n = typeof direct === 'string' ? parseFloat(direct) : direct;
    if (Number.isFinite(n)) return n;
  }
  const av = e.ApertureValue ?? e.MaxApertureValue;
  if (av === undefined || av === null || av === '') return null;
  const n = typeof av === 'string' ? parseFloat(av) : av;
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.pow(2, n / 2) * 10) / 10;
}

// ExposureTime fallback: t = 2^(-SV) when only ShutterSpeedValue (APEX) is present.
function pickExposureTime(e) {
  if (e.ExposureTime !== undefined && e.ExposureTime !== null && e.ExposureTime !== '') return e.ExposureTime;
  const sv = e.ShutterSpeedValue;
  if (sv === undefined || sv === null || sv === '') return null;
  const n = typeof sv === 'string' ? parseFloat(sv) : sv;
  if (!Number.isFinite(n)) return null;
  return Math.pow(2, -n);
}

// ExifTool emits "2026:05:03 11:26:41" — JS Date doesn't parse colons in the
// date portion, so we normalize first.
function formatDate(s) {
  if (!s) return '';
  const m = /^(\d{4}):(\d{2}):(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(String(s));
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  // Fallback: try Date parsing
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return '';
}

function formatExposureBias(v) {
  if (v === undefined || v === null || v === '') return '';
  // With print conversion, ExifTool may return "+0.7", "0", "-1/3", etc.
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '0' || trimmed === '+0' || trimmed === '-0') return '±0 EV';
    return `${trimmed} EV`;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '±0 EV';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} EV`;
}

function formatFlash(v) {
  if (v === undefined || v === null || v === '') return '';
  // Print-converted: "Off, Did not fire", "Fired", "Auto, Fired", "No Flash"
  if (typeof v === 'string') {
    const lc = v.toLowerCase();
    if (lc.includes('no flash')) return 'No flash';
    if (lc.includes('did not')) return 'Not fired';
    if (lc.includes('fired')) return 'Fired';
    return v;  // last resort: show whatever we got
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n & 0x20) return 'No flash';
  return (n & 0x01) ? 'Fired' : 'Not fired';
}

function formatGPS(lat, lon) {
  if (lat === undefined || lat === null || lat === '' ||
      lon === undefined || lon === null || lon === '') return '';
  // Print conversion can yield strings like "35 deg 39' 31.21\" N" — fall back
  // to passing the raw text through if it isn't a plain number.
  const latNum = typeof lat === 'string' ? parseFloat(lat) : lat;
  const lonNum = typeof lon === 'string' ? parseFloat(lon) : lon;
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return typeof lat === 'string' && typeof lon === 'string' ? `${lat}, ${lon}` : '';
  }
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
  // Print conversion may already include "%". If not, append.
  if (typeof v === 'string') {
    return v.includes('%') ? v : `${v}%`;
  }
  return `${Math.round(v)}%`;
}

function formatFocusDistance(v) {
  if (v === undefined || v === null) return '';
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n) || n === 0) return '';
  if (n === 0xffff) return '∞';
  return `${n.toFixed(2)}m`;
}

// LV at ISO 100. LV = log2(N²/t) - log2(ISO/100). Higher = brighter scene.
function computeLightValue(N, t, iso) {
  if (!N || !t || !iso) return '';
  const lv = Math.log2((N * N) / t) - Math.log2(iso / 100);
  return `LV ${lv.toFixed(1)}`;
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
  creativeStyle: '', pictureProfile: '',
  imageStabilization: '', driveMode: '', batteryLevel: '',
  lightValue: '', focusDistance: '', quality: '',
};

export async function readExif(file) {
  const out = { ...EMPTY_METADATA };

  try {
    const exiftool = await getExiftool();
    // No -n: lets ExifTool apply print conversions so internal numeric codes
    // (e.g. LensType=49479) become human-readable strings ("Tamron 25-200mm…").
    // -q -m suppresses stderr noise (parseMetadata treats any stderr as failure).
    const result = await exiftool.parseMetadata(file, withPatchedFetch({
      args: ['-json', '-q', '-m'],
      transform: (data) => JSON.parse(data),
    }));

    if (!result || !result.success) {
      console.warn('ExifTool returned failure:', result);
      return out;
    }
    // result.data may already be parsed (transform applied) or still a raw string.
    let parsed = result.data;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    if (!Array.isArray(parsed) || !parsed[0]) {
      console.warn('ExifTool returned no parsed data:', result.data);
      return out;
    }

    const e = parsed[0];
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[EXIF]', file.name, e);
    }

    out.camera = normalizeCamera(e.Make, e.Model);
    out.lens = pickLens(e);
    const focal = e.FocalLength;
    const focalNum = typeof focal === 'string' ? parseFloat(focal) : focal;
    out.focalLength = Number.isFinite(focalNum) ? `${Math.round(focalNum)}mm` : '';
    const focal35 = e.FocalLengthIn35mmFormat;
    const focal35Num = typeof focal35 === 'string' ? parseFloat(focal35) : focal35;
    out.focalLength35mm = Number.isFinite(focal35Num) ? `${Math.round(focal35Num)}mm` : '';
    const fNumber = pickFNumber(e);
    out.aperture = fNumber !== null ? `f/${fNumber}` : '';
    const expTime = pickExposureTime(e);
    out.shutter = formatShutter(expTime);
    const iso = e.ISO ?? e.ISOSpeedRatings ?? e.RecommendedExposureIndex;
    out.iso = iso ? `ISO ${iso}` : '';
    out.exposureBias = formatExposureBias(e.ExposureCompensation);
    out.exposureProgram = mapOrPassthrough(EXPOSURE_PROGRAMS, e.ExposureProgram);
    out.meteringMode = mapOrPassthrough(METERING_MODES, e.MeteringMode);
    out.whiteBalance = mapOrPassthrough(WHITE_BALANCES, e.WhiteBalance);
    out.flash = formatFlash(e.Flash);
    out.date = formatDate(e.DateTimeOriginal || e.CreateDate || e.ModifyDate);
    out.gps = formatGPS(e.GPSLatitude, e.GPSLongitude);
    if (e.GPSAltitude !== undefined && e.GPSAltitude !== null && e.GPSAltitude !== '') {
      const altNum = typeof e.GPSAltitude === 'string'
        ? parseFloat(e.GPSAltitude)
        : e.GPSAltitude;
      out.altitude = Number.isFinite(altNum) ? `${Math.round(altNum)}m` : '';
    }
    out.author = e.Artist || '';
    out.copyright = e.Copyright || '';

    const w = e.ExifImageWidth || e.ImageWidth;
    const h = e.ExifImageHeight || e.ImageHeight;
    out.dimensions = formatDimensions(w, h);
    out.megapixels = formatMegapixels(w, h);
    out.colorSpace = formatColorSpace(e.ColorSpace);

    out.creativeStyle = e.CreativeStyle || '';
    out.pictureProfile = e.PictureProfile || '';
    out.imageStabilization = formatStabilization(e.ImageStabilization);
    out.driveMode = e.ReleaseMode2 || e.DriveMode2 || e.DriveMode || '';
    out.batteryLevel = formatBattery(e.BatteryLevel);

    out.lightValue = computeLightValue(fNumber, expTime, iso);
    out.focusDistance = formatFocusDistance(e.FocusDistance2 || e.FocusDistance || e.SubjectDistance);
    out.quality = e.Quality || '';
  } catch (err) {
    console.warn('EXIF extraction failed:', err);
  }

  return out;
}

// Extract embedded preview JPEG from a RAW file (used for RAW-only display).
//
// Why we don't use `-b` directly: parseMetadata pipes stdout through TextDecoder,
// which corrupts binary JPEG bytes. Instead, request all three preview tags
// in one `-j -b -q` call — ExifTool emits them as `base64:...` strings inside
// JSON, which survives the text channel. We then decode the first match.
//
// Sony ARW typically carries all three; we prefer the largest:
//   JpgFromRaw     ~2-3 MB, full-size camera-rendered JPEG (best for display)
//   PreviewImage   ~200-300 KB, mid-size preview
//   ThumbnailImage ~10 KB, last-resort tiny thumbnail
const PREVIEW_TAGS = [
  { key: 'JpgFromRaw', label: 'JpgFromRaw 高解像度' },
  { key: 'PreviewImage', label: 'PreviewImage' },
  { key: 'ThumbnailImage', label: 'ThumbnailImage 低解像度' },
];

async function base64ToBlob(b64) {
  // Use the data: URL fetch path so the browser handles base64 decode in
  // optimized native code (atob() in a JS loop is slow for ~4 MB strings).
  const res = await fetch(`data:image/jpeg;base64,${b64}`);
  return res.blob();
}

export async function extractRawPreview(file) {
  const exiftool = await getExiftool();
  const failures = [];

  // Try each tag in its own parseMetadata call. Combining all three in one call
  // would put ~4 MB of base64 in the WASM stdout buffer at once, which seems to
  // contribute to "memory access out of bounds" on large ARW files.
  for (const { key, label } of PREVIEW_TAGS) {
    let result;
    try {
      result = await exiftool.parseMetadata(file, withPatchedFetch({
        args: ['-j', '-b', '-q', '-m', `-${key}`],
      }));
    } catch (err) {
      failures.push(`${key}: parseMetadata threw (${err && err.message || err})`);
      continue;
    }
    if (!result || !result.success || !result.data) {
      failures.push(`${key}: ${(result && result.error) || 'no data'}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(result.data);
    } catch (err) {
      failures.push(`${key}: JSON parse failed`);
      continue;
    }
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const value = obj && obj[key];
    if (value == null) {
      failures.push(`${key}: tag missing`);
      continue;
    }
    if (typeof value !== 'string' || !value.startsWith('base64:')) {
      failures.push(`${key}: unexpected format (${typeof value})`);
      continue;
    }
    try {
      const blob = await base64ToBlob(value.slice('base64:'.length));
      if (blob.size > 0) {
        console.debug(`[RAW preview] hit ${key} (${blob.size} bytes)`);
        return { blob, tag: key, label };
      }
      failures.push(`${key}: empty blob after decode`);
    } catch (err) {
      failures.push(`${key}: decode failed (${err && err.message || err})`);
    }
  }

  console.warn('[RAW preview] all tags failed:', failures);
  throw new Error('No embedded preview image found in RAW file');
}
