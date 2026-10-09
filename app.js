/* Genius Bookings — GitHub Pages + Google Sheets API (OAuth in browser).
 * No password, access token, service account or API secret is shipped/stored in this repository.
 * Source spreadsheet's calculated columns B, K and M are deliberately NEVER overwritten.
 */
'use strict';
const CONFIG = Object.freeze({
  spreadsheetId: '1ZVGDrmLEKyOnlal0VNevhcrfa6Yec126b_s3nvjreqk',
  allowedEmail: 'bodeyamal@gmail.com', // UI account check; only Google Sheets sharing permissions enforce access.
  maxBookingRow: 1000,
  maxArchiveRow: 1100,
  scopes: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',
  timezone: 'Africa/Cairo'
});
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const STATUS = {Confirmed:'مؤكد',Pending:'قيد التأكيد',Completed:'مكتمل',Cancelled:'ملغي'};
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const state = {
  token: '', email:'', clientId: (() => { try { return localStorage.getItem('genius_client_id') || ''; } catch { return ''; } })(),
  demo:false, loading:false, rows:[], archive:[], year:2027, month:'all',
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
function apiErrorMessage(err){let m=err?.message||String(err);if(/403/.test(m))return 'مافيش صلاحية للشيت، أو Google Sheets API مش مفعلة على Google Cloud. راجع حساب Genius والإعدادات. ('+m+')';if(/401/.test(m))return 'جلسة Google انتهت. سجل الدخول من جديد.';return m;}
async function requestApi(path,options={}){
  if(!state.token)throw new Error('سجّل دخول Google الأول');
  const base='https://sheets.googleapis.com/v4/spreadsheets/'+CONFIG.spreadsheetId;
  const resp=await fetch(base+path,{method:options.method||'GET',headers:{Authorization:'Bearer '+state.token,...(options.body?{'Content-Type':'application/json'}:{})},body:options.body?JSON.stringify(options.body):undefined,cache:'no-store'});
  const body=await resp.json().catch(()=>({}));
  if(!resp.ok){if(resp.status===401){state.token='';$('#connectionTag').classList.remove('online');}throw new Error(`${resp.status}: ${body.error?.message || resp.statusText}`);}
  return body;
}
function prepareRecord(data,rowNum){
  const row=Array.from({length:15},(_,i)=>data?.[i]??'');
  const date=fromSerial(row[0]);
  const id=String(row[13]||'');
  return {rowNum,raw:row,id,uid:id||`legacy-row-${rowNum}`,date,day:String(row[1]||''),name:String(row[2]||''),address:String(row[3]||''),phone:String(row[4]||''),brushing:String(row[5]||''),start:fractionToTime(row[6]),end:fractionToTime(row[7]),deposit:nz(row[8]),status:String(row[9]||'Confirmed'),conflict:String(row[10]||''),remaining:nz(row[11]),total:nz(row[12])||nz(row[8])+nz(row[11]),lastEdited:row[14]};
}
function getValueRanges(urls){const p=new URLSearchParams();urls.forEach(x=>p.append('ranges',x));p.set('valueRenderOption','UNFORMATTED_VALUE');p.set('dateTimeRenderOption','SERIAL_NUMBER');return `?${p}`;}
async function fetchFresh(){
  const ranges=['Bookings!A1:O1000',"'Deleted Bookings'!A1:R1100",'Dashboard!B2'];
  const result=await requestApi('/values:batchGet'+getValueRanges(ranges));
  const a=result.valueRanges?.[0]?.values||[];
  const d=result.valueRanges?.[1]?.values||[];
  const selected=Number(result.valueRanges?.[2]?.values?.[0]?.[0]);
  const rows=Array.from({length:CONFIG.maxBookingRow-1},(_,i)=>prepareRecord(a[i+1]||[],i+2));
  const archive=d.slice(1).map((values,i)=>({rowNum:i+2,raw:values,id:String(values[13]||''),name:String(values[2]||''),date:fromSerial(values[0]),phone:String(values[4]||''),deposit:nz(values[8]),remaining:nz(values[11]),deletedAt:values[15],reason:String(values[16]||'')})).filter(x=>x.name||x.id);
  return {rows,archive,selected};
}
async function refresh(showBusy=true){
  if(state.demo){render();return;}
  if(!state.token)return;
  if(showBusy)busy(true,'جاري تحديث الحجوزات من Google Sheets...');
  try{
    const data=await fetchFresh();state.rows=data.rows;state.archive=data.archive;
    if(data.selected>=2027&&data.selected<=2100&&!state.initialYearLoaded){state.year=data.selected;state.initialYearLoaded=true;}
    for(const record of state.rows){if(record.date)state.futureYears.add(currentDateYear(record.date));}
    if(data.selected)state.futureYears.add(data.selected);
    render();
    e('#connectionTag','● متصل بـ Genius');$('#connectionTag').classList.add('online');
  }catch(err){toast(apiErrorMessage(err),true);throw err;}finally{if(showBusy)busy(false);}
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
  const actions=archived?'':`<div class="booking-actions"><button class="action-button" data-edit="${esc(r.uid)}" type="button">✎ تعديل</button><button class="action-button delete" data-delete="${esc(r.uid)}" type="button">حذف</button></div>`;
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
  let list=state.archive.filter(r=>!q||norm([r.name,r.phone,r.id,r.date,r.reason].join(' ')).includes(q)).sort((a,b)=>b.rowNum-a.rowNum);
  $('#archiveList').innerHTML=list.length?list.map(r=>bookingMarkup({...r,uid:r.id,status:'Cancelled',start:fractionToTime(r.raw[6]),end:fractionToTime(r.raw[7])},true)).join(''):emptyMarkup('أرشيف الحذف فاضي');
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
  if(!state.demo&&!state.token){showAuth();return;}
  const rec=uid?state.rows.find(x=>x.uid===uid):null;
  if(uid&&!rec){toast('الحجز المطلوب مش موجود. حدّث البيانات.',true);return;}
  state.editing=rec?{uid:rec.uid,snapshot:fingerprint(rec)}:null;
  const form=$('#bookingForm');form.reset();
  const today=dateParts();
  const defaults=rec?rec:{date:currentDateYear(today.iso)===state.year?today.iso:isoDate(state.year,state.month==='all'?1:Number(state.month),1),name:'',phone:'',address:'',brushing:'',start:'15:00',end:'16:00',deposit:0,remaining:0,status:'Confirmed'};
  for(const key of ['name','phone','address','brushing','date','start','end','status','deposit','remaining']) form.elements[key].value=defaults[key]??'';
  e('#formTitle',rec?'تعديل الحجز':'إضافة حجز جديد');e('#formEyebrow',rec?`رقم الحجز: ${rec.id||`صف ${rec.rowNum}`}`:'حجز جديد');e('#saveBookingBtn',rec?'حفظ التعديلات':'حفظ الحجز');showFormError('');refreshTotal();setOverlay('#bookingOverlay',true);
  setTimeout(()=>form.elements.name.focus({preventScroll:true}),100);
}
function closeForm(){setOverlay('#bookingOverlay',false);state.editing=null;}
function formData(){const f=$('#bookingForm');return {date:f.elements.date.value,name:f.elements.name.value.trim(),phone:f.elements.phone.value.trim(),address:f.elements.address.value.trim(),brushing:f.elements.brushing.value.trim(),start:f.elements.start.value,end:f.elements.end.value,deposit:Number(f.elements.deposit.value||0),remaining:Number(f.elements.remaining.value||0),status:f.elements.status.value};}
function validateBooking(data){
  if(!data.name)return 'اكتب اسم العميل.';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date))return 'اختار تاريخ صحيح.';
  const [y,m,d]=data.date.split('-').map(Number);
  if(y<2027||y>2100)return 'السنة لازم تكون بين 2027 و2100.';
  const parsed=new Date(Date.UTC(y,m-1,d));
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==data.date)return 'التاريخ مش صحيح.';
  if(!/^\d{2}:\d{2}$/.test(data.start)||!/^\d{2}:\d{2}$/.test(data.end))return 'حدد وقت البداية والنهاية.';
  for(const hhmm of [data.start,data.end]){
    const [h,mn]=hhmm.split(':').map(Number);
    if(h>23||mn>59)return 'وقت غير صحيح.';
  }
  if(data.end<=data.start)return 'نهاية الحجز لازم تكون بعد بدايته في نفس اليوم.';
  if(!Number.isFinite(data.deposit)||data.deposit<0||!Number.isFinite(data.remaining)||data.remaining<0)return 'العربون والمتبقي لازم يكونوا أرقام غير سالبة.';
  if(!STATUS[data.status])return 'حالة الحجز غير صحيحة.';
  return '';
}
function fingerprint(r){return JSON.stringify([r.date,r.name,r.address,r.phone,r.brushing,r.start,r.end,r.deposit,r.remaining,r.status,r.id,r.lastEdited]);}
const dataRowsToWrite=(rowNum,data,id)=>[
  {range:`Bookings!A${rowNum}`,values:[[dateToSerial(data.date)]]},
  {range:`Bookings!C${rowNum}:J${rowNum}`,values:[[data.name,data.address,data.phone,data.brushing,timeFraction(data.start),timeFraction(data.end),data.deposit,data.status]]},
  {range:`Bookings!L${rowNum}`,values:[[data.remaining]]},
  {range:`Bookings!N${rowNum}:O${rowNum}`,values:[[id,epochToSerial(new Date())]]}
];
async function writeRanges(data){return requestApi('/values:batchUpdate',{method:'POST',body:{valueInputOption:'RAW',data}});}
function findFreeBookingRow(rows){const r=rows.find(x=>!x.date&&!x.name&&!x.id);return r?.rowNum||null;}
function collisions(data,rows,uid){
  if(data.status==='Cancelled')return [];
  return rows.filter(r=>r.date===data.date&&r.name&&r.uid!==uid&&r.status!=='Cancelled'&&r.start&&r.end&&data.start<r.end&&data.end>r.start);
}
async function handleSave(ev){
  ev.preventDefault();if(state.loading)return;
  const data=formData(),error=validateBooking(data);
  if(error){showFormError(error);return;}
  showFormError('');
  const previous=state.editing;
  if(state.demo){
    if(previous){const r=state.rows.find(r=>r.uid===previous.uid);if(!r)return;Object.assign(r,data,{total:data.deposit+data.remaining,lastEdited:epochToSerial(new Date())});}
    else{const next=findFreeBookingRow(state.rows)||state.rows.length+2;state.rows.push(prepareRecord([],next));const uid=makeId(currentDateYear(data.date));Object.assign(state.rows[state.rows.length-1],data,{id:uid,uid,rowNum:next,total:data.deposit+data.remaining});}
    state.futureYears.add(currentDateYear(data.date));state.year=currentDateYear(data.date);closeForm();render();toast('تم الحفظ في المعاينة فقط، مش في Google Sheets.');return;
  }
  busy(true,previous?'جاري تعديل الحجز...':'جاري إضافة الحجز...');
  try{
    const fresh=await fetchFresh();
    let rowNum,id,uid=previous?.uid||'';
    if(previous){
      const existing=fresh.rows.find(x=>x.uid===previous.uid);
      if(!existing)throw new Error('الحجز مش موجود دلوقتي. حدّث الصفحة.');
      if(fingerprint(existing)!==previous.snapshot)throw new Error('البيانات اتغيرت من مكان تاني. حدّث الحجوزات وافتح الحجز تاني.');
      rowNum=existing.rowNum;id=existing.id||makeId(currentDateYear(data.date));
    }else{
      rowNum=findFreeBookingRow(fresh.rows);
      if(!rowNum)throw new Error('صفحة Bookings وصلت للحد الحالي (999 حجز). محتاج توسيع المعادلات والصفوف قبل الإضافة.');
      id=makeId(currentDateYear(data.date));
    }
    const conflicts=collisions(data,fresh.rows,uid);
    if(conflicts.length){
      busy(false);
      const names=conflicts.slice(0,3).map(x=>`${x.name} (${formatTime(x.start)} - ${formatTime(x.end)})`).join('، ');
      if(!confirm(`فيه تضارب في نفس اليوم مع: ${names}.\nهل متأكد إنك عايز تحفظ رغم التعارض؟`))return;
      busy(true,'جاري حفظ الحجز...');
    }
    await writeRanges(dataRowsToWrite(rowNum,data,id));
    closeForm();state.year=currentDateYear(data.date);state.futureYears.add(state.year);state.todayOnly=false;state.month='all';
    await refresh(false);toast(previous?'تم تعديل الحجز بنجاح ✅':'تم تسجيل الحجز بنجاح ✅');
  }catch(err){showFormError(apiErrorMessage(err));toast('تعذر حفظ الحجز',true);}finally{busy(false);}
}
function requestDelete(uid){
  const rec=state.rows.find(r=>r.uid===uid);
  if(!rec)return toast('الحجز غير موجود',true);
  state.deleting={uid,snapshot:fingerprint(rec)};
  e('#deleteDesc',`الحجز باسم «${rec.name}» بتاريخ ${formatDate(rec.date)}، وعربونه ${money(rec.deposit)}. هل متأكد من الحذف؟`);
  $('#deleteReason').value='';setOverlay('#deleteOverlay',true);
}
async function confirmDelete(){
  if(!state.deleting||state.loading)return;
  const target=state.deleting,reason=$('#deleteReason').value.trim();
  if(state.demo){const rec=state.rows.find(r=>r.uid===target.uid);if(rec){state.archive.push({...rec,raw:rec.raw,reason,deletedAt:epochToSerial(new Date())});state.rows=state.rows.filter(r=>r.uid!==target.uid);}setOverlay('#deleteOverlay',false);state.deleting=null;render();toast('تم نقل الحجز إلى الأرشيف التجريبي.');return;}
  busy(true,'جاري حفظ نسخة في الأرشيف قبل الحذف...');
  try{
    const fresh=await fetchFresh(),rec=fresh.rows.find(r=>r.uid===target.uid);
    if(!rec)throw new Error('الحجز اتحذف أو اتحرك بالفعل. حدّث الصفحة.');
    if(fingerprint(rec)!==target.snapshot)throw new Error('الحجز اتغير من مكان تاني. لازم تعيد تحديده عشان ما يتحذفش بالغلط.');
    const id=rec.id||makeId();
    const already=fresh.archive.some(r=>r.id===id);
    if(!already){
      const used=new Set(fresh.archive.map(x=>x.rowNum));
      let ar=2;while(used.has(ar)&&ar<=CONFIG.maxArchiveRow)ar++;
      if(ar>CONFIG.maxArchiveRow)throw new Error('أرشيف الحذف ممتلئ. محتاج توسيع صفحة Deleted Bookings قبل الحذف.');
      const backup=rec.raw.slice(0,15);backup[13]=id;
      const payload=[...backup,epochToSerial(new Date()),reason,''];
      await writeRanges([{range:`'Deleted Bookings'!A${ar}:R${ar}`,values:[payload]}]);
    }
    // Preserve computed array formulas at B2, K2, M2, and formatting + dropdowns.
    await requestApi('/values:batchClear',{method:'POST',body:{ranges:[`Bookings!A${rec.rowNum}`,`Bookings!C${rec.rowNum}:J${rec.rowNum}`,`Bookings!L${rec.rowNum}`,`Bookings!N${rec.rowNum}:O${rec.rowNum}`]}});
    setOverlay('#deleteOverlay',false);state.deleting=null;await refresh(false);
    toast('تم حذف الحجز من المواعيد وحفظه في الأرشيف ✅');
  }catch(err){toast(apiErrorMessage(err),true);}finally{busy(false);}
}
async function addYear(){
  if(!state.demo&&!state.token){showAuth();return;}
  const current=state.year;
  const entered=prompt('اكتب السنة اللي عايز تبدأها (من 2027 إلى 2100):',String(current+1));
  if(entered===null)return;
  const year=Number(entered.trim());if(!Number.isInteger(year)||year<2027||year>2100){toast('السنة لازم تكون من 2027 إلى 2100',true);return;}
  if(!state.demo){
    busy(true,'جاري تحديث السنة في الشيت...');
    try{await writeRanges([{range:'Dashboard!B2',values:[[year]]}]);}
    catch(err){toast(apiErrorMessage(err),true);busy(false);return;}
    busy(false);
  }
  state.futureYears.add(year);state.year=year;state.month='all';state.todayOnly=false;render();
  toast(`سنة ${year} جاهزة. حجوزات السنين القديمة محفوظة. ✅`);
}
async function selectedYearChanged(value){
  state.year=Number(value);state.month='all';state.todayOnly=false;render();
  if(state.token&&!state.demo){
    try{await writeRanges([{range:'Dashboard!B2',values:[[state.year]]}]);}
    catch(err){toast('التغيير ظهر في الموقع لكن تعذر تحديث السنة في الشيت: '+apiErrorMessage(err),true);}
  }
}
function showSetup(){$('#clientIdInput').value=state.clientId;setOverlay('#authOverlay',false);setOverlay('#setupOverlay',true);}
function showAuth(){if(state.demo)return;setOverlay('#setupOverlay',false);setOverlay('#authOverlay',true);}
function login(){
  if(!state.clientId){showSetup();return;}
  if(!window.google?.accounts?.oauth2){toast('مكتبة Google لسه ما اتحملتش. افتح الموقع من Chrome أو Safari.',true);return;}
  const client=google.accounts.oauth2.initTokenClient({client_id:state.clientId,scope:CONFIG.scopes,callback:async response=>{
    if(response.error||!response.access_token){toast('لم يكتمل تسجيل الدخول: '+(response.error||'لا يوجد رمز دخول'),true);return;}
    busy(true,'جاري التحقق من حساب Google...');
    try{
      const p=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+response.access_token}});
      if(!p.ok)throw new Error('تعذر التحقق من حساب Google');
      const profile=await p.json();
      if(CONFIG.allowedEmail && norm(profile.email)!==norm(CONFIG.allowedEmail)){google.accounts.oauth2.revoke(response.access_token,()=>{});throw new Error('حساب Google ده مش مسموح في إعدادات التطبيق');}
      state.token=response.access_token;state.email=profile.email;state.demo=false;state.initialYearLoaded=false;
      setOverlay('#authOverlay',false);setOverlay('#setupOverlay',false);$('#demoNotice').classList.add('hidden');
      await refresh(false);toast('اتصلنا بجوجل شيت بنجاح ✅');
    }catch(err){state.token='';showAuth();toast(apiErrorMessage(err),true);}finally{busy(false);}
  }});
  client.requestAccessToken({prompt:'select_account'});
}
function saveClient(){
  const value=$('#clientIdInput').value.trim();
  if(!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)){toast('اكتب OAuth Client ID صحيح بينتهي بـ .apps.googleusercontent.com',true);return;}
  try { localStorage.setItem('genius_client_id',value); } catch {} state.clientId=value;setOverlay('#setupOverlay',false);showAuth();toast('تم حفظ Client ID على الجهاز ده.');
}
function demoSeed(){
  state.demo=true;state.token='';state.initialYearLoaded=true;state.year=2027;
  const sample=[{date:'2027-01-01',name:'عميلة تجريبية ١',address:'القاهرة',phone:'01000000000',brushing:'تسريحة',start:'15:00',end:'16:00',deposit:500,remaining:1500,status:'Confirmed'},{date:'2027-01-01',name:'عميلة تجريبية ٢',address:'المعادي',phone:'01000000001',brushing:'مكياج',start:'17:00',end:'19:00',deposit:750,remaining:1800,status:'Confirmed'},{date:'2027-02-10',name:'عميلة تجريبية ٣',address:'حلوان',phone:'01000000002',brushing:'Brushing',start:'12:00',end:'14:00',deposit:900,remaining:2100,status:'Pending'}];
  state.rows=sample.map((r,i)=>({...prepareRecord([],i+2),...r,id:`DEMO-${i}`,uid:`DEMO-${i}`,total:r.deposit+r.remaining}));state.archive=[];
  setOverlay('#setupOverlay',false);setOverlay('#authOverlay',false);$('#demoNotice').classList.remove('hidden');e('#connectionTag','● معاينة');$('#connectionTag').classList.remove('online');render();toast('دي معاينة فقط. أي بيانات هنا مش هتتحفظ في الشيت.');
}
function init(){
  $('#monthSelect').innerHTML='<option value="all">كل الشهور</option>'+MONTHS.map((s,i)=>`<option value="${i+1}">${esc(s)}</option>`).join('');
  document.addEventListener('click',event=>{
    const n=event.target.closest('[data-nav]');if(n){navigate(n.dataset.nav);return;}
    const a=event.target.closest('[data-new-booking]');if(a){openForm();return;}
    const edit=event.target.closest('[data-edit]');if(edit){openForm(edit.dataset.edit);return;}
    const del=event.target.closest('[data-delete]');if(del){requestDelete(del.dataset.delete);return;}
    const m=event.target.closest('[data-open-month]');if(m){state.month=m.dataset.openMonth;state.todayOnly=false;navigate('bookings');return;}
    if(event.target.closest('[data-close-form]')){closeForm();return;}
  });
  $('#openSettings').addEventListener('click',showSetup);$('#mobileSettings').addEventListener('click',showSetup);
  $('#refreshBtn').addEventListener('click',()=>{if(state.demo)return toast('المعاينة مش متصلة بجوجل');if(!state.token)return showAuth();refresh().catch(()=>{});});
  $('#yearSelect').addEventListener('change',x=>selectedYearChanged(x.target.value));$('#addYearBtn').addEventListener('click',addYear);
  $('#searchInput').addEventListener('input',x=>{state.search=x.target.value;renderBookings();});
  $('#archiveSearchInput').addEventListener('input',x=>{state.archiveSearch=x.target.value;renderArchive();});
  $('#monthSelect').addEventListener('change',x=>{state.month=x.target.value;state.todayOnly=false;render();});
  $('#statusSelect').addEventListener('change',x=>{state.status=x.target.value;renderBookings();});
  $('#todayFilterBtn').addEventListener('click',()=>{state.todayOnly=!state.todayOnly;state.month='all';if(state.todayOnly)state.year=dateParts().year;render();});
  $('#bookingForm').addEventListener('submit',handleSave);
  ['deposit','remaining'].forEach(x=>$('#bookingForm').elements[x].addEventListener('input',refreshTotal));
  $('#confirmDelete').addEventListener('click',confirmDelete);
  $('#cancelDelete').addEventListener('click',()=>{setOverlay('#deleteOverlay',false);state.deleting=null;});
  $('#setupClose').addEventListener('click',()=>{setOverlay('#setupOverlay',false);if(!state.token&&!state.demo)showAuth();});
  $('#saveClientId').addEventListener('click',saveClient);$('#showDemo').addEventListener('click',demoSeed);
  $('#googleLogin').addEventListener('click',login);$('#authChangeSettings').addEventListener('click',showSetup);
  $('#exitDemo').addEventListener('click',()=>{state.demo=false;state.rows=[];state.archive=[];render();state.clientId?showAuth():showSetup();});
  render();
  if(!state.clientId)showSetup();else showAuth();
}
window.addEventListener('DOMContentLoaded',init);