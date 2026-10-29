const test=require('node:test'),assert=require('node:assert/strict');
const MC=require('../src/core.js'),FX=require('../src/effects.js');
let seq=0;
const mana=v=>({W:0,U:0,B:0,R:0,G:0,C:0,...v});
function game(n=2,bots=[]){const s=MC.createGame({seed:5,players:['a','b','c'].slice(0,n).map(id=>({id,name:id.toUpperCase(),bot:bots.includes(id),deck:{cards:[]}}))});for(const p of s.players){p.hand=[];p.battlefield=[];p.library=Array.from({length:10},(_,i)=>({iid:p.id+'-lib'+i,name:'Wastes',type_line:'Basic Land',oracle_text:'',counters:{}}));p.mana=mana({});p.turnDrawn=true;}s.phase=1;return s;}
function act(s,type,payload={},actorId='a'){return MC.dispatch(s,{id:'v8-'+(++seq),type,payload,actorId});}
function ok(s,type,payload={},actorId='a'){const r=act(s,type,payload,actorId);assert.equal(r.ok,true,r.error);return r.state;}
const card=(iid,name,type_line,oracle_text='',extra={})=>({iid,name,type_line,oracle_text,mana_cost:'{0}',tapped:false,sick:false,damage:0,counters:{},...extra});
const crit=(iid,name,type,text,p,t,extra={})=>card(iid,name,'Creature — '+type,text,{power:String(p),toughness:String(t),...extra});
const rat=(iid,extra={})=>crit(iid,'Rat '+iid,'Rat','',1,1,{colors:['B'],...extra});
const bear=(iid,extra={})=>crit(iid,'Bear '+iid,'Bear','',2,2,{colors:['G'],...extra});
const drain=s=>{for(let i=0;i<30&&s.stack.length;i++)s=ok(s,'RESOLVE',{},s.stack.at(-1).controllerId);return s;};


test('704.5b: robar de una biblioteca vacía hace perder la partida',()=>{
 let s=game(3);s.players[1].library=[];s=ok(s,'DRAW',{count:1},'b');
 assert.equal(s.players[1].eliminated,true);assert.equal(s.winnerId,null);
});

test('800.4a: quien pierde se lleva sus cartas; lo robado vuelve a su dueño exiliado; corregir la vida lo devuelve',()=>{
 let s=game(3);const [a,b]=s.players;
 b.battlefield=[card('anth','Glorious Anthem','Enchantment','Creatures you control get +1/+1.'),bear('bb')];
 a.battlefield=[bear('stolen',{ownerId:'c'}),bear('mine')];s.players[2].battlefield=[bear('cb',{ownerId:'a'})];s.monarch='a';s.activePlayerId='b';
 s=ok(s,'LIFE',{delta:-40},'a');
 assert.equal(s.players[0].battlefield.length,0);assert(s.players[2].exile.some(x=>x.iid==='stolen'),'lo ajeno se exilia');
 assert(!s.players[2].battlefield.some(x=>x.iid==='cb'),'lo suyo en manos ajenas sale de la partida');
 assert.equal(s.monarch,'b','725.4: la corona pasa al jugador activo');
 s=ok(s,'LIFE',{delta:5},'a');assert.equal(s.players[0].eliminated,false);assert(s.players[0].battlefield.some(x=>x.iid==='mine'));
});

test('704.5q: contadores +1/+1 y -1/-1 se anulan',()=>{
 let s=game();s.players[0].battlefield=[bear('x',{counters:{'+1/+1':3}})];
 s=ok(s,'COUNTER',{iid:'x',name:'-1/-1',delta:2});assert.deepEqual(s.players[0].battlefield[0].counters,{'+1/+1':1});
});

test('103.5: mulligan de Londres; el primero es gratis en multijugador y no en dos jugadores',()=>{
 const deck={cards:Array.from({length:30},(_,i)=>({name:'Card '+i,type_line:'Creature',oracle_text:''}))};
 let s=MC.createGame({seed:2,players:['a','b','c'].map(id=>({id,name:id,deck}))});
 s=ok(s,'MULLIGAN',{},'b');assert.equal(s.players[1].hand.length,7);assert(!s.prompts);
 s=ok(s,'MULLIGAN',{},'b');assert.equal(s.prompts[0].kind,'bottom');assert.equal(s.prompts[0].min,1);
 const keep=s.players[1].hand[0].iid;s=ok(s,'CHOOSE',{promptId:s.prompts[0].id,picks:[keep]},'b');
 assert.equal(s.players[1].hand.length,6);assert.equal(s.players[1].library[0].iid,keep,'va al fondo');
 let t2=MC.createGame({seed:2,players:['a','b'].map(id=>({id,name:id,deck}))});
 assert.equal(t2.players[0].turnDrawn,true,'103.8a: en dos jugadores quien empieza no roba');assert.equal(t2.players[1].turnDrawn,false);
 t2=ok(t2,'MULLIGAN',{},'b');assert.equal(t2.prompts[0].min,1,'sin mulligan gratis en dos jugadores');
});
