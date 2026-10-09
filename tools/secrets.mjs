// Local secret files (.batch-key, .status-key, .code-secret): created once, owner-only, never overwritten.
// New files are written with mode 0600 and flag 'wx' (exclusive create: an existing file is never clobbered, and a
// file that appears meanwhile makes the write fail instead of being replaced). On POSIX an existing file that group
// or others can read gets a warning. Windows ignores these modes: keep the repository in a private folder on your
// own account, not in a shared or shared-synced folder.
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';

export function secretFile(path, make, created) {
  if (!existsSync(path)) {
    writeFileSync(path, make() + '\n', { mode: 0o600, flag: 'wx' });
    if (created) console.log(created);
  } else if (process.platform !== 'win32' && statSync(path).mode & 0o077) {
    console.warn(`warning: ${path} can be read by other users of this machine; run: chmod 600 "${path}"`);
  }
  return readFileSync(path, 'utf8').trim();
}
