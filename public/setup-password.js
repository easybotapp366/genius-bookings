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
 if(pass.length<18||pass.length>200||pass!==confirm){message.textContent='راجع كلمة المرور والتأكيد؛ الطول لازم يكون من 18 إلى 200 حرف ومتطابقين.';return;}
 if(!window.isSecureContext||!crypto?.subtle){message.textContent='لازم تفتح الأداة من رابط HTTPS آمن.';return;}
 generate.disabled=true;generate.textContent='جاري التوليد...';
 try{
  const encoder=new TextEncoder();const salt=crypto.getRandomValues(new Uint8Array(24));
  const key=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  textarea.value='pbkdf2_sha256$100000$'+base64(salt)+'$'+base64(new Uint8Array(derived));
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
