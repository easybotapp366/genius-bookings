/* Genius Bookings: private D1-backed booking manager, same-origin session auth. */
'use strict';
const CONFIG=Object.freeze({timezone:'Africa/Cairo'});
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const STATUS = {Confirmed:'مؤكد',Pending:'قيد التأكيد',Completed:'مكتمل',Cancelled:'ملغي'};
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const state = {
  csrf:'', authenticated:false, loading:false, rows:[], archive:[], year:2027, month:'all',
  status:'all', todayOnly:false, screen:'dashboard', search:'', archiveSearch:'',
  editing:null, deleting:null, futureYears: new Set([2027]), toastTimer:null
};
const esc = v => String(v??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('ar-EG',{style:'currency',currency:'EGP',maximumFractionDigits:0}).format(Number(v)||0);
const compactNumber = v => new Intl.NumberFormat('ar-EG',{maximumFractionDigits:0}).format(Number(v)||0);
const nz = x => (typeof x === 'number' ? x : Number(String(x??'').replace(/,/g,''))) || 0;
const pad = n => String(n).padStart(2,'0');
const isoDate = (y,m,d) => `${y}-${pad(m)}-${pad(d)}`;
const epochToSerial = date => date.getTime()/86400000 + 25569;
const fullDay = s => {
  if (!s) return '';
  const [y,m,d] = s.split('-').map(Number);
  return new Intl.DateTimeFormat('ar-EG', {weekday:'long',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)));
};
const dateToSerial = s => {let a=String(s).split('-').map(Number);return Date.UTC(a[0],a[1]-1,a[2])/86400000+25569;};
const fromSerial = value => {
  if(value === '' || value == null)return '';
  if(typeof value === 'number') return new Date(Math.round((value-25569)*86400000)).toISOString().slice(0,10);
  const v=String(value);
  if(/^\d{4}-\d\d-\d\d/.test(v))return v.slice(0,10);
  const m=v.match(/^(\d\d?)\/(\d\d?)\/(\d{4})$/);
  return m?isoDate(Number(m[3]),Number(m[2]),Number(m[1])):'';
};
const timeFraction = s => {const [h,m]=String(s).split(':').map(Number);return (h*60+m)/1440;};
const fractionToTime = value => {
  if(value === ''||value==null)return '';
  if(typeof value === 'number'){const mins=(Math.round((value-Math.floor(value))*1440)+1440)%1440;return `${pad(Math.floor(mins/60))}:${pad(mins%60)}`;}
  let t=String(value).trim();let m=t.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if(!m)return '';
  let h=Number(m[1]);const suffix=(m[3]||'').toUpperCase();
  if(suffix){h=(h%12)+(suffix==='PM'?12:0);}
  return `${pad(h)}:${m[2]}`;
};
const dateParts = () => {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:CONFIG.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=k=>Number(parts.find(p=>p.type===k).value);
  return {year:get('year'),month:get('month'),day:get('day'),iso:isoDate(get('year'),get('month'),get('day'))};
};
const formatDate = s => {
  if(!s)return 'غير محدد';
  const [y,m,d]=s.split('-').map(Number);
  return `${compactNumber(d)} ${MONTHS[m-1]} ${compactNumber(y)}`;
};
const formatTime = s => {
  if(!s)return '—';
  const [h,m]=s.split(':').map(Number);
  const h12=h%12||12;
  return `${new Intl.NumberFormat('ar-EG').format(h12)}:${new Intl.NumberFormat('ar-EG',{minimumIntegerDigits:2,useGrouping:false}).format(m)} ${h>=12?'م':'ص'}`;
};
const norm = s => String(s??'').toLowerCase().trim().normalize('NFKC').replace(/[\u064b-\u065f]/g,'').replace(/\s+/g,' ');
const currentDateYear = date => Number(date.slice(0,4));
const e = (s,msg='') => {const el=$(s);if(el)el.textContent=msg;};
function busy(on,label='جاري تحميل البيانات...') {
  state.loading=on;
  $('#loadingLabel').textContent=label;
  $('#loadingOverlay').classList.toggle('hidden',!on);
}
function toast(message,isError=false){const x=$('#toast');x.textContent=message;x.classList.toggle('error',isError);x.classList.remove('hidden');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>x.classList.add('hidden'),4300);}
function isVisible(selector){return !$(selector).classList.contains('hidden');}
function setOverlay(sel,show){$(sel).classList.toggle('hidden',!show);document.body.style.overflow=$$('.overlay:not(.hidden)').length?'hidden':'';}
function apiErrorMessage(err){return err?.message||'حصل خطأ أثناء الاتصال بالسيرفر';}
async function requestApi(path,{method='GET',body}={}){
  const headers={'Accept':'application/json'};
  if(method!=='GET')headers['Content-Type']='application/json';
  if(method!=='GET'&&path!=='/api/login'&&state.csrf)headers['X-CSRF-Token']=state.csrf;
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){
    if(response.status===401&&path!=='/api/login'){state.authenticated=false;state.csrf='';showAuth();}
    const err=new Error(data.error||'الخدمة غير متاحة الآن');err.code=data.code||'';err.status=response.status;err.conflicts=data.conflicts||[];throw err;
  }
  return data;
}
async function fetchPaged(path){
  let rows=[],offset=0;
  for(let i=0;i<100;i++){
    const result=await requestApi(`${path}?limit=250&offset=${offset}`);
    rows.push(...(result.items||[]));
    if(result.nextOffset===null||result.nextOffset===undefined)return rows;
    offset=result.nextOffset;
  }
  throw new Error('عدد السجلات تجاوز الحد المسموح في واجهة العرض. تواصل مع المسؤول.');
}
async function refresh(showBusy=true){
  if(!state.authenticated)return showAuth();
  if(showBusy)busy(true,'جاري تحديث البيانات من قاعدة الحجوزات...');
  try{
    const [rows,archive]=await Promise.all([fetchPaged('/api/bookings'),fetchPaged('/api/archive')]);
    state.rows=rows.map(r=>({...r,uid:r.id}));state.archive=archive.map(r=>({...r,uid:r.id}));
    for(const r of [...state.rows,...state.archive])if(r.date)state.futureYears.add(Number(r.date.slice(0,4)));
    render();e('#connectionTag','● متصل • قاعدة بيانات خاصة');$('#connectionTag').classList.add('online');
  }catch(err){toast(apiErrorMessage(err),true);throw err;}finally{if(showBusy)busy(false);}
}
function showAuth(){setOverlay('#authOverlay',true);$('#connectionTag').classList.remove('online');e('#connectionTag','● تسجيل الدخول مطلوب');}
function hideAuth(){setOverlay('#authOverlay',false);$('#authError').classList.add('hidden');}
async function checkAuth(){
  try{
    const result=await requestApi('/api/me');state.authenticated=true;state.csrf=result.csrf;hideAuth();await refresh();
  }catch(err){state.authenticated=false;state.csrf='';showAuth();if(err.status&&err.status!==401){e('#authError',apiErrorMessage(err));$('#authError').classList.remove('hidden');}}
}
async function login(event){
  event.preventDefault();const password=$('#passwordInput').value;
  busy(true,'جاري التحقق من كلمة المرور...');
  try{
    const result=await requestApi('/api/login',{method:'POST',body:{password}});
    state.csrf=result.csrf;state.authenticated=true;$('#passwordInput').value='';hideAuth();await refresh(false);toast('مرحبًا، تم تسجيل الدخول ✅');
  }catch(err){e('#authError',apiErrorMessage(err));$('#authError').classList.remove('hidden');}
  finally{busy(false);}
}
async function logout(){
  if(!state.authenticated)return showAuth();
  try{await requestApi('/api/logout',{method:'POST',body:{}});}catch{}
  state.authenticated=false;state.csrf='';state.rows=[];state.archive=[];render();showAuth();toast('تم تسجيل الخروج');
}
function activeRows(){return state.rows.filter(x=>x.date&&x.name);}
function yearRows(){return activeRows().filter(x=>currentDateYear(x.date)===Number(state.year));}
function accepted(r){return r.status!=='Cancelled';}
function activeInYear(){return yearRows().filter(accepted);}
function filterBookings(){
  let a=yearRows();
  if(state.month!=='all')a=a.filter(x=>Number(x.date.slice(5,7))===Number(state.month));
  if(state.todayOnly)a=a.filter(x=>x.date===dateParts().iso);
  if(state.status!=='all')a=a.filter(x=>x.status===state.status);
  if(state.search){const q=norm(state.search);a=a.filter(x=>norm([x.name,x.phone,x.address,x.brushing,x.uid,x.date].join(' ')).includes(q));}
  return a.sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)||a.name.localeCompare(b.name,'ar'));
}
function populateYears(){
  const years=[...state.futureYears].filter(x=>x>=2027&&x<=2100).sort((a,b)=>a-b);
  if(!years.includes(state.year))years.push(state.year);
  $('#yearSelect').innerHTML=years.sort((a,b)=>a-b).map(y=>`<option value="${y}" ${Number(state.year)===y?'selected':''}>${y}</option>`).join('');
  e('#metricYear',String(state.year));
}
function render(){
  populateYears();
  const today=dateParts();const valid=activeInYear();
  e('#statBookings',compactNumber(valid.length));
  e('#statDeposits',money(valid.reduce((t,x)=>t+x.deposit,0)));
  e('#statRemaining',money(valid.reduce((t,x)=>t+x.remaining,0)));
  e('#statToday',compactNumber(activeRows().filter(r=>r.date===today.iso&&accepted(r)).length));
  e('#todayLabel',`حسب توقيت القاهرة • ${formatDate(today.iso)}`);
  renderChart(valid);renderUpcoming();renderBookings();renderArchive();updateNavigation();
}
function renderChart(active){
  const monthCounts=MONTHS.map((_,i)=>active.filter(x=>Number(x.date.slice(5,7))===i+1).length);
  const max=Math.max(1,...monthCounts);
  $('#monthlyBars').innerHTML=MONTHS.map((month,i)=>{
    const h=Math.max(5,Math.round(monthCounts[i]/max*100));
    return `<button type="button" class="bar-col ${Number(state.month)===i+1?'active':''}" data-open-month="${i+1}" aria-label="حجوزات ${month}: ${monthCounts[i]}"><span class="bar-count">${compactNumber(monthCounts[i])}</span><span class="bar-track"><span class="bar-body" style="height:${h}%"></span></span><span class="bar-label">${esc(month.slice(0,3))}</span></button>`;
  }).join('');
}
function emptyMarkup(message='مفيش حجوزات مطابقة للفلاتر الحالية'){
  return `<div class="empty-state"><span class="emoji">📅</span><strong>${esc(message)}</strong><p>تقدر تضيف حجز جديد من الزرار اللي فوق.</p></div>`;
}
function renderUpcoming(){
  const today=dateParts().iso;
  const list=activeInYear().filter(x=>x.date>=today).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start)).slice(0,5);
  $('#upcomingList').innerHTML=list.length?list.map(r=>{
    const day=Number(r.date.slice(8,10)),mon=MONTHS[Number(r.date.slice(5,7))-1];
    return `<div class="upcoming-item"><div class="date-square"><strong>${compactNumber(day)}</strong><small>${esc(mon)}</small></div><div class="upcoming-info"><strong>${esc(r.name)}</strong><span>${esc(r.brushing||r.address||'حجز جديد')}</span></div><span class="small-time">${esc(formatTime(r.start))}</span></div>`;
  }).join(''):emptyMarkup('مفيش مواعيد قادمة في السنة دي');
}
function bookingMarkup(r,archived=false,grouped=false){
  const status=STATUS[r.status]||r.status||'مؤكد';
  const xtra=archived?`<small>سبب الحذف: ${esc(r.reason||'غير محدد')}</small>`:`<span class="status-chip ${esc(r.status)}">${esc(status)}</span>`;
  const label=archived?'مؤرشف':`المتبقي: ${money(r.remaining)}`;
  const actions=archived?`<div class="booking-actions"><button class="restore-button" data-restore="${esc(r.uid)}" type="button">↶ استرجاع</button></div>`:`<div class="booking-actions"><button class="action-button" data-edit="${esc(r.uid)}" type="button">✎ تعديل</button><button class="action-button delete" data-delete="${esc(r.uid)}" type="button">حذف</button></div>`;
  const when=grouped
    ? `◷ ${esc(r.start?`${formatTime(r.start)} - ${formatTime(r.end)}`:'الوقت غير محدد')}`
    : `📅 <b>${esc(formatDate(r.date))}</b><br>◷ ${esc(r.start?`${formatTime(r.start)} - ${formatTime(r.end)}`:'الوقت غير محدد')}`;
  return `<article class="booking-card"><div class="client-avatar">${esc((r.name||'?').slice(0,1))}</div><div class="booking-main"><strong>${esc(r.name)}</strong><p>${esc(r.address||'بدون عنوان')} • ${esc(r.phone||'بدون رقم')}</p>${xtra}</div><div class="booking-meta">${when}</div><div class="booking-money"><strong>${esc(money(r.deposit))}</strong><small>${esc(label)}</small></div>${actions}</article>`;
}
function renderBookings(){
  const list=filterBookings();
  e('#bookingCountLabel',`${compactNumber(list.length)} حجز في النتائج`);
  if(!list.length){$('#bookingsList').innerHTML=emptyMarkup();return;}
  const groups=new Map();
  for(const item of list){if(!groups.has(item.date))groups.set(item.date,[]);groups.get(item.date).push(item);}
  $('#bookingsList').innerHTML=[...groups].map(([date,items])=>`
    <section class="day-group" aria-label="حجوزات ${esc(formatDate(date))}">
      <div class="day-group-head"><strong>📅 ${esc(fullDay(date))}، ${esc(formatDate(date))}</strong><span>${compactNumber(items.length)} حجز</span></div>
      <div class="day-group-list">${items.map(item=>bookingMarkup(item,false,true)).join('')}</div>
    </section>
  `).join('');
}
function renderArchive(){
  const q=norm(state.archiveSearch);
  let list=state.archive.filter(r=>!q||norm([r.name,r.phone,r.id,r.date,r.reason].join(' ')).includes(q)).sort((a,b)=>String(b.deletedAt||'').localeCompare(String(a.deletedAt||'')));
  $('#archiveList').innerHTML=list.length?list.map(r=>bookingMarkup({...r,uid:r.id},true)).join(''):emptyMarkup('أرشيف الحذف فاضي');
}
function updateNavigation(){
  $$('.screen').forEach(x=>x.classList.toggle('hidden',x.id!==`screen-${state.screen}`));
  $$('[data-nav]').forEach(x=>x.classList.toggle('is-active',x.dataset.nav===state.screen));
  const titles={dashboard:['لوحة الحجوزات','كل المواعيد والأرقام المهمة في مكان واحد'],bookings:['إدارة الحجوزات','دوّر على أي حجز وعدّله أو احذفه بسهولة'],archive:['أرشيف الحذف','نسخة محفوظة من الحجوزات المحذوفة']};
  e('#pageTitle',titles[state.screen][0]);e('#pageSubtitle',titles[state.screen][1]);
  $('#monthSelect').value=state.month;
  $('#statusSelect').value=state.status;
  $('#todayFilterBtn').classList.toggle('active',state.todayOnly);
}
function navigate(screen){state.screen=screen;render();window.scrollTo({top:0,behavior:'smooth'});}
function makeId(year=state.year){return 'BKG-'+String(year)+'-'+(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g,'').slice(0,12).toUpperCase();}
function showFormError(msg){e('#formError',msg);$('#formError').classList.toggle('hidden',!msg);}
function refreshTotal(){const f=$('#bookingForm');e('#formTotal',money(nz(f.elements.deposit.value)+nz(f.elements.remaining.value)));}
function openForm(uid=null){
  if(!state.authenticated){showAuth();return;}
  const rec=uid?state.rows.find(x=>x.uid===uid):null;
  if(uid&&!rec){toast('الحجز غير موجود. حدث البيانات.',true);return;}
  state.editing=rec?{id:rec.id,version:rec.version}:null;
  const f=$('#bookingForm');f.reset();const today=dateParts();
  const initialDate=today.year===state.year?today.iso:isoDate(state.year,state.month==='all'?1:Number(state.month),1);
  const defaults=rec||{date:initialDate,name:'',phone:'',address:'',brushing:'',start:'15:00',end:'16:00',deposit:0,remaining:0,status:'Confirmed'};
  for(const key of ['name','phone','address','brushing','date','start','end','status','deposit','remaining'])f.elements[key].value=defaults[key]??'';
  e('#formTitle',rec?'تعديل حجز':'حجز جديد');e('#formEyebrow',rec?`رقم الحجز: ${rec.id}`:'إضافة موعد جديد');
  e('#saveBookingBtn',rec?'حفظ التعديلات':'حفظ الحجز');showFormError('');refreshTotal();setOverlay('#bookingOverlay',true);
}
function closeForm(){setOverlay('#bookingOverlay',false);state.editing=null;}
function formData(){const f=$('#bookingForm');return {name:f.elements.name.value.trim(),phone:f.elements.phone.value.trim(),address:f.elements.address.value.trim(),brushing:f.elements.brushing.value.trim(),date:f.elements.date.value,start:f.elements.start.value,end:f.elements.end.value,deposit:Number(f.elements.deposit.value||0),remaining:Number(f.elements.remaining.value||0),status:f.elements.status.value};}
function validateBooking(data){
  if(!data.name)return 'لازم تكتب اسم العميل.';
  if(!/^20\d\d-\d\d-\d\d$/.test(data.date))return 'اختار تاريخ صحيح.';
  const [y,m,d]=data.date.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));
  if(y<2027||y>2100||dt.toISOString().slice(0,10)!==data.date)return 'التاريخ لازم يكون من 2027 لـ 2100.';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.end)||data.start>=data.end)return 'لازم وقت نهاية صحيح بعد وقت البداية.';
  if(!Number.isFinite(data.deposit)||data.deposit<0||!Number.isFinite(data.remaining)||data.remaining<0)return 'العربون والمتبقي لازم يكونوا قيم موجبة أو صفر.';
  return '';
}
async function saveBooking(ev){
  ev.preventDefault();if(state.loading)return;
  const data=formData(),err=validateBooking(data);if(err)return showFormError(err);
  const current=state.editing;busy(true,current?'جاري حفظ التعديل...':'جاري إضافة الحجز...');
  try{
    const path=current?`/api/bookings/${encodeURIComponent(current.id)}`:'/api/bookings';
    const method=current?'PUT':'POST';
    const save=async forceConflict=>requestApi(path,{method,body:{...data,...current,forceConflict}});
    try{await save(false);}catch(err){
      if(err.code!=='OVERLAP')throw err;
      busy(false);
      const list=err.conflicts.map(x=>`${x.name} (${x.start} – ${x.end})`).join('، ');
      if(!confirm(`فيه تداخل في الموعد مع: ${list}.\nهل تحفظ الحجز رغم التعارض؟`))return;
      busy(true,'جاري تأكيد الحجز...');await save(true);
    }
    closeForm();state.year=Number(data.date.slice(0,4));state.futureYears.add(state.year);state.month='all';state.todayOnly=false;
    await refresh(false);toast(current?'تم تعديل الحجز ✅':'تمت إضافة الحجز ✅');
  }catch(err){showFormError(apiErrorMessage(err));toast('الحجز لم يُحفظ',true);}finally{busy(false);}
}
function requestDelete(uid){
  const row=state.rows.find(x=>x.uid===uid);if(!row)return toast('الحجز غير موجود',true);
  state.deleting={id:row.id,version:row.version};
  e('#deleteDesc',`الحجز باسم «${row.name}» بتاريخ ${formatDate(row.date)} وعربونه ${money(row.deposit)}. هل متأكد من الحذف؟`);
  $('#deleteReason').value='';setOverlay('#deleteOverlay',true);
}
async function confirmDelete(){
  const current=state.deleting;if(!current||state.loading)return;
  busy(true,'جاري أرشفة الحجز وحذفه...');
  try{
    await requestApi(`/api/bookings/${encodeURIComponent(current.id)}`,{method:'DELETE',body:{version:current.version,reason:$('#deleteReason').value.trim()}});
    setOverlay('#deleteOverlay',false);state.deleting=null;await refresh(false);toast('تم الحذف، والحجز محفوظ في الأرشيف ✅');
  }catch(err){toast(apiErrorMessage(err),true);}finally{busy(false);}
}
async function restoreBooking(uid){
  const rec=state.archive.find(x=>x.id===uid);if(!rec)return;
  if(!confirm(`تسترجع حجز «${rec.name}» بتاريخ ${formatDate(rec.date)}؟`))return;
  busy(true,'جاري استرجاع الحجز...');
  try{
    const restore=async forceConflict=>requestApi(`/api/archive/${encodeURIComponent(uid)}/restore`,{method:'POST',body:{forceConflict}});
    try{await restore(false);}catch(err){
      if(err.code!=='OVERLAP')throw err;
      busy(false);
      if(!confirm(`فيه حجز متداخل في نفس الموعد. هل تسترجعه رغم التعارض؟`))return;
      busy(true,'جاري الاسترجاع...');await restore(true);
    }
    await refresh(false);toast('تم استرجاع الحجز ✅');
  }catch(err){toast(apiErrorMessage(err),true);}finally{busy(false);}
}
function addYear(){
  if(!state.authenticated)return showAuth();
  const answer=prompt('اكتب السنة الجديدة (2027 إلى 2100):',String(state.year+1));if(answer===null)return;
  const year=Number(answer);if(!Number.isInteger(year)||year<2027||year>2100)return toast('السنة لازم تكون من 2027 إلى 2100',true);
  state.year=year;state.futureYears.add(year);state.month='all';state.todayOnly=false;render();toast(`تم فتح سنة ${year} ✅`);
}
function openImport(){if(!state.authenticated)return showAuth();state.importObject=null;$('#importFile').value='';e('#importPreview','');e('#importError','');$('#importError').classList.add('hidden');$('#confirmImport').disabled=true;setOverlay('#importOverlay',true);}
function closeImport(){setOverlay('#importOverlay',false);state.importObject=null;}
async function chooseImport(e){
  const file=e.target.files?.[0];state.importObject=null;$('#confirmImport').disabled=true;
  if(!file)return;if(file.size>650000){eMessage('الملف أكبر من الحد المسموح');return;}
  try{
    const data=JSON.parse(await file.text());
    if(!Array.isArray(data.bookings)||!Array.isArray(data.archive))throw Error('الملف لازم يحتوي على bookings و archive');
    const checked=await requestApi('/api/import',{method:'POST',body:{bookings:data.bookings,archive:data.archive,dryRun:true}});
    state.importObject={bookings:data.bookings,archive:data.archive};
    eTextImport(`تم فحص الملف: ${checked.verified.bookings} حجوزات نشطة، ${checked.verified.archive} مؤرشفة. اضغط تأكيد لاستيرادها.`);
    $('#confirmImport').disabled=false;
  }catch(err){eMessage(apiErrorMessage(err));}
}
function eTextImport(msg){e('#importPreview',msg);}
function eMessage(msg){e('#importError',msg);$('#importError').classList.remove('hidden');}
async function confirmImport(){
  if(!state.importObject||state.loading)return;
  const obj=state.importObject;
  if(!confirm(`تأكيد استيراد ${obj.bookings.length} حجز نشط و${obj.archive.length} محذوف؟\nالبيانات الموجودة لا تتكرر لو رقم الحجز متطابق.`))return;
  busy(true,'جاري استيراد البيانات القديمة إلى قاعدة D1...');
  try{const result=await requestApi('/api/import',{method:'POST',body:obj});closeImport();await refresh(false);toast(`تم الاستيراد: ${result.inserted} جديد، ${result.skipped} متكرر`);}catch(err){eMessage(apiErrorMessage(err));}finally{busy(false);}
}
function init(){
  $('#monthSelect').innerHTML='<option value="all">كل الشهور</option>'+MONTHS.map((m,i)=>`<option value="${i+1}">${esc(m)}</option>`).join('');
  document.addEventListener('click',ev=>{
    const nav=ev.target.closest('[data-nav]');if(nav){navigate(nav.dataset.nav);return;}
    const add=ev.target.closest('[data-new-booking]');if(add){openForm();return;}
    const edit=ev.target.closest('[data-edit]');if(edit){openForm(edit.dataset.edit);return;}
    const del=ev.target.closest('[data-delete]');if(del){requestDelete(del.dataset.delete);return;}
    const restore=ev.target.closest('[data-restore]');if(restore){restoreBooking(restore.dataset.restore);return;}
    const month=ev.target.closest('[data-open-month]');if(month){state.month=month.dataset.openMonth;state.todayOnly=false;navigate('bookings');return;}
    if(ev.target.closest('[data-close-form]'))closeForm();
  });
  $('#loginForm').addEventListener('submit',login);
  $('#logoutBtn').addEventListener('click',logout);$('#mobileSettings').addEventListener('click',logout);
  $('#refreshBtn').addEventListener('click',()=>refresh().catch(()=>{}));
  $('#yearSelect').addEventListener('change',ev=>{state.year=Number(ev.target.value);state.month='all';state.todayOnly=false;render();});
  $('#addYearBtn').addEventListener('click',addYear);
  $('#searchInput').addEventListener('input',ev=>{state.search=ev.target.value;renderBookings();});
  $('#archiveSearchInput').addEventListener('input',ev=>{state.archiveSearch=ev.target.value;renderArchive();});
  $('#monthSelect').addEventListener('change',ev=>{state.month=ev.target.value;state.todayOnly=false;render();});
  $('#statusSelect').addEventListener('change',ev=>{state.status=ev.target.value;renderBookings();});
  $('#todayFilterBtn').addEventListener('click',()=>{state.todayOnly=!state.todayOnly;state.month='all';if(state.todayOnly)state.year=dateParts().year;render();});
  $('#bookingForm').addEventListener('submit',saveBooking);
  ['deposit','remaining'].forEach(key=>$('#bookingForm').elements[key].addEventListener('input',refreshTotal));
  $('#confirmDelete').addEventListener('click',confirmDelete);
  $('#cancelDelete').addEventListener('click',()=>{setOverlay('#deleteOverlay',false);state.deleting=null;});
  $('#importDataBtn').addEventListener('click',openImport);$('#importFile').addEventListener('change',chooseImport);
  $('#closeImport').addEventListener('click',closeImport);$('#cancelImport').addEventListener('click',closeImport);$('#confirmImport').addEventListener('click',confirmImport);
  render();checkAuth().catch(()=>showAuth());
}
window.addEventListener('DOMContentLoaded',init);
