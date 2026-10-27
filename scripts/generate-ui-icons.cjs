// Original outline drawings. Regenerate bundled raster assets with the existing sharp dependency.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const sharp=createRequire(path.resolve(__dirname,'../apps/web/package.json'))('sharp');
const drawings={
 go:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
 spark:'<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z"/>',
 inbox:'<path d="M5 4h14l3 11v5H2v-5Z M2 15h6l2 3h4l2-3h6"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 friends:'<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3 M16 4a3 3 0 0 1 0 6 M19 13a6 6 0 0 1 3 5v3"/>',
 team:'<circle cx="12" cy="6" r="3"/><path d="M6 21v-4a6 6 0 0 1 12 0v4 M5 6a3 3 0 0 0 0 6 M19 6a3 3 0 0 1 0 6 M2 21v-4a5 5 0 0 1 2-4 M22 21v-4a5 5 0 0 0-2-4"/>',
 location:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 down:'<path d="m6 9 6 6 6-6"/>', right:'<path d="m9 5 7 7-7 7"/>',
 arrow:'<path d="M5 19 19 5 M5 5h14v14"/>', plus:'<path d="M12 4v16 M4 12h16"/>',
 heart:'<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>',
 settings:'<path d="m10 2 4 0 1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1Z"/><circle cx="12" cy="12" r="3"/>',
 close:'<path d="m6 6 12 12 M18 6 6 18"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 refresh:'<path d="M20 8a8.5 8.5 0 0 0-14-4L2 8 M2 2v6h6 M4 16a8.5 8.5 0 0 0 14 4l4-4 M22 22v-6h-6"/>',
 search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>'
};
(async()=>{const folder=path.resolve(__dirname,'../apps/miniprogram/src/assets/ui');fs.mkdirSync(folder,{recursive:true});
 for(const [name,body] of Object.entries(drawings)){for(const white of name==='plus'||name==='arrow'?[false,true]:[false]){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${white?'#ffffff':'#34463e'}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;await sharp(Buffer.from(svg)).png({palette:true,compressionLevel:9}).toFile(path.join(folder,name+(white?'-white':'')+'.png'));}}
 console.log('UI icon assets generated.');
})().catch(()=>{process.exitCode=1});
