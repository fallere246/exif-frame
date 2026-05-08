// Field config — single source of truth for the metadata form, the bar layout,
// and persistence.
//
// `section`        groups the field in the collapsible form panel.
// `slot`           determines where the value flows in the rendered bar.
// `defaultShow`    initial state of the per-field "表示" toggle.
// `customUI`       'logo' | 'software' → use a custom widget instead of <input>.
// `editable`       false → input is disabled (read-only EXIF mirror).

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
  [SLOTS.RIGHT_BOTTOM]: 3,
};

export const SECTIONS = [
  { id: 'basic',       label: '撮影パラメータ(基本)',   defaultOpen: true  },
  { id: 'detailed',    label: '撮影パラメータ(詳細)',   defaultOpen: false },
  { id: 'rendering',   label: '画作り',                 defaultOpen: false },
  { id: 'image',       label: '画像情報',               defaultOpen: false },
  { id: 'place',       label: '場所',                   defaultOpen: false },
  { id: 'authorInfo',  label: '作者情報',               defaultOpen: true  },
  { id: 'misc',        label: 'その他',                 defaultOpen: false },
];

// SNS-frame standard set (defaultShow:true): camera, lens, focal, aperture,
// shutter, iso, date, author. Everything else is OFF by default — user opts in.
export const FIELDS = [
  // ─── 撮影パラメータ(基本) ───────────────────────────────
  { id: 'camera',           section: 'basic',      label: 'カメラ',            editable: false, slot: SLOTS.LEFT_TOP,    defaultShow: true  },
  { id: 'lens',             section: 'basic',      label: 'レンズ',            editable: false, slot: SLOTS.LEFT_TOP,    defaultShow: true  },
  { id: 'focalLength',      section: 'basic',      label: '焦点距離',           editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true  },
  { id: 'aperture',         section: 'basic',      label: 'F値',               editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true  },
  { id: 'shutter',          section: 'basic',      label: 'シャッター',         editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true  },
  { id: 'iso',              section: 'basic',      label: 'ISO',               editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: true  },
  { id: 'exposureBias',     section: 'basic',      label: '露出補正',           editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'date',             section: 'basic',      label: '撮影日',            editable: false, slot: SLOTS.RIGHT_TOP,   defaultShow: true,  type: 'date' },

  // ─── 撮影パラメータ(詳細) ───────────────────────────────
  { id: 'focalLength35mm',  section: 'detailed',   label: '焦点距離(35mm換算)', editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'exposureProgram',  section: 'detailed',   label: '撮影モード',         editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'meteringMode',     section: 'detailed',   label: '測光',              editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'whiteBalance',     section: 'detailed',   label: 'WB',                editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'flash',            section: 'detailed',   label: 'フラッシュ',         editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'imageStabilization', section: 'detailed', label: '手ブレ補正',         editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'driveMode',        section: 'detailed',   label: 'ドライブモード',      editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'focusDistance',    section: 'detailed',   label: '被写体距離',         editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },

  // ─── 画作り ────────────────────────────────────────────
  // Note: creativeStyle / pictureProfile / lightValue are not surfaced —
  // exifr doesn't expose them reliably and ExifTool WASM had bugs.
  { id: 'colorSpace',       section: 'rendering',  label: 'カラースペース',      editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'quality',          section: 'rendering',  label: '画質設定',           editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },

  // ─── 画像情報 ──────────────────────────────────────────
  { id: 'dimensions',       section: 'image',      label: '画素サイズ',         editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'megapixels',       section: 'image',      label: 'メガピクセル',       editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },
  { id: 'batteryLevel',     section: 'image',      label: 'バッテリー残量',     editable: false, slot: SLOTS.LEFT_BOTTOM, defaultShow: false },

  // ─── 場所 ──────────────────────────────────────────────
  { id: 'location',         section: 'place',      label: '撮影地',            editable: true,  slot: SLOTS.RIGHT_TOP,   defaultShow: false, placeholder: '任意' },
  { id: 'gps',              section: 'place',      label: 'GPS座標',           editable: false, slot: SLOTS.RIGHT_TOP,   defaultShow: false },
  { id: 'altitude',         section: 'place',      label: '標高',              editable: false, slot: SLOTS.RIGHT_TOP,   defaultShow: false },

  // ─── 作者情報 ──────────────────────────────────────────
  { id: 'author',           section: 'authorInfo', label: '著者',              editable: true,  slot: SLOTS.RIGHT_BOTTOM, defaultShow: true,  placeholder: 'NISHIMURA, Sota' },
  { id: 'copyright',        section: 'authorInfo', label: '著作権',            editable: true,  slot: SLOTS.RIGHT_BOTTOM, defaultShow: false, placeholder: '© {year} {author}' },
  { id: 'software',         section: 'authorInfo', label: '現像ソフト',         editable: false, slot: SLOTS.RIGHT_BOTTOM, defaultShow: false, customUI: 'software' },

  // ─── その他 ────────────────────────────────────────────
  { id: 'logo',             section: 'misc',       label: 'ブランドロゴ',       editable: false, slot: null,              defaultShow: false, customUI: 'logo' },
];
