import { elevenLabsLanguageCodeMap, speechLangCodeMap } from './language';
import { Language, VoiceOptions } from './types';

export interface TTSAdapter {
  speak(text: string, options: VoiceOptions, language: Language): Promise<void>;
  synthesize?(text: string, options: VoiceOptions, language: Language): Promise<Blob>;
  name: string;
}

export class BrowserSpeechAdapter implements TTSAdapter {
  name = 'browser-speech-synthesis';

  async speak(text: string, options: VoiceOptions, language: Language): Promise<void> {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.prosodyRate;
    utterance.pitch = options.pitch;
    utterance.lang = speechLangCodeMap[language] ?? 'en-US';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }
}

export class ElevenLabsAdapter implements TTSAdapter {
  name = 'elevenlabs';

  constructor(private apiKey: string, private voiceId: string) {}

  async speak(text: string, options: VoiceOptions, language: Language): Promise<void> {
    const audio = await this.synthesize(text, options, language);
    const url = URL.createObjectURL(audio);
    const player = new Audio(url);
    await player.play();
  }

  async synthesize(text: string, options: VoiceOptions, language: Language): Promise<Blob> {
    const normalizedLanguage = elevenLabsLanguageCodeMap[language] ?? 'en';
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'eleven_multilingual_v2',
        text,
        voice_settings: {
          stability: Math.max(0, Math.min(1, 0.3 + options.pauseMs / 1000)),
          similarity_boost: 0.75,
          style: Math.max(0, Math.min(1, options.breathiness / 100)),
          use_speaker_boost: true,
        },
        pronunciation_dictionary_locators: [],
        language_code: normalizedLanguage,
      }),
    });

    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
    }
    return await res.blob();
  }
}

export class MockCloudTTSAdapter implements TTSAdapter {
  name = 'mock-cloud-tts';

  async speak(text: string, options: VoiceOptions, language: Language): Promise<void> {
    console.info('Mock TTS request', { text, options, language });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  async synthesize(): Promise<Blob> {
    return new Blob(['mock audio'], { type: 'audio/mpeg' });
  }
}

export function createTTSAdapter(preferCloud = false): TTSAdapter {
  if (preferCloud) return new MockCloudTTSAdapter();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) return new BrowserSpeechAdapter();
  return new MockCloudTTSAdapter();
}

export function createElevenLabsAdapter(apiKey?: string, voiceId?: string): TTSAdapter {
  if (apiKey && voiceId) return new ElevenLabsAdapter(apiKey, voiceId);
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) return new BrowserSpeechAdapter();
  return new MockCloudTTSAdapter();
}
