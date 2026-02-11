import { VoiceOptions } from './types';

export interface VoiceStyleSuggestion {
  style: VoiceOptions['style'];
  reason: string;
  metrics: {
    brightness: number;
    saturation: number;
    warmRatio: number;
  };
}

function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

export async function suggestVoiceStyleFromImage(dataUrl?: string): Promise<VoiceStyleSuggestion | null> {
  if (!dataUrl || typeof window === 'undefined') return null;

  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = dataUrl;
  });
  if (!img) return null;

  const canvas = document.createElement('canvas');
  const max = 96;
  const scale = Math.min(max / img.width, max / img.height, 1);
  canvas.width = Math.max(1, Math.floor(img.width * scale));
  canvas.height = Math.max(1, Math.floor(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let brightness = 0;
  let saturation = 0;
  let warmPixels = 0;
  let total = 0;

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];
    if (alpha < 24) continue;

    const hsl = rgbToHsl(r, g, b);
    brightness += hsl.l;
    saturation += hsl.s;
    if (r > b && r > g * 0.9) warmPixels += 1;
    total += 1;
  }

  if (!total) return null;

  const metrics = {
    brightness: Number((brightness / total).toFixed(3)),
    saturation: Number((saturation / total).toFixed(3)),
    warmRatio: Number((warmPixels / total).toFixed(3)),
  };

  if (metrics.saturation > 0.48 || metrics.brightness > 0.72) {
    return { style: 'energetic', reason: '明るさ/彩度が高めのビジュアル', metrics };
  }
  if (metrics.warmRatio > 0.52 && metrics.saturation > 0.3) {
    return { style: 'luxury', reason: '暖色寄りで濃度のあるトーン', metrics };
  }
  if (metrics.brightness < 0.45 || metrics.saturation < 0.23) {
    return { style: 'calm', reason: '落ち着いた明度/彩度のトーン', metrics };
  }

  return { style: 'natural', reason: '中庸な色調バランス', metrics };
}
