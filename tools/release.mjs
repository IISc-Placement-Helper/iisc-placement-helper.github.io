// GitHub REST helpers for the tools: replace a release asset, start a workflow. The token comes from GITHUB_TOKEN or
// the token your git credential helper already holds (no gh CLI needed); the account needs write access.
import { execFileSync, spawnSync } from 'node:child_process';

export function github(root, repoOpt) {
  const repo = repoOpt || execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root }).toString().trim().replace(/^.*github\.com[/:]|\.git$/g, '');
  const token = process.env.GITHUB_TOKEN || (spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' }).stdout.toString().match(/^password=(.+)$/m) || [])[1];
  if (!token) throw new Error('no GitHub token: set GITHUB_TOKEN or sign in to git once');
  // JSON body, undefined for a 404, null for a 204; any other failure throws.
  const api = async (url, init = {}) => {
    const r = await fetch(url.startsWith('http') ? url : `https://api.github.com/repos/${repo}${url}`,
      { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...init.headers } });
    if (!r.ok && r.status !== 404) throw new Error(`${init.method || 'GET'} ${url.replace(/\?.*/, '')}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.status === 404 ? undefined : r.json();
  };
  return {
    repo,
    // The release `tag` (created if missing, never marked latest) ends up holding exactly one asset called `name`.
    async replaceAsset(tag, name, release, bytes, type) {
      const rel = (await api('/releases/tags/' + tag)) || await api('/releases', { method: 'POST',
        body: JSON.stringify({ tag_name: tag, name: release.name, body: release.body, make_latest: 'false' }) });
      for (const a of rel.assets || []) if (a.name === name) await api(`/releases/assets/${a.id}`, { method: 'DELETE' });
      await api(`https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
        { method: 'POST', headers: { 'Content-Type': type }, body: bytes });
    },
    dispatch: workflow => api(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) }),
  };
}
