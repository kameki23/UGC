import { CompositionSettings, ProjectState, VariationSettings } from './types';

const STORAGE_KEY = 'ugc-video-studio-project-v3';
const LEGACY_STORAGE_KEY = 'ugc-video-studio-project-v2';

const defaultComposition: CompositionSettings = {
  personCutout: { enabled: true, x: 0.5, y: 0.62, scale: 1, rotation: 0, opacity: 1 },
  background: { enabled: true, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
  outfitRef: { enabled: true, x: 0.5, y: 0.6, scale: 1, rotation: 0, opacity: 0.7 },
  handheldProduct: { enabled: true, x: 0.72, y: 0.72, scale: 0.28, rotation: -12, opacity: 1 },
  smartphoneScreen: { enabled: true, x: 0.3, y: 0.73, scale: 0.24, rotation: 8, opacity: 1 },
  poseReferenceAssist: { enabled: false, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 0.15 },
  sceneBlendStrength: 0.65,
};

const defaultVariation: VariationSettings = {
  preset: 'balanced',
  seed: 20260211,
  sceneJitter: 0.2,
  outfitJitter: 0.15,
  backgroundJitter: 0.15,
};

export function saveToLocalStorage(data: ProjectState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function parseRaw(raw: string): ProjectState | null {
  try {
    const data = JSON.parse(raw) as Partial<ProjectState>;
    const schemaVersion = Number(data.schemaVersion ?? 1);
    return {
      ...(data as ProjectState),
      cloud: {
        mode: data.cloud?.mode ?? 'demo',
        elevenLabsApiKey: data.cloud?.elevenLabsApiKey ?? '',
        elevenLabsVoiceId: data.cloud?.elevenLabsVoiceId ?? '',
        syncApiToken: data.cloud?.syncApiToken ?? '',
        syncModelId: data.cloud?.syncModelId ?? '',
        overlayProvider: data.cloud?.overlayProvider ?? 'auto',
        overlayApiKey: data.cloud?.overlayApiKey ?? '',
      },
      composition: {
        ...defaultComposition,
        ...(data.composition ?? {}),
      },
      variation: {
        ...defaultVariation,
        ...(data.variation ?? {}),
      },
      generationMode: data.generationMode ?? 'same_person_same_product',
      keepIdentityLocked: data.keepIdentityLocked ?? true,
      scriptVariationMode: data.scriptVariationMode ?? 'exact',
      scenarioCount: data.scenarioCount ?? 3,
      productImages: data.productImages ?? (data.productImage ? [data.productImage] : []),
      avatarSwapImages: data.avatarSwapImages ?? [],
      handheldProductImage: data.handheldProductImage ?? data.productImage,
      schemaVersion: schemaVersion >= 3 ? schemaVersion : 3,
    } as ProjectState;
  } catch {
    return null;
  }
}

export function loadFromLocalStorage(): ProjectState | null {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return null;
  return parseRaw(raw);
}

export function createProjectExportBlob(data: ProjectState): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export { defaultComposition, defaultVariation };
