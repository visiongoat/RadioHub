import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';

const connectionString=process.env.PG_TEST_DATABASE_URL;
describe('PostgreSQL TV and cast state',{skip:!connectionString},async()=>{
  if(!connectionString)return;
  const schema=`tv_cast_test_${process.pid}_${randomBytes(6).toString('hex')}`;
  const admin=new pg.Pool({connectionString,ssl:false,max:1});
  const url=new URL(connectionString);url.searchParams.set('options',`-c search_path=${schema},public`);
  process.env.DATABASE_URL=url.toString();process.env.POSTGRES_SSL='disable';process.env.USER_STORE='postgres';process.env.AUTH_STORE='postgres';
  const {getPostgresPool,closePostgres}=await import('../src/postgres-runtime');
  const tv=await import('../src/data/postgres-tv-store');
  const cast=await import('../src/data/postgres-cast-store');
  const pool=getPostgresPool();
  let created=false;
  before(async()=>{
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const directory=path.resolve(import.meta.dirname,'../../../lib/db/migrations');
    for(const file of (await readdir(directory)).filter(file=>/^\d+.*\.sql$/.test(file)).sort())await pool.query(await readFile(path.join(directory,file),'utf8'));
  });
  after(async()=>{
    await closePostgres();
    try{if(created){assert.match(schema,/^tv_cast_test_\d+_[a-f0-9]{12}$/);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}}finally{await admin.end();}
  });
  async function user(){const id=`tv-user-${randomUUID()}`;await pool.query("INSERT INTO users(id,username,email,full_name) VALUES($1,$1,$2,'TV integration')",[id,`${id}@example.invalid`]);return id;}
  async function pairedDevice(userId:string){const deviceId=randomUUID();const code=await tv.createTvCode('login',deviceId,'tizen');await tv.activateTvLogin(code.code,userId);return deviceId;}

  it('queues relative volume only for the account owning the TV, with one-time delivery',async()=>{
    const owner=await user(),other=await user(),device=await pairedDevice(owner);
    assert.equal(await tv.enqueueCastCommand(other,device,'cast:volume',null,{volumeDelta:.125}),false);
    assert.equal(await tv.enqueueCastCommand(owner,device,'cast:volume',null,{volumeDelta:.125}),true);
    assert.equal(await tv.pollCastCommand(other,device),null);
    const command=await tv.pollCastCommand(owner,device);
    assert.equal(command.type,'cast:volume');assert.equal(command.payload.volumeDelta,.125);
    assert.equal(command.station,null);assert.equal(await tv.pollCastCommand(owner,device),null);
  });
  async function pairExistingDevice(userId:string,deviceId:string){
    const code=await tv.createTvCode('login',deviceId,'tizen');
    return tv.activateTvLogin(code.code,userId);
  }
  it('delivers a paired phone to another signed-in profile without replacing either account',async()=>{
    const phone=await user(),receiver=await user(),stranger=await user(),device=await pairedDevice(phone);
    const login=await pairExistingDevice(receiver,device);
    const tokensBefore=(await pool.query('SELECT token,user_id FROM auth_tokens WHERE user_id=ANY($1) ORDER BY token',[[phone,receiver]])).rows;
    assert.equal(await tv.enqueueCastCommand(phone,device,'cast:play',{name:'Shared radio'}),true);
    assert.equal(await tv.pollCastCommand(stranger,device),null);
    assert.equal((await tv.pollCastCommand(receiver,device)).station.name,'Shared radio');
    assert.equal(await tv.pollCastCommand(phone,device),null);
    assert.equal((await tv.getTvCode('login',login.code,device)).userId,receiver);
    assert.deepEqual((await pool.query('SELECT token,user_id FROM auth_tokens WHERE user_id=ANY($1) ORDER BY token',[[phone,receiver]])).rows,tokensBefore);
    await tv.saveCastNowPlaying(receiver,{deviceId:device,stationName:'Shared radio',isPlaying:true});
    const status=await tv.getCastNowPlaying(phone,device);
    assert.equal(status.stationName,'Shared radio');assert.equal(status.isPlaying,true);
    assert.equal(status.userId,undefined);assert.equal(await tv.getCastNowPlaying(stranger,device),null);
    await tv.saveCastNowPlaying(stranger,{deviceId:device,stationName:'Spoofed',isPlaying:true});
    assert.equal((await tv.getCastNowPlaying(phone,device)).stationName,'Shared radio');
  });
  it('shares physical receiver presence and latest playback only among paired accounts',async()=>{
    const first=await user(),second=await user(),device=await pairedDevice(first);
    await pairExistingDevice(second,device);
    await pool.query("UPDATE user_devices SET last_seen_at=now()-interval '1 day' WHERE user_id=$1",[first]);
    await tv.touchTvDevice(second,device);
    assert.ok(Date.now()-new Date((await tv.listTvDevices(first))[0].lastSeenAt).getTime()<5000);
    await tv.saveCastNowPlaying(first,{deviceId:device,stationName:'Previous'});
    await pool.query("UPDATE cast_now_playing SET updated_at=now()-interval '1 day' WHERE user_id=$1",[first]);
    await tv.saveCastNowPlaying(second,{deviceId:device,stationName:'Current',isPlaying:true});
    assert.equal((await tv.getCastNowPlaying(first,device)).stationName,'Current');
    await tv.unpairTvDevice(first,device);
    assert.equal(await tv.getCastNowPlaying(first,device),null);
    assert.equal((await tv.listTvDevices(first)).length,0);
    assert.equal((await tv.getCastNowPlaying(second,device)).stationName,'Current');
  });
  it('keeps one device-wide latest selection and delivers controls once across paired pollers',async()=>{
    const first=await user(),second=await user(),device=await pairedDevice(first);
    await pairExistingDevice(second,device);
    await tv.enqueueCastCommand(first,device,'cast:play',{name:'Old'});
    await tv.enqueueCastCommand(first,device,'cast:pause',null);
    await tv.enqueueCastCommand(second,device,'cast:play',{name:'Newest'});
    await tv.enqueueCastCommand(first,device,'cast:resume',null);
    const commands=(await Promise.all(Array.from({length:10},(_,i)=>tv.pollCastCommand(i%2?first:second,device)))).filter(Boolean);
    assert.equal(commands.length,2);assert.equal(new Set(commands.map(c=>c.id)).size,2);
    assert.equal(commands.find(c=>c.type==='cast:play').station.name,'Newest');
    assert.ok(commands.some(c=>c.type==='cast:resume'));
  });
  it('revokes a sender without blocking the remaining paired receiver',async()=>{
    const first=await user(),second=await user(),device=await pairedDevice(first);
    await pairExistingDevice(second,device);
    await tv.enqueueCastCommand(first,device,'cast:play',{name:'Revoked'});
    await tv.unpairTvDevice(first,device);
    assert.equal(await tv.pollCastCommand(second,device),null);
    assert.equal(await tv.enqueueCastCommand(first,device,'cast:play',{name:'Denied'}),false);
    await tv.enqueueCastCommand(second,device,'cast:play',{name:'Allowed'});
    assert.equal(await tv.pollCastCommand(first,device),null);
    assert.equal((await tv.pollCastCommand(second,device)).station.name,'Allowed');
  });
  it('replaces pending station history with the latest selection and keeps subsequent controls',async()=>{
    const owner=await user(),device=await pairedDevice(owner),otherDevice=await pairedDevice(owner);
    await tv.enqueueCastCommand(owner,otherDevice,'cast:play',{name:'Other TV'});
    for(const name of ['Old A','Old B','Kıyı Caz']) {
      await tv.enqueueCastCommand(owner,device,'cast:play',{name});
      if(name==='Old A')await tv.enqueueCastCommand(owner,device,'cast:pause',null);
    }
    await tv.enqueueCastCommand(owner,device,'cast:pause',null);
    assert.equal((await tv.pollCastCommand(owner,device)).station.name,'Kıyı Caz');
    assert.equal((await tv.pollCastCommand(owner,device)).type,'cast:pause');
    assert.equal(await tv.pollCastCommand(owner,device),null);
    assert.equal((await tv.pollCastCommand(owner,otherDevice)).station.name,'Other TV');
  });
  it('compacts legacy queues before delivering a station and expires abandoned requests',async()=>{
    const owner=await user(),device=await pairedDevice(owner);
    for(let index=0;index<3;index++)await pool.query(`INSERT INTO cast_commands(id,user_id,device_id,type,station,timestamp)
      VALUES($1,$2,$3,'cast:play',$4,$5)`,[randomUUID(),owner,device,JSON.stringify({name:`Station ${index}`}),Date.now()+index]);
    assert.equal((await tv.pollCastCommand(owner,device)).station.name,'Station 2');
    assert.equal(await tv.pollCastCommand(owner,device),null);
    await tv.enqueueCastCommand(owner,device,'cast:play',{name:'Expired'});
    await pool.query("UPDATE cast_commands SET created_at=now()-interval '3 minutes' WHERE user_id=$1",[owner]);
    assert.equal(await tv.pollCastCommand(owner,device),null);
  });
  it('serializes code generation per device, enforcing five subscription requests/hour',async()=>{
    const device=randomUUID();const codes=await Promise.all(Array.from({length:10},()=>tv.createTvCode('login',device,'tizen')));
    assert.equal(new Set(codes.map(code=>code.code)).size,10);
    assert.equal((await pool.query("SELECT count(*)::int count FROM tv_device_codes WHERE device_id=$1 AND status='pending'",[device])).rows[0].count,1);
    const limited=await Promise.allSettled(Array.from({length:9},()=>tv.createTvCode('subscription',device,'tizen')));
    assert.equal(limited.filter(result=>result.status==='fulfilled').length,5);
    assert.equal(limited.filter(result=>result.status==='rejected'&&(result.reason as any).statusCode===429).length,4);
  });
  it('activates once under competing owners and mints only one token',async()=>{
    const owners=await Promise.all([user(),user()]);const device=randomUUID();const code=await tv.createTvCode('login',device,'webos');
    const results=await Promise.all(Array.from({length:12},(_,index)=>tv.activateTvLogin(code.code,owners[index%2])));
    const successes=results.filter(Boolean);assert.ok(successes.length);assert.equal(new Set(successes.map(row=>row.userId)).size,1);
    assert.equal(new Set(successes.map(row=>row.token)).size,1);
    assert.equal((await pool.query('SELECT count(*)::int count FROM auth_tokens WHERE user_id=ANY($1)',[owners])).rows[0].count,1);
    assert.equal((await tv.listTvDevices(successes[0].userId)).length,1);
    assert.equal(await tv.getTvCode('login',code.code,'different-device'),null);
  });
  it('enforces expiry before cleanup for login, subscription activation and token polling',async()=>{
    const owner=await user(),device=randomUUID();const login=await tv.createTvCode('login',device,'other');const subscription=await tv.createTvCode('subscription',device,'other');
    await pool.query("UPDATE tv_device_codes SET expires_at=now()-interval '1 second' WHERE id=ANY($1)",[[login.id,subscription.id]]);
    assert.equal(await tv.activateTvLogin(login.code,owner),null);assert.equal((await tv.getTvCode('login',login.code,device)).status,'expired');
    await tv.completeTvSubscription(subscription.code,owner,'premium_yearly','expired-checkout');
    assert.equal(await tv.tvSubscriptionToken(subscription.id,device),undefined);
  });
  it('preserves first subscription completion and reuses a single TV token on concurrent polls',async()=>{
    const [first,second]=await Promise.all([user(),user()]);const device=randomUUID();const code=await tv.createTvCode('subscription',device,'tizen');
    await tv.completeTvSubscription(code.code,first,'premium_lifetime','checkout-1');await tv.completeTvSubscription(code.code,second,'premium_monthly','checkout-2');
    const tokens=await Promise.all(Array.from({length:15},()=>tv.tvSubscriptionToken(code.id,device)));
    assert.equal(new Set(tokens).size,1);assert.ok(tokens[0]?.startsWith('mrt_tv_'));assert.equal((await tv.getTvCode('subscription',code.code)).userId,first);
    assert.equal((await pool.query('SELECT count(*)::int count FROM auth_tokens WHERE user_id=$1',[first])).rows[0].count,1);
    assert.equal(await tv.tvSubscriptionToken(code.id,'wrong-device'),undefined);
  });
  it('has exactly one pairing winner and enforces session ownership and expiry',async()=>{
    const owner=await user(),other=await user();const session=await cast.createCastSession(owner,'mobile');
    const pairs=await Promise.all(Array.from({length:15},(_,index)=>cast.pairCastSession(session.pairingCode,`device-${index}`)));
    assert.equal(pairs.filter(Boolean).length,1);assert.equal(await cast.getCastSession(session.sessionId,other),null);
    assert.equal(await cast.applyCastCommand(session.sessionId,other,'pause',{}),null);
    assert.ok(await cast.applyCastCommand(session.sessionId,owner,'resume',{}));
    await pool.query("UPDATE cast_sessions SET expires_at=now()-interval '1 second' WHERE session_id=$1",[session.sessionId]);
    assert.equal(await cast.applyCastCommand(session.sessionId,owner,'resume',{}),null);
  });
  it('does not activate a reissued PIN from a replayed old checkout',async()=>{
    const owner=await user(),device=randomUUID(),code=await tv.createTvCode('subscription',device,'tizen');
    await tv.completeTvSubscription(code.code,owner,'premium_yearly','old-checkout','different-issuance');
    assert.equal((await tv.getTvCode('subscription',code.code)).status,'pending');
    await tv.completeTvSubscription(code.code,owner,'premium_yearly','old-checkout',undefined,new Date(Date.now()-60000));
    assert.equal((await tv.getTvCode('subscription',code.code)).status,'pending');
    await tv.completeTvSubscription(code.code,owner,'premium_yearly','current-checkout',code.id);
    assert.equal((await tv.getTvCode('subscription',code.code)).status,'completed');
  });
  it('consumes each command once under concurrent polls, rejects cross-owner and stale commands',async()=>{
    const owner=await user(),other=await user(),device=await pairedDevice(owner);
    for(let index=0;index<5;index++)assert.equal(await tv.enqueueCastCommand(owner,device,'cast:pause',null),true);
    assert.equal(await tv.enqueueCastCommand(other,device,'cast:pause',null),false);
    assert.equal(await tv.pollCastCommand(other,device),null);
    const polled=(await Promise.all(Array.from({length:15},()=>tv.pollCastCommand(owner,device)))).filter(Boolean);
    assert.equal(polled.length,5);assert.equal(new Set(polled.map(row=>row.id)).size,5);
    await tv.enqueueCastCommand(owner,device,'cast:stop',null);
    await pool.query("UPDATE cast_commands SET created_at=now()-interval '2 days' WHERE user_id=$1",[owner]);
    assert.equal(await tv.pollCastCommand(owner,device),null);
  });
  it('unpairing invalidates devices, sessions, pending commands and now-playing atomically',async()=>{
    const owner=await user(),device=await pairedDevice(owner);const session=await cast.createCastSession(owner,'mobile',device);
    await tv.enqueueCastCommand(owner,device,'cast:pause',null);await tv.saveCastNowPlaying(owner,{deviceId:device,isPlaying:true,title:'Test'});
    await tv.unpairTvDevice(owner,device);
    assert.equal(await tv.findTvDevice(owner,device),null);assert.equal(await cast.getCastSession(session.sessionId,owner),null);
    assert.equal(await tv.pollCastCommand(owner,device),null);assert.equal(await tv.getCastNowPlaying(owner,device),null);
    assert.equal(await cast.createCastSession(owner,'mobile',device),null);
  });
  it('updates daily counts and distinct devices without losing concurrent telemetry',async()=>{
    const version=String(Date.now());await Promise.all(Array.from({length:20},(_,index)=>tv.recordTvTelemetry({v:version,src:'remote',plat:'tizen',did:`device-${index%3}`,app:'1.0',country:'DE'})));
    const row=(await tv.listTvTelemetry('2000-01-01')).find(row=>row.v===version);
    assert.equal(row.count,20);assert.equal(row.uniqueDids.length,3);
    assert.equal((await pool.query('SELECT count(*)::int count FROM tv_telemetry WHERE v=$1',[version])).rows[0].count,20);
  });
  it('preserves concurrent plan edits and protects admin configuration from seed retries',async()=>{
    await tv.saveSubscriptionPlan('premium_monthly',{label:'Initial'});
    await Promise.all([tv.saveSubscriptionPlan('premium_monthly',{label:'Monthly Test'}),tv.saveSubscriptionPlan('premium_monthly',{stripePriceId:'price_test'})]);
    await tv.saveSubscriptionPlan('premium_monthly',{label:'Seed default',stripePriceId:''},true);
    const row=await tv.getSubscriptionPlan('premium_monthly');assert.equal(row.label,'Monthly Test');assert.equal(row.stripePriceId,'price_test');
  });
  it('delivers transactional commands between separate WebSocket workers and reports shared presence',async()=>{
    const {CastService}=await import('../src/services/cast-service');
    const first=new CastService(),second=new CastService();
    const owner=await user(),device=await pairedDevice(owner);const session=await cast.createCastSession(owner,'mobile',device);
    const received:any[]=[];const ack:any[]=[];
    const socket=(messages:any[])=>({readyState:1,bufferedAmount:0,send:(message:string)=>messages.push(JSON.parse(message)),close:()=>{}}) as any;
    try{
      await first.registerClient(randomUUID(),socket(ack),session.sessionId,'mobile',owner);
      await second.registerClient(randomUUID(),socket(received),session.sessionId,'tv',owner,device);
      assert.equal((await first.getSessionStatus(session.sessionId,owner)).tvConnected,true);
      assert.equal(await first.sendCommand(session.sessionId,'pause',{},'mobile',owner),true);
      const deadline=Date.now()+5000;
      while((!received.some(row=>row.type==='cast:pause')||!ack.some(row=>row.type==='cast:command_ack'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(received.filter(row=>row.type==='cast:pause').length,1);assert.equal(ack.filter(row=>row.type==='cast:command_ack').length,1);
    }finally{await first.close();await second.close();}
  });
  it('streams only the requested push audience and cleans only old inactive tokens',async()=>{
    const {pgPushDevices,pgPushStatus,pgCleanupPushTokens}=await import('../src/data/postgres-push-store');
    const owner=await user(),other=await user();
    await tv.savePushToken({token:`push-${randomUUID()}`,userId:owner,platform:'ios',tokenType:'apns',country:'DE'});
    const inactive=`push-${randomUUID()}`;
    await tv.savePushToken({token:inactive,userId:owner,platform:'android',tokenType:'fcm',country:'DE'});
    await tv.savePushToken({token:`push-${randomUUID()}`,userId:other,platform:'android',tokenType:'expo',country:'TR'});
    await tv.deactivatePushToken(inactive,owner);
    const own=[];for await(const row of pgPushDevices({userId:owner,country:'DE'}))own.push(row);
    assert.equal(own.length,1);assert.equal(own[0].tokenType,'apns');
    const status=await pgPushStatus();assert.equal(status.tokens.total,3);assert.equal(status.tokens.active,2);assert.equal(status.tokens.byType.fcm,0);
    assert.equal(await pgCleanupPushTokens(),0);
    await pool.query("UPDATE push_tokens SET updated_at=now()-interval '31 days' WHERE token=$1",[inactive]);
    assert.equal(await pgCleanupPushTokens(),1);assert.equal((await pgPushStatus()).tokens.total,2);
  });
});
