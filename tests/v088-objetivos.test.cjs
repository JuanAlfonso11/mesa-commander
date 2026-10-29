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

const sp=(iid,name,type,text)=>card(iid,name,type,text);

test('601.2c/608.2b: el objetivo se fija al lanzar; si deja de ser legal, el hechizo no hace nada',()=>{
 let s=game();s.players[1].battlefield=[crit('tal','Talrand','Merfolk Wizard','',2,2),crit('dr','Drake','Drake','',2,2,{token:true})];
 s.players[0].hand=[sp('mu','Murder','Instant','Destroy target creature.')];s.players[1].hand=[sp('sn','Snap','Instant',"Return target creature to its owner's hand.")];
 assert.match(act(s,'CAST',{iid:'mu',targets:[{playerId:'b',iid:'nope'}]}).error,/Objetivo no válido/);
 s=ok(s,'CAST',{iid:'mu',targets:[{playerId:'b',iid:'tal'}]});assert.deepEqual(s.stack[0].targets,[{playerId:'b',iid:'tal',spellId:undefined}]);
 s=ok(s,'CAST',{iid:'sn',targets:[{playerId:'b',iid:'tal'}]},'b');s=ok(s,'RESOLVE',{},'b');assert(s.players[1].hand.some(x=>x.iid==='tal'));
 s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'dr'}]});assert(s.players[1].battlefield.some(x=>x.iid==='dr'),'no se puede cambiar al Drake');
 assert(s.log.some(l=>/no hace nada/.test(l.text)));assert(s.players[0].graveyard.some(x=>x.iid==='mu'));
});

test('506.3: atacar a un planeswalker le quita lealtad y no daña al jugador',()=>{
 let s=game(3);s.players[0].battlefield=[crit('x','X','Beast','',3,3),crit('y','Y','Beast','Trample',4,4)];
 s.players[1].battlefield=[card('jc','Jace','Legendary Planeswalker — Jace','',{loyalty:'5',counters:{Lealtad:5}}),bear('g')];
 assert.match(act(s,'COMBAT',{assignments:[{attackerId:'x',targetPlayerId:'c',planeswalkerId:'jc'}]}).error,/no está en el campo/);
 s=ok(s,'COMBAT',{assignments:[{attackerId:'x',targetPlayerId:'b',planeswalkerId:'jc'},{attackerId:'y',targetPlayerId:'b',planeswalkerId:'jc'}]});
 s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'y',blockerId:'g'}]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
 assert.equal(s.players[1].life,40);assert(!s.players[1].battlefield.some(c=>c.iid==='jc'),'3 + 2 arrollando = 5: Jace muere');
});

test('601.2f: aumentos de coste (Thalia, Grand Arbiter) y 508.1g: impuesto de ataque (Propaganda)',()=>{
 let s=game();const sw=i=>card(i,'Swamp','Basic Land — Swamp','');
 s.players[1].battlefield=[crit('th','Thalia, Guardian of Thraben','Human Soldier','First strike\nNoncreature spells cost {1} more to cast.',2,1),card('ga','Grand Arbiter Augustin IV','Legendary Creature — Human Advisor','Spells your opponents cast cost {1} more to cast.',{power:'2',toughness:'3'})];
 const op=card('op','Opt','Instant','Draw a card.',{mana_cost:'{B}'}),bear2=card('be','Bear','Creature — Bear','',{mana_cost:'{B}',power:'2',toughness:'2'});
 assert.equal(MC.castCost(s,s.players[0],op,'hand').tax,2,'Thalia +1 y Arbiter +1');assert.equal(MC.castCost(s,s.players[0],bear2,'hand').tax,1,'criatura: solo Arbiter');
 assert.equal(MC.castCost(s,s.players[1],op,'hand').tax,1,'el Arbiter no afecta a su dueño; Thalia sí');
 s.players[0].hand=[op];s.players[0].battlefield=[sw('s1'),sw('s2')];assert.match(act(s,'CAST',{iid:'op'}).error,/No puedes pagar/);
 s.players[0].battlefield.push(sw('s3'));s=ok(s,'CAST',{iid:'op'});assert(s.players[0].battlefield.filter(x=>x.name==='Swamp').every(x=>x.tapped));
 s=game();s.players[1].battlefield=[card('pg','Propaganda','Enchantment',"Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.")];
 s.players[0].battlefield=[bear('x'),bear('y'),sw('s1'),sw('s2')];
 assert.match(act(s,'COMBAT',{attackers:['x','y'],targetPlayerId:'b'}).error,/pagar \{4\}/);
 s=ok(s,'COMBAT',{attackers:['x'],targetPlayerId:'b'});assert(s.players[0].battlefield.filter(x=>x.name==='Swamp').every(x=>x.tapped),'pagó {2}');
});

test('los bots reparten el ataque: cada atacante va donde es seguro',()=>{
 let s=game(3,['a']);s.players[0].battlefield=[crit('fl','Flyer','Bird','Flying',3,1),crit('gr','Grunt','Orc','',3,3)];
 s.players[1].battlefield=[crit('ogre','Ogre','Ogre','',5,5)];s.players[2].battlefield=[crit('arch','Archer','Elf','Reach',1,4)];
 const r=MC.botTurn(s,'a');const c=r.state.pendingCombat;
 assert(c,'el bot ataca');assert.equal(c.targets.fl,'b','el volador evita al arquero con alcance');assert.equal(c.targets.gr,'c','el de tierra evita al ogro que lo mataría');
});
