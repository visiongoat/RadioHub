import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {optimizeChatPhoto} from '../src/services/chat-photo-processing';
test('chat photo keeps a small oriented copy, strips metadata, removes redundant original',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'mega-chat-photo-'));
 try{
  const input=path.join(directory,'fixture.jpg');
  await sharp({create:{width:2400,height:1800,channels:3,background:'#ee4499'}}).withMetadata({orientation:6}).jpeg({quality:95}).toFile(input);
  const original=(await stat(input)).size,output=await optimizeChatPhoto(input),metadata=await sharp(output).metadata();
  assert.equal(metadata.format,'webp');assert.ok(metadata.width!<=1600&&metadata.height!<=1600);assert.equal(metadata.exif,undefined);assert.equal(metadata.orientation,undefined);
  assert.ok((await stat(output)).size<original);await assert.rejects(stat(input),{code:'ENOENT'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
