export interface TranslationChunkStats { translated:number; fixed?:number; failed:number; remaining?:number }
/** Small bounded provider batches keep requests below the web proxy timeout. The server selects missing rows. */
export async function translateMissingInChunks(send:()=>Promise<TranslationChunkStats>,onProgress?:(done:number)=>void){
 let translated=0,fixed=0;
 for(let request=0;request<200;request++){
  const stats=await send();
  const added=Number(stats.translated)||0,repaired=Number(stats.fixed)||0;
  translated+=added;fixed+=repaired;onProgress?.(translated+fixed);
  const remaining=Number(stats.remaining)||0;
  if(remaining<=0)return {translated,fixed,failed:Number(stats.failed)||0};
  // Untranslatable values or a failed provider must not form an infinite paid retry loop.
  if(added+repaired===0)return {translated,fixed,failed:Math.max(remaining,Number(stats.failed)||0)};
 }
 throw new Error('Translation chunk safety limit reached; completed batches are preserved.');
}
