'use strict';
// Repo-native cartoon avatar artwork; PNG output supports native WeChat Image.
const {createRequire}=require('node:module');
const {resolve}=require('node:path');
const {readdir,readFile}=require('node:fs/promises');
const webRequire=createRequire(resolve(__dirname,'../apps/web/package.json'));
const sharp=webRequire('sharp');
(async()=>{const root=resolve(__dirname,'../apps/miniprogram/src/assets/gathering-animals');for(const name of await readdir(root)){if(!name.endsWith('.svg'))continue;await sharp(await readFile(resolve(root,name))).resize(128,128).png({palette:true,compressionLevel:9}).toFile(resolve(root,name.replace('.svg','.png')));}process.stdout.write('Built 12 native cartoon animal avatars\n');})().catch(()=>{process.stderr.write('Animal asset generation failed\n');process.exitCode=1;});
