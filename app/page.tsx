'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import scenePresets from '@/data/scene-presets.json';
import scriptTemplates from '@/data/script-templates.json';
import { createDeterministicIdentityId } from '@/lib/identity';
import { createProjectExportBlob, loadFromLocalStorage, saveToLocalStorage } from '@/lib/storage';
import { createTTSAdapter } from '@/lib/tts';
import { Language, ProjectState, QueueItem, ScenePreset, ScriptTemplate, UploadedAsset } from '@/lib/types';

const initialState: ProjectState = {
  projectName: '新規UGC案件',
  language: 'ja',
  script: 'ここに台本を編集してください。',
  voice: { style: 'natural', pauseMs: 220, breathiness: 20, prosodyRate: 1, pitch: 1 },
  batchCount: 5,
  clipLengthSec: 20,
};

const scenes = scenePresets as ScenePreset[];
const templates = scriptTemplates as ScriptTemplate[];

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

export default function Page() {
  const [state, setState] = useState<ProjectState>(initialState);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('準備完了');
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const loaded = loadFromLocalStorage();
    if (loaded) setState(loaded);
  }, []);

  const selectedScene = scenes.find((s) => s.id === state.selectedSceneId);
  const selectedTemplate = templates.find((t) => t.id === state.selectedTemplateId);

  const lipSyncTimeline = useMemo(() => {
    const length = Math.min(state.clipLengthSec, 60);
    return Array.from({ length: Math.ceil(length / 2) }, (_, i) => ({
      t: i * 2,
      mouthOpen: Number((Math.sin(i) * 0.4 + 0.5).toFixed(2)),
      phoneme: ['a', 'i', 'u', 'e', 'o'][i % 5],
    }));
  }, [state.clipLengthSec]);

  useEffect(() => {
    if (!previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(30 + (frame % 220), 60, 110, 180);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(state.projectName, 24, 34);
      ctx.font = '16px sans-serif';
      ctx.fillText(selectedScene?.name ?? 'シーン未選択', 24, 270);
      ctx.fillText(`言語: ${state.language}`, 24, 295);
      ctx.fillText(`秒数: ${Math.min(state.clipLengthSec, 60)}秒`, 24, 320);
    }, 140);

    return () => clearInterval(id);
  }, [state.projectName, state.language, state.clipLengthSec, selectedScene?.name]);

  function patchState<K extends keyof ProjectState>(key: K, value: ProjectState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  const onUpload = async (evt: ChangeEvent<HTMLInputElement>, key: 'avatar' | 'productImage' | 'outfitRef') => {
    const file = evt.target.files?.[0];
    if (!file) return;
    const asset = await fileToAsset(file);
    patchState(key, asset);
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

  const startQueue = () => {
    const count = Math.min(20, Math.max(5, state.batchCount));
    const items: QueueItem[] = Array.from({ length: count }, (_, i) => {
      const id = crypto.randomUUID();
      const ffmpegCommand = `ffmpeg -loop 1 -i avatar.png -i product.png -t ${Math.min(state.clipLengthSec, 60)} -vf \"scale=1080:1920,drawtext=text='${state.projectName}_${i + 1}'\" -c:v libx264 output_${i + 1}.mp4`;
      const recipe = {
        index: i + 1,
        language: state.language,
        sceneId: state.selectedSceneId,
        templateId: state.selectedTemplateId,
        voice: state.voice,
        lipSyncTimeline,
      };
      return {
        id,
        index: i + 1,
        status: 'queued',
        progress: 0,
        ffmpegCommand,
        recipe,
        downloadName: `placeholder_${i + 1}.mp4`,
      };
    });

    setQueue(items);
    setRunning(true);
    setStatus('キュー生成を開始しました');
  };

  useEffect(() => {
    if (!running || queue.length === 0) return;
    const timer = setInterval(() => {
      setQueue((prev) => {
        const working = [...prev];
        const current = working.find((x) => x.status !== 'done');
        if (!current) {
          setRunning(false);
          setStatus('すべての動画レシピを生成しました');
          clearInterval(timer);
          return prev;
        }
        if (current.status === 'queued') current.status = 'rendering';
        current.progress = Math.min(100, current.progress + 10 + Math.random() * 18);
        if (current.progress >= 100) {
          current.progress = 100;
          current.status = 'done';
        }
        return working;
      });
    }, 500);

    return () => clearInterval(timer);
  }, [running, queue.length]);

  const handleProjectExport = () => downloadBlob(createProjectExportBlob(state), `${state.projectName}.json`);

  const handleProjectImport = async (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setState(JSON.parse(text) as ProjectState);
  };

  const downloadQueueRecipe = (item: QueueItem) => {
    downloadBlob(new Blob([JSON.stringify(item.recipe, null, 2)], { type: 'application/json' }), `recipe_${item.index}.json`);
  };

  const downloadPlaceholderMp4 = (item: QueueItem) => {
    const content = `Placeholder MP4 for ${item.downloadName}\nGenerated by static demo on GH Pages.`;
    downloadBlob(new Blob([content], { type: 'video/mp4' }), item.downloadName);
  };

  const speakPreview = async () => {
    const adapter = createTTSAdapter(false);
    await adapter.speak(state.script.slice(0, 120), state.voice);
    setStatus(`音声プレビュー再生: ${adapter.name}`);
  };

  const saveLocal = () => {
    saveToLocalStorage(state);
    setStatus('ローカル保存しました');
  };

  return (
    <main className="mx-auto max-w-[1800px] p-4">
      <div className="sticky top-0 z-20 mb-4 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-sm font-semibold text-red-700">
        安全通知: このツールの出力はAI生成コンテンツです。本人同意のない人物利用は禁止。なりすまし・誤認を狙う用途は禁止。商用利用時も広告/配信先ポリシーと法令に従ってください。
      </div>

      <h1 className="mb-4 text-2xl font-bold">UGC動画量産スタジオ</h1>
      <p className="mb-4 text-sm text-slate-600">{status}</p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="panel space-y-3">
          <h2 className="text-lg font-bold">左: 素材管理</h2>
          <label className="label">プロジェクト名</label>
          <input className="input" value={state.projectName} onChange={(e) => patchState('projectName', e.target.value)} />

          <label className="label">人物/アバター画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'avatar')} />
          {state.avatar && <img src={state.avatar.dataUrl} alt="avatar" className="h-28 w-28 rounded-lg object-cover" />}
          <button className="btn-secondary" onClick={createIdentityLock} disabled={!state.avatar}>IDロック作成（同意必須）</button>
          {state.identityLock && (
            <div className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-700">
              LockID: {state.identityLock.identityId}<br />
              人物: {state.identityLock.personName}
            </div>
          )}

          <label className="label">商品画像</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'productImage')} />
          <label className="label">衣装リファレンス</label>
          <input type="file" accept="image/*" className="input" onChange={(e) => onUpload(e, 'outfitRef')} />

          <div className="flex flex-wrap gap-2 pt-2">
            <button className="btn" onClick={saveLocal}>ローカル保存</button>
            <button className="btn-secondary" onClick={() => setState(loadFromLocalStorage() ?? initialState)}>ローカル読込</button>
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
          </select>

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
              <option key={tpl.id} value={tpl.id}>{tpl.title} / {tpl.style}</option>
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
            <div>
              <label className="label">Breath(0-100)</label>
              <input type="number" className="input" value={state.voice.breathiness} onChange={(e) => patchState('voice', { ...state.voice, breathiness: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">Prosody Rate</label>
              <input type="number" step="0.1" className="input" value={state.voice.prosodyRate} onChange={(e) => patchState('voice', { ...state.voice, prosodyRate: Number(e.target.value) })} />
            </div>
          </div>
          <button className="btn" onClick={speakPreview}>音声プレビュー（ブラウザTTSフォールバック）</button>
        </section>

        <section className="panel space-y-3">
          <h2 className="text-lg font-bold">右: シーン・バッチ・生成</h2>
          <label className="label">シーンプリセット (100件)</label>
          <select className="select" value={state.selectedSceneId ?? ''} onChange={(e) => patchState('selectedSceneId', e.target.value)}>
            <option value="">選択してください</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>{scene.name} / {scene.lighting} / {scene.cameraMove}</option>
            ))}
          </select>

          {selectedScene && (
            <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
              場所: {selectedScene.location} / 雰囲気: {selectedScene.mood} / 推奨秒数: {selectedScene.durationSec}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">バッチ本数 (5-20)</label>
              <input type="number" min={5} max={20} className="input" value={state.batchCount} onChange={(e) => patchState('batchCount', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">1本の長さ (&lt;=60秒)</label>
              <input type="number" min={5} max={60} className="input" value={state.clipLengthSec} onChange={(e) => patchState('clipLengthSec', Number(e.target.value))} />
            </div>
          </div>

          <button className="btn" onClick={startQueue} disabled={running}>デモ生成キュー開始</button>
          <p className="text-xs text-slate-500">※ GitHub Pagesではffmpeg実行はせず、コマンドプレビューのみ生成します。</p>

          <div className="space-y-2">
            {queue.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 p-2 text-xs">
                <div className="mb-1 font-semibold">#{item.index} {item.status}</div>
                <div className="mb-1 h-2 rounded bg-slate-200">
                  <div className="h-2 rounded bg-indigo-500" style={{ width: `${item.progress}%` }} />
                </div>
                <div className="mb-1 overflow-x-auto text-[10px] text-slate-600">{item.ffmpegCommand}</div>
                {item.status === 'done' && (
                  <div className="flex gap-2">
                    <button className="btn-secondary" onClick={() => downloadQueueRecipe(item)}>JSONレシピ</button>
                    <button className="btn-secondary" onClick={() => downloadPlaceholderMp4(item)}>MP4プレースホルダ</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel mt-4">
        <h2 className="mb-2 text-lg font-bold">プレビュー / ダウンロード</h2>
        <canvas ref={previewCanvasRef} width={360} height={640} className="rounded-lg border border-slate-300" />
        <p className="mt-2 text-xs text-slate-500">クライアントサイドCanvasでの疑似コンポジションプレビュー（最大60秒想定）</p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">リップシンク・タイムラインメタデータ</summary>
          <pre className="max-h-52 overflow-auto rounded bg-slate-900 p-2 text-emerald-300">{JSON.stringify(lipSyncTimeline, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}
