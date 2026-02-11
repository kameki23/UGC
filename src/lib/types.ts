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

export interface CloudSettings {
  mode: 'demo' | 'cloud';
  elevenLabsApiKey?: string;
  elevenLabsVoiceId?: string;
  syncApiToken?: string;
  syncModelId?: string;
  overlayProvider?: 'auto' | 'cloud' | 'browser';
  overlayApiKey?: string;
}

export interface ProjectState {
  schemaVersion: number;
  projectName: string;
  language: Language;
  avatar?: UploadedAsset;
  productImage?: UploadedAsset;
  outfitRef?: UploadedAsset;
  backgroundImage?: UploadedAsset;
  handheldProductImage?: UploadedAsset;
  smartphoneScreenImage?: UploadedAsset;
  holdReferenceImage?: UploadedAsset;
  identityLock?: IdentityLock;
  selectedSceneId?: string;
  selectedTemplateId?: string;
  script: string;
  voice: VoiceOptions;
  batchCount: number;
  clipLengthSec: number;
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
  error?: string;
}
