import { Language } from './types';

export const languageLabels: Record<Language, string> = {
  ja: '日本語',
  en: 'English',
  ko: '한국어',
  zh: '中文',
  fr: 'Français',
  it: 'Italiano',
};

export const speechLangCodeMap: Record<Language, string> = {
  ja: 'ja-JP',
  en: 'en-US',
  ko: 'ko-KR',
  zh: 'zh-CN',
  fr: 'fr-FR',
  it: 'it-IT',
};

export const elevenLabsLanguageCodeMap: Record<Language, string> = {
  ja: 'ja',
  en: 'en',
  ko: 'ko',
  zh: 'zh',
  fr: 'fr',
  it: 'it',
};

export const syncLanguageCodeMap: Record<Language, string> = {
  ja: 'ja',
  en: 'en',
  ko: 'ko',
  zh: 'zh',
  fr: 'fr',
  it: 'it',
};

export interface LanguageSuggestion {
  language: Language;
  confidence: number;
  reason: string;
}

const frHints = [' le ', ' la ', ' les ', ' des ', ' pour ', ' avec ', ' est ', 'bonjour', 'merci', 'très', 'cette'];
const itHints = [' il ', ' lo ', ' gli ', ' per ', ' con ', ' questo ', ' questa ', 'grazie', 'ciao', 'molto', 'oggi'];

export function detectLanguageFromScript(script: string): LanguageSuggestion {
  const text = script.trim();
  if (!text) return { language: 'ja', confidence: 0, reason: '台本が空です' };

  const lowered = ` ${text.toLowerCase()} `;

  const counts = {
    ja: (text.match(/[\u3040-\u30ff]/g) ?? []).length,
    ko: (text.match(/[\uac00-\ud7af]/g) ?? []).length,
    zh: (text.match(/[\u4e00-\u9fff]/g) ?? []).length,
    latin: (text.match(/[a-zàâçéèêëîïôûùüÿñæœ]/gi) ?? []).length,
    fr: frHints.reduce((acc, w) => acc + (lowered.includes(w) ? 1 : 0), 0),
    it: itHints.reduce((acc, w) => acc + (lowered.includes(w) ? 1 : 0), 0),
  };

  if (counts.ko > 3) return { language: 'ko', confidence: 0.95, reason: 'ハングル文字を検出' };
  if (counts.ja > 3) return { language: 'ja', confidence: 0.95, reason: 'ひらがな/カタカナを検出' };

  if (counts.zh > 3) {
    if (counts.ja > 0) return { language: 'ja', confidence: 0.75, reason: '漢字+かなの混在を検出' };
    return { language: 'zh', confidence: 0.85, reason: '漢字中心の文章を検出' };
  }

  if (counts.latin > 0) {
    if (counts.fr > counts.it && counts.fr >= 2) return { language: 'fr', confidence: 0.82, reason: 'フランス語の語彙パターンを検出' };
    if (counts.it > counts.fr && counts.it >= 2) return { language: 'it', confidence: 0.82, reason: 'イタリア語の語彙パターンを検出' };
    if (counts.fr === counts.it && counts.fr >= 2) return { language: 'en', confidence: 0.55, reason: 'ラテン文字だが言語判定が拮抗' };
    return { language: 'en', confidence: 0.72, reason: 'ラテン文字中心の文章を検出' };
  }

  return { language: 'en', confidence: 0.4, reason: '判定材料が少ないため英語を暫定提案' };
}
