// Is this module the program node was started with? Node resolves import.meta.url through symlinks,
// while argv[1] remains the typed path (Dean X4: a symlinked clone exited silently).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function isMain(metaUrl, argv1 = globalThis.process?.argv?.[1]) {
  if (!argv1) return false;
  const self = fileURLToPath(metaUrl);
  try { return realpathSync(self) === realpathSync(argv1); } catch { return self === argv1; }
}
