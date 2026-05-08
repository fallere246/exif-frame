// Main Application Module
import { readExif } from './exif-reader.js';
import { renderPreview, exportImage } from './renderer.js';

const STORAGE_KEY = 'exif-frame-settings';

// State
let currentImage = null;
let currentFileName = '';
let currentMetadata = {};
let currentTemplate = 'minimal-white';

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewSection = document.getElementById('preview-section');
const previewCanvas = document.getElementById('preview-canvas');
const metadataForm = document.getElementById('metadata-form');
const exportBtn = document.getElementById('export-btn');
const templateBtns = document.querySelectorAll('.template-btn');
const resetBtn = document.getElementById('reset-btn');

// Form fields
const fields = ['camera', 'lens', 'focalLength', 'aperture', 'shutter', 'iso', 'date', 'location', 'author'];

// --- Initialization ---

function init() {
  loadSettings();
  setupEventListeners();
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      if (saved.defaultAuthor) document.getElementById('author').value = saved.defaultAuthor;
      if (saved.defaultCamera) document.getElementById('camera').value = saved.defaultCamera;
      if (saved.preferredTemplate) {
        currentTemplate = saved.preferredTemplate;
        updateTemplateUI();
      }
    }
  } catch (e) { /* ignore */ }
}

function saveSettings() {
  const settings = {
    defaultAuthor: document.getElementById('author').value,
    defaultCamera: document.getElementById('camera').value,
    preferredTemplate: currentTemplate,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// --- Event Listeners ---

function setupEventListeners() {
  // File drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  // Form changes → re-render
  for (const field of fields) {
    const el = document.getElementById(field);
    if (el) el.addEventListener('input', onFormChange);
  }

  // Template selection
  for (const btn of templateBtns) {
    btn.addEventListener('click', () => {
      currentTemplate = btn.dataset.template;
      updateTemplateUI();
      saveSettings();
      render();
    });
  }

  // Export
  exportBtn.addEventListener('click', handleExport);

  // Reset
  resetBtn.addEventListener('click', handleReset);
}

// --- File Handling ---

async function handleFile(file) {
  // Validate
  if (!file.type.match(/^image\/(jpeg|png|heic|heif)/i) && !file.name.match(/\.(jpg|jpeg|png|heic|heif)$/i)) {
    alert('対応形式: JPEG, PNG, HEIC');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    alert('ファイルサイズが50MBを超えています。リサイズしてからお試しください。');
    return;
  }

  currentFileName = file.name.replace(/\.[^/.]+$/, '');

  // Show loading state
  dropZone.classList.add('hidden');
  previewSection.classList.remove('hidden');
  previewSection.classList.add('loading');

  // Read EXIF
  const exifData = await readExif(file);

  // Merge with saved defaults
  const savedAuthor = document.getElementById('author').value;
  currentMetadata = {
    ...exifData,
    author: exifData.author || savedAuthor || 'NISHIMURA',
  };

  // Populate form
  populateForm(currentMetadata);

  // Load image
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    currentImage = img;
    previewSection.classList.remove('loading');
    render();
  };
  img.src = url;
}

function populateForm(metadata) {
  for (const field of fields) {
    const el = document.getElementById(field);
    if (el && metadata[field] !== undefined) {
      el.value = metadata[field];
    }
  }
}

function readFormMetadata() {
  const data = {};
  for (const field of fields) {
    data[field] = document.getElementById(field).value;
  }
  return data;
}

// --- Rendering ---

function onFormChange() {
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
}

// --- Export ---

async function handleExport() {
  if (!currentImage) return;

  exportBtn.disabled = true;
  exportBtn.textContent = '書き出し中...';

  // Render at full resolution (already done since canvas is full res)
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

// --- Reset ---

function handleReset() {
  currentImage = null;
  currentFileName = '';
  currentMetadata = {};
  fileInput.value = '';

  // Reset form except author
  const authorVal = document.getElementById('author').value;
  for (const field of fields) {
    if (field !== 'author') {
      document.getElementById(field).value = '';
    }
  }

  previewSection.classList.add('hidden');
  dropZone.classList.remove('hidden');
}

// --- Start ---
init();
