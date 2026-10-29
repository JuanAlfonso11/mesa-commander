const test = require('node:test');
const assert = require('node:assert/strict');
const MC = require('../src/core.js');
const card = (name, extra={}) => ({name,type_line:'Creature — Human',mana_cost:'{1}{B}',color_identity:['B'],legalities:{commander:'legal'},power:'2',toughness:'2',...extra});
const commander = card('Test Commander',{type_line:'Legendary Creature — Human',mana_cost:'{2}{B}'});
const basic = card('Swamp',{type_line:'Basic Land — Swamp',mana_cost:'',power:undefined,toughness:undefined});
const deck = {commander,cards:Array.from({length:99},(_,i)=>i<40?basic:card('Creature '+i))};
function setup(){return MC.createGame({seed:99,players:[{id:'a',deck},{id:'b',deck},{id:'c',deck,bot:true}]});}
let n=0;
function go(state,type,payload={},actorId='a'){return MC.dispatch(state,{id:'qa-'+(++n),type,actorId,payload});}
function inventory(state){return [...state.players.flatMap(p=>MC.ZONES.flatMap(z=>p[z].map(c=>c.iid))),...state.stack.map(e=>e.card.iid)].sort();}

test('QA: inventory conserved across repeated moves, casting, resolution, draw and shuffle',()=>{
 let s=setup();const expected=inventory(s);
 for(let i=0;i<120;i++){
   const p=s.players[i%3]; const z=MC.ZONES[i%MC.ZONES.length];
   let r;
   if(p[z].length){const to=MC.ZONES[(i+1)%MC.ZONES.length];r=go(s,'MOVE',{from:z,to,iid:p[z][0].iid},p.id);}
   else r=go(s,'DRAW',{count:1},p.id);
   assert.equal(r.ok,true,r.error);s=r.state;
   assert.deepEqual(inventory(s),expected);assert.equal(new Set(inventory(s)).size,300);
 }
 for(const p of s.players){let r=go(s,'SHUFFLE',{},p.id);assert(r.ok);s=r.state;}
 assert.deepEqual(inventory(s),expected);
});

test('QA: cross-actor access cannot move, tap or modify counters on opponent cards',()=>{
 let s=setup();const iid=s.players[1].hand[0].iid;
 s=go(s,'MOVE',{iid,from:'hand',to:'battlefield'},'b').state;
 for(const [type,payload] of [['MOVE',{iid,from:'battlefield',to:'hand'}],['TAP',{iid}],['COUNTER',{iid,name:'+1/+1',delta:1}]]){
   const snapshot=JSON.stringify(s),r=go(s,type,payload,'a');assert.equal(r.ok,false);assert.equal(JSON.stringify(s),snapshot);assert.equal(r.state,s);
 }
});

test('QA: private views expose no opponents hand identity, library contents, rng or ledger; mutation stays isolated',()=>{
 const s=setup(),v=MC.viewFor(s,'a');
 assert.equal(v.seed,undefined);assert.equal(v.appliedActionIds,undefined);assert.equal(v.nextInstance,undefined);
 assert.equal(v.players[1].hand.length,0);assert.equal(v.players[1].handCount,7);
 for(const p of v.players){assert.deepEqual(p.library,[]);assert.equal(p.libraryCount,p.id==='a'?91:92,'103.8c: el primero roba en multijugador');}
 v.players[0].hand[0].name='Modified';assert.notEqual(s.players[0].hand[0].name,'Modified');
 const spectator=MC.viewFor(s,'unknown');assert(spectator.players.every(p=>p.hand.length===0));
});

test('QA: stale commands fail atomically and network retries apply once',()=>{
 const s=setup(),a={id:'retry',type:'LIFE',actorId:'a',payload:{delta:-4},expectedRevision:0};
 const r=MC.dispatch(s,a);assert(r.ok);const retry=MC.dispatch(r.state,a);assert(retry.ok&&retry.duplicate);assert.equal(retry.state.players[0].life,36);
 const stale=MC.dispatch(r.state,{...a,id:'stale'});assert.equal(stale.ok,false);assert.equal(stale.state,r.state);
});

test('QA: wrong colors and hybrid assistance reject atomically; {0} is payable',()=>{
 let s=setup();s.players[0].hand=[{...card('Colored',{mana_cost:'{B}{B}'}),iid:'colored'},{...card('Hybrid',{mana_cost:'{B/R}'}),iid:'hybrid'},{...card('Free',{mana_cost:'{0}'}),iid:'free'}];s.players[0].mana.R=20;
 for(const iid of ['colored','hybrid']){const before=JSON.stringify(s),r=go(s,'CAST',{iid,payMana:true});assert.equal(r.ok,false);assert.equal(JSON.stringify(r.state),before);}
 assert.equal(go(s,'CAST',{iid:'free',payMana:true}).ok,true);
});

test('QA regression: card without printed mana cost cannot be assisted as a zero-cost spell',()=>{
 let s=setup();s.players[0].hand=[{...card('No printed cost',{mana_cost:''}),iid:'nocost'}];
 assert.equal(go(s,'CAST',{iid:'nocost',payMana:true}).ok,false);
 assert.equal(go(s,'CAST',{iid:'nocost'}).ok,false,'sin coste impreso no se lanza gratis por defecto');
 assert.equal(go(s,'CAST',{iid:'nocost',unpaid:true}).ok,true,'solo como corrección manual explícita');
});

test('QA: commander unblocked damage, double strike and lifelink recorded together',()=>{
 let s=setup();const p=s.players[0];const c=p.command.pop();c.power='11';c.keywords=['Double strike','Lifelink'];c.sick=false;p.battlefield.push(c);
 s=go(s,'COMBAT',{attackers:[c.iid],targetPlayerId:'b'}).state;
 s=go(s,'DECLARE_BLOCKS',{blocks:[]},'b').state;s=go(s,'RESOLVE_COMBAT',{confirm:true}).state;
 assert.equal(s.players[1].life,18);assert.equal(s.players[1].commanderDamage.a,22);assert.equal(s.players[1].eliminated,true);assert.equal(s.players[0].life,62);
});

test('QA: bot decision is independent of opponent hidden cards and has bounded execution',()=>{
 const s=setup();s.activePlayerId='c';s.players[2].turnDrawn=true;
 const changed=JSON.parse(JSON.stringify(s));changed.players[0].hand.forEach(c=>{c.name='Secret changed';c.power='999';});changed.players[1].library.reverse();
 const a=MC.botTurn(s,'c'),b=MC.botTurn(changed,'c');
 assert.deepEqual(a.events,b.events);assert.deepEqual(a.state.players[2],b.state.players[2]);assert(a.events.length<100);
 const again=MC.botTurn(a.state,'c');assert(again.error);assert.equal(again.state,a.state);
});

test('QA regression: Nazgûl allows nine copies and rejects ten',()=>{
 const naz=card('Nazgûl',{oracle_text:'A deck can have up to nine cards named Nazgûl.'});
 const valid={commander,cards:[...Array(9).fill(naz),...Array(90).fill(basic)]};
 assert.equal(MC.validateDeck(valid).valid,true);
 const invalid={commander,cards:[...Array(10).fill(naz),...Array(89).fill(basic)]};assert.equal(MC.validateDeck(invalid).valid,false);
});

test('QA: nonfinite deltas cannot corrupt state and proto counter names rejected',()=>{
 let s=setup();let r=go(s,'MOVE',{iid:s.players[0].hand[0].iid,from:'hand',to:'battlefield'});assert(r.ok);s=r.state;
 for(const delta of [NaN,Infinity,'5',null]){for(const type of ['LIFE','POISON','MANA'])assert.equal(go(s,type,{delta,color:'B'}).ok,false);}
 for(const name of ['__proto__','constructor','prototype'])assert.equal(go(s,'COUNTER',{iid:s.players[0].battlefield[0].iid,name,delta:1}).ok,false);
});
