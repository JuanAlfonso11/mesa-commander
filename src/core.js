/* Mesa Commander — deterministic, local table engine. Free-table rules are intentional. */
(function(root, factory) {
  var api=factory(); if(typeof module==='object'&&module.exports) module.exports=api; root.MC=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const FX=globalThis.MFX||(typeof require==='function'?require('./effects.js'):null);
const BOT=()=>globalThis.MBOT||(typeof require==='function'?require('./bots.js'):null);
const PHASES=['Inicio','Principal 1','Combate','Principal 2','Final','Limpieza'];
const COLORS=['W','U','B','R','G','C'];
const ZONES=['library','hand','battlefield','graveyard','exile','command'];
const SUMMARY='Mesa libre con asistencia. La app aplica los efectos que reconoce en el texto de las cartas (robar, daño, destruir, fichas, buscar tierras…); el resto se aplica a mano. Los bots juegan tierras, criaturas y hechizos que entienden, eligen objetivos, atacan con criterio y bloquean.';
const clone=x=>JSON.parse(JSON.stringify(x));
function entropy(){if(globalThis.crypto?.getRandomValues)return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];return (Date.now()^Math.floor(Math.random()*4294967296))>>>0;}
function gameId(){return 'mesa-'+(globalThis.crypto?.randomUUID?globalThis.crypto.randomUUID():entropy().toString(36)+'-'+entropy().toString(36));}
const isLand=c=>/\bLand\b/i.test(c.type_line||'');
const isCreature=c=>/\bCreature\b/i.test(c.type_line||'');
function simpleLandMana(c){
 if(!isLand(c)||isCreature(c)||c.card_faces?.length>1)return null;
 const mapping={Plains:'W',Island:'U',Swamp:'B',Mountain:'R',Forest:'G'};
 if(/\bBasic\b/i.test(c.type_line||'')){
  const types=Object.keys(mapping).filter(t=>new RegExp('\\b'+t+'\\b').test(c.type_line));
  if(types.length===1)return mapping[types[0]];
  if(c.name==='Wastes')return 'C';
 }
 return (c.oracle_text||'').trim().match(/^\{T\}: Add \{([WUBRGC])\}\.$/)?.[1]||null;
}
// Fuente de maná automática: primero la regla sencilla de siempre, luego tierras duales y artefactos de maná.
function manaSource(c,p){const simple=simpleLandMana(c);if(simple)return {options:[simple],amount:1};return FX?FX.manaAbility(c,p):null;}
const hasKw=(c,k)=>(c.keywords||[]).includes(k);
function toughness(c){return (Number(c.toughness)||0)+(Number(c.counters?.['+1/+1'])||0)-(Number(c.counters?.['-1/-1'])||0);}
const isPermanent=c=>/\b(Land|Creature|Artifact|Enchantment|Planeswalker|Battle)\b/i.test(c.type_line||'');
function random(s){let x=s.seed|0;x^=x<<13;x^=x>>>17;x^=x<<5;s.seed=x>>>0;return s.seed/4294967296;}
function shuffle(s,a){for(let i=a.length-1;i>0;i--){const j=Math.floor(random(s)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function player(s,id){const p=s.players.find(p=>p.id===id);if(!p)throw Error('Jugador no encontrado.');return p;}
function instance(s,c){return {...clone(c),iid:'card-'+(++s.nextInstance),tapped:false,sick:true,damage:0,counters:{}};}
function log(s,p,text,type='info'){const e={id:'event-'+(++s.nextEvent),turn:s.turn,playerId:p?.id||null,text,type};s.log.push(e);return e;}
function draw(s,p,n){n=Math.min(100,Math.max(0,Math.floor(Number(n)||0)));let done=0;while(done<n&&p.library.length){p.hand.push(p.library.pop());done++;}log(s,p,p.name+' roba '+done+' carta(s).','draw');if(done<n)log(s,p,'Biblioteca vacía: resuelve manualmente la consecuencia de intentar robar.','warning');return done;}
function status(s){for(const p of s.players){p.eliminated=p.life<=0||p.poison>=10||Object.values(p.commanderDamage).some(v=>v>=21);}const alive=s.players.filter(p=>!p.eliminated);s.winnerId=s.players.length>1&&alive.length===1?alive[0].id:null;}
function clearMana(s){for(const p of s.players)for(const c of COLORS)p.mana[c]=0;}
function nextTurn(s){clearMana(s);const i=s.players.findIndex(p=>p.id===s.activePlayerId);let n=1;while(n<s.players.length&&s.players[(i+n)%s.players.length].eliminated)n++;const p=s.players[(i+n)%s.players.length];s.activePlayerId=p.id;s.turn++;s.phase=0;s.pendingCombat=null;p.landsPlayed=0;p.turnDrawn=true;for(const c of p.battlefield){c.tapped=false;c.sick=false;c.damage=0;}for(const q of s.players)for(const c of q.battlefield)c.damage=0;draw(s,p,1);log(s,p,'Comienza el turno de '+p.name+'.','turn');}
function createGame(options={}){const ps=options.players||[];if(!ps.length||ps.length>8)throw Error('La mesa admite de 1 a 8 jugadores.');if(new Set(ps.map(p=>p.id)).size!==ps.length||ps.some(p=>!p.id))throw Error('Cada jugador necesita un id único.');const s={id:options.id||gameId(),revision:0,seed:((options.seed===undefined?entropy():Number(options.seed))>>>0)||1,turn:1,activePlayerId:ps[0].id,phase:0,mode:options.mode||'free',players:[],stack:[],responseChecks:false,responseRound:null,pendingCombat:null,log:[],winnerId:null,nextInstance:0,nextEvent:0,appliedActionIds:[],summary:SUMMARY};
for(const info of ps){const p={id:info.id,name:String(info.name||'Jugador').slice(0,60),bot:!!info.bot,life:40,poison:0,commanderDamage:{},commanderCasts:0,hand:[],library:[],battlefield:[],graveyard:[],exile:[],command:[],mana:Object.fromEntries(COLORS.map(c=>[c,0])),mulligans:0,landsPlayed:0,turnDrawn:false,eliminated:false};for(const c of info.deck?.cards||[])p.library.push(instance(s,c));if(info.deck?.commander)p.command.push({...instance(s,info.deck.commander),isCommander:true});shuffle(s,p.library);s.players.push(p);draw(s,p,7);}log(s,null,'Mesa preparada. '+SUMMARY,'info');return s;}
function locate(p,zone,iid){if(!ZONES.includes(zone))throw Error('Zona no válida.');const i=p[zone].findIndex(c=>c.iid===iid);if(i<0)throw Error('La carta no está en tu zona indicada.');return {card:p[zone][i],index:i};}
function requireActive(s,p){if(s.activePlayerId!==p.id)throw Error('Esta acción corresponde al jugador activo.');}
function number(v){if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100000)throw Error('Cantidad no válida.');return v;}
function cost(c,tax=0){if(!isLand(c)&&!String(c.mana_cost||'').trim())return null;let r={generic:tax,W:0,U:0,B:0,R:0,G:0,C:0};const symbols=(c.mana_cost||'').match(/\{[^}]+\}/g)||[];for(const raw of symbols){const v=raw.slice(1,-1);if(/^\d+$/.test(v))r.generic+=Number(v);else if(COLORS.includes(v))r[v]++;else return null;}return r;}
function payment(mana,c,tax){const r=cost(c,tax);if(!r)throw Error('Coste variable, híbrido o especial: realiza el pago manualmente.');const out={...mana};for(const x of COLORS){if(out[x]<r[x])throw Error('Maná insuficiente del color '+x+'.');out[x]-=r[x];}let g=r.generic;for(const x of ['C','W','U','B','R','G']){let n=Math.min(out[x],g);out[x]-=n;g-=n;}if(g>0)throw Error('Maná total insuficiente.');return out;}
function autoPaymentPlan(state,actorId,iid,from='hand'){
 const result={ok:false,reason:'',landIds:[],manaBefore:{},manaAfter:{},tax:0};
 try{
  const p=player(state,actorId);result.manaBefore=Object.fromEntries(COLORS.map(c=>[c,p.mana[c]??0]));result.manaAfter={...result.manaBefore};
  if(!['hand','command'].includes(from))throw Error('El pago automático solo admite mano o zona de mando.');
  const {card}=locate(p,from,iid);result.tax=from==='command'?p.commanderCasts*2:0;
  if(isLand(card))throw Error('Las tierras se juegan sin pagar un coste de hechizo.');
  if(!/^(?:\{(?:\d+|[WUBRGC])\})+$/.test(card.mana_cost||''))throw Error('Coste ausente, variable, híbrido o especial: realiza el pago manualmente.');
  if(/as an additional cost to cast/i.test(card.oracle_text||'')||(card.keywords||[]).some(k=>['Delve','Convoke','Improvise','Offering','Emerge'].includes(k)))throw Error('Esta carta tiene costes o mecanismos especiales: confirma su pago manualmente.');
  const required=cost(card,result.tax);if(!required||Object.values(required).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('El coste no se puede calcular de forma segura; paga manualmente.');
  if(Object.values(result.manaBefore).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Revisa la reserva: el pago automático requiere cantidades enteras no negativas.');
  const remaining={...result.manaBefore},needed={};
  for(const color of COLORS){const used=Math.min(remaining[color],required[color]);remaining[color]-=used;needed[color]=required[color]-used;}
  let generic=required.generic;for(const color of ['C','W','U','B','R','G']){const used=Math.min(remaining[color],generic);remaining[color]-=used;generic-=used;}
  // Fuentes: tierras sencillas, tierras de varios colores y artefactos de maná con una sola habilidad clara.
  const sources=p.battlefield.map((c,index)=>({c,index,ability:manaSource(c,p)})).filter(x=>!x.c.tapped&&x.ability).map(x=>({iid:x.c.iid,options:x.ability.options,amount:x.ability.amount,index:x.index})).sort((a,b)=>a.options.length-b.options.length||a.index-b.index);
  // Asignación de colores obligatorios por emparejamiento (las fuentes flexibles se reservan para lo que nadie más cubre).
  const needs=[];for(const color of COLORS)for(let i=0;i<needed[color];i++)needs.push(color);
  const units=[];sources.forEach((src,si)=>{for(let k=0;k<src.amount;k++)units.push({si,options:src.options});});
  // Las fuentes de varias unidades (p. ej. {C}{C}) siempre son de un solo color, así que cada unidad se empareja sola.
  const unitOf=new Array(units.length).fill(-1);
  function augment(n,seen){for(let u=0;u<units.length;u++){if(seen[u]||!units[u].options.includes(needs[n]))continue;seen[u]=true;if(unitOf[u]<0||augment(unitOf[u],seen)){unitOf[u]=n;return true;}}return false;}
  for(let n=0;n<needs.length;n++){if(!augment(n,[])){throw Error('Falta maná '+needs[n]+' en tu reserva y fuentes disponibles.');}}
  const selected=[...new Set(unitOf.map((n,u)=>n>=0?units[u].si:-1).filter(x=>x>=0))];
  const colorFor=si=>{const used=unitOf.map((n,u)=>n>=0&&units[u].si===si?needs[n]:null).filter(Boolean);return used[0]||sources[si].options[0];};
  const available={...result.manaBefore};for(const si of selected)available[colorFor(si)]+=sources[si].amount;
  const spare=()=>{try{payment(available,card,result.tax);return true;}catch(_){return false;}};
  const order=sources.map((_,si)=>si).filter(si=>!selected.includes(si)).sort((a,b)=>sources[a].options.length-sources[b].options.length||sources[a].index-sources[b].index);
  for(const si of order){if(spare())break;selected.push(si);available[colorFor(si)]+=sources[si].amount;}
  if(!spare())throw Error('No alcanza el maná de tu reserva y tus fuentes enderezadas.');
  // Orden estable: primero las que cubren colores (en orden de color) y luego las de genérico.
  const coloredOrder=[];for(let n=0;n<needs.length;n++){const u=unitOf.indexOf(n);if(u>=0&&!coloredOrder.includes(units[u].si))coloredOrder.push(units[u].si);}
  const final=[...coloredOrder,...selected.filter(si=>!coloredOrder.includes(si))];
  result.manaAfter=payment(available,card,result.tax);result.landIds=final.map(si=>sources[si].iid);result.colors=Object.fromEntries(final.map(si=>[sources[si].iid,{color:colorFor(si),amount:sources[si].amount}]));result.ok=true;return result;
 }catch(error){result.reason=error.message;return result;}
}
function responseStatus(s){
 const enabled=s.responseChecks===true,top=s.stack.at(-1),spellId=top?.id||null;
 const living=s.players.filter(p=>!p.eliminated&&p.life>0&&p.poison<10&&!Object.values(p.commanderDamage||{}).some(n=>n>=21)).map(p=>p.id);
 const passed=enabled&&top&&s.responseRound?.spellId===spellId&&Array.isArray(s.responseRound.passed)?s.responseRound.passed:[];
 const passedIds=enabled&&top?living.filter(id=>passed.includes(id)):[],pendingIds=enabled&&top?living.filter(id=>!passed.includes(id)):[];
 return {enabled,ready:!!top&&(!enabled||(s.responseRound?.spellId===spellId&&pendingIds.length===0)),pendingIds,passedIds,spellId};
}
function resetResponseRound(s){const top=s.stack.at(-1);s.responseRound=s.responseChecks===true&&top?{spellId:top.id,passed:[]}:null;}
// ——— Efectos automáticos (0.6) ———
// Saca una carta del campo respetando fichas y comandantes (el comandante vuelve a la zona de mando).
function leaveBattlefield(s,owner,card,to,reason){
 const i=owner.battlefield.findIndex(c=>c.iid===card.iid);if(i<0)return false;owner.battlefield.splice(i,1);
 card.tapped=false;card.damage=0;card.counters={};card.sick=true;delete card.deathtouched;
 if(card.token){log(s,owner,card.name+' (ficha) deja de existir.','effect');return true;}
 const dest=card.isCommander&&(to==='graveyard'||to==='exile')?'command':to;owner[dest].push(card);
 log(s,owner,card.name+' '+(reason||'')+({graveyard:'va al cementerio',exile:'se exilia',hand:'vuelve a la mano',command:'vuelve a la zona de mando'}[dest])+'.','effect');return true;
}
function lethalDamage(c){return (c.damage||0)>=Math.max(0,toughness(c))||(c.deathtouched&&(c.damage||0)>0);}
// Acciones basadas en estado para criaturas: daño letal o resistencia cero.
function creatureDeaths(s){for(const q of s.players)for(const c of [...q.battlefield]){if(!isCreature(c))continue;if(toughness(c)<=0||(!hasKw(c,'Indestructible')&&lethalDamage(c)))leaveBattlefield(s,q,c,'graveyard','muere y ');}}
function findPermanent(s,playerId,iid){const q=player(s,playerId);const card=q.battlefield.find(c=>c.iid===iid);if(!card)throw Error('El objetivo ya no está en el campo.');return {owner:q,card};}
function effectSteps(card){return FX?FX.stepsFor(card):null;}
// Objetivos legales de un paso, para la interfaz y los bots.
function legalTargets(s,controllerId,step,excludeSpellId){
 const kind=FX.targetKind(step),out=[];if(!kind)return out;const alive=s.players.filter(q=>!q.eliminated);
 if(['any','player','opponent'].includes(kind))for(const q of alive)if(kind!=='opponent'||q.id!==controllerId)out.push({target:{playerId:q.id},label:q.name+' (jugador · '+q.life+' vidas)'});
 if(['any','creature','permanent'].includes(kind)){const spec=kind==='permanent'?FX.permanentSpec(step):FX.PERMANENT_TARGET[kind==='any'?'creature or planeswalker':'creature'];for(const q of alive)for(const c of q.battlefield)if(FX.matchesPermanent(c,spec,q.id,controllerId))out.push({target:{playerId:q.id,iid:c.iid},label:c.name+' de '+q.name+(isCreature(c)?' · '+power(c,q)+'/'+toughness(c):'')});}
 if(kind==='spell')for(const e of s.stack)if(e.id!==excludeSpellId&&FX.matchesSpell(e,step.spell))out.push({target:{spellId:e.id},label:e.card.name+' (en la pila)'});
 // Lo propio al final: así la opción por defecto apunta a un rival.
 const own=o=>o.target.playerId===controllerId||(o.target.spellId&&s.stack.find(e=>e.id===o.target.spellId)?.controllerId===controllerId);
 return [...out.filter(o=>!own(o)),...out.filter(own)];
}
function effectPlan(s,entry){const steps=effectSteps(entry.card);if(!steps)return {supported:false,steps:[],targeted:[]};const targeted=[];steps.forEach((step,index)=>{if(FX.targetKind(step))targeted.push({index,kind:FX.targetKind(step),label:FX.describe(step),options:legalTargets(s,entry.controllerId,step,entry.id)});});return {supported:true,steps:steps.map(x=>({...x,label:FX.describe(x)})),targeted};}
function sameTarget(a,b){return a&&b&&a.playerId===b.playerId&&a.iid===b.iid&&a.spellId===b.spellId;}
function resolveEffect(s,p,c,payload,entryId){
 const steps=effectSteps(c);
 if(!steps){if(!isPermanent(c)||c.oracle_text||c.supportedEffect)log(s,p,'Revisa y aplica manualmente los efectos de '+c.name+'.','manual');return;}
 let targets=Array.isArray(payload.targets)?payload.targets:null;
 const targetedSteps=steps.filter(x=>FX.targetKind(x));
 if(!targets&&payload.targetPlayerId&&targetedSteps.length)targets=[{playerId:payload.targetPlayerId}];
 if(targetedSteps.length&&(!targets||targets.length<targetedSteps.length||payload.manual===true)){if(targets&&targets.length<targetedSteps.length)throw Error('Faltan objetivos para '+c.name+'.');log(s,p,'El efecto de '+c.name+' requiere objetivo o resolución manual.','manual');return;}
 // Validación completa antes de cambiar nada.
 let t=0;const plan=steps.map(step=>{if(!FX.targetKind(step))return {step};const target=targets[t++];if(!target||typeof target!=='object')throw Error('Objetivo no válido.');if(target.playerId)player(s,target.playerId);if(!legalTargets(s,p.id,step,entryId).some(x=>sameTarget(x.target,target)))throw Error('Objetivo no válido para '+FX.describe(step)+'.');return {step,target};});
 let last=null;
 for(const {step,target} of plan){
  const tp=target?.playerId?player(s,target.playerId):null;
  switch(step.type){
   case 'draw':draw(s,step.who==='you'?p:tp,step.count);break;
   case 'gainLife':{let who=p,n=step.amount;if(step.who==='target-controller'){if(!last)break;who=player(s,last.playerId);n=last.power;}who.life+=n;log(s,who,who.name+' gana '+n+' vidas por '+c.name+'.','effect');break;}
   case 'loseLife':{const list=step.who==='you'?[p]:step.who==='each-opponent'?s.players.filter(q=>q.id!==p.id&&!q.eliminated):[tp];for(const q of list){q.life-=step.amount;log(s,q,q.name+' pierde '+step.amount+' vidas por '+c.name+'.','effect');}break;}
   case 'damage':{
    const hitPlayer=q=>{q.life-=step.amount;log(s,p,c.name+' hace '+step.amount+' de daño a '+q.name+'.','effect');};
    const hitCard=(q,card)=>{card.damage=(card.damage||0)+step.amount;log(s,p,c.name+' hace '+step.amount+' de daño a '+card.name+'.','effect');};
    if(target){if(target.iid){const {owner,card}=findPermanent(s,target.playerId,target.iid);hitCard(owner,card);}else hitPlayer(tp);}
    else{const opp=s.players.filter(q=>q.id!==p.id&&!q.eliminated);if(['each-opponent'].includes(step.target))opp.forEach(hitPlayer);if(['each-player','each-creature-player'].includes(step.target))s.players.filter(q=>!q.eliminated).forEach(hitPlayer);if(['each-creature','each-creature-player'].includes(step.target))for(const q of s.players)q.battlefield.filter(isCreature).forEach(x=>hitCard(q,x));if(step.target==='each-opponent-creature')for(const q of opp)q.battlefield.filter(isCreature).forEach(x=>hitCard(q,x));}
    creatureDeaths(s);break;}
   case 'destroy':case 'exile':case 'bounce':{const {owner,card}=findPermanent(s,target.playerId,target.iid);last={playerId:owner.id,power:power(card,owner)};if(step.type==='destroy'&&hasKw(card,'Indestructible')){log(s,p,card.name+' es indestructible y no se destruye.','effect');break;}leaveBattlefield(s,owner,card,{destroy:'graveyard',exile:'exile',bounce:'hand'}[step.type],'');break;}
   case 'wipe':{const re={creatures:/\bCreature\b/,artifacts:/\bArtifact\b/,enchantments:/\bEnchantment\b/,'nonland permanents':/^(?!.*\bLand\b)/}[step.what];for(const q of s.players)for(const x of [...q.battlefield])if(re.test(x.type_line||'')&&!hasKw(x,'Indestructible'))leaveBattlefield(s,q,x,'graveyard','');break;}
   case 'counter':{const i=s.stack.findIndex(e=>e.id===target.spellId);if(i<0)throw Error('El hechizo objetivo ya no está en la pila.');const [e]=s.stack.splice(i,1);const owner=player(s,e.controllerId);owner[e.card.isCommander?'command':'graveyard'].push(e.card);log(s,p,c.name+' contrarresta '+e.card.name+'.','effect');resetResponseRound(s);break;}
   case 'token':{const who=step.who==='target-controller'?(last?player(s,last.playerId):null):p;if(!who)break;for(let i=0;i<step.count;i++)who.battlefield.push(instance(s,{name:step.name,type_line:'Token Creature — '+step.name,power:String(step.power),toughness:String(step.toughness),oracle_text:'',keywords:step.keywords,colors:step.colors,token:true}));log(s,who,who.name+' crea '+step.count+' ficha(s) '+step.power+'/'+step.toughness+' de '+step.name+'.','token');break;}
   case 'counters':{const list=step.target==='each-own'?p.battlefield.filter(isCreature):[findPermanent(s,target.playerId,target.iid).card];for(const x of list)x.counters['+1/+1']=(x.counters['+1/+1']||0)+step.count;log(s,p,c.name+' pone '+step.count+' contador(es) +1/+1 en '+(list.length===1?list[0].name:list.length+' criaturas')+'.','effect');break;}
   case 'ramp':{
    const identity=p.command.find(x=>x.isCommander)?.color_identity||[];const have=Object.fromEntries(COLORS.map(x=>[x,p.battlefield.filter(l=>simpleLandMana(l)===x).length]));
    for(let n=0;n<step.count;n++){const basics=p.library.map((x,i)=>({x,i,color:simpleLandMana(x)})).filter(o=>/\bBasic\b/.test(o.x.type_line||'')&&o.color);if(!basics.length){log(s,p,'No quedan tierras básicas en la biblioteca.','warning');break;}basics.sort((a,b)=>(identity.includes(b.color)-identity.includes(a.color))||(have[a.color]-have[b.color])||b.i-a.i);const pick=basics[0];p.library.splice(pick.i,1);pick.x.tapped=step.to==='battlefield'&&step.tapped;pick.x.sick=true;p[step.to].push(pick.x);have[pick.color]++;log(s,p,p.name+' busca '+pick.x.name+' y la pone '+(step.to==='hand'?'en su mano':'en el campo'+(pick.x.tapped?' girada':''))+'.','effect');}
    if(!step.noShuffle)shuffle(s,p.library);break;}
   case 'note':log(s,p,c.name+': '+step.text,'manual');break;
  }
 }
}
function power(c,p){let v=Number(c.power)||0;if(c.name==='Rat Colony')v=2+p.battlefield.filter(x=>x.iid!==c.iid&&isCreature(x)&&/\bRat\b/.test(x.type_line||'')).length;v+=(Number(c.counters?.['+1/+1'])||0)-(Number(c.counters?.['-1/-1'])||0);return Math.max(0,v);}
// ——— Combate con bloqueadores (0.6) ———
function canBlock(att,blk){if(!isCreature(blk)||blk.tapped)return false;if(hasKw(att,'Flying')&&!hasKw(blk,'Flying')&&!hasKw(blk,'Reach'))return false;return true;}
function validateBlocks(s,combat,blocks){
 if(!Array.isArray(blocks)||blocks.length>60)throw Error('Bloqueos no válidos.');
 const attacker=player(s,combat.attackerId),defender=player(s,combat.targetPlayerId),used=new Set(),per=new Map();
 for(const b of blocks){
  if(!b||!combat.attackers.includes(b.attackerId))throw Error('Bloqueador no corresponde a un atacante.');
  if(used.has(b.blockerId))throw Error('Cada criatura bloquea a un solo atacante.');used.add(b.blockerId);
  const blk=defender.battlefield.find(c=>c.iid===b.blockerId),att=attacker.battlefield.find(c=>c.iid===b.attackerId);
  if(!blk)throw Error('El bloqueador debe ser una criatura del jugador atacado.');if(!att)continue;
  if(!canBlock(att,blk))throw Error(blk.name+' no puede bloquear a '+att.name+(hasKw(att,'Flying')?' (vuela).':'.'));
  per.set(att.iid,(per.get(att.iid)||0)+1);
 }
 for(const [iid,n] of per){const att=attacker.battlefield.find(c=>c.iid===iid);if(att&&hasKw(att,'Menace')&&n<2)throw Error(att.name+' tiene amenaza: necesita dos o más bloqueadores.');}
 return blocks.map(b=>({attackerId:b.attackerId,blockerId:b.blockerId}));
}
function fightCombat(s,combat,blocks){
 const attacker=player(s,combat.attackerId),target=player(s,combat.targetPlayerId);
 const blockersOf=id=>blocks.filter(b=>b.attackerId===id).map(b=>target.battlefield.find(c=>c.iid===b.blockerId)).filter(Boolean);
 const blockedSet=new Set(blocks.map(b=>b.attackerId));let toPlayer=0;const notes=[];
 const dealsIn=(c,first)=>first?(hasKw(c,'First strike')||hasKw(c,'Double strike')):(!hasKw(c,'First strike')||hasKw(c,'Double strike'));
 for(const first of [true,false]){
  const hits=[];// {card, owner, amount, source, sourceOwner}
  for(const id of combat.attackers){
   const a=attacker.battlefield.find(c=>c.iid===id);if(!a||!dealsIn(a,first))continue;let n=power(a,attacker);if(n<=0)continue;
   const bl=blockersOf(id);
   if(!blockedSet.has(id)){hits.push({player:target,amount:n,source:a,so:attacker});continue;}
   if(!bl.length){if(hasKw(a,'Trample'))hits.push({player:target,amount:n,source:a,so:attacker});continue;}
   let left=n;bl.forEach((b,i)=>{const need=hasKw(a,'Deathtouch')?1:Math.max(0,toughness(b)-(b.damage||0));const last=i===bl.length-1;let give=last&&!hasKw(a,'Trample')?left:Math.min(left,need);if(give>0){hits.push({card:b,owner:target,amount:give,source:a,so:attacker});left-=give;}});
   if(left>0&&hasKw(a,'Trample'))hits.push({player:target,amount:left,source:a,so:attacker});
  }
  for(const b of blocks){const blk=target.battlefield.find(c=>c.iid===b.blockerId),a=attacker.battlefield.find(c=>c.iid===b.attackerId);if(!blk||!a||!dealsIn(blk,first))continue;const n=power(blk,target);if(n>0)hits.push({card:a,owner:attacker,amount:n,source:blk,so:target});}
  for(const h of hits){
   if(h.player){h.player.life-=h.amount;toPlayer+=h.amount;if(h.source.isCommander)h.player.commanderDamage[attacker.id]=(h.player.commanderDamage[attacker.id]||0)+h.amount;}
   else{h.card.damage=(h.card.damage||0)+h.amount;if(hasKw(h.source,'Deathtouch'))h.card.deathtouched=true;notes.push(h.source.name+' hace '+h.amount+' a '+h.card.name);}
   if(hasKw(h.source,'Lifelink'))h.so.life+=h.amount;
  }
  creatureDeaths(s);
 }
 log(s,attacker,toPlayer+' de daño de combate a '+target.name+'.'+(notes.length?' '+notes.join('; ')+'.':'')+' Prevención y otros efectos se revisan manualmente.','combat');
}
function perform(s,a){const p=player(s,a.actorId),d=a.payload||{};
switch(a.type){
case 'DRAW':draw(s,p,d.count??1);p.turnDrawn=true;break;
case 'MOVE':{const {card,index}=locate(p,d.from,d.iid);if(!ZONES.includes(d.to)||d.from===d.to)throw Error('Destino no válido.');p[d.from].splice(index,1);card.tapped=false;card.damage=0;card.counters={};card.sick=true;if(d.to==='library'&&d.position==='bottom')p.library.unshift(card);else p[d.to].push(card);log(s,p,p.name+' mueve una carta de '+d.from+' a '+d.to+'.','move');break;}
case 'TAP':{const {card}=locate(p,'battlefield',d.iid);const tapped=typeof d.tapped==='boolean'?d.tapped:!card.tapped;if(tapped===card.tapped)break;const source=tapped&&d.produceMana!==false?manaSource(card,p):null;let color=null;if(source){if(source.options.length===1)color=source.options[0];else if(source.options.includes(d.color))color=d.color;else throw Error(card.name+' puede producir '+source.options.map(c=>'{'+c+'}').join(' o ')+': elige el color.');}card.tapped=tapped;if(color)p.mana[color]+=source.amount;log(s,p,p.name+(tapped?' gira ':' endereza ')+card.name+(color?' y añade '+'{'+color+'}'.repeat(source.amount)+' a su reserva.':'.'),'tap');break;}
case 'LIFE':p.life+=number(d.delta);log(s,p,p.name+': '+p.life+' vidas.','life');break;
case 'POISON':p.poison=Math.max(0,p.poison+number(d.delta));log(s,p,p.name+': '+p.poison+' contadores de veneno.','poison');break;
case 'COMMANDER_DAMAGE':{player(s,d.sourcePlayerId);const delta=number(d.delta);p.commanderDamage[d.sourcePlayerId]=Math.max(0,(p.commanderDamage[d.sourcePlayerId]||0)+delta);log(s,p,p.name+': '+p.commanderDamage[d.sourcePlayerId]+' de daño del comandante de '+player(s,d.sourcePlayerId).name+'. Actualiza las vidas por separado.','commander');break;}
case 'MANA':if(!COLORS.includes(d.color))throw Error('Color no válido.');p.mana[d.color]=Math.max(0,p.mana[d.color]+number(d.delta));break;
case 'MULLIGAN':{if(s.turn!==1||s.stack.length||s.pendingCombat||p.battlefield.length)throw Error('El mulligan solo está disponible antes de jugar.');p.library.push(...p.hand);p.hand=[];shuffle(s,p.library);p.mulligans++;draw(s,p,7);log(s,p,'Mulligan '+p.mulligans+'. '+(p.mulligans===1&&s.players.length>2?'Primer mulligan gratis.':'Devuelve manualmente al fondo las cartas que correspondan. En multijugador el primero es gratis.'),'mulligan');break;}
case 'SHUFFLE':shuffle(s,p.library);log(s,p,p.name+' baraja su biblioteca.','shuffle');break;
case 'NEXT_PHASE':requireActive(s,p);if(s.stack.length||s.pendingCombat)throw Error('Resuelve primero la pila o el combate.');clearMana(s);if(s.phase===5)nextTurn(s);else {s.phase++;log(s,p,PHASES[s.phase]+'.','phase');}break;
case 'NEXT_TURN':requireActive(s,p);if(s.stack.length||s.pendingCombat)throw Error('Resuelve primero la pila o el combate.');nextTurn(s);break;
case 'SET_RESPONSE_CHECKS':{requireActive(s,p);if(typeof d.enabled!=='boolean')throw Error('Indica si deseas activar la ronda de respuestas.');s.responseChecks=d.enabled;resetResponseRound(s);log(s,p,p.name+(d.enabled?' activa la ronda opcional de respuestas. Cada participante vivo debe confirmar antes de resolver.':' desactiva la ronda de respuestas. La mesa acuerda la resolución manualmente.'),'responses');break;}
case 'PASSED_RESPONSE':{const response=responseStatus(s);if(!response.enabled||!response.spellId)throw Error('No hay una ronda de respuestas activa.');if(!response.pendingIds.includes(p.id)&&!response.passedIds.includes(p.id))throw Error('Solo un participante vivo puede confirmar su respuesta.');if(typeof d.pass!=='boolean')throw Error('Indica si confirmas o retiras tu pase.');if(s.responseRound?.spellId!==response.spellId)resetResponseRound(s);s.responseRound.passed=s.responseRound.passed.filter(id=>id!==p.id);if(d.pass)s.responseRound.passed.push(p.id);log(s,p,p.name+(d.pass?' confirma que no añade una respuesta al hechizo superior.':' retira su confirmación de respuesta.'),'responses');break;}
case 'CAST':{const from=d.from||'hand';if(!['hand','command'].includes(from))throw Error('Solo se asiste lanzar desde mano o zona de mando.');const {card,index}=locate(p,from,d.iid);if(d.autoPay===true&&isLand(card))throw Error('Las tierras no necesitan pago automático.');if(isLand(card)){requireActive(s,p);if(p.landsPlayed>=1)throw Error('Ya jugaste una tierra este turno. Usa mover para excepciones manuales.');p[from].splice(index,1);p.battlefield.push(card);p.landsPlayed++;log(s,p,p.name+' juega '+card.name+'.','land');break;}const tax=from==='command'?p.commanderCasts*2:0;if(d.autoPay===true){if(d.autoPayRevision!==s.revision)throw Error('La vista previa del pago ya no está vigente. Revisa las tierras antes de confirmar.');const plan=autoPaymentPlan(s,p.id,d.iid,from);if(!plan.ok)throw Error(plan.reason);if(!Array.isArray(d.landIds)||d.landIds.length!==plan.landIds.length||d.landIds.some((id,i)=>id!==plan.landIds[i]))throw Error('Las fuentes del pago cambiaron. Genera una nueva vista previa.');for(const id of plan.landIds){const {card:land}=locate(p,'battlefield',id);land.tapped=true;}p.mana=plan.manaAfter;log(s,p,p.name+' confirma el pago automático: gira '+plan.landIds.length+' tierra(s) propia(s) y usa su reserva.','mana');}else if(d.payMana)p.mana=payment(p.mana,card,tax);p[from].splice(index,1);if(from==='command')p.commanderCasts++;s.stack.push({id:'spell-'+card.iid+'-'+s.revision,controllerId:p.id,card,from,effectStatus:effectSteps(card)?'supported':'manual'});resetResponseRound(s);log(s,p,p.name+' lanza '+card.name+(tax?' (impuesto '+tax+').':'.')+(!d.payMana&&!d.autoPay?' Pago manual.':''),'cast');break;}
case 'RESOLVE':{requireActive(s,p);if(!s.stack.length)throw Error('La pila está vacía.');if(s.responseChecks===true&&!responseStatus(s).ready)throw Error('Faltan confirmaciones en la ronda de respuestas del hechizo superior.');const e=s.stack.pop();resetResponseRound(s);const owner=player(s,e.controllerId);e.card.sick=true;owner[isPermanent(e.card)?'battlefield':'graveyard'].push(e.card);log(s,owner,'Se resuelve '+e.card.name+'.','resolve');resolveEffect(s,owner,e.card,d,e.id);break;}
case 'TOKEN':{const c={name:String(d.name||'Ficha').slice(0,80),type_line:'Token Creature',power:String(d.power??1),toughness:String(d.toughness??1),oracle_text:'',token:true};p.battlefield.push(instance(s,c));log(s,p,p.name+' crea '+c.name+'.','token');break;}
case 'COUNTER':{const {card}=locate(p,'battlefield',d.iid);const name=String(d.name||'+1/+1').slice(0,50);if(['__proto__','constructor','prototype'].includes(name))throw Error('Nombre no válido.');card.counters[name]=Math.max(0,(card.counters[name]||0)+number(d.delta));break;}
case 'COMBAT':{requireActive(s,p);if(s.pendingCombat||s.stack.length)throw Error('Hay un combate o pila pendiente.');const target=player(s,d.targetPlayerId);if(target.id===p.id||target.eliminated)throw Error('Elige un oponente disponible.');const ids=[...new Set(d.attackers||[])];if(!ids.length)throw Error('Selecciona atacantes.');for(const id of ids){const {card}=locate(p,'battlefield',id);if(!isCreature(card)||card.tapped||(card.sick&&!(card.keywords||[]).includes('Haste')))throw Error('Hay un atacante no disponible.');}for(const id of ids){const {card}=locate(p,'battlefield',id);if(!(card.keywords||[]).includes('Vigilance'))card.tapped=true;}for(const id of ids){const {card}=locate(p,'battlefield',id);if(hasKw(card,'Defender'))throw Error(card.name+' tiene defensor y no puede atacar.');}s.pendingCombat={attackerId:p.id,targetPlayerId:target.id,attackers:ids,autoEndTurn:!!d.autoEndTurn,blocks:[]};s.phase=2;if(target.bot&&BOT()){s.pendingCombat.blocks=BOT().suggestBlocks(api,s);s.pendingCombat.blocksDeclared=true;if(s.pendingCombat.blocks.length)log(s,target,target.name+' (bot) declara '+s.pendingCombat.blocks.length+' bloqueo(s).','combat');}log(s,p,p.name+' declara '+ids.length+' atacante(s) contra '+target.name+'. Confirma bloqueos antes de aplicar daño.','combat');break;}
case 'DECLARE_BLOCKS':{const combat=s.pendingCombat;if(!combat)throw Error('No hay un combate pendiente.');if(p.id!==combat.targetPlayerId)throw Error('Solo el jugador atacado declara sus bloqueos.');combat.blocks=validateBlocks(s,combat,d.blocks||[]);combat.blocksDeclared=true;log(s,p,p.name+' declara '+combat.blocks.length+' bloqueo(s).','combat');break;}
case 'RESOLVE_COMBAT':{requireActive(s,p);if(!s.pendingCombat||d.confirm!==true)throw Error('Confirma la resolución del combate.');if(Array.isArray(d.blockedIds)&&!Array.isArray(d.blocks)){const combat=s.pendingCombat,attacker=player(s,combat.attackerId),target=player(s,combat.targetPlayerId);const blocked=new Set(d.blockedIds||[]);if([...blocked].some(id=>!combat.attackers.includes(id)))throw Error('Bloqueador no corresponde a un atacante.');let damage=0;for(const id of combat.attackers){const card=attacker.battlefield.find(c=>c.iid===id);if(!card||blocked.has(id))continue;let n=power(card,attacker);if((card.keywords||[]).includes('Double strike'))n*=2;damage+=n;if(card.isCommander)target.commanderDamage[attacker.id]=(target.commanderDamage[attacker.id]||0)+n;if((card.keywords||[]).includes('Lifelink'))attacker.life+=n;}target.life-=damage;log(s,attacker,damage+' de daño no bloqueado a '+target.name+'. Daño a criaturas, arrollar, prevención y otros efectos se resuelven manualmente.','combat');s.pendingCombat=null;status(s);if(combat.autoEndTurn&&!s.winnerId)nextTurn(s);break;}const combat=s.pendingCombat;const blocks=validateBlocks(s,combat,Array.isArray(d.blocks)?d.blocks:combat.blocks||[]);fightCombat(s,combat,blocks);s.pendingCombat=null;status(s);if(combat.autoEndTurn&&!s.winnerId)nextTurn(s);break;}
case 'NOTE':log(s,p,String(d.text||'').slice(0,1000),'note');break;
default:throw Error('Acción no reconocida: '+a.type);
}status(s);}
function dispatch(state,action){try{if(!action||!action.id)throw Error('La acción requiere id.');if(state.appliedActionIds.includes(action.id))return {ok:true,state,events:[],duplicate:true};if(action.expectedRevision!==undefined&&action.expectedRevision!==state.revision)throw Error('La mesa cambió. Actualiza e intenta de nuevo.');const s=clone(state),start=s.log.length;perform(s,action);s.revision++;s.appliedActionIds.push(action.id);if(s.appliedActionIds.length>500)s.appliedActionIds.shift();return {ok:true,state:s,events:s.log.slice(start)};}catch(e){return {ok:false,state,error:e.message,events:[]};}}
function botTurn(state,id){const B=BOT();if(B)return B.botTurn(api,state,id);return legacyBotTurn(state,id);}
function legacyBotTurn(state,id){let s=state,events=[];let p=player(s,id);if(!p.bot||s.activePlayerId!==id||s.pendingCombat||s.stack.length||s.winnerId)return {state:s,events,error:'El bot no puede actuar ahora.'};let seq=0;function act(type,payload={}){const r=dispatch(s,{id:'bot-'+s.turn+'-'+s.revision+'-'+(++seq),type,actorId:id,payload});if(r.ok){s=r.state;events.push(...r.events);p=player(s,id);}return r.ok;}
if(!p.turnDrawn)act('DRAW',{count:1});const land=p.hand.find(isLand);if(land&&p.landsPlayed<1)act('CAST',{iid:land.iid,from:'hand'});
for(const land of p.battlefield.filter(c=>!c.tapped&&simpleLandMana(c))){act('TAP',{iid:land.iid,tapped:true});}
for(let i=0;i<8&&!s.winnerId;i++){let choice=[...p.hand,...p.command].find(c=>{const e=c.supportedEffect;const explicit=e&&((e.type==='draw'&&Number.isInteger(e.count)&&e.count>=0&&e.count<=10)||(['gainLife','damage'].includes(e.type)&&Number.isInteger(e.amount)&&e.amount>=0&&e.amount<=20));if(!isCreature(c)&&!(/\b(Instant|Sorcery)\b/.test(c.type_line||'')&&explicit))return false;if(e?.type==='damage'&&!s.players.some(q=>q.id!==id&&!q.eliminated))return false;try{payment(p.mana,c,p.command.some(x=>x.iid===c.iid)?p.commanderCasts*2:0);return true;}catch(_){return false;}});if(!choice)break;const from=p.command.some(c=>c.iid===choice.iid)?'command':'hand';if(!act('CAST',{iid:choice.iid,from,payMana:true}))break;const target=s.players.find(q=>q.id!==id&&!q.eliminated);if(!act('RESOLVE',choice.supportedEffect?.type==='damage'&&target?{targetPlayerId:target.id}:{}))return {state:s,events};}
if(s.winnerId)return {state:s,events};const attackers=p.battlefield.filter(c=>isCreature(c)&&!c.tapped&&(!c.sick||(c.keywords||[]).includes('Haste'))).map(c=>c.iid);const target=s.players.find(q=>q.id!==id&&!q.eliminated);if(attackers.length&&target)act('COMBAT',{attackers,targetPlayerId:target.id,autoEndTurn:true});else act('NEXT_TURN');return {state:s,events};}
function validateDeck(deck,{format='commander'}={}){const errors=[],warnings=[];if(format!=='commander'){warnings.push('La validación implementada cubre Commander; revisa manualmente el formato '+format+'.');return {valid:false,errors:['Formato todavía no compatible.'],warnings};}const commander=deck?.commander,cards=deck?.cards||[];if(!commander)errors.push('Selecciona un comandante.');if(cards.length+(commander?1:0)!==100)errors.push('Commander requiere exactamente 100 cartas contando el comandante.');if(commander&&!(/Legendary.*Creature/i.test(commander.type_line||'')||/can be your commander/i.test(commander.oracle_text||'')))errors.push('La carta seleccionada no consta como comandante permitido.');const identity=new Set(commander?.color_identity||[]),counts=new Map();for(const c of [commander,...cards].filter(Boolean)){const key=c.oracle_id||c.name;counts.set(key,(counts.get(key)||0)+1);if((c.color_identity||[]).some(x=>!identity.has(x)))errors.push(c.name+': identidad de color fuera de la del comandante.');if(!Array.isArray(c.color_identity))warnings.push(c.name+': falta identidad de color; no se puede verificar.');if(c.legalities?.commander&&c.legalities.commander!=='legal')errors.push(c.name+': no es legal en Commander.');if(!c.legalities?.commander)warnings.push(c.name+': legalidad sin verificar.');}
for(const [key,n] of counts){const c=[commander,...cards].find(c=>c&&(c.oracle_id||c.name)===key);const basic=/\bBasic\b.*\bLand\b/.test(c.type_line||'');const any=['Rat Colony','Shadowborn Apostle','Persistent Petitioners','Relentless Rats','Dragon’s Approach',"Dragon's Approach",'Slime Against Humanity','Hare Apparent','Templar Knight'].includes(c.name);const limit=c.name==='Seven Dwarves'?7:c.name==='Nazgûl'?9:1;if(!basic&&!any&&n>limit)errors.push(c.name+': '+n+' copias; máximo '+limit+'.');}
warnings.push('Validación local orientativa: comprueba lista de prohibidas y reglas especiales vigentes. Partner, Background y comandantes múltiples aún requieren gestión manual.');return {valid:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};}
function viewFor(state,id){const s=clone(state);delete s.seed;delete s.appliedActionIds;delete s.nextInstance;for(const p of s.players){p.libraryCount=p.library.length;p.library=[];p.handCount=p.hand.length;if(p.id!==id)p.hand=[];}return s;}
const api={PHASES,COLORS,ZONES,SUMMARY,createGame,dispatch,botTurn,validateDeck,viewFor,power,toughness,cost,simpleLandMana,manaSource,autoPaymentPlan,responseStatus,effectPlan,legalTargets,canBlock,isCreature,isLand,hasKw};
return api;
});
