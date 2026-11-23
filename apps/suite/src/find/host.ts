import type { Compiled, FindMode } from '@suitenova/find-core';

/** What a product tells the common search panel about itself. */
export interface FindFeatures {
  /** Which ways of reading the text are offered (the first is the default). */
  modes: FindMode[];
  /** The product can change what it finds (a read-only view cannot). */
  replace: boolean;
  /** «Match entire cell contents» (Excel). */
  wholeUnit?: boolean;
  /** The special characters of Word (`^p`…) make sense in this product. */
  special?: boolean;
  /** Filters on the formatting of what is found (Word's «Format»): bold, a style… */
  filters?: FindFilterDef[];
  /** The kinds of place «Go to» can reach. */
  goTo?: GoToKind[];
}

export interface FindFilterDef {
  id: string;
  label: string;
  kind: 'bool' | 'select';
  options?: { value: string; label: string }[];
}

export type FindFilters = Record<string, string | boolean>;

export interface GoToKind {
  id: string;
  label: string;
  /** Hint for what to type (`+3` goes three further…). */
  hint?: string;
  /** When the places are a list (bookmarks, comments), this returns it. */
  options?: () => { value: string; label: string }[];
}

/** The result of a search: how many were found and which is the current one (0-based, -1 when none). */
export interface FindStatus {
  count: number;
  current: number;
}

export interface FindRequest {
  /** What the person typed. */
  text: string;
  query: Compiled;
  filters: FindFilters;
}

/** A product's side of search and replace: it finds in its own model, shows the matches and changes them with its own undo. */
export interface FindHost {
  features: FindFeatures;
  /** The selected text, to start a search with it (empty when there is none). */
  selectionText(): string;
  /** Finds all, shows them and goes to the first one from the cursor. */
  find(req: FindRequest): FindStatus;
  /** The next (1) or previous (-1) match, going round. */
  step(dir: 1 | -1): FindStatus;
  /** Replaces the current match (`template` as `expandReplacement` reads it) and goes to the next one. */
  replaceCurrent(req: FindRequest, template: string): FindStatus;
  /** Replaces every match; returns how many. */
  replaceAll(req: FindRequest, template: string): number;
  /** Every match as a list to choose from (Excel's «Find All»); a product without it does not offer the button. */
  list?(req: FindRequest): { label: string; detail: string; go(): void }[];
  /** Takes the shown matches away. */
  clear(): void;
  /** Goes to a place; returns an error text, or null when it went. */
  goTo?(kind: string, value: string): string | null;
}
