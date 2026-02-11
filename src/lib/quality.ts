import { QualityGateScores, RenderQualityLevel } from './types';

const thresholds: Record<RenderQualityLevel, number> = { fast: 0.5, balanced: 0.64, high: 0.76 };

export async function measureImageQuality(composedDataUrl: string, level: RenderQualityLevel, attempts: number): Promise<QualityGateScores> {
  const img = await loadImage(composedDataUrl);
  const canvas = document.createElement('canvas');
  const width = 320;
  const height = Math.max(180, Math.round((img.height / img.width) * width));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blur: 0.5, boundary: 0.5, occlusion: 0.5, overall: 0.5, warnings: ['quality analyzer unavailable'], attempts, passed: level === 'fast' };

  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  let edgeEnergy = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = (y * width + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      const right = luma(data[i + 4], data[i + 5], data[i + 6]);
      const down = luma(data[i + width * 4], data[i + width * 4 + 1], data[i + width * 4 + 2]);
      edgeEnergy += Math.abs(l - right) + Math.abs(l - down);
    }
  }

  const blur = clamp(edgeEnergy / ((width * height) * 24));
  const boundary = clamp(0.4 + blur * 0.5);

  let darkCenter = 0;
  let totalCenter = 0;
  for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.88); y += 1) {
    for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x += 1) {
      const i = (y * width + x) * 4;
      const lum = luma(data[i], data[i + 1], data[i + 2]);
      totalCenter += 1;
      if (lum < 16) darkCenter += 1;
    }
  }
  const darkRatio = darkCenter / Math.max(1, totalCenter);
  const occlusion = clamp(1 - Math.max(0, darkRatio - 0.08) * 2.8);

  const overall = clamp(blur * 0.45 + boundary * 0.35 + occlusion * 0.2);
  const warnings: string[] = [];
  if (blur < 0.55) warnings.push('blur risk');
  if (boundary < 0.55) warnings.push('boundary artifact risk');
  if (occlusion < 0.55) warnings.push('occlusion plausibility risk');

  return { blur, boundary, occlusion, overall, warnings, attempts, passed: overall >= thresholds[level] };
}

function luma(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function clamp(value: number) {
  return Math.min(1, Math.max(0, Number(value.toFixed(3))));
}
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = dataUrl;
  });
}
