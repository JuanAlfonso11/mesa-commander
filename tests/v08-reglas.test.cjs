const test=require('node:test'),assert=require('node:assert/strict');
const MC=require('../src/core.js'),FX=require('../src/effects.js');
let seq=0;
const mana=v=>({W:0,U:0,B:0,R:0,G:0,C:0,...v});
function game(n=2,bots=[]){const s=MC.createGame({seed:5,players:['a','b','c'].slice(0,n).map(id=>({id,name:id.toUpperCase(),bot:bots.includes(id),deck:{cards:[]}}))});for(const p of s.players){p.hand=[];p.battlefield=[];p.library=[];p.mana=mana({});p.turnDrawn=true;}s.phase=1;return s;}
function act(s,type,payload={},actorId='a'){return MC.dispatch(s,{id:'v8-'+(++seq),type,payload,actorId});}
function ok(s,type,payload={},actorId='a'){const r=act(s,type,payload,actorId);assert.equal(r.ok,true,r.error);return r.state;}
const card=(iid,name,type_line,oracle_text='',extra={})=>({iid,name,type_line,oracle_text,mana_cost:'{0}',tapped:false,sick:false,damage:0,counters:{},...extra});
const crit=(iid,name,type,text,p,t,extra={})=>card(iid,name,'Creature — '+type,text,{power:String(p),toughness:String(t),...extra});
const rat=(iid,extra={})=>crit(iid,'Rat '+iid,'Rat','',1,1,{colors:['B'],...extra});
const bear=(iid,extra={})=>crit(iid,'Bear '+iid,'Bear','',2,2,{colors:['G'],...extra});
const drain=s=>{for(let i=0;i<30&&s.stack.length;i++)s=ok(s,'RESOLVE',{},s.stack.at(-1).controllerId);return s;};

test('Talrand: lanzar un instantáneo dispara una ficha de Dragón antes de que resuelva el hechizo',()=>{
 let s=game();const a=s.players[0];a.battlefield=[crit('tal','Talrand, Sky Summoner','Merfolk Wizard','Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',2,2)];
 a.hand=[card('op','Opt','Instant','Scry 1. Draw a card.')];a.library=[bear('l1'),bear('l2')];
 s=ok(s,'CAST',{iid:'op'});assert.equal(s.stack.length,2);assert.equal(s.stack.at(-1).ability,true);
 s=ok(s,'RESOLVE');const drake=s.players[0].battlefield.find(c=>c.token);assert.equal(drake.name,'Drake');assert(MC.hasKw(drake,'Flying'));
 s=ok(s,'RESOLVE');assert.equal(s.prompts?.[0]?.kind,'scry');s=ok(s,'CHOOSE',{promptId:s.prompts[0].id,picks:[]});assert.equal(s.players[0].hand.length,1);
});

test('Ayara: drena al entrar ella u otra criatura negra; su habilidad sacrifica otra criatura negra y roba',()=>{
 let s=game();const a=s.players[0];a.library=[bear('l1')];
 a.hand=[crit('ay','Ayara, First of Locthwain','Elf Noble','Whenever Ayara, First of Locthwain or another black creature you control enters, each opponent loses 1 life and you gain 1 life.\n{T}, Sacrifice another black creature: Draw a card.',2,3,{colors:['B']}),rat('r1')];
 s=ok(s,'CAST',{iid:'ay'});s=ok(s,'RESOLVE');assert.equal(s.stack.length,1);s=drain(s);assert.equal(s.players[1].life,39);assert.equal(s.players[0].life,41);
 s=ok(s,'CAST',{iid:'r1'});s=drain(s);assert.equal(s.players[1].life,38);
 s.players[0].battlefield.forEach(c=>c.sick=false);
 assert.equal(act(s,'ACTIVATE',{iid:'ay',index:0,sacrifice:['ay']}).ok,false,'no puede sacrificarse a sí misma');
 s=ok(s,'ACTIVATE',{iid:'ay',index:0,sacrifice:['r1']});assert(s.players[0].battlefield.find(c=>c.iid==='ay').tapped);assert.equal(s.players[0].graveyard[0].iid,'r1');
 s=drain(s);assert.equal(s.players[0].hand.length,1);
});

test('Bastion of Remembrance: cada criatura tuya que muere (también fichas) drena',()=>{
 let s=game();const a=s.players[0];a.battlefield=[card('bas','Bastion of Remembrance','Enchantment','Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life.'),rat('r1'),rat('t1',{token:true})];
 s.players[1].battlefield=[bear('b1')];
 s=ok(s,'COMBAT',{attackers:['r1','t1'],targetPlayerId:'b'});s=ok(s,'RESOLVE_COMBAT',{confirm:true,blocks:[{attackerId:'r1',blockerId:'b1'}]});
 assert.equal(s.stack.length,1);s=drain(s);assert.equal(s.players[1].life,40-1-1);
 s=ok(s,'COUNTER',{iid:'t1',name:'-1/-1',delta:1});s=drain(s);assert.equal(s.players[1].life,37);assert.equal(s.players[0].battlefield.length,1);
});

test('Marrow-Gnawer: las Ratas tienen miedo y su habilidad crea X ratas según las Ratas que controlas',()=>{
 let s=game();const a=s.players[0];a.battlefield=[crit('mg','Marrow-Gnawer','Rat Rogue','All Rats have fear.\n{T}, Sacrifice a Rat: Create X 1/1 black Rat creature tokens, where X is the number of Rats you control.',2,3,{colors:['B']}),rat('r1'),rat('r2'),rat('r3')];
 s.players[1].battlefield=[bear('green'),crit('bk','Black Knight','Knight','',2,2,{colors:['B']})];
 s=ok(s,'NOTE',{text:'recalcula'});assert(MC.hasKw(s.players[0].battlefield.find(c=>c.iid==='r1'),'Fear'));
 const r1=s.players[0].battlefield.find(c=>c.iid==='r1');assert.equal(MC.canBlock(r1,s.players[1].battlefield[0]),false);assert.equal(MC.canBlock(r1,s.players[1].battlefield[1]),true);
 s=ok(s,'ACTIVATE',{iid:'mg',index:0,sacrifice:['r3']});s=drain(s);
 assert.equal(s.players[0].battlefield.filter(c=>c.token).length,3,'quedaban 3 Ratas (Marrow-Gnawer, r1, r2)');
});

test('Pack Rat y Rat Colony: fuerza variable según las Ratas',()=>{
 let s=game();s.players[0].battlefield=[crit('pr','Pack Rat','Rat',"Pack Rat's power and toughness are each equal to the number of Rats you control.",0,0),crit('rc','Rat Colony','Rat','Rat Colony gets +1/+0 for each other Rat you control.\nA deck can have any number of cards named Rat Colony.',2,1),rat('r1')];
 s=ok(s,'NOTE',{text:'x'});const [pr,rc]=s.players[0].battlefield;assert.equal(MC.power(pr,s.players[0]),3);assert.equal(MC.toughness(pr),3);assert.equal(MC.power(rc,s.players[0]),4);
 assert.deepEqual(FX.uncovered(rc),[]);
});

test('entra girada, regla de leyendas y descarte de limpieza',()=>{
 let s=game();const a=s.players[0];a.hand=[card('cd','Charcoal Diamond','Artifact','Charcoal Diamond enters tapped.\n{T}: Add {B}.',{mana_cost:'{2}'}),card('bog','Bojuka Bog','Land','This land enters tapped.\nWhen this land enters, exile target player\'s graveyard.\n{T}: Add {B}.')];
 s.players[1].graveyard=[bear('g1'),bear('g2')];
 s=ok(s,'CAST',{iid:'bog'});assert(s.players[0].battlefield[0].tapped);const pl=MC.effectPlan(s,s.stack[0]);assert.equal(pl.targeted.length,1);
 s=ok(s,'RESOLVE',{targets:[{playerId:'b'}]});assert.equal(s.players[1].graveyard.length,0);assert.equal(s.players[1].exile.length,2);
 s.players[0].mana=mana({B:2});s=ok(s,'CAST',{iid:'cd',payMana:true});s=ok(s,'RESOLVE');assert(s.players[0].battlefield.find(c=>c.iid==='cd').tapped);
 s.players[0].battlefield.push(crit('l1','Legend','Legendary Creature — Human','',1,1,{type_line:'Legendary Creature — Human'}),crit('l2','Legend','Legendary Creature — Human','',1,1,{type_line:'Legendary Creature — Human'}));
 s=ok(s,'NOTE',{text:'x'});assert.equal(s.prompts[0].kind,'legend');s=ok(s,'CHOOSE',{promptId:s.prompts[0].id,picks:['l2']});assert.deepEqual(s.players[0].battlefield.filter(c=>c.name==='Legend').map(c=>c.iid),['l2']);
 s.players[0].hand=Array.from({length:9},(_,i)=>bear('h'+i));s.players[1].library=[bear('x')];
 s=ok(s,'NEXT_TURN');const pr=s.prompts.find(x=>x.playerId==='a');assert.equal(pr.min,2);s=ok(s,'CHOOSE',{promptId:pr.id,picks:['h0','h1']});assert.equal(s.players[0].hand.length,7);
});

test('elecciones: Burglar Rat hace descartar (el bot elige solo) y Diabolic Tutor busca',()=>{
 let s=game(3,['c']);const a=s.players[0];a.hand=[crit('br','Burglar Rat','Rat','When Burglar Rat enters, each opponent discards a card.',1,1),card('dt','Diabolic Tutor','Sorcery','Search your library for a card, put that card into your hand, then shuffle.')];a.library=[bear('t1'),bear('t2')];
 s.players[1].hand=[bear('bh1'),bear('bh2')];s.players[2].hand=[bear('ch1')];
 s=ok(s,'CAST',{iid:'br'});s=drain(s);assert.equal(s.players[2].hand.length,0,'el bot con una carta descarta solo');
 const pr=s.prompts.find(x=>x.playerId==='b');assert.equal(pr.kind,'discard');assert.equal(act(s,'CHOOSE',{promptId:pr.id,picks:['bh1']},'a').ok,false,'otro jugador no elige por B');
 s=ok(s,'CHOOSE',{promptId:pr.id,picks:['bh2']},'b');assert.deepEqual(s.players[1].hand.map(c=>c.iid),['bh1']);
 s=ok(s,'CAST',{iid:'dt'});s=ok(s,'RESOLVE');const sp=s.prompts[0];assert.equal(sp.kind,'search');assert.equal(sp.options.length,2);
 assert.deepEqual(MC.viewFor(s,'b').prompts[0].options,[],'los demás no ven la biblioteca');
 s=ok(s,'CHOOSE',{promptId:sp.id,picks:['t2']});assert.equal(s.players[0].hand[0].iid,'t2');assert.equal(s.players[0].library.length,1);
});

test('objetivos con filtro, -X/-X dinámico y drenaje por devoción',()=>{
 let s=game();const a=s.players[0];
 a.battlefield=[card('sw1','Swamp','Basic Land — Swamp'),card('sw2','Swamp','Basic Land — Swamp'),crit('k','Knight','Knight','',2,2,{mana_cost:'{B}{B}',colors:['B']})];
 s.players[1].battlefield=[bear('b1'),crit('blk','Black Bear','Bear','',2,2,{colors:['B']})];
 a.hand=[card('db','Doom Blade','Instant','Destroy target nonblack creature.'),card('df','Defile','Instant','Target creature gets -1/-1 until end of turn for each Swamp you control.'),crit('gm','Gray Merchant of Asphodel','Zombie','When Gray Merchant of Asphodel enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way.',2,4,{mana_cost:'{3}{B}{B}'})];
 s=ok(s,'CAST',{iid:'db'});const opts=MC.effectPlan(s,s.stack[0]).targeted[0].options.map(o=>o.target.iid);assert(opts.includes('b1'));assert(!opts.includes('blk'));assert(!opts.includes('k'));
 s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'b1'}]});
 s=ok(s,'CAST',{iid:'df'});s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'blk'}]});assert.equal(s.players[1].battlefield.length,0,'-2/-2 mata al oso 2/2');
 s=ok(s,'CAST',{iid:'gm'});s=ok(s,'RESOLVE');s=drain(s);assert.equal(s.players[1].life,36);assert.equal(s.players[0].life,44);
});

test('equipo: Swiftfoot Boots se equipa, da antimaleficio y prisa; el rival ya no la puede elegir',()=>{
 let s=game();const a=s.players[0];a.battlefield=[card('boots','Swiftfoot Boots','Artifact — Equipment','Equipped creature has hexproof and haste.\nEquip {1}'),crit('c1','Hero','Human','',3,3,{sick:true}),card('w','Wastes','Basic Land')];
 s=ok(s,'ACTIVATE',{iid:'boots',index:0});assert(s.players[0].battlefield.find(c=>c.iid==='w').tapped,'paga {1} girando una tierra');
 s=ok(s,'RESOLVE');assert.equal(s.players[0].battlefield.find(c=>c.iid==='boots').attachedTo,'c1');
 const hero=s.players[0].battlefield.find(c=>c.iid==='c1');assert(MC.hasKw(hero,'Haste'));assert(MC.hasKw(hero,'Hexproof'));
 s.players[1].hand=[card('m','Murder','Instant','Destroy target creature.')];s.activePlayerId='b';
 s=ok(s,'CAST',{iid:'m'},'b');assert.equal(MC.effectPlan(s,s.stack[0]).targeted[0].options.length,0);
});

test('costes adicionales y reducción de coste',()=>{
 let s=game();const a=s.players[0];a.library=[bear('l1'),bear('l2')];
 a.battlefield=[rat('r1'),crit('bar','Baral, Chief of Compliance','Human Wizard','Instant and sorcery spells you cast cost {1} less to cast.',1,3)];
 a.hand=[card('ar',"Altar's Reap",'Instant','As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.',{mana_cost:'{1}{B}'})];
 a.mana=mana({B:1});
 assert.match(act(s,'CAST',{iid:'ar',payMana:true}).error,/coste adicional/);
 s=ok(s,'CAST',{iid:'ar',payMana:true,sacrifice:['r1']});assert.equal(s.players[0].mana.B,0,'Baral reduce {1}');assert.equal(s.players[0].graveyard[0].iid,'r1');
 s=ok(s,'RESOLVE');assert.equal(s.players[0].hand.length,2);
});

test('mantenimiento, daño de combate, disparos opcionales y turno adicional',()=>{
 let s=game();const a=s.players[0];a.library=[bear('l1'),bear('l2'),bear('l3')];s.players[1].library=[bear('m1'),bear('m2')];
 a.battlefield=[card('bb','Bitterblossom','Tribal Enchantment — Faerie','At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.'),crit('ninja','Ninja','Human Ninja','Whenever Ninja deals combat damage to a player, you may draw a card.',2,2)];
 s=ok(s,'COMBAT',{attackers:['ninja'],targetPlayerId:'b'});s=ok(s,'RESOLVE_COMBAT',{confirm:true,blocks:[]});
 assert.equal(s.stack.length,1);assert.equal(s.stack[0].optional,true);s=ok(s,'RESOLVE',{decline:true});assert.equal(s.players[0].hand.length,0);
 a.hand=[];s.players[0].hand=[card('tw','Time Walk','Sorcery','Take an extra turn after this one.')];
 s=ok(s,'NEXT_PHASE');s=ok(s,'CAST',{iid:'tw'});s=ok(s,'RESOLVE');
 s=ok(s,'NEXT_TURN');assert.equal(s.activePlayerId,'a','turno adicional');assert.equal(s.stack.length,1,'Bitterblossom se dispara en el mantenimiento');
 s=drain(s);assert.equal(s.players[0].life,39);assert(s.players[0].battlefield.some(c=>c.name==='Faerie Rogue'));
});

test('Tesoros: al girarse dan maná y se sacrifican; el pago automático no los usa solo',()=>{
 let s=game();s.players[0].hand=[card('sc','Smothering Tithe','Enchantment','',{mana_cost:'{3}{W}'})];
 s=ok(s,'TOKEN',{});s.players[0].battlefield=[];s=ok(s,'NOTE',{text:'x'});
 const r=FX.parseSentence('Create a Treasure token');assert.deepEqual(r,[{type:'namedToken',kind:'treasure',count:1}]);
 s.players[0].hand=[card('sp','Spell','Sorcery','Create two Treasure tokens.')];s=ok(s,'CAST',{iid:'sp'});s=ok(s,'RESOLVE');
 const t=s.players[0].battlefield.filter(c=>c.name==='Treasure');assert.equal(t.length,2);
 assert.equal(MC.manaSource(t[0],s.players[0]).sacrifice,true);
 s=ok(s,'TAP',{iid:t[0].iid,tapped:true,color:'R'});assert.equal(s.players[0].mana.R,1);assert.equal(s.players[0].battlefield.filter(c=>c.name==='Treasure').length,1);
});
