import type { Arrow } from './model';

/*
 * What the writing and the reading of .vsdx files share. Nova Diagram leaves notes in the `User` section of the shapes it
 * writes, which Visio keeps when it saves, so that a drawing that comes back is again made of shapes, containers and
 * lanes of Nova. Everything Visio needs is written in Visio's own terms; the notes only add what Visio has no cell for.
 */

export const NOVA = {
  /** Stencil of a shape (absent on free-form shapes). */
  stencil: 'NovaStencil',
  /** A group that stands for one shape of Nova (several colours, a picture, compartments). */
  composite: 'NovaComposite',
  /** What a part of such a group is: `body`, `extra`, `picture` or `text`. */
  part: 'NovaPart',
  /** Routing of a connector. */
  connector: 'NovaConnector',
  /** Arrow heads of a connector (`from,to`): Visio has no filled diamond. */
  arrows: 'NovaArrows',
  /** The text as written in Nova (JSON), when what Visio shows differs from it. */
  text: 'NovaText',
  /** The data of the shape is shown under it. */
  showData: 'NovaShowData',
  /** Properties of a container or pool (JSON). */
  container: 'NovaContainer',
  /** A lane of a pool: its id. */
  lane: 'NovaLane',
  /** Fill of a shape whose drawing is painted with another colour. */
  fill: 'NovaFill',
  /** The line of this sheet is this many times the line of the shape. */
  width: 'NovaWidth',
  fit: 'NovaFit',
  alt: 'NovaAlt',
  /** The picture of a shape as a sheet of its own (files written by earlier versions). */
  imagePart: 'NovaImagePart',
} as const;

/** The number Visio gives each arrow head of Nova (a filled diamond does not exist there: the hollow one is written). */
export const VISIO_ARROW: Record<Arrow, number> = { none: 0, arrow: 4, open: 3, diamond: 22, diamondOpen: 22, oval: 20, bar: 24 };

/** The arrow head of Nova nearest to each of Visio's; the ones not listed are filled arrows. */
export const NOVA_ARROW: Record<number, Arrow> = { 0: 'none', 1: 'open', 3: 'open', 9: 'bar', 10: 'oval', 12: 'open', 20: 'oval', 22: 'diamondOpen', 23: 'bar', 24: 'bar', 41: 'oval', 42: 'oval' };

/** The compartments of a class: the text split at the lines that hold only dashes. */
export const compartments = (text: string): string[] => text.split(/\n-{3,}\n?/);

export const joinCompartments = (parts: string[]): string => {
  const kept = [...parts];
  while (kept.length > 1 && !kept[kept.length - 1]!.trim()) kept.pop();
  return kept.join('\n---\n');
};
