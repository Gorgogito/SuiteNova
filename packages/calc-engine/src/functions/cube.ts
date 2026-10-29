import { E } from '../values';
import { rawFn } from './registry';

// The CUBE functions read an OLAP cube or the Data Model through a workbook connection. A workbook of this suite never has
// one, so, exactly as Excel does when the connection name is not one of the workbook's, they all give #NAME?.
const CUBE: [string, number, number][] = [
  ['CUBEKPIMEMBER', 3, 4],
  ['CUBEMEMBER', 2, 3],
  ['CUBEMEMBERPROPERTY', 3, 3],
  ['CUBERANKEDMEMBER', 3, 4],
  ['CUBESET', 2, 5],
  ['CUBESETCOUNT', 1, 1],
  ['CUBEVALUE', 1, 255],
];
for (const [name, min, max] of CUBE) rawFn(name, min, max, () => E.NAME);
