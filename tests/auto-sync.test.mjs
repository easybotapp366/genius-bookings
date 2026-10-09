import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInContext, createContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root,'public/app.js'),'utf8');

function device(){
  let serverRevision=1, modal=false, records=[], hidden=false;
  const calls=[];
  const element={textContent:'',title:'',classList:{add(){},remove(){},toggle(){} }};
  const document={
    querySelector(selector){return selector==='.overlay:not(.hidden)'?(modal?element:null):element;},
    querySelectorAll(selector){return selector==='.overlay:not(.hidden)'?(modal?[element]:[]):[];},
    get visibilityState(){return hidden?'hidden':'visible';},
    addEventListener(){}
  };
  const ctx=createContext({
    document,
    window:{addEventListener(){},setInterval(){return 123;}},
    setTimeout(){return 1;},clearTimeout(){},
    console,Intl,Date,URL,Map,Set,
    fetch:async path=>{
      calls.push(path);
      if(path==='/api/revision')return {ok:true,status:200,json:async()=>({revision:serverRevision})};
      if(path.startsWith('/api/bookings?'))return {ok:true,status:200,json:async()=>({items:records,nextOffset:null})};
      if(path.startsWith('/api/archive?'))return {ok:true,status:200,json:async()=>({items:[],nextOffset:null})};
      throw new Error('Unexpected request: '+path);
    }
  });
  runInContext(source,ctx,{filename:'public/app.js'});
  runInContext('state.authenticated=true;state.revision=1;render=()=>{globalThis.renderCount=(globalThis.renderCount||0)+1};toast=()=>{};',ctx);
  return {
    calls,
    tick:()=>runInContext('checkForUpdates()',ctx),
    revision:n=>{serverRevision=n;},
    records:r=>{records=r;},
    modal:value=>{modal=value;},
    hide:value=>{hidden=value;},
    loading:value=>runInContext('state.loading='+String(value),ctx),
    currentRevision:()=>runInContext('state.revision',ctx),
    currentRows:()=>runInContext('state.rows.length',ctx),
    renderCount:()=>runInContext('globalThis.renderCount||0',ctx)
  };
}

test('auto sync checks small revision first and does not reload unchanged data',async()=>{
  const d=device();
  await d.tick();
  assert.deepEqual(d.calls,['/api/revision']);
  assert.equal(d.renderCount(),0);
});

test('another phone creates a booking: current phone reloads and displays it on next tick',async()=>{
  const d=device();
  d.records([{id:'from-other-phone',date:'2027-01-05',name:'مريم',start:'15:00',end:'16:00',status:'Confirmed',deposit:1000,remaining:2500}]);
  d.revision(2);
  await d.tick();
  assert.equal(d.currentRevision(),2);
  assert.equal(d.currentRows(),1);
  assert.equal(d.renderCount(),1);
  assert.deepEqual(d.calls,['/api/revision','/api/revision','/api/bookings?limit=250&offset=0','/api/archive?limit=250&offset=0']);
  await d.tick();
  assert.equal(d.renderCount(),1);
});

test('background refresh skips a hidden page, active modal, and in-progress form',async()=>{
  const d=device();
  d.revision(5);
  d.hide(true);
  await d.tick();
  assert.equal(d.calls.length,0);
  d.hide(false);
  d.modal(true);
  await d.tick();
  assert.equal(d.calls.length,0);
  d.modal(false);
  d.loading(true);
  await d.tick();
  assert.equal(d.calls.length,0);
  d.loading(false);
  await d.tick();
  assert.equal(d.currentRevision(),5);
});

test('client starts periodic poll and catches up on focus, visibility change, and reconnect',()=>{
  assert.match(source,/AUTO_SYNC_INTERVAL_MS=10000/);
  assert.match(source,/setInterval\(\(\)=>\{checkForUpdates\(\)/);
  assert.match(source,/visibilitychange/);
  assert.match(source,/addEventListener\('focus'/);
  assert.match(source,/addEventListener\('online'/);
  assert.match(source,/background&&\(state\.loading\|\|document\.visibilityState==='hidden'\|\|modalOpen\(\)\)/);
});
