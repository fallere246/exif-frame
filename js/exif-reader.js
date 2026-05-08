// EXIF Reader Module
// Uses exifr library to extract EXIF metadata from images

// Camera model normalization map
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

function normalizeCamera(make, model) {
  if (!model) return make || '';

  // Check normalization map
  const normalized = CAMERA_NAME_MAP[model];
  if (normalized) return normalized;

  // If make is already included in model, return model as-is
  if (make && model.toLowerCase().includes(make.toLowerCase())) {
    return model;
  }

  // Prepend make if available
  if (make) {
    return `${make} ${model}`;
  }

  return model;
}

function formatShutter(exposureTime) {
  if (!exposureTime) return '';
  if (exposureTime >= 1) {
    return `${exposureTime}s`;
  }
  // Convert decimal to fraction
  const denominator = Math.round(1 / exposureTime);
  return `1/${denominator}s`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export async function readExif(file) {
  const metadata = {
    camera: '',
    lens: '',
    focalLength: '',
    aperture: '',
    shutter: '',
    iso: '',
    date: '',
    location: '',
    author: '',
  };

  try {
    const exif = await exifr.parse(file, {
      pick: [
        'Make', 'Model',
        'LensModel', 'LensInfo',
        'FocalLength', 'FocalLengthIn35mmFormat',
        'FNumber',
        'ExposureTime',
        'ISO', 'ISOSpeedRatings',
        'DateTimeOriginal', 'CreateDate',
        'Artist', 'Copyright',
        'GPSLatitude', 'GPSLongitude',
      ],
    });

    if (!exif) return metadata;

    metadata.camera = normalizeCamera(exif.Make, exif.Model);
    metadata.lens = exif.LensModel || '';
    metadata.focalLength = exif.FocalLength ? `${Math.round(exif.FocalLength)}mm` : '';
    metadata.aperture = exif.FNumber ? `f/${exif.FNumber}` : '';
    metadata.shutter = formatShutter(exif.ExposureTime);
    metadata.iso = (exif.ISO || exif.ISOSpeedRatings) ? `ISO ${exif.ISO || exif.ISOSpeedRatings}` : '';
    metadata.date = formatDate(exif.DateTimeOriginal || exif.CreateDate);
    metadata.author = exif.Artist || '';

  } catch (err) {
    console.warn('EXIF extraction failed:', err);
  }

  return metadata;
}
