// Field config — single source of truth for the metadata form, the bar layout,
// and persistence. Slot determines which area of the bar the value flows into;
// SLOT_LIMITS caps how many checked fields each area can show before truncation.

export const SLOTS = {
  LEFT_TOP: 'leftTop',
  LEFT_BOTTOM: 'leftBottom',
  RIGHT_TOP: 'rightTop',
  RIGHT_BOTTOM: 'rightBottom',
};

export const SLOT_LIMITS = {
  [SLOTS.LEFT_TOP]: 2,
  [SLOTS.LEFT_BOTTOM]: 4,
  [SLOTS.RIGHT_TOP]: 2,
  [SLOTS.RIGHT_BOTTOM]: 2,
};

// editable: true only for fields EXIF doesn't reliably carry — location and author.
// hideWhenEmpty: true → row is hidden when the value is empty (ARW-only / GPS /
//                 Sony MakerNote / image-spec extras). Basic fields stay visible
//                 even when empty so the user always sees the form structure.
export const FIELDS = [
  // Camera/lens (left top) — basic, always visible
  { id: 'camera',           label: 'カメラ',           editable: false, slot: SLOTS.LEFT_TOP,    defaultShow: true,  hideWhenEmpty: false },
  { id: 'lens',             label: 'レンズ',           editable: false, slot: SLOTS.LEFT_TOP,    defaultShow: false, hideWhenEmpty: false },

  // Core shooting settings — basic, always visible
  { id: 'focalLength',      label: '焦点距離',          editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true,  hideWhenEmpty: false },
  { id: 'aperture',         label: 'F値',              editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true,  hideWhenEmpty: false },
  { id: 'shutter',          label: 'シャッター',        editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true,  hideWhenEmpty: false },
  { id: 'iso',              label: 'ISO',              editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true,  hideWhenEmpty: false },

  // ARW-only / extended settings — hidden when empty
  { id: 'focalLength35mm',  label: '焦点距離(35mm換算)', editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'exposureBias',     label: '露出補正',          editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'exposureProgram',  label: '撮影モード',        editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'meteringMode',     label: '測光',             editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'whiteBalance',     label: 'WB',               editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'flash',            label: 'フラッシュ',        editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'creativeStyle',    label: 'クリエイティブスタイル', editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'pictureProfile',   label: 'ピクチャープロファイル', editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'imageStabilization', label: '手ブレ補正',     editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'driveMode',        label: 'ドライブモード',    editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'lightValue',       label: 'LV',               editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'focusDistance',    label: '被写体距離',        editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'dimensions',       label: '画素サイズ',        editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'megapixels',       label: 'メガピクセル',      editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'colorSpace',       label: 'カラースペース',    editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'quality',          label: '画質設定',          editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },
  { id: 'batteryLevel',     label: 'バッテリー残量',    editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false, hideWhenEmpty: true },

  // Place/time
  { id: 'date',             label: '撮影日',           editable: false, slot: SLOTS.RIGHT_TOP,   defaultShow: true,  type: 'date', hideWhenEmpty: false },
  { id: 'location',         label: '撮影地',           editable: true,  slot: SLOTS.RIGHT_TOP,   defaultShow: true,  placeholder: '任意' },
  { id: 'gps',              label: 'GPS座標',          editable: false, slot: SLOTS.RIGHT_TOP,   defaultShow: false, hideWhenEmpty: true },
  { id: 'altitude',         label: '標高',             editable: false, slot: SLOTS.RIGHT_TOP,   defaultShow: false, hideWhenEmpty: true },

  // Watermark
  { id: 'author',           label: '著者',             editable: true,  slot: SLOTS.RIGHT_BOTTOM, defaultShow: true,  placeholder: 'NISHIMURA' },
  { id: 'copyright',        label: '著作権',           editable: true,  slot: SLOTS.RIGHT_BOTTOM, defaultShow: false, placeholder: '© {year} {author}' },
  { id: 'software',         label: '現像ソフト',       editable: false, slot: SLOTS.RIGHT_BOTTOM, defaultShow: false, customUI: true },
];

export const FIELD_BY_ID = Object.fromEntries(FIELDS.map(f => [f.id, f]));

// Field value can be either: meta.<id> (extracted EXIF) or meta.<id>_override (user edit)
// drawBarContent reads this via getFieldValue() to prefer override.
export function getFieldValue(meta, id) {
  return meta[id] || '';
}

// Returns ordered list of values for a given slot, respecting visibility + cap.
export function getSlotValues(meta, slot) {
  const out = [];
  for (const f of FIELDS) {
    if (f.slot !== slot) continue;
    if (!meta['show_' + f.id]) continue;
    const v = getFieldValue(meta, f.id);
    if (!v) continue;
    out.push(v);
    if (out.length >= SLOT_LIMITS[slot]) break;
  }
  return out;
}
