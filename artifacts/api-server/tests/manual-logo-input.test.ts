import {test} from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import {prepareManualLogo} from '../src/services/manual-logo-input';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8" viewBox="0 0 16 8"><path fill="#ff4199" d="M0 0h8v8H0z"/></svg>';
test('manual SVG and XML SVG become high resolution transparent PNGs',async()=>{
 for(const source of [svg,'<?xml version="1.0"?>\n'+svg]){
  const png=await prepareManualLogo(Buffer.from(source));const meta=await sharp(png).metadata();
  assert.equal(meta.format,'png');assert.equal(meta.width,1024);assert.equal(meta.height,512);assert.equal(meta.hasAlpha,true);
  const {data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true});assert.equal(data[(info.width-1)*info.channels+3],0);
 }
});
test('manual raster images keep their original bytes',async()=>{const png=await sharp({create:{width:4,height:4,channels:4,background:'#FF4199'}}).png().toBuffer();assert.equal(await prepareManualLogo(png),png);});
test('SVG active and external resources are rejected before rendering or publishing',async()=>{
 for(const bad of ['<script>alert(1)</script>','<image href="file:///etc/passwd"/>','<image href="https://example.invalid/a.png"/>','<path onload="alert(1)"/>','<style>@import "https://example.invalid/a.css";</style>','<path fill="url(https://example.invalid/a.svg)"/>'])await assert.rejects(()=>prepareManualLogo(Buffer.from(svg.replace('</svg>',bad+'</svg>'))));
 await assert.rejects(()=>prepareManualLogo(Buffer.alloc(5*1024*1024+1)));
});
