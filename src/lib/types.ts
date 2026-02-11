export type Language = 'ja' | 'en' | 'ko' | 'zh' | 'fr' | 'it';
export type AspectRatio = '9:16' | '16:9';

export interface UploadedAsset {
  name: string;
  dataUrl: string;
  mimeType: string;
  size: number;
}

export interface IdentityLock {
  personName: string;
  identityId: string;
  consentChecked: boolean;
  createdAt: string;
}

export interface VoiceOptions {
  style: 'natural' | 'energetic' | 'calm' | 'luxury';
  pauseMs: number;
  breathiness: number;
  prosodyRate: number;
  pitch: number;
}

export interface CompositionLayerSetting {
  enabled: boolean;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface CompositionSettings {
  personCutout: CompositionLayerSetting;
  background: CompositionLayerSetting;
  outfitRef: CompositionLayerSetting;
  handheldProduct: CompositionLayerSetting;
  smartphoneScreen: CompositionLayerSetting;
  poseReferenceAssist: CompositionLayerSetting;
  sceneBlendStrength: number;
}

export type VariationPreset = 'stable' | 'balanced' | 'explore';

export interface VariationSettings {
  preset: VariationPreset;
  seed: number;
  sceneJitter: number;
  outfitJitter: number;
  backgroundJitter: number;
}

export type RenderQualityLevel = 'fast' | 'balanced' | 'high';

export interface CloudSettings {
  mode: 'demo' | 'cloud';
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  syncApiToken?: string;
  syncModelId?: string;
  overlayProvider?: 'auto' | 'cloud' | 'browser';
  overlayApiKey?: string;
  productReplacementProvider?: 'auto' | 'api' | 'browser';
  productReplacementApiKey?: string;
  productReplacementApiUrl?: string;
}

export type GenerationMode = 'same_person_same_product' | 'same_person_product_swap' | 'person_swap_optional';
export type ScriptVariationMode = 'exact' | 'paraphrase';

export interface GestureSegment {
  segment: 'hook' | 'problem' | 'solution' | 'cta';
  text: string;
  camera: string;
  gesture: string;
  expression: string;
  tempo: string;
}

export interface GesturePlan {
  productType: string;
  segments: GestureSegment[];
}

export interface QualityGateScores {
  blur: number;
  boundary: number;
  occlusion: number;
  overall: number;
  warnings: string[];
  attempts: number;
  passed: boolean;
}

export interface ProjectState {
  schemaVersion: number;
  projectName: string;
  language: Language;
  avatar?: UploadedAsset;
  productImage?: UploadedAsset;
  productImages?: UploadedAsset[];
  avatarSwapImages?: UploadedAsset[];
  outfitRef?: UploadedAsset;
  backgroundImage?: UploadedAsset;
  handheldProductImage?: UploadedAsset;
  smartphoneScreenImage?: UploadedAsset;
  holdReferenceImage?: UploadedAsset;
  identityLock?: IdentityLock;
  keepIdentityLocked: boolean;
  generationMode: GenerationMode;
  scenarioCount: number;
  selectedSceneId?: string;
  selectedTemplateId?: string;
  script: string;
  scriptVariationMode: ScriptVariationMode;
  gesturePlan?: GesturePlan;
  voice: VoiceOptions;
  batchCount: number;
  clipLengthSec: number;
  autoDurationFromAudio?: boolean;
  renderQualityLevel?: RenderQualityLevel;
  maxQualityRetries?: number;
  autoFixQuality?: boolean;
  aspectRatio: AspectRatio;
  cloud: CloudSettings;
  composition: CompositionSettings;
  variation: VariationSettings;
}

export interface ScenePreset {
  id: string;
  name: string;
  location: string;
  lighting: string;
  cameraMove: string;
  mood: string;
  props: string[];
  durationSec: number;
  tags: string[];
}

export interface ScriptTemplate {
  id: string;
  title: string;
  style: string;
  body: string;
  placeholders: string[];
  recommendedDurationSec: number;
}

export interface QueueItem {
  id: string;
  index: number;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  progress: number;
  ffmpegCommand: string;
  recipe: Record<string, unknown>;
  downloadName: string;
  seed: number;
  audioUrl?: string;
  videoUrl?: string;
  composedImageUrl?: string;
  artifactUrl?: string;
  artifactMime?: string;
  qualityGate?: QualityGateScores;
  targetDurationSec?: number;
  error?: string;
}
