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

test('hechizos: se exilian solos, tierra adicional, niebla y monarca',()=>{
 let s=game();const a=s.players[0];a.library=[bear('l1'),bear('l2'),bear('l3')];
 a.hand=[sp('ex','Explore','Sorcery','You may play an additional land this turn.\nDraw a card.'),card('f1','Forest','Basic Land — Forest'),card('f2','Forest','Basic Land — Forest'),card('f3','Forest','Basic Land — Forest')];
 s=ok(s,'CAST',{iid:'f1'});assert.equal(act(s,'CAST',{iid:'f2'}).ok,false,'sin Explore solo una tierra');
 s=ok(s,'CAST',{iid:'ex'});s=ok(s,'RESOLVE');s=ok(s,'CAST',{iid:'f2'});assert.equal(act(s,'CAST',{iid:'f3'}).ok,false);
 s.players[0].hand.push(sp('tp','Ephemeral Out','Instant','Draw a card.\nExile Ephemeral Out.'));s=ok(s,'CAST',{iid:'tp'});s=ok(s,'RESOLVE');
 assert(s.players[0].exile.some(x=>x.iid==='tp'));assert(!s.players[0].graveyard.some(x=>x.iid==='tp'));
 s.players[0].hand.push(sp('mo','Palace Jailer Lite','Sorcery','You become the monarch.'));s=ok(s,'CAST',{iid:'mo'});s=ok(s,'RESOLVE');assert.equal(s.monarch,'a');
 const h=s.players[0].hand.length;s=ok(s,'NEXT_TURN');assert.equal(s.players[0].hand.length,h+1,'el monarca roba en su paso final');
});

test('niebla previene el combate y el daño al monarca le roba la corona',()=>{
 let s=game();s.players[0].battlefield=[bear('x1')];s.monarch='b';
 s.players[1].hand=[sp('fog','Fog','Instant','Prevent all combat damage that would be dealt this turn.')];
 s=ok(s,'COMBAT',{attackers:['x1'],targetPlayerId:'b'});s=ok(s,'CAST',{iid:'fog'},'b');s=ok(s,'RESOLVE',{},'a');
 s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});assert.equal(s.players[1].life,40);assert.equal(s.monarch,'b');
 s=game();s.players[0].battlefield=[bear('x1')];s.monarch='b';s=ok(s,'COMBAT',{attackers:['x1'],targetPlayerId:'b'});s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
 assert.equal(s.players[1].life,38);assert.equal(s.monarch,'a');
});

test('pelear y morder; contrarrestar salvo que pague',()=>{
 let s=game();const a=s.players[0];a.battlefield=[crit('big','Big','Beast','',4,4)];s.players[1].battlefield=[bear('b1')];
 a.hand=[sp('pu','Prey Upon','Sorcery',"Target creature you control fights target creature you don't control.")];
 s=ok(s,'CAST',{iid:'pu'});s=ok(s,'RESOLVE',{targets:[{playerId:'a',iid:'big'},{playerId:'b',iid:'b1'}]});
 assert.equal(s.players[1].battlefield.length,0);assert.equal(s.players[0].battlefield[0].damage,2);
 assert.equal(act(game(),'CAST',{iid:'zz'}).ok,false);
 s=game();s.players[0].hand=[sp('op','Opt','Instant','Draw a card.')];s.players[0].library=[bear('l1')];s.players[1].hand=[sp('ml','Mana Leak','Instant','Counter target spell unless its controller pays {3}.')];s.players[1].mana=mana({U:2});
 s=ok(s,'CAST',{iid:'op'});s=ok(s,'CAST',{iid:'ml',payMana:true},'b');const spell=s.stack[0].id;s=ok(s,'RESOLVE',{targets:[{spellId:spell}]},'b');
 assert.equal(s.prompts[0].kind,'payOrCounter');assert.equal(s.prompts[0].playerId,'a');
 s=ok(s,'CHOOSE',{promptId:s.prompts[0].id,picks:['pay']});assert.equal(s.stack.length,0,'sin maná: se contrarresta');assert(s.players[0].graveyard.some(x=>x.iid==='op'));
});

test('tripular, persistir, enaltecido, aniquilador y no enderezarse',()=>{
 let s=game();const a=s.players[0];
 a.battlefield=[card('cop',"Smuggler's Copter",'Artifact — Vehicle','Flying\nCrew 1',{power:'3',toughness:'3'}),rat('r1'),crit('pe','Kitchen Finks','Ouphe','Persist',3,2),crit('ex','Akrasan Squire','Human Soldier','Exalted',1,1)];
 assert.equal(MC.isCreature(a.battlefield[0]),false);
 s=ok(s,'ACTIVATE',{iid:'cop',index:0});s=drain(s);const cop=s.players[0].battlefield.find(x=>x.iid==='cop');assert(MC.isCreature(cop));assert(s.players[0].battlefield.find(x=>x.iid==='r1').tapped);
 s=ok(s,'COMBAT',{attackers:['cop'],targetPlayerId:'b'});s=drain(s);s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});assert.equal(s.players[1].life,40-4,'3 + enaltecido');
 s.players[0].hand=[sp('sh','Shock','Instant','Shock deals 2 damage to any target.')];s=ok(s,'CAST',{iid:'sh'});s=ok(s,'RESOLVE',{targets:[{playerId:'a',iid:'pe'}]});
 const fin=s.players[0].battlefield.find(x=>x.iid==='pe');assert(fin,'persistir la devuelve');assert.equal(fin.counters['-1/-1'],1);
 s=game();s.players[0].battlefield=[crit('ko','Kozilek','Eldrazi','Annihilator 2',10,10)];s.players[1].battlefield=[bear('b1'),bear('b2'),card('fo','Forest','Basic Land — Forest')];
 s=ok(s,'COMBAT',{attackers:['ko'],targetPlayerId:'b'});s=ok(s,'RESOLVE',{},'a');
 const pr=s.prompts?.[0];assert.equal(pr.kind,'sacrifice');assert.equal(pr.playerId,'b');assert.equal(pr.min,2);
 s=game();s.players[0].battlefield=[card('mv','Mana Vault','Artifact',"Mana Vault doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.",{tapped:true})];s=ok(s,'NEXT_TURN');s=ok(s,'NEXT_TURN',{},'b');assert.equal(s.players[0].battlefield[0].tapped,true);
});

test('tormenta, segundo dividido, afinidad, doble vida y doble fichas',()=>{
 let s=game();const a=s.players[0];a.library=[bear('l1'),bear('l2'),bear('l3'),bear('l4')];
 a.hand=[sp('o1','Opt','Instant','Draw a card.'),sp('o2','Opt','Instant','Draw a card.'),sp('st','Brain Freeze','Instant',"Target player mills three cards.\nStorm")];
 s=ok(s,'CAST',{iid:'o1'});s=ok(s,'RESOLVE');s=ok(s,'CAST',{iid:'o2'});s=ok(s,'RESOLVE');s=ok(s,'CAST',{iid:'st'});assert.equal(s.stack.length,3,'original + 2 copias');
 s=game();s.players[0].hand=[sp('kg','Krosan Grip','Instant','Split second\nDestroy target artifact or enchantment.'),sp('op','Opt','Instant','Draw a card.')];s.players[1].battlefield=[card('art','Sol Ring','Artifact','{T}: Add {C}{C}.')];s.players[1].hand=[sp('o9','Opt','Instant','Draw a card.')];
 s=ok(s,'CAST',{iid:'kg'});assert.equal(act(s,'CAST',{iid:'o9'},'b').ok,false);
 s=game();s.players[0].battlefield=[card('a1','Ornithopter','Artifact Creature',''),card('a2','Sol Ring','Artifact','')];
 const fr=card('fr','Frogmite','Artifact Creature — Frog','Affinity for artifacts',{mana_cost:'{4}'});assert.equal(MC.castCost(s,s.players[0],fr,'hand').tax,-2);
 s=game();s.players[0].battlefield=[card('br','Boon Reflection','Enchantment','If you would gain life, you gain twice that much life instead.'),card('ap','Anointed Procession','Enchantment','If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.')];
 s.players[0].hand=[sp('hl','Heal','Instant','You gain 3 life.'),sp('tk','Raise','Sorcery','Create a 1/1 black Rat creature token.')];
 s=ok(s,'CAST',{iid:'hl'});s=ok(s,'RESOLVE');assert.equal(s.players[0].life,46);
 s=ok(s,'CAST',{iid:'tk'});s=ok(s,'RESOLVE');assert.equal(s.players[0].battlefield.filter(x=>x.token).length,2);
});

test('disparos al robar (Sheoldred) y Fabled Passage se endereza con 4 tierras',()=>{
 let s=game();s.players[0].battlefield=[crit('sh','Sheoldred, the Apocalypse','Phyrexian Praetor','Deathtouch\nWhenever you draw a card, you gain 2 life.\nWhenever an opponent draws a card, they lose 2 life.',4,5)];
 s.players[1].library=[bear('l1'),bear('l2')];s.players[1].hand=[sp('dr','Divination','Sorcery','Draw two cards.')];s.activePlayerId='b';
 s=ok(s,'CAST',{iid:'dr'},'b');s=ok(s,'RESOLVE',{},'b');s=drain(s);assert.equal(s.players[1].life,36);
 s=game();const a=s.players[0];a.battlefield=[card('fp','Fabled Passage','Land','{T}, Sacrifice Fabled Passage: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.'),...['f1','f2','f3'].map(i=>card(i,'Forest','Basic Land — Forest'))];a.library=[card('is','Island','Basic Land — Island')];
 s=ok(s,'ACTIVATE',{iid:'fp',index:0});s=drain(s);if(s.prompts?.length)s=ok(s,'CHOOSE',{promptId:s.prompts[0].id,picks:['is']});
 const isl=s.players[0].battlefield.find(x=>x.iid==='is');assert(isl);assert.equal(isl.tapped,false);
});
