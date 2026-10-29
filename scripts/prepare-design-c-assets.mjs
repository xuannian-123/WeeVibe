import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const sharp = require('sharp');
const root = new URL('../apps/miniprogram/src/assets/design-c-faithful/', import.meta.url);
const paths = JSON.parse(await readFile(new URL('icons-source.json', root), 'utf8'));
await mkdir(new URL('icons/', root), { recursive: true });
for (const [name, d] of Object.entries(paths)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="${name === 'heartSaved' ? '#ffb2c2' : 'none'}" stroke="${name === 'heartSaved' ? '#c54b77' : '#222222'}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL(`icons/${name}.png`, root)));
}
const imports = Object.keys(paths).map(name => `import ${name} from '../../assets/design-c-faithful/icons/${name}.png';`).join('\n');
await writeFile(new URL('../apps/miniprogram/src/features/design-c/icons.ts', import.meta.url), `${imports}\nexport const cIcons = {${Object.keys(paths).join(',')}} as const;\nexport type CIconName = keyof typeof cIcons;\n`);
const faces = [];
for (const weight of [600, 700, 800]) {
  const font = await readFile(new URL(`jakarta-${weight}.ttf`, root));
  faces.push(`@font-face{font-family:WeeJakarta;src:url(data:font/ttf;base64,${font.toString('base64')}) format("truetype");font-weight:${weight};font-style:normal;font-display:swap}`);
}
await writeFile(new URL('../apps/miniprogram/src/features/design-c/fonts.css', import.meta.url), faces.join('\n') + '\n');
console.log(`Prepared ${Object.keys(paths).length} reference icons and three original font weights.`);
