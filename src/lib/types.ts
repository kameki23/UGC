export type Language = 'ja' | 'en' | 'ko' | 'zh';
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

export interface ProjectState {
  projectName: string;
  language: Language;
  avatar?: UploadedAsset;
  productImage?: UploadedAsset;
  outfitRef?: UploadedAsset;
  identityLock?: IdentityLock;
  selectedSceneId?: string;
  selectedTemplateId?: string;
  script: string;
  voice: VoiceOptions;
  batchCount: number;
  clipLengthSec: number;
  aspectRatio: AspectRatio;
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
  status: 'queued' | 'rendering' | 'done';
  progress: number;
  ffmpegCommand: string;
  recipe: Record<string, unknown>;
  downloadName: string;
}
