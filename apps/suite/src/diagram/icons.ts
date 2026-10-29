import { registerIcon } from '@suitenova/core-ui';
import {
  AlignHorizontalSpaceAround, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AlignVerticalSpaceAround, ArrowRight, Grid3x3, Lock, LockOpen, Magnet, Maximize2, Minus, MoveHorizontal, MoveVertical,
  FlipHorizontal, FlipVertical, Group, ImageIcon, Layers, LayoutPanelTop, Link2, Network, Rows3, Ungroup,
  MousePointer2, RectangleHorizontal, RectangleVertical, RotateCcw, RotateCw, Shapes, Spline, Type, SquareDashed,
} from 'lucide-react';
import '../notes/icons';

const icons = {
  pointer: MousePointer2, connector: Spline, text: Type, shadow: SquareDashed, line: Minus, arrowRight: ArrowRight, lock: Lock, unlock: LockOpen,
  alignTop: AlignVerticalJustifyStart, alignMiddle: AlignVerticalJustifyCenter, alignBottom: AlignVerticalJustifyEnd,
  distributeH: AlignHorizontalSpaceAround, distributeV: AlignVerticalSpaceAround, matchW: MoveHorizontal, matchH: MoveVertical, matchB: Maximize2,
  flipH: FlipHorizontal, flipV: FlipVertical, image: ImageIcon, link: Link2, layers: Layers, group: Group, ungroup: Ungroup, container: LayoutPanelTop, layout: Network, lanes: Rows3,
  rotateRight: RotateCw, rotateLeft: RotateCcw, shapes: Shapes, grid: Grid3x3, magnet: Magnet, landscape: RectangleHorizontal, portrait: RectangleVertical,
};
for (const [name, comp] of Object.entries(icons)) registerIcon(name, comp);
