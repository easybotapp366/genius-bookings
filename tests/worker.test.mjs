import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import worker, {validateBooking,validDate,validTime,amountToCents} from '../src/worker.js';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SQL=readFileSync(resolve(base,'migrations/0001_init.sql'),'utf8');
const root='https://genius-bookings.example.workers.dev';
function dbMock(){
 const sqlite=new DatabaseSync(':memory:'); sqlite.exec(SQL);
 function statement(sql,args=[]){return {
   bind(...values){return statement(sql,values);},
   async first(){return sqlite.prepare(sql).get(...args)??null;},
   async all(){return {results:sqlite.prepare(sql).all(...args)};},
   async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(r.changes)}};},
   sql,args
 };}
 return {
   prepare: statement,
   async batch(queries){
     const results=[];sqlite.exec('BEGIN IMMEDIATE');
     try{for(const q of queries){const r=sqlite.prepare(q.sql).run(...q.args);results.push({success:true,meta:{changes:Number(r.changes)}});}sqlite.exec('COMMIT');return results;}
     catch(e){sqlite.exec('ROLLBACK');throw e;}
   },
   sqlite
 };
}
function envMock(){const salt=randomBytes(16), hash=pbkdf2Sync('Secure*P@ssword1234',salt,310000,32,'sha256');return {DB:dbMock(),ADMIN_PASSWORD_HASH:`pbkdf2_sha256$310000$${salt.toString('base64')}$${hash.toString('base64')}`,ASSETS:{fetch:async()=>new Response('hello',{headers:{'Content-Type':'text/html'}})}};}
async function api(env,path,method='GET',body=null,cookie='',csrf='',origin=root){
 const headers={};if(cookie)headers.Cookie=cookie;if(method!=='GET')headers.Origin=origin;if(csrf)headers['X-CSRF-Token']=csrf;if(body!==null)headers['Content-Type']='application/json';
 const req=new Request(root+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
 const res=await worker.fetch(req,env);
 let data;try{data=await res.json()}catch{data={}};
 return {status:res.status,data,setCookie:res.headers.get('Set-Cookie')};
}
async function login(env){const r=await api(env,'/api/login','POST',{password:'Secure*P@ssword1234'});assert.equal(r.status,200,JSON.stringify(r.data));return {csrf:r.data.csrf,cookie:r.setCookie.split(';')[0]};}
const booking={date:'2027-01-01',name:'مريم',address:'القاهرة',phone:'01000000000',brushing:'Brushing',start:'15:00',end:'16:00',deposit:1000,remaining:2500,status:'Confirmed'};

test('validates dates, times, amounts and rejects malformed bookings',()=>{
 assert.equal(validDate('2027-02-29'),false);assert.equal(validDate('2028-02-29'),true);
 assert.equal(validTime('24:00'),false);assert.equal(validTime('23:59'),true);
 assert.equal(amountToCents('135.50'),13550);
 assert.throws(()=>validateBooking({...booking,end:'14:00'}));
 assert.throws(()=>validateBooking({...booking,deposit:-2}));
});

test('unauthenticated reads, CSRF, same-origin writes and brute-force lockout are enforced',async()=>{
 const env=envMock();
 assert.equal((await api(env,'/api/bookings')).status,401);
 assert.equal((await api(env,'/api/login','POST',{password:'x'},'', '', 'https://evil.example')).status,403);
 for(let i=0;i<5;i++)assert.equal((await api(env,'/api/login','POST',{password:'wrong'})).status,401);
 assert.equal((await api(env,'/api/login','POST',{password:'Secure*P@ssword1234'})).status,429);
});

test('password setup distinguishes malformed Secret from invalid credentials, and trims accidental whitespace',async()=>{
 const env=envMock();
 const correct=env.ADMIN_PASSWORD_HASH;
 env.ADMIN_PASSWORD_HASH='  malformed Secret  ';
 let r=await api(env,'/api/login','POST',{password:'Secure*P@ssword1234'});
 assert.equal(r.status,503);
 assert.equal(r.data.code,'PASSWORD_HASH_CONFIG_INVALID');
 env.ADMIN_PASSWORD_HASH='  '+correct+'\n';
 r=await api(env,'/api/login','POST',{password:'Secure*P@ssword1234'});
 assert.equal(r.status,200,JSON.stringify(r.data));
 const invalid=await api(env,'/api/login','POST',{password:'incorrect'});
 assert.equal(invalid.status,401);
 assert.equal(invalid.data.code,'INVALID_CREDENTIALS');
});

test('rate-limited setup diagnostic confirms only a hash fingerprint without transmitting password or hash',async()=>{
 const env=envMock();
 const fingerprint=createHash('sha256').update(env.ADMIN_PASSWORD_HASH).digest('hex');
 let r=await api(env,'/api/setup/hash-check','POST',{fingerprint});
 assert.equal(r.status,200);assert.equal(r.data.code,'SECRET_MATCH');
 assert.equal(r.setCookie,null);
 r=await api(env,'/api/setup/hash-check','POST',{fingerprint:'1'.repeat(64)});
 assert.equal(r.status,409);assert.equal(r.data.code,'SECRET_MISMATCH');
 r=await api(env,'/api/setup/hash-check','POST',{fingerprint:'bad'});
 assert.equal(r.status,422);
 for(let i=1;i<5;i++)assert.equal((await api(env,'/api/setup/hash-check','POST',{fingerprint:'1'.repeat(64)})).status,409);
 assert.equal((await api(env,'/api/setup/hash-check','POST',{fingerprint})).status,429);
});

test('create, overlap, update, cancellation, archive and restore with optimistic version',async()=>{
 const env=envMock();const {cookie,csrf}=await login(env);
 assert.equal((await api(env,'/api/bookings','POST',booking,cookie)).status,403);
 const created=await api(env,'/api/bookings','POST',booking,cookie,csrf);
 assert.equal(created.status,201,JSON.stringify(created.data));
 const id=created.data.booking.id;
 assert.equal(created.data.booking.total,3500);
 const overlap=await api(env,'/api/bookings','POST',{...booking,name:'بسنت',start:'15:30',end:'17:00'},cookie,csrf);
 assert.equal(overlap.status,409);assert.equal(overlap.data.code,'OVERLAP');
 const second=await api(env,'/api/bookings','POST',{...booking,name:'بسنت',start:'17:00',end:'19:00'},cookie,csrf);
 assert.equal(second.status,201);
 const update=await api(env,`/api/bookings/${id}`,'PUT',{...booking,remaining:1250,version:1},cookie,csrf);
 assert.equal(update.status,200);assert.equal(update.data.booking.total,2250);assert.equal(update.data.booking.version,2);
 const stale=await api(env,`/api/bookings/${id}`,'PUT',{...booking,version:1},cookie,csrf);assert.equal(stale.status,409);
 const deleted=await api(env,`/api/bookings/${id}`,'DELETE',{version:2,reason:'إلغاء'},cookie,csrf);
 assert.equal(deleted.status,200);
 const active=await api(env,'/api/bookings', 'GET',null,cookie);
 const archive=await api(env,'/api/archive','GET',null,cookie);
 assert.equal(active.data.items.length,1);assert.equal(archive.data.items.length,1);
 assert.equal(archive.data.items[0].reason,'إلغاء');
 const restored=await api(env,`/api/archive/${id}/restore`,'POST',{},cookie,csrf);assert.equal(restored.status,200);
 assert.equal((await api(env,'/api/bookings','GET',null,cookie)).data.items.length,2);
});

test('dry-run and idempotent migration import; do not expose records in public files',async()=>{
 const env=envMock();const {cookie,csrf}=await login(env);
 const fixture={bookings:[{...booking,id:'BKG-test-0001'}],archive:[]};
 let r=await api(env,'/api/import','POST',{...fixture,dryRun:true},cookie,csrf);assert.equal(r.status,200);assert.equal(r.data.verified.bookings,1);
 assert.equal((await api(env,'/api/bookings','GET',null,cookie)).data.items.length,0);
 r=await api(env,'/api/import','POST',fixture,cookie,csrf);assert.equal(r.status,200);assert.equal(r.data.inserted,1);
 r=await api(env,'/api/import','POST',fixture,cookie,csrf);assert.equal(r.status,200);assert.equal(r.data.skipped,1);
});
