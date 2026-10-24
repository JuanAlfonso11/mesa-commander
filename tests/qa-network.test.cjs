const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {webcrypto}=require('node:crypto');
const MC=require('../src/core.js');
const card=(name)=>({name,type_line:'Creature',mana_cost:'{1}',color_identity:[],legalities:{commander:'legal'},power:'1',toughness:'1'});
const deck=(name)=>({commander:{...card(name+' commander'),type_line:'Legendary Creature'},cards:Array.from({length:99},(_,i)=>card(name+' secret '+i))});
class Conn extends EventEmitter{constructor(id){super();this.peer=id;this.open=true;this.sent=[];}send(x){const v=JSON.parse(JSON.stringify(x));if(v.type==='chunk'){this.parts=this.parts||{};const l=this.parts[v.id]=this.parts[v.id]||[];l[v.i]=v.part;if(l.filter(x=>x!==undefined).length===v.n)this.sent.push(JSON.parse(decodeURIComponent(l.join(''))));return;}this.sent.push(v);}close(){this.open=false;this.emit('close');}receive(x){this.emit('data',x);}latest(type){return this.sent.filter(x=>x.type===type).at(-1);}}
async function setup(){
 let peer;const events={states:[],rosters:[],chats:[],errors:[]};
 class Peer extends EventEmitter{constructor(id){super();this.id=id;this.open=true;peer=this;queueMicrotask(()=>this.emit('open',id));}destroy(){this.open=false;}}
 const ctx=vm.createContext({Peer,MC,MD:{uid:()=>webcrypto.randomUUID()},crypto:webcrypto,Date:class extends Date{static now(){return 1700000000000;}},console,setTimeout:()=>0,clearTimeout:()=>{}});
 vm.runInContext(fs.readFileSync(require.resolve('../src/network.js'),'utf8'),ctx);
 await ctx.MN.create({players:[{id:'p1',name:'Host',deck:deck('HOST')},{id:'p2',name:'Bot2',bot:true,deck:deck('BOT2')},{id:'p3',name:'Bot3',bot:true,deck:deck('BOT3')}]},{state:s=>events.states.push(s),roster:p=>events.rosters.push(p),chat:m=>events.chats.push(m),error:e=>events.errors.push(e)});
 function attach(id='guest'){const c=new Conn(id);peer.emit('connection',c);return c;}
 function hello(c,token=''){c.receive({type:'hello',name:'Guest',deck:deck('GUEST'),token});return c.latest('welcome');}
 return {MN:ctx.MN,events,attach,hello};
}

test('network: unbound actions ignored; bound actor overrides forged host identity',async()=>{
 const x=await setup(),c=x.attach();x.MN.start();c.receive({type:'action',action:{id:'unauth',actorId:'p1',type:'LIFE',payload:{delta:-10}}});assert.equal(x.events.states.at(-1).revision,0);
 const y=await setup(),g=y.attach();assert.equal(y.hello(g).id,'p2');y.MN.start();
 g.receive({type:'action',action:{id:'spoof',actorId:'p1',type:'LIFE',payload:{delta:-7},expectedRevision:0}});
 const s=y.events.states.at(-1);assert.equal(s.players[0].life,40);assert.equal(s.players[1].life,33);
});

test('network: recipient state strips rival secrets and own library; peek returns only bound library',async()=>{
 const x=await setup(),c=x.attach();x.hello(c);x.MN.start();const v=c.latest('state').state;
 assert.equal(v.seed,undefined);assert.equal(v.players[0].hand.length,0);assert.equal(v.players[2].hand.length,0);assert.equal(v.players[1].hand.length,7);assert(v.players.every(p=>p.library.length===0));
 assert(!JSON.stringify(v).includes('HOST secret'));assert(!JSON.stringify(v).includes('BOT3 secret'));
 c.receive({type:'peek',actorId:'p1',playerId:'p1'});const cards=c.latest('peek').cards;assert.equal(cards.length,92);assert(cards.every(c=>c.name.startsWith('GUEST secret')));
});

test('network: foreign card action rejected, retries idempotent and stale action rejected',async()=>{
 const x=await setup(),c=x.attach();x.hello(c);x.MN.start();const hostCard=x.events.states.at(-1).players[0].hand[0].iid;
 c.receive({type:'action',action:{id:'theft',actorId:'p1',type:'MOVE',payload:{from:'hand',to:'graveyard',iid:hostCard},expectedRevision:0}});assert(c.latest('error'));assert.equal(x.events.states.at(-1).revision,0);
 const action={id:'once',actorId:'p2',type:'LIFE',payload:{delta:-1},expectedRevision:0};c.receive({type:'action',action});c.receive({type:'action',action});assert.equal(x.events.states.at(-1).players[1].life,39);
 c.receive({type:'action',action:{...action,id:'stale'}});assert.equal(x.events.states.at(-1).revision,1);assert.match(c.latest('error').message,/cambió/);
});

test('network: oversized packets discarded, chat capped and message rate limited',async()=>{
 const x=await setup(),c=x.attach();x.hello(c);x.MN.start();c.receive({type:'chat',text:'x'.repeat(1800001)});assert.equal(x.events.chats.length,0);
 c.receive({type:'chat',text:'x'.repeat(5000)});assert.equal(x.events.chats[0].text.length,400);
 for(let i=0;i<40;i++)c.receive({type:'action',action:{id:'flood-'+i,type:'LIFE',payload:{delta:-1}}});
 assert(x.events.states.at(-1).revision<=28);assert(x.events.states.at(-1).revision>0);
});

test('network: reconnect token reclaims original seat and retires old connection; strangers denied after start',async()=>{
 const x=await setup(),old=x.attach('old'),welcome=x.hello(old);x.MN.start();const c=x.attach('new');x.hello(c,welcome.token);
 assert.equal(old.open,false);assert.equal(c.latest('welcome').id,'p2');assert.equal(c.latest('state').state.players[1].hand.length,7);
 const stranger=x.attach('stranger');x.hello(stranger);assert(!stranger.latest('welcome'));assert.match(stranger.latest('error').message,/comenzó/);
});

test('network regression: repeat hello cannot consume a second player slot',async()=>{
 const x=await setup(),c=x.attach();assert.equal(x.hello(c).id,'p2');x.hello(c);
 const roster=x.events.rosters.at(-1);assert.equal(roster.filter(p=>p.bot).length,1);assert.equal(roster[1].id,'p2');
});

test('network virtual actions: forged actor cannot spend host lands, pass for host or disable response checks',async()=>{
 const x=await setup(),c=x.attach();x.hello(c);const s=x.MN.start();
 const island=(iid)=>({iid,name:'Island',type_line:'Basic Land — Island',tapped:false});
 s.responseChecks=true;s.players[0].battlefield=[island('host-source')];s.players[1].battlefield=[island('guest-source')];s.players[1].hand[0].mana_cost='{U}';s.players[1].hand[0].type_line='Instant';
 x.MN.sync(s);const iid=s.players[1].hand[0].iid;
 c.receive({type:'action',action:{id:'foreign-source',actorId:'p1',type:'CAST',payload:{iid,autoPay:true,autoPayRevision:0,landIds:['host-source']}}});
 assert(c.latest('error'));assert.equal(x.events.states.at(-1).revision,0);assert.equal(x.events.states.at(-1).players[0].battlefield[0].tapped,false);
 c.receive({type:'action',action:{id:'own-source',actorId:'p1',type:'CAST',payload:{iid,autoPay:true,autoPayRevision:0,landIds:['guest-source']}}});
 assert.equal(x.events.states.at(-1).stack[0].controllerId,'p2');assert.equal(x.events.states.at(-1).players[1].battlefield[0].tapped,true);assert.equal(x.events.states.at(-1).players[0].battlefield[0].tapped,false);
 c.receive({type:'action',action:{id:'forged-pass',actorId:'p1',type:'PASSED_RESPONSE',payload:{pass:true,playerId:'p1'}}});
 assert.deepEqual(MC.responseStatus(x.events.states.at(-1)).passedIds,['p2']);
 c.receive({type:'action',action:{id:'forged-disable',actorId:'p1',type:'SET_RESPONSE_CHECKS',payload:{enabled:false}}});
 assert.equal(x.events.states.at(-1).responseChecks,true);assert.match(c.latest('error').message,/activo/);
});
