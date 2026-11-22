import assert from 'node:assert/strict';
import {it,mock} from 'node:test';
let calls:{sql:string;values:unknown[]}[]=[];
mock.module('../src/postgres-runtime',{namedExports:{getPostgresPool:()=>({query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return{rows:[]};}})}});
const {listStationsFromPostgres,getPopularStationsFromPostgres}=await import('../src/data/station-read-store');
it('sorts the whole country/genre catalog before pagination; popularity metrics beat logo availability',async()=>{
 for(const [sort,criterion] of [['votes','votes DESC,click_count DESC'],['az','name ASC'],['za','name DESC'],['newest','created_at DESC'],['oldest','created_at ASC']]){
  calls=[];await listStationsFromPostgres({country:'Austria',genre:'pop',sort,page:2,limit:33});
  assert.equal(calls.length,1);const {sql,values}=calls[0];
  const order=sql.slice(sql.indexOf('ORDER BY'),sql.indexOf(' LIMIT'));
  assert.ok(order.indexOf(criterion)>=0,sort);
  assert.ok(order.indexOf(criterion)<order.indexOf('favicon'),`${sort}: logo must only break ties`);
  assert.ok(sql.includes('id ASC'),'stable ordering across pages');
  assert.ok(values.includes('Austria'));assert.ok(values.includes('pop'));
  assert.deepEqual(values.slice(-2),[33,33]);
 }
});
it('unknown sort cannot inject SQL and falls back to vote popularity',async()=>{
 calls=[];await listStationsFromPostgres({sort:'bad;DROP TABLE stations',page:1,limit:10});
 assert.ok(calls[0].sql.includes('votes DESC,click_count DESC'));
 assert.ok(!calls[0].sql.includes('DROP TABLE'));
});

it('compact popular discovery bounds candidates and omits multilingual articles before reading PostgreSQL',async()=>{
 calls=[];await getPopularStationsFromPostgres({country:'Turkey',limit:100,compact:true});
 assert.equal(calls.length,1);const {sql,values}=calls[0];
 assert.ok(sql.includes('logo_assets'));assert.ok(sql.includes('url_resolved'));assert.ok(!sql.startsWith('SELECT *'));
 assert.ok(!sql.includes('descriptions'));assert.deepEqual(values,['Turkey','%%',false,400]);
});
