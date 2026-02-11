import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = fileURLToPath(new URL('../src/data', import.meta.url));
mkdirSync(baseDir, { recursive: true });

const sceneTypes = ['リビング', 'キッチン', '寝室', 'オフィス', 'カフェ', 'ジム', 'ベランダ', '洗面所', '玄関', 'スタジオ'];
const lighting = ['自然光', 'ソフトボックス', '夕方の逆光', 'ネオン', '暖色ライト'];
const camera = ['固定', 'ゆっくりパン', '手持ち風', 'ズームイン', '俯瞰'];
const moods = ['清潔感', '高級感', '親しみ', '元気', '落ち着き'];

const scenes = Array.from({ length: 100 }, (_, i) => {
  const idx = i + 1;
  return {
    id: `scene-${idx.toString().padStart(3, '0')}`,
    name: `${sceneTypes[i % sceneTypes.length]}シーン ${idx}`,
    location: sceneTypes[i % sceneTypes.length],
    lighting: lighting[i % lighting.length],
    cameraMove: camera[i % camera.length],
    mood: moods[i % moods.length],
    props: ['商品パッケージ', 'マグカップ', '観葉植物', 'ノートPC'].slice(0, 2 + (i % 3)),
    durationSec: 12 + (i % 10),
    tags: ['UGC', 'リアル', '縦動画']
  };
});

const templateHooks = ['最初の3秒で惹きつける', '失敗談から入る', '比較で見せる', 'ビフォーアフター', '体験レビュー'];
const templateCtas = ['今すぐ詳細を見る', 'プロフィールのリンクをチェック', '保存してあとで見返してね', 'コメントで質問してね'];

const templates = Array.from({ length: 50 }, (_, i) => {
  const idx = i + 1;
  return {
    id: `tpl-${idx.toString().padStart(3, '0')}`,
    title: `TikTok Shop台本テンプレ ${idx}`,
    style: templateHooks[i % templateHooks.length],
    body: `【導入】${templateHooks[i % templateHooks.length]}！\n【悩み】{{target_audience}}の悩みは「{{pain_point}}」。\n【提案】そこで{{product_name}}を{{usage_scene}}で使ってみました。\n【根拠】{{benefit_1}}・{{benefit_2}}・{{benefit_3}}が特に実感ポイント。\n【締め】${templateCtas[i % templateCtas.length]}。`,
    placeholders: ['target_audience', 'pain_point', 'product_name', 'usage_scene', 'benefit_1', 'benefit_2', 'benefit_3'],
    recommendedDurationSec: 20 + (i % 25)
  };
});

writeFileSync(join(baseDir, 'scene-presets.json'), JSON.stringify(scenes, null, 2), 'utf8');
writeFileSync(join(baseDir, 'script-templates.json'), JSON.stringify(templates, null, 2), 'utf8');

console.log('Generated scene-presets.json and script-templates.json');
