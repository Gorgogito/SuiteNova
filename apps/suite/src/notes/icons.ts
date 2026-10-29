import { registerIcon } from '@suitenova/core-ui';
import { ArrowDown, ArrowRight, ArrowUp, Circle, Clock, FilePlus, Folder, History, Lasso, LayoutTemplate, Lock, Merge, Mic, MousePointer2, Pen, ScanText, Share2, Shapes, Sigma, Square, Star, SquareCheck, Video } from 'lucide-react';
import '../writer/icons';

const icons = {
  checkSquare: SquareCheck,
  star: Star,
  clock: Clock,
  pageNew: FilePlus,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  arrowRight: ArrowRight,
  circle: Circle,
  square: Square,
  folder: Folder,
  history: History,
  lasso: Lasso,
  layout: LayoutTemplate,
  lock: Lock,
  merge: Merge,
  mic: Mic,
  video: Video,
  pointer: MousePointer2,
  pen: Pen,
  scanText: ScanText,
  share: Share2,
  shapes: Shapes,
  sigma: Sigma,
};
for (const [name, comp] of Object.entries(icons)) registerIcon(name, comp);
