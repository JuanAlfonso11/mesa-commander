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
const hasKw=(c,k)=>(c.keywords||[]).includes(k)||(!c.mods&&ABIL(c).some(a=>a.kind==='keywords'&&a.list.includes(k)));
// Suma de contadores con forma +X/+Y (también -X/-Y): devuelve [fuerza, resistencia].
function ptCounters(c){let p=0,t=0;for(const [k,v] of Object.entries(c.counters||{})){const m=String(k).match(/^([+-]?\d{1,2})\/([+-]?\d{1,2})$/);const n=Number(v)||0;if(m&&n){p+=Number(m[1])*n;t+=Number(m[2])*n;}}return [p,t];}
const KEYWORDS=['Flying','Haste','Vigilance','Trample','Lifelink','Deathtouch','Reach','Menace','First strike','Double strike','Indestructible','Defender'];
function restoreKeywords(card){if(card.baseKeywords){card.keywords=card.baseKeywords;delete card.baseKeywords;}if(card.printedKeywords){card.keywords=card.printedKeywords;delete card.printedKeywords;}for(const k of ['mods','eot','cda','manualKw','attachedTo','chosenType','chosenColor','attacking','onceTurn','activatedTurn'])delete card[k];}
const COUNTER_NAME=/^[\p{L}\p{N} +\/\-]{1,30}$/u;
function toughness(c){return (c.cda&&c.cda.t!=null?c.cda.t:(Number(c.toughness)||0))+ptCounters(c)[1]+(c.mods?.t||0)+(c.eot?.t||0);}
const isPermanent=c=>/\b(Land|Creature|Artifact|Enchantment|Planeswalker|Battle)\b/i.test(c.type_line||'');
function random(s){let x=s.seed|0;x^=x<<13;x^=x>>>17;x^=x<<5;s.seed=x>>>0;return s.seed/4294967296;}
function shuffle(s,a){for(let i=a.length-1;i>0;i--){const j=Math.floor(random(s)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function player(s,id){const p=s.players.find(p=>p.id===id);if(!p)throw Error('Jugador no encontrado.');return p;}
function instance(s,c){return {...clone(c),iid:'card-'+(++s.nextInstance),tapped:false,sick:true,damage:0,counters:{}};}
function log(s,p,text,type='info'){const e={id:'event-'+(++s.nextEvent),turn:s.turn,playerId:p?.id||null,text,type};s.log.push(e);return e;}
function draw(s,p,n){n=Math.min(100,Math.max(0,Math.floor(Number(n)||0)));let done=0;while(done<n&&p.library.length){p.hand.push(p.library.pop());done++;}log(s,p,p.name+' roba '+done+' carta(s).','draw');if(done<n)log(s,p,'Biblioteca vacía: resuelve manualmente la consecuencia de intentar robar.','warning');return done;}
function status(s){applyStatics(s);legendRule(s);for(const p of s.players){if(p.life<0)p.life=0;p.eliminated=p.life<=0||p.poison>=10||Object.values(p.commanderDamage).some(v=>v>=21);}const alive=s.players.filter(p=>!p.eliminated);s.winnerId=s.players.length>1&&alive.length===1?alive[0].id:null;}
function clearMana(s){for(const p of s.players)for(const c of COLORS)p.mana[c]=0;}
function nextTurn(s){clearMana(s);for(const q of s.players)for(const c of q.battlefield){delete c.eot;delete c.attacking;}const extra=s.extraTurns?.length?s.extraTurns.shift():null;if(s.extraTurns&&!s.extraTurns.length)delete s.extraTurns;const i=s.players.findIndex(p=>p.id===s.activePlayerId);let n=1;while(n<s.players.length&&s.players[(i+n)%s.players.length].eliminated)n++;const p=extra&&!player(s,extra).eliminated?player(s,extra):s.players[(i+n)%s.players.length];s.activePlayerId=p.id;s.turn++;s.phase=0;s.pendingCombat=null;p.landsPlayed=0;p.turnDrawn=true;for(const c of p.battlefield){c.tapped=false;c.sick=false;c.damage=0;}for(const q of s.players)for(const c of q.battlefield)c.damage=0;log(s,p,'Comienza el turno de '+p.name+(extra?' (turno adicional)':'')+'.','turn');fire(s,{on:'upkeep',playerId:p.id});draw(s,p,1);}
function createGame(options={}){const ps=options.players||[];if(!ps.length||ps.length>8)throw Error('La mesa admite de 1 a 8 jugadores.');if(new Set(ps.map(p=>p.id)).size!==ps.length||ps.some(p=>!p.id))throw Error('Cada jugador necesita un id único.');const s={id:options.id||gameId(),revision:0,seed:((options.seed===undefined?entropy():Number(options.seed))>>>0)||1,turn:1,activePlayerId:ps[0].id,phase:0,mode:options.mode||'free',players:[],stack:[],responseChecks:false,responseRound:null,pendingCombat:null,log:[],winnerId:null,nextInstance:0,nextEvent:0,appliedActionIds:[],summary:SUMMARY};
for(const info of ps){const p={id:info.id,name:String(info.name||'Jugador').slice(0,60),bot:!!info.bot,life:40,poison:0,commanderDamage:{},commanderCasts:0,hand:[],library:[],battlefield:[],graveyard:[],exile:[],command:[],mana:Object.fromEntries(COLORS.map(c=>[c,0])),mulligans:0,landsPlayed:0,turnDrawn:false,eliminated:false};for(const c of info.deck?.cards||[])p.library.push(instance(s,c));if(info.deck?.commander)p.command.push({...instance(s,info.deck.commander),isCommander:true});shuffle(s,p.library);s.players.push(p);draw(s,p,7);}log(s,null,'Mesa preparada. '+SUMMARY,'info');return s;}
function locate(p,zone,iid){if(!ZONES.includes(zone))throw Error('Zona no válida.');const i=p[zone].findIndex(c=>c.iid===iid);if(i<0)throw Error('La carta no está en tu zona indicada.');return {card:p[zone][i],index:i};}
function requireActive(s,p){if(s.activePlayerId!==p.id)throw Error('Esta acción corresponde al jugador activo.');}
function number(v){if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100000)throw Error('Cantidad no válida.');return v;}
function cost(c,tax=0){if(!isLand(c)&&!String(c.mana_cost||'').trim())return null;let r={generic:tax,W:0,U:0,B:0,R:0,G:0,C:0};const symbols=(c.mana_cost||'').match(/\{[^}]+\}/g)||[];for(const raw of symbols){const v=raw.slice(1,-1);if(/^\d+$/.test(v))r.generic+=Number(v);else if(COLORS.includes(v))r[v]++;else return null;}r.generic=Math.max(0,r.generic);return r;}
function payment(mana,c,tax){const r=cost(c,tax);if(!r)throw Error('Coste variable, híbrido o especial: realiza el pago manualmente.');const out={...mana};for(const x of COLORS){if(out[x]<r[x])throw Error('Maná insuficiente del color '+x+'.');out[x]-=r[x];}let g=r.generic;for(const x of ['C','W','U','B','R','G']){let n=Math.min(out[x],g);out[x]-=n;g-=n;}if(g>0)throw Error('Maná total insuficiente.');return out;}
function autoPaymentPlan(state,actorId,iid,from='hand',override){
 const result={ok:false,reason:'',landIds:[],manaBefore:{},manaAfter:{},tax:0};
 try{
  const p=player(state,actorId);result.manaBefore=Object.fromEntries(COLORS.map(c=>[c,p.mana[c]??0]));result.manaAfter={...result.manaBefore};
  if(!override&&!['hand','command'].includes(from))throw Error('El pago automático solo admite mano o zona de mando.');
  const {card}=override?{card:override.card}:locate(p,from,iid);result.tax=override?0:(from==='command'?p.commanderCasts*2:0)-costReduction(state,p,card);
  if(isLand(card))throw Error('Las tierras se juegan sin pagar un coste de hechizo.');
  if(!/^(?:\{(?:\d+|[WUBRGC])\})+$/.test(card.mana_cost||''))throw Error('Coste ausente, variable, híbrido o especial: realiza el pago manualmente.');
  if(FX?.additionalCost(card)?.unknown||(card.keywords||[]).some(k=>['Delve','Convoke','Improvise','Offering','Emerge'].includes(k)))throw Error('Esta carta tiene costes o mecanismos especiales: confirma su pago manualmente.');
  const required=cost(card,result.tax);if(!required||Object.values(required).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('El coste no se puede calcular de forma segura; paga manualmente.');
  if(Object.values(result.manaBefore).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Revisa la reserva: el pago automático requiere cantidades enteras no negativas.');
  const remaining={...result.manaBefore},needed={};
  for(const color of COLORS){const used=Math.min(remaining[color],required[color]);remaining[color]-=used;needed[color]=required[color]-used;}
  let generic=required.generic;for(const color of ['C','W','U','B','R','G']){const used=Math.min(remaining[color],generic);remaining[color]-=used;generic-=used;}
  // Fuentes: tierras sencillas, tierras de varios colores y artefactos de maná con una sola habilidad clara.
  const sources=p.battlefield.map((c,index)=>({c,index,ability:manaSource(c,p)})).filter(x=>!x.c.tapped&&x.ability&&!x.ability.sacrifice&&!(override?.exclude||[]).includes(x.c.iid)).map(x=>({iid:x.c.iid,options:x.ability.options,amount:x.ability.amount,index:x.index})).sort((a,b)=>a.options.length-b.options.length||a.index-b.index);
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
 const died=to==='graveyard'&&isCreature(card),ctrl=owner.id;
 card.tapped=false;card.damage=0;card.counters={};card.sick=true;delete card.deathtouched;restoreKeywords(card);
 for(const q of s.players)for(const x of [...q.battlefield])if(x.attachedTo===card.iid){delete x.attachedTo;if(/\bAura\b/.test(x.type_line||''))leaveBattlefield(s,q,x,'graveyard','queda sin encantar y ');}
 if(card.token){log(s,owner,card.name+' (ficha) deja de existir.','effect');if(died)fire(s,{on:'dies',card,controllerId:ctrl});return true;}
 const home=card.ownerId&&card.ownerId!==owner.id?s.players.find(q=>q.id===card.ownerId):null;if(home){owner=home;delete card.ownerId;}
 const dest=card.isCommander&&(to==='graveyard'||to==='exile')?'command':to;owner[dest].push(card);
 log(s,owner,card.name+' '+(reason||'')+({graveyard:'va al cementerio',exile:'se exilia',hand:'vuelve a la mano',command:'vuelve a la zona de mando'}[dest])+'.','effect');if(died)fire(s,{on:'dies',card,controllerId:ctrl});return true;
}
function lethalDamage(c){return (c.damage||0)>=Math.max(0,toughness(c))||(c.deathtouched&&(c.damage||0)>0);}
// Acciones basadas en estado para criaturas: daño letal o resistencia cero.
function creatureDeaths(s){applyStatics(s);for(const q of s.players)for(const c of [...q.battlefield]){if(!isCreature(c))continue;if(toughness(c)<=0||(!hasKw(c,'Indestructible')&&lethalDamage(c)))leaveBattlefield(s,q,c,'graveyard','muere y ');}}
function findPermanent(s,playerId,iid){const q=player(s,playerId);const card=q.battlefield.find(c=>c.iid===iid);if(!card)throw Error('El objetivo ya no está en el campo.');return {owner:q,card};}
function effectSteps(card){return FX?FX.stepsFor(card):null;}
// Objetivos legales de un paso, para la interfaz y los bots.
function legalTargets(s,controllerId,step,excludeSpellId,srcIid){
 const kind=FX.targetKind(step),out=[];if(!kind)return out;const alive=s.players.filter(q=>!q.eliminated);
 if(['any','player','opponent'].includes(kind))for(const q of alive)if(kind!=='opponent'||q.id!==controllerId)out.push({target:{playerId:q.id},label:q.name+' (jugador · '+q.life+' vidas)'});
 if(['any','creature','permanent'].includes(kind)){const spec=kind==='permanent'?FX.permanentSpec(step):FX.PERMANENT_TARGET[kind==='any'?'creature or planeswalker':'creature'];for(const q of alive)for(const c of q.battlefield)if(FX.matchesPermanent(c,spec,q.id,controllerId,srcIid)&&!hasKw(c,'Shroud')&&!(q.id!==controllerId&&hasKw(c,'Hexproof')))out.push({target:{playerId:q.id,iid:c.iid},label:c.name+' de '+q.name+(isCreature(c)?' · '+power(c,q)+'/'+toughness(c):'')});}
 if(kind==='spell')for(const e of s.stack)if(e.id!==excludeSpellId&&FX.matchesSpell(e,step.spell))out.push({target:{spellId:e.id},label:e.card.name+' (en la pila)'});
 // Lo propio al final: así la opción por defecto apunta a un rival.
 const own=o=>o.target.playerId===controllerId||(o.target.spellId&&s.stack.find(e=>e.id===o.target.spellId)?.controllerId===controllerId);
 return [...out.filter(o=>!own(o)),...out.filter(own)];
}
function effectPlan(s,entry){const steps=effectSteps(entry.card);if(!steps)return {supported:false,steps:[],targeted:[]};const targeted=[];steps.forEach((step,index)=>{if(FX.targetKind(step))targeted.push({index,kind:FX.targetKind(step),label:FX.describe(step),options:legalTargets(s,entry.controllerId,step,entry.id,entry.card?.iid)});});return {supported:true,steps:steps.map(x=>({...x,label:FX.describe(x)})),targeted};}
function sameTarget(a,b){return a&&b&&a.playerId===b.playerId&&a.iid===b.iid&&a.spellId===b.spellId;}
function resolveEffect(s,p,c,payload,entryId){
 const steps=effectSteps(c);
 if(!steps){if(isPermanent(c)&&!c.supportedEffect){const miss=FX?FX.uncovered(c):[];if(miss.length)log(s,p,'Revisa a mano en '+c.name+': '+miss[0].slice(0,160),'manual');}else if(c.oracle_text||c.supportedEffect)log(s,p,'Revisa y aplica manualmente los efectos de '+c.name+'.','manual');return;}
 let targets=Array.isArray(payload.targets)?payload.targets:null;
 const targetedSteps=steps.filter(x=>FX.targetKind(x));
 if(!targets&&payload.targetPlayerId&&targetedSteps.length)targets=[{playerId:payload.targetPlayerId}];
 if(targetedSteps.length&&(!targets||targets.length<targetedSteps.length||payload.manual===true)){if(targets&&targets.length<targetedSteps.length)throw Error('Faltan objetivos para '+c.name+'.');log(s,p,'El efecto de '+c.name+' requiere objetivo o resolución manual.','manual');return;}
 // Validación completa antes de cambiar nada.
 let t=0;const plan=steps.map(step=>{if(!FX.targetKind(step))return {step};const target=targets[t++];if(!target||typeof target!=='object')throw Error('Objetivo no válido.');if(target.playerId)player(s,target.playerId);if(!legalTargets(s,p.id,step,entryId,c.iid).some(x=>sameTarget(x.target,target)))throw Error('Objetivo no válido para '+FX.describe(step)+'.');return {step,target};});
 // La fuente de una habilidad (si sigue en el campo) para «~», contadores y comparaciones.
 const src=c.abilitySteps?allPermanents(s).find(x=>x.iid===c.iid)||null:null;
 const alive=()=>s.players.filter(q=>!q.eliminated),opps=()=>s.players.filter(q=>q.id!==p.id&&!q.eliminated);
 let last=null,lastCard=null,lastPlayer=null,lost=0;
 const amt=a=>Math.max(-100,Math.min(100,amountOf(s,p,src||c,a,{lastLost:lost})));
 const who=(w,tp)=>w==='you'?[p]:w==='each-opponent'?opps():w==='each-player'?alive():w==='same-player'?(lastPlayer?[lastPlayer]:[]):tp?[tp]:[];
 for(const {step,target} of plan){
  const tp=target?.playerId&&!target.iid?player(s,target.playerId):null;if(tp)lastPlayer=tp;
  const chosen=()=>{const r=findPermanent(s,target.playerId,target.iid);lastCard=r.card;return r;};
  switch(step.type){
   case 'draw':{const n=amt(step.count);for(const q of who(step.who,tp))draw(s,q,n);break;}
   case 'gainLife':{let q=p,n=amt(step.amount);if(step.who==='target-controller'){if(!last)break;q=player(s,last.playerId);n=last.power;}q.life+=n;log(s,q,q.name+' gana '+n+' vidas por '+c.name+'.','effect');break;}
   case 'loseLife':{const n=amt(step.amount);for(const q of who(step.who,tp)){q.life-=n;lost+=n;log(s,q,q.name+' pierde '+n+' vidas por '+c.name+'.','effect');}break;}
   case 'damage':{
    const n=amt(step.amount);
    const hitPlayer=q=>{q.life-=n;log(s,p,c.name+' hace '+n+' de daño a '+q.name+'.','effect');};
    const hitCard=(q,card)=>{card.damage=(card.damage||0)+n;log(s,p,c.name+' hace '+n+' de daño a '+card.name+'.','effect');};
    if(target){if(target.iid){const {owner,card}=chosen();hitCard(owner,card);}else hitPlayer(tp);}
    else{const opp=opps();if(['each-opponent'].includes(step.target))opp.forEach(hitPlayer);if(['each-player','each-creature-player'].includes(step.target))alive().forEach(hitPlayer);if(['each-creature','each-creature-player'].includes(step.target))for(const q of s.players)q.battlefield.filter(isCreature).forEach(x=>hitCard(q,x));if(step.target==='each-opponent-creature')for(const q of opp)q.battlefield.filter(isCreature).forEach(x=>hitCard(q,x));}
    creatureDeaths(s);break;}
   case 'destroy':case 'exile':case 'bounce':{const {owner,card}=chosen();last={playerId:owner.id,power:power(card,owner)};if(step.type==='destroy'&&hasKw(card,'Indestructible')){log(s,p,card.name+' es indestructible y no se destruye.','effect');break;}leaveBattlefield(s,owner,card,{destroy:'graveyard',exile:'exile',bounce:'hand'}[step.type],'');break;}
   case 'wipe':{
    if(step.what==='filter'){for(const q of s.players)for(const x of [...q.battlefield])if(FX.matchCard(x,step.spec,ctxOf(q.id,src,p.id))){if(step.bounce)leaveBattlefield(s,q,x,'hand','');else if(step.exile)leaveBattlefield(s,q,x,'exile','');else if(!hasKw(x,'Indestructible'))leaveBattlefield(s,q,x,'graveyard','');}break;}
    const re={creatures:/\bCreature\b/,artifacts:/\bArtifact\b/,enchantments:/\bEnchantment\b/,'nonland permanents':/^(?!.*\bLand\b)/}[step.what];for(const q of s.players)for(const x of [...q.battlefield])if(re.test(x.type_line||'')&&!hasKw(x,'Indestructible'))leaveBattlefield(s,q,x,'graveyard','');break;}
   case 'counter':{const i=s.stack.findIndex(e=>e.id===target.spellId);if(i<0)throw Error('El hechizo objetivo ya no está en la pila.');const [e]=s.stack.splice(i,1);const owner=player(s,e.controllerId);owner[e.card.isCommander?'command':'graveyard'].push(e.card);last={playerId:owner.id,power:0};log(s,p,c.name+' contrarresta '+e.card.name+'.','effect');resetResponseRound(s);break;}
   case 'token':{const q=step.who==='target-controller'?(last?player(s,last.playerId):null):p;if(!q)break;const n=Math.max(0,amt(step.count));makeToken(s,q,{name:step.name,type_line:'Token Creature — '+step.name,power:String(step.power),toughness:String(step.toughness),oracle_text:'',keywords:step.keywords,colors:step.colors},Math.min(n,50));log(s,q,q.name+' crea '+n+' ficha(s) '+step.power+'/'+step.toughness+' de '+step.name+'.','token');break;}
   case 'namedToken':{const q=step.who==='target-controller'?(last?player(s,last.playerId):null):p;if(!q)break;const base=FX.NAMED_TOKEN[step.kind];const n=Math.max(0,amt(step.count));makeToken(s,q,{...base,keywords:[],colors:[]},Math.min(n,50));log(s,q,q.name+' crea '+n+' ficha(s) de '+base.name+'.','token');break;}
   case 'counters':{const list=step.target==='each-own'?p.battlefield.filter(isCreature):step.target==='self'?(src?[src]:[]):[chosen().card];const kind=step.kind||'+1/+1';for(const x of list)x.counters[kind]=(x.counters[kind]||0)+step.count;if(list.length)log(s,p,c.name+' pone '+step.count+' contador(es) '+kind+' en '+(list.length===1?list[0].name:list.length+' criaturas')+'.','effect');break;}
   case 'ramp':{
    const identity=p.command.find(x=>x.isCommander)?.color_identity||[];const have=Object.fromEntries(COLORS.map(x=>[x,p.battlefield.filter(l=>simpleLandMana(l)===x).length]));
    for(let n=0;n<step.count;n++){const basics=p.library.map((x,i)=>({x,i,color:simpleLandMana(x)})).filter(o=>/\bBasic\b/.test(o.x.type_line||'')&&o.color);if(!basics.length){log(s,p,'No quedan tierras básicas en la biblioteca.','warning');break;}basics.sort((a,b)=>(identity.includes(b.color)-identity.includes(a.color))||(have[a.color]-have[b.color])||b.i-a.i);const pick=basics[0];p.library.splice(pick.i,1);if(step.to==='battlefield')enter(s,p,pick.x,{tapped:step.tapped});else p.hand.push(pick.x);have[pick.color]++;log(s,p,p.name+' busca '+pick.x.name+' y la pone '+(step.to==='hand'?'en su mano':'en el campo'+(pick.x.tapped?' girada':''))+'.','effect');}
    if(!step.noShuffle)shuffle(s,p.library);break;}
   case 'search':{const opts=p.library.filter(x=>step.spec.any||FX.matchCard(x,step.spec,{})).map(x=>snap(x,'library',p.id));if(!opts.length){shuffle(s,p.library);log(s,p,p.name+' no encuentra cartas válidas y baraja.','effect');break;}createPrompt(s,p,{kind:'search',to:step.to,tapped:step.tapped,text:'Busca en tu biblioteca ('+c.name+').',options:opts,min:0,max:1});break;}
   case 'returnCard':{const pools=step.whose==='any'?s.players:[p];const opts=pools.flatMap(q=>q.graveyard.filter(x=>FX.matchCard(x,step.spec,{})).map(x=>snap(x,'graveyard',q.id)));createPrompt(s,p,{kind:'return',to:step.to,tapped:step.tapped,text:FX.describe(step)+' ('+c.name+').',options:opts,min:step.upTo?0:step.count,max:step.count});break;}
   case 'exileGrave':{for(const q of who(step.who,tp)){const n=q.graveyard.length;q.exile.push(...q.graveyard.splice(0));log(s,p,c.name+' exilia el cementerio de '+q.name+' ('+n+' cartas).','effect');}break;}
   case 'exileCard':{const opts=opps().flatMap(q=>q.graveyard.map(x=>snap(x,'graveyard',q.id)));createPrompt(s,p,{kind:'exile-card',text:'Elige carta(s) de un cementerio rival para exiliar ('+c.name+').',options:opts,min:step.upTo?0:step.count,max:step.count});break;}
   case 'mill':{for(const q of who(step.who,tp)){const n=Math.min(step.count,q.library.length);for(let i=0;i<n;i++)q.graveyard.push(q.library.pop());log(s,q,q.name+' muele '+n+' carta(s).','effect');}break;}
   case 'discard':{for(const q of who(step.who,tp)){if(step.random){for(let k=0;k<step.count&&q.hand.length;k++){const i=Math.floor(random(s)*q.hand.length);const [x]=q.hand.splice(i,1);q.graveyard.push(x);log(s,q,q.name+' descarta '+x.name+' al azar.','effect');}continue;}createPrompt(s,q,{kind:'discard',text:'Descarta '+step.count+' carta(s) por '+c.name+'.',options:q.hand.map(x=>snap(x,'hand',q.id)),min:step.count,max:step.count});}break;}
   case 'sacrifice':{if(step.self){if(src)leaveBattlefield(s,p,src,'graveyard','se sacrifica y ');break;}for(const q of who(step.who,tp)){const opts=q.battlefield.filter(x=>FX.matchCard(x,{...step.spec,controller:undefined},ctxOf(q.id,src,p.id))).map(x=>snap(x,'battlefield',q.id));createPrompt(s,q,{kind:'sacrifice',text:'Sacrifica '+step.count+' permanente(s) por '+c.name+'.',options:opts,min:step.count,max:step.count});}break;}
   case 'handToTop':{for(const q of who(step.who,tp))createPrompt(s,q,{kind:'handToTop',text:'Pon una carta de tu mano encima de tu biblioteca ('+c.name+').',options:q.hand.map(x=>snap(x,'hand',q.id)),min:1,max:1});break;}
   case 'reveal':{for(const q of who(step.who,tp))createPrompt(s,p,{kind:'reveal',info:true,text:'Mano de '+q.name+' ('+c.name+').',options:q.hand.map(x=>snap(x,'hand',q.id)),min:0,max:0});break;}
   case 'scry':{const top=p.library.slice(-step.count).reverse();if(!top.length)break;if(step.order){createPrompt(s,p,{kind:'reveal',info:true,text:'Primeras cartas de tu biblioteca ('+c.name+'). Reordénalas a mano si quieres.',options:top.map(x=>snap(x,'library',p.id)),min:0,max:0});break;}createPrompt(s,p,{kind:'scry',surveil:!!step.surveil,text:(step.surveil?'Vigila ':'Adivina ')+step.count+': marca las cartas que van '+(step.surveil?'al cementerio':'al fondo')+'.',options:top.map(x=>snap(x,'library',p.id)),min:0,max:top.length});break;}
   case 'dig':{const top=p.library.slice(-step.look).reverse();if(!top.length)break;createPrompt(s,p,{kind:'dig',text:'Elige '+step.take+' para tu mano; el resto va al fondo ('+c.name+').',options:top.map(x=>snap(x,'library',p.id)),min:Math.min(step.take,top.length),max:step.take});break;}
   case 'pump':{
    let list=[];if(step.target==='self')list=src?[src]:[];else if(step.target==='chosen')list=[chosen().card];else if(step.target==='equipped'||step.target==='enchanted')list=src?.attachedTo?allPermanents(s).filter(x=>x.iid===src.attachedTo):[];else if(step.target==='each')list=s.players.flatMap(q=>q.battlefield.filter(x=>isCreature(x)&&FX.matchCard(x,step.spec,ctxOf(q.id,src,p.id))));
    const dp=amt(step.p),dt=amt(step.t);for(const x of list){x.eot=x.eot||{p:0,t:0,kws:[]};x.eot.p+=dp;x.eot.t+=dt;x.eot.kws=[...new Set([...x.eot.kws,...(step.kws||[])])];}
    if(list.length)log(s,p,c.name+': '+(list.length===1?list[0].name:list.length+' criaturas')+' '+(dp>=0?'+':'')+dp+'/'+(dt>=0?'+':'')+dt+(step.kws?.length?' y '+step.kws.join(', '):'')+' hasta el final del turno.','effect');
    applyStatics(s);creatureDeaths(s);break;}
   case 'untap':case 'tap':{let list=[];const on=step.type==='tap';if(step.target==='self')list=src?[src]:[];else if(step.target==='last')list=lastCard?[lastCard]:[];else if(step.target==='chosen')list=[chosen().card];else if(step.target==='each')list=s.players.flatMap(q=>q.battlefield.filter(x=>FX.matchCard(x,step.spec,ctxOf(q.id,src,p.id))));else if(step.target==='lands')list=p.battlefield.filter(x=>isLand(x)&&x.tapped).slice(0,step.count);for(const x of list)x.tapped=on;if(list.length)log(s,p,c.name+(on?' gira ':' endereza ')+(list.length===1?list[0].name:list.length+' permanentes')+'.','effect');break;}
   case 'extraTurn':(s.extraTurns||(s.extraTurns=[])).push(p.id);log(s,p,p.name+' jugará un turno adicional.','effect');break;
   case 'attach':{if(!src)break;createPrompt(s,p,{kind:'attach',sourceIid:src.iid,text:'Elige la criatura para '+src.name+'.',options:p.battlefield.filter(x=>isCreature(x)&&x.iid!==src.iid).map(x=>snap(x,'battlefield',p.id)),min:1,max:1});break;}
   case 'note':log(s,p,c.name+': '+step.text,'manual');break;
  }
 }
 creatureDeaths(s);
}
function power(c,p){let v=c.cda&&c.cda.p!=null?c.cda.p:(Number(c.power)||0);if(c.name==='Rat Colony'&&!c.oracle_text&&p)v=2+p.battlefield.filter(x=>x.iid!==c.iid&&isCreature(x)&&/\bRat\b/.test(x.type_line||'')).length;v+=ptCounters(c)[0]+(c.mods?.p||0)+(c.eot?.p||0);return Math.max(0,v);}
// ——— Combate con bloqueadores (0.6) ———
function canBlock(att,blk){if(!isCreature(blk)||blk.tapped)return false;if(hasKw(blk,"Can't block")||hasKw(att,'Unblockable'))return false;if(hasKw(att,'Flying')&&!hasKw(blk,'Flying')&&!hasKw(blk,'Reach'))return false;const art=/\bArtifact\b/.test(blk.type_line||''),bc=FX?FX.colorsOf(blk):[];if(hasKw(att,'Fear')&&!art&&!bc.includes('B'))return false;if(hasKw(att,'Intimidate')&&!art&&!bc.some(x=>(FX?FX.colorsOf(att):[]).includes(x)))return false;if(hasKw(att,'Skulk')&&power(blk)>power(att))return false;return true;}
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
  const struck=[];
  for(const h of hits){
   if(h.player){h.player.life-=h.amount;toPlayer+=h.amount;if(!struck.includes(h.source))struck.push(h.source);if(h.source.isCommander)h.player.commanderDamage[attacker.id]=(h.player.commanderDamage[attacker.id]||0)+h.amount;}
   else{h.card.damage=(h.card.damage||0)+h.amount;if(hasKw(h.source,'Deathtouch'))h.card.deathtouched=true;notes.push(h.source.name+' hace '+h.amount+' a '+h.card.name);}
   if(hasKw(h.source,'Lifelink'))h.so.life+=h.amount;
  }
  creatureDeaths(s);
  for(const src of struck)fire(s,{on:'combat-damage',card:src,controllerId:attacker.id,playerId:target.id});
 }
 log(s,attacker,toPlayer+' de daño de combate a '+target.name+'.'+(notes.length?' '+notes.join('; ')+'.':'')+' Prevención y otros efectos se revisan manualmente.','combat');
}
// ——— Reglas 0.8: estáticas, disparadas, activadas y elecciones de los jugadores ———
const ABIL=c=>FX&&c?FX.abilities(c).list:[];
const allPermanents=s=>s.players.flatMap(q=>q.battlefield);
function ctxOf(ctrlId,src,srcCtrlId){return {controllerId:ctrlId,srcIid:src?.iid,srcControllerId:srcCtrlId,chosenType:src?.chosenType};}
function devotion(p,color){return p.battlefield.reduce((n,c)=>n+((c.mana_cost||'').match(/\{[^}]+\}/g)||[]).filter(x=>x.includes(color)).length,0);}
// Cantidad variable: «por cada Rata que controlas», devoción, oponentes…
function amountOf(s,p,src,a,ctx={}){
 if(typeof a==='number')return a;if(!a||typeof a!=='object')return 0;let v=0;
 switch(a.of){
  case 'opponents':v=s.players.filter(q=>q.id!==p.id&&!q.eliminated).length;break;
  case 'hand':v=p.hand.length;break;
  case 'devotion':v=devotion(p,a.color);break;
  case 'count':{const pool=a.spec.controller==='any'?s.players.flatMap(q=>q.battlefield.map(c=>[c,q])):p.battlefield.map(c=>[c,p]);v=pool.filter(([c,q])=>FX.matchCard(c,{...a.spec,controller:undefined},ctxOf(q.id,src,p.id))).length;break;}
  case 'grave':v=p.graveyard.filter(c=>FX.matchCard(c,a.spec,{})).length;break;
  case 'lastLost':v=ctx.lastLost||0;break;
  case 'counters':v=Number(src?.counters?.[a.kind])||0;break;
 }
 return v*(a.times===undefined?1:a.times);
}
// Capa de efectos continuos: señores, equipos, fuerza variable y habilidades concedidas. Se recalcula tras cada acción.
function applyStatics(s){
 const all=[];for(const q of s.players)for(const c of q.battlefield)all.push({c,q});
 for(const {c} of all){if(!c.printedKeywords)c.printedKeywords=[...new Set([...(c.baseKeywords||c.keywords||[]),...ABIL(c).filter(a=>a.kind==='keywords').flatMap(a=>a.list)])];delete c.baseKeywords;c.mods={p:0,t:0};c.cda=null;c.granted=[];}
 for(const {c:src,q} of all)for(const a of ABIL(src)){
  if(a.kind!=='static')continue;
  if(a.type==='cda'){src.cda={p:amountOf(s,q,src,a.p),t:a.t?amountOf(s,q,src,a.t):null};continue;}
  if(a.type!=='anthem')continue;
  if(a.condition&&q.battlefield.filter(x=>FX.matchCard(x,{...a.condition.spec,controller:undefined},ctxOf(q.id,src,q.id))).length<a.condition.count)continue;
  const targets=a.self?[{c:src,q}]:a.attached?all.filter(x=>x.c.iid===src.attachedTo):all.filter(x=>isCreature(x.c)&&FX.matchCard(x.c,a.spec,ctxOf(x.q.id,src,q.id)));
  for(const x of targets){x.c.mods.p+=amountOf(s,q,src,a.p);x.c.mods.t+=amountOf(s,q,src,a.t);x.c.granted.push(...a.kws);}
 }
 for(const {c} of all){const set=new Set([...c.printedKeywords,...c.granted,...(c.eot?.kws||[]),...(c.manualKw?.add||[])]);for(const k of c.manualKw?.remove||[])set.delete(k);c.keywords=[...set];delete c.granted;if(c.attachedTo&&!all.some(x=>x.c.iid===c.attachedTo))delete c.attachedTo;}
}
function costReduction(s,p,card){let n=0;for(const src of p.battlefield)for(const a of ABIL(src))if(a.kind==='static'&&a.type==='costReduce'&&(a.spec.any||FX.matchCard(card,a.spec,{})))n+=amountOf(s,p,src,a.amount);return n;}
function maxHand(s,p){let n=7;for(const q of s.players)for(const src of q.battlefield)for(const a of ABIL(src)){if(a.kind!=='static'||a.type!=='handSize')continue;if(q.id===p.id&&a.mine)n=Math.max(n,a.mine);if(q.id!==p.id&&a.opp)n+=a.opp;}return Math.max(0,n);}
function legendRule(s){for(const q of s.players){const groups=new Map();for(const c of q.battlefield)if(/\bLegendary\b/.test(c.type_line||''))groups.set(c.name,[...(groups.get(c.name)||[]),c]);for(const [name,list] of groups){if(list.length<2||(s.prompts||[]).some(pr=>pr.kind==='legend'&&pr.playerId===q.id&&pr.name===name))continue;createPrompt(s,q,{kind:'legend',name,text:'Regla de leyendas: elige qué '+name+' conservas; las demás van al cementerio.',options:list.map(c=>snap(c,'battlefield',q.id)),min:1,max:1});}}}
// ——— Disparos ———
function apnap(s){const i=Math.max(0,s.players.findIndex(q=>q.id===s.activePlayerId));return s.players.map((_,k)=>s.players[(i+k)%s.players.length]).filter(q=>!q.eliminated);}
function triggerMatches(s,a,ev,src,q){
 if(a.on!==ev.on&&!(a.orAttacks&&ev.on==='attacks'))return false;
 if(['upkeep','endstep','combat','main'].includes(ev.on))return !a.mine||ev.playerId===q.id;
 if(ev.on==='cast')return ev.controllerId===q.id&&(!a.spell||FX.matchCard(ev.card,a.spell,{}));
 const subj=a.subject,card=ev.card;if(!subj||!card)return false;
 if(ev.on==='combat-damage'&&a.opponent&&ev.playerId===q.id)return false;
 if(subj.self)return card.iid===src.iid||(!!subj.or&&FX.matchCard(card,subj.or,ctxOf(ev.controllerId,src,q.id)));
 if(subj.equipped||subj.enchanted)return card.iid===src.attachedTo;
 return FX.matchCard(card,subj,ctxOf(ev.controllerId,src,q.id));
}
// Pone en la pila las habilidades que se disparan (orden APNAP: las del jugador activo se resuelven al final).
function fire(s,ev){
 if(!FX)return;if(s.triggerBudget===undefined)s.triggerBudget=200;if(s.triggerBudget<=0)return;
 const found=[];
 for(const q of apnap(s)){const pool=[...q.battlefield];if(ev.on==='dies'&&ev.controllerId===q.id&&!pool.some(c=>c.iid===ev.card.iid))pool.push(ev.card);
  for(const src of pool)for(const a of ABIL(src))if(a.kind==='trigger'&&triggerMatches(s,a,ev,src,q))found.push({a,src,q});}
 for(const {a,src,q} of found){
  if(a.once){src.onceTurn=src.onceTurn||{};if(src.onceTurn[a.text]===s.turn)continue;src.onceTurn[a.text]=s.turn;}
  if(--s.triggerBudget<0){log(s,q,'Demasiados disparos encadenados: resuelve el resto a mano.','warning');return;}
  pushAbility(s,q,src,a.steps,a.text,{optional:a.optional});
 }
}
function pushAbility(s,q,src,steps,text,opts={}){
 s.stack.push({id:'ability-'+(++s.nextInstance),controllerId:q.id,ability:true,optional:!!opts.optional,card:{iid:src.iid,name:src.name,id:src.id,image_uris:src.image_uris,card_faces:src.card_faces?.map(f=>({name:f.name,image_uris:f.image_uris})),type_line:'Habilidad',oracle_text:text,abilitySteps:steps},effectStatus:'supported'});
 resetResponseRound(s);log(s,q,(opts.activated?q.name+' activa una habilidad de ':'Se dispara una habilidad de ')+src.name+(opts.optional?' (opcional)':'')+'.','trigger');
}
// ——— Entrar al campo ———
function entersTapped(s,p,card){for(const a of ABIL(card))if(a.kind==='static'&&a.type==='entersTapped'){if(!a.unless)return true;const n=p.battlefield.filter(x=>x.iid!==card.iid&&FX.matchCard(x,{...a.unless.spec,controller:undefined,other:false},{})).length;if(n<a.unless.count)return true;}return false;}
function enter(s,p,card,opts={}){
 card.sick=true;card.tapped=!!opts.tapped||entersTapped(s,p,card);delete card.attacking;
 p.battlefield.push(card);
 for(const a of ABIL(card)){
  if(a.kind!=='static')continue;
  if(a.type==='chooseType')createPrompt(s,p,{kind:'creature-type',sourceIid:card.iid,text:'Elige un tipo de criatura para '+card.name+'.'});
  if(a.type==='chooseColor')createPrompt(s,p,{kind:'color',sourceIid:card.iid,text:'Elige un color para '+card.name+'.'});
  if(a.type==='enchant'&&a.spec){const opts2=s.players.flatMap(q=>q.battlefield.filter(x=>x.iid!==card.iid&&FX.matchCard(x,a.spec,ctxOf(q.id,card,p.id))).map(x=>snap(x,'battlefield',q.id)));createPrompt(s,p,{kind:'attach',sourceIid:card.iid,text:'Elige qué encanta '+card.name+'.',options:opts2,min:1,max:1});}
 }
 fire(s,{on:'enters',card,controllerId:p.id});
}
function makeToken(s,p,base,n){for(let i=0;i<n;i++)enter(s,p,instance(s,{...base,token:true}),{tapped:base.tapped});}
// ——— Elecciones pendientes (descartar, sacrificar, buscar, regresar, tipo de criatura…) ———
function snap(c,zone,playerId){return {iid:c.iid,name:c.name,zone,playerId,type_line:c.type_line||'',mana_cost:c.mana_cost||'',cmc:c.cmc,power:c.power,toughness:c.toughness,token:!!c.token,id:c.id,image_uris:c.image_uris,card_faces:c.card_faces?.map(f=>({name:f.name,image_uris:f.image_uris})),printed_name:c.printed_name};}
const LIST_PROMPT=pr=>!['creature-type','color'].includes(pr.kind);
function createPrompt(s,p,pr){
 pr.id='prompt-'+(++s.nextInstance);pr.playerId=p.id;pr.options=pr.options||[];
 if(LIST_PROMPT(pr)){
  if(!pr.options.length&&!pr.info){log(s,p,'Sin opciones: '+pr.text,'effect');return null;}
  pr.max=Math.min(pr.max??1,pr.options.length);pr.min=Math.min(pr.min??pr.max,pr.max);
  if(!pr.info&&pr.min===pr.options.length){applyPrompt(s,pr,pr.options.map(o=>o.iid));return null;}
 }else{pr.min=1;pr.max=1;}
 (s.prompts||(s.prompts=[])).push(pr);
 if(p.bot){const ans=botAnswer(s,p,pr);answerPrompt(s,pr,ans.picks,ans.value);return null;}
 log(s,p,p.name+' debe elegir: '+pr.text,'prompt');return pr;
}
function answerPrompt(s,pr,picks,value){s.prompts=(s.prompts||[]).filter(x=>x.id!==pr.id);if(!s.prompts.length)delete s.prompts;applyPrompt(s,pr,picks,value);}
function applyPrompt(s,pr,picks=[],value){
 const p=player(s,pr.playerId);const chosen=picks.map(id=>pr.options.find(o=>o.iid===id)).filter(Boolean);
 const src=pr.sourceIid?allPermanents(s).find(c=>c.iid===pr.sourceIid):null;
 const take=o=>{const q=s.players.find(x=>x.id===o.playerId);const i=q?q[o.zone].findIndex(c=>c.iid===o.iid):-1;return i<0?null:{q,card:q[o.zone].splice(i,1)[0]};};
 switch(pr.kind){
  case 'discard':for(const o of chosen){const t=take(o);if(t){t.q.graveyard.push(t.card);log(s,t.q,t.q.name+' descarta '+t.card.name+'.','effect');}}break;
  case 'sacrifice':for(const o of chosen){const q=player(s,o.playerId),c=q.battlefield.find(x=>x.iid===o.iid);if(c)leaveBattlefield(s,q,c,'graveyard','se sacrifica y ');}break;
  case 'legend':for(const o of pr.options)if(!picks.includes(o.iid)){const c=p.battlefield.find(x=>x.iid===o.iid);if(c)leaveBattlefield(s,p,c,'graveyard','(regla de leyendas) ');}break;
  case 'search':{let top=null;for(const o of chosen){const t=take(o);if(!t)continue;if(pr.to==='battlefield'){enter(s,p,t.card,{tapped:pr.tapped});log(s,p,p.name+' busca '+t.card.name+' y la pone en el campo.','effect');}else if(pr.to==='top'){top=t.card;log(s,p,p.name+' busca una carta y la pondrá encima de su biblioteca.','effect');}else{p.hand.push(t.card);log(s,p,p.name+' busca una carta y la pone en su mano.','effect');}}if(!chosen.length)log(s,p,p.name+' no elige ninguna carta.','effect');shuffle(s,p.library);if(top)p.library.push(top);log(s,p,p.name+' baraja su biblioteca.','shuffle');break;}
  case 'return':for(const o of chosen){const t=take(o);if(!t)continue;if(t.q.id!==p.id)t.card.ownerId=t.q.id;if(pr.to==='battlefield')enter(s,p,t.card,{tapped:pr.tapped});else p.hand.push(t.card);log(s,p,p.name+' regresa '+t.card.name+' del cementerio '+(pr.to==='battlefield'?'al campo':'a su mano')+'.','effect');}break;
  case 'exile-card':for(const o of chosen){const t=take(o);if(t){t.q.exile.push(t.card);log(s,p,p.name+' exilia '+t.card.name+' del cementerio de '+t.q.name+'.','effect');}}break;
  case 'attach':if(src&&chosen[0]){src.attachedTo=chosen[0].iid;log(s,p,src.name+' queda unida a '+chosen[0].name+'.','effect');}break;
  case 'creature-type':{const v=String(value||'').trim().replace(/[^\p{L} '-]/gu,'').slice(0,30);if(src&&v){src.chosenType=v.charAt(0).toUpperCase()+v.slice(1);log(s,p,p.name+' elige el tipo '+src.chosenType+' para '+src.name+'.','effect');}break;}
  case 'color':if(src&&['W','U','B','R','G'].includes(value)){src.chosenColor=value;log(s,p,p.name+' elige el color {'+value+'} para '+src.name+'.','effect');}break;
  case 'scry':{const moved=[];for(const o of chosen){const t=take(o);if(!t)continue;moved.push(t.card.name);if(pr.surveil)p.graveyard.push(t.card);else p.library.unshift(t.card);}log(s,p,p.name+(pr.surveil?' vigila ':' adivina ')+pr.options.length+': '+chosen.length+(pr.surveil?' al cementerio':' al fondo')+'.','effect');break;}
  case 'dig':{for(const o of chosen){const t=take(o);if(t)p.hand.push(t.card);}for(const o of pr.options)if(!picks.includes(o.iid)){const t=take(o);if(t)p.library.unshift(t.card);}log(s,p,p.name+' toma '+chosen.length+' carta(s) y pone el resto al fondo.','effect');break;}
  case 'handToTop':for(const o of chosen){const t=take(o);if(t){t.q.library.push(t.card);log(s,t.q,t.q.name+' pone una carta de su mano encima de su biblioteca.','effect');}}break;
 }
 creatureDeaths(s);
}
// Respuestas de los bots: sencillas y deterministas.
function botAnswer(s,p,pr){
 const cmc=o=>Number.isFinite(Number(o.cmc))?Number(o.cmc):((o.mana_cost||'').match(/\{[^}]+\}/g)||[]).length;
 const lands=p.battlefield.filter(isLand).length;
 const keep=o=>/\bLand\b/.test(o.type_line)?(lands<6?8:1):(cmc(o)<=lands+2?6+cmc(o)*0.1:3);
 const by=(f,dir=1)=>[...pr.options].sort((a,b)=>dir*(f(a)-f(b)));
 let order=pr.options,count=pr.max,value;
 switch(pr.kind){
  case 'discard':case 'handToTop':order=by(keep);break;
  case 'sacrifice':order=by(o=>(o.token?0:3)+cmc(o)+(Number(o.power)||0));break;
  case 'search':case 'return':case 'exile-card':case 'dig':order=by(cmc,-1);count=pr.max;break;
  case 'attach':order=by(o=>Number(o.power)||0,-1);break;
  case 'legend':order=pr.options;count=1;break;
  case 'scry':order=pr.options.filter(o=>/\bLand\b/.test(o.type_line)?lands>=6:cmc(o)>lands+3);count=order.length;break;
  case 'creature-type':{const n=new Map();for(const c of [...p.battlefield,...p.hand,...p.library,...p.command])if(isCreature(c))for(const t of (c.type_line.split('—')[1]||'').trim().split(/\s+/).filter(Boolean))n.set(t,(n.get(t)||0)+(c.isCommander?5:1));value=[...n].sort((a,b)=>b[1]-a[1])[0]?.[0]||'Human';break;}
  case 'color':{const n=new Map();for(const c of [...p.battlefield,...p.hand,...p.library,...p.command])for(const x of (c.mana_cost||'').match(/[WUBRG]/g)||[])n.set(x,(n.get(x)||0)+1);value=[...n].sort((a,b)=>b[1]-a[1])[0]?.[0]||'W';break;}
 }
 return {picks:order.slice(0,Math.max(pr.min,Math.min(count,pr.max))).map(o=>o.iid),value};
}
function endTurn(s,p){
 if(s.phase<4){s.phase=4;log(s,p,PHASES[4]+'.','phase');fire(s,{on:'endstep',playerId:p.id});if(s.stack.length){log(s,p,'Resuelve las habilidades del paso final y vuelve a pasar el turno.','warning');return false;}}
 const max=maxHand(s,p);if(p.hand.length>max)createPrompt(s,p,{kind:'discard',text:'Limpieza: descarta hasta quedarte con '+max+' cartas.',options:p.hand.map(x=>snap(x,'hand',p.id)),min:p.hand.length-max,max:p.hand.length-max});
 nextTurn(s);return true;
}

function perform(s,a){const p=player(s,a.actorId),d=a.payload||{};s.triggerBudget=200;applyStatics(s);
switch(a.type){
case 'DRAW':draw(s,p,d.count??1);p.turnDrawn=true;break;
case 'MOVE':{const {card,index}=locate(p,d.from,d.iid);if(!ZONES.includes(d.to)||d.from===d.to)throw Error('Destino no válido.');p[d.from].splice(index,1);card.tapped=false;card.damage=0;card.counters={};card.sick=true;if(d.to!=='battlefield')restoreKeywords(card);const home=card.ownerId&&card.ownerId!==p.id&&(['graveyard','exile','library','command'].includes(d.to)||(d.to==='hand'&&d.from==='battlefield'))?s.players.find(q=>q.id===card.ownerId):null;const dest=home||p;if(home)delete card.ownerId;const died=d.from==='battlefield'&&d.to==='graveyard'&&isCreature(card);if(card.token&&d.from==='battlefield'&&d.to!=='battlefield'){log(s,p,card.name+' (ficha) deja de existir.','move');if(died)fire(s,{on:'dies',card,controllerId:p.id});break;}log(s,p,p.name+' mueve una carta de '+d.from+' a '+d.to+'.','move');if(d.to==='library'&&d.position==='bottom')dest.library.unshift(card);else if(d.to==='battlefield')enter(s,p,card);else dest[d.to].push(card);if(died)fire(s,{on:'dies',card,controllerId:p.id});break;}
case 'TAP':{const {card}=locate(p,'battlefield',d.iid);const tapped=typeof d.tapped==='boolean'?d.tapped:!card.tapped;if(tapped===card.tapped)break;const source=tapped&&d.produceMana!==false?manaSource(card,p):null;let color=null;if(source){if(source.options.length===1)color=source.options[0];else if(source.options.includes(d.color))color=d.color;else throw Error(card.name+' puede producir '+source.options.map(c=>'{'+c+'}').join(' o ')+': elige el color.');}card.tapped=tapped;if(color)p.mana[color]+=source.amount;log(s,p,p.name+(tapped?' gira ':' endereza ')+card.name+(color?' y añade '+'{'+color+'}'.repeat(source.amount)+' a su reserva.':'.'),'tap');if(color&&source.sacrifice)leaveBattlefield(s,p,card,'graveyard','se sacrifica y ');break;}
case 'LIFE':p.life+=number(d.delta);log(s,p,p.name+': '+p.life+' vidas.','life');break;
case 'POISON':p.poison=Math.max(0,p.poison+number(d.delta));log(s,p,p.name+': '+p.poison+' contadores de veneno.','poison');break;
case 'COMMANDER_DAMAGE':{player(s,d.sourcePlayerId);const delta=number(d.delta);p.commanderDamage[d.sourcePlayerId]=Math.max(0,(p.commanderDamage[d.sourcePlayerId]||0)+delta);log(s,p,p.name+': '+p.commanderDamage[d.sourcePlayerId]+' de daño del comandante de '+player(s,d.sourcePlayerId).name+'. Actualiza las vidas por separado.','commander');break;}
case 'MANA':if(d.clear===true){for(const c of COLORS)p.mana[c]=0;log(s,p,p.name+' vacía su reserva de maná.','mana');break;}if(!COLORS.includes(d.color))throw Error('Color no válido.');p.mana[d.color]=Math.max(0,p.mana[d.color]+number(d.delta));break;
case 'MULLIGAN':{if(s.turn!==1||s.stack.length||s.pendingCombat||p.battlefield.length)throw Error('El mulligan solo está disponible antes de jugar.');p.library.push(...p.hand);p.hand=[];shuffle(s,p.library);p.mulligans++;draw(s,p,7);log(s,p,'Mulligan '+p.mulligans+'. '+(p.mulligans===1&&s.players.length>2?'Primer mulligan gratis.':'Devuelve manualmente al fondo las cartas que correspondan. En multijugador el primero es gratis.'),'mulligan');break;}
case 'SHUFFLE':shuffle(s,p.library);log(s,p,p.name+' baraja su biblioteca.','shuffle');break;
case 'NEXT_PHASE':requireActive(s,p);if(s.stack.length||s.pendingCombat)throw Error('Resuelve primero la pila o el combate.');if(s.phase===5)endTurn(s,p);else {s.phase++;log(s,p,PHASES[s.phase]+'.','phase');fire(s,{on:['upkeep','main','combat','main2','endstep','cleanup'][s.phase],playerId:p.id});}break;
case 'NEXT_TURN':requireActive(s,p);if(s.stack.length||s.pendingCombat)throw Error('Resuelve primero la pila o el combate.');endTurn(s,p);break;
case 'SET_RESPONSE_CHECKS':{requireActive(s,p);if(typeof d.enabled!=='boolean')throw Error('Indica si deseas activar la ronda de respuestas.');s.responseChecks=d.enabled;resetResponseRound(s);log(s,p,p.name+(d.enabled?' activa la ronda opcional de respuestas. Cada participante vivo debe confirmar antes de resolver.':' desactiva la ronda de respuestas. La mesa acuerda la resolución manualmente.'),'responses');break;}
case 'PASSED_RESPONSE':{const response=responseStatus(s);if(!response.enabled||!response.spellId)throw Error('No hay una ronda de respuestas activa.');if(!response.pendingIds.includes(p.id)&&!response.passedIds.includes(p.id))throw Error('Solo un participante vivo puede confirmar su respuesta.');if(typeof d.pass!=='boolean')throw Error('Indica si confirmas o retiras tu pase.');if(s.responseRound?.spellId!==response.spellId)resetResponseRound(s);s.responseRound.passed=s.responseRound.passed.filter(id=>id!==p.id);if(d.pass)s.responseRound.passed.push(p.id);log(s,p,p.name+(d.pass?' confirma que no añade una respuesta al hechizo superior.':' retira su confirmación de respuesta.'),'responses');break;}
case 'CAST':{const from=d.from||'hand';if(!['hand','command'].includes(from))throw Error('Solo se asiste lanzar desde mano o zona de mando.');const {card,index}=locate(p,from,d.iid);if(d.autoPay===true&&isLand(card))throw Error('Las tierras no necesitan pago automático.');if(isLand(card)){requireActive(s,p);if(p.landsPlayed>=1)throw Error('Ya jugaste una tierra este turno. Usa mover para excepciones manuales.');p[from].splice(index,1);p.landsPlayed++;log(s,p,p.name+' juega '+card.name+'.','land');enter(s,p,card);break;}if(!/\bInstant\b/.test(card.type_line||'')&&!hasKw(card,'Flash')){if(s.activePlayerId!==p.id)throw Error(card.name+' no es instantáneo ni tiene destello: solo en tu turno.');if(s.stack.length||s.pendingCombat)throw Error(card.name+' no es instantáneo: espera a que la pila y el combate estén vacíos.');}const tax=(from==='command'?p.commanderCasts*2:0)-costReduction(s,p,card);
// Costes adicionales: sacrificar, descartar o pagar vida al lanzar.
const extra=FX?FX.additionalCost(card):null;let extraSac=null,extraDiscard=null;
if(extra?.sacrifice){const id=Array.isArray(d.sacrifice)?d.sacrifice[0]:d.sacrifice;if(!id)throw Error(card.name+' pide un coste adicional («'+extra.text+'»): elige qué sacrificar.');extraSac=locate(p,'battlefield',id).card;if(!FX.matchCard(extraSac,{...extra.sacrifice,controller:undefined},{}))throw Error(extraSac.name+' no sirve para el coste adicional.');}
if(extra?.discard){const id=Array.isArray(d.discard)?d.discard[0]:d.discard;if(!id||id===card.iid)throw Error(card.name+' pide descartar una carta como coste adicional.');extraDiscard=locate(p,'hand',id).card;if(!extra.discard.any&&!FX.matchCard(extraDiscard,extra.discard,{}))throw Error(extraDiscard.name+' no sirve para el coste adicional.');}
if(extra?.life&&p.life<extra.life)throw Error('No tienes vidas suficientes para el coste adicional.');
if(d.autoPay===true){if(d.autoPayRevision!==s.revision)throw Error('La vista previa del pago ya no está vigente. Revisa las tierras antes de confirmar.');const plan=autoPaymentPlan(s,p.id,d.iid,from);if(!plan.ok)throw Error(plan.reason);if(!Array.isArray(d.landIds)||d.landIds.length!==plan.landIds.length||d.landIds.some((id,i)=>id!==plan.landIds[i]))throw Error('Las fuentes del pago cambiaron. Genera una nueva vista previa.');for(const id of plan.landIds){const {card:land}=locate(p,'battlefield',id);land.tapped=true;}p.mana=plan.manaAfter;log(s,p,p.name+' confirma el pago automático: gira '+plan.landIds.length+' tierra(s) propia(s) y usa su reserva.','mana');}else if(d.payMana)p.mana=payment(p.mana,card,tax);p[from].splice(p[from].findIndex(x=>x.iid===card.iid),1);if(from==='command')p.commanderCasts++;s.stack.push({id:'spell-'+card.iid+'-'+s.revision,controllerId:p.id,card,from,effectStatus:(FX?FX.uncovered(card).length===0:effectSteps(card))?'supported':'manual'});resetResponseRound(s);log(s,p,p.name+' lanza '+card.name+(tax>0?' (impuesto '+tax+').':tax<0?' (cuesta '+(-tax)+' menos).':'.')+(!d.payMana&&!d.autoPay?' Pago manual.':''),'cast');
if(extraDiscard){p.hand.splice(p.hand.findIndex(x=>x.iid===extraDiscard.iid),1);p.graveyard.push(extraDiscard);log(s,p,p.name+' descarta '+extraDiscard.name+' como coste adicional.','effect');}
if(extra?.life){p.life-=extra.life;log(s,p,p.name+' paga '+extra.life+' vidas como coste adicional.','effect');}
if(extraSac)leaveBattlefield(s,p,extraSac,'graveyard','se sacrifica como coste adicional y ');
fire(s,{on:'cast',card,controllerId:p.id});break;}
case 'RESOLVE':{if(!s.stack.length)throw Error('La pila está vacía.');if(s.stack.at(-1).controllerId!==p.id)requireActive(s,p);if(s.responseChecks===true&&!responseStatus(s).ready)throw Error('Faltan confirmaciones en la ronda de respuestas del hechizo superior.');const e=s.stack.pop();resetResponseRound(s);const owner=player(s,e.controllerId);if(e.ability){if(d.decline===true&&e.optional){log(s,owner,owner.name+' decide no usar la habilidad de '+e.card.name+'.','resolve');break;}log(s,owner,'Se resuelve la habilidad de '+e.card.name+'.','resolve');resolveEffect(s,owner,e.card,d,e.id);break;}log(s,owner,'Se resuelve '+e.card.name+'.','resolve');if(isPermanent(e.card))enter(s,owner,e.card);else owner.graveyard.push(e.card);resolveEffect(s,owner,e.card,d,e.id);break;}
case 'TOKEN':{const kind=['creature','artifact','enchantment'].includes(d.kind)?d.kind:'creature';const count=d.count===undefined?1:Number(d.count);if(!Number.isInteger(count)||count<1||count>20)throw Error('Crea entre 1 y 20 fichas a la vez.');const sub=String(d.types||'').replace(/[^\p{L} '-]/gu,'').trim().slice(0,40);const kws=(Array.isArray(d.keywords)?d.keywords:[]).filter(k=>['Flying','Reach','Vigilance','Haste','Trample','Lifelink','Deathtouch','Menace','First strike','Double strike','Indestructible','Defender'].includes(k));const colors=(Array.isArray(d.colors)?d.colors:[]).filter(x=>['W','U','B','R','G'].includes(x));const pt=v=>{const n=Number(v??1);if(!Number.isInteger(n)||n<0||n>99)throw Error('Fuerza y resistencia deben ser números entre 0 y 99.');return String(n);};const base={name:String(d.name||sub||'Ficha').slice(0,80),type_line:'Token '+(kind==='creature'?'Creature':kind==='artifact'?'Artifact':'Enchantment')+(sub?' — '+sub:''),oracle_text:String(d.text||'').slice(0,300),keywords:kws,colors,color_identity:colors,token:true};if(kind==='creature'){base.power=pt(d.power);base.toughness=pt(d.toughness);}log(s,p,p.name+' crea '+(count>1?count+' fichas de ':'')+base.name+(kind==='creature'?' '+base.power+'/'+base.toughness:'')+'.','token');makeToken(s,p,{...base,tapped:d.tapped===true},count);break;}
case 'COUNTER':{const {card}=locate(p,'battlefield',d.iid);const name=String(d.name||'+1/+1').trim().slice(0,30);if(['__proto__','constructor','prototype'].includes(name)||!COUNTER_NAME.test(name))throw Error('Nombre de contador no válido.');const next=Math.max(0,(Number(card.counters[name])||0)+number(d.delta));if(next)card.counters[name]=next;else delete card.counters[name];log(s,p,card.name+': '+(next?next+' contador(es) '+name:'sin contadores '+name)+'.','counter');creatureDeaths(s);break;}
case 'KEYWORD':{const {card}=locate(p,'battlefield',d.iid);if(!KEYWORDS.includes(d.keyword))throw Error('Habilidad no reconocida.');if(typeof d.on!=='boolean')throw Error('Indica si se añade o se quita.');const mk=card.manualKw||{add:[],remove:[]};const add=new Set(mk.add),rem=new Set(mk.remove);if(d.on){add.add(d.keyword);rem.delete(d.keyword);}else{rem.add(d.keyword);add.delete(d.keyword);}card.manualKw={add:[...add],remove:[...rem]};applyStatics(s);log(s,p,card.name+(d.on?' gana ':' pierde ')+d.keyword+'.','keyword');break;}
case 'TAKE':{const from=player(s,d.fromPlayerId);if(from.id===p.id)throw Error('Usa Mover para tus propias cartas.');if(!['graveyard','exile'].includes(d.from))throw Error('Solo puedes tomar cartas del cementerio o exilio de otro jugador.');if(!['hand','battlefield','graveyard','exile'].includes(d.to))throw Error('Destino no válido.');const {card,index}=locate(from,d.from,d.iid);from[d.from].splice(index,1);card.ownerId=card.ownerId||from.id;restoreKeywords(card);card.tapped=false;card.damage=0;card.counters={};card.sick=true;if(d.to==='battlefield')enter(s,p,card);else p[d.to].push(card);log(s,p,p.name+' toma '+card.name+' del '+(d.from==='graveyard'?'cementerio':'exilio')+' de '+from.name+' y la pone en '+({hand:'su mano',battlefield:'el campo',graveyard:'su cementerio',exile:'su exilio'}[d.to])+'.','move');break;}
case 'COMBAT':{requireActive(s,p);if(s.pendingCombat||s.stack.length)throw Error('Hay un combate o pila pendiente.');const target=player(s,d.targetPlayerId);if(target.id===p.id||target.eliminated)throw Error('Elige un oponente disponible.');const ids=[...new Set(d.attackers||[])];if(!ids.length)throw Error('Selecciona atacantes.');for(const id of ids){const {card}=locate(p,'battlefield',id);if(!isCreature(card)||card.tapped||(card.sick&&!(card.keywords||[]).includes('Haste')))throw Error('Hay un atacante no disponible.');}for(const id of ids){const {card}=locate(p,'battlefield',id);if(!(card.keywords||[]).includes('Vigilance'))card.tapped=true;}for(const id of ids){const {card}=locate(p,'battlefield',id);if(hasKw(card,'Defender'))throw Error(card.name+' tiene defensor y no puede atacar.');}s.pendingCombat={attackerId:p.id,targetPlayerId:target.id,attackers:ids,autoEndTurn:!!d.autoEndTurn,blocks:[]};s.phase=2;p.attackedTurn=s.turn;for(const id of ids){const {card}=locate(p,'battlefield',id);card.attacking=true;}if(target.bot&&BOT()){s.pendingCombat.blocks=BOT().suggestBlocks(api,s);s.pendingCombat.blocksDeclared=true;if(s.pendingCombat.blocks.length)log(s,target,target.name+' (bot) declara '+s.pendingCombat.blocks.length+' bloqueo(s).','combat');}log(s,p,p.name+' declara '+ids.length+' atacante(s) contra '+target.name+'. Confirma bloqueos antes de aplicar daño.','combat');for(const id of ids){const {card}=locate(p,'battlefield',id);fire(s,{on:'attacks',card,controllerId:p.id,playerId:target.id});}break;}
case 'DECLARE_BLOCKS':{const combat=s.pendingCombat;if(!combat)throw Error('No hay un combate pendiente.');if(p.id!==combat.targetPlayerId)throw Error('Solo el jugador atacado declara sus bloqueos.');combat.blocks=validateBlocks(s,combat,d.blocks||[]);combat.blocksDeclared=true;log(s,p,p.name+' declara '+combat.blocks.length+' bloqueo(s).','combat');break;}
case 'RESOLVE_COMBAT':{requireActive(s,p);if(!s.pendingCombat||d.confirm!==true)throw Error('Confirma la resolución del combate.');if(s.stack.length)throw Error('Resuelve primero las habilidades que están en la pila.');if(Array.isArray(d.blockedIds)&&!Array.isArray(d.blocks)){const combat=s.pendingCombat,attacker=player(s,combat.attackerId),target=player(s,combat.targetPlayerId);const blocked=new Set(d.blockedIds||[]);if([...blocked].some(id=>!combat.attackers.includes(id)))throw Error('Bloqueador no corresponde a un atacante.');let damage=0;for(const id of combat.attackers){const card=attacker.battlefield.find(c=>c.iid===id);if(!card||blocked.has(id))continue;let n=power(card,attacker);if((card.keywords||[]).includes('Double strike'))n*=2;damage+=n;if(card.isCommander)target.commanderDamage[attacker.id]=(target.commanderDamage[attacker.id]||0)+n;if((card.keywords||[]).includes('Lifelink'))attacker.life+=n;}target.life-=damage;log(s,attacker,damage+' de daño no bloqueado a '+target.name+'. Daño a criaturas, arrollar, prevención y otros efectos se resuelven manualmente.','combat');s.pendingCombat=null;status(s);if(combat.autoEndTurn&&!s.winnerId)endTurn(s,p);break;}const combat=s.pendingCombat;const blocks=validateBlocks(s,combat,Array.isArray(d.blocks)?d.blocks:combat.blocks||[]);fightCombat(s,combat,blocks);s.pendingCombat=null;for(const c of p.battlefield)delete c.attacking;status(s);if(combat.autoEndTurn&&!s.winnerId&&!s.stack.length)endTurn(s,p);break;}
case 'CHOOSE':{const pr=(s.prompts||[]).find(x=>x.id===d.promptId);if(!pr)throw Error('Esa elección ya no está pendiente.');if(pr.playerId!==p.id)throw Error('Esta elección corresponde a otro jugador.');
 if(!LIST_PROMPT(pr)){if(typeof d.value!=='string'||!d.value.trim())throw Error('Elige una opción.');answerPrompt(s,pr,[],d.value);break;}
 const picks=Array.isArray(d.picks)?[...new Set(d.picks)]:[];if(picks.some(id=>!pr.options.some(o=>o.iid===id)))throw Error('Opción no válida.');if(picks.length<pr.min||picks.length>pr.max)throw Error(pr.min===pr.max?'Elige '+pr.min+'.':'Elige entre '+pr.min+' y '+pr.max+'.');answerPrompt(s,pr,picks);break;}
case 'ACTIVATE':{
 const {card}=locate(p,'battlefield',d.iid);const ab=ABIL(card).filter(x=>x.kind==='activated')[Number(d.index)||0];if(!ab)throw Error('Esa habilidad no existe.');
 if(ab.sorcery&&(s.activePlayerId!==p.id||s.stack.length||s.pendingCombat))throw Error('Esta habilidad solo se activa como un conjuro: en tu turno y con la pila vacía.');
 if(ab.onceTurn&&card.activatedTurn===s.turn)throw Error('Esta habilidad solo se activa una vez por turno.');
 const c=ab.cost;
 if(c.tap){if(card.tapped)throw Error(card.name+' ya está girada.');if(isCreature(card)&&card.sick&&!hasKw(card,'Haste'))throw Error(card.name+' acaba de entrar: aún no puede girarse.');}
 const pick=(zone,ids,need,spec,label)=>{ids=[...new Set(Array.isArray(ids)?ids:[])];if(ids.length!==need)throw Error('Elige '+need+' '+label+'.');return ids.map(id=>{const x=locate(p,zone,id).card;if(spec.other&&x.iid===card.iid)throw Error('El coste pide otra carta distinta de '+card.name+'.');if(!spec.any&&!FX.matchCard(x,{...spec,controller:undefined},{srcIid:card.iid}))throw Error(x.name+' no cumple el coste.');return x;});};
 const sacs=c.sac?pick('battlefield',d.sacrifice,c.sac.count,c.sac.spec,'permanente(s) para sacrificar'):[];
 const discards=c.discard?pick('hand',d.discard,c.discard.count,c.discard.spec,'carta(s) para descartar'):[];
 if(c.life&&p.life<c.life)throw Error('No tienes vidas suficientes.');
 if(c.removeCounters&&(Number(card.counters?.[c.removeCounters.kind])||0)<c.removeCounters.count)throw Error('Faltan contadores para el coste.');
 if(c.mana){const fake={name:card.name,type_line:'Ability',mana_cost:c.mana};let paid=null;try{paid=payment(p.mana,fake,0);}catch(_){}
  if(paid)p.mana=paid;else{const plan=autoPaymentPlan(s,p.id,null,'hand',{card:fake,exclude:[...(c.tap||c.sacSelf?[card.iid]:[]),...sacs.map(x=>x.iid)]});if(!plan.ok)throw Error(plan.reason);for(const id of plan.landIds)locate(p,'battlefield',id).card.tapped=true;p.mana=plan.manaAfter;}}
 if(c.tap)card.tapped=true;
 if(c.life)p.life-=c.life;
 if(c.removeCounters){const k=c.removeCounters.kind;card.counters[k]-=c.removeCounters.count;if(card.counters[k]<=0)delete card.counters[k];}
 for(const x of discards){p.hand.splice(p.hand.findIndex(y=>y.iid===x.iid),1);p.graveyard.push(x);}
 card.activatedTurn=s.turn;
 pushAbility(s,p,card,ab.steps,ab.text,{activated:true});
 for(const x of sacs)leaveBattlefield(s,p,x,'graveyard','se sacrifica y ');
 if(c.sacSelf)leaveBattlefield(s,p,card,'graveyard','se sacrifica y ');
 break;}
case 'NOTE':log(s,p,String(d.text||'').slice(0,1000),'note');break;
default:throw Error('Acción no reconocida: '+a.type);
}status(s);}
function dispatch(state,action){try{if(!action||!action.id)throw Error('La acción requiere id.');if(state.appliedActionIds.includes(action.id))return {ok:true,state,events:[],duplicate:true};if(action.expectedRevision!==undefined&&action.expectedRevision!==state.revision)throw Error('La mesa cambió. Actualiza e intenta de nuevo.');const s=clone(state),start=s.log.length;perform(s,action);delete s.triggerBudget;s.revision++;s.appliedActionIds.push(action.id);if(s.appliedActionIds.length>500)s.appliedActionIds.shift();return {ok:true,state:s,events:s.log.slice(start)};}catch(e){return {ok:false,state,error:e.message,events:[]};}}
function botTurn(state,id){const B=BOT();if(B)return B.botTurn(api,state,id);return legacyBotTurn(state,id);}
function legacyBotTurn(state,id){let s=state,events=[];let p=player(s,id);if(!p.bot||s.activePlayerId!==id||s.pendingCombat||s.stack.length||s.winnerId)return {state:s,events,error:'El bot no puede actuar ahora.'};let seq=0;function act(type,payload={}){const r=dispatch(s,{id:'bot-'+s.turn+'-'+s.revision+'-'+(++seq),type,actorId:id,payload});if(r.ok){s=r.state;events.push(...r.events);p=player(s,id);}return r.ok;}
if(!p.turnDrawn)act('DRAW',{count:1});const land=p.hand.find(isLand);if(land&&p.landsPlayed<1)act('CAST',{iid:land.iid,from:'hand'});
for(const land of p.battlefield.filter(c=>!c.tapped&&simpleLandMana(c))){act('TAP',{iid:land.iid,tapped:true});}
for(let i=0;i<8&&!s.winnerId;i++){let choice=[...p.hand,...p.command].find(c=>{const e=c.supportedEffect;const explicit=e&&((e.type==='draw'&&Number.isInteger(e.count)&&e.count>=0&&e.count<=10)||(['gainLife','damage'].includes(e.type)&&Number.isInteger(e.amount)&&e.amount>=0&&e.amount<=20));if(!isCreature(c)&&!(/\b(Instant|Sorcery)\b/.test(c.type_line||'')&&explicit))return false;if(e?.type==='damage'&&!s.players.some(q=>q.id!==id&&!q.eliminated))return false;try{payment(p.mana,c,p.command.some(x=>x.iid===c.iid)?p.commanderCasts*2:0);return true;}catch(_){return false;}});if(!choice)break;const from=p.command.some(c=>c.iid===choice.iid)?'command':'hand';if(!act('CAST',{iid:choice.iid,from,payMana:true}))break;const target=s.players.find(q=>q.id!==id&&!q.eliminated);if(!act('RESOLVE',choice.supportedEffect?.type==='damage'&&target?{targetPlayerId:target.id}:{}))return {state:s,events};}
if(s.winnerId)return {state:s,events};const attackers=p.battlefield.filter(c=>isCreature(c)&&!c.tapped&&(!c.sick||(c.keywords||[]).includes('Haste'))).map(c=>c.iid);const target=s.players.find(q=>q.id!==id&&!q.eliminated);if(attackers.length&&target)act('COMBAT',{attackers,targetPlayerId:target.id,autoEndTurn:true});else act('NEXT_TURN');return {state:s,events};}
function validateDeck(deck,{format='commander'}={}){const errors=[],warnings=[];if(format!=='commander'){warnings.push('La validación implementada cubre Commander; revisa manualmente el formato '+format+'.');return {valid:false,errors:['Formato todavía no compatible.'],warnings};}const commander=deck?.commander,cards=deck?.cards||[];if(!commander)errors.push('Selecciona un comandante.');if(cards.length+(commander?1:0)!==100)errors.push('Commander requiere exactamente 100 cartas contando el comandante.');if(commander&&!(/Legendary.*Creature/i.test(commander.type_line||'')||/can be your commander/i.test(commander.oracle_text||'')))errors.push('La carta seleccionada no consta como comandante permitido.');const identity=new Set(commander?.color_identity||[]),counts=new Map();for(const c of [commander,...cards].filter(Boolean)){const key=c.oracle_id||c.name;counts.set(key,(counts.get(key)||0)+1);if((c.color_identity||[]).some(x=>!identity.has(x)))errors.push(c.name+': identidad de color fuera de la del comandante.');if(!Array.isArray(c.color_identity))warnings.push(c.name+': falta identidad de color; no se puede verificar.');if(c.legalities?.commander&&c.legalities.commander!=='legal')errors.push(c.name+': no es legal en Commander.');if(!c.legalities?.commander)warnings.push(c.name+': legalidad sin verificar.');}
for(const [key,n] of counts){const c=[commander,...cards].find(c=>c&&(c.oracle_id||c.name)===key);const basic=/\bBasic\b.*\bLand\b/.test(c.type_line||'');const any=['Rat Colony','Shadowborn Apostle','Persistent Petitioners','Relentless Rats','Dragon’s Approach',"Dragon's Approach",'Slime Against Humanity','Hare Apparent','Templar Knight'].includes(c.name);const limit=c.name==='Seven Dwarves'?7:c.name==='Nazgûl'?9:1;if(!basic&&!any&&n>limit)errors.push(c.name+': '+n+' copias; máximo '+limit+'.');}
warnings.push('Validación local orientativa: comprueba lista de prohibidas y reglas especiales vigentes. Partner, Background y comandantes múltiples aún requieren gestión manual.');return {valid:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};}
function viewFor(state,id){const s=clone(state);delete s.seed;delete s.appliedActionIds;delete s.nextInstance;if(s.prompts)s.prompts=s.prompts.map(pr=>pr.playerId===id?pr:{id:pr.id,playerId:pr.playerId,kind:pr.kind,text:pr.text,min:pr.min,max:pr.max,options:[]});for(const p of s.players){p.libraryCount=p.library.length;p.library=[];p.handCount=p.hand.length;if(p.id!==id)p.hand=[];}return s;}
const activated=c=>ABIL(c).filter(a=>a.kind==='activated');
const api={activated,maxHand,costReduction,amountOf,KEYWORDS,PHASES,COLORS,ZONES,SUMMARY,createGame,dispatch,botTurn,validateDeck,viewFor,power,toughness,ptCounters,cost,simpleLandMana,manaSource,autoPaymentPlan,responseStatus,effectPlan,legalTargets,canBlock,isCreature,isLand,hasKw};
return api;
});
