const test=require('node:test'),assert=require('node:assert/strict');
const MC=require('../src/core.js');
let seq=0;
function game(){const s=MC.createGame({seed:3,players:['a','b'].map(id=>({id,name:id.toUpperCase(),deck:{cards:[]}}))});for(const p of s.players){p.hand=[];p.battlefield=[];p.library=Array.from({length:10},(_,i)=>({iid:p.id+'-lib'+i,name:'Wastes',type_line:'Basic Land',oracle_text:'',counters:{}}));p.turnDrawn=true;}return s;}
function act(s,type,payload={},actorId='a'){return MC.dispatch(s,{id:'v7-'+(++seq),type,payload,actorId});}
function ok(s,type,payload={},actorId='a'){const r=act(s,type,payload,actorId);assert.equal(r.ok,true,r.error);return r.state;}
const bear=(iid,extra={})=>({iid,name:'Bear '+iid,type_line:'Creature — Bear',power:'2',toughness:'2',tapped:false,sick:false,damage:0,counters:{},...extra});

test('contadores +1/+0, +0/+1 y -1/-1 cambian fuerza y resistencia; a 0 desaparecen',()=>{
 let s=game();s.players[0].battlefield=[bear('x')];
 s=ok(s,'COUNTER',{iid:'x',name:'+1/+0',delta:2});s=ok(s,'COUNTER',{iid:'x',name:'+0/+1',delta:1});
 let c=s.players[0].battlefield[0];assert.equal(MC.power(c,s.players[0]),4);assert.equal(MC.toughness(c),3);assert.deepEqual(MC.ptCounters(c),[2,1]);
 s=ok(s,'COUNTER',{iid:'x',name:'+1/+0',delta:-2});assert.equal(s.players[0].battlefield[0].counters['+1/+0'],undefined);
 s=ok(s,'COUNTER',{iid:'x',name:'Carga',delta:3});assert.equal(s.players[0].battlefield[0].counters.Carga,3);
 s=ok(s,'COUNTER',{iid:'x',name:'-1/-1',delta:3});assert.equal(s.players[0].battlefield.length,0);assert.equal(s.players[0].graveyard[0].iid,'x');
 assert.equal(act(game(),'COUNTER',{iid:'x',name:'<script>',delta:1}).ok,false);
});

test('fichas con tipo, cantidad, habilidades y artefactos; las ratas cuentan para Rat Colony',()=>{
 let s=game();s.players[0].battlefield=[{...bear('rc'),name:'Rat Colony',type_line:'Creature — Rat',power:'2',toughness:'1'}];
 s=ok(s,'TOKEN',{name:'Rata',types:'Rat',power:1,toughness:1,count:3,colors:['B']});
 const rats=s.players[0].battlefield.filter(c=>c.token);assert.equal(rats.length,3);assert.equal(rats[0].type_line,'Token Creature — Rat');
 assert.equal(MC.power(s.players[0].battlefield[0],s.players[0]),5);
 s=ok(s,'TOKEN',{name:'Draco',types:'Drake',power:2,toughness:2,keywords:['Flying','Nope'],colors:['U']});assert.deepEqual(s.players[0].battlefield.at(-1).keywords,['Flying']);
 s=ok(s,'TOKEN',{kind:'artifact',name:'Tesoro',types:'Treasure',text:'{T}, Sacrifice this artifact: Add one mana of any color.'});const t=s.players[0].battlefield.at(-1);assert.equal(t.type_line,'Token Artifact — Treasure');assert.equal(t.power,undefined);
 assert.equal(act(s,'TOKEN',{count:50}).ok,false);
 s=ok(s,'MOVE',{iid:t.iid,from:'battlefield',to:'graveyard'});assert(!s.players[0].graveyard.some(c=>c.iid===t.iid));
});

test('la reserva de maná se conserva dentro de la fase y se vacía al terminarla (106.4)',()=>{
 let s=game();s=ok(s,'MANA',{color:'G',delta:3});s=ok(s,'MANA',{color:'G',delta:-1});assert.equal(s.players[0].mana.G,2);
 s=ok(s,'NEXT_PHASE');assert.equal(s.players[0].mana.G,0);s=ok(s,'MANA',{color:'G',delta:1});s=ok(s,'NEXT_TURN');assert.equal(s.players[0].mana.G,0);
});

test('tomar del cementerio rival: la carta recuerda a su dueño y vuelve a su cementerio',()=>{
 let s=game();s.players[1].graveyard=[bear('dead')];
 assert.equal(act(s,'MOVE',{iid:'dead',from:'graveyard',to:'hand'}).ok,false);
 assert.equal(act(s,'TAKE',{fromPlayerId:'b',from:'library',iid:'dead',to:'hand'}).ok,false);
 s=ok(s,'TAKE',{fromPlayerId:'b',from:'graveyard',iid:'dead',to:'battlefield'});
 assert.equal(s.players[1].graveyard.length,0);assert.equal(s.players[0].battlefield[0].ownerId,'b');
 s=ok(s,'COUNTER',{iid:'dead',name:'-1/-1',delta:2});
 assert.equal(s.players[1].graveyard[0].iid,'dead');assert.equal(s.players[1].graveyard[0].ownerId,undefined);
 s.players[1].exile=[bear('ex')];s=ok(s,'TAKE',{fromPlayerId:'b',from:'exile',iid:'ex',to:'hand'});s=ok(s,'MOVE',{iid:'ex',from:'hand',to:'graveyard'});assert(s.players[1].graveyard.some(c=>c.iid==='ex'));
 const v=MC.viewFor(s,'a');assert(v.players[1].graveyard.length>0,'el cementerio rival es público');
});

test('habilidades: dar prisa permite atacar recién llegada; vuelven a las impresas al salir del campo',()=>{
 let s=game();s.players[0].battlefield=[bear('h',{sick:true,keywords:['Trample']})];
 assert.equal(act(s,'COMBAT',{attackers:['h'],targetPlayerId:'b'}).ok,false);
 s=ok(s,'KEYWORD',{iid:'h',keyword:'Haste',on:true});s=ok(s,'KEYWORD',{iid:'h',keyword:'Trample',on:false});
 assert.deepEqual(s.players[0].battlefield[0].keywords,['Haste']);
 s=ok(s,'COMBAT',{attackers:['h'],targetPlayerId:'b'});s=ok(s,'DECLARE_BLOCKS',{blocks:[]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});assert.equal(s.players[1].life,38);
 s=ok(s,'MOVE',{iid:'h',from:'battlefield',to:'hand'});assert.deepEqual(s.players[0].hand[0].keywords,['Trample']);assert.equal(s.players[0].hand[0].baseKeywords,undefined);
 assert.equal(act(s,'KEYWORD',{iid:'h',keyword:'Hexproof',on:true}).ok,false);
 s.players[0].battlefield=[bear('m')];s=ok(s,'KEYWORD',{iid:'m',keyword:'Menace',on:true});s.players[1].battlefield=[bear('g')];
 s=ok(s,'NEXT_TURN');s=ok(s,'NEXT_TURN',{},'b');s=ok(s,'COMBAT',{attackers:['m'],targetPlayerId:'b'});
 assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'m',blockerId:'g'}]},'b').ok,false,'amenaza exige dos bloqueadores');
});

test('instantáneos y destello en turno ajeno; el resto solo en tu turno con la pila vacía',()=>{
 let s=game();s.activePlayerId='a';
 const bolt={iid:'i1',name:'Shock',type_line:'Instant',mana_cost:''},sorc={iid:'s1',name:'Divination',type_line:'Sorcery',mana_cost:''};
 s.players[1].hand=[bolt,sorc,bear('b1'),bear('f1',{keywords:['Flash']})];s.players[0].hand=[bear('a1'),bear('a2')];
 assert.match(act(s,'CAST',{unpaid:true,iid:'s1'},'b').error,/solo en tu turno/);
 assert.equal(act(s,'CAST',{unpaid:true,iid:'b1'},'b').ok,false);
 s=ok(s,'CAST',{unpaid:true,iid:'a1'});
 assert.match(act(s,'CAST',{unpaid:true,iid:'a2'}).error,/pila/);
 s=ok(s,'CAST',{unpaid:true,iid:'i1'},'b');s=ok(s,'CAST',{unpaid:true,iid:'f1'},'b');
 s=ok(s,'RESOLVE',{},'b');s=ok(s,'RESOLVE',{},'b');
 assert.equal(act(s,'RESOLVE',{},'b').ok,false,'el hechizo de A lo resuelve A');
 s=ok(s,'RESOLVE');assert.equal(s.stack.length,0);
});

test('la vida no baja de 0 y el jugador queda eliminado',()=>{
 let s=game();s=ok(s,'LIFE',{delta:-55},'b');
 assert.equal(s.players[1].life,0);assert.equal(s.players[1].eliminated,true);assert.equal(s.winnerId,'a');
});
