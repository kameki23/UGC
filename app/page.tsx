'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import scenePresets from '@/data/scene-presets.json';
import scriptTemplates from '@/data/script-templates.json';
import { generateLipSyncVideoWithSync } from '@/lib/cloud';
import { createOverlayProvider, createPlaceholderVideoBlob } from '@/lib/compositor';
import { createDeterministicIdentityId } from '@/lib/identity';
import { createProjectExportBlob, defaultComposition, defaultVariation, loadFromLocalStorage, saveToLocalStorage } from '@/lib/storage';
import { detectLanguageFromScript, languageLabels, speechLangCodeMap } from '@/lib/language';
import { suggestVoiceStyleFromImage } from '@/lib/style-suggestion';
import { createElevenLabsAdapter } from '@/lib/tts';
import { AspectRatio, Language, ProjectState, QueueItem, ScenePreset, ScriptTemplate, UploadedAsset, VariationPreset } from '@/lib/types';

const initialState: ProjectState = {
  schemaVersion: 2,
  projectName: '新規UGC案件',
  language: 'ja',
  script: 'ここに台本を編集してください。',
  voice: { style: 'natural', pauseMs: 220, breathiness: 20, prosodyRate: 1, pitch: 1 },
  batchCount: 5,
  clipLengthSec: 20,
  aspectRatio: '9:16',
  cloud: {
    mode: 'demo',
    elevenLabsApiKey: '',
    elevenLabsVoiceId: '',
    syncApiToken: '',
    syncModelId: 'lipsync-2',
    overlayProvider: 'auto',
    overlayApiKey: '',
  },
  composition: defaultComposition,
  variation: defaultVariation,
};

const scenes = scenePresets as ScenePreset[];
const templates = scriptTemplates as ScriptTemplate[];

const getVideoSize = (aspectRatio: AspectRatio) => (aspectRatio === '16:9' ? { width: 1280, height: 720 } : { width: 1080, height: 1920 });

const normalizeProjectState = (loaded: ProjectState): ProjectState => ({
  ...initialState,
  ...loaded,
  schemaVersion: 2,
  cloud: { ...initialState.cloud, ...(loaded.cloud ?? {}) },
  composition: { ...initialState.composition, ...(loaded.composition ?? {}) },
  variation: { ...initialState.variation, ...(loaded.variation ?? {}) },
  handheldProductImage: loaded.handheldProductImage ?? loaded.productImage,
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

const variationPresetValues: Record<VariationPreset, Pick<ProjectState['variation'], 'sceneJitter' | 'outfitJitter' | 'backgroundJitter'>> = {
  stable: { sceneJitter: 0.06, outfitJitter: 0.05, backgroundJitter: 0.05 },
  balanced: { sceneJitter: 0.2, outfitJitter: 0.15, backgroundJitter: 0.15 },
  explore: { sceneJitter: 0.42, outfitJitter: 0.35, backgroundJitter: 0.38 },
};

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

  useEffect(() => {
    setLanguageSuggestion(detectLanguageFromScript(state.script));
  }, [state.script]);

  const lipSyncTimeline = useMemo(() => {
    const length = Math.min(state.clipLengthSec, 60);
    const phonemeMap: Record<Language, string[]> = {
      ja: ['a', 'i', 'u', 'e', 'o'],
      en: ['ae', 'ih', 'uh', 'eh', 'ow'],
      ko: ['a', 'eo', 'u', 'i', 'eu'],
      zh: ['a', 'i', 'u', 'e', 'o'],
      fr: ['a', 'e', 'i', 'o', 'u'],
      it: ['a', 'e', 'i', 'o', 'u'],
    };
    const phonemes = phonemeMap[state.language] ?? phonemeMap.en;
    return Array.from({ length: Math.ceil(length / 2) }, (_, i) => ({
      t: i * 2,
      mouthOpen: Number((Math.sin(i) * 0.4 + 0.5).toFixed(2)),
      phoneme: phonemes[i % phonemes.length],
    }));
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
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (state.backgroundImage) {
        const bg = new Image();
        bg.src = state.backgroundImage.dataUrl;
        ctx.globalAlpha = 0.9;
        ctx.drawImage(bg, 0, 0, width, height);
      }

      const cardX = Math.round(width * 0.07) + (frame % Math.max(140, Math.round(width * 0.22)));
      const cardY = Math.round(height * 0.16);
      const cardW = Math.round(width * 0.22);
      const cardH = Math.round(height * 0.28);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cardX, cardY, cardW, cardH);

      ctx.fillStyle = '#f8fafc';
      ctx.font = `${Math.max(18, Math.round(width * 0.018))}px sans-serif`;
      ctx.fillText(state.projectName, Math.round(width * 0.05), Math.round(height * 0.06));
      ctx.font = `${Math.max(16, Math.round(width * 0.014))}px sans-serif`;
      ctx.fillText(selectedScene?.name ?? 'シーン未選択', Math.round(width * 0.05), Math.round(height * 0.76));
      ctx.fillText(`言語: ${state.language}`, Math.round(width * 0.05), Math.round(height * 0.82));
      ctx.fillText(`秒数: ${Math.min(state.clipLengthSec, 60)}秒`, Math.round(width * 0.05), Math.round(height * 0.88));
      ctx.fillText(`比率: ${state.aspectRatio}`, Math.round(width * 0.05), Math.round(height * 0.94));
    }, 160);

    return () => clearInterval(id);
  }, [state.projectName, state.language, state.clipLengthSec, state.aspectRatio, selectedScene?.name, state.backgroundImage]);

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

    if (key === 'avatar') {
      const suggested = await suggestVoiceStyleFromImage(asset.dataUrl);
      setVoiceStyleSuggestion(suggested);
    }
  };

  const createIdentityLock = async () => {
    if (!state.avatar) return;
    const personName = prompt('人物名を入力してください（同意済みの本人のみ）') ?? '';
    if (!personName) return;
    const identityId = await createDeterministicIdentityId(personName, state.avatar.dataUrl);
    patchState('identityLock', {
      personName,
      identityId,
      consentChecked: true,
      createdAt: new Date().toISOString(),
    });
  };

  const buildQueueItems = (append = false) => {
    const count = Math.min(20, Math.max(1, state.batchCount));
    const existing = append ? queue.length : 0;
    const items: QueueItem[] = Array.from({ length: count }, (_, i) => {
      const idx = existing + i + 1;
      const id = crypto.randomUUID();
      const { width, height } = getVideoSize(state.aspectRatio);
      const itemSeed = state.variation.seed + idx * 17;
      const ffmpegCommand = `ffmpeg -loop 1 -i composed_${idx}.png -i voice_${idx}.mp3 -t ${Math.min(state.clipLengthSec, 60)} -vf "scale=${width}:${height}" -c:v libx264 output_${idx}.mp4`;
      const recipe = {
        index: idx,
        seed: itemSeed,
        language: state.language,
        sceneId: state.selectedSceneId,
        templateId: state.selectedTemplateId,
        voice: state.voice,
        aspectRatio: state.aspectRatio,
        variation: state.variation,
        composition: state.composition,
        resolution: `${width}x${height}`,
        lipSyncTimeline,
      };
      return {
        id,
        index: idx,
        status: 'queued',
        progress: 0,
        ffmpegCommand,
        recipe,
        seed: itemSeed,
        downloadName: `ugc_${state.aspectRatio.replace(':', 'x')}_${idx}.webm`,
      };
    });

    setQueue((prev) => (append ? [...prev, ...items] : items));
    setStatus(append ? `追加キュー ${count} 本を連結しました` : '生成キューを開始しました');
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

  const runCloudGeneration = async () => {
    if (!state.avatar) {
      setStatus('クラウド生成には人物画像が必要です');
      return;
    }
    if (!state.cloud.elevenLabsApiKey || !state.cloud.elevenLabsVoiceId || !state.cloud.syncApiToken) {
      setStatus('クラウド生成にはElevenLabs API Key/Voice ID と Sync API Tokenが必要です');
      return;
    }

    setRunning(true);
    try {
      for (const item of queue) {
        if (item.status !== 'queued') continue;

        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'rendering', progress: 8 } : q)));

        const { width, height } = getVideoSize(state.aspectRatio);
        const overlayProvider = createOverlayProvider(state);
        const overlay = await overlayProvider.synthesize({ state, seed: item.seed, width, height });

        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, composedImageUrl: overlay.composedDataUrl, progress: 28 } : q)));

        const tts = createElevenLabsAdapter(state.cloud.elevenLabsApiKey, state.cloud.elevenLabsVoiceId);
        if (!tts.synthesize) throw new Error('TTS adapter synthesize未対応');

        const audioBlob = await tts.synthesize(state.script.slice(0, 1200), state.voice, state.language);
        const audioUrl = URL.createObjectURL(audioBlob);
        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, progress: 56, audioUrl } : q)));

        const videoUrl = await generateLipSyncVideoWithSync(
          state.cloud.syncApiToken,
          overlay.composedDataUrl,
          audioBlob,
          state.language,
          state.aspectRatio,
          state.cloud.syncModelId || 'lipsync-2',
        );

        setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'done', progress: 100, videoUrl } : q)));
      }
      setStatus('クラウド生成が完了しました。未返却時はローカルplaceholderを生成して保存できます。');
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

      const currentFresh = queue.find((x) => x.id === current.id) ?? current;
      if (currentFresh.progress >= 72) {
        const { width, height } = getVideoSize(state.aspectRatio);
        const overlay = await createOverlayProvider(state).synthesize({ state, seed: current.seed, width, height });
        const artifact = await createPlaceholderVideoBlob(overlay.composedDataUrl, state.clipLengthSec);
        const artifactUrl = URL.createObjectURL(artifact.blob);
        setQueue((prev) =>
          prev.map((x) =>
            x.id === current.id
              ? { ...x, status: 'done', progress: 100, composedImageUrl: overlay.composedDataUrl, artifactUrl, artifactMime: artifact.mimeType }
              : x,
          ),
        );
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
    const text = await file.text();
    setState(normalizeProjectState(JSON.parse(text) as ProjectState));
  };

  const downloadQueueRecipe = (item: QueueItem) => {
    downloadBlob(new Blob([JSON.stringify(item.recipe, null, 2)], { type: 'application/json' }), `recipe_${item.index}.json`);
  };

  const speakPreview = async () => {
    const tts = createElevenLabsAdapter(state.cloud.elevenLabsApiKey, state.cloud.elevenLabsVoiceId);
    await tts.speak(state.script.slice(0, 120), state.voice, state.language);
    setStatus(`音声プレビュー再生: ${tts.name}`);
  };

  const saveLocal = () => {
    saveToLocalStorage(state);
    setStatus('ローカル保存しました');
  };

  return (
    <main className="mx-auto max-w-[1800px] p-4">
      <div className="sticky top-0 z-20 mb-4 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-sm font-semibold text-red-700">
        安全通知: このツールの出力はAI生成コンテンツです。本人同意のない人物利用は禁止。なりすまし・誤認を狙う用途は禁止。商用では「高い自然さ」を目指しますが、欺瞞的な表現や誤解誘導は行わず、各媒体ポリシーと法令に従ってください。
      </div>

      <h1 className="mb-4 text-2xl font-bold">UGC動画量産スタジオ</h1>
      <p className="mb-4 text-sm text-slate-600">{status}</p>

      <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
        <div className="mb-2 font-semibold">生成モード / クラウド設定</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <select className="select" value={state.cloud.mode} onChange={(e) => patchState('cloud', { ...state.cloud, mode: e.target.value as 'demo' | 'cloud' })}>
            <option value="demo">デモ（ローカル疑似生成）</option>
            <option value="cloud">クラウド（実生成）</option>
          </select>
          <input className="input" placeholder="ElevenLabs API Key" value={state.cloud.elevenLabsApiKey ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, elevenLabsApiKey: e.target.value })} />
          <input className="input" placeholder="ElevenLabs Voice ID" value={state.cloud.elevenLabsVoiceId ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, elevenLabsVoiceId: e.target.value })} />
          <input className="input" placeholder="Sync API Token" value={state.cloud.syncApiToken ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, syncApiToken: e.target.value })} />
          <input className="input" placeholder="Sync Model ID (任意)" value={state.cloud.syncModelId ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, syncModelId: e.target.value })} />
          <select className="select" value={state.cloud.overlayProvider ?? 'auto'} onChange={(e) => patchState('cloud', { ...state.cloud, overlayProvider: e.target.value as 'auto' | 'cloud' | 'browser' })}>
            <option value="auto">オーバーレイ合成: 自動</option>
            <option value="cloud">オーバーレイ合成: クラウド優先</option>
            <option value="browser">オーバーレイ合成: ブラウザCanvas</option>
          </select>
          <input className="input" placeholder="Overlay Provider API Key (任意)" value={state.cloud.overlayApiKey ?? ''} onChange={(e) => patchState('cloud', { ...state.cloud, overlayApiKey: e.target.value })} />
        </div>
        <p className="mt-2 text-xs text-slate-600">※ APIキーはブラウザ内保存です。公開URLで使う場合は漏洩に注意してください（使い捨てキー推奨）。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="panel space-y-3">
          <h2 className="text-lg font-bold">左: 素材管理</h2>
          <label className="label">プロジェクト名</label>
          <input className="input" value={state.projectName} onChange={(e) => patchState('projectName', e.target.value)} />

          <label className="label">人物/アバター画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'avatar')} />
          {state.avatar && <img src={state.avatar.dataUrl} alt="avatar" className="h-28 w-28 rounded-lg object-cover" />}
          <button className="btn-secondary" onClick={createIdentityLock} disabled={!state.avatar}>IDロック作成（同意必須）</button>
          {voiceStyleSuggestion && (
            <div className="rounded-lg bg-slate-50 p-2 text-xs">
              <div className="font-semibold">画像トーンから音声スタイル提案（属性推定なし）</div>
              <div>提案: {voiceStyleSuggestion.style} / {voiceStyleSuggestion.reason}</div>
              <div className="text-slate-500">brightness:{voiceStyleSuggestion.metrics.brightness} saturation:{voiceStyleSuggestion.metrics.saturation} warm:{voiceStyleSuggestion.metrics.warmRatio}</div>
              <button className="btn-secondary mt-2" onClick={() => patchState('voice', { ...state.voice, style: voiceStyleSuggestion.style })}>提案スタイルを適用</button>
            </div>
          )}

          <label className="label">背景画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'backgroundImage')} />
          <label className="label">手持ち商品画像（手で持つ商品）</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'handheldProductImage')} />
          <label className="label">スマホ画面画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'smartphoneScreenImage')} />
          <label className="label">商品画像（互換）</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'productImage')} />
          <label className="label">衣装リファレンス</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'outfitRef')} />
          <label className="label">任意: 商品/スマホ保持ポーズ参考画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'holdReferenceImage')} />

          <div className="rounded-lg bg-slate-50 p-2 text-xs">
            <div className="mb-1 font-semibold">コンポジション設定（%）</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" type="number" step="1" value={Math.round(state.composition.handheldProduct.x * 100)} onChange={(e) => patchState('composition', { ...state.composition, handheldProduct: { ...state.composition.handheldProduct, x: Number(e.target.value) / 100 } })} placeholder="商品X" />
              <input className="input" type="number" step="1" value={Math.round(state.composition.handheldProduct.y * 100)} onChange={(e) => patchState('composition', { ...state.composition, handheldProduct: { ...state.composition.handheldProduct, y: Number(e.target.value) / 100 } })} placeholder="商品Y" />
              <input className="input" type="number" step="1" value={Math.round(state.composition.smartphoneScreen.x * 100)} onChange={(e) => patchState('composition', { ...state.composition, smartphoneScreen: { ...state.composition.smartphoneScreen, x: Number(e.target.value) / 100 } })} placeholder="スマホX" />
              <input className="input" type="number" step="1" value={Math.round(state.composition.smartphoneScreen.y * 100)} onChange={(e) => patchState('composition', { ...state.composition, smartphoneScreen: { ...state.composition.smartphoneScreen, y: Number(e.target.value) / 100 } })} placeholder="スマホY" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button className="btn" onClick={saveLocal}>ローカル保存</button>
            <button
              className="btn-secondary"
              onClick={() => {
                const loaded = loadFromLocalStorage();
                setState(loaded ? normalizeProjectState(loaded) : initialState);
              }}
            >
              ローカル読込
            </button>
            <button className="btn-secondary" onClick={handleProjectExport}>JSON書き出し</button>
            <label className="btn-secondary cursor-pointer">
              JSON読み込み<input type="file" accept="application/json" className="hidden" onChange={handleProjectImport} />
            </label>
          </div>
        </section>

        <section className="panel space-y-3">
          <h2 className="text-lg font-bold">中央: 台本・言語・音声</h2>
          <label className="label">言語</label>
          <select className="select" value={state.language} onChange={(e) => patchState('language', e.target.value as Language)}>
            <option value="ja">日本語 (ja)</option>
            <option value="en">English (en)</option>
            <option value="ko">한국어 (ko)</option>
            <option value="zh">中文 (zh)</option>
            <option value="fr">Français (fr)</option>
            <option value="it">Italiano (it)</option>
          </select>
          {languageSuggestion && (
            <div className="rounded-lg bg-slate-50 p-2 text-xs">
              <div>自動提案: {languageLabels[languageSuggestion.language]} ({languageSuggestion.language}) / 信頼度 {Math.round(languageSuggestion.confidence * 100)}%</div>
              <div className="text-slate-500">根拠: {languageSuggestion.reason}</div>
              <button className="btn-secondary mt-2" onClick={() => patchState('language', languageSuggestion.language)}>提案言語を適用</button>
            </div>
          )}

          <label className="label">台本テンプレート (50件)</label>
          <select
            className="select"
            value={state.selectedTemplateId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              patchState('selectedTemplateId', id);
              const tpl = templates.find((x) => x.id === id);
              if (tpl) patchState('script', tpl.body);
            }}
          >
            <option value="">選択してください</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.title} / {tpl.style}
              </option>
            ))}
          </select>

          <label className="label">台本</label>
          <textarea className="textarea min-h-52" value={state.script} onChange={(e) => patchState('script', e.target.value)} />
          {selectedTemplate && <p className="text-xs text-slate-500">プレースホルダ: {selectedTemplate.placeholders.join(', ')}</p>}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">音声スタイル</label>
              <select className="select" value={state.voice.style} onChange={(e) => patchState('voice', { ...state.voice, style: e.target.value as ProjectState['voice']['style'] })}>
                <option value="natural">Natural</option>
                <option value="energetic">Energetic</option>
                <option value="calm">Calm</option>
                <option value="luxury">Luxury</option>
              </select>
            </div>
            <div>
              <label className="label">Pause(ms)</label>
              <input type="number" className="input" value={state.voice.pauseMs} onChange={(e) => patchState('voice', { ...state.voice, pauseMs: Number(e.target.value) })} />
            </div>
          </div>
          <button className="btn" onClick={speakPreview}>音声プレビュー（ElevenLabs優先）</button>
          <p className="text-xs text-slate-500">TTS言語コード: {speechLangCodeMap[state.language]}（ElevenLabs未設定時はブラウザ音声にフォールバック）</p>
        </section>

        <section className="panel space-y-3">
          <h2 className="text-lg font-bold">右: シーン・バリエーション・生成</h2>
          <label className="label">シーンプリセット (100件)</label>
          <select className="select" value={state.selectedSceneId ?? ''} onChange={(e) => patchState('selectedSceneId', e.target.value)}>
            <option value="">選択してください</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name} / {scene.lighting} / {scene.cameraMove}
              </option>
            ))}
          </select>

          {selectedScene && <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">場所: {selectedScene.location} / 雰囲気: {selectedScene.mood}</div>}

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>
              <label className="label">画角比率</label>
              <select className="select" value={state.aspectRatio} onChange={(e) => patchState('aspectRatio', e.target.value as AspectRatio)}>
                <option value="9:16">9:16（縦動画）</option>
                <option value="16:9">16:9（横動画）</option>
              </select>
            </div>
            <div>
              <label className="label">バッチ本数 (1-20)</label>
              <input type="number" min={1} max={20} className="input" value={state.batchCount} onChange={(e) => patchState('batchCount', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">1本の長さ (&lt;=60秒)</label>
              <input type="number" min={5} max={60} className="input" value={state.clipLengthSec} onChange={(e) => patchState('clipLengthSec', Number(e.target.value))} />
            </div>
          </div>

          <div className="rounded-lg bg-indigo-50 p-2 text-xs">
            <div className="mb-1 font-semibold">同一人物マルチバリエーション</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <select
                className="select"
                value={state.variation.preset}
                onChange={(e) => {
                  const preset = e.target.value as VariationPreset;
                  patchState('variation', { ...state.variation, preset, ...variationPresetValues[preset] });
                }}
              >
                <option value="stable">安定（変化小）</option>
                <option value="balanced">標準</option>
                <option value="explore">探索（変化大）</option>
              </select>
              <input className="input" type="number" value={state.variation.seed} onChange={(e) => patchState('variation', { ...state.variation, seed: Number(e.target.value) })} placeholder="シード" />
              <button className="btn-secondary" onClick={() => patchState('variation', { ...state.variation, seed: Math.floor(Math.random() * 1_000_000_000) })}>シード再生成</button>
            </div>
            <p className="mt-1 text-[11px] text-slate-600">人物IDは固定、衣装/背景/シーンだけをseedで変化させます。</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => buildQueueItems(false)} disabled={running}>生成キュー開始</button>
            <button className="btn-secondary" onClick={() => buildQueueItems(true)}>さらに追加生成（Append More）</button>
          </div>

          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                <div className="mb-1 font-semibold">
                  #{item.index} {item.status} / seed:{item.seed}
                </div>
                <div className="mb-1 h-2 rounded bg-slate-200">
                  <div className={`h-2 rounded ${item.status === 'failed' ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${item.progress}%` }} />
                </div>
                {item.error && <div className="mb-1 text-[10px] text-red-600">{item.error}</div>}
                {(item.status === 'done' || item.status === 'failed') && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={() => downloadQueueRecipe(item)}>JSONレシピ</button>
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        const artifact = await ensureArtifact(item);
                        if (artifact.kind === 'url') downloadFromUrl(artifact.value, item.downloadName.replace('.webm', '.mp4'));
                        else downloadFromUrl(artifact.value, item.downloadName);
                      }}
                    >
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
        <p className="mt-2 text-xs text-slate-500">Canvas合成プレビュー（同一人物のまま背景/商品/スマホ重ね合わせ）</p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">リップシンク・タイムラインメタデータ</summary>
          <pre className="max-h-52 overflow-auto rounded bg-slate-900 p-2 text-emerald-300">{JSON.stringify(lipSyncTimeline, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}
