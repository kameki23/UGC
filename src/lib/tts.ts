import { VoiceOptions } from './types';

export interface TTSAdapter {
  speak(text: string, options: VoiceOptions): Promise<void>;
  name: string;
}

export class BrowserSpeechAdapter implements TTSAdapter {
  name = 'browser-speech-synthesis';

  async speak(text: string, options: VoiceOptions): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.prosodyRate;
    utterance.pitch = options.pitch;
    utterance.lang = 'ja-JP';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
}

export class MockCloudTTSAdapter implements TTSAdapter {
  name = 'mock-cloud-tts';

  async speak(text: string, options: VoiceOptions): Promise<void> {
    console.info('Mock TTS request', { text, options });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

export function createTTSAdapter(preferCloud = false): TTSAdapter {
  if (preferCloud) return new MockCloudTTSAdapter();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) return new BrowserSpeechAdapter();
  return new MockCloudTTSAdapter();
}
