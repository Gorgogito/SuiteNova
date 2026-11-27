/**
 * The version of SuiteNova that every window shows. It is read from package.json, so that it is only written there and
 * in the two files of the desktop app (a test checks that the three agree).
 */
import { version } from '../package.json';

export const VERSION: string = version;
