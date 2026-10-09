/**
 * Genius Bookings / Cloudflare Workers + D1
 * Personal booking information is stored ONLY in the bound D1 database.
 * No Google or GitHub tokens. No passwords or customer records in static assets.
 */
const encoder = new TextEncoder();
const STATUSES = new Set(['Confirmed', 'Pending', 'Completed', 'Cancelled']);
const SESSION_SECONDS = 8 * 60 * 60;
// Cloudflare production Workers reject PBKDF2 above 100,000 rounds.
const WORKER_PBKDF2_ITERATIONS = 100000;
const PAGE_LIMIT = 250;
const MAX_IMPORT_ITEMS = 500;
const MAX_JSON_BYTES = 700_000;
const BOOKING_FIELDS = 'id,event_date,client_name,address,phone,brushing,start_time,end_time,deposit_cents,remaining_cents,status,version,created_at,updated_at';
const ARCHIVE_FIELDS = BOOKING_FIELDS+',deleted_at,deletion_reason';

function headers(){return {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
};}
const response = (payload, status = 200, extras={}) => new Response(JSON.stringify(payload),{status,headers:{...headers(),...extras}});
const error = (message,status=400,code='BAD_REQUEST')=>response({error:message,code},status);
function cookieName(){return 'gb_session';}
function parseCookies(str=''){return Object.fromEntries((str||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const p=x.indexOf('=');return p<0?[x,'']:[x.slice(0,p),x.slice(p+1)];}));}
function sessionCookie(token, request, maxAge){
  // Secure on all production URLs. Wrangler localhost allows HTTP local development only.
  const hostname = new URL(request.url).hostname;
  const dev = ['localhost','127.0.0.1','::1'].includes(hostname);
  return `${cookieName()}=${token}; HttpOnly; ${dev?'':'Secure; '}SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
function randomToken(bytes=32){return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
function hex(a){return Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');}
async function sha(s){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));}
function b64ToBytes(str){return Uint8Array.from(atob(str),c=>c.charCodeAt(0));}
function timingEqual(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
// Distinguish malformed Cloudflare Secret from a wrong password.
function parsePasswordHash(stored){
  const parts=String(stored??'').trim().split('$');
  if(parts.length!==4||parts[0]!=='pbkdf2_sha256'||!/^[0-9]+$/.test(parts[1]))return null;
  const iterations=Number(parts[1]);
  if(!Number.isSafeInteger(iterations)||iterations!==WORKER_PBKDF2_ITERATIONS)return null;
  try{
    const salt=b64ToBytes(parts[2]),expected=b64ToBytes(parts[3]);
    if(salt.length<16||salt.length>64||expected.length!==32)return null;
    return {iterations,salt,expected};
  }catch{return null;}
}
async function checkPassword(candidate, stored){
  const parsed=parsePasswordHash(stored);
  if(!parsed||typeof candidate!=='string'||candidate.length>300)return false;
  try{
    const key=await crypto.subtle.importKey('raw',encoder.encode(candidate),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:parsed.salt,iterations:parsed.iterations},key,256);
    return timingEqual(new Uint8Array(bits),parsed.expected);
  }catch{throw new Error('PASSWORD_CRYPTO_ERROR');}
}
function assertOrigin(request){
  const origin=request.headers.get('Origin');
  return origin===new URL(request.url).origin;
}
async function jsonBody(request){
  const length=Number(request.headers.get('Content-Length'));
  if(Number.isFinite(length)&&length>MAX_JSON_BYTES)throw Object.assign(new Error('الطلب كبير جدًا'),{status:413});
  const content=await request.text();
  if(encoder.encode(content).length>MAX_JSON_BYTES)throw Object.assign(new Error('الطلب كبير جدًا'),{status:413});
  try {return JSON.parse(content);}catch{throw Object.assign(new Error('JSON غير صالح'),{status:400});}
}
function validDate(s){if(typeof s!=='string'||!/^20\d\d-\d\d-\d\d$/.test(s))return false;const [y,m,d]=s.split('-').map(Number);if(y<2027||y>2100)return false;const v=new Date(Date.UTC(y,m-1,d));return v.getUTCFullYear()===y&&v.getUTCMonth()+1===m&&v.getUTCDate()===d;}
function validTime(t){return typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);}
function amountToCents(v){
  const s=String(v??'0').trim();if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(s))throw Object.assign(new Error('قيمة العربون أو المتبقي غير صحيحة'),{status:422});
  const [whole,decimal='']=s.split('.');return Number(whole)*100+Number(decimal.padEnd(2,'0'));
}
function centsToNumber(v){return Number(v||0)/100;}
function validateBooking(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('بيانات الحجز غير صحيحة'),{status:422});
  const value=(k,max)=>{const str=String(input[k]??'').trim();if(str.length>max)throw Object.assign(new Error('حقل طويل جدًا: '+k),{status:422});return str;};
  const name=value('name',100), date=value('date',10),start=value('start',5),end=value('end',5);
  if(!name||!validDate(date)||!validTime(start)||!validTime(end)||start>=end)throw Object.assign(new Error('لازم اسم وتاريخ صحيح ووقت نهاية بعد البداية في نفس اليوم'),{status:422});
  const status=value('status',20)||'Confirmed';if(!STATUSES.has(status))throw Object.assign(new Error('حالة الحجز غير صحيحة'),{status:422});
  return {name,date,start,end,address:value('address',300),phone:value('phone',60),brushing:value('brushing',300),status,depositCents:amountToCents(input.deposit??0),remainingCents:amountToCents(input.remaining??0)};
}
function bookingToApi(row){return {id:row.id,date:row.event_date,name:row.client_name,address:row.address,phone:row.phone,brushing:row.brushing,start:row.start_time,end:row.end_time,deposit:centsToNumber(row.deposit_cents),remaining:centsToNumber(row.remaining_cents),total:centsToNumber(row.deposit_cents+row.remaining_cents),status:row.status,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,...('deleted_at' in row?{deletedAt:row.deleted_at,reason:row.deletion_reason}:{})};}
function sqlBookingValues(row,id){return [id,row.date,row.name,row.address,row.phone,row.brushing,row.start,row.end,row.depositCents,row.remainingCents,row.status];}
const insertSQL='INSERT INTO bookings (id,event_date,client_name,address,phone,brushing,start_time,end_time,deposit_cents,remaining_cents,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
async function checkCollisions(db,row,excludedId=''){
  if(row.status==='Cancelled')return [];
  const result=await db.prepare(`SELECT id,client_name,start_time,end_time FROM bookings WHERE event_date=? AND id!=? AND status!='Cancelled' AND start_time<? AND end_time>? LIMIT 8`).bind(row.date,excludedId,row.end,row.start).all();
  return result.results||[];
}
async function getSession(request,env){
  const raw=parseCookies(request.headers.get('Cookie'))[cookieName()];
  if(!raw||!/^[a-f0-9]{64}$/.test(raw))return null;
  const digest=await sha(raw);
  const s=await env.DB.prepare('SELECT csrf_token,credential_tag,expires_at FROM admin_sessions WHERE token_hash=?').bind(digest).first();
  if(!s||Number(s.expires_at)<=Date.now())return null;
  if(s.credential_tag!==await sha(String(env.ADMIN_PASSWORD_HASH??'').trim()))return null;
  return {...s,tokenHash:digest};
}
function sameCsrf(request,session){const token=request.headers.get('X-CSRF-Token')||'';return timingEqual(encoder.encode(token),encoder.encode(session.csrf_token));}
function publicSecurityHeaders(res){
  const h=new Headers(res.headers);
  h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('X-Frame-Options','DENY');
  h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
  if(h.get('Content-Type')?.includes('text/html'))h.set('Cache-Control','no-store');
  return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h});
}
async function readSessionLoginAttempts(env,ipKey){
  const old=await env.DB.prepare('SELECT fail_count,window_start,blocked_until FROM login_attempts WHERE attempt_key=?').bind(ipKey).first();
  const now=Date.now();
  if(!old)return {allowed:true,failCount:0};
  if(old.blocked_until>now)return {allowed:false,waitSec:Math.ceil((old.blocked_until-now)/1000)};
  if(now-old.window_start>15*60000)return {allowed:true,failCount:0};
  return {allowed:true,failCount:old.fail_count||0};
}
async function login(request,env){
  const configured=String(env.ADMIN_PASSWORD_HASH??'').trim();
  if(!configured)return error('لم يتم إعداد كلمة مرور الإدارة على السيرفر بعد',503,'SETUP_REQUIRED');
  if(!parsePasswordHash(configured))return error('بصمة Cloudflare غير مدعومة: الموقع يحتاج PBKDF2 بـ 100000 دورة فقط. افتح password-setup.html وولّد بصمة جديدة ثم احفظها في ADMIN_PASSWORD_HASH على Production',503,'PASSWORD_HASH_CONFIG_INVALID');
  const input=await jsonBody(request), password=String(input.password||'');
  const clientIp=request.headers.get('CF-Connecting-IP')||'unknown';
  const ipKey=await sha('login:'+clientIp+':'+configured);
  const attempt=await readSessionLoginAttempts(env,ipKey);
  if(!attempt.allowed)return response({error:'محاولات كثيرة. حاول بعد قليل',code:'RATE_LIMITED'},429,{'Retry-After':String(Math.max(1,attempt.waitSec))});
  let valid;
  try{valid=await checkPassword(password,configured);}
  catch{
    // Do not report cryptographic runtime failures as an incorrect password.
    // Never log plaintext credentials or their stored hashes.
    return error('فيه مشكلة تقنية أثناء فحص كلمة المرور على Cloudflare. أبلغ المسؤول بكود الخطأ فقط',503,'PASSWORD_CRYPTO_ERROR');
  }
  if(!valid){
    const n=attempt.failCount+1,now=Date.now();
    await env.DB.prepare(`INSERT INTO login_attempts(attempt_key,fail_count,window_start,blocked_until) VALUES(?,?,?,?) ON CONFLICT(attempt_key) DO UPDATE SET fail_count=excluded.fail_count,window_start=excluded.window_start,blocked_until=excluded.blocked_until`).bind(ipKey,n,now,n>=5?now+15*60000:0).run();
    return error('كلمة المرور غير صحيحة',401,'INVALID_CREDENTIALS');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key=?').bind(ipKey).run();
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<?').bind(Date.now()).run();
  const token=randomToken(),csrf=randomToken(24),now=Date.now();
  await env.DB.prepare('INSERT INTO admin_sessions(token_hash,csrf_token,credential_tag,created_at,expires_at) VALUES(?,?,?,?,?)').bind(await sha(token),csrf,await sha(configured),now,now+SESSION_SECONDS*1000).run();
  return response({ok:true,csrf,expiresAt:now+SESSION_SECONDS*1000},200,{'Set-Cookie':sessionCookie(token,request,SESSION_SECONDS)});
}
// TEMPORARY setup diagnostic: accepts only SHA-256 fingerprint of a proposed
// PBKDF2 hash (never the hash or password). Remove once migration is complete.
// Throttled like login, scoped to current secret and requesting IP.
async function checkSecretFingerprint(request, env){
  const configured=String(env.ADMIN_PASSWORD_HASH??'').trim();
  if(!configured)return error('لم يتم إعداد كلمة مرور الإدارة بعد',503,'SETUP_REQUIRED');
  if(!parsePasswordHash(configured))return error('بصمة الإدارة في Cloudflare غير صالحة',503,'PASSWORD_HASH_CONFIG_INVALID');
  const payload=await jsonBody(request), fingerprint=String(payload?.fingerprint??'').toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(fingerprint))return error('بيانات فحص البصمة غير صحيحة',422,'INVALID_FINGERPRINT');
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const ipKey=await sha('setup-check:'+ip+':'+configured);
  const attempt=await readSessionLoginAttempts(env,ipKey);
  if(!attempt.allowed)return response({error:'فحوصات كثيرة؛ حاول بعد 15 دقيقة',code:'RATE_LIMITED'},429,{'Retry-After':String(Math.max(1,attempt.waitSec))});
  const configuredFingerprint=await sha(configured);
  const matches=timingEqual(encoder.encode(fingerprint),encoder.encode(configuredFingerprint));
  if(matches){
    await env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key=?').bind(ipKey).run();
    return response({matches:true,code:'SECRET_MATCH'});
  }
  const now=Date.now(),n=attempt.failCount+1;
  await env.DB.prepare('INSERT INTO login_attempts(attempt_key,fail_count,window_start,blocked_until) VALUES(?,?,?,?) ON CONFLICT(attempt_key) DO UPDATE SET fail_count=excluded.fail_count,window_start=excluded.window_start,blocked_until=excluded.blocked_until').bind(ipKey,n,now,n>=5?now+15*60000:0).run();
  return response({matches:false,code:'SECRET_MISMATCH',error:'الـHash الموجود على Cloudflare مختلف عن البصمة اللي عندك'},409);
}

function parsePagination(u){const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||PAGE_LIMIT);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('الصفحة غير صحيحة'),{status:422});return {offset,limit};}
async function getList(env,table,fields,u){const {offset,limit}=parsePagination(u);const sort=table==='bookings'?'event_date,start_time,id':'deleted_at DESC,id';const r=await env.DB.prepare(`SELECT ${fields} FROM ${table} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(limit+1,offset).all();const rows=r.results||[];return response({items:rows.slice(0,limit).map(bookingToApi),nextOffset:rows.length>limit?offset+limit:null});}
async function createBooking(env,input){const row=validateBooking(input);const conflict=await checkCollisions(env.DB,row);if(conflict.length&&!input.forceConflict)return response({code:'OVERLAP',error:'فيه حجز تاني في نفس التوقيت',conflicts:conflict.map(x=>({name:x.client_name,start:x.start_time,end:x.end_time}))},409);const id=crypto.randomUUID();await env.DB.prepare(insertSQL).bind(...sqlBookingValues(row,id)).run();await env.DB.prepare('INSERT INTO audit_log(action,booking_id) VALUES(?,?)').bind('CREATE',id).run();const saved=await env.DB.prepare(`SELECT ${BOOKING_FIELDS} FROM bookings WHERE id=?`).bind(id).first();return response({booking:bookingToApi(saved)},201);}
async function updateBooking(env,id,input){const version=Number(input.version);if(!Number.isInteger(version)||version<1)return error('لازم تحديث الصفحة قبل تعديل الحجز',422,'VERSION_REQUIRED');const old=await env.DB.prepare('SELECT id,version FROM bookings WHERE id=?').bind(id).first();if(!old)return error('الحجز مش موجود',404,'NOT_FOUND');if(old.version!==version)return error('الحجز اتغير من جهاز تاني. حدّث البيانات',409,'STALE_VERSION');const row=validateBooking(input);const conflicts=await checkCollisions(env.DB,row,id);if(conflicts.length&&!input.forceConflict)return response({code:'OVERLAP',error:'فيه حجز تاني في نفس التوقيت',conflicts:conflicts.map(x=>({name:x.client_name,start:x.start_time,end:x.end_time}))},409);
  const result=await env.DB.prepare(`UPDATE bookings SET event_date=?,client_name=?,address=?,phone=?,brushing=?,start_time=?,end_time=?,deposit_cents=?,remaining_cents=?,status=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?`).bind(row.date,row.name,row.address,row.phone,row.brushing,row.start,row.end,row.depositCents,row.remainingCents,row.status,id,version).run();
  if(!result.meta?.changes)return error('البيانات اتغيرت؛ حدّث الصفحة',409,'STALE_VERSION');
  await env.DB.prepare('INSERT INTO audit_log(action,booking_id) VALUES(?,?)').bind('UPDATE',id).run();const saved=await env.DB.prepare(`SELECT ${BOOKING_FIELDS} FROM bookings WHERE id=?`).bind(id).first();return response({booking:bookingToApi(saved)});
}
async function deleteBooking(env,id,input){const version=Number(input?.version);if(!Number.isInteger(version)||version<1)return error('لازم تحدث الحجز قبل الحذف',422,'VERSION_REQUIRED');const row=await env.DB.prepare('SELECT version FROM bookings WHERE id=?').bind(id).first();if(!row)return error('الحجز غير موجود',404,'NOT_FOUND');if(row.version!==version)return error('الحجز اتغير من جهاز تاني. حدث البيانات',409,'STALE_VERSION');const reason=String(input.reason||'').trim();if(reason.length>250)return error('سبب الحذف طويل جدًا',422);
  // One D1 batch transaction: archive BEFORE delete, both subject to the same optimistic version.
  const inserts=env.DB.prepare(`INSERT INTO deleted_bookings (${ARCHIVE_FIELDS}) SELECT ${BOOKING_FIELDS},strftime('%Y-%m-%dT%H:%M:%fZ','now'),? FROM bookings WHERE id=? AND version=?`).bind(reason,id,version);
  const deletes=env.DB.prepare('DELETE FROM bookings WHERE id=? AND version=?').bind(id,version);
  const audit=env.DB.prepare('INSERT INTO audit_log(action,booking_id) VALUES(?,?)').bind('DELETE',id);
  const result=await env.DB.batch([inserts,deletes,audit]);
  if(!result[1]?.meta?.changes)return error('الحجز اتغير؛ حدث الصفحة',409,'STALE_VERSION');
  return response({ok:true,id});
}
async function restoreBooking(env,id,input){const old=await env.DB.prepare(`SELECT ${ARCHIVE_FIELDS} FROM deleted_bookings WHERE id=?`).bind(id).first();if(!old)return error('الحجز مش في الأرشيف',404);const row=validateBooking(bookingToApi(old));const conflicts=await checkCollisions(env.DB,row,id);if(conflicts.length&&!input?.forceConflict)return response({code:'OVERLAP',error:'فيه حجز في نفس الموعد',conflicts:conflicts.map(x=>({name:x.client_name,start:x.start_time,end:x.end_time}))},409);
  // Atomic move, preserving all original booking attributes.
  const a=env.DB.prepare(`INSERT INTO bookings (${BOOKING_FIELDS}) SELECT ${BOOKING_FIELDS} FROM deleted_bookings WHERE id=?`).bind(id);
  const b=env.DB.prepare('DELETE FROM deleted_bookings WHERE id=?').bind(id);
  const audit=env.DB.prepare('INSERT INTO audit_log(action,booking_id) VALUES(?,?)').bind('RESTORE',id);
  await env.DB.batch([a,b,audit]);return response({ok:true,id});
}
function normalizedImportItem(raw,archived){
  const row=validateBooking(raw);const id=String(raw.id||'').trim();
  if(!/^[a-zA-Z0-9_\-]{8,120}$/.test(id))throw Object.assign(new Error('معرّف الحجز القديم غير صالح'),{status:422});
  const reason=String(raw.reason||'').slice(0,250),at=String(raw.deletedAt||'').trim();
  if(archived&&at&&!/^20\d\d-\d\d-\d\d(?:T[\d:.]+Z)?$/.test(at))throw Object.assign(new Error('تاريخ الحذف القديم غير صالح'),{status:422});
  return {...row,id,reason,deletedAt:at||new Date().toISOString()};
}
async function importData(env,input){
  const bookings=input?.bookings,archive=input?.archive;
  if(!Array.isArray(bookings)||!Array.isArray(archive))return error('صيغة ملف الاستيراد غير صحيحة',422);
  if(bookings.length+archive.length>MAX_IMPORT_ITEMS)return error('أقصى عدد للحجوزات في الملف الواحد 500',413);
  let data;
  try{data={bookings:bookings.map(x=>normalizedImportItem(x,false)),archive:archive.map(x=>normalizedImportItem(x,true))};}catch(e){return error('فشل التحقق من البيانات: '+e.message,422);}
  const ids=[...data.bookings,...data.archive].map(x=>x.id);if(new Set(ids).size!==ids.length)return error('فيه رقم حجز مكرر داخل الملف',422);
  if(input.dryRun)return response({ok:true,verified:{bookings:data.bookings.length,archive:data.archive.length}});
  let inserted=0,skipped=0;
  // Idempotent reruns; private data never travels through GitHub. Small transactional batches.
  const tasks=[...data.bookings.map(row=>({row,archive:false})),...data.archive.map(row=>({row,archive:true}))];
  for(let i=0;i<tasks.length;i+=40){const chunk=tasks.slice(i,i+40),statements=chunk.map(({row,archive})=>archive?
    env.DB.prepare(`INSERT OR IGNORE INTO deleted_bookings (id,event_date,client_name,address,phone,brushing,start_time,end_time,deposit_cents,remaining_cents,status,version,created_at,updated_at,deleted_at,deletion_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?)`).bind(...sqlBookingValues(row,row.id),row.deletedAt,row.reason):
    env.DB.prepare(insertSQL.replace('INSERT INTO','INSERT OR IGNORE INTO')).bind(...sqlBookingValues(row,row.id)));
    const out=await env.DB.batch(statements);inserted+=out.reduce((s,r)=>s+Number(r.meta?.changes||0),0);skipped+=chunk.length-out.reduce((s,r)=>s+Number(r.meta?.changes||0),0);
  }
  await env.DB.prepare('INSERT INTO audit_log(action,booking_id) VALUES(?,?)').bind('IMPORT',String(inserted)).run();
  return response({ok:true,inserted,skipped});
}
async function handleApi(request,env,u){
  const path=u.pathname;const method=request.method.toUpperCase();
  if(method==='OPTIONS')return error('غير مسموح',405,'METHOD_NOT_ALLOWED');
  if(method==='GET'&&path==='/api/health')return response({ok:true,service:'genius-bookings'});
  if(!env.DB)return error('لم يتم ربط قاعدة البيانات بعد',503,'SETUP_REQUIRED');
  if(method!=='GET'&&!assertOrigin(request))return error('طلب من مصدر غير موثوق',403,'ORIGIN_MISMATCH');
  if(method==='POST'&&path==='/api/setup/hash-check')return checkSecretFingerprint(request,env);
  if(method==='POST'&&path==='/api/login')return login(request,env);
  const session=await getSession(request,env);
  if(!session)return error('سجّل دخول الأول',401,'LOGIN_REQUIRED');
  if(method==='GET'&&path==='/api/me')return response({ok:true,csrf:session.csrf_token,expiresAt:session.expires_at});
  if(method!=='GET'&&!sameCsrf(request,session))return error('رمز حماية الجلسة غير صحيح. حدث الصفحة',403,'CSRF_MISMATCH');
  if(method==='POST'&&path==='/api/logout'){await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(session.tokenHash).run();return response({ok:true},200,{'Set-Cookie':sessionCookie('',request,0)});}
  if(method==='GET'&&path==='/api/bookings')return getList(env,'bookings',BOOKING_FIELDS,u);
  if(method==='GET'&&path==='/api/archive')return getList(env,'deleted_bookings',ARCHIVE_FIELDS,u);
  if(method==='POST'&&path==='/api/bookings')return createBooking(env,await jsonBody(request));
  if(method==='POST'&&path==='/api/import')return importData(env,await jsonBody(request));
  const match=path.match(/^\/api\/bookings\/([0-9a-zA-Z-]{8,120})$/);
  if(match&&method==='PUT')return updateBooking(env,match[1],await jsonBody(request));
  if(match&&method==='DELETE')return deleteBooking(env,match[1],await jsonBody(request));
  const restore=path.match(/^\/api\/archive\/([0-9a-zA-Z-]{8,120})\/restore$/);
  if(restore&&method==='POST')return restoreBooking(env,restore[1],await jsonBody(request));
  return error('الرابط غير موجود',404,'NOT_FOUND');
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')){
      try{return await handleApi(request,env,url);}
      catch(err){
        if(err.status)return error(err.message,err.status,err.status===413?'TOO_LARGE':'INVALID_INPUT');
        console.error('Unhandled API error',err?.message||'unknown');
        return error('حصل خطأ في السيرفر. حاول تاني',500,'INTERNAL_ERROR');
      }
    }
    if(!env.ASSETS)return error('الملفات الثابتة غير مربوطة',503,'SETUP_REQUIRED');
    return publicSecurityHeaders(await env.ASSETS.fetch(request));
  }
};
// Internal exports for isolated tests, not part of the deployed API.
export {validateBooking,checkPassword,bookingToApi,validDate,validTime,amountToCents};
