const test=require('node:test');
const assert=require('node:assert/strict');
const MC=require('../src/core.js');
const FX=require('../src/effects.js');
const mana=v=>({W:0,U:0,B:0,R:0,G:0,C:0,...v});
let seq=0;
function game(n=3,bots=[]){const s=MC.createGame({seed:7,players:['a','b','c','d'].slice(0,n).map(id=>({id,name:id.toUpperCase(),bot:bots.includes(id),deck:{cards:[]}}))});for(const p of s.players){p.hand=[];p.battlefield=[];p.library=Array.from({length:10},(_,i)=>({iid:p.id+'-lib'+i,name:'Wastes',type_line:'Basic Land',oracle_text:'',counters:{}}));p.mana=mana({});p.turnDrawn=true;}return s;}
function act(s,type,payload={},actorId=s.activePlayerId){return MC.dispatch(s,{id:'v6-'+(++seq),type,payload,actorId});}
function ok(s,type,payload={},actorId){const r=act(s,type,payload,actorId);assert.equal(r.ok,true,r.error);return r.state;}
const card=(iid,name,type_line,oracle_text='',extra={})=>({iid,name,type_line,oracle_text,mana_cost:'{0}',tapped:false,sick:false,damage:0,counters:{},...extra});
const bear=(iid,extra={})=>card(iid,'Bear '+iid,'Creature — Bear','',{power:'2',toughness:'2',...extra});
const basic=(iid,t='Forest')=>card(iid,t,'Basic Land — '+t,'');

test('effects: parses common spells and keeps unknown text manual',()=>{
 assert.deepEqual(FX.spellSteps({name:'Lightning Bolt',type_line:'Instant',oracle_text:'Lightning Bolt deals 3 damage to any target.'}),[{type:'damage',amount:3,target:'any'}]);
 assert.deepEqual(FX.spellSteps({name:'Murder',type_line:'Instant',oracle_text:'Destroy target creature.'}),[{type:'destroy',target:'creature'}]);
 assert.equal(FX.spellSteps({name:'Chaos Warp',type_line:'Instant',oracle_text:'The owner of target permanent shuffles it into their library.'}),null);
 assert.equal(FX.spellSteps({name:'Divination',type_line:'Sorcery',oracle_text:'Draw two cards.\nReplicate {2}'}),null);
 assert.deepEqual(FX.etbSteps({name:'Elvish Visionary',type_line:'Creature — Elf',oracle_text:'When Elvish Visionary enters, draw a card.'}),[{type:'draw',count:1,who:'you'}]);
 assert.equal(FX.etbSteps({name:'Maybe',type_line:'Creature',oracle_text:'When Maybe enters, you may draw a card.'}),null);
});

test('mana: dual lands ask for a color, mana rocks add their amount, painlands hurt for colored mana',()=>{
 let s=game();const p=s.players[0];p.battlefield=[card('dual','Watery Grave','Land — Island Swamp','({T}: Add {U} or {B}.)\nAs Watery Grave enters, you may pay 2 life.'),card('ring','Sol Ring','Artifact','{T}: Add {C}{C}.'),card('pain','Adarkar Wastes','Land','{T}: Add {C}.\n{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.')];
 assert.match(act(s,'TAP',{iid:'dual',tapped:true}).error,/elige el color/);
 s=ok(s,'TAP',{iid:'dual',tapped:true,color:'B'});assert.equal(s.players[0].mana.B,1);
 s=ok(s,'TAP',{iid:'ring',tapped:true});assert.equal(s.players[0].mana.C,2);
 assert.match(act(s,'TAP',{iid:'pain',tapped:true}).error,/elige el color/);s=ok(s,'TAP',{iid:'pain',tapped:true,color:'W'});assert.deepEqual(s.players[0].mana,mana({B:1,C:2,W:1}));assert.equal(s.players[0].life,39,'la tierra de dolor hace 1 de daño');
});

test('autopay: command tower follows commander identity and sol ring covers generic',()=>{
 const s=game();const p=s.players[0];p.command=[card('cmd','Cmdr','Legendary Creature','',{isCommander:true,color_identity:['G','U']})];
 p.hand=[card('x','Spell','Sorcery','',{mana_cost:'{3}{U}'})];
 p.battlefield=[card('tower','Command Tower','Land',"{T}: Add one mana of any color in your commander's color identity."),card('ring','Sol Ring','Artifact','{T}: Add {C}{C}.'),basic('f1')];
 const plan=MC.autoPaymentPlan(s,'a','x');assert.equal(plan.ok,true,plan.reason);assert.equal(plan.colors.tower.color,'U');assert(plan.landIds.includes('ring'));
 const r=ok(s,'CAST',{iid:'x',autoPay:true,autoPayRevision:s.revision,landIds:plan.landIds},'a');assert.equal(r.stack.length,1);assert(r.players[0].battlefield.filter(c=>plan.landIds.includes(c.iid)).every(c=>c.tapped));
});

test('targeted removal, damage to creatures and commander returns to command zone',()=>{
 let s=game();s.players[1].battlefield=[bear('bb'),card('cmdr','Boss','Legendary Creature — Boss','',{power:'3',toughness:'3',isCommander:true})];
 s.players[0].hand=[card('bolt','Lightning Bolt','Instant','Lightning Bolt deals 3 damage to any target.'),card('kill','Murder','Instant','Destroy target creature.')];
 s=ok(s,'CAST',{iid:'bolt'});const plan=MC.effectPlan(s,s.stack.at(-1));assert.equal(plan.targeted.length,1);assert(plan.targeted[0].options.some(o=>o.target.iid==='bb'));
 s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'bb'}]});assert.equal(s.players[1].battlefield.some(c=>c.iid==='bb'),false);assert.equal(s.players[1].graveyard.at(-1).iid,'bb');
 s=ok(s,'CAST',{iid:'kill'});s=ok(s,'RESOLVE',{targets:[{playerId:'b',iid:'cmdr'}]});assert.equal(s.players[1].command.at(-1).iid,'cmdr');
 assert.equal(act(s,'RESOLVE',{targets:[{playerId:'b',iid:'nope'}]}).ok,false);
});

test('invalid targets roll back; missing targets fall back to manual resolution',()=>{
 let s=game();assert.match(act(s,'CAST',{iid:'x'}).error||'',/./);s.players[0].hand=[card('m','Murder','Instant','Destroy target creature.')];assert.match(act(s,'CAST',{iid:'m'}).error,/objetivos legales/,'601.2c');s.players[1].battlefield=[bear('bb')];s=ok(s,'CAST',{iid:'m'});
 const before=JSON.stringify(s);const bad=act(s,'RESOLVE',{targets:[{playerId:'b',iid:'ghost'}]});assert.equal(bad.ok,false);assert.equal(JSON.stringify(bad.state),before);
 const r=act(s,'RESOLVE',{});assert.equal(r.ok,true);assert(r.events.some(e=>e.type==='manual'));
});

test('counterspell removes the spell below it; tokens, ramp and wipes',()=>{
 let s=game();const a=s.players[0];a.hand=[card('big','Big Thing','Sorcery','Draw two cards.')];s=ok(s,'CAST',{iid:'big'});
 s.players[1].hand=[card('cs','Counterspell','Instant','Counter target spell.')];s=ok(s,'CAST',{iid:'cs'},'b');
 s=ok(s,'RESOLVE',{targets:[{spellId:s.stack[0].id}]});assert.equal(s.stack.length,0);assert.equal(s.players[0].graveyard.at(-1).iid,'big');assert.equal(s.players[0].hand.length,0);
 s.players[0].hand=[card('alarm','Raise the Alarm','Instant','Create two 1/1 white Soldier creature tokens.'),card('rg','Rampant Growth','Sorcery','Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'),card('wrath','Wrath of God','Sorcery',"Destroy all creatures. They can't be regenerated.")];
 s.players[0].library=[basic('lib1','Island'),bear('libbear')];
 s=ok(s,'CAST',{iid:'alarm'});s=ok(s,'RESOLVE');assert.equal(s.players[0].battlefield.filter(c=>c.token).length,2);
 s=ok(s,'CAST',{iid:'rg'});s=ok(s,'RESOLVE');const land=s.players[0].battlefield.find(c=>c.iid==='lib1');assert(land&&land.tapped);assert.equal(s.players[0].library.length,1);
 s.players[1].battlefield=[bear('b1'),bear('b2',{keywords:['Indestructible']})];
 s=ok(s,'CAST',{iid:'wrath'});s=ok(s,'RESOLVE');assert.equal(s.players[0].battlefield.filter(c=>c.token).length,0);assert.deepEqual(s.players[1].battlefield.map(c=>c.iid),['b2']);
});

test('ETB draw triggers onto the stack when the creature enters',()=>{
 let s=game();s.players[0].library=[bear('x1'),bear('x2')];s.players[0].hand=[card('ev','Elvish Visionary','Creature — Elf','When Elvish Visionary enters, draw a card.',{power:'1',toughness:'1'})];
 s=ok(s,'CAST',{iid:'ev'});assert.equal(s.stack[0].effectStatus,'supported');s=ok(s,'RESOLVE');assert.equal(s.stack.length,1,'la habilidad de entrar va a la pila');assert.equal(s.stack[0].ability,true);s=ok(s,'RESOLVE');assert.equal(s.players[0].hand.length,1);assert(s.players[0].battlefield.some(c=>c.iid==='ev'));
});

test('combat: blockers trade, first strike wins, trample and lifelink, deathtouch',()=>{
 let s=game();s.phase=1;const a=s.players[0],b=s.players[1];
 a.battlefield=[bear('att1'),bear('fs',{keywords:['First strike']}),card('tr','Troll','Creature','',{power:'5',toughness:'5',keywords:['Trample','Lifelink']})];
 b.battlefield=[bear('blk1'),bear('blk2'),card('dt','Snake','Creature','',{power:'1',toughness:'1',keywords:['Deathtouch']})];
 s=ok(s,'COMBAT',{attackers:['att1','fs','tr'],targetPlayerId:'b'});
 s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'att1',blockerId:'blk1'},{attackerId:'fs',blockerId:'blk2'},{attackerId:'tr',blockerId:'dt'}]},'b');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
 const A=s.players[0].battlefield.map(c=>c.iid),B=s.players[1].battlefield.map(c=>c.iid);
 assert.deepEqual(A,['fs']);assert.deepEqual(B,[]);// trade, first strike survives, deathtouch kills troll
 assert.equal(s.players[1].life,36);assert.equal(s.players[0].life,45);// 4 tramples over; lifelink 5
});

test('combat: flying and menace block legality, defender cannot attack',()=>{
 let s=game();const a=s.players[0],b=s.players[1];a.battlefield=[bear('fly',{keywords:['Flying']}),bear('men',{keywords:['Menace']}),bear('wall',{keywords:['Defender']})];b.battlefield=[bear('g1'),bear('g2'),bear('reach',{keywords:['Reach']})];
 assert.equal(act(s,'COMBAT',{attackers:['wall'],targetPlayerId:'b'}).ok,false);
 s=ok(s,'COMBAT',{attackers:['fly','men'],targetPlayerId:'b'});
 assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'fly',blockerId:'g1'}]},'b').ok,false);
 assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'men',blockerId:'g1'}]},'b').ok,false);
 assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'fly',blockerId:'reach'},{attackerId:'men',blockerId:'g1'},{attackerId:'men',blockerId:'g2'}]},'b').ok,true);
});

test('defender declares blocks; attacker resolves with them; bots block automatically',()=>{
 let s=game(3,['b']);const a=s.players[0];a.battlefield=[bear('a1'),card('big','Giant','Creature','',{power:'6',toughness:'6'})];s.players[1].battlefield=[card('wall','Wall','Creature','',{power:'0',toughness:'7',keywords:['Defender']})];s.players[2].battlefield=[bear('c1')];
 s=ok(s,'COMBAT',{attackers:['big'],targetPlayerId:'b'});assert.deepEqual(s.pendingCombat.blocks,[{attackerId:'big',blockerId:'wall'}]);
 s=ok(s,'RESOLVE_COMBAT',{confirm:true});assert.equal(s.players[1].life,40);assert(s.players[1].battlefield.some(c=>c.iid==='wall'));
 s=ok(s,'NEXT_TURN');s=ok(s,'NEXT_TURN',{},'b');s=ok(s,'NEXT_TURN',{},'c');
 s=ok(s,'COMBAT',{attackers:['a1'],targetPlayerId:'c'});assert.equal(act(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'a1',blockerId:'c1'}]},'a').ok,false);
 s=ok(s,'DECLARE_BLOCKS',{blocks:[{attackerId:'a1',blockerId:'c1'}]},'c');s=ok(s,'RESOLVE_COMBAT',{confirm:true});
 assert.equal(s.players[2].life,40);assert.equal(s.players[0].battlefield.length,1);assert.equal(s.players[2].battlefield.length,0);
});

test('bot chump-blocks only when the attack is dangerous',()=>{
 let s=game(2,['b']);s.players[1].battlefield=[card('tiny','Tiny','Creature','',{power:'1',toughness:'1'})];s.players[0].battlefield=[card('dragon','Dragon','Creature','',{power:'5',toughness:'5'})];
 s=ok(s,'COMBAT',{attackers:['dragon'],targetPlayerId:'b'});assert.deepEqual(s.pendingCombat.blocks,[]);
 s=game(2,['b']);s.players[1].life=4;s.players[1].battlefield=[card('tiny','Tiny','Creature','',{power:'1',toughness:'1'})];s.players[0].battlefield=[card('dragon','Dragon','Creature','',{power:'5',toughness:'5'})];
 s=ok(s,'COMBAT',{attackers:['dragon'],targetPlayerId:'b'});assert.deepEqual(s.pendingCombat.blocks,[{attackerId:'dragon',blockerId:'tiny'}]);
});

test('bot does not suicide into a bigger blocker and finishes a weak opponent',()=>{
 let s=game(3,['a']);const me=s.players[0];me.battlefield=[bear('my')];s.players[1].battlefield=[card('ogre','Ogre','Creature','',{power:'4',toughness:'4'})];s.players[2].life=2;
 const r=MC.botTurn(s,'a');assert(r.state.pendingCombat);assert.equal(r.state.pendingCombat.targetPlayerId,'c');
 s=game(2,['a']);s.players[0].battlefield=[bear('my')];s.players[1].battlefield=[card('ogre','Ogre','Creature','',{power:'4',toughness:'4'})];
 const r2=MC.botTurn(s,'a');assert.equal(r2.state.pendingCombat,null);assert.equal(r2.state.activePlayerId,'b');
});

test('bot plays the land that fixes its colors and kills a threat with removal',()=>{
 let s=game(2,['a']);const me=s.players[0];me.landsPlayed=0;me.hand=[basic('forest','Forest'),basic('swamp','Swamp'),card('doom','Doom Blade','Instant','Destroy target creature.',{mana_cost:'{1}{B}'})];me.battlefield=[basic('f0','Forest')];
 s.players[1].battlefield=[card('angel','Angel','Creature','',{power:'4',toughness:'4',keywords:['Flying']})];
 const r=MC.botTurn(s,'a');const st=r.state;assert(st.players[0].battlefield.some(c=>c.iid==='swamp'));assert.equal(st.players[1].battlefield.length,0);assert(st.players[0].graveyard.some(c=>c.iid==='doom'));
});

test('stress: four bots play 40 turns with varied cards without errors or lost cards',()=>{
 const pool=[basic('l','Forest'),basic('l','Swamp'),basic('l','Mountain'),card('l','Watery Grave','Land — Island Swamp','({T}: Add {U} or {B}.)'),card('l','Sol Ring','Artifact','{T}: Add {C}{C}.',{mana_cost:'{1}'}),
  bear('l',{mana_cost:'{1}{G}'}),card('l','Flyer','Creature — Bird','',{power:'2',toughness:'1',keywords:['Flying'],mana_cost:'{1}{U}'}),card('l','Lightning Bolt','Instant','Lightning Bolt deals 3 damage to any target.',{mana_cost:'{R}'}),
  card('l','Murder','Instant','Destroy target creature.',{mana_cost:'{1}{B}{B}'}),card('l','Divination','Sorcery','Draw two cards.',{mana_cost:'{2}{U}'}),card('l','Raise the Alarm','Instant','Create two 1/1 white Soldier creature tokens.',{mana_cost:'{1}'}),
  card('l','Rampant Growth','Sorcery','Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',{mana_cost:'{1}{G}'}),card('l','Troll','Creature','',{power:'4',toughness:'4',keywords:['Trample'],mana_cost:'{3}{G}'}),card('l','Wrath of God','Sorcery','Destroy all creatures.',{mana_cost:'{2}{W}{W}'}),card('l','Mystery','Sorcery','Something nobody understands.',{mana_cost:'{1}'})];
 const deck=()=>({commander:card('c','Boss','Legendary Creature — Boss','',{power:'3',toughness:'3',mana_cost:'{2}{B}{G}',color_identity:['B','G']}),cards:Array.from({length:99},(_,i)=>{const c={...pool[i%pool.length]};delete c.iid;return c;})});
 let s=MC.createGame({seed:99,players:['a','b','c','d'].map(id=>({id,name:id,bot:true,deck:deck()}))});
 const count=st=>st.players.reduce((n,p)=>n+['library','hand','battlefield','graveyard','exile','command','outside'].reduce((m,z)=>m+(p[z]||[]).filter(c=>!c.token).length,0),0)+st.stack.filter(e=>!e.card.token).length;
 const total=count(s);let turns=0;
 for(let i=0;i<400&&!s.winnerId&&turns<40;i++){
  const before=s.turn;
  if(s.pendingCombat){s=ok(s,'RESOLVE_COMBAT',{confirm:true},s.activePlayerId);}
  else{const r=MC.botTurn(s,s.activePlayerId);assert.equal(r.error,undefined,r.error);s=r.state;}
  assert.equal(count(s),total);if(s.turn!==before)turns++;
 }
 assert(turns>=10||s.winnerId,'la partida avanza');
});
