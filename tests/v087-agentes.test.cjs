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
const MD=require('../src/data.js');

test('lanzar siempre cobra: Rat Colony de la práctica no entra gratis',()=>{
 let s=game();const rat=MD.defaultDecks()[0].cards.find(c=>c.name==='Rat Colony');
 s.players[0].hand=[{...rat,iid:'r1'},{...rat,iid:'r2'}];s.players[0].battlefield=[card('sw','Swamp','Basic Land — Swamp',''),card('sw2','Swamp','Basic Land — Swamp','')];
 s=ok(s,'CAST',{iid:'r1'});assert(s.players[0].battlefield.every(x=>x.tapped),'gira los pantanos');s=ok(s,'RESOLVE');
 assert.match(act(s,'CAST',{iid:'r2'}).error,/No puedes pagar/);
 s=ok(s,'CAST',{iid:'r2',unpaid:true});assert(s.log.some(l=>/SIN PAGAR/.test(l.text)));
});

test('fases: tierras y conjuros solo en la principal; un combate por turno',()=>{
 let s=game();s.players[0].hand=[card('f','Forest','Basic Land — Forest'),sp('so','Divination','Sorcery','Draw two cards.')];s.players[0].battlefield=[bear('x'),bear('y',{keywords:['Vigilance']})];
 s.phase=0;assert.match(act(s,'CAST',{iid:'f'}).error,/fase principal/);assert.match(act(s,'CAST',{iid:'so'}).error,/fase principal/);
 s.phase=1;s=ok(s,'COMBAT',{attackers:['y'],targetPlayerId:'b'});s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
 assert.match(act(s,'CAST',{iid:'so'}).error,/fase principal/,'en combate no');assert.match(act(s,'COMBAT',{attackers:['x'],targetPlayerId:'b'}).error,/combate este turno/);
 s=ok(s,'NEXT_PHASE');s=ok(s,'CAST',{iid:'f'});
});

test('bloqueos: solo el defensor los declara, una vez; se mantienen aunque el bloqueador muera; protección',()=>{
 let s=game();s.players[0].battlefield=[crit('x','X','Beast','',3,3)];s.players[1].battlefield=[bear('g'),crit('pw','White Knight','Knight','Protection from green',2,2,{colors:['W']})];
 s=ok(s,'COMBAT',{attackers:['x'],targetPlayerId:'b'});assert.match(act(s,'RESOLVE_COMBAT',{confirm:true}).error,/Faltan los bloqueos de B/);
 s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'x',blockerId:'g'}]},'b');assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[]},'b').ok,false);
 s.players[0].hand=[sp('sh','Shock','Instant','Shock deals 2 damage to any target.')];s=ok(s,'CAST',{iid:'sh'});s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'g'}]});
 s=ok(s,'RESOLVE_COMBAT',{confirm:true,blocks:[]});assert.equal(s.players[1].life,40,'sigue bloqueado aunque el bloqueador murió (509.1h)');
 s=game();s.players[0].battlefield=[crit('gx','Green','Beast','',3,3,{colors:['G']})];s.players[1].battlefield=[crit('pw','White Knight','Knight','Protection from green',2,2,{colors:['W']})];
 s=ok(s,'COMBAT',{attackers:['gx'],targetPlayerId:'b'});s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'gx',blockerId:'pw'}]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
 assert(s.players[1].battlefield.some(x=>x.iid==='pw'),'protección previene el daño');
});

test('pila: contrarrestar una habilidad no deja cartas fantasma; Force of Negation exilia',()=>{
 let s=game();s.players[0].battlefield=[crit('mg','Marrow-Gnawer','Rat Rogue','All Rats have fear.\n{T}, Sacrifice a Rat: Create X 1/1 black Rat creature tokens, where X is the number of Rats you control.',2,3),rat('r1')];
 s.players[1].hand=[sp('st','Stifle','Instant','Counter target activated or triggered ability.')];
 s=ok(s,'ACTIVATE',{iid:'mg',index:0,sacrifice:['r1']});const ab=s.stack.at(-1).id;s=ok(s,'CAST',{iid:'st'},'b');s=ok(s,'RESOLVE',{targets:[{spellId:ab}]},'b');
 assert(!s.players[0].graveyard.some(x=>x.iid==='mg'),'sin fantasma');assert(s.players[0].battlefield.some(x=>x.iid==='mg'));
 s=game();s.players[0].hand=[card('sig','Arcane Signet','Artifact','{T}: Add {C}.')];s.players[1].hand=[sp('fon','Force of Negation','Instant',"Counter target noncreature spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.")];
 s=ok(s,'CAST',{iid:'sig'});s=ok(s,'CAST',{iid:'fon'},'b');s=ok(s,'RESOLVE',{targets:[{spellId:s.stack[0].id}]},'b');assert(s.players[0].exile.some(x=>x.iid==='sig'));
});

test('muertes simultáneas: cada observador ve todas las muertes (603.10a)',()=>{
 let s=game();s.players[1].battlefield=[crit('zu','Zulaport Cutthroat','Human Rogue','Whenever this creature or another creature you control dies, each opponent loses 1 life and you gain 1 life.',1,1),crit('mo','Morbid Opportunist','Human Rogue','Whenever one or more other creatures die, draw a card. This ability triggers only once each turn.',1,1)];s.players[1].library=[bear('l1'),bear('l2')];
 s.players[0].hand=[sp('wr','Wrath','Sorcery','Destroy all creatures.')];s=ok(s,'CAST',{iid:'wr'});s=ok(s,'RESOLVE');
 const zu=s.stack.filter(e=>e.card.name==='Zulaport Cutthroat').length,mo=s.stack.filter(e=>e.card.name==='Morbid Opportunist').length;assert.equal(zu,2);assert.equal(mo,1);
});

test('el monarca roba al avanzar fase a fase; si el activo pierde el turno pasa solo',()=>{
 let s=game(3);s.monarch='a';const h=s.players[0].hand.length;for(let i=0;i<3;i++)s=ok(s,'NEXT_PHASE');assert.equal(s.phase,4);assert.equal(s.players[0].hand.length,h+1);
 s=game(3);s=ok(s,'LIFE',{delta:-40},'a');assert.equal(s.activePlayerId,'b');
});

test('Pacifism impide atacar; Witch\'s Cottage pone la carta encima de la biblioteca',()=>{
 let s=game();s.players[0].battlefield=[bear('x'),card('pa','Pacifism','Enchantment — Aura',"Enchant creature\nEnchanted creature can't attack or block.",{attachedTo:'x'})];
 assert.match(act(s,'COMBAT',{attackers:['x'],targetPlayerId:'b'}).error,/no puede atacar/);
 s=game();s.players[0].graveyard=[bear('dead')];s.players[0].hand=[card('wc',"Witch's Cottage",'Land — Swamp',"When Witch's Cottage enters untapped, you may put target creature card from your graveyard on top of your library.")];
 s=ok(s,'CAST',{iid:'wc'});s=drain(s);if(s.prompts?.length)s=ok(s,'CHOOSE',{promptId:s.prompts[0].id,picks:['dead']});
 assert.equal(s.players[0].library.at(-1).iid,'dead','encima de la biblioteca');assert(!s.players[0].hand.some(x=>x.iid==='dead'));
});
