import { ProjectState } from './types';

const STORAGE_KEY = 'ugc-video-studio-project-v1';

export function saveToLocalStorage(data: ProjectState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadFromLocalStorage(): ProjectState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProjectState;
  } catch {
    return null;
  }
}

export function createProjectExportBlob(data: ProjectState): Blob {
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}
