import { CompositionSettings, ProjectState, UploadedAsset } from './types';

export interface OverlaySynthesisInput {
  state: ProjectState;
  seed: number;
  width: number;
  height: number;
}

export interface OverlaySynthesisResult {
  composedDataUrl: string;
  provider: string;
}

export interface OverlaySynthesisProvider {
  name: string;
  synthesize(input: OverlaySynthesisInput): Promise<OverlaySynthesisResult>;
}

function seeded(seed: number) {
  let x = Math.sin(seed) * 10000;
  return () => {
    x = Math.sin(x) * 10000;
    return x - Math.floor(x);
  };
}

function loadImage(asset?: UploadedAsset): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!asset?.dataUrl) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = asset.dataUrl;
  });
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  settings: CompositionSettings[keyof CompositionSettings] | undefined,
  width: number,
  height: number,
  extraScale = 1,
) {
  if (!settings || typeof settings !== 'object' || !('enabled' in settings) || !settings.enabled) return;
  const layer = settings;
  const w = img.width * layer.scale * extraScale;
  const h = img.height * layer.scale * extraScale;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(width * layer.x, height * layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export class BrowserCanvasOverlayProvider implements OverlaySynthesisProvider {
  name = 'browser-canvas-fallback';

  async synthesize(input: OverlaySynthesisInput): Promise<OverlaySynthesisResult> {
    const canvas = document.createElement('canvas');
    canvas.width = input.width;
    canvas.height = input.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    const [avatar, background, outfit, handheld, phone, holdRef] = await Promise.all([
      loadImage(input.state.avatar),
      loadImage(input.state.backgroundImage),
      loadImage(input.state.outfitRef),
      loadImage(input.state.handheldProductImage ?? input.state.productImage),
      loadImage(input.state.smartphoneScreenImage),
      loadImage(input.state.holdReferenceImage),
    ]);

    const rnd = seeded(input.seed);
    const jitter = (base: number, spread: number) => base + (rnd() - 0.5) * spread;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, input.width, input.height);

    if (background) {
      drawLayer(
        ctx,
        background,
        {
          ...input.state.composition.background,
          x: jitter(input.state.composition.background.x, input.state.variation.backgroundJitter * 0.15),
          y: jitter(input.state.composition.background.y, input.state.variation.backgroundJitter * 0.1),
        },
        input.width,
        input.height,
        Math.max(input.width / background.width, input.height / background.height),
      );
    }

    if (avatar) drawLayer(ctx, avatar, input.state.composition.personCutout, input.width, input.height, 0.95);
    if (outfit) drawLayer(ctx, outfit, input.state.composition.outfitRef, input.width, input.height, 0.65);
    if (handheld) drawLayer(ctx, handheld, input.state.composition.handheldProduct, input.width, input.height, 0.45);
    if (phone) drawLayer(ctx, phone, input.state.composition.smartphoneScreen, input.width, input.height, 0.42);
    if (holdRef) drawLayer(ctx, holdRef, input.state.composition.poseReferenceAssist, input.width, input.height, 0.9);

    ctx.fillStyle = 'rgba(15,23,42,0.42)';
    ctx.fillRect(0, input.height - 92, input.width, 92);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '22px sans-serif';
    ctx.fillText(input.state.projectName, 22, input.height - 54);
    ctx.font = '16px sans-serif';
    ctx.fillText(`seed=${input.seed} / ${input.state.aspectRatio}`, 22, input.height - 24);

    return { composedDataUrl: canvas.toDataURL('image/png'), provider: this.name };
  }
}

export class MockCloudOverlayProvider implements OverlaySynthesisProvider {
  name = 'mock-cloud-overlay';
  constructor(private fallback: OverlaySynthesisProvider = new BrowserCanvasOverlayProvider()) {}

  async synthesize(input: OverlaySynthesisInput): Promise<OverlaySynthesisResult> {
    await new Promise((r) => setTimeout(r, 350));
    const fallback = await this.fallback.synthesize(input);
    return { ...fallback, provider: this.name };
  }
}

export function createOverlayProvider(state: ProjectState): OverlaySynthesisProvider {
  if (state.cloud.mode === 'cloud' && (state.cloud.overlayProvider === 'cloud' || (state.cloud.overlayProvider === 'auto' && state.cloud.overlayApiKey))) {
    return new MockCloudOverlayProvider();
  }
  return new BrowserCanvasOverlayProvider();
}

export async function createPlaceholderVideoBlob(imageDataUrl: string, lengthSec: number): Promise<{ blob: Blob; mimeType: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: new Blob(['placeholder'], { type: 'video/mp4' }), mimeType: 'video/mp4' };

  const image = await loadImage({ name: 'composed.png', dataUrl: imageDataUrl, mimeType: 'image/png', size: imageDataUrl.length });
  let frame = 0;
  const draw = () => {
    frame += 1;
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(2,6,23,0.55)';
    ctx.fillRect(0, canvas.height - 64, canvas.width, 64);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '18px sans-serif';
    ctx.fillText(`Demo render frame ${frame}`, 20, canvas.height - 24);
  };

  const stream = (canvas as HTMLCanvasElement).captureStream(24);
  const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (evt) => {
    if (evt.data.size > 0) chunks.push(evt.data);
  };

  const effective = Math.max(1.2, Math.min(lengthSec, 4));
  const interval = setInterval(draw, 1000 / 12);
  draw();
  recorder.start();
  await new Promise((r) => setTimeout(r, effective * 1000));
  recorder.stop();
  await new Promise((resolve) => {
    recorder.onstop = () => resolve(null);
  });
  clearInterval(interval);

  return { blob: new Blob(chunks, { type: mimeType }), mimeType };
}
