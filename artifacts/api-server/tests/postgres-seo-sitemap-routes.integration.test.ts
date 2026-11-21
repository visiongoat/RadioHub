import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { after,before,describe,it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import pg from 'pg';

const connectionString=process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL public sitemap and playback diagnostics',{skip:!connectionString},async()=>{
  if(!connectionString)return;
  const schema=`seo_routes_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin=new pg.Pool({connectionString,ssl:false,max:1});const url=new URL(connectionString);
  url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();process.env.POSTGRES_SSL='disable';
  const {getPostgresPool,closePostgres}=await import('../src/postgres-runtime');const pool=getPostgresPool();
  const seo=await import('../src/data/postgres-seo-indexing-store');
  const debug=await import('../src/data/postgres-station-debug-store');
  const {pgCatalog}=await import('../src/data/postgres-catalog-store');
  let created=false,server:Server|undefined,base='';
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const dir=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of(await readdir(dir)).filter(file=>/^\d+.*\.sql$/.test(file)).sort())await pool.query(await readFile(path.join(dir,file),'utf8'));
    const {registerSeoSitemapRoutes}=await import('../src/routes/seo-sitemap-routes');
    const app=express();app.use(express.json());
    await registerSeoSitemapRoutes(app,{requireAdmin:(req:any,res:any,next:any)=>req.headers['x-offline-admin']==='allowed'?next():res.status(401).json({error:'unauthorized'})});
    server=await new Promise<Server>(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    base=`http://127.0.0.1:${(server.address() as any).port}`;
  });
  after(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
    await closePostgres();try{if(created){assert.match(schema,/^seo_routes_test_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await admin.end();}
  });
  const report=(stationId:string,user=0)=>({stationId,stationName:'Berlin Music',stationUrl:'https://stream.example.invalid/live',errorType:'AUDIO_ERROR',errorMessage:'offline',
    userAgent:`browser-${user}`,clientIP:'127.0.0.1',errorDetails:{occurrenceCount:999},stationMeta:{country:'Germany'}});
  it('serializes first report creation, occurrence increments, and unique reporters across workers',async()=>{
    const stationId=randomUUID();
    const results=await Promise.all(Array.from({length:30},(_,n)=>debug.pgReportStationDebugLog(report(stationId,n%3),{occurrenceCount:999})));
    assert.equal(results.filter(row=>row.created).length,1);assert.equal(new Set(results.map(row=>row.row._id)).size,1);
    const {errors,total}=await debug.pgListStationDebugLogs({stationId});assert.equal(total,1);
    assert.equal(errors[0].totalOccurrences,30);assert.equal(errors[0].uniqueUserCount,3);assert.equal(errors[0].reportingUsers.length,3);
    assert.equal(errors[0].errorDetails.occurrenceCount,30);assert.equal(errors[0].clientIP,'127.0.0.1');
  });
  it('starts a new report after the rolling window and prunes only history older than the cutoff',async()=>{
    const stationId=randomUUID(),old=await debug.pgReportStationDebugLog(report(stationId));
    await pool.query("UPDATE station_debug_logs SET timestamp=now()-interval '4 days' WHERE id=$1",[old.row._id]);
    const fresh=await debug.pgReportStationDebugLog(report(stationId));assert.equal(fresh.created,true);assert.notEqual(fresh.row._id,old.row._id);
    assert.equal((await debug.pgPurgeStationDebugLogs(new Date(Date.now()-3*86400000))).deletedCount,1);
    assert.equal(await debug.pgCountStationDebugLogs({stationId,isResolved:false}),1);
  });
  it('serves the playback report and protected paginated admin contracts using native rows',async()=>{
    const stationId=randomUUID();
    const post=()=>fetch(`${base}/api/stations/report-error`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report(stationId))});
    const first=await post();assert.equal(first.status,200);const firstBody=await first.json() as any;assert.equal(firstBody.success,true);
    const second=await post();const secondBody=await second.json() as any;assert.equal(secondBody.errorId,firstBody.errorId);assert.equal(secondBody.totalOccurrences,2);
    assert.equal((await fetch(`${base}/api/admin/error-logs`)).status,401);
    const response=await fetch(`${base}/api/admin/error-logs?stationId=${stationId}&resolved=false&limit=1`,{headers:{'x-offline-admin':'allowed'}});
    const body=await response.json() as any;assert.equal(response.status,200);assert.equal(body.pagination.total,1);assert.equal(body.errors[0]._id,firstBody.errorId);
  });
  it('accepts legacy mobile USER_REPORT and persists a valid stream-unavailable diagnostic',async()=>{
    const stationId=randomUUID();
    const response=await fetch(`${base}/api/stations/report-error`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...report(stationId),errorType:'USER_REPORT',errorDetails:{userInitiated:true}})});
    assert.equal(response.status,200);assert.equal((await response.json() as any).success,true);
    const {errors}=await debug.pgListStationDebugLogs({stationId});assert.equal(errors.length,1);assert.equal(errors[0].errorType,'STREAM_UNAVAILABLE');assert.equal(errors[0].errorDetails.userInitiated,true);
  });
  it('keeps sitemap XML, conditional requests, mixed public IDs, and gone chunks working without MongoDB',async()=>{
    const {getQualifiedLanguagesState}=await import('../src/seo/qualified-languages');const state=await getQualifiedLanguagesState();assert.ok(state.languages.includes('en'));
    const stationId=randomBytes(12).toString('hex'),genreId='genre-native-pop';
    const [station]=await pgCatalog().insertMany([{_id:stationId,stationuuid:randomUUID(),name:'Berlin & Music',slug:'berlin-music',url:'https://stream.example.invalid/live',
      country:'Germany',countryCode:'DE',language:'German',languageCodes:'de',bitrate:128,lastCheckOk:true,noIndex:false,favicon:'https://themegaradio.com/logos/berlin.webp'}]);
    await pool.query("INSERT INTO genres(id,name,slug,is_discoverable,station_count) VALUES($1,'Pop','pop',true,25)",[genreId]);
    // The index requires a completed snapshot for every qualified language;
    // other locales may legitimately have no eligible pages in this fixture.
    for(const language of state.languages){
      for(const [type,englishIds] of [['main',['/','tc:europe/germany']],['genres',[genreId]],['stations',[stationId]]] as const){
        const ids=language==='en'?englishIds:[];
        const row=await seo.pgWriteBuildingManifest({type,language,version:`offline-${type}-${language}`,qualifiedLanguagesHash:state.hash,qualifiedLanguages:state.languages,
          chunks:ids.length?[{chunk:1,stationIds:ids,urlCount:ids.length,maxUpdatedAt:station.updatedAt}]:[],totalUrls:ids.length});
        await seo.pgActivateManifest(row.id,type,language);
      }
    }
    const index=await fetch(`${base}/sitemap-index.xml`);assert.equal(index.status,200);const indexXml=await index.text();
    assert.match(indexXml,/sitemap-stations-en-1\.xml/);assert.match(indexXml,/sitemap-genres-en\.xml/);
    assert.equal(index.headers.get('last-modified'),null);
    assert.doesNotMatch(indexXml,/<loc>[^<]*sitemap-genres-en\.xml<\/loc>\s*<lastmod>/);
    const stations=await fetch(`${base}/sitemap-stations-en-1.xml`);assert.equal(stations.status,200);assert.match(stations.headers.get('content-type')||'',/xml/);
    const xml=await stations.text();assert.match(xml,/berlin-music/);assert.match(xml,/Berlin &amp; Music/);assert.match(xml,/hreflang="en"/);
    const etag=stations.headers.get('etag');assert.ok(etag);
    assert.equal((await fetch(`${base}/sitemap-stations-en-1.xml`,{headers:{'If-None-Match':etag!}})).status,304);
    assert.equal((await fetch(`${base}/sitemap-stations-en-2.xml`)).status,410);
    const genres=await fetch(`${base}/sitemap-genres-en.xml`);assert.equal(genres.status,200);
    const genreXml=await genres.text();assert.match(genreXml,/pop/);assert.doesNotMatch(genreXml,/<lastmod>/);
    assert.equal(genres.headers.get('last-modified'),null);
    const genreEtag=genres.headers.get('etag');assert.ok(genreEtag);
    await pool.query("UPDATE genres SET station_count=station_count+1,updated_at=now()+interval '1 day' WHERE id=$1",[genreId]);
    assert.equal((await fetch(`${base}/sitemap-genres-en.xml`,{headers:{'If-None-Match':genreEtag!}})).status,304);
    const main=await fetch(`${base}/sitemap-main-en.xml`);assert.equal(main.status,200);assert.match(await main.text(),/germany/);
    const legacyIndex=await fetch(`${base}/sitemap-en.xml`);assert.equal(legacyIndex.status,200);assert.match(await legacyIndex.text(),/sitemap-stations-en-1/);
    const stats=await fetch(`${base}/api/admin/sitemap/manifest-stats`,{headers:{'x-offline-admin':'allowed'}});assert.equal(stats.status,200);
    const body=await stats.json() as any;assert.equal(body.totalActive,state.languages.length*3);assert.equal(body.stationDiag.collectionName,'stations');assert.equal(body.stationDiag.totalDocs,1);
  });
  it('coordinates station lastmod maintenance with the provider sync lock and leaves content unchanged',async()=>{
    const leader=await pool.connect();await leader.query("SELECT pg_advisory_lock(hashtext('radiohub-provider-sync'))");
    try{await assert.rejects(seo.pgTouchSitemapStations(new Date()),error=>(error as any).statusCode===409);}
    finally{await leader.query("SELECT pg_advisory_unlock(hashtext('radiohub-provider-sync'))");leader.release();}
    const before=(await pool.query('SELECT id,name,url,votes FROM stations ORDER BY id')).rows;
    const now=new Date();const touched=await seo.pgTouchSitemapStations(now);assert.equal(touched.matchedCount,1);
    assert.deepEqual((await pool.query('SELECT id,name,url,votes FROM stations ORDER BY id')).rows,before);
    const stored=(await pool.query('SELECT updated_at,source FROM stations')).rows[0];
    assert.ok(stored.updated_at.getTime()>=now.getTime());assert.ok(stored.updated_at.getTime()-now.getTime()<1000);
    assert.equal(stored.source.updatedAt,now.toISOString());
  });
  it('retains stuck/resubmitted/recovered digest boundaries using one consistent SQL rollup',async()=>{
    const {collectStats}=await import('../src/services/scheduled-stuck-resubmit-digest');
    const windowEnd=new Date('2026-06-30T00:00:00Z'),windowStart=new Date('2026-06-23T00:00:00Z'),recoveryStart=new Date('2026-05-31T00:00:00Z'),stuckCutoff=new Date('2026-06-16T00:00:00Z');
    await pool.query(`INSERT INTO gsc_url_inspections(id,url,language,url_group,state,not_indexed_since,last_resubmit_at,last_inspected_at)
      VALUES('digest-a','https://digest.invalid/a','en','station','discovered-not-indexed','2026-06-12T00:00:00Z','2026-06-24T00:00:00Z',NULL),
      ('digest-b','https://digest.invalid/b','en','station','crawled-not-indexed','2026-05-01T00:00:00Z',NULL,NULL),
      ('digest-c','https://digest.invalid/c','en','genre','indexed',NULL,'2026-06-24T00:00:00Z','2026-06-25T00:00:00Z'),
      ('digest-d','https://digest.invalid/d','en','genre','indexed',NULL,'2026-06-24T00:00:00Z','2026-06-24T00:00:00Z'),
      ('digest-e','https://digest.invalid/e','en','country','pending',NULL,'2026-06-30T00:00:00Z',NULL)`);
    const stats=await collectStats({windowEnd,windowStart,recoveryStart,stuckCutoff,stuckDays:14});
    assert.equal(stats.currentlyStuck,2);assert.equal(stats.resubmittedInWindow,3);assert.equal(stats.recoveredAfterResubmit,1);assert.equal(stats.newlyStuckInWindow,1);
    assert.equal(stats.byGroup.length,2);assert.equal(stats.byGroup[0].group,'station');
  });
  it('renders native station data and published custom SEO metadata, not a database-error placeholder',async()=>{
    const {SeoRenderer}=await import('../src/seo-renderer');const renderer=new SeoRenderer();
    const {pgSaveSeoMetadata}=await import('../src/data/postgres-content-store');
    await pgSaveSeoMetadata(null,{pageType:'station_detail',routeKey:'berlin-music',language:'en',title:'Native Radio Title',description:'Native PostgreSQL station description',status:'published'});
    const page=await renderer.renderStaticPage('/en/station/berlin-music','https://themegaradio.com');
    assert.equal(page.pageData?.station?.name,'Berlin & Music');assert.equal(page.pageData?.stationDbError,undefined);
    assert.equal(page.pageData?.notFound,false);assert.equal(page.seoTags.title,'Native Radio Title');
    const unknown=await renderer.renderStaticPage('/en/station/unknown-native-station','https://themegaradio.com');
    assert.equal(unknown.pageData?.notFound,true);
  });
  it('preserves single-hop aliases while refusing to redirect onto a manually excluded station',async()=>{
    const {SeoRenderer}=await import('../src/seo-renderer');const renderer=new SeoRenderer();
    await pgCatalog().update({slug:'berlin-music'},{$set:{slugAliases:['legacy-berlin']}});
    const alias=await renderer.renderStaticPage('/en/station/legacy-berlin','https://themegaradio.com');
    assert.equal(alias.pageData?.redirectTo,'/en/station/berlin-music');
    await pgCatalog().insertMany([{stationuuid:randomUUID(),name:'Pink Noise',slug:'pink-noise',slugAliases:['legacy-noise'],url:'https://stream.example.invalid/noise',noIndex:true,manualEditFields:{noIndex:true}}]);
    const junk=await renderer.renderStaticPage('/en/station/legacy-noise','https://themegaradio.com');
    assert.equal(junk.pageData?.stationIsJunk,true);assert.equal(junk.pageData?.redirectTo,undefined);
  });
  it('keeps native historical positive-health noindex information instead of treating a retained record as removed',async()=>{
    const {SeoRenderer}=await import('../src/seo-renderer');const renderer=new SeoRenderer();
    await pgCatalog().insertMany([{_id:'retained-information',stationuuid:randomUUID(),name:'Retained Radio',slug:'retained-radio',
      url:'https://stream.example.invalid/retained',noIndex:true,lastCheckOk:true,
      descriptions:{en:{full:'Retained original station information',meta:'Retained station summary'}}}]);
    const page=await renderer.renderStaticPage('/en/station/retained-radio','https://themegaradio.com');
    assert.equal(page.pageData?.stationIsJunk,false);assert.equal(page.pageData?.notFound,false);
    assert.equal(page.seoTags.noIndex,true);assert.deepEqual(page.seoTags.hreflangs,[]);
    assert.equal(page.seoTags.canonical,'https://themegaradio.com/en/station/retained-radio');
    assert.equal(page.pageData?.station.descriptions.en.full,'Retained original station information');
    const retained=await pgCatalog().findById('retained-information');
    assert.equal(retained?.noIndex,true);assert.equal(retained?.lastCheckOk,true);
    assert.equal(retained?.manualEditFields?.noIndex,undefined);
  });
  it('loads native slug/alias/country/city existence and uses real tag rankings in llms.txt',async()=>{
    await pgCatalog().update({slug:'berlin-music'},{$set:{tags:'pop, rock',state:'Berlin'}});
    await pgCatalog().insertMany([{stationuuid:randomUUID(),name:'Tirana Music',slug:'tirana-music',url:'https://stream.example.invalid/tirana',country:'Albania',state:'Tirana',tags:'pop',lastCheckOk:true}]);
    const existence=await import('../src/seo/slug-existence');await existence.loadSlugExistence();
    assert.equal(existence.isSlugExistenceReady(),true);assert.equal(existence.hasStationSlug('berlin-music'),true);
    assert.equal(existence.getCanonicalStationSlug('legacy-berlin'),'berlin-music');assert.equal(existence.getCanonicalStationSlug('legacy-noise'),null);
    assert.equal(existence.hasGenreSlug('pop'),true);assert.equal(existence.hasCountrySlug('albania'),true);assert.equal(existence.hasCitySlug('albania','tirana'),true);
    const {buildLlmsTxtBody,clearLlmsTxtCache}=await import('../src/seo/llms-txt-builder');clearLlmsTxtCache();
    let body=await buildLlmsTxtBody('https://example.invalid');
    assert.match(body,/example\.invalid\/sitemap-index\.xml/); // Core guide does not wait for optional PostgreSQL work.
    const deadline=Date.now()+5000;
    while(!body.includes('/en/genres/pop')&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,10));body=await buildLlmsTxtBody('https://example.invalid');
    }
    assert.match(body,/example\.invalid\/en\/genres\/pop/);assert.match(body,/example\.invalid\/en\/regions\/europe\/germany/);

    const {getQualifiedLanguagesState}=await import('../src/seo/qualified-languages');
    const {buildLocalizedUrl}=await import('../src/seo/url-helpers');
    const state=await getQualifiedLanguagesState();
    assert.ok(state.languages.includes('en')&&state.languages.includes('de'));
    const originals=(await pool.query("SELECT id,language,chunks,total_urls,chunk_count FROM sitemap_manifests WHERE type='genres' AND status='active' ORDER BY language")).rows;
    const fixtures=[
      {id:randomUUID(),slug:'classic-hits',count:5},
      {id:randomUUID(),slug:'classic-rock',count:6},
      {id:randomUUID(),slug:'jazz',count:6},
      {id:randomUUID(),slug:'public-radio',count:50},
    ];
    const stationIds=Array.from({length:8},()=>randomUUID());
    try{
      for(const genre of fixtures)await pool.query('INSERT INTO genres(id,name,slug,is_discoverable,station_count) VALUES($1,$2,$2,true,$3)',[genre.id,genre.slug,genre.count]);
      await pgCatalog().insertMany(stationIds.map((id,index)=>({_id:id,stationuuid:randomUUID(),name:`LLMS genre fixture ${index}`,slug:`llms-genre-fixture-${id}`,
        url:'https://stream.example.invalid/llms-genres',tags:'classic-hits, classic-rock, jazz, public-radio',lastCheckOk:true,noIndex:false})));
      for(const manifest of originals){
        const currentIds=manifest.chunks.flatMap((chunk:any)=>chunk.stationIds||[]);
        const additions=manifest.language==='en'?[fixtures[0].id,fixtures[1].id]:manifest.language==='de'?[fixtures[2].id]:[];
        const ids=[...new Set([...currentIds,...additions])];
        const chunks=ids.length?[{chunk:1,stationIds:ids,urlCount:ids.length,maxUpdatedAt:new Date().toISOString()}]:[];
        await pool.query('UPDATE sitemap_manifests SET chunks=$2::jsonb,total_urls=$3,chunk_count=$4 WHERE id=$1',[manifest.id,JSON.stringify(chunks),ids.length,chunks.length]);
      }
      const stored=await seo.pgSeoGenres(fixtures.map(genre=>genre.id));
      assert.deepEqual(new Map(stored.map(genre=>[genre.slug,genre.stationCount])),new Map(fixtures.map(genre=>[genre.slug,genre.count])));
      const raw=await seo.pgTopIndexableTags(100);
      for(const genre of fixtures)assert.ok(raw.some(tag=>tag._id===genre.slug&&tag.count>=8),`${genre.slug} has high measured raw-tag frequency`);
      clearLlmsTxtCache();
      let enriched=await buildLlmsTxtBody('https://example.invalid','en',false);
      const refreshDeadline=Date.now()+5000;
      while(!enriched.includes('/en/genres/classic-rock')&&Date.now()<refreshDeadline){
        await new Promise(resolve=>setTimeout(resolve,10));enriched=await buildLlmsTxtBody('https://example.invalid','en',false);
      }
      assert.match(enriched,/\/en\/genres\/classic-rock/,'authoritative count=6 and an active English manifest qualify');
      for(const locale of state.languages){
        const response=await fetch(`${base}/${locale}/llms.txt`);
        assert.equal(response.status,200);assert.equal(response.headers.get('content-language'),locale);
        const native=await response.text();
        const urls=[...native.matchAll(/\]\((https:\/\/[^\s)]+)\)/g)].map(match=>new URL(match[1]));
        const genrePath=buildLocalizedUrl('/genres',locale,undefined,new Map());
        const hasGenre=(slug:string)=>urls.some(url=>url.pathname===`${genrePath}/${slug}`);
        assert.equal(hasGenre('classic-hits'),false,`${locale}: authoritative count below 6 overrides raw frequency and publication`);
        assert.equal(hasGenre('public-radio'),false,`${locale}: a high-count unpublished genre is not advertised`);
        assert.equal(hasGenre('classic-rock'),locale==='en',`${locale}: English publication is not inherited by other editions`);
        assert.equal(hasGenre('jazz'),locale==='de',`${locale}: German publication is not inherited by other editions`);
        assert.equal(hasGenre('pop'),locale==='en',`${locale}: existing published Pop remains intact`);
      }
    }finally{
      clearLlmsTxtCache();
      for(const manifest of originals)await pool.query('UPDATE sitemap_manifests SET chunks=$2::jsonb,total_urls=$3,chunk_count=$4 WHERE id=$1',[manifest.id,JSON.stringify(manifest.chunks),manifest.total_urls,manifest.chunk_count]);
      await pool.query('DELETE FROM stations WHERE id=ANY($1::text[])',[stationIds]);
      await pool.query('DELETE FROM genres WHERE id=ANY($1::text[])',[fixtures.map(genre=>genre.id)]);
    }
  });
  it('cancels slow SSR catalog queries inside PostgreSQL and restores pooled statement-timeout configuration',async()=>{
    const {pgSeoCatalog}=await import('../src/data/postgres-seo-read-store');const blocker=await pool.connect();
    await blocker.query('BEGIN');await blocker.query('LOCK TABLE stations IN ACCESS EXCLUSIVE MODE');
    const started=Date.now();
    try{await assert.rejects(pgSeoCatalog().findOne({slug:'berlin-music'}),error=>(error as any).code==='57014');}
    finally{await blocker.query('ROLLBACK');blocker.release();}
    assert.ok(Date.now()-started<6500);assert.notEqual((await pool.query('SHOW statement_timeout')).rows[0].statement_timeout,'4s');
    assert.equal((await pgSeoCatalog().findOne({slug:'berlin-music'}))?.name,'Berlin & Music');
  });
  it('native slim sitemap reads preserve all language, quality, image and lastmod inputs without duplicating provider payloads',async()=>{
    const stationId=randomUUID();
    await pgCatalog().insertMany([{_id:stationId,stationuuid:randomUUID(),name:'Projection Radio',slug:'projection-radio',
      url:'https://stream.example.invalid/projection',country:'Turkey',countryCode:'TR',language:'Turkish',languageCodes:'tr,es',
      tags:'pop, news',lastCheckOk:false,lastCheckOkTime:new Date('2026-01-01T00:00:00Z'),lastCheckTime:new Date('2026-01-02T00:00:00Z'),
      descriptions:{de:{full:'Beschreibung '.repeat(20_000),meta:'Kurzbeschreibung'},ja:{full:'詳細',meta:'説明'},fr:{full:'',meta:'Incomplete'}},
      logoAssets:{webp256:'https://cdn.themegaradio.com/projection.webp'},upstreamDiagnosticPayload:'x'.repeat(100_000)}]);
    const full=await pgCatalog().findOne({_id:stationId});
    const [slim]=await seo.pgSitemapStationBatch([stationId,'missing-native-id']);
    assert.ok(full);assert.ok(slim);
    for(const field of ['_id','slug','name','url','homepage','tags','bitrate','country','countryCode','language','languageCodes','noIndex','lastCheckOk','lastCheckTime','updatedAt','logoAssets','favicon']) {
      assert.deepEqual(slim[field]??null,full![field]??null,`projection parity: ${field}`);
    }
    assert.equal(new Date(slim.lastCheckOkTime).toISOString(),new Date(full!.lastCheckOkTime).toISOString());
    assert.equal(slim.source,undefined);assert.equal(slim.upstreamDiagnosticPayload,undefined);
    assert.equal(slim.descriptions,undefined);assert.deepEqual(slim.completeDescriptionLanguages,['de','ja']);
    assert.ok(JSON.stringify(slim).length<JSON.stringify(full).length/100);
    const {getIndexableLanguagesForStation}=await import('../src/seo/junk-station-rules');
    const languages=['en','tr','es','de','ja','fr'];
    assert.deepEqual(getIndexableLanguagesForStation(slim,languages,slim.completeDescriptionLanguages),getIndexableLanguagesForStation(full!,languages));
    await pgCatalog().update({_id:stationId},{$set:{lastCheckOk:true}});
    const [healthySlim]=await seo.pgSitemapStationBatch([stationId]);
    const healthyFull=await pgCatalog().findOne({_id:stationId});
    assert.deepEqual(getIndexableLanguagesForStation(healthySlim,languages,healthySlim.completeDescriptionLanguages),getIndexableLanguagesForStation(healthyFull!,languages));
    assert.ok(getIndexableLanguagesForStation(healthySlim,languages,healthySlim.completeDescriptionLanguages).includes('ja'));
    assert.equal(getIndexableLanguagesForStation(healthySlim,languages,healthySlim.completeDescriptionLanguages).includes('fr'),false);
  });
  it('compact description presence matches JavaScript trim and rejects malformed fields without changing stored prose',async()=>{
    const stationId=randomUUID();
    await pgCatalog().insertMany([{_id:stationId,stationuuid:randomUUID(),name:'Presence Radio',slug:'presence-radio',countryCode:'US',url:'https://stream.example.invalid/live',noIndex:false}]);
    const {getIndexableLanguagesForStation}=await import('../src/seo/junk-station-rules');
    const samples=[null,[], 'Legacy string', {full:123,meta:'Valid'}, {full:{text:'Invalid'},meta:'Valid'},
      {full:'\t\u00a0\u3000\ufeff',meta:'Valid'}, {full:'\u0085',meta:'Valid'}, {full:'Valid',meta:'\r\n'}, {full:' Valid ',meta:' Summary '}];
    for(const sample of samples){
      const descriptions={DE:sample};
      await pool.query('UPDATE stations SET descriptions=$2::jsonb WHERE id=$1',[stationId,JSON.stringify(descriptions)]);
      const full=await pgCatalog().findOne({_id:stationId});const [slim]=await seo.pgSitemapStationBatch([stationId]);
      assert.deepEqual(getIndexableLanguagesForStation(slim,['en','de'],slim.completeDescriptionLanguages),getIndexableLanguagesForStation(full!,['en','de']));
      assert.deepEqual((await pgCatalog().findOne({_id:stationId}))!.descriptions,descriptions);
      assert.equal(slim.descriptions,undefined);
    }
    const untrusted={name:'Source Radio',slug:'source-radio',url:'https://stream.example.invalid/live',countryCode:'US',completeDescriptionLanguages:['de']};
    assert.deepEqual(getIndexableLanguagesForStation(untrusted,['en','de']),['en']);
  });
  it('serves both pinned pilot cohorts from native rows and removes newly excluded identities before conditional304',async()=>{
    const {INDEXING_PILOT}=await import('../src/seo/indexing-pilot');
    await pgCatalog().insertMany(INDEXING_PILOT.map(profile=>({_id:profile.id,stationuuid:randomUUID(),name:profile.slug,slug:profile.slug,
      country:profile.countryCode==='AT'?'Austria':'Turkey',countryCode:profile.countryCode,url:'https://stream.example.invalid/live',
      homepage:profile.homepage,lastCheckOk:true,noIndex:false,isListVisible:true})));
    for(const country of ['at','tr']){
      const response=await fetch(`${base}/sitemap-pilot-en-${country}.xml`);assert.equal(response.status,200);
      const xml=await response.text();assert.equal((xml.match(/<loc>/g)||[]).length,10);assert.doesNotMatch(xml,/<lastmod>/);
      for(const profile of INDEXING_PILOT.filter(profile=>profile.countryCode===country.toUpperCase()))assert.ok(xml.includes(`/en/station/${profile.slug}</loc>`));
      const etag=response.headers.get('etag');assert.ok(etag);
      assert.equal((await fetch(`${base}/sitemap-pilot-en-${country}.xml`,{headers:{'If-None-Match':etag!}})).status,304);
    }
    const before=await fetch(`${base}/sitemap-pilot-en-at.xml`);const etag=before.headers.get('etag');assert.ok(etag);
    await pgCatalog().update({_id:INDEXING_PILOT[0].id},{$set:{isListVisible:false}});
    const hidden=await fetch(`${base}/sitemap-pilot-en-at.xml`,{headers:{'If-None-Match':etag!}});assert.equal(hidden.status,200);
    const hiddenXml=await hidden.text();assert.equal((hiddenXml.match(/<loc>/g)||[]).length,9);assert.ok(!hiddenXml.includes(`/en/station/${INDEXING_PILOT[0].slug}</loc>`));
    await pgCatalog().update({_id:INDEXING_PILOT[1].id},{$set:{noIndex:true}});
    const excluded=await fetch(`${base}/sitemap-pilot-en-at.xml`);assert.equal(excluded.status,200);
    const excludedXml=await excluded.text();assert.equal((excludedXml.match(/<loc>/g)||[]).length,8);assert.ok(!excludedXml.includes(`/en/station/${INDEXING_PILOT[1].slug}</loc>`));
    const index=await fetch(`${base}/sitemap-index.xml`);assert.equal(index.status,200);
    const indexXml=await index.text();assert.match(indexXml,/sitemap-pilot-en-at\.xml/);assert.match(indexXml,/sitemap-pilot-en-tr\.xml/);
  });
});
