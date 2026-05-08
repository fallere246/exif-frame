// Canvas Renderer Module
import { templates, getCanvasDimensions } from './templates.js';

export function renderPreview(canvas, img, metadata, templateId) {
  const template = templates[templateId];
  if (!template) return;

  const dims = getCanvasDimensions(img, templateId, metadata);
  canvas.width = dims.width;
  canvas.height = dims.height;

  const ctx = canvas.getContext('2d');
  template.render(ctx, img, metadata, dims.width, dims.height, dims.extra);
}

export function exportImage(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });
}
