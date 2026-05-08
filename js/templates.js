// Template Definitions and Canvas Rendering

const FONT_STACK = '-apple-system, "SF Pro Display", "Inter", "Segoe UI", "Roboto", sans-serif';

function getScaledFontSize(imageHeight, ratio) {
  return Math.max(Math.round(imageHeight * ratio), 12);
}

export const templates = {
  'minimal-white': {
    name: 'Minimal White',
    render(ctx, img, metadata, canvasWidth, canvasHeight, frameHeight) {
      const primarySize = getScaledFontSize(img.naturalHeight, 0.022);
      const secondarySize = getScaledFontSize(img.naturalHeight, 0.016);
      const padding = Math.round(frameHeight * 0.15);

      // White frame
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, img.naturalHeight, canvasWidth, frameHeight);

      // Separator line
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = Math.max(1, Math.round(img.naturalHeight * 0.001));
      ctx.beginPath();
      ctx.moveTo(padding, img.naturalHeight + ctx.lineWidth / 2);
      ctx.lineTo(canvasWidth - padding, img.naturalHeight + ctx.lineWidth / 2);
      ctx.stroke();

      const textY = img.naturalHeight + padding + primarySize;

      // Author (left)
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `600 ${primarySize}px ${FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (metadata.author) {
        ctx.fillText(metadata.author, padding, img.naturalHeight + frameHeight * 0.2);
      }

      // Camera info (right, 2 lines)
      ctx.textAlign = 'right';
      const rightX = canvasWidth - padding;

      // Line 1: Camera · Focal Length
      ctx.font = `500 ${secondarySize}px ${FONT_STACK}`;
      ctx.fillStyle = '#333333';
      const line1Parts = [metadata.camera, metadata.focalLength].filter(Boolean);
      const line1 = line1Parts.join(' · ');
      ctx.fillText(line1, rightX, img.naturalHeight + frameHeight * 0.2);

      // Line 2: Aperture · Shutter · ISO
      const line2Parts = [metadata.aperture, metadata.shutter, metadata.iso].filter(Boolean);
      const line2 = line2Parts.join(' · ');
      ctx.fillText(line2, rightX, img.naturalHeight + frameHeight * 0.2 + secondarySize * 1.6);
    },
  },

  'black-cinematic': {
    name: 'Black Cinematic',
    render(ctx, img, metadata, canvasWidth, canvasHeight, frameHeight) {
      const primarySize = getScaledFontSize(img.naturalHeight, 0.018);
      const secondarySize = getScaledFontSize(img.naturalHeight, 0.015);
      const padding = Math.round(frameHeight * 0.15);

      // Black frame
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, img.naturalHeight, canvasWidth, frameHeight);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const centerX = canvasWidth / 2;

      // Line 1: Camera · Lens
      ctx.font = `500 ${primarySize}px ${FONT_STACK}`;
      ctx.fillStyle = '#e0e0e0';
      const line1Parts = [metadata.camera, metadata.lens].filter(Boolean);
      ctx.fillText(line1Parts.join(' · '), centerX, img.naturalHeight + frameHeight * 0.2);

      // Line 2: Params
      ctx.font = `400 ${secondarySize}px ${FONT_STACK}`;
      ctx.fillStyle = '#999999';
      const line2Parts = [metadata.focalLength, metadata.aperture, metadata.shutter, metadata.iso].filter(Boolean);
      ctx.fillText(line2Parts.join(' · '), centerX, img.naturalHeight + frameHeight * 0.2 + primarySize * 1.6);
    },
  },

  'side-strip': {
    name: 'Side Strip',
    render(ctx, img, metadata, canvasWidth, canvasHeight, stripWidth) {
      const fontSize = getScaledFontSize(img.naturalHeight, 0.018);
      const padding = Math.round(stripWidth * 0.15);

      // White strip on right
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(img.naturalWidth, 0, stripWidth, canvasHeight);

      // Separator line
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = Math.max(1, Math.round(img.naturalHeight * 0.001));
      ctx.beginPath();
      ctx.moveTo(img.naturalWidth + ctx.lineWidth / 2, padding);
      ctx.lineTo(img.naturalWidth + ctx.lineWidth / 2, canvasHeight - padding);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#1a1a1a';
      const x = img.naturalWidth + padding;
      let y = padding;
      const lineHeight = fontSize * 1.8;

      // Author
      if (metadata.author) {
        ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
        ctx.fillText(metadata.author, x, y);
        y += lineHeight * 1.2;

        // Divider
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(img.naturalWidth + stripWidth - padding, y);
        ctx.stroke();
        y += lineHeight * 0.5;
      }

      ctx.font = `400 ${fontSize}px ${FONT_STACK}`;
      ctx.fillStyle = '#444444';
      const items = [
        metadata.camera,
        metadata.lens,
        metadata.focalLength,
        metadata.aperture,
        metadata.shutter,
        metadata.iso,
        metadata.date,
      ];
      for (const item of items) {
        if (item) {
          ctx.fillText(item, x, y);
          y += lineHeight;
        }
      }
    },
  },
};

export function getCanvasDimensions(img, templateId) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  if (templateId === 'side-strip') {
    const stripWidth = Math.round(w * 0.15);
    return { width: w + stripWidth, height: h, extra: stripWidth };
  }

  // Bottom frame templates
  const frameHeight = Math.round(h * 0.12);
  return { width: w, height: h + frameHeight, extra: frameHeight };
}
