'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import scenePresets from '@/data/scene-presets.json';
import scriptTemplates from '@/data/script-templates.json';
import { generateLipSyncVideoWithSync } from '@/lib/cloud';
import { createOverlayProvider, createPlaceholderVideoBlob } from '@/lib/compositor';
import { measureImageQuality } from '@/lib/quality';
import { createDeterministicIdentityId } from '@/lib/identity';
import { createProjectExportBlob, defaultComposition, defaultVariation, loadFromLocalStorage, saveToLocalStorage } from '@/lib/storage';
import { detectLanguageFromScript, languageLabels, speechLangCodeMap } from '@/lib/language';
import { suggestVoiceStyleFromImage } from '@/lib/style-suggestion';
import { createElevenLabsAdapter } from '@/lib/tts';
import {
  AspectRatio,
  GenerationMode,
  GesturePlan,
  Language,
  ProjectState,
  QueueItem,
  ScenePreset,
  ScriptTemplate,
  ScriptVariationMode,
  UploadedAsset,
  VariationPreset,
} from '@/lib/types';

const initialState: ProjectState = {
  schemaVersion: 4,
  projectName: '新規UGC案件',
  language: 'ja',
  script: 'ここに台本を編集してください。',
  scriptVariationMode: 'exact',
  generationMode: 'same_person_same_product',
  keepIdentityLocked: true,
  scenarioCount: 3,
  voice: { style: 'natural', pauseMs: 220, breathiness: 20, prosodyRate: 1, pitch: 1 },
  batchCount: 3,
  clipLengthSec: 15,
  autoDurationFromAudio: true,
  renderQualityLevel: 'balanced',
  maxQualityRetries: 2,
  autoFixQuality: true,
  aspectRatio: '9:16',
  cloud: {
    mode: 'demo',
    elevenLabsApiKey: '',
    elevenLabsVoiceId: '',
    syncApiToken: '',
    syncModelId: 'lipsync-2',
    overlayProvider: 'auto',
    overlayApiKey: '',
    productReplacementProvider: 'auto',
    productReplacementApiKey: '',
    productReplacementApiUrl: '',
  },
  composition: defaultComposition,
  variation: defaultVariation,
  productImages: [],
  avatarSwapImages: [],
};

const scenes = scenePresets as ScenePreset[];
const templates = scriptTemplates as ScriptTemplate[];
const getVideoSize = (aspectRatio: AspectRatio) => (aspectRatio === '16:9' ? { width: 1280, height: 720 } : { width: 1080, height: 1920 });

const normalizeProjectState = (loaded: ProjectState): ProjectState => ({
  ...initialState,
  ...loaded,
  schemaVersion: 4,
  cloud: { ...initialState.cloud, ...(loaded.cloud ?? {}) },
  composition: { ...initialState.composition, ...(loaded.composition ?? {}) },
  variation: { ...initialState.variation, ...(loaded.variation ?? {}) },
  handheldProductImage: loaded.handheldProductImage ?? loaded.productImage,
  productImages: loaded.productImages ?? (loaded.productImage ? [loaded.productImage] : []),
  avatarSwapImages: loaded.avatarSwapImages ?? [],
  generationMode: loaded.generationMode ?? 'same_person_same_product',
  keepIdentityLocked: loaded.keepIdentityLocked ?? true,
  scriptVariationMode: loaded.scriptVariationMode ?? 'exact',
  scenarioCount: Math.min(20, Math.max(1, loaded.scenarioCount ?? 3)),
  autoDurationFromAudio: loaded.autoDurationFromAudio ?? true,
  renderQualityLevel: loaded.renderQualityLevel ?? 'balanced',
  maxQualityRetries: loaded.maxQualityRetries ?? 2,
  autoFixQuality: loaded.autoFixQuality ?? true,
});

async function fileToAsset(file: File): Promise<UploadedAsset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { name: file.name, dataUrl, mimeType: file.type, size: file.size };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadFromUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}

function estimateNaturalSpeechDurationSec(script: string, language: Language) {
  const cpsMap: Record<Language, number> = { ja: 6.2, en: 13.5, ko: 7.8, zh: 7.5, fr: 12.3, it: 12.1 };
  const cps = cpsMap[language] ?? 11;
  const chars = script.replace(/\s+/g, '').length;
  return Math.min(60, Math.max(5, Math.round((chars / cps) * 10) / 10));
}

async function getAudioDurationSec(audioBlob: Blob): Promise<number> {
  const audio = document.createElement('audio');
  const url = URL.createObjectURL(audioBlob);
  audio.src = url;
  try {
    const duration = await new Promise<number>((resolve) => {
      audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      audio.onerror = () => resolve(0);
    });
    return Math.min(60, Math.max(1, duration || 0));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const variationPresetValues: Record<VariationPreset, Pick<ProjectState['variation'], 'sceneJitter' | 'outfitJitter' | 'backgroundJitter'>> = {
  stable: { sceneJitter: 0.06, outfitJitter: 0.05, backgroundJitter: 0.05 },
  balanced: { sceneJitter: 0.2, outfitJitter: 0.15, backgroundJitter: 0.15 },
  explore: { sceneJitter: 0.42, outfitJitter: 0.35, backgroundJitter: 0.38 },
};

const paraphraseTemplates: Record<Language, string[]> = {
  ja: ['冒頭は自然な体験談で始める', '誇張表現を避け、実感ベースの語尾にする', 'CTAはやわらかく行動提案にする'],
  en: ['Open with a relatable hook', 'Use modest, non-deceptive wording', 'Close with a gentle call to action'],
  ko: ['친근한 일상 훅으로 시작하기', '과장 없이 체감 중심 문장으로 바꾸기', 'CTA는 부담 없는 제안 톤으로 마무리'],
  zh: ['开头先用真实场景引入', '避免夸张和误导性表达', '结尾用自然邀请式行动提示'],
  fr: ['Commencer par une accroche du quotidien', 'Garder un ton honnête et sans promesse exagérée', 'Finir avec un CTA doux et crédible'],
  it: ['Apri con un aggancio realistico', 'Usa frasi naturali senza promesse ingannevoli', 'Chiudi con una call-to-action morbida'],
};

const scriptSegmentLabels = ['hook', 'problem', 'solution', 'cta'] as const;

type QuickStartPreset = 'lock_person_swap_product' | 'scene_variation' | 'app_promo_fast' | 'product_promo_trust';

const languageHints: Record<Language, { audience: string; ux: string; note: string }> = {
  ja: { audience: '日本向け', ux: '結論→体験→やわらかいCTAが自然', note: '断定表現（絶対・100%）は避ける' },
  en: { audience: 'Global / English', ux: 'Hook in first 2 seconds, then social proof + clear benefit', note: 'Avoid absolute claims like “guaranteed”' },
  ko: { audience: '한국 사용자', ux: '짧은 공감 훅 + 빠른 데모 + 부담 없는 CTA', note: '과장/기만 표현 금지' },
  zh: { audience: '中文用户', ux: '真实场景开头 + 简洁卖点 + 温和行动提示', note: '避免夸大与误导性承诺' },
  fr: { audience: 'Public francophone', ux: 'Ton conversationnel + bénéfice concret + CTA discret', note: 'Pas de promesses absolues' },
  it: { audience: 'Pubblico italiano', ux: 'Apertura quotidiana + prova pratica + invito naturale', note: 'Evita claim ingannevoli o assoluti' },
};

function safeParaphrase(source: string, language: Language, index: number): string {
  const lines = source
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return source;
  const template = paraphraseTemplates[language] ?? paraphraseTemplates.en;
  const rotate = index % template.length;
  const updated = lines.map((line, i) => {
    if (line.includes('絶対') || line.includes('100%') || line.toLowerCase().includes('guarantee')) {
      return line.replace(/絶対|100%|guarantee/gi, 'できるだけ');
    }
    if (i === 0) return `${line}（${template[rotate]}）`;
    return line;
  });
  return updated.join('\n');
}

function getGesturePlan(script: string, productType: string, language: Language): GesturePlan {
  const pieces = script
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const localizedCTA = language === 'ja' ? '最後に優しいCTA' : language === 'ko' ? '부드러운 CTA' : 'soft CTA';
  const defaults = ['注意を引く導入', '困りごとを共感', '解決の見せ場', localizedCTA];
  const segments = scriptSegmentLabels.map((seg, i) => ({
    segment: seg,
    text: pieces[i] ?? defaults[i],
    camera: ['寄り', 'バスト', '手元寄り', 'やや引き'][i],
    gesture: [
      '片手で軽く指さし + 目線固定',
      '肩を少しすくめて困り顔',
      productType.includes('app') ? 'スマホ画面を見せるスワイプ動作' : '商品を前に出して回転見せ',
      '笑顔でうなずき + 画面下を示す',
    ][i],
    expression: ['明るい', '共感', '納得', '安心'][i],
    tempo: ['fast', 'mid', 'mid', 'slow'][i],
  }));
  return { productType, segments };
}

export default function Page() {
  const [state, setState] = useState<ProjectState>(initialState);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('準備完了');
  const [languageSuggestion, setLanguageSuggestion] = useState<ReturnType<typeof detectLanguageFromScript> | null>(null);
  const [voiceStyleSuggestion, setVoiceStyleSuggestion] = useState<Awaited<ReturnType<typeof suggestVoiceStyleFromImage>> | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const loaded = loadFromLocalStorage();
    if (loaded) setState(normalizeProjectState(loaded));
  }, []);

  const selectedScene = scenes.find((s) => s.id === state.selectedSceneId);
  const selectedTemplate = templates.find((t) => t.id === state.selectedTemplateId);

  useEffect(() => setLanguageSuggestion(detectLanguageFromScript(state.script)), [state.script]);

  const lipSyncTimeline = useMemo(() => {
    const length = Math.min(state.clipLengthSec, 60);
    const phonemeMap: Record<Language, string[]> = {
      ja: ['a', 'i', 'u', 'e', 'o'], en: ['ae', 'ih', 'uh', 'eh', 'ow'], ko: ['a', 'eo', 'u', 'i', 'eu'],
      zh: ['a', 'i', 'u', 'e', 'o'], fr: ['a', 'e', 'i', 'o', 'u'], it: ['a', 'e', 'i', 'o', 'u'],
    };
    const phonemes = phonemeMap[state.language] ?? phonemeMap.en;
    return Array.from({ length: Math.ceil(length / 2) }, (_, i) => ({ t: i * 2, mouthOpen: Number((Math.sin(i) * 0.4 + 0.5).toFixed(2)), phoneme: phonemes[i % phonemes.length] }));
  }, [state.clipLengthSec, state.language]);

  useEffect(() => {
    if (!previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = getVideoSize(state.aspectRatio);
    canvas.width = width;
    canvas.height = height;

    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      const grd = ctx.createLinearGradient(0, 0, width, height);
      grd.addColorStop(0, '#1e1b4b');
      grd.addColorStop(1, '#0f172a');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cardX = Math.round(width * 0.08) + (frame % Math.max(120, Math.round(width * 0.18)));
      const cardY = Math.round(height * 0.16);
      const cardW = Math.round(width * 0.24);
      const cardH = Math.round(height * 0.28);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(cardX + 24, cardY + 24, Math.round(cardW * 0.5), Math.round(cardH * 0.38));

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f8fafc';
      ctx.font = `${Math.max(18, Math.round(width * 0.018))}px sans-serif`;
      ctx.fillText(state.projectName, Math.round(width * 0.05), Math.round(height * 0.06));
      ctx.font = `${Math.max(16, Math.round(width * 0.014))}px sans-serif`;
      ctx.fillText(selectedScene?.name ?? 'シーン未選択', Math.round(width * 0.05), Math.round(height * 0.76));
      ctx.fillText(`モード: ${state.generationMode}`, Math.round(width * 0.05), Math.round(height * 0.82));
      ctx.fillText(`秒数: ${Math.min(state.clipLengthSec, 60)}秒`, Math.round(width * 0.05), Math.round(height * 0.88));
      ctx.fillText(`比率: ${state.aspectRatio}`, Math.round(width * 0.05), Math.round(height * 0.94));
    }, 160);

    return () => clearInterval(id);
  }, [state.projectName, state.clipLengthSec, state.aspectRatio, state.generationMode, selectedScene?.name]);

  function patchState<K extends keyof ProjectState>(key: K, value: ProjectState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  const onUpload = async (
    evt: ChangeEvent<HTMLInputElement>,
    key: 'avatar' | 'productImage' | 'outfitRef' | 'backgroundImage' | 'handheldProductImage' | 'smartphoneScreenImage' | 'holdReferenceImage',
  ) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    const asset = await fileToAsset(file);
    patchState(key, asset);
    if (key === 'avatar') setVoiceStyleSuggestion(await suggestVoiceStyleFromImage(asset.dataUrl));
  };

  const onUploadMultiProducts = async (evt: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(evt.target.files ?? []);
    if (!files.length) return;
    const assets = await Promise.all(files.map(fileToAsset));
    patchState('productImages', assets);
    patchState('handheldProductImage', assets[0]);
    setStatus(`商品リストを${assets.length}件読み込みました`);
  };

  const onUploadSwapAvatars = async (evt: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(evt.target.files ?? []);
    if (!files.length) return;
    patchState('avatarSwapImages', await Promise.all(files.map(fileToAsset)));
  };

  const createIdentityLock = async () => {
    if (!state.avatar) return;
    const personName = prompt('人物名を入力してください（同意済みの本人のみ）') ?? '';
    if (!personName) return;
    const identityId = await createDeterministicIdentityId(personName, state.avatar.dataUrl);
    patchState('identityLock', { personName, identityId, consentChecked: true, createdAt: new Date().toISOString() });
  };

  const applyQuickPreset = (preset: QuickStartPreset) => {
    if (preset === 'lock_person_swap_product') {
      patchState('generationMode', 'same_person_product_swap');
      patchState('keepIdentityLocked', true);
      patchState('batchCount', 3);
      setStatus('プリセット適用: 人物固定 + 商品差し替え');
      return;
    }
    if (preset === 'scene_variation') {
      patchState('generationMode', 'same_person_same_product');
      patchState('keepIdentityLocked', true);
      patchState('scenarioCount', 5);
      patchState('scriptVariationMode', 'paraphrase');
      setStatus('プリセット適用: 同一人物同一商品 + シーン多様化');
      return;
    }
    if (preset === 'app_promo_fast') {
      patchState('generationMode', 'same_person_same_product');
      patchState('keepIdentityLocked', true);
      patchState('scenarioCount', 3);
      patchState('clipLengthSec', 15);
      patchState('scriptVariationMode', 'paraphrase');
      patchState('script', state.language === 'ja'
        ? '最初の10秒で、どの操作が楽になるかを見せます。\n忙しい日でも迷わず使えるのが助かりました。\nまずは無料で試して、合うかどうか確認してみてください。'
        : 'Here is the fastest way this app saves time.\nIt removed one daily friction point for me.\nTry the free version first and see if it fits your workflow.');
      setStatus('クイック開始: アプリ訴求（短尺・自然トーン）');
      return;
    }

    patchState('generationMode', 'same_person_same_product');
    patchState('keepIdentityLocked', true);
    patchState('scenarioCount', 3);
    patchState('clipLengthSec', 20);
    patchState('scriptVariationMode', 'exact');
    patchState('script', state.language === 'ja'
      ? '実際に使って感じたポイントを3つだけ紹介します。\n派手な誇張ではなく、日常での使いやすさを中心に伝えます。\n気になった方は商品ページで詳細を確認してください。'
      : 'I will share three practical impressions after using this product.\nNo hype—just realistic pros and trade-offs.\nCheck the product page if you want full details.');
    setStatus('クイック開始: プロダクト訴求（信頼重視）');
  };

  const buildQueueItems = (append = false) => {
    const plannedCount = state.generationMode === 'same_person_same_product' ? state.scenarioCount : Math.min(20, Math.max(1, state.batchCount));
    const existing = append ? queue.length : 0;
    const baseProductList = state.productImages && state.productImages.length > 0 ? state.productImages : state.handheldProductImage ? [state.handheldProductImage] : [];
    const productLoop = baseProductList.length > 0 ? baseProductList : [undefined];

    const items: QueueItem[] = Array.from({ length: Math.min(60, Math.max(1, plannedCount)) }, (_, i) => {
      const idx = existing + i + 1;
      const itemSeed = state.variation.seed + idx * 17;
      const selectedProduct = state.generationMode === 'same_person_product_swap' ? productLoop[i % productLoop.length] : productLoop[0];
      const swapPool = state.avatarSwapImages ?? [];
      const swapAvatars = state.generationMode === 'person_swap_optional' ? [state.avatar, ...swapPool].filter(Boolean) as UploadedAsset[] : [];
      const selectedAvatar = state.keepIdentityLocked ? state.avatar : swapAvatars.length ? swapAvatars[i % swapAvatars.length] : state.avatar;
      const productType = selectedProduct?.name?.toLowerCase().includes('app') ? 'app' : 'product';
      const scriptText = state.scriptVariationMode === 'exact' ? state.script : safeParaphrase(state.script, state.language, i);
      const targetDurationSec = state.autoDurationFromAudio ? estimateNaturalSpeechDurationSec(scriptText, state.language) : Math.min(state.clipLengthSec, 60);
      const gesturePlan = getGesturePlan(scriptText, productType, state.language);
      const { width, height } = getVideoSize(state.aspectRatio);

      const recipe = {
        index: idx,
        seed: itemSeed,
        generationMode: state.generationMode,
        keepIdentityLocked: state.keepIdentityLocked,
        scenarioIndex: i + 1,
        language: state.language,
        sceneId: state.selectedSceneId,
        templateId: state.selectedTemplateId,
        voice: state.voice,
        script: scriptText,
        scriptVariationMode: state.scriptVariationMode,
        aspectRatio: state.aspectRatio,
        variation: state.variation,
        composition: state.composition,
        productName: selectedProduct?.name ?? state.productImage?.name ?? 'default-product',
        avatarName: selectedAvatar?.name ?? state.avatar?.name ?? 'default-avatar',
        gesturePlan,
        resolution: `${width}x${height}`,
        lipSyncTimeline,
        targetDurationSec,
      };

      return {
        id: crypto.randomUUID(),
        index: idx,
        status: 'queued',
        progress: 0,
        ffmpegCommand: `ffmpeg -loop 1 -i composed_${idx}.png -i voice_${idx}.mp3 -t ${targetDurationSec} -vf "scale=${width}:${height}" -c:v libx264 output_${idx}.mp4`,
        recipe,
        seed: itemSeed,
        targetDurationSec,
        downloadName: `ugc_${state.aspectRatio.replace(':', 'x')}_${idx}.webm`,
      };
    });

    setQueue((prev) => (append ? [...prev, ...items] : items));
    setStatus(`${items.length}本のキューを作成しました（${state.generationMode}）`);
  };

  const ensureArtifact = async (item: QueueItem) => {
    if (item.videoUrl) return { kind: 'url' as const, value: item.videoUrl };
    if (item.artifactUrl) return { kind: 'blob' as const, value: item.artifactUrl };
    const source = item.composedImageUrl ?? state.avatar?.dataUrl;
    if (!source) throw new Error('ダウンロード元アセットがありません');
    const { blob, mimeType } = await createPlaceholderVideoBlob(source, state.clipLengthSec);
    const artifactUrl = URL.createObjectURL(blob);
    setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, artifactUrl, artifactMime: mimeType } : q)));
    return { kind: 'blob' as const, value: artifactUrl };
  };

  const handleBulkManifestDownload = () => {
    const done = queue.filter((q) => q.status === 'done' || q.status === 'failed');
    const manifest = {
      projectName: state.projectName,
      generatedAt: new Date().toISOString(),
      count: done.length,
      items: done.map((item) => ({ index: item.index, status: item.status, downloadName: item.downloadName, seed: item.seed, recipe: item.recipe })),
    };
    downloadBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${state.projectName}_bulk_manifest.json`);
  };

  const runCloudGeneration = async () => {
    if (!state.avatar) return setStatus('クラウド生成には人物画像が必要です');
    if (!state.cloud.elevenLabsApiKey || !state.cloud.elevenLabsVoiceId || !state.cloud.syncApiToken) {
      return setStatus('クラウド生成にはElevenLabs API Key/Voice ID と Sync API Tokenが必要です');
    }

    setRunning(true);
    try {
      for (const item of queue) {
        if (item.status !== 'queued') continue;
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'rendering', progress: 8 } : q)));
        const { width, height } = getVideoSize(state.aspectRatio);
        const overlayProvider = createOverlayProvider(state);

        let chosenOverlay: Awaited<ReturnType<typeof overlayProvider.synthesize>> | null = null;
        let qualityGate = null;
        const maxAttempts = Math.max(0, state.maxQualityRetries ?? 2) + 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const overlay = await overlayProvider.synthesize({ state, seed: item.seed + attempt * 7, width, height });
          const score = await measureImageQuality(overlay.composedDataUrl, state.renderQualityLevel ?? 'balanced', attempt);
          chosenOverlay = overlay;
          qualityGate = score;
          if (score.passed || !state.autoFixQuality) break;
        }

        if (!chosenOverlay || !qualityGate) throw new Error('オーバーレイ生成に失敗しました');
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, composedImageUrl: chosenOverlay.composedDataUrl, qualityGate, progress: 28 } : q)));

        const tts = createElevenLabsAdapter(state.cloud.elevenLabsApiKey, state.cloud.elevenLabsVoiceId);
        if (!tts.synthesize) throw new Error('TTS adapter synthesize未対応');
        const script = String((item.recipe as Record<string, unknown>).script ?? state.script);
        const audioBlob = await tts.synthesize(script.slice(0, 1200), state.voice, state.language);
        const audioUrl = URL.createObjectURL(audioBlob);
        const measuredAudioDuration = await getAudioDurationSec(audioBlob);
        const targetDurationSec = state.autoDurationFromAudio && measuredAudioDuration > 0 ? measuredAudioDuration : item.targetDurationSec ?? Math.min(state.clipLengthSec, 60);
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, progress: 56, audioUrl, targetDurationSec } : q)));

        const videoUrl = await generateLipSyncVideoWithSync(state.cloud.syncApiToken, chosenOverlay.composedDataUrl, audioBlob, state.language, state.aspectRatio, state.cloud.syncModelId || 'lipsync-2');
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'done', progress: 100, videoUrl, targetDurationSec } : q)));
      }
      setStatus('クラウド生成が完了しました。');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setQueue((prev) => {
        const working = [...prev];
        const target = working.find((x) => x.status === 'rendering') ?? working.find((x) => x.status === 'queued');
        if (target) {
          target.status = 'failed';
          target.error = message;
        }
        return working;
      });
      setStatus(`クラウド生成でエラー: ${message}`);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (queue.length === 0 || running || state.cloud.mode === 'cloud') return;
    setRunning(true);
    const timer = setInterval(async () => {
      const current = queue.find((x) => x.status === 'queued' || x.status === 'rendering');
      if (!current) {
        setRunning(false);
        setStatus('すべての動画レシピを生成しました（デモ）');
        clearInterval(timer);
        return;
      }
      if (current.status === 'queued') {
        setQueue((prev) => prev.map((x) => (x.id === current.id ? { ...x, status: 'rendering', progress: 12 } : x)));
      } else {
        const nextProgress = Math.min(90, current.progress + 20);
        setQueue((prev) => prev.map((x) => (x.id === current.id ? { ...x, progress: nextProgress } : x)));
      }
      const fresh = queue.find((x) => x.id === current.id) ?? current;
      if (fresh.progress >= 72) {
        const { width, height } = getVideoSize(state.aspectRatio);
        const provider = createOverlayProvider(state);
        let overlay = await provider.synthesize({ state, seed: current.seed, width, height });
        let qualityGate = await measureImageQuality(overlay.composedDataUrl, state.renderQualityLevel ?? 'balanced', 1);
        const maxAttempts = Math.max(0, state.maxQualityRetries ?? 2) + 1;
        for (let attempt = 2; attempt <= maxAttempts && state.autoFixQuality && !qualityGate.passed; attempt += 1) {
          overlay = await provider.synthesize({ state, seed: current.seed + attempt * 5, width, height });
          qualityGate = await measureImageQuality(overlay.composedDataUrl, state.renderQualityLevel ?? 'balanced', attempt);
        }

        const targetDurationSec = current.targetDurationSec ?? (state.autoDurationFromAudio ? estimateNaturalSpeechDurationSec(String((current.recipe as Record<string, unknown>).script ?? state.script), state.language) : state.clipLengthSec);
        const artifact = await createPlaceholderVideoBlob(overlay.composedDataUrl, targetDurationSec);
        const artifactUrl = URL.createObjectURL(artifact.blob);
        setQueue((prev) => prev.map((x) => (x.id === current.id ? { ...x, status: 'done', progress: 100, composedImageUrl: overlay.composedDataUrl, artifactUrl, artifactMime: artifact.mimeType, qualityGate, targetDurationSec } : x)));
      }
    }, 650);
    return () => clearInterval(timer);
  }, [queue, running, state, state.cloud.mode, state.aspectRatio, state.clipLengthSec]);

  useEffect(() => {
    if (queue.length === 0 || state.cloud.mode !== 'cloud' || running) return;
    void runCloudGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, state.cloud.mode]);

  const handleProjectExport = () => downloadBlob(createProjectExportBlob(state), `${state.projectName}.json`);
  const handleProjectImport = async (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    setState(normalizeProjectState(JSON.parse(await file.text()) as ProjectState));
  };
  const downloadQueueRecipe = (item: QueueItem) => downloadBlob(new Blob([JSON.stringify(item.recipe, null, 2)], { type: 'application/json' }), `recipe_${item.index}.json`);
  const speakPreview = async () => {
    const tts = createElevenLabsAdapter(state.cloud.elevenLabsApiKey, state.cloud.elevenLabsVoiceId);
    await tts.speak(state.script.slice(0, 120), state.voice, state.language);
    setStatus(`音声プレビュー再生: ${tts.name}`);
  };

  const queueDone = queue.filter((x) => x.status === 'done' || x.status === 'failed');
  const wizardChecks = [
    { id: 1, title: '素材を登録', done: Boolean(state.avatar) && (state.productImages?.length ?? 0) > 0 },
    { id: 2, title: '台本と言語を決める', done: Boolean(state.script.trim()) && Boolean(state.language) },
    { id: 3, title: 'シーン/本数を調整', done: Boolean(state.aspectRatio) && (state.scenarioCount > 0 || state.batchCount > 0) },
    { id: 4, title: 'キュー生成して確認', done: queue.length > 0 },
  ];
  const currentWizardStep = wizardChecks.find((step) => !step.done)?.id ?? 4;
  const selectedLanguageHint = languageHints[state.language];

  return (
    <main className="mx-auto max-w-[1800px] p-4">
      <div className="sticky top-0 z-20 mb-4 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-sm font-semibold text-red-700">
        安全通知: このツールの出力はAI生成コンテンツです。本人同意のない人物利用は禁止。なりすまし・誤認を狙う用途は禁止。誇張・虚偽・欺瞞的な主張は避け、各媒体ポリシーと法令に従ってください。目標は「自然で誠実な表現」であり、検知回避や不可検知を保証するものではありません。
      </div>

      <h1 className="mb-2 text-3xl font-black text-violet-700">UGC動画量産スタジオ</h1>
      <p className="mb-2 text-sm text-slate-600">{status}</p>
      <p className="mb-4 text-xs text-slate-500">はじめての方へ: まず「素材登録」→「台本」→「キュー生成」の順に進めると迷いません。</p>

      <div className="mb-4 rounded-2xl border border-indigo-200 bg-white p-3">
        <div className="mb-2 text-sm font-semibold text-indigo-700">かんたん4ステップ（現在: STEP {currentWizardStep}）</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {wizardChecks.map((step) => (
            <div key={step.id} className={`wizard-chip ${step.done ? 'wizard-chip-done' : step.id === currentWizardStep ? 'wizard-chip-active' : ''}`}>
              <span className="text-[11px] font-bold">STEP {step.id}</span>
              <span className="text-xs">{step.title}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pop-panel mb-4">
        <div className="mb-1 font-semibold">生成モード / クラウド設定</div>
        <p className="mb-2 text-xs text-slate-600">安全デフォルト: 初期状態はデモ生成です。実生成時のみクラウドへ切り替えてください。</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <select className="select" value={state.cloud.mode} onChange={(e) => patchState('cloud', { ...state.cloud, mode: e.target.value as 'demo' | 'cloud' })}>
            <option value="demo">デモ（ローカル疑似生成）</option>
            <option value="cloud">クラウド（実生成）</option>
          </select>
          <select className="select" value={state.generationMode} onChange={(e) => patchState('generationMode', e.target.value as GenerationMode)}>
            <option value="same_person_same_product">同一人物 + 同一商品（シーン変化）</option>
            <option value="same_person_product_swap">同一人物 + 商品差し替えリスト</option>
            <option value="person_swap_optional">人物差し替え（任意）</option>
          </select>
          <label className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold">
            <input type="checkbox" checked={state.keepIdentityLocked} onChange={(e) => patchState('keepIdentityLocked', e.target.checked)} /> 人物IDを固定
          </label>
          <input type="password" className="input" placeholder="ElevenLabs API Key" value={state.cloud.elevenLabsApiKey ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, elevenLabsApiKey: e.target.value })} />
          <input className="input" placeholder="ElevenLabs Voice ID" value={state.cloud.elevenLabsVoiceId ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, elevenLabsVoiceId: e.target.value })} />
          <input type="password" className="input" placeholder="Sync API Token" value={state.cloud.syncApiToken ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, syncApiToken: e.target.value })} />
          <input className="input" placeholder="Sync Model ID (任意)" value={state.cloud.syncModelId ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, syncModelId: e.target.value })} />
          <select className="select" value={state.cloud.productReplacementProvider ?? 'auto'} onChange={(e) => patchState('cloud', { ...state.cloud, productReplacementProvider: e.target.value as 'auto' | 'api' | 'browser' })}>
            <option value="auto">商品差し替えプロバイダ: auto</option>
            <option value="api">商品差し替えプロバイダ: api</option>
            <option value="browser">商品差し替えプロバイダ: browser fallback</option>
          </select>
          <input className="input" placeholder="Product Replacement API URL (任意)" value={state.cloud.productReplacementApiUrl ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, productReplacementApiUrl: e.target.value })} />
          <input className="input" placeholder="Product Replacement API Key (任意)" value={state.cloud.productReplacementApiKey ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, productReplacementApiKey: e.target.value })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="panel space-y-3">
          <h2 className="text-lg font-bold text-pink-600">左: 素材管理</h2>
          <label className="label">プロジェクト名</label>
          <input className="input" value={state.projectName} onChange={(e) => patchState('projectName', e.target.value)} />
          <label className="label">人物/アバター画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'avatar')} />
          <button className="btn-secondary" onClick={createIdentityLock} disabled={!state.avatar}>IDロック作成（同意必須）</button>

          <label className="label">商品画像リスト（複数アップロード）</label>
          <input type="file" accept="image/*" multiple className="input" onChange={onUploadMultiProducts} />
          <div className="rounded-lg bg-slate-50 p-2 text-xs">登録商品: {state.productImages?.length ?? 0}件</div>

          <label className="label">人物差し替え候補（任意 / 複数）</label>
          <input type="file" accept="image/*" multiple className="input" onChange={onUploadSwapAvatars} />
          <div className="rounded-lg bg-slate-50 p-2 text-xs">差し替え人物: {state.avatarSwapImages?.length ?? 0}件</div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs">
            <div className="mb-2 font-semibold text-emerald-800">クイックスタート（初回ユーザー向け）</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <button className="btn-secondary" onClick={() => applyQuickPreset('app_promo_fast')}>アプリ訴求（短尺15秒）</button>
              <button className="btn-secondary" onClick={() => applyQuickPreset('product_promo_trust')}>商品訴求（信頼重視）</button>
              <button className="btn-secondary" onClick={() => applyQuickPreset('lock_person_swap_product')}>人物固定×商品差替</button>
              <button className="btn-secondary" onClick={() => applyQuickPreset('scene_variation')}>同一人物同一商品N本</button>
            </div>
          </div>

          <label className="label">背景画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'backgroundImage')} />
          <label className="label">手持ち商品画像（単体）</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'handheldProductImage')} />
          <label className="label">スマホ画面画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'smartphoneScreenImage')} />

          {voiceStyleSuggestion && <div className="rounded-lg bg-slate-50 p-2 text-xs">画像トーン提案: {voiceStyleSuggestion.style} / {voiceStyleSuggestion.reason}</div>}

          <div className="flex flex-wrap gap-2 pt-2">
            <button className="btn" onClick={() => { saveToLocalStorage(state); setStatus('ローカル保存しました'); }}>ローカル保存</button>
            <button className="btn-secondary" onClick={() => setState(normalizeProjectState(loadFromLocalStorage() ?? initialState))}>ローカル読込</button>
            <button className="btn-secondary" onClick={handleProjectExport}>JSON書き出し</button>
            <label className="btn-secondary cursor-pointer">JSON読み込み<input type="file" accept="application/json" className="hidden" onChange={handleProjectImport} /></label>
          </div>
        </section>

        <section className="panel space-y-3">
          <h2 className="text-lg font-bold text-cyan-600">中央: 台本・言語・ジェスチャー</h2>
          <label className="label">言語</label>
          <select className="select" value={state.language} onChange={(e) => patchState('language', e.target.value as Language)}>
            <option value="ja">日本語</option><option value="en">English</option><option value="ko">한국어</option><option value="zh">中文</option><option value="fr">Français</option><option value="it">Italiano</option>
          </select>

          {languageSuggestion && <div className="rounded-lg bg-slate-50 p-2 text-xs">自動提案: {languageLabels[languageSuggestion.language]} / {Math.round(languageSuggestion.confidence * 100)}%</div>}
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs">
            <div className="font-semibold">言語UXヒント: {selectedLanguageHint.audience}</div>
            <div>構成の目安: {selectedLanguageHint.ux}</div>
            <div>注意: {selectedLanguageHint.note}</div>
          </div>

          <label className="label">台本テンプレート</label>
          <select className="select" value={state.selectedTemplateId ?? ''} onChange={(e) => { const id = e.target.value; patchState('selectedTemplateId', id); const tpl = templates.find((x) => x.id === id); if (tpl) patchState('script', tpl.body); }}>
            <option value="">選択してください</option>{templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.title} / {tpl.style}</option>)}
          </select>

          <label className="label">台本バリエーション</label>
          <select className="select" value={state.scriptVariationMode} onChange={(e) => patchState('scriptVariationMode', e.target.value as ScriptVariationMode)}>
            <option value="exact">exact（そのまま使用）</option>
            <option value="paraphrase">paraphrase（軽い自然リライト）</option>
          </select>
          <div className="rounded-lg bg-amber-50 p-2 text-xs">paraphrase補助テンプレート: {(paraphraseTemplates[state.language] ?? []).join(' / ')}</div>

          <label className="label">台本</label>
          <textarea className="textarea min-h-52" value={state.script} onChange={(e) => patchState('script', e.target.value)} />

          <button className="btn-secondary" onClick={() => patchState('gesturePlan', getGesturePlan(state.script, (state.productImages?.[0]?.name ?? '').toLowerCase().includes('app') ? 'app' : 'product', state.language))}>
            ジェスチャープランを生成（hook/problem/solution/cta）
          </button>
          {state.gesturePlan && (
            <div className="rounded-lg bg-slate-900 p-2 text-xs text-emerald-300">
              {state.gesturePlan.segments.map((seg) => (
                <div key={seg.segment} className="mb-2 rounded bg-slate-800 p-2">
                  <div className="font-semibold">{seg.segment}</div>
                  <div>camera: {seg.camera} / gesture: {seg.gesture}</div>
                  <div>expression: {seg.expression} / tempo: {seg.tempo}</div>
                </div>
              ))}
            </div>
          )}

          <button className="btn" onClick={speakPreview}>音声プレビュー</button>
          <p className="text-xs text-slate-500">TTS言語コード: {speechLangCodeMap[state.language]}</p>
        </section>

        <section className="panel space-y-3">
          <h2 className="text-lg font-bold text-violet-600">右: シーン・生成キュー</h2>
          <label className="label">シーンプリセット</label>
          <select className="select" value={state.selectedSceneId ?? ''} onChange={(e) => patchState('selectedSceneId', e.target.value)}>
            <option value="">選択してください</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.name} / {scene.cameraMove}</option>)}
          </select>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div><label className="label">画角比率</label><select className="select" value={state.aspectRatio} onChange={(e) => patchState('aspectRatio', e.target.value as AspectRatio)}><option value="9:16">9:16</option><option value="16:9">16:9</option></select></div>
            <div><label className="label">バッチ本数</label><input type="number" min={1} max={20} className="input" value={state.batchCount} onChange={(e) => patchState('batchCount', Number(e.target.value))} /></div>
            <div><label className="label">1本の長さ（手動）</label><input type="number" min={5} max={60} className="input" value={state.clipLengthSec} onChange={(e) => patchState('clipLengthSec', Number(e.target.value))} /></div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            <div className="mb-2 font-semibold">品質 / 自動補正</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <select className="select" value={state.renderQualityLevel ?? 'balanced'} onChange={(e) => patchState('renderQualityLevel', e.target.value as 'fast' | 'balanced' | 'high')}>
                <option value="fast">Quality: fast</option>
                <option value="balanced">Quality: balanced</option>
                <option value="high">Quality: high</option>
              </select>
              <input type="number" min={0} max={6} className="input" value={state.maxQualityRetries ?? 2} onChange={(e) => patchState('maxQualityRetries', Math.max(0, Math.min(6, Number(e.target.value))))} placeholder="最大リトライ" />
              <label className="inline-flex items-center gap-2 rounded bg-white px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={state.autoFixQuality ?? true} onChange={(e) => patchState('autoFixQuality', e.target.checked)} /> 品質自動補正を有効</label>
            </div>
            <label className="mt-2 inline-flex items-center gap-2 rounded bg-white px-3 py-2 text-xs font-semibold"><input type="checkbox" checked={state.autoDurationFromAudio ?? true} onChange={(e) => patchState('autoDurationFromAudio', e.target.checked)} /> 音声長に合わせて動画尺を自動調整</label>
          </div>

          <label className="label">シナリオ本数（同一人物+同一商品モード用）</label>
          <input type="number" min={1} max={20} className="input" value={state.scenarioCount} onChange={(e) => patchState('scenarioCount', Math.min(20, Math.max(1, Number(e.target.value))))} />

          <div className="rounded-lg bg-indigo-50 p-2 text-xs">
            <div className="font-semibold">同一人物マルチバリエーション</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <select className="select" value={state.variation.preset} onChange={(e) => { const preset = e.target.value as VariationPreset; patchState('variation', { ...state.variation, preset, ...variationPresetValues[preset] }); }}>
                <option value="stable">安定</option><option value="balanced">標準</option><option value="explore">探索</option>
              </select>
              <input className="input" type="number" value={state.variation.seed} onChange={(e) => patchState('variation', { ...state.variation, seed: Number(e.target.value) })} />
              <button className="btn-secondary" onClick={() => patchState('variation', { ...state.variation, seed: Math.floor(Math.random() * 1_000_000_000) })}>シード再生成</button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => buildQueueItems(false)} disabled={running}>STEP 4: 生成キュー開始</button>
            <button className="btn-secondary" onClick={() => buildQueueItems(true)}>さらに追加生成</button>
            <button className="btn-secondary" onClick={handleBulkManifestDownload} disabled={queueDone.length === 0}>manifest一括DL</button>
          </div>

          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                <div className="mb-1 font-semibold">#{item.index} {item.status} / seed:{item.seed}</div>
                <div className="mb-1 h-2 rounded bg-slate-200"><div className={`h-2 rounded ${item.status === 'failed' ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${item.progress}%` }} /></div>
                {item.qualityGate && (
                  <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px]">
                    <span className={`rounded px-2 py-0.5 font-semibold ${item.qualityGate.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>Q {Math.round(item.qualityGate.overall * 100)}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5">blur {Math.round(item.qualityGate.blur * 100)}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5">edge {Math.round(item.qualityGate.boundary * 100)}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5">occ {Math.round(item.qualityGate.occlusion * 100)}</span>
                    <span className="rounded bg-slate-100 px-2 py-0.5">retry {item.qualityGate.attempts - 1}</span>
                    {!!item.qualityGate.warnings.length && <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-700">⚠ {item.qualityGate.warnings.join(', ')}</span>}
                  </div>
                )}
                {item.targetDurationSec && <div className="mb-1 text-[11px] text-slate-600">duration aligned: {item.targetDurationSec.toFixed(1)}s</div>}
                {Boolean((item.recipe as Record<string, unknown>).gesturePlan) && <div className="mb-1 text-[11px] text-slate-600">gesture plan metadata included</div>}
                {(item.status === 'done' || item.status === 'failed') && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={() => downloadQueueRecipe(item)}>JSONレシピ</button>
                    <button className="btn-secondary" onClick={async () => { const artifact = await ensureArtifact(item); if (artifact.kind === 'url') downloadFromUrl(artifact.value, item.downloadName.replace('.webm', '.mp4')); else downloadFromUrl(artifact.value, item.downloadName); }}>
                      出力をダウンロード
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel mt-4">
        <h2 className="mb-2 text-lg font-bold">プレビュー / ダウンロード</h2>
        <canvas ref={previewCanvasRef} className="w-full max-w-[720px] rounded-lg border border-slate-300 bg-slate-900" />
        <p className="mt-2 text-xs text-slate-500">download-first設計: 各アイテム個別DL + manifest一括DL。Cloud modeでも同様の操作で取得できます。</p>
      </section>
    </main>
  );
}
