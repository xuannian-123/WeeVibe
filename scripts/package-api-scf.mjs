import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile, chmod, symlink } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Package only Linux-built, traced runtime files. Windows junctions are not deployable.
assert.equal(process.platform, 'linux', 'SCF artifacts must be packaged on Linux');
const root = fileURLToPath(new URL('../', import.meta.url));
const standalone = resolve(root, 'apps/web/.next/standalone');
const output = resolve(root, '.working');
await mkdir(output, { recursive: true });
const stage = await mkdtemp(resolve(output, 'scf-api-'));
// Project-private roots are forbidden. Dependency directories such as
// caniuse-lite/data are runtime inputs, not the project's private data folder.
const forbidden = path => /^(?:\.working|outputs|\.git|docs|data)(?:\/|$)/.test(path)
  || /^apps\/miniprogram(?:\/|$)/.test(path)
  || path.split('/').some(part => part === '.env' || part.startsWith('.env.')
    || /\.(?:pem|key|p12|pfx|log|sqlite(?:3)?)$/i.test(part));

const links = [];
async function copyRuntime(source, target, boundary, destinationRoot = target) {
  const actual = await realpath(source);
  assert.ok(actual === boundary || actual.startsWith(boundary + sep), 'Runtime link escapes traced artifact');
  const name = relative(stage, target).split(sep).join('/');
  assert.ok(!forbidden(name), `Private/non-runtime path rejected: ${name}`);
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) {
    // Keep Node's realpath-based package resolution intact. Dereferencing a pnpm
    // package alias relocates its JS away from its sibling dependency links.
    const destination = resolve(destinationRoot, relative(boundary, actual));
    assert.ok(destination === destinationRoot || destination.startsWith(destinationRoot + sep), 'Runtime link destination escapes copied artifact');
    await mkdir(dirname(target), { recursive: true });
    await symlink(relative(dirname(target), destination), target);
    links.push({ target, destination });
  } else if (stat.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) await copyRuntime(resolve(source, entry), resolve(target, entry), boundary, destinationRoot);
  } else {
    assert.ok(stat.isFile(), 'Only regular runtime files are allowed');
    await mkdir(dirname(target), { recursive: true });
    await cp(actual, target);
  }
}

await copyRuntime(standalone, stage, await realpath(standalone));
const statics = resolve(root, 'apps/web/.next/static');
await copyRuntime(statics, resolve(stage, 'apps/web/.next/static'), await realpath(statics));
const publicDir = resolve(root, 'apps/web/public');
try {
  await lstat(publicDir);
  await copyRuntime(publicDir, resolve(stage, 'apps/web/public'), await realpath(publicDir));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const { target, destination } of links) {
  assert.equal(await realpath(target), await realpath(destination), 'Copied runtime link must resolve to its packaged target');
}
await lstat(resolve(stage, 'apps/web/server.js'));
const bootstrap = await readFile(resolve(root, 'scripts/scf_bootstrap'), 'utf8');
assert.ok(!bootstrap.includes('\r'), 'scf_bootstrap must have LF line endings');
await writeFile(resolve(stage, 'scf_bootstrap'), bootstrap);
await chmod(resolve(stage, 'scf_bootstrap'), 0o755);
const archive = resolve(output, 'weego-api-scf.zip');
// zip -FS synchronizes an existing archive, so stale entries cannot survive reruns.
execFileSync('zip', ['-q', '-r', '-y', '-FS', archive, '.'], { cwd: stage, stdio: 'inherit' });
const bytes = await readFile(archive);
console.log(JSON.stringify({ archive: relative(root, archive), bytes: bytes.length, symlinks: links.length, sha256: createHash('sha256').update(bytes).digest('hex'), stage: relative(root, stage) }));
