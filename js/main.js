// Main Application Module
import { readExif, extractRawPreview, onPreviewProcessing } from './exif-reader.js';
import { renderPreview, exportImage } from './renderer.js';
import { FIELDS, SECTIONS } from './fields.js';

const STORAGE_KEY = 'exifFrameAppPreferences';
const LEGACY_STORAGE_KEY = 'exif-frame-settings';
const JPEG_LIMIT = 50 * 1024 * 1024;
const RAW_LIMIT = 200 * 1024 * 1024;
const RAW_EXTS = /\.(arw|cr3|cr2|nef|raf|dng|rw2|orf|pef|srw)$/i;
const JPEG_EXTS = /\.(jpe?g|png|heic|heif)$/i;

const SOFTWARE_OPTIONS = [
  { value: '',                   label: 'なし (表示しない)' },
  { value: 'DaVinci Resolve',    label: 'DaVinci Resolve' },
  { value: 'Adobe Lightroom',    label: 'Adobe Lightroom' },
  { value: 'Adobe Photoshop',    label: 'Adobe Photoshop' },
  { value: 'Capture One',        label: 'Capture One' },
  { value: 'Sony Imaging Edge',  label: 'Sony Imaging Edge' },
  { value: 'Darktable',          label: 'Darktable' },
  { value: 'RawTherapee',        label: 'RawTherapee' },
  { value: 'other',              label: 'その他...' },
];

const LOGO_OPTIONS = [
  { value: 'none',       label: 'なし (テキストのみ)' },
  { value: 'sony-alpha', label: 'Sony α' },
  { value: 'sony',       label: 'SONY' },
  { value: 'pixel',      label: 'Pixel' },
  { value: 'google-g',   label: 'Google G (カラー)' },
  { value: 'apple',      label: 'Apple' },
  { value: 'olympus',    label: 'OLYMPUS' },
  { value: 'om-system',  label: 'OM SYSTEM' },
  { value: 'insta360',   label: 'Insta360' },
];

const PRESERVE = new Set(['author']);  // values kept across photo loads

// State
let jpegFile = null;
let rawFile = null;
let currentImage = null;
let currentImageUrl = null;
let currentFileName = '';
let currentMetadata = {};
let displaySource = 'none';
let exifSource = 'none';
let rawPreviewSource = null;
let currentTemplate = 'minimal-white';
let copyrightTemplate = '© {year} {author}';

// DOM Elements (resolved at init)
const dropzonesEl = document.getElementById('dropzones');
const jpegDropZone = document.getElementById('jpeg-drop-zone');
const rawDropZone = document.getElementById('raw-drop-zone');
const jpegFileInput = document.getElementById('jpeg-file-input');
const rawFileInput = document.getElementById('raw-file-input');
const previewSection = document.getElementById('preview-section');
const previewCanvas = document.getElementById('preview-canvas');
const metadataForm = document.getElementById('metadata-form');
const exportBtn = document.getElementById('export-btn');
const templateBtns = document.querySelectorAll('.template-btn');
const resetBtn = document.getElementById('reset-btn');
const customControls = document.getElementById('custom-controls');
const resetPrefsBtn = document.getElementById('reset-prefs-btn');

const jpegFileName = document.getElementById('jpeg-file-name');
const jpegPickBtn = document.getElementById('jpeg-pick-btn');
const jpegRemoveBtn = document.getElementById('jpeg-remove-btn');
const rawFileName = document.getElementById('raw-file-name');
const rawPickBtn = document.getElementById('raw-pick-btn');
const rawRemoveBtn = document.getElementById('raw-remove-btn');
const displaySourceLabel = document.getElementById('display-source-label');
const exifSourceLabel = document.getElementById('exif-source-label');
const statusHint = document.getElementById('status-hint');

// --- Initialization ---

function init() {
  buildForm();
  loadSettings();
  setupEventListeners();
  cleanupLegacyServiceWorker();
  // exif-reader emits start/end events when it lazy-loads ExifTool WASM
  // for RAW preview extraction — surface a banner so the user knows why
  // the first ARW load is slow.
  onPreviewProcessing((active) => {
    if (active) {
      showProcessing('プレビュー画像を読み込み中... (初回は数秒、2回目以降はキャッシュで高速)');
    } else {
      hideProcessing();
    }
  });
}

function showProcessing(message) {
  const banner = document.getElementById('processing-banner');
  const text = document.getElementById('processing-message');
  if (banner && text) {
    text.textContent = message;
    banner.classList.remove('hidden');
  }
}

function hideProcessing() {
  const banner = document.getElementById('processing-banner');
  if (banner) banner.classList.add('hidden');
}

// The previous ExifTool WASM build registered a Service Worker for caching
// zeroperl.wasm. We don't need it any more — clean up so users coming back
// from the old version don't keep stale cached responses.
function cleanupLegacyServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) reg.unregister().catch(() => {});
  }).catch(() => {});
  if ('caches' in self) {
    caches.keys().then((keys) => {
      for (const k of keys) {
        if (/exif-frame|exiftool/i.test(k)) caches.delete(k).catch(() => {});
      }
    }).catch(() => {});
  }
}

// --- Form rendering (sections + fields) ---

function buildForm() {
  metadataForm.innerHTML = '';
  for (const section of SECTIONS) {
    const sectionEl = document.createElement('details');
    sectionEl.className = 'form-section';
    sectionEl.dataset.section = section.id;
    if (section.defaultOpen) sectionEl.open = true;

    const summary = document.createElement('summary');
    summary.innerHTML =
      '<span class="section-toggle">▶</span>' +
      `<span class="section-label">${section.label}</span>` +
      `<span class="section-count" data-section-count="${section.id}"></span>`;
    sectionEl.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'section-body';
    for (const f of FIELDS) {
      if (f.section !== section.id) continue;
      body.appendChild(renderFieldRow(f));
    }
    sectionEl.appendChild(body);
    metadataForm.appendChild(sectionEl);
  }
  updateSectionCounts();
}

function renderFieldRow(f) {
  const row = document.createElement('div');
  row.className = 'info-row';
  row.dataset.field = f.id;

  const label = document.createElement('label');
  label.htmlFor = f.id;
  label.textContent = f.label;
  row.appendChild(label);

  if (f.customUI === 'logo') {
    const select = document.createElement('select');
    select.id = 'logo';
    for (const o of LOGO_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
    row.appendChild(select);
  } else if (f.customUI === 'software') {
    const wrap = document.createElement('div');
    wrap.className = 'software-controls';
    const select = document.createElement('select');
    select.id = 'software';
    for (const o of SOFTWARE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      select.appendChild(opt);
    }
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.id = 'softwareCustom';
    customInput.className = 'hidden';
    customInput.placeholder = 'ソフト名を入力';
    wrap.appendChild(select);
    wrap.appendChild(customInput);
    row.appendChild(wrap);
  } else {
    const input = document.createElement('input');
    input.type = f.type === 'date' ? 'date' : 'text';
    input.id = f.id;
    if (f.placeholder) input.placeholder = f.placeholder;
    if (!f.editable) input.disabled = true;
    row.appendChild(input);
    if (f.id === 'aperture') {
      const warn = document.createElement('span');
      warn.className = 'f-value-warning';
      warn.textContent = '⚠ RAW読み込み推奨';
      row.appendChild(warn);
    }
  }

  const showWrap = document.createElement('label');
  showWrap.className = 'show-toggle';
  showWrap.title = '画像に表示する';
  const showCb = document.createElement('input');
  showCb.type = 'checkbox';
  showCb.id = 'show_' + f.id;
  showCb.checked = !!f.defaultShow;
  showWrap.appendChild(showCb);
  showWrap.appendChild(document.createTextNode('表示'));
  row.appendChild(showWrap);

  return row;
}

function updateSectionCounts() {
  for (const section of SECTIONS) {
    const fieldsInSection = FIELDS.filter((f) => f.section === section.id);
    const total = fieldsInSection.length;
    const checked = fieldsInSection.filter((f) => {
      const cb = document.getElementById('show_' + f.id);
      return cb && cb.checked;
    }).length;
    const counter = document.querySelector(`[data-section-count="${section.id}"]`);
    if (counter) counter.textContent = `${checked}/${total} 表示`;
  }
}

// --- Storage ---

function loadSettings() {
  let saved = readPrefs();
  if (!saved) saved = migrateLegacy();
  if (!saved) return;

  if (saved.preferences) {
    const p = saved.preferences;
    if (p.author !== undefined) setInput('author', p.author);
    if (p.copyrightTemplate) copyrightTemplate = p.copyrightTemplate;
    if (p.editingSoftware !== undefined) setInput('software', p.editingSoftware);
    if (p.editingSoftwareCustom !== undefined) setInput('softwareCustom', p.editingSoftwareCustom);
    if (p.logo !== undefined) setInput('logo', p.logo);
    if (p.customFrame !== undefined) setInput('customFrame', p.customFrame);
    if (p.customBar !== undefined) setInput('customBar', p.customBar);
    if (p.cornerRadius !== undefined) setInput('cornerRadius', p.cornerRadius);
    if (p.preferredTemplate) {
      currentTemplate = p.preferredTemplate;
      updateTemplateUI();
    }
    if (p.sectionOpen) {
      for (const [id, open] of Object.entries(p.sectionOpen)) {
        const el = document.querySelector(`details.form-section[data-section="${id}"]`);
        if (el) el.open = !!open;
      }
    }
  }

  if (saved.visibleFields) {
    for (const [id, visible] of Object.entries(saved.visibleFields)) {
      const cb = document.getElementById('show_' + id);
      if (cb) cb.checked = !!visible;
    }
    updateSectionCounts();
  }

  updateSoftwareCustomVisibility();
}

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch { return null; }
}

// One-time migration from the v3-era flat shape so returning users keep their
// author / camera defaults / show toggles without re-configuring.
function migrateLegacy() {
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)); }
  catch { return null; }
  if (!legacy) return null;

  const visibleFields = {};
  const preferences = {};
  if (legacy.defaults) {
    const d = legacy.defaults;
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('show_')) visibleFields[k.slice(5)] = !!v;
      else if (['author', 'logo', 'customFrame', 'customBar', 'cornerRadius'].includes(k)) preferences[k] = v;
    }
  }
  if (legacy.preferredTemplate) preferences.preferredTemplate = legacy.preferredTemplate;
  if (legacy.preferredEditingSoftware !== undefined) preferences.editingSoftware = legacy.preferredEditingSoftware;
  if (legacy.customEditingSoftware !== undefined) preferences.editingSoftwareCustom = legacy.customEditingSoftware;
  if (legacy.copyrightTemplate) preferences.copyrightTemplate = legacy.copyrightTemplate;

  const migrated = { visibleFields, preferences };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* quota? leave legacy in place */ }
  return migrated;
}

function saveSettings() {
  const visibleFields = {};
  for (const f of FIELDS) {
    const cb = document.getElementById('show_' + f.id);
    if (cb) visibleFields[f.id] = cb.checked;
  }

  const sectionOpen = {};
  for (const section of SECTIONS) {
    const el = document.querySelector(`details.form-section[data-section="${section.id}"]`);
    if (el) sectionOpen[section.id] = el.open;
  }

  const preferences = {
    author: getInput('author'),
    copyrightTemplate,
    editingSoftware: getInput('software'),
    editingSoftwareCustom: getInput('softwareCustom'),
    logo: getInput('logo'),
    customFrame: getInput('customFrame'),
    customBar: getInput('customBar'),
    cornerRadius: getInput('cornerRadius'),
    preferredTemplate: currentTemplate,
    sectionOpen,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ visibleFields, preferences }));
  } catch (err) {
    console.warn('Failed to persist preferences:', err);
  }
}

function getInput(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setInput(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined && value !== null) el.value = value;
}

// --- Event Listeners ---

function setupEventListeners() {
  attachDropZone(jpegDropZone, (file) => acceptJpeg(file));
  jpegDropZone.addEventListener('click', () => jpegFileInput.click());
  jpegFileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) acceptJpeg(f);
    e.target.value = '';
  });

  attachDropZone(rawDropZone, (file) => acceptRaw(file));
  rawDropZone.addEventListener('click', () => rawFileInput.click());
  rawFileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) acceptRaw(f);
    e.target.value = '';
  });

  jpegPickBtn.addEventListener('click', () => jpegFileInput.click());
  jpegRemoveBtn.addEventListener('click', removeJpeg);
  rawPickBtn.addEventListener('click', () => rawFileInput.click());
  rawRemoveBtn.addEventListener('click', removeRaw);

  // Listen on the form root — picks up inputs inside dynamically generated rows.
  metadataForm.addEventListener('input', onFormChange);
  metadataForm.addEventListener('change', onFormChange);

  // Persist section open/closed state
  for (const section of SECTIONS) {
    const el = document.querySelector(`details.form-section[data-section="${section.id}"]`);
    if (el) el.addEventListener('toggle', saveSettings);
  }

  // Custom-template controls live outside metadataForm
  for (const id of ['customFrame', 'customBar', 'cornerRadius']) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', onFormChange);
      el.addEventListener('change', onFormChange);
    }
  }

  for (const btn of templateBtns) {
    btn.addEventListener('click', () => {
      currentTemplate = btn.dataset.template;
      updateTemplateUI();
      saveSettings();
      render();
    });
  }

  exportBtn.addEventListener('click', handleExport);
  resetBtn.addEventListener('click', resetAll);

  if (resetPrefsBtn) resetPrefsBtn.addEventListener('click', handleResetPrefs);
}

function attachDropZone(zoneEl, onFile) {
  zoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    zoneEl.classList.add('dragover');
  });
  zoneEl.addEventListener('dragleave', () => zoneEl.classList.remove('dragover'));
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneEl.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

function updateSoftwareCustomVisibility() {
  const select = document.getElementById('software');
  const custom = document.getElementById('softwareCustom');
  if (!select || !custom) return;
  custom.classList.toggle('hidden', select.value !== 'other');
}

// --- File Acceptance ---

async function acceptJpeg(file) {
  const isImage = file.type.startsWith('image/') || JPEG_EXTS.test(file.name);
  if (!isImage) {
    alert('対応形式: JPEG, PNG, HEIC');
    return;
  }
  if (file.size > JPEG_LIMIT) {
    alert('JPEGファイルが50MBを超えています。リサイズしてからお試しください。');
    return;
  }
  jpegFile = file;
  await loadJpegImage(file);
  displaySource = 'jpeg';
  currentFileName = file.name.replace(/\.[^/.]+$/, '');
  await refreshExif();
  showPreviewSection();
  updateFileStatus();
}

async function acceptRaw(file) {
  if (!RAW_EXTS.test(file.name)) {
    alert('対応RAW形式: ARW, CR3, CR2, NEF, RAF, DNG, RW2, ORF, PEF, SRW');
    return;
  }
  if (file.size > RAW_LIMIT) {
    alert('RAWファイルが200MBを超えています。');
    return;
  }
  rawFile = file;
  if (!jpegFile) {
    try {
      await loadRawPreviewImage(file);
      displaySource = 'raw-preview';
      currentFileName = file.name.replace(/\.[^/.]+$/, '');
    } catch (err) {
      alert('RAWに埋め込みプレビューが見つかりません。JPEG等の表示用画像も追加してください。');
      console.warn(err);
      rawFile = null;
      return;
    }
  }
  await refreshExif();
  showPreviewSection();
  updateFileStatus();
}

async function removeJpeg() {
  jpegFile = null;
  releaseImage();
  if (rawFile) {
    try {
      await loadRawPreviewImage(rawFile);
      displaySource = 'raw-preview';
      currentFileName = rawFile.name.replace(/\.[^/.]+$/, '');
      await refreshExif();
      updateFileStatus();
    } catch (err) {
      alert('RAWに埋め込みプレビューが見つかりません。');
      console.warn(err);
      rawFile = null;
      resetAll();
    }
  } else {
    resetAll();
  }
}

async function removeRaw() {
  rawFile = null;
  if (jpegFile) {
    await refreshExif();
    updateFileStatus();
  } else {
    resetAll();
  }
}

function resetAll() {
  jpegFile = null;
  rawFile = null;
  releaseImage();
  currentFileName = '';
  displaySource = 'none';
  exifSource = 'none';
  rawPreviewSource = null;
  currentMetadata = {};
  clearForm();
  previewSection.classList.add('hidden');
  dropzonesEl.classList.remove('hidden');
  updateFileStatus();
}

function releaseImage() {
  currentImage = null;
  if (currentImageUrl) {
    URL.revokeObjectURL(currentImageUrl);
    currentImageUrl = null;
  }
}

function showPreviewSection() {
  dropzonesEl.classList.add('hidden');
  previewSection.classList.remove('hidden');
}

function loadJpegImage(file) {
  releaseImage();
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      currentImageUrl = url;
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

async function loadRawPreviewImage(file) {
  const result = await extractRawPreview(file);
  if (!result) throw new Error('No embedded preview in RAW file');
  const { blob, label } = result;
  rawPreviewSource = { label };
  const url = URL.createObjectURL(blob);
  releaseImage();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      currentImageUrl = url;
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Embedded preview image load failed'));
    };
    img.src = url;
  });
}

// --- EXIF refresh ---

async function refreshExif() {
  const source = rawFile || jpegFile;
  if (!source) {
    exifSource = 'none';
    return;
  }
  exifSource = rawFile ? 'raw' : 'jpeg';

  const exifData = await readExif(source);
  const savedAuthor = getInput('author');
  currentMetadata = {
    ...exifData,
    author: exifData.author || savedAuthor || 'NISHIMURA, Sota',
  };
  populateForm(currentMetadata);
  resolveCopyrightIntoForm();
  render();
}

function resolveCopyrightIntoForm() {
  const el = document.getElementById('copyright');
  if (!el) return;
  const dateVal = getInput('date');
  const year = dateVal ? new Date(dateVal).getFullYear() : new Date().getFullYear();
  const author = getInput('author') || '';
  el.value = copyrightTemplate
    .replace(/\{year\}/g, year)
    .replace(/\{author\}/g, author);
}

// --- File status UI ---

function updateFileStatus() {
  if (jpegFile) {
    jpegFileName.textContent = jpegFile.name;
    jpegFileName.classList.remove('placeholder');
    jpegPickBtn.textContent = '変更';
    jpegRemoveBtn.classList.remove('hidden');
  } else {
    jpegFileName.textContent = 'JPEG未選択';
    jpegFileName.classList.add('placeholder');
    jpegPickBtn.textContent = '選択';
    jpegRemoveBtn.classList.add('hidden');
  }

  if (rawFile) {
    rawFileName.textContent = rawFile.name;
    rawFileName.classList.remove('placeholder');
    rawPickBtn.textContent = '変更';
    rawRemoveBtn.classList.remove('hidden');
  } else {
    rawFileName.textContent = 'RAW未選択';
    rawFileName.classList.add('placeholder');
    rawPickBtn.textContent = '選択';
    rawRemoveBtn.classList.add('hidden');
  }

  let displayMsg = '';
  let exifMsg = '';
  let exifPartial = false;
  let hint = '';

  if (jpegFile && rawFile) {
    displayMsg = '表示画像: JPEGファイル';
    exifMsg = 'EXIFソース: RAWファイル(完全)';
  } else if (jpegFile) {
    displayMsg = '表示画像: JPEGファイル';
    exifMsg = 'EXIFソース: JPEGファイル(一部欠落の可能性)';
    exifPartial = true;
    hint = '💡 RAWを追加すると完全な情報が表示されます';
  } else if (rawFile) {
    const tagSuffix = rawPreviewSource ? ` (${rawPreviewSource.label})` : '';
    displayMsg = `表示画像: RAW埋め込みプレビュー${tagSuffix}`;
    exifMsg = 'EXIFソース: RAWファイル(完全)';
    hint = '💡 Resolveで現像したJPEGを追加すると、より高品質な表示になります';
  }

  displaySourceLabel.textContent = displayMsg;
  exifSourceLabel.textContent = exifMsg;
  exifSourceLabel.classList.toggle('partial', exifPartial);
  statusHint.textContent = hint;

  metadataForm.classList.toggle('f-value-warn', exifSource === 'jpeg');
}

// --- Form data ---

function populateForm(metadata) {
  for (const f of FIELDS) {
    if (f.customUI) continue;
    const el = document.getElementById(f.id);
    if (!el) continue;
    if (!f.editable) {
      el.value = metadata[f.id] || '';
    } else if (metadata[f.id]) {
      el.value = metadata[f.id];
    }
  }
}

function clearForm() {
  for (const f of FIELDS) {
    if (PRESERVE.has(f.id)) continue;
    if (f.customUI) continue;
    const el = document.getElementById(f.id);
    if (el) el.value = '';
  }
}

function readFormMetadata() {
  const data = {};
  for (const f of FIELDS) {
    const cb = document.getElementById('show_' + f.id);
    if (cb) data['show_' + f.id] = cb.checked;
    if (f.customUI === 'software') continue;  // resolved below
    if (f.customUI === 'logo') continue;
    const el = document.getElementById(f.id);
    if (el) data[f.id] = el.value;
  }
  // Software resolved value (dropdown OR custom text when "other" picked)
  const softwareSelect = document.getElementById('software');
  const softwareCustom = document.getElementById('softwareCustom');
  if (softwareSelect) {
    data.software = softwareSelect.value === 'other'
      ? (softwareCustom ? softwareCustom.value : '')
      : softwareSelect.value;
  }
  // Logo + custom-template knobs
  data.logo = getInput('logo');
  data.customFrame = getInput('customFrame');
  data.customBar = getInput('customBar');
  data.cornerRadius = getInput('cornerRadius');
  return data;
}

// --- Rendering ---

function onFormChange(event) {
  if (event && event.target) {
    if (event.target.id === 'copyright') copyrightTemplate = event.target.value;
    if (event.target.id === 'software') updateSoftwareCustomVisibility();
  }
  currentMetadata = readFormMetadata();
  updateSectionCounts();
  saveSettings();
  render();
}

function render() {
  if (!currentImage) return;
  const metadata = readFormMetadata();
  renderPreview(previewCanvas, currentImage, metadata, currentTemplate);
}

function updateTemplateUI() {
  for (const btn of templateBtns) {
    btn.classList.toggle('active', btn.dataset.template === currentTemplate);
  }
  customControls.classList.toggle('hidden', currentTemplate !== 'custom');
}

// --- Export ---

async function handleExport() {
  if (!currentImage) return;
  exportBtn.disabled = true;
  exportBtn.textContent = '書き出し中...';
  // Wait for Webfonts (Noto Sans / Noto Sans JP) to fully load before
  // rendering — otherwise the exported JPEG may use the system fallback.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* ignore */ }
  }
  render();
  const blob = await exportImage(previewCanvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentFileName}_framed.jpg`;
  a.click();
  URL.revokeObjectURL(url);
  exportBtn.disabled = false;
  exportBtn.textContent = '書き出し';
}

// --- Preferences reset ---

function handleResetPrefs() {
  if (!confirm('保存された設定を初期化しますか? 表示項目・著者名・現像ソフト・テンプレート設定などが既定値に戻ります。')) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* ignore */ }
  copyrightTemplate = '© {year} {author}';
  currentTemplate = 'minimal-white';
  buildForm();
  // Re-attach toggle listeners on freshly built sections
  for (const section of SECTIONS) {
    const el = document.querySelector(`details.form-section[data-section="${section.id}"]`);
    if (el) el.addEventListener('toggle', saveSettings);
  }
  // Reset custom-template selectors to defaults
  setInput('customFrame', 'none');
  setInput('customBar', 'white');
  setInput('cornerRadius', 'none');
  setInput('logo', 'sony-alpha');
  setInput('software', '');
  setInput('softwareCustom', '');
  updateSoftwareCustomVisibility();
  updateTemplateUI();
  if (currentImage) {
    resolveCopyrightIntoForm();
    render();
  }
}

init();
