// Main Application Module
import {
  readExif,
  extractRawPreview,
  preloadExiftool,
  onReadyStateChange,
  getReadyState,
} from './exif-reader.js';
import { renderPreview, exportImage } from './renderer.js';
import { FIELDS } from './fields.js';

const STORAGE_KEY = 'exif-frame-settings';
const JPEG_LIMIT = 50 * 1024 * 1024;
const RAW_LIMIT = 200 * 1024 * 1024;
const RAW_EXTS = /\.(arw|cr3|cr2|nef|raf|dng|rw2|orf|pef|srw)$/i;
const JPEG_EXTS = /\.(jpe?g|png|heic|heif)$/i;

// State
let jpegFile = null;
let rawFile = null;
let currentImage = null;
let currentImageUrl = null;  // for revoking object URLs we create
let currentFileName = '';
let currentMetadata = {};
let displaySource = 'none';  // 'jpeg' | 'raw-preview' | 'none'
let exifSource = 'none';     // 'raw'  | 'jpeg'        | 'none'
let rawPreviewSource = null; // { tag, label } when display is RAW preview
let currentTemplate = 'minimal-white';

// DOM Elements
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

const jpegFileName = document.getElementById('jpeg-file-name');
const jpegPickBtn = document.getElementById('jpeg-pick-btn');
const jpegRemoveBtn = document.getElementById('jpeg-remove-btn');
const rawFileName = document.getElementById('raw-file-name');
const rawPickBtn = document.getElementById('raw-pick-btn');
const rawRemoveBtn = document.getElementById('raw-remove-btn');
const displaySourceLabel = document.getElementById('display-source-label');
const exifSourceLabel = document.getElementById('exif-source-label');
const statusHint = document.getElementById('status-hint');

const softwareSelect = document.getElementById('software');
const softwareCustom = document.getElementById('softwareCustom');
const showSoftwareCb = document.getElementById('show_software');

const EXTRA_INPUTS = ['logo', 'show_logo', 'customFrame', 'customBar', 'cornerRadius'];
const PRESERVE = new Set(['author']);

// --- Initialization ---

function init() {
  buildForm();
  loadSettings();
  setupEventListeners();
  setupStatusBadge();
  registerServiceWorker();
  // Kick off WASM init in the background so the user's first file is fast.
  preloadExiftool();
}

function setupStatusBadge() {
  const badge = document.getElementById('exiftool-status');
  const text = document.getElementById('exiftool-status-text');
  if (!badge || !text) return;

  const apply = (state) => {
    badge.classList.remove('loading', 'ready', 'error');
    badge.classList.add(state);
    if (state === 'ready') text.textContent = 'ExifTool 準備完了 ✓';
    else if (state === 'error') text.textContent = 'ExifTool 読み込み失敗';
    else text.textContent = 'ExifTool 読み込み中…';
  };

  apply(getReadyState());
  onReadyStateChange(apply);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Use relative path so it works on GitHub Pages (/exif-frame/) and on
  // the apex domain alike.
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('Service worker registration failed:', err);
  });
}

function buildForm() {
  metadataForm.innerHTML = '';
  for (const f of FIELDS) {
    if (f.customUI) continue;  // rendered as a dedicated row in HTML
    const row = document.createElement('div');
    row.className = 'info-row';
    row.dataset.field = f.id;

    const label = document.createElement('label');
    label.htmlFor = f.id;
    label.textContent = f.label;

    const input = document.createElement('input');
    input.type = f.type === 'date' ? 'date' : 'text';
    input.id = f.id;
    if (f.placeholder) input.placeholder = f.placeholder;
    if (!f.editable) input.disabled = true;

    const showWrap = document.createElement('label');
    showWrap.className = 'show-toggle';
    showWrap.title = '画像に表示する';
    const showCb = document.createElement('input');
    showCb.type = 'checkbox';
    showCb.id = 'show_' + f.id;
    showCb.checked = !!f.defaultShow;
    showWrap.appendChild(showCb);
    showWrap.appendChild(document.createTextNode('表示'));

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(showWrap);
    if (f.id === 'aperture') {
      // Inline note that appears only when EXIF source is JPEG (FNumber unreliable).
      const warn = document.createElement('span');
      warn.className = 'f-value-warning';
      warn.textContent = '⚠ RAW読み込み推奨';
      input.after(warn);  // sits between input and show-toggle
    }
    metadataForm.appendChild(row);
  }
}

function getInputIds() {
  const ids = [];
  for (const f of FIELDS) {
    if (!f.customUI) ids.push(f.id);
    ids.push('show_' + f.id);
  }
  ids.push(...EXTRA_INPUTS);
  ids.push('software', 'softwareCustom');
  return ids;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    if (saved.defaults) {
      for (const [id, value] of Object.entries(saved.defaults)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
      }
    }
    if (saved.preferredEditingSoftware !== undefined) {
      softwareSelect.value = saved.preferredEditingSoftware;
    }
    if (saved.customEditingSoftware !== undefined) {
      softwareCustom.value = saved.customEditingSoftware;
    }
    updateSoftwareCustomVisibility();
    if (saved.copyrightTemplate) {
      copyrightTemplate = saved.copyrightTemplate;
    }
    if (saved.preferredTemplate) {
      currentTemplate = saved.preferredTemplate;
      updateTemplateUI();
    }
  } catch (e) { /* ignore */ }
}

function saveSettings() {
  const defaults = {};
  for (const id of PRESERVE) {
    const el = document.getElementById(id);
    if (el) defaults[id] = el.value;
  }
  for (const f of FIELDS) {
    const cb = document.getElementById('show_' + f.id);
    if (cb) defaults['show_' + f.id] = cb.checked;
  }
  for (const id of ['logo', 'show_logo', 'customFrame', 'customBar', 'cornerRadius']) {
    const el = document.getElementById(id);
    if (!el) continue;
    defaults[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    defaults,
    preferredTemplate: currentTemplate,
    preferredEditingSoftware: softwareSelect.value,
    customEditingSoftware: softwareCustom.value,
    copyrightTemplate,
  }));
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

  for (const id of getInputIds()) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input', onFormChange);
    el.addEventListener('change', onFormChange);
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

  // Software dropdown: toggle custom input visibility when "other" is chosen
  softwareSelect.addEventListener('change', updateSoftwareCustomVisibility);
}

function updateSoftwareCustomVisibility() {
  softwareCustom.classList.toggle('hidden', softwareSelect.value !== 'other');
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

  // RAW alone: extract embedded preview to use as display image
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
    // Fall back to RAW embedded preview
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
    // JPEG remains as display, EXIF re-derives from JPEG
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

// Load JPEG/PNG/HEIC as the display image
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

// Extract embedded JPEG preview from RAW (cascading tags: JpgFromRaw → PreviewImage
// → ThumbnailImage) and use it as the display image. Records which tag yielded
// the image so the UI can surface it.
async function loadRawPreviewImage(file) {
  const { blob, tag, label } = await extractRawPreview(file);
  rawPreviewSource = { tag, label };
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

// --- EXIF Refresh ---

async function refreshExif() {
  const source = rawFile || jpegFile;
  if (!source) {
    exifSource = 'none';
    return;
  }
  exifSource = rawFile ? 'raw' : 'jpeg';

  const exifData = await readExif(source);
  const savedAuthor = document.getElementById('author').value;
  currentMetadata = {
    ...exifData,
    author: exifData.author || savedAuthor || 'NISHIMURA',
  };
  populateForm(currentMetadata);
  resolveCopyrightIntoForm();
  render();
}

// Default template uses placeholders so year/author update per-photo.
// User can overwrite with literal text, which then becomes the template.
const DEFAULT_COPYRIGHT_TEMPLATE = '© {year} {author}';
let copyrightTemplate = DEFAULT_COPYRIGHT_TEMPLATE;

function resolveCopyrightIntoForm() {
  const el = document.getElementById('copyright');
  if (!el) return;
  const dateVal = document.getElementById('date').value;
  const year = dateVal ? new Date(dateVal).getFullYear() : new Date().getFullYear();
  const author = document.getElementById('author').value || '';
  el.value = copyrightTemplate
    .replace(/\{year\}/g, year)
    .replace(/\{author\}/g, author);
  updateRowVisibility();
}

// --- File Status UI ---

function updateFileStatus() {
  // JPEG row
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

  // RAW row
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

  // Source labels + hint
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

  // F値警告: JPEGからのEXIF抽出時はFNumberが誤りうる(Resolve書き出しの既知問題)。
  metadataForm.classList.toggle('f-value-warn', exifSource === 'jpeg');
}

// --- Form ---

function populateForm(metadata) {
  for (const f of FIELDS) {
    if (f.customUI) continue;
    const el = document.getElementById(f.id);
    if (!el) continue;
    if (!f.editable) {
      // Mirror EXIF exactly — overwrite with empty too (so removing RAW clears
      // ARW-only values like exposureBias from the form).
      el.value = metadata[f.id] || '';
    } else if (metadata[f.id]) {
      // Editable fields: only overwrite when EXIF has a value (preserve user input)
      el.value = metadata[f.id];
    }
  }
  updateRowVisibility();
}

// Hide rows flagged hideWhenEmpty when their value is empty. Basic fields
// (camera/lens/focal/aperture/shutter/iso/date) stay visible regardless so
// the form structure is always discoverable.
function updateRowVisibility() {
  for (const f of FIELDS) {
    if (f.customUI) continue;
    if (!f.hideWhenEmpty) continue;
    const el = document.getElementById(f.id);
    if (!el) continue;
    const row = el.closest('.info-row');
    if (!row) continue;
    row.classList.toggle('hidden', !el.value);
  }
}

function clearForm() {
  for (const f of FIELDS) {
    if (PRESERVE.has(f.id)) continue;
    const el = document.getElementById(f.id);
    if (el) el.value = '';
  }
}

function readFormMetadata() {
  const data = {};
  for (const f of FIELDS) {
    if (!f.customUI) {
      const el = document.getElementById(f.id);
      if (el) data[f.id] = el.value;
    }
    const cb = document.getElementById('show_' + f.id);
    if (cb) data['show_' + f.id] = cb.checked;
  }
  for (const id of EXTRA_INPUTS) {
    const el = document.getElementById(id);
    if (!el) continue;
    data[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  // Software: dropdown selection, with custom text when "other" is picked
  data.software = softwareSelect.value === 'other'
    ? (softwareCustom.value || '')
    : softwareSelect.value;
  return data;
}

// --- Rendering ---

function onFormChange(event) {
  // When the user types in the copyright field, capture it as the new template.
  if (event && event.target && event.target.id === 'copyright') {
    copyrightTemplate = event.target.value;
  }
  currentMetadata = readFormMetadata();
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

init();
