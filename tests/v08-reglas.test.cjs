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
 s=ok(s,'COMBAT',{attackers:['r1','t1'],targetPlayerId:'b'});s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'r1',blockerId:'b1'}]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
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
 s=ok(s,'CAST',{unpaid:true,iid:'db'});const opts=MC.effectPlan(s,s.stack[0]).targeted[0].options.map(o=>o.target.iid);assert(opts.includes('b1'));assert(!opts.includes('blk'));assert(!opts.includes('k'));
 s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'b1'}]});
 s=ok(s,'CAST',{unpaid:true,iid:'df'});s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'blk'}]});assert.equal(s.players[1].battlefield.length,0,'-2/-2 mata al oso 2/2');
 s=ok(s,'CAST',{unpaid:true,iid:'gm'});s=ok(s,'RESOLVE');s=drain(s);assert.equal(s.players[1].life,36);assert.equal(s.players[0].life,44);
});

test('equipo: Swiftfoot Boots se equipa, da antimaleficio y prisa; el rival ya no la puede elegir',()=>{
 let s=game();const a=s.players[0];a.battlefield=[card('boots','Swiftfoot Boots','Artifact — Equipment','Equipped creature has hexproof and haste.\nEquip {1}'),crit('c1','Hero','Human','',3,3,{sick:true}),card('w','Wastes','Basic Land')];
 s=ok(s,'ACTIVATE',{iid:'boots',index:0});assert(s.players[0].battlefield.find(c=>c.iid==='w').tapped,'paga {1} girando una tierra');
 s=ok(s,'RESOLVE');assert.equal(s.players[0].battlefield.find(c=>c.iid==='boots').attachedTo,'c1');
 const hero=s.players[0].battlefield.find(c=>c.iid==='c1');assert(MC.hasKw(hero,'Haste'));assert(MC.hasKw(hero,'Hexproof'));
 s.players[1].hand=[card('m','Murder','Instant','Destroy target creature.')];s.activePlayerId='b';
 assert.match(act(s,'CAST',{iid:'m'},'b').error,/objetivos legales/,'antimaleficio: Murder no tiene objetivo');
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
 s=ok(s,'COMBAT',{attackers:['ninja'],targetPlayerId:'b'});s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
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

test('hechizos modales: Kolaghan\'s Command elige dos modos y cada uno pide su objetivo',()=>{
 let s=game();const a=s.players[0];s.players[1].hand=[bear('h1')];s.players[1].battlefield=[card('art','Sol Ring','Artifact','{T}: Add {C}{C}.')];
 a.hand=[card('kc',"Kolaghan's Command",'Instant',"Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan's Command deals 2 damage to any target.")];
 s=ok(s,'CAST',{iid:'kc'});s=ok(s,'RESOLVE');const pr=s.prompts[0];assert.equal(pr.kind,'mode');assert.equal(pr.min,2);
 s=ok(s,'CHOOSE',{promptId:pr.id,picks:['mode-1','mode-2']});assert.equal(s.stack.length,2);assert.match(s.stack.at(-1).card.oracle_text,/discards/);
 s=ok(s,'RESOLVE',{targets:[{playerId:'b'}]});assert.equal(s.players[1].hand.length,0,'una sola carta: descarta sin preguntar');
 s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'art'}]});assert.equal(s.players[1].battlefield.length,0);
});

test('X: Exsanguinate drena X y Crypt Rats activa con X',()=>{
 let s=game(3);const a=s.players[0];a.battlefield=[...['s1','s2','s3','s4','s5'].map(i=>card(i,'Swamp','Basic Land — Swamp')),crit('cr','Crypt Rats','Rat','{X}: Crypt Rats deals X damage to each creature and each player. Spend only black mana on X.',1,1)];
 a.hand=[card('ex','Exsanguinate','Sorcery','Each opponent loses X life. You gain life equal to the life lost this way.',{mana_cost:'{X}{B}{B}'})];
 const plan=MC.autoPaymentPlan(s,'a','ex','hand',{cast:{x:2}});assert(plan.ok,plan.reason);assert.equal(plan.landIds.length,4);
 s=ok(s,'CAST',{iid:'ex',autoPay:true,autoPayRevision:s.revision,landIds:plan.landIds,x:2});s=ok(s,'RESOLVE');assert.equal(s.players[1].life,38);assert.equal(s.players[2].life,38);assert.equal(s.players[0].life,44);
 s=ok(s,'ACTIVATE',{iid:'cr',index:0,x:1});s=ok(s,'RESOLVE');assert.equal(s.players[1].life,37);assert(!s.players[0].battlefield.some(c=>c.iid==='cr'),'Crypt Rats 1/1 muere');
});

test('costes alternativos: Force of Will exilia una carta azul y paga 1 vida; gratis con comandante',()=>{
 let s=game();s.activePlayerId='b';s.players[1].hand=[card('sp','Lightning Bolt','Instant','Lightning Bolt deals 3 damage to any target.',{mana_cost:'{R}'})];s.players[1].mana=mana({R:1});
 s=ok(s,'CAST',{iid:'sp',payMana:true},'b');
 const a=s.players[0];a.hand=[card('fow','Force of Will','Instant',"You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.",{mana_cost:'{3}{U}{U}',colors:['U']}),card('blue','Brainstorm','Instant','Draw three cards, then put two cards from your hand on top of your library in any order.',{colors:['U']}),card('red','Shock','Instant','',{colors:['R']}),card('fg','Fierce Guardianship','Instant',"If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.",{mana_cost:'{2}{U}'})];
 assert.match(act(s,'CAST',{iid:'fow',alt:0,exile:['red']}).error,/no cumple/);
 s=ok(s,'CAST',{iid:'fow',alt:0,exile:['blue']});assert.equal(s.players[0].life,39);assert.equal(s.players[0].exile[0].iid,'blue');
 s=ok(s,'RESOLVE',{targets:[{spellId:s.stack[0].id}]},'a');assert.equal(s.stack.length,0);assert.equal(s.players[1].graveyard[0].iid,'sp');
 assert.match(act(s,'CAST',{iid:'fg',alt:0}).error,/comandante/);
});

test('sobrecarga, retroceso, estímulo, escarmiento y ciclo',()=>{
 let s=game();const a=s.players[0];a.library=[bear('l1'),bear('l2'),bear('l3')];a.mana=mana({U:10,C:10});
 s.players[1].battlefield=[bear('b1'),bear('b2'),card('sw','Swamp','Basic Land — Swamp')];
 a.hand=[card('rift','Cyclonic Rift','Instant',"Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U}",{mana_cost:'{1}{U}'}),card('tide','Rat Tide','Instant','Buyback {4}\nCreate a 1/1 black Rat creature token.',{mana_cost:'{B}'}),card('roil','Into the Roil','Instant',"Kicker {1}{U}\nReturn target nonland permanent to its owner's hand. If this spell was kicked, draw a card.",{mana_cost:'{1}{U}'}),card('cyc','Cycler','Creature — Beast','Cycling {2}',{power:'5',toughness:'5'})];
 s=ok(s,'CAST',{iid:'rift',payMana:true,overload:true});s=ok(s,'RESOLVE');assert.deepEqual(s.players[1].battlefield.map(c=>c.iid),['sw']);assert.equal(s.players[0].mana.U,9);
 s.players[0].mana=mana({B:5});s=ok(s,'CAST',{iid:'tide',payMana:true,buyback:true});s=ok(s,'RESOLVE');assert(s.players[0].hand.some(c=>c.iid==='tide'),'retroceso: vuelve a la mano');
 s.players[0].battlefield.push(bear('mine'));s.players[0].mana=mana({U:3,C:2});s=ok(s,'CAST',{iid:'roil',payMana:true,kicker:true});const h=s.players[0].hand.length;s=ok(s,'RESOLVE',{targets:[{playerId:'a',iid:'mine'}]});assert.equal(s.players[0].hand.length,h+2,'vuelve el oso y roba por el estímulo');
 s.players[0].graveyard.push(card('tt','Think Twice','Instant','Draw a card.\nFlashback {2}{U}',{mana_cost:'{1}{U}'}));s.players[0].mana=mana({U:1,C:2});
 s=ok(s,'CAST',{iid:'tt',from:'graveyard',payMana:true});s=ok(s,'RESOLVE');assert(s.players[0].exile.some(c=>c.iid==='tt'),'escarmiento: se exilia');
 s.players[0].mana=mana({C:2});const before=s.players[0].hand.length;s=ok(s,'CYCLE',{iid:'cyc'});assert.equal(s.players[0].hand.length,before);assert(s.players[0].graveyard.some(c=>c.iid==='cyc'));
});

test('ninjutsu, regeneración, monstruosidad y bushido',()=>{
 let s=game();const a=s.players[0];a.mana=mana({B:10,C:10});
 a.battlefield=[rat('att'),crit('kuro',"Kuro's Taken",'Rat Samurai',"Bushido 1\n{1}{B}: Regenerate Kuro's Taken.",1,1),crit('mon','Monster','Beast','{3}{B}{B}: Monstrosity 3.\nAs long as Monster is monstrous, it has menace.',2,2)];
 a.hand=[crit('nin','Ninja of the Deep Hours','Human Ninja','Ninjutsu {1}{U}\nWhenever Ninja of the Deep Hours deals combat damage to a player, you may draw a card.',2,2)];a.library=[bear('l1')];
 s.players[1].battlefield=[crit('blk','Wall','Wall','',0,4)];
 s=ok(s,'ACTIVATE',{iid:'mon',index:0});s=ok(s,'RESOLVE');const mon=s.players[0].battlefield.find(c=>c.iid==='mon');assert(mon.monstrous);assert.equal(MC.power(mon,s.players[0]),5);assert(MC.hasKw(mon,'Menace'));
 s=ok(s,'ACTIVATE',{iid:'kuro',index:0});s=ok(s,'RESOLVE');
 s=ok(s,'COMBAT',{attackers:['att','kuro'],targetPlayerId:'b'});
 assert.match(act(s,'NINJUTSU',{iid:'nin',returnIid:'att'}).error,/bloqueos/);
 s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'kuro',blockerId:'blk'}]},'b');s.players[0].mana=mana({U:1,C:1});// 106.4: el maná de la fase principal ya se perdió
 assert.match(act(s,'NINJUTSU',{iid:'nin',returnIid:'kuro'}).error,/no haya sido bloqueada/);
 s=ok(s,'NINJUTSU',{iid:'nin',returnIid:'att'});assert(s.players[0].hand.some(c=>c.iid==='att'));assert(s.pendingCombat.attackers.includes('nin'));
 s=ok(s,'RESOLVE_COMBAT',{confirm:true});assert.equal(s.players[1].life,38);assert.equal(s.stack.length,1,'el ninja se dispara');s=ok(s,'RESOLVE');
 const kuro=s.players[0].battlefield.find(c=>c.iid==='kuro');assert(kuro,'bushido +1/+1 lo deja 2/2 contra un muro 0/4');
});

test('elige un tipo de criatura, Path to Exile y Eternal Witness',()=>{
 let s=game();const a=s.players[0];a.battlefield=[rat('r1'),bear('own')];s.players[1].battlefield=[bear('b1'),rat('r2')];s.players[1].library=[card('pl','Plains','Basic Land — Plains')];
 a.hand=[card('cf','Crippling Fear','Sorcery',"Choose a creature type. Creatures that aren't of the chosen type get -3/-3 until end of turn."),card('pte','Path to Exile','Instant','Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.'),crit('ew','Eternal Witness','Human Shaman','When Eternal Witness enters, return target card from your graveyard to your hand.',2,1)];
 s=ok(s,'CAST',{iid:'cf'});s=ok(s,'RESOLVE');s=ok(s,'CHOOSE',{promptId:s.prompts[0].id,value:'rat'});s=ok(s,'RESOLVE');
 assert.deepEqual(s.players[0].battlefield.map(c=>c.iid),['r1']);assert.deepEqual(s.players[1].battlefield.map(c=>c.iid),['r2']);
 s=ok(s,'CAST',{iid:'pte'});s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'r2'}]});assert.equal(s.players[1].battlefield[0].iid,'pl');assert(s.players[1].battlefield[0].tapped);
 s=ok(s,'CAST',{iid:'ew'});s=ok(s,'RESOLVE');s=ok(s,'RESOLVE');const pr=s.prompts[0];assert.equal(pr.kind,'return');s=ok(s,'CHOOSE',{promptId:pr.id,picks:['cf']});assert(s.players[0].hand.some(c=>c.iid==='cf'));
});

test('Brainstorm, Ponder y Stock Up: mirar, reordenar y devolver cartas',()=>{
 let s=game();const a=s.players[0];a.library=['l1','l2','l3','l4','l5','l6'].map(i=>bear(i));
 a.hand=[card('bs','Brainstorm','Instant','Draw three cards, then put two cards from your hand on top of your library in any order.'),card('po','Ponder','Sorcery','Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.'),card('su','Stock Up','Sorcery','Look at the top five cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.')];
 for(const c of a.hand)assert.deepEqual(FX.uncovered(c),[],c.name);
 s=ok(s,'CAST',{iid:'bs'});s=ok(s,'RESOLVE');const pr=s.prompts[0];assert.equal(pr.kind,'putBack');assert.equal(pr.min,2);
 s=ok(s,'CHOOSE',{promptId:pr.id,picks:['po','su']});assert.deepEqual(s.players[0].library.slice(-2).map(c=>c.iid),['po','su']);assert.equal(s.players[0].hand.length,3);
});

test('morbid, delve, convocar y rueda',()=>{
 let s=game();const a=s.players[0];a.library=['l1','l2','l3','l4','l5','l6','l7'].map(i=>bear(i));s.players[1].library=['m1','m2','m3','m4'].map(i=>bear(i));
 a.graveyard=['g1','g2','g3','g4','g5'].map(i=>bear(i));a.battlefield=[bear('c1'),bear('c2'),card('isl','Island','Basic Land — Island')];
 s.players[1].battlefield=[crit('big','Giant','Giant','',5,5),rat('sm')];
 a.hand=[card('ts','Tragic Slip','Instant','Target creature gets -1/-1 until end of turn.\nMorbid — That creature gets -13/-13 until end of turn instead if a creature died this turn.',{mana_cost:'{B}'}),card('tc','Treasure Cruise','Sorcery','Delve\nDraw three cards.',{mana_cost:'{7}{U}'}),card('cv','Convoker','Sorcery','Convoke\nDraw a card.',{mana_cost:'{2}'}),card('wf','Windfall','Sorcery','Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',{mana_cost:'{2}{U}'})];
 s=ok(s,'CAST',{unpaid:true,iid:'ts'});s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'sm'}]});assert.equal(s.players[1].battlefield.length,1);
 s.players[0].hand.push(card('ts2','Tragic Slip','Instant','Target creature gets -1/-1 until end of turn.\nMorbid — That creature gets -13/-13 until end of turn instead if a creature died this turn.'));
 s=ok(s,'CAST',{unpaid:true,iid:'ts2'});s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'big'}]});assert.equal(s.players[1].battlefield.length,0,'morbid: -13/-13');
 s.players[0].mana=mana({U:1,C:2});s=ok(s,'CAST',{iid:'tc',payMana:true,delve:5});assert.equal(s.players[0].exile.length,5);assert.equal(s.players[0].mana.U,0);s=ok(s,'RESOLVE');
 s=ok(s,'CAST',{iid:'cv',payMana:true,convoke:['c1','c2']});assert(s.players[0].battlefield.find(c=>c.iid==='c1').tapped);s=ok(s,'RESOLVE');
 s.players[1].hand=[bear('x1')];const n=s.players[0].hand.length;s.players[0].mana=mana({U:1,C:2});s=ok(s,'CAST',{iid:'wf',payMana:true});s=ok(s,'RESOLVE');assert.equal(s.players[1].hand.length,n-1,'todos roban la mano más grande descartada');
});

test('retrasados, copias, enderezar en turno ajeno, barajar en vez de cementerio y «puedes pagar»',()=>{
 let s=game();const a=s.players[0];a.library=['l1','l2','l3'].map(i=>bear(i));s.players[1].library=['m1','m2','m3','m4'].map(i=>bear(i));
 a.battlefield=[crit('pr','Pack Rat','Rat',"Pack Rat's power and toughness are each equal to the number of Rats you control.\n{2}{B}, Discard a card: Create a token that's a copy of Pack Rat.",0,0),card('ws',"Bender's Waterskin",'Artifact',"Untap Bender's Waterskin during each other player's untap step.",{tapped:true}),crit('dv','Drainpipe Vermin','Rat','When Drainpipe Vermin dies, you may pay {B}. If you do, target player discards a card.',1,1)];
 a.hand=[bear('fodder'),card('ad','Arcane Denial','Instant',"Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep."),card('nx','Nexus of Fate','Instant','Take an extra turn after this one.\nIf Nexus of Fate would be put into a graveyard from anywhere, reveal Nexus of Fate and shuffle it into its owner\'s library instead.')];
 a.mana=mana({B:4,C:2});
 s=ok(s,'ACTIVATE',{iid:'pr',index:0,discard:['fodder']});s=ok(s,'RESOLVE');const copies=s.players[0].battlefield.filter(c=>c.name==='Pack Rat');assert.equal(copies.length,2);assert.equal(MC.power(copies[1],s.players[0]),3);
 s.players[1].hand=[card('sp','Spell','Sorcery','Draw a card.'),bear('bh')];s.activePlayerId='b';
 s.players[1].mana=mana({C:1});s=ok(s,'CAST',{iid:'sp'},'b');s=ok(s,'CAST',{iid:'ad'});s=ok(s,'RESOLVE',{targets:[{spellId:s.stack[0].id}]});assert.equal(s.delayed.length,2);
 s=ok(s,'NEXT_TURN',{},'b');assert(!s.players[0].battlefield.find(c=>c.iid==='ws').tapped,'Waterskin se endereza en el turno de otro');
 assert.equal(s.stack.length,2,'dos robos retrasados');const ha=s.players[0].hand.length;s=drain(s);assert.equal(s.players[0].hand.length,ha+1,'roba 1 por el efecto retrasado');assert.equal(s.players[1].hand.length,3,'el rival roba 2');
 s=ok(s,'COUNTER',{iid:'dv',name:'-1/-1',delta:1});assert.equal(s.stack.at(-1).optional,true);s.players[0].mana=mana({B:1});s=ok(s,'RESOLVE',{targets:[{playerId:'b'}]});assert.equal(s.players[0].mana.B,0,'pagó {B}');assert.equal(s.prompts.find(x=>x.playerId==='b').kind,'discard');
 s=ok(s,'CAST',{iid:'nx'});s=ok(s,'RESOLVE');assert(s.players[0].library.some(c=>c.iid==='nx'),'Nexus vuelve a la biblioteca');assert.deepEqual(s.extraTurns,['a']);
});

test('maná: tierras de dolor, Signets, elfos y altares; el pago automático usa criaturas sin mareo',()=>{
 let s=game();const a=s.players[0];
 a.battlefield=[card('pain','Caves of Koilos','Land','{T}: Add {C}.\n{T}: Add {W} or {B}. Caves of Koilos deals 1 damage to you.'),card('sig','Orzhov Signet','Artifact','{1}, {T}: Add {W}{B}.'),crit('elf','Llanowar Elves','Elf Druid','{T}: Add {G}.',1,1,{sick:true}),crit('arch','Elvish Archdruid','Elf Druid','{T}: Add {G} for each Elf you control.',2,2),card('alt',"Ashnod's Altar",'Artifact','Sacrifice a creature: Add {C}{C}.')];
 assert.match(act(s,'TAP',{iid:'elf',tapped:true}).error,/acaba de entrar/);
 s=ok(s,'TAP',{iid:'arch',tapped:true});assert.equal(s.players[0].mana.G,2);
 s=ok(s,'TAP',{iid:'sig',tapped:true});assert.deepEqual([s.players[0].mana.G,s.players[0].mana.W,s.players[0].mana.B],[1,1,1]);
 s=ok(s,'TAP',{iid:'pain',tapped:true,color:'B'});assert.equal(s.players[0].life,39);
 s=ok(s,'ACTIVATE',{iid:'alt',index:0,sacrifice:['elf']});assert.equal(s.stack.length,0,'el maná no usa la pila');assert.equal(s.players[0].mana.C,2);
});

test('tierras: choque, revelar, rápidas y rebote',()=>{
 let s=game();const a=s.players[0];
 a.hand=[card('shock','Overgrown Tomb','Land — Swamp Forest',"({T}: Add {B} or {G}.)\nAs Overgrown Tomb enters, you may pay 2 life. If you don't, it enters tapped."),card('rot','Golgari Rot Farm','Land',"Golgari Rot Farm enters tapped.\nWhen Golgari Rot Farm enters, return a land you control to its owner's hand.\n{T}: Add {B}{G}."),card('fast','Blooming Marsh','Land','Blooming Marsh enters tapped unless you control two or fewer other lands.\n{T}: Add {B} or {G}.')];
 s=ok(s,'CAST',{iid:'shock'});const pr=s.prompts[0];assert.equal(pr.kind,'shock');s=ok(s,'CHOOSE',{promptId:pr.id,picks:['pay']});assert.equal(s.players[0].life,38);assert(!s.players[0].battlefield[0].tapped);
 s.players[0].landsPlayed=0;s=ok(s,'CAST',{iid:'fast'});assert(!s.players[0].battlefield.find(c=>c.iid==='fast').tapped,'rápida con pocas tierras: enderezada');
 s.players[0].landsPlayed=0;s=ok(s,'CAST',{iid:'rot'});s=ok(s,'RESOLVE');const bp=s.prompts[0];assert.equal(bp.kind,'bounceOwn');s=ok(s,'CHOOSE',{promptId:bp.id,picks:['fast']});assert(s.players[0].hand.some(c=>c.iid==='fast'));
});

test('planeswalkers: lealtad al entrar, una habilidad por turno y el daño quita lealtad',()=>{
 let s=game();const a=s.players[0];a.library=[bear('l1'),bear('l2')];
 a.hand=[card('pw','Garruk Wildspeaker','Legendary Planeswalker — Garruk','+1: Untap two target lands.\n−1: Create a 3/3 green Beast creature token.\n−4: Creatures you control get +3/+3 and gain trample until end of turn.',{loyalty:'3'})];
 s=ok(s,'CAST',{iid:'pw'});s=ok(s,'RESOLVE');const pw=s.players[0].battlefield[0];assert.equal(pw.counters.Lealtad,3);
 assert.equal(MC.activated(pw).length,3);s=ok(s,'ACTIVATE',{iid:'pw',index:1});assert.equal(s.players[0].battlefield[0].counters.Lealtad,2);s=ok(s,'RESOLVE');assert(s.players[0].battlefield.some(c=>c.name==='Beast'));
 assert.match(act(s,'ACTIVATE',{iid:'pw',index:1}).error,/este turno/);
 s.activePlayerId='b';s.players[1].hand=[card('bolt','Lightning Bolt','Instant','Lightning Bolt deals 3 damage to any target.')];
 s=ok(s,'CAST',{iid:'bolt'},'b');s=ok(s,'RESOLVE',{targets:[{playerId:'a',iid:'pw'}]},'b');assert(!s.players[0].battlefield.some(c=>c.iid==='pw'),'sin lealtad, al cementerio');
});

test('veneno: infectar, toxic y proliferar',()=>{
 let s=game();const a=s.players[0];
 a.battlefield=[crit('inf','Plague Stinger','Phyrexian Insect','Flying\nInfect',1,1),crit('tox','Bilious Skulldweller','Phyrexian Worm','Deathtouch\nToxic 1',1,1),card('ring','Ring','Artifact','',{counters:{Carga:1}})];
 a.hand=[card('pro','Proliferate Spell','Sorcery','Each opponent gets a poison counter.\nProliferate.')];
 s=ok(s,'COMBAT',{attackers:['inf','tox'],targetPlayerId:'b'});s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
 assert.equal(s.players[1].poison,2);assert.equal(s.players[1].life,39,'infectar no quita vidas; toxic sí suma veneno además del daño');
 s=ok(s,'NEXT_PHASE');s=ok(s,'CAST',{iid:'pro'});s=ok(s,'RESOLVE');assert.equal(s.players[1].poison,4);assert.equal(s.players[0].battlefield.find(c=>c.iid==='ring').counters.Carga,2);
});

test('fichas y contadores «por cada», mirar con filtro, buscar con filtro y caminatas',()=>{
 let s=game();const a=s.players[0];a.battlefield=[crit('e1','Elf A','Elf','',1,1),crit('e2','Elf B','Elf','',1,1)];
 a.library=[bear('x1'),bear('x2'),crit('e3','Elf C','Elf','',1,1),card('f','Forest','Basic Land — Forest'),bear('x3')];
 a.hand=[card('tk','Elf Swarm','Sorcery','Create a 1/1 green Elf Warrior creature token for each Elf you control.'),card('dg','Elf Look','Sorcery','Look at the top three cards of your library. You may reveal an Elf card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.'),card('cn','Pump','Sorcery','Put a +1/+1 counter on each Elf you control.')];
 for(const c of a.hand)assert.deepEqual(FX.uncovered(c),[],c.name);
 s=ok(s,'CAST',{iid:'tk'});s=ok(s,'RESOLVE');assert.equal(s.players[0].battlefield.filter(c=>c.token).length,2);
 s=ok(s,'CAST',{iid:'cn'});s=ok(s,'RESOLVE');assert.equal(s.players[0].battlefield.filter(c=>c.counters['+1/+1']===1).length,4);
 s=ok(s,'CAST',{iid:'dg'});s=ok(s,'RESOLVE');const pr=s.prompts[0];assert.deepEqual(pr.options.map(o=>o.iid),['e3']);s=ok(s,'CHOOSE',{promptId:pr.id,picks:['e3']});assert(s.players[0].hand.some(c=>c.iid==='e3'));assert.equal(s.players[0].library.length,4);
 const walker=crit('fw','Walker','Elf','Forestwalk',2,2);const blk=crit('bk','Blocker','Wall','',0,4);const def={battlefield:[card('ff','Forest','Basic Land — Forest'),blk]};
 assert.equal(MC.canBlock(walker,blk,def),false);assert.equal(MC.canBlock(walker,blk,{battlefield:[blk]}),true);
});

test('caras dobles, modales parciales, eminencia, «uno o más», ganar vida y cascada',()=>{
 let s=game(3);const a=s.players[0];a.library=[bear('l1'),card('cheap','Cheap Spell','Sorcery','Draw a card.',{cmc:1}),card('land1','Swamp','Basic Land — Swamp'),bear('l2',{cmc:6})];
 const path={iid:'path',name:'Darkbore Pathway // Slitherbore Pathway',type_line:'Land // Land',oracle_text:'Darkbore Pathway\n{T}: Add {B}.\n\nSlitherbore Pathway\n{T}: Add {G}.',card_faces:[{name:'Darkbore Pathway',type_line:'Land',oracle_text:'{T}: Add {B}.'},{name:'Slitherbore Pathway',type_line:'Land',oracle_text:'{T}: Add {G}.'}],tapped:false,sick:false,damage:0,counters:{}};
 assert.deepEqual(MC.manaSource(path,a).options,['B']);
 const charm=card('ch','Odd Charm','Instant','Choose one —\n• Destroy target artifact.\n• Counter target spell if it\'s blue.');assert.deepEqual(FX.uncovered(charm),["• Counter target spell if it's blue."]);
 a.command=[crit('edgar','Edgar Markov','Vampire Knight','Eminence — Whenever you cast another Vampire spell, if Edgar Markov is in the command zone or on the battlefield, create a 1/1 black Vampire creature token.',4,4,{isCommander:true,type_line:'Legendary Creature — Vampire Knight'})];
 a.battlefield=[card('bond','Sanguine Bond','Enchantment','Whenever you gain life, target opponent loses that much life.'),card('mr','Mortality Ring','Enchantment','Whenever a token you control leaves the battlefield, each opponent loses 1 life and you gain 1 life.'),crit('lead','Elf Lord','Elf','Whenever one or more other Elves you control enter, you gain 1 life. This ability triggers only once each turn.',2,2)];
 a.hand=[crit('vamp','Vampire Pup','Vampire','',1,1),card('cas','Bloodbraid Thing','Sorcery','Cascade\nYou gain 2 life.',{cmc:4}),card('elves','Elf Pack','Sorcery','Create two 1/1 green Elf Warrior creature tokens.')];
 s=ok(s,'CAST',{iid:'vamp'});assert.equal(s.stack.length,2,'eminencia desde la zona de mando');s=drain(s);assert(s.players[0].battlefield.some(c=>c.name==='Vampire'&&c.token));
 s=ok(s,'CAST',{iid:'elves'});s=ok(s,'RESOLVE');assert.equal(s.stack.length,1,'«uno o más» se dispara una sola vez');s=ok(s,'RESOLVE');assert.equal(s.stack.length,1,'ganar vida dispara Sanguine Bond');s=ok(s,'RESOLVE',{targets:[{playerId:'b'}]});assert.equal(s.players[1].life,39);
 const tok=s.players[0].battlefield.find(c=>c.token&&c.name==='Elf Warrior');s=ok(s,'MOVE',{iid:tok.iid,from:'battlefield',to:'graveyard'});assert.equal(s.stack.length,1,'la ficha que deja el campo dispara');s=drain(s);
 s=ok(s,'CAST',{iid:'cas'});assert.equal(s.stack.at(-1).card.abilitySteps?.[0]?.type,'cascade');s=ok(s,'RESOLVE');assert.equal(s.stack.at(-1).card.iid,'cheap','cascada lanza el primer hechizo de menor valor');
 assert(s.players[0].library.some(c=>c.iid==='land1')&&s.players[0].library.some(c=>c.iid==='l2'),'el resto vuelve al fondo');
 const tl=card('tl','Bountiful Promenade','Land','Bountiful Promenade enters tapped unless you have two or more opponents.\n{T}: Add {G} or {W}.');s.players[0].hand.push(tl);s.players[0].landsPlayed=0;s=drain(s);s=ok(s,'CAST',{iid:'tl'});assert(!s.players[0].battlefield.find(c=>c.iid==='tl').tapped);
});

test('atacar a varios rivales: cada defensor bloquea solo lo que le ataca y el daño va a quien corresponde',()=>{
 let s=game(3);const a=s.players[0];
 a.battlefield=[bear('x1',{isCommander:true}),bear('x2'),crit('x3','Ninja','Human Ninja','Whenever Ninja deals combat damage to a player, draw a card.',1,1)];a.library=[bear('l1')];
 s.players[1].battlefield=[rat('rb')];s.players[2].battlefield=[rat('rc')];
 assert.equal(act(s,'COMBAT',{assignments:[{attackerId:'x1',targetPlayerId:'a'}]}).ok,false,'no puedes atacarte');
 s=ok(s,'COMBAT',{assignments:[{attackerId:'x1',targetPlayerId:'b'},{attackerId:'x2',targetPlayerId:'c'},{attackerId:'x3',targetPlayerId:'c'}]});
 const c=s.pendingCombat;assert.deepEqual(c.targets,{x1:'b',x2:'c',x3:'c'});assert.equal(c.blocksDeclared,false,'B (humano) aún no declara');
 assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'x2',blockerId:'rb'}]},'b').ok,false,'B no puede bloquear a quien ataca a C');
 s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');assert.equal(s.pendingCombat.blocksDeclared,false,'falta C');
 assert.match(act(s,'RESOLVE_COMBAT',{confirm:true}).error,/Faltan los bloqueos de C/);
 assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[]},'b').ok,false,'B ya declaró');
 s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'x2',blockerId:'rc'}]},'c');s=ok(s,'RESOLVE_COMBAT',{confirm:true});s=drain(s);
 assert.equal(s.players[1].life,38);assert.equal(s.players[1].commanderDamage.a,2);
 assert.equal(s.players[2].life,39);assert.equal(s.players[0].hand.length,1,'el Ninja robó al dañar a C');
 assert(!s.players[2].battlefield.some(x=>x.iid==='rc'),'la rata de C murió bloqueando');
});
