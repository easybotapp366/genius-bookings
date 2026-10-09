'use strict';
const form=document.getElementById('hash-form');
const message=document.getElementById('notice');
const out=document.getElementById('result');
const textarea=document.getElementById('hash');
const generate=document.getElementById('generate');
function base64(bytes){let result='';for(const byte of bytes)result+=String.fromCharCode(byte);return btoa(result);}
form.addEventListener('submit',async event=>{
 event.preventDefault();out.hidden=true;textarea.value='';message.textContent='';
 const pass=document.getElementById('password').value;
 const confirm=document.getElementById('confirm').value;
 if(pass.length<14||pass.length>200||pass!==confirm){message.textContent='راجع كلمة المرور والتأكيد؛ الطول لازم يكون من 14 إلى 200 حرف ومتطابقين.';return;}
 if(!window.isSecureContext||!crypto?.subtle){message.textContent='لازم تفتح الأداة من رابط HTTPS آمن.';return;}
 generate.disabled=true;generate.textContent='جاري التوليد...';
 try{
  const encoder=new TextEncoder();const salt=crypto.getRandomValues(new Uint8Array(24));
  const key=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},key,256);
  textarea.value='pbkdf2_sha256$310000$'+base64(salt)+'$'+base64(new Uint8Array(derived));
  out.hidden=false;
  document.getElementById('password').value='';document.getElementById('confirm').value='';
  message.textContent='تم التوليد على جهازك. انسخ قيمة الإعداد إلى Cloudflare ثم امسحها من الشاشة.';
 }catch{message.textContent='تعذر التوليد. تأكد من فتح HTTPS حديث.';}
 finally{generate.disabled=false;generate.textContent='توليد القيمة الآمنة';}
});
document.getElementById('copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(textarea.value);message.textContent='تم النسخ. الصقها في Cloudflare Secret فقط.';}
 catch{textarea.select();message.textContent='انسخ القيمة المحددة يدويًا.';}
});


document.getElementById('verify-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const notice=document.getElementById('verify-notice');
 const password=document.getElementById('verify-password').value;
 const stored=document.getElementById('verify-hash').value.trim();
 notice.textContent='جاري التحقق على جهازك...';
 const p=stored.split('$');
 if(p.length!==4||p[0]!=='pbkdf2_sha256'||p[1]!=='310000'){
  notice.textContent='بصمة غير صالحة. لازم تبدأ بـ pbkdf2_sha256$310000$.';
  return;
 }
 try{
  const salt=Uint8Array.from(atob(p[2]),c=>c.charCodeAt(0));
  const expected=Uint8Array.from(atob(p[3]),c=>c.charCodeAt(0));
  if(salt.length<16||expected.length!==32)throw new Error('bad format');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},key,256));
  let difference=0;
  for(let i=0;i<actual.length;i++)difference|=actual[i]^expected[i];
  notice.textContent=difference===0?'✅ كلمة المرور تطابق هذه البصمة. انسخها كاملة إلى Cloudflare Secret ثم احفظها.':'❌ كلمة المرور لا تطابق البصمة. ولّد بصمة جديدة من نفس كلمة المرور.';
 }catch{
  notice.textContent='البصمة غير صالحة أو مش منسوخة كاملة. أعد توليدها.';
 }
 document.getElementById('verify-password').value='';
});


document.getElementById('check-cloudflare').addEventListener('click',async()=>{
 const button=document.getElementById('check-cloudflare');
 const notice=document.getElementById('cloudflare-check-result');
 const hash=document.getElementById('verify-hash').value.trim();
 notice.textContent='';
 if(!/^pbkdf2_sha256\$\d+\$[^$]+\$[^$]+$/.test(hash)){
   notice.textContent='الصق الـHash كاملًا في الخانة اللي فوق الأول.';return;
 }
 if(!window.isSecureContext||!crypto?.subtle){
   notice.textContent='لازم تفتح الصفحة من HTTPS.';return;
 }
 button.disabled=true;notice.textContent='جاري مقارنة البصمة المحفوظة في Cloudflare...';
 try{
   const bytes=new TextEncoder().encode(hash);
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   const fingerprint=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
   const response=await fetch('/api/setup/hash-check',{
     method:'POST',credentials:'omit',cache:'no-store',
     headers:{'Content-Type':'application/json','Accept':'application/json'},
     body:JSON.stringify({fingerprint})
   });
   const data=await response.json();
   if(data.code==='SECRET_MATCH')notice.textContent='✅ الـHash الموجود على Cloudflare مطابق تمامًا. لو الدخول لسه بيرفض، هنراجع مسار التحقق نفسه.';
   else if(data.code==='SECRET_MISMATCH')notice.textContent='❌ الـHash الموجود على Cloudflare مختلف عن اللي لصقته هنا. اضغط Edit للـSecret واحفظ نفس القيمة كاملة في Production، ثم Deploy.';
   else if(data.code==='RATE_LIMITED')notice.textContent='محاولات الفحص كثيرة. انتظر 15 دقيقة.';
   else notice.textContent='تعذر الفحص: '+(data.error||('HTTP '+response.status));
 }catch{
   notice.textContent='تعذر الاتصال. تأكد إن آخر نسخة من GitHub اتنشرت على Cloudflare.';
 }finally{button.disabled=false;}
});


document.getElementById('login-verified').addEventListener('click',async()=>{
 const button=document.getElementById('login-verified');
 const result=document.getElementById('login-verified-result');
 const pass=document.getElementById('verify-password').value;
 const rawHash=document.getElementById('verify-hash').value.trim();
 result.textContent='';
 button.disabled=true;
 try{
  const parts=rawHash.split('$');
  if(parts.length!==4||parts[0]!=='pbkdf2_sha256'||!/^[0-9]+$/.test(parts[1]))throw new Error('الصق الـHash الكامل الأول.');
  const iterations=Number(parts[1]);
  if(iterations<210000||iterations>2000000||!Number.isSafeInteger(iterations)||!pass)throw new Error('اكتب الباسورد والـHash الصحيح.');
  const salt=Uint8Array.from(atob(parts[2]),c=>c.charCodeAt(0));
  const expected=Uint8Array.from(atob(parts[3]),c=>c.charCodeAt(0));
  if(salt.length<16||expected.length!==32)throw new Error('الـHash غير صالح.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256));
  let difference=0;for(let i=0;i<32;i++)difference|=bits[i]^expected[i];
  if(difference!==0)throw new Error('الباسورد المكتوب هنا مش مطابق للـHash. مش هنبعت طلب للسيرفر.');
  result.textContent='✅ التطابق المحلي صحيح. جاري تجربة تسجيل الدخول الحقيقي...';
  const response=await fetch('/api/login',{
    method:'POST',
    credentials:'same-origin',
    cache:'no-store',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({password:pass})
  });
  const data=await response.json().catch(()=>({}));
  if(response.ok){
    result.textContent='✅ تم تسجيل الدخول بنجاح. جاري فتح البرنامج...';
    location.assign('/');
  }else{
    result.textContent='التطابق المحلي صحيح، لكن السيرفر رفض تسجيل الدخول: '+(data.code||('HTTP '+response.status))+(data.error?' — '+data.error:'');
  }
 }catch(error){
  result.textContent=error.message||'تعذر إجراء فحص تسجيل الدخول.';
 }finally{
  document.getElementById('verify-password').value='';
  button.disabled=false;
 }
});
