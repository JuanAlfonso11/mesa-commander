const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {webcrypto}=require('node:crypto');
const MC=require('../src/core.js');
const card=name=>({name,type_line:'Creature',mana_cost:'{1}',color_identity:[],legalities:{commander:'legal'},power:'1',toughness:'1'});
const deck=name=>({commander:{...card(name+' commander'),type_line:'Legendary Creature'},cards:Array.from({length:99},(_,i)=>card(name+' '+i))});
// Entorno simulado con relojes y almacenamiento controlables.
function env(){
 let t=1700000000000;const timers=[];const intervals=[];const storage=new Map();
 const localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 const ctx={MC,MD:{uid:()=>webcrypto.randomUUID()},crypto:webcrypto,console,localStorage,sessionStorage:localStorage,
  Date:class extends Date{static now(){return t;}},
  setTimeout:(fn,ms)=>{timers.push({fn,at:t+(ms||0)});return timers.length;},clearTimeout:()=>{},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},clearInterval:()=>{}};
 ctx.advance=ms=>{t+=ms;for(const iv of intervals)iv.fn();let again=true;while(again){again=false;for(const x of timers.splice(0))if(x.at<=t){x.fn();again=true;}else timers.push(x);}};
 return ctx;
}
function load(ctx,peers){
 class Conn extends EventEmitter{constructor(id,remote){super();this.peer=id;this.open=false;this.sent=[];this.remote=remote;}send(x){this.sent.push(JSON.parse(JSON.stringify(x)));if(this.remote&&JSON.stringify(x).length>16000)return;// WebRTC real descarta mensajes grandes
  if(this.remote)this.remote.emit('data',JSON.parse(JSON.stringify(x)));}close(){if(!this.open)return;this.open=false;this.emit('close');if(this.remote&&this.remote.open){this.remote.open=false;this.remote.emit('close');}}latest(type){return this.sent.filter(x=>x.type===type).at(-1);}}
 class Peer extends EventEmitter{constructor(id,opts){super();if(id&&typeof id==='object'){opts=id;id=undefined;}this.opts=opts;this.id=id||'anon-'+Math.random();this.open=true;this.destroyed=false;peers.list.push(this);queueMicrotask(()=>this.emit('open',this.id));}
  connect(target){const host=peers.list.find(p=>p.id===target&&!p.destroyed);const mine=new Conn(target,null);(peers.conns||(peers.conns=[])).push(mine);if(!host){queueMicrotask(()=>this.emit('error',{type:'peer-unavailable'}));return mine;}const theirs=new Conn(this.id,mine);mine.remote=theirs;queueMicrotask(()=>{mine.open=theirs.open=true;host.emit('connection',theirs);mine.emit('open');});return mine;}
  destroy(){this.destroyed=true;this.open=false;}reconnect(){}}
 ctx.Peer=Peer;vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../src/network.js'),'utf8'),ctx);return ctx.MN;
}
const tick=()=>new Promise(r=>setImmediate(r));
async function pair(){
 const peers={list:[]};
 const hostCtx=env(),guestCtx=env();const H=load(hostCtx,peers),G=load(guestCtx,peers);
 const he={states:[]},ge={states:[],status:[],welcome:[],errors:[],disconnected:[]};
 await H.create({players:[{id:'p1',name:'Host',deck:deck('H')},{id:'p2',name:'Bot',bot:true,deck:deck('B')}]},{state:s=>he.states.push(s),roster:()=>{},error:()=>{},connected:()=>{}});
 await G.join(H.room,{name:'Guest',deck:deck('G')},{state:s=>ge.states.push(s),status:m=>ge.status.push(m),welcome:id=>ge.welcome.push(id),error:e=>ge.errors.push(e),disconnected:m=>ge.disconnected.push(m),roster:()=>{},connected:()=>{}});
 for(let i=0;i<6;i++)await tick();
 return {peers,H,G,he,ge,hostCtx,guestCtx};
}

test('network 0.6: guest token persists in localStorage and actions are acknowledged',async()=>{
 const x=await pair();assert.deepEqual(x.ge.welcome,['p2']);assert(x.guestCtx.localStorage.getItem('mesa-token-'+x.H.room));
 x.H.start();await tick();assert.equal(x.ge.states.length,1);
 x.G.action({id:'g1',type:'LIFE',actorId:'p2',payload:{delta:-2},expectedRevision:0});await tick();
 assert.equal(x.G.pendingCount,0);assert.equal(x.ge.states.at(-1).players[1].life,38);
});

test('network 0.6: dropped guest reconnects automatically and resends pending actions once',async()=>{
 const x=await pair();x.H.start();await tick();
 x.G.action({id:'before',type:'LIFE',actorId:'p2',payload:{delta:-1},expectedRevision:0});await tick();
 assert.equal(x.ge.states.at(-1).players[1].life,39);
 x.G.rejoin();for(let i=0;i<6;i++)await tick();
 assert.equal(x.ge.welcome.at(-1),'p2');
 x.G.action({id:'after',type:'LIFE',actorId:'p2',payload:{delta:-1},expectedRevision:1});for(let i=0;i<4;i++)await tick();
 assert.equal(x.ge.states.at(-1).players[1].life,38);assert.equal(x.G.pendingCount,0);
});

test('network 0.6: host heartbeat pings guests and drops silent links; guest watchdog retries',async()=>{
 const x=await pair();x.H.start();await tick();
 x.hostCtx.advance(5000);await tick();
 // Si el anfitrión desaparece, el invitado detecta silencio y programa reintentos.
 x.peers.list.find(p=>p.id==='mesa-v1-'+x.H.room).destroy();
 x.guestCtx.advance(21000);x.guestCtx.advance(5000);await tick();
 assert(x.ge.status.some(m=>/Reconectando/.test(m)));
});

test('network 0.6: host can reopen the same room after reload and guests reclaim seats',async()=>{
 const x=await pair();x.H.start();await tick();const room=x.H.room;
 const saved=x.H.savedHost();assert.equal(saved.room,room);assert.equal(saved.started,true);assert(saved.game);
 x.peers.list.find(p=>p.id==='mesa-v1-'+room).destroy();
 const H2=load(x.hostCtx,x.peers);const states=[];
 await H2.resumeHost({state:s=>states.push(s),roster:()=>{},error:()=>{},connected:()=>{}});
 assert.equal(H2.room,room);assert.equal(states.at(-1).players.length,2);
 x.G.rejoin();for(let i=0;i<6;i++)await tick();assert.equal(x.ge.welcome.at(-1),'p2');
});

test('network 0.6: wrong room code reports once instead of retrying forever',async()=>{
 const peers={list:[]},ctx=env(),G=load(ctx,peers),errors=[],status=[];
 await G.join('ZZZZZZZZ',{name:'G',deck:deck('G')},{error:e=>errors.push(e),status:m=>status.push(m),disconnected:()=>{},state:()=>{},welcome:()=>{},roster:()=>{},connected:()=>{}});
 for(let i=0;i<4;i++)await tick();ctx.advance(60000);await tick();
 assert(errors.some(e=>/No se encuentra la sala/.test(e)));assert.equal(status.length,0);
});

test('network 0.6: action made while offline is kept, resent after automatic reconnect and applied once',async()=>{
 const x=await pair();x.H.start();await tick();
 x.peers.conns.at(-1).close();await tick();
 assert(x.ge.disconnected.some(m=>/Reintentando/.test(m)));
 assert.throws(()=>x.G.action({id:'offline',type:'LIFE',actorId:'p2',payload:{delta:-5}}),/al reconectar/);
 assert.equal(x.G.pendingCount,1);
 x.guestCtx.advance(1600);for(let i=0;i<8;i++)await tick();
 assert.equal(x.ge.welcome.length,2);assert.equal(x.G.pendingCount,0);
 const life=x.ge.states.at(-1).players[1].life;assert.equal(life,35);
 x.G.rejoin();for(let i=0;i<8;i++)await tick();assert.equal(x.ge.states.at(-1).players[1].life,35);
});

test('network 0.6: decks y estados grandes viajan en trozos pequeños y se reconstruyen',async()=>{
 const x=await pair();assert.deepEqual(x.ge.welcome,['p2']);x.H.start();await tick();
 const all=x.peers.conns.flatMap(c=>[...c.sent,...(c.remote?c.remote.sent:[])]);
 assert(all.some(m=>m.type==='chunk'),'hubo mensajes troceados');
 assert(all.every(m=>JSON.stringify(m).length<=12200),'ningún mensaje supera el límite');
 assert.equal(x.ge.states.at(-1).players[1].hand.length,7);
});

test('network: anfitrión e invitado usan los servidores TURN del Worker',async()=>{
 const ice=[{urls:'turns:turn.cloudflare.com:443?transport=tcp',username:'u',credential:'c'}];
 const peers={list:[]},hc=env(),gc=env();
 for(const c of [hc,gc]){c.MESA_CONFIG={archidektProxy:'https://api.ex'};c.AbortController=AbortController;c.fetch=async url=>{assert.equal(url,'https://api.ex/api/ice');return {ok:true,json:async()=>({iceServers:ice})};};}
 const H=load(hc,peers),G=load(gc,peers);const noop=()=>{};
 await H.create({players:[{id:'p1',name:'Host',deck:deck('H')},{id:'p2',name:'G',deck:deck('G')}]},{state:noop,roster:noop,error:noop,connected:noop});
 await G.join(H.room,{name:'G',deck:deck('G')},{state:noop,status:noop,welcome:noop,error:noop,disconnected:noop,roster:noop,connected:noop});
 assert.equal(peers.list.length,2);for(const p of peers.list)assert.deepEqual(p.opts.config.iceServers,ice);
});
