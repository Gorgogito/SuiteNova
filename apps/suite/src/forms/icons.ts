import { registerIcon } from '@suitenova/core-ui';
import { ChartColumn, Eye, Pencil } from 'lucide-react';
import '../notes/icons';

const icons = { edit: Pencil, eye: Eye, chart: ChartColumn };
for (const [name, comp] of Object.entries(icons)) registerIcon(name, comp);
