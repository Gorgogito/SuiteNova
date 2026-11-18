/** Lo que se necesita de `localStorage` (así se prueba sin navegador). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** La clave de siempre: el diccionario personal es uno solo para todos los productos, documentos e idiomas (como CUSTOM.DIC de Office). */
export const USER_DICTIONARY_KEY = 'nova.writer.userDictionary';

export class UserDictionary {
  constructor(
    private store: KeyValueStore | null,
    private key = USER_DICTIONARY_KEY,
  ) {}

  words(): string[] {
    try {
      const raw = this.store?.getItem(this.key);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string') : [];
    } catch {
      return [];
    }
  }

  private save(words: string[]): void {
    try {
      this.store?.setItem(this.key, JSON.stringify(words));
    } catch {
      /* sin almacenamiento: la palabra solo vale en esta sesión */
    }
  }

  has(word: string): boolean {
    const w = word.toLowerCase();
    return this.words().some((x) => x.toLowerCase() === w);
  }

  add(word: string): void {
    if (!this.has(word)) this.save([...this.words(), word]);
  }

  remove(word: string): void {
    this.save(this.words().filter((w) => w !== word));
  }
}
