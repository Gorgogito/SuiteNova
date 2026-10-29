declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): NSpell;
    remove(word: string): NSpell;
    wordCharacters(): string | undefined;
  }
  export default function nspell(aff: string | Uint8Array, dic?: string | Uint8Array): NSpell;
}
