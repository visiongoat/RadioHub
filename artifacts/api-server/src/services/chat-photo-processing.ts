import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
let working=0;
const waiting:(()=>void)[]=[];
async function acquire(){if(working<2){working++;return;}if(waiting.length>=6)throw Object.assign(Error('Photo processing busy'),{status:503});await new Promise<void>(resolve=>waiting.push(resolve));}
function release(){const next=waiting.shift();if(next)next();else working--;}
/** One bounded photo per message, no redundant original and no embedded location/EXIF. */
export async function optimizeChatPhoto(original:string):Promise<string>{
 await acquire();
 const target=original.replace(/\.[^.\/]+$/,'')+'.webp';
 try{
  const image=sharp(original,{limitInputPixels:24_000_000});
  const metadata=await image.metadata();
  // Animated uploads are already bounded to 5MB; never silently flatten them.
  if((metadata.pages||1)>1)return original;
  const bytes=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:80,effort:3}).timeout({seconds:5}).toBuffer();
  await fs.writeFile(target+'.tmp',bytes,{flag:'wx'});
  await fs.rename(target+'.tmp',target);
  if(path.resolve(original)!==path.resolve(target))await fs.unlink(original);
  return target;
 }finally{release();await fs.unlink(target+'.tmp').catch(()=>{});}
}
