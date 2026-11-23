// Версия пакета = версия протокола, который он ставит в доску.

import { ownPackage } from './paths.js';

/** Версия пакета = версия протокола, который он ставит в доску. */
export const VERSION: string = (() => {
  const version = ownPackage()?.json.version;
  return typeof version === 'string' ? version : '0.0.0';
})();
