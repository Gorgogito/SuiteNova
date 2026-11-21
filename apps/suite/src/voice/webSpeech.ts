// The browser's speech synthesis (the voices Windows has installed, no connection needed) as the engine of the shared reader (`speech-core`).
import type { SpeakHandlers, SpeakOptions, Synth, Voice } from '@suitenova/speech-core';

/** Utterances that are being spoken: the browser can drop an utterance (and its events) when nothing else refers to it. */
const alive = new Set<SpeechSynthesisUtterance>();

export const speechAvailable = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

const voiceOf = (v: SpeechSynthesisVoice): Voice => ({ name: v.name, lang: v.lang, local: v.localService });

export const webSpeech: Synth = {
  voices(): Voice[] {
    return speechAvailable() ? window.speechSynthesis.getVoices().map(voiceOf) : [];
  },

  speak(text: string, o: SpeakOptions, h: SpeakHandlers): void {
    const u = new SpeechSynthesisUtterance(text);
    const v = o.voice ? window.speechSynthesis.getVoices().find((x) => x.name === o.voice!.name) : undefined;
    if (v) u.voice = v;
    u.lang = v?.lang ?? o.lang;
    u.rate = o.rate;
    u.volume = o.volume;
    alive.add(u);
    u.onstart = () => h.onStart?.();
    u.onboundary = (e) => {
      // sentences and words are told apart by some engines; only words are followed
      if (e.name && e.name !== 'word') return;
      h.onWord?.(e.charIndex, e.charLength || undefined);
    };
    u.onend = () => {
      alive.delete(u);
      h.onEnd();
    };
    u.onerror = (e) => {
      alive.delete(u);
      const err = (e as SpeechSynthesisErrorEvent).error;
      h.onError(err || 'error', err === 'canceled' || err === 'interrupted');
    };
    window.speechSynthesis.speak(u);
  },

  cancel(): void {
    if (speechAvailable()) window.speechSynthesis.cancel();
  },

  onVoicesChanged(fn: () => void): () => void {
    if (!speechAvailable()) return () => undefined;
    window.speechSynthesis.addEventListener('voiceschanged', fn);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', fn);
  },
};
