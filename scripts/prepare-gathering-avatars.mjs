import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const sharp=require('sharp');
const source=process.argv[2];
if(!source)throw Error('Pass a directory containing the 21 original PNGs. Originals are read only.');
const animals={rabbit:'兔子',hedgehog:'刺猬',elephant:'大象',squirrel:'松鼠',panda:'熊猫',ox:'牛',fox:'狐狸',dog:'狗',lion:'狮子',wolf:'狼',pig:'猪',cat:'猫',monkey:'猴子',sheep:'羊',tiger:'老虎',crab:'螃蟹',giraffe:'长颈鹿',horse:'马',rooster:'鸡',duck:'鸭',deer:'鹿'};
const destination=new URL('../apps/miniprogram/src/assets/activity-avatars/',import.meta.url);
await mkdir(destination,{recursive:true});
const images=[];
for(const [key,name] of Object.entries(animals)){
  const original=await readFile(resolve(source,`${name}.png`));
  const compressed=await sharp(original).resize(160,160,{fit:'cover'}).jpeg({quality:85,mozjpeg:true}).toBuffer();
  await writeFile(new URL(`${key}.jpg`,destination),compressed);
  images.push({key,file:`${key}.jpg`,width:160,height:160,bytes:compressed.length,original_sha256:createHash('sha256').update(original).digest('hex')});
}
await writeFile(new URL('manifest.json',destination),JSON.stringify({source:'用户提供的头像图片.zip；保留原图，本地缩小压缩；不同底色由界面绘制，不复制504份图片',images},null,2)+'\n');
console.log(JSON.stringify({images:images.length,bytes:images.reduce((sum,row)=>sum+row.bytes,0)}));
