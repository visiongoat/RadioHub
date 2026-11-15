import sharp from 'sharp';
/** Manual SVG uploads are rasterized before storage; no executable SVG is published. */
export async function prepareManualLogo(buffer:Buffer):Promise<Buffer>{
 if(buffer.length>5*1024*1024)throw Error('Logo must be smaller than 5MB');
 const text=buffer.toString('utf8');
 const svg=/^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(text);
 if(!svg)return buffer;
 if(/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|@import|\\[0-9a-f]/i.test(text))throw Error('SVG contains unsupported active content');
 for(const match of text.matchAll(/\b(?:href|src)\s*=\s*(['"])([\s\S]*?)\1/gi))if(!match[2].trim().startsWith('#'))throw Error('SVG external resources are not supported');
 for(const match of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi))if(!match[2].trim().startsWith('#'))throw Error('SVG external resources are not supported');
 const metadata=await sharp(buffer,{limitInputPixels:16_000_000}).metadata();
 if(metadata.format!=='svg')throw Error('Invalid SVG image');
 const density=Math.max(1,Math.min(100000,Math.round(72*1024/Math.max(metadata.width||1,metadata.height||1))));
 return sharp(buffer,{density,limitInputPixels:16_000_000}).resize(1024,1024,{fit:'inside'}).png().timeout({seconds:5}).toBuffer();
}
