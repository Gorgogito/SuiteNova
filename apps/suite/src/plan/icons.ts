import { registerIcon } from '@suitenova/core-ui';
import { ChartColumn, Diamond, Eraser, Filter, Pencil, RefreshCw, Settings, SplitSquareHorizontal, Unlink } from 'lucide-react';
import '../notes/icons';

const icons = { milestone: Diamond, unlink: Unlink, splitH: SplitSquareHorizontal, chart: ChartColumn, edit: Pencil, refresh: RefreshCw, filter: Filter, eraser: Eraser, settings: Settings };
for (const [name, comp] of Object.entries(icons)) registerIcon(name, comp);
