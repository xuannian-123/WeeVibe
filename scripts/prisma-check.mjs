import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const operation = process.argv[2];
if (!['generate', 'validate'].includes(operation)) throw new Error('Only offline schema operations are allowed');
// Offline schema syntax/codegen ONLY; this is not runtime configuration or database success.
console.log(`Prisma ${operation}: offline schema check/codegen; does not connect to a database.`);
const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
execFileSync(process.execPath, [cli, operation, '--schema', 'prisma/schema.prisma'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: 'postgresql://offline:EXAMPLE_ONLY@127.0.0.1:1/schema_check' }
});
