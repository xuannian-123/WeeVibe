import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile, chmod } from 'node:fs/promises';
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
const forbidden = path => path.split('/').some(part =>
  part === '.working' || part === 'outputs' || part === '.git' ||
  part === 'docs' || part === 'data' || part === 'miniprogram' ||
  part === '.env' || part.startsWith('.env.') ||
  /\.(?:pem|key|p12|pfx|log|sqlite(?:3)?)$/i.test(part));

async function copyRuntime(source, target, boundary, ancestors = new Set()) {
  const actual = await realpath(source);
  assert.ok(actual === boundary || actual.startsWith(boundary + sep), 'Runtime link escapes traced artifact');
  const name = relative(stage, target).split(sep).join('/');
  assert.ok(!forbidden(name), `Private/non-runtime path rejected: ${name}`);
  const stat = await lstat(actual);
  if (stat.isDirectory()) {
    assert.ok(!ancestors.has(actual), 'Runtime link cycle rejected');
    await mkdir(target, { recursive: true });
    const next = new Set(ancestors).add(actual);
    for (const entry of await readdir(actual)) await copyRuntime(resolve(actual, entry), resolve(target, entry), boundary, next);
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
await lstat(resolve(stage, 'apps/web/server.js'));
const bootstrap = await readFile(resolve(root, 'scripts/scf_bootstrap'), 'utf8');
assert.ok(!bootstrap.includes('\r'), 'scf_bootstrap must have LF line endings');
await writeFile(resolve(stage, 'scf_bootstrap'), bootstrap);
await chmod(resolve(stage, 'scf_bootstrap'), 0o755);
const archive = resolve(output, 'weego-api-scf.zip');
// zip -FS synchronizes an existing archive, so stale entries cannot survive reruns.
execFileSync('zip', ['-q', '-r', '-FS', archive, '.'], { cwd: stage, stdio: 'inherit' });
const bytes = await readFile(archive);
console.log(JSON.stringify({ archive: relative(root, archive), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), stage: relative(root, stage) }));
