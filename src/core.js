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
function restoreKeywords(card){if(card.baseKeywords){card.keywords=card.baseKeywords;delete card.baseKeywords;}if(card.printedKeywords){card.keywords=card.printedKeywords;delete card.printedKeywords;}for(const k of ['mods','eot','cda','manualKw','attachedTo','chosenType','chosenColor','attacking','onceTurn','activatedTurn','monstrous','regen'])delete card[k];}
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
function nextTurn(s){clearMana(s);for(const q of s.players)for(const c of q.battlefield){delete c.eot;delete c.attacking;delete c.regen;}const extra=s.extraTurns?.length?s.extraTurns.shift():null;if(s.extraTurns&&!s.extraTurns.length)delete s.extraTurns;const i=s.players.findIndex(p=>p.id===s.activePlayerId);let n=1;while(n<s.players.length&&s.players[(i+n)%s.players.length].eliminated)n++;const p=extra&&!player(s,extra).eliminated?player(s,extra):s.players[(i+n)%s.players.length];s.activePlayerId=p.id;s.turn++;s.phase=0;s.pendingCombat=null;p.landsPlayed=0;p.turnDrawn=true;for(const c of p.battlefield){c.tapped=false;c.sick=false;c.damage=0;}for(const q of s.players)for(const c of q.battlefield)c.damage=0;log(s,p,'Comienza el turno de '+p.name+(extra?' (turno adicional)':'')+'.','turn');for(const q of s.players)if(q.id!==p.id)for(const c of q.battlefield)for(const a of ABIL(c))if(a.kind==='static'&&a.type==='untapOthers'){if(a.all)q.battlefield.forEach(x=>x.tapped=false);else c.tapped=false;}fire(s,{on:'upkeep',playerId:p.id});if(s.delayed){for(const dl of s.delayed.filter(x=>x.turn===s.turn)){const q=s.players.find(x=>x.id===dl.playerId);if(q&&!q.eliminated)pushAbility(s,q,{iid:'delayed-'+dl.turn,name:dl.name},dl.steps,'Efecto retrasado de '+dl.name);}s.delayed=s.delayed.filter(x=>x.turn>s.turn);if(!s.delayed.length)delete s.delayed;}draw(s,p,1);}
function createGame(options={}){const ps=options.players||[];if(!ps.length||ps.length>8)throw Error('La mesa admite de 1 a 8 jugadores.');if(new Set(ps.map(p=>p.id)).size!==ps.length||ps.some(p=>!p.id))throw Error('Cada jugador necesita un id único.');const s={id:options.id||gameId(),revision:0,seed:((options.seed===undefined?entropy():Number(options.seed))>>>0)||1,turn:1,activePlayerId:ps[0].id,phase:0,mode:options.mode||'free',players:[],stack:[],responseChecks:false,responseRound:null,pendingCombat:null,log:[],winnerId:null,nextInstance:0,nextEvent:0,appliedActionIds:[],summary:SUMMARY};
for(const info of ps){const p={id:info.id,name:String(info.name||'Jugador').slice(0,60),bot:!!info.bot,life:40,poison:0,commanderDamage:{},commanderCasts:0,hand:[],library:[],battlefield:[],graveyard:[],exile:[],command:[],mana:Object.fromEntries(COLORS.map(c=>[c,0])),mulligans:0,landsPlayed:0,turnDrawn:false,eliminated:false};for(const c of info.deck?.cards||[])p.library.push(instance(s,c));if(info.deck?.commander)p.command.push({...instance(s,info.deck.commander),isCommander:true});shuffle(s,p.library);s.players.push(p);draw(s,p,7);}log(s,null,'Mesa preparada. '+SUMMARY,'info');return s;}
function locate(p,zone,iid){if(!ZONES.includes(zone))throw Error('Zona no válida.');const i=p[zone].findIndex(c=>c.iid===iid);if(i<0)throw Error('La carta no está en tu zona indicada.');return {card:p[zone][i],index:i};}
function requireActive(s,p){if(s.activePlayerId!==p.id)throw Error('Esta acción corresponde al jugador activo.');}
function number(v){if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>100000)throw Error('Cantidad no válida.');return v;}
function cost(c,tax=0){if(!isLand(c)&&!String(c.mana_cost||'').trim())return null;let r={generic:tax,W:0,U:0,B:0,R:0,G:0,C:0};const symbols=(c.mana_cost||'').match(/\{[^}]+\}/g)||[];for(const raw of symbols){const v=raw.slice(1,-1);if(/^\d+$/.test(v))r.generic+=Number(v);else if(COLORS.includes(v))r[v]++;else return null;}r.generic=Math.max(0,r.generic);return r;}
function payment(mana,c,tax){const r=cost(c,tax);if(!r)throw Error('Coste variable, híbrido o especial: realiza el pago manualmente.');const out={...mana};for(const x of COLORS){if(out[x]<r[x])throw Error('Maná insuficiente del color '+x+'.');out[x]-=r[x];}let g=r.generic;for(const x of ['C','W','U','B','R','G']){let n=Math.min(out[x],g);out[x]-=n;g-=n;}if(g>0)throw Error('Maná total insuficiente.');return out;}
function castCost(s,p,card,from,o={}){
 const opts=FX?FX.castOptions(card):{};
 let base=from==='graveyard'&&opts.flashback?opts.flashback:o.overload&&opts.overload?opts.overload:(card.mana_cost||'');
 if(o.kicker&&opts.kicker)base+=opts.kicker;if(o.buyback&&opts.buyback)base+=opts.buyback;
 {const ex=FX?FX.additionalCost(card):null;if(ex?.orMana&&!(Array.isArray(o.sacrifice)?o.sacrifice.filter(Boolean).length:o.sacrifice))base+=ex.orMana;}
 const hasX=/\{X\}/.test(base),x=hasX?Math.max(0,Math.min(99,Math.floor(Number(o.x)||0))):0;
 base=base.replace(/\{X\}/g,x?'{'+x+'}':'');if(!base&&hasX)base='{0}';
 const helpers=(opts.delve?Math.min(Math.max(0,Math.floor(Number(o.delve)||0)),p.graveyard.filter(c=>c.iid!==card.iid).length):0)+((opts.convoke||opts.improvise)&&Array.isArray(o.convoke)?new Set(o.convoke).size:0);
 return {card:{...card,mana_cost:base},tax:(from==='command'?p.commanderCasts*2:0)-costReduction(s,p,card)-helpers,x};
}
// Paga un coste de maná con la reserva o, si no alcanza, girando fuentes propias.
// Gira una fuente de maná y aplica todo lo que conlleva (color elegido, paquete fijo, dolor, vida, coste o sacrificio).
function addMana(s,p,st,color){if(st.fixed){for(const [k,n] of Object.entries(st.fixed))p.mana[k]+=n;log(s,p,p.name+' añade '+Object.entries(st.fixed).map(([k,n])=>('{'+k+'}').repeat(n)).join('')+'.','mana');return;}const id=p.command.find(x=>x.isCommander)?.color_identity||p.battlefield.find(x=>x.isCommander)?.color_identity||[];const c=['W','U','B','R','G'].includes(color)?color:(id[0]||'C');p.mana[c]+=st.any||1;log(s,p,p.name+' añade '+('{'+c+'}').repeat(st.any||1)+'.','mana');}
function tapForMana(s,p,card,color){
 const src=manaSource(card,p);if(!src)throw Error(card.name+' no produce maná de forma automática.');if(card.tapped)throw Error(card.name+' ya está girada.');
 if(src.creature&&card.sick&&!hasKw(card,'Haste'))throw Error(card.name+' acaba de entrar: aún no puede girarse para maná.');
 if(!src.fixed){if(src.options.length===1)color=src.options[0];else if(!src.options.includes(color))throw Error(card.name+' puede producir '+src.options.map(c=>'{'+c+'}').join(' o ')+': elige el color.');}
 if(src.cost)p.mana=payment(p.mana,{name:card.name,type_line:'Ability',mana_cost:src.cost},0);
 card.tapped=true;let added;
 if(src.fixed){for(const [k,n] of Object.entries(src.fixed))p.mana[k]+=n;added=Object.entries(src.fixed).map(([k,n])=>('{'+k+'}').repeat(n)).join('');}else{p.mana[color]+=src.amount;added=('{'+color+'}').repeat(src.amount);}
 log(s,p,p.name+' gira '+card.name+' y añade '+(added||'nada')+' a su reserva.','tap');
 const hurt=(src.pain?.[color]||0)+(src.life?.[color]||0);if(hurt&&!src.fixed){p.life-=hurt;log(s,p,p.name+' pierde '+hurt+' vida(s) por '+card.name+'.','life');}
 if(src.sacrifice)leaveBattlefield(s,p,card,'graveyard','se sacrifica y ');
 return color;
}
function payWithPlan(s,p,plan,costCard,tax){for(const id of plan.landIds){const land=locate(p,'battlefield',id).card;tapForMana(s,p,land,plan.colors?.[id]?.color);}p.mana=payment(p.mana,costCard,tax);}
function payCost(s,p,mana,exclude=[]){const fake={name:'Coste',type_line:'Ability',mana_cost:mana||'{0}'};let paid=null;try{paid=payment(p.mana,fake,0);}catch(_){}if(paid){p.mana=paid;return;}const plan=autoPaymentPlan(s,p.id,null,'hand',{card:fake,exclude});if(!plan.ok)throw Error(plan.reason);payWithPlan(s,p,plan,fake,0);}
function autoPaymentPlan(state,actorId,iid,from='hand',override){
 const result={ok:false,reason:'',landIds:[],manaBefore:{},manaAfter:{},tax:0};
 try{
  const p=player(state,actorId);result.manaBefore=Object.fromEntries(COLORS.map(c=>[c,p.mana[c]??0]));result.manaAfter={...result.manaBefore};
  if(!override?.card&&!['hand','command','graveyard','exile'].includes(from))throw Error('El pago automático solo admite mano, zona de mando o cementerio.');
  let card;if(override?.card){card=override.card;result.tax=0;}else{const cc=castCost(state,p,locate(p,from,iid).card,from,override?.cast||{});card=cc.card;result.tax=cc.tax;}
  if(isLand(card))throw Error('Las tierras se juegan sin pagar un coste de hechizo.');
  if(!/^(?:\{(?:\d+|[WUBRGC])\})+$/.test(card.mana_cost||''))throw Error('Coste ausente, variable, híbrido o especial: realiza el pago manualmente.');
  if(FX?.additionalCost(card)?.unknown||(card.keywords||[]).some(k=>['Offering','Emerge'].includes(k)))throw Error('Esta carta tiene costes o mecanismos especiales: confirma su pago manualmente.');
  const required=cost(card,result.tax);if(!required||Object.values(required).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('El coste no se puede calcular de forma segura; paga manualmente.');
  if(Object.values(result.manaBefore).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Revisa la reserva: el pago automático requiere cantidades enteras no negativas.');
  const remaining={...result.manaBefore},needed={};
  for(const color of COLORS){const used=Math.min(remaining[color],required[color]);remaining[color]-=used;needed[color]=required[color]-used;}
  let generic=required.generic;for(const color of ['C','W','U','B','R','G']){const used=Math.min(remaining[color],generic);remaining[color]-=used;generic-=used;}
  // Fuentes: tierras sencillas, tierras de varios colores y artefactos de maná con una sola habilidad clara.
  const sources=p.battlefield.map((c,index)=>({c,index,ability:manaSource(c,p)})).filter(x=>!x.c.tapped&&x.ability&&!x.ability.sacrifice&&!x.ability.cost&&x.ability.amount>0&&!(x.ability.creature&&x.c.sick&&!hasKw(x.c,'Haste'))&&!(override?.exclude||[]).includes(x.c.iid)).map(x=>({iid:x.c.iid,options:x.ability.options,amount:x.ability.amount,fixed:x.ability.fixed,hurts:!!(x.ability.pain||x.ability.life),creature:!!x.ability.creature,index:x.index})).sort((a,b)=>(a.hurts-b.hurts)||(a.creature-b.creature)||((a.fixed?1:a.options.length)-(b.fixed?1:b.options.length))||a.index-b.index);
  // Asignación de colores obligatorios por emparejamiento (las fuentes flexibles se reservan para lo que nadie más cubre).
  const needs=[];for(const color of COLORS)for(let i=0;i<needed[color];i++)needs.push(color);
  const units=[];sources.forEach((src,si)=>{if(src.fixed){for(const [k,n] of Object.entries(src.fixed))for(let j=0;j<n;j++)units.push({si,options:[k]});}else for(let k=0;k<src.amount;k++)units.push({si,options:src.options});});
  // Las fuentes de varias unidades (p. ej. {C}{C}) siempre son de un solo color, así que cada unidad se empareja sola.
  const unitOf=new Array(units.length).fill(-1);
  function augment(n,seen){for(let u=0;u<units.length;u++){if(seen[u]||!units[u].options.includes(needs[n]))continue;seen[u]=true;if(unitOf[u]<0||augment(unitOf[u],seen)){unitOf[u]=n;return true;}}return false;}
  for(let n=0;n<needs.length;n++){if(!augment(n,[])){throw Error('Falta maná '+needs[n]+' en tu reserva y fuentes disponibles.');}}
  const selected=[...new Set(unitOf.map((n,u)=>n>=0?units[u].si:-1).filter(x=>x>=0))];
  const colorFor=si=>{const used=unitOf.map((n,u)=>n>=0&&units[u].si===si?needs[n]:null).filter(Boolean);return used[0]||sources[si].options[0];};
  const addSource=si=>{const src=sources[si];if(src.fixed)for(const [k,n] of Object.entries(src.fixed))available[k]+=n;else available[colorFor(si)]+=src.amount;};
  const available={...result.manaBefore};for(const si of selected)addSource(si);
  const spare=()=>{try{payment(available,card,result.tax);return true;}catch(_){return false;}};
  const order=sources.map((_,si)=>si).filter(si=>!selected.includes(si));
  for(const si of order){if(spare())break;selected.push(si);addSource(si);}
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
function toGraveyard(s,q,card){if(FX&&/would be put into a graveyard from anywhere, (?:reveal ~ and )?shuffle it into its owner's library instead/i.test(FX.normalize(card))){q.library.push(card);shuffle(s,q.library);log(s,q,card.name+' se baraja en la biblioteca en lugar de ir al cementerio.','effect');return;}q.graveyard.push(card);}
function leaveBattlefield(s,owner,card,to,reason){
 const i=owner.battlefield.findIndex(c=>c.iid===card.iid);if(i<0)return false;owner.battlefield.splice(i,1);
 const died=to==='graveyard'&&isCreature(card),ctrl=owner.id;if(died)s.diedTurn=s.turn;
 card.tapped=false;card.damage=0;card.counters={};card.sick=true;delete card.deathtouched;restoreKeywords(card);
 for(const q of s.players)for(const x of [...q.battlefield])if(x.attachedTo===card.iid){delete x.attachedTo;if(/\bAura\b/.test(x.type_line||''))leaveBattlefield(s,q,x,'graveyard','queda sin encantar y ');}
 if(card.token){log(s,owner,card.name+' (ficha) deja de existir.','effect');if(died)fire(s,{on:'dies',card,controllerId:ctrl});fire(s,{on:'leaves',card,controllerId:ctrl});if(to==='graveyard')fire(s,{on:'to-graveyard',card,controllerId:ctrl});return true;}
 const home=card.ownerId&&card.ownerId!==owner.id?s.players.find(q=>q.id===card.ownerId):null;if(home){owner=home;delete card.ownerId;}
 const dest=card.isCommander&&(to==='graveyard'||to==='exile')?'command':to;if(dest==='graveyard')toGraveyard(s,owner,card);else owner[dest].push(card);fire(s,{on:'leaves',card,controllerId:ctrl});if(to==='graveyard')fire(s,{on:'to-graveyard',card,controllerId:ctrl});
 log(s,owner,card.name+' '+(reason||'')+({graveyard:'va al cementerio',exile:'se exilia',hand:'vuelve a la mano',command:'vuelve a la zona de mando'}[dest])+'.','effect');if(died)fire(s,{on:'dies',card,controllerId:ctrl});return true;
}
function lethalDamage(c){return (c.damage||0)>=Math.max(0,toughness(c))||(c.deathtouched&&(c.damage||0)>0);}
// Acciones basadas en estado para criaturas: daño letal o resistencia cero.
function creatureDeaths(s){applyStatics(s);for(const q of s.players)for(const c of [...q.battlefield]){if(/\bPlaneswalker\b/.test(c.type_line||'')&&c.counters&&'Lealtad' in c.counters&&!(c.counters.Lealtad>0)){leaveBattlefield(s,q,c,'graveyard','se queda sin lealtad y ');continue;}if(!isCreature(c))continue;if(toughness(c)<=0)leaveBattlefield(s,q,c,'graveyard','muere y ');else if(!hasKw(c,'Indestructible')&&lethalDamage(c))destroyPermanent(s,q,c,'muere y ');}}
function findPermanent(s,playerId,iid){const q=player(s,playerId);const card=q.battlefield.find(c=>c.iid===iid);if(!card)throw Error('El objetivo ya no está en el campo.');return {owner:q,card};}
function effectSteps(card){if(!FX||!card)return null;let st=card.overloaded?FX.overloadSteps(card):FX.stepsFor(card);if(st&&!card.abilitySteps)st=st.filter(x=>!x.kicked||card.kicked);return st;}
// Destruir respetando indestructible y regeneración.
function destroyPermanent(s,q,card,reason){if(hasKw(card,'Indestructible')){log(s,q,card.name+' es indestructible y no se destruye.','effect');return false;}if(card.regen>0){card.regen--;card.tapped=true;card.damage=0;delete card.deathtouched;delete card.attacking;log(s,q,card.name+' se regenera.','effect');return false;}leaveBattlefield(s,q,card,'graveyard',reason);return true;}
// Objetivos legales de un paso, para la interfaz y los bots.
function legalTargets(s,controllerId,step,excludeSpellId,srcIid){
 const kind=FX.targetKind(step),out=[];if(!kind)return out;const alive=s.players.filter(q=>!q.eliminated);
 if(['any','player','opponent'].includes(kind))for(const q of alive)if(kind!=='opponent'||q.id!==controllerId)out.push({target:{playerId:q.id},label:q.name+' (jugador · '+q.life+' vidas)'});
 if(['any','creature','permanent'].includes(kind)){const spec=kind==='permanent'?FX.permanentSpec(step):FX.PERMANENT_TARGET[kind==='any'?'creature or planeswalker':'creature'];const srcCard=srcIid?(s.stack.find(e=>e.card?.iid===srcIid)?.card||allPermanents(s).find(x=>x.iid===srcIid)):null,srcColors=srcCard&&FX?FX.colorsOf(srcCard):[];
 for(const q of alive)for(const c of q.battlefield)if(FX.matchesPermanent(c,spec,q.id,controllerId,srcIid)&&!hasKw(c,'Shroud')&&!(q.id!==controllerId&&hasKw(c,'Hexproof'))&&!(srcColors.length&&ABIL(c).some(a=>a.kind==='protection'&&a.colors.some(x=>srcColors.includes(x)))))out.push({target:{playerId:q.id,iid:c.iid},label:c.name+' de '+q.name+(isCreature(c)?' · '+power(c,q)+'/'+toughness(c):'')});}
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
 let last=null,lastCard=null,lastPlayer=null,lost=0,lastMv=0,halt=false;
 const amt=a=>Math.max(-100,Math.min(100,amountOf(s,p,src||c,a,{lastLost:lost,x:Number(c.xValue)||0,lastMv,ev:c})));
 const who=(w,tp)=>w==='event-player'?(c.eventPlayerId?[player(s,c.eventPlayerId)]:[]):w==='you'?[p]:w==='each-opponent'?opps():w==='each-player'?alive():w==='same-player'?(lastPlayer?[lastPlayer]:[]):tp?[tp]:[];
 for(const [idx,{step,target}] of plan.entries()){if(halt)break;
  const tp=target?.playerId&&!target.iid?player(s,target.playerId):null;if(tp)lastPlayer=tp;
  const chosen=()=>{const r=findPermanent(s,target.playerId,target.iid);lastCard=r.card;return r;};
  switch(step.type){
   case 'draw':{const n=amt(step.count);for(const q of who(step.who,tp))draw(s,q,n);break;}
   case 'gainLife':{let q=p,n=amt(step.amount);if(step.who==='target-controller'){if(!last)break;q=player(s,last.playerId);n=last.power;}q.life+=n;log(s,q,q.name+' gana '+n+' vidas por '+c.name+'.','effect');if(n>0)fire(s,{on:'lifegain',playerId:q.id,amount:n});break;}
   case 'loseLife':{const n=amt(step.amount);for(const q of (step.who==='event-player'?(c.eventPlayerId?[player(s,c.eventPlayerId)]:[]):who(step.who,tp))){q.life-=n;lost+=n;log(s,q,q.name+' pierde '+n+' vidas por '+c.name+'.','effect');}break;}
   case 'damage':{
    const n=amt(step.amount);
    const hitPlayer=q=>{q.life-=n;log(s,p,c.name+' hace '+n+' de daño a '+q.name+'.','effect');};
    const hitCard=(q,card)=>{if(/\bPlaneswalker\b/.test(card.type_line||'')&&!isCreature(card)){card.counters.Lealtad=Math.max(0,(Number(card.counters.Lealtad)||0)-n);log(s,p,c.name+' quita '+n+' de lealtad a '+card.name+'.','effect');return;}card.damage=(card.damage||0)+n;log(s,p,c.name+' hace '+n+' de daño a '+card.name+'.','effect');};
    if(target){if(target.iid){const {owner,card}=chosen();hitCard(owner,card);}else hitPlayer(tp);}
    else{const opp=opps();if(['each-opponent'].includes(step.target))opp.forEach(hitPlayer);if(['each-player','each-creature-player'].includes(step.target))alive().forEach(hitPlayer);if(['each-creature','each-creature-player'].includes(step.target))for(const q of s.players)q.battlefield.filter(isCreature).forEach(x=>hitCard(q,x));if(step.target==='each-opponent-creature')for(const q of opp)q.battlefield.filter(isCreature).forEach(x=>hitCard(q,x));}
    creatureDeaths(s);break;}
   case 'destroy':case 'exile':case 'bounce':{const {owner,card}=chosen();last={playerId:owner.id,power:power(card,owner)};lastMv=Number(card.cmc)||0;if(step.type==='destroy'){destroyPermanent(s,owner,card,'');break;}leaveBattlefield(s,owner,card,{exile:'exile',bounce:'hand'}[step.type],'');break;}
   case 'wipe':{
    if(step.what==='filter'){for(const q of s.players)for(const x of [...q.battlefield])if(FX.matchCard(x,step.spec,ctxOf(q.id,src||c,p.id))){if(step.bounce)leaveBattlefield(s,q,x,'hand','');else if(step.exile)leaveBattlefield(s,q,x,'exile','');else destroyPermanent(s,q,x,'');}break;}
    const re={creatures:/\bCreature\b/,artifacts:/\bArtifact\b/,enchantments:/\bEnchantment\b/,'nonland permanents':/^(?!.*\bLand\b)/}[step.what];for(const q of s.players)for(const x of [...q.battlefield])if(re.test(x.type_line||''))destroyPermanent(s,q,x,'');break;}
   case 'counter':{const i=s.stack.findIndex(e=>e.id===target.spellId);if(i<0)throw Error('El hechizo objetivo ya no está en la pila.');if(!s.stack[i].ability&&ABIL(s.stack[i].card).some(a=>a.kind==='static'&&a.type==='uncounterable')){log(s,p,s.stack[i].card.name+' no puede ser contrarrestado.','effect');break;}const [e]=s.stack.splice(i,1);const owner=player(s,e.controllerId);owner[e.card.isCommander?'command':'graveyard'].push(e.card);last={playerId:owner.id,power:0};log(s,p,c.name+' contrarresta '+e.card.name+'.','effect');resetResponseRound(s);break;}
   case 'token':{const q=step.who==='target-controller'?(last?player(s,last.playerId):null):p;if(!q)break;const n=Math.max(0,amt(step.count));makeToken(s,q,{name:step.name,type_line:'Token Creature — '+step.name,power:String(step.power),toughness:String(step.toughness),oracle_text:'',keywords:step.keywords,colors:step.colors},Math.min(n,50));log(s,q,q.name+' crea '+n+' ficha(s) '+step.power+'/'+step.toughness+' de '+step.name+'.','token');break;}
   case 'namedToken':{const q=step.who==='target-controller'?(last?player(s,last.playerId):null):p;if(!q)break;const base=FX.NAMED_TOKEN[step.kind];const n=Math.max(0,amt(step.count));makeToken(s,q,{...base,keywords:[],colors:[]},Math.min(n,50));log(s,q,q.name+' crea '+n+' ficha(s) de '+base.name+'.','token');break;}
   case 'counters':{const list=step.target==='event'?allPermanents(s).filter(x=>x.iid===c.eventCardIid):step.target==='each-own'?p.battlefield.filter(isCreature):step.target==='each'?s.players.flatMap(q=>q.battlefield.filter(x=>FX.matchCard(x,step.spec,ctxOf(q.id,src||c,p.id)))):step.target==='self'?(src?[src]:[]):[chosen().card];const kind=step.kind||'+1/+1',k=Math.max(0,amt(step.count));for(const x of list)x.counters[kind]=(x.counters[kind]||0)+k;if(list.length)log(s,p,c.name+' pone '+k+' contador(es) '+kind+' en '+(list.length===1?list[0].name:list.length+' criaturas')+'.','effect');break;}
   case 'ramp':{const rp=step.who==='target-controller'?(last?player(s,last.playerId):null):p;if(!rp)break;
    const identity=rp.command.find(x=>x.isCommander)?.color_identity||[];const have=Object.fromEntries(COLORS.map(x=>[x,rp.battlefield.filter(l=>simpleLandMana(l)===x).length]));
    let only=null;if(step.share){const cnt={};for(const x of rp.library)if(/\bBasic\b/.test(x.type_line||'')&&simpleLandMana(x))cnt[simpleLandMana(x)]=(cnt[simpleLandMana(x)]||0)+1;only=Object.entries(cnt).sort((a,b)=>(identity.includes(b[0])-identity.includes(a[0]))||b[1]-a[1])[0]?.[0]||null;}
    for(let n=0;n<step.count;n++){const basics=rp.library.map((x,i)=>({x,i,color:simpleLandMana(x)})).filter(o=>/\bBasic\b/.test(o.x.type_line||'')&&o.color&&(!only||o.color===only));if(!basics.length){log(s,rp,'No quedan tierras básicas en la biblioteca.','warning');break;}basics.sort((a,b)=>(identity.includes(b.color)-identity.includes(a.color))||(have[a.color]-have[b.color])||b.i-a.i);const pick=basics[0];rp.library.splice(pick.i,1);if(step.to==='battlefield')enter(s,rp,pick.x,{tapped:step.tapped});else rp.hand.push(pick.x);have[pick.color]++;log(s,rp,rp.name+' busca '+pick.x.name+' y la pone '+(step.to==='hand'?'en su mano':'en el campo'+(pick.x.tapped?' girada':''))+'.','effect');}
    if(!step.noShuffle)shuffle(s,rp.library);break;}
   case 'search':{const opts=p.library.filter(x=>step.spec.any||FX.matchCard(x,step.spec,{})).map(x=>snap(x,'library',p.id));if(!opts.length){shuffle(s,p.library);log(s,p,p.name+' no encuentra cartas válidas y baraja.','effect');break;}createPrompt(s,p,{kind:'search',to:step.to,tapped:step.tapped,text:'Busca en tu biblioteca ('+c.name+').',options:opts,min:0,max:1});break;}
   case 'returnCard':{const pools=step.whose==='any'?s.players:[p];const opts=pools.flatMap(q=>q.graveyard.filter(x=>FX.matchCard(x,step.spec,{})).map(x=>snap(x,'graveyard',q.id)));const k=Math.max(0,amt(step.count));createPrompt(s,p,{kind:'return',to:step.to,tapped:step.tapped,text:FX.describe(step)+' ('+c.name+').',options:opts,min:step.upTo?0:k,max:k});break;}
   case 'exileGrave':{for(const q of who(step.who,tp)){const n=q.graveyard.length;q.exile.push(...q.graveyard.splice(0));log(s,p,c.name+' exilia el cementerio de '+q.name+' ('+n+' cartas).','effect');}break;}
   case 'exileCard':{const opts=opps().flatMap(q=>q.graveyard.map(x=>snap(x,'graveyard',q.id)));createPrompt(s,p,{kind:'exile-card',text:'Elige carta(s) de un cementerio rival para exiliar ('+c.name+').',options:opts,min:step.upTo?0:step.count,max:step.count});break;}
   case 'mill':{for(const q of who(step.who,tp)){const n=Math.min(Math.max(0,amt(step.count)),q.library.length);for(let i=0;i<n;i++)q.graveyard.push(q.library.pop());log(s,q,q.name+' muele '+n+' carta(s).','effect');}break;}
   case 'discard':{const dn=Math.max(0,amt(step.count));for(const q of who(step.who,tp)){if(step.random){for(let k=0;k<dn&&q.hand.length;k++){const i=Math.floor(random(s)*q.hand.length);const [x]=q.hand.splice(i,1);q.graveyard.push(x);log(s,q,q.name+' descarta '+x.name+' al azar.','effect');}continue;}createPrompt(s,q,{kind:'discard',text:'Descarta '+dn+' carta(s) por '+c.name+'.',options:q.hand.map(x=>snap(x,'hand',q.id)),min:dn,max:dn});}break;}
   case 'sacrifice':{if(step.self){if(src)leaveBattlefield(s,p,src,'graveyard','se sacrifica y ');break;}for(const q of who(step.who,tp)){const opts=q.battlefield.filter(x=>FX.matchCard(x,{...step.spec,controller:undefined},ctxOf(q.id,src||c,p.id))).map(x=>snap(x,'battlefield',q.id));const sn=Math.max(0,amt(step.count));createPrompt(s,q,{kind:'sacrifice',text:'Sacrifica '+sn+' permanente(s) por '+c.name+'.',options:opts,min:sn,max:sn});}break;}
   case 'handToTop':{for(const q of who(step.who,tp))createPrompt(s,q,{kind:'handToTop',text:'Pon una carta de tu mano encima de tu biblioteca ('+c.name+').',options:q.hand.map(x=>snap(x,'hand',q.id)),min:1,max:1});break;}
   case 'reveal':{for(const q of who(step.who,tp))createPrompt(s,p,{kind:'reveal',info:true,text:'Mano de '+q.name+' ('+c.name+').',options:q.hand.map(x=>snap(x,'hand',q.id)),min:0,max:0});break;}
   case 'scry':{const top=p.library.slice(-step.count).reverse();if(!top.length)break;if(step.order){createPrompt(s,p,{kind:'reveal',info:true,text:'Primeras cartas de tu biblioteca ('+c.name+'). Reordénalas a mano si quieres.',options:top.map(x=>snap(x,'library',p.id)),min:0,max:0});break;}createPrompt(s,p,{kind:'scry',surveil:!!step.surveil,text:(step.surveil?'Vigila ':'Adivina ')+step.count+': marca las cartas que van '+(step.surveil?'al cementerio':'al fondo')+'.',options:top.map(x=>snap(x,'library',p.id)),min:0,max:top.length});break;}
   case 'dig':{const top=p.library.slice(-step.look).reverse();if(!top.length)break;const ok2=x=>!step.spec||FX.matchCard(x,step.spec,{});const opts=top.filter(ok2);createPrompt(s,p,{kind:'dig',all:top.map(x=>snap(x,'library',p.id)),text:'Elige '+(step.upTo?'hasta ':'')+step.take+' para tu mano; el resto va al fondo ('+c.name+').',options:opts.map(x=>snap(x,'library',p.id)),min:step.upTo?0:Math.min(step.take,opts.length),max:step.take,info:step.upTo&&!opts.length});if(step.upTo&&!opts.length){for(const x of p.library.splice(-step.look))p.library.unshift(x);}break;}
   case 'pump':{
    let list=[];if(step.target==='self')list=src?[src]:[];else if(step.target==='chosen')list=[chosen().card];else if(step.target==='equipped'||step.target==='enchanted')list=src?.attachedTo?allPermanents(s).filter(x=>x.iid===src.attachedTo):[];else if(step.target==='each')list=s.players.flatMap(q=>q.battlefield.filter(x=>isCreature(x)&&FX.matchCard(x,step.spec,ctxOf(q.id,src||c,p.id))));
    const mb=step.morbid&&s.diedTurn===s.turn;const dp=mb?step.morbid.p:amt(step.p),dt=mb?step.morbid.t:amt(step.t);for(const x of list){x.eot=x.eot||{p:0,t:0,kws:[]};x.eot.p+=dp;x.eot.t+=dt;x.eot.kws=[...new Set([...x.eot.kws,...(step.kws||[])])];}
    if(list.length)log(s,p,c.name+': '+(list.length===1?list[0].name:list.length+' criaturas')+' '+(dp>=0?'+':'')+dp+'/'+(dt>=0?'+':'')+dt+(step.kws?.length?' y '+step.kws.join(', '):'')+' hasta el final del turno.','effect');
    applyStatics(s);creatureDeaths(s);break;}
   case 'untap':case 'tap':{let list=[];const on=step.type==='tap';if(step.target==='self')list=src?[src]:[];else if(step.target==='last')list=lastCard?[lastCard]:[];else if(step.target==='chosen')list=[chosen().card];else if(step.target==='each')list=s.players.flatMap(q=>q.battlefield.filter(x=>FX.matchCard(x,step.spec,ctxOf(q.id,src||c,p.id))));else if(step.target==='lands')list=p.battlefield.filter(x=>isLand(x)&&x.tapped).slice(0,step.count);for(const x of list)x.tapped=on;if(list.length)log(s,p,c.name+(on?' gira ':' endereza ')+(list.length===1?list[0].name:list.length+' permanentes')+'.','effect');break;}
   case 'extraTurn':(s.extraTurns||(s.extraTurns=[])).push(p.id);log(s,p,p.name+' jugará un turno adicional.','effect');break;
   case 'attach':{if(!src)break;createPrompt(s,p,{kind:'attach',sourceIid:src.iid,text:'Elige la criatura para '+src.name+'.',options:p.battlefield.filter(x=>isCreature(x)&&x.iid!==src.iid).map(x=>snap(x,'battlefield',p.id)),min:1,max:1});break;}
   case 'mode':{const source={iid:c.iid,name:c.name,id:c.id,image_uris:c.image_uris,...(c.xValue!==undefined?{xValue:c.xValue}:{})};createPrompt(s,p,{kind:'mode',text:'Elige '+(step.min===step.max?step.min:'de '+step.min+' a '+step.max)+' modo(s) de '+c.name+'.',options:step.modes.map((m,i)=>({iid:'mode-'+i,name:m.label.replace(/~/g,c.name),zone:'mode',playerId:p.id})),min:step.min,max:step.max,modes:step.modes.map(m=>m.steps),source});break;}
   case 'chooseType':{const source={iid:c.iid,name:c.name,id:c.id,image_uris:c.image_uris,...(c.xValue!==undefined?{xValue:c.xValue}:{})};createPrompt(s,p,{kind:'creature-type',text:'Elige un tipo de criatura para '+c.name+'.',rest:plan.slice(idx+1).map(x=>x.step),source});halt=true;break;}
   case 'regenerate':{const list=step.target==='self'?(src?[src]:[]):[chosen().card];for(const x of list){x.regen=(x.regen||0)+1;log(s,p,x.name+' tendrá un escudo de regeneración este turno.','effect');}break;}
   case 'monstrosity':{if(src&&!src.monstrous){const n=Math.max(0,amt(step.n));src.counters['+1/+1']=(src.counters['+1/+1']||0)+n;src.monstrous=true;log(s,p,src.name+' se vuelve monstruosa (+'+n+' contadores +1/+1).','effect');}break;}
   case 'putBack':{const k=Math.min(Math.max(0,amt(step.count)),p.hand.length);createPrompt(s,p,{kind:'putBack',text:'Elige '+k+' carta(s) de tu mano para ponerlas encima de tu biblioteca ('+c.name+'). La última que elijas quedará arriba.',options:p.hand.map(x=>snap(x,'hand',p.id)),min:k,max:k});break;}
   case 'wheel':{let most=0;const list=alive();for(const q of list){const n=q.hand.length;most=Math.max(most,n);for(const x of q.hand.splice(0))toGraveyard(s,q,x);log(s,q,q.name+' descarta su mano ('+n+').','effect');}const n=step.greatest?most:Math.max(0,amt(step.draw||0));if(n)for(const q of list)draw(s,q,n);break;}
   case 'delayed':{const q=step.who==='target-controller'?(last?player(s,last.playerId):null):p;if(!q)break;(s.delayed||(s.delayed=[])).push({turn:s.turn+1,playerId:q.id,steps:step.steps,name:c.name});log(s,p,c.name+': habrá un efecto en el próximo mantenimiento.','effect');break;}
   case 'copyToken':{const base=step.target==='self'?src:chosen().card;if(!base)break;makeToken(s,p,{name:base.name,type_line:base.type_line,oracle_text:base.oracle_text,mana_cost:base.mana_cost,cmc:base.cmc,power:base.power,toughness:base.toughness,colors:base.colors,color_identity:base.color_identity,keywords:base.printedKeywords||base.keywords||[],image_uris:base.image_uris,id:base.id},1);log(s,p,p.name+' crea una ficha copia de '+base.name+'.','token');break;}
   case 'putFromHand':{createPrompt(s,p,{kind:'putFromHand',tapped:step.tapped,text:'Puedes poner una carta de tu mano en el campo ('+c.name+').',options:p.hand.filter(x=>FX.matchCard(x,step.spec,{})).map(x=>snap(x,'hand',p.id)),min:0,max:1});break;}
   case 'pay':{try{payCost(s,p,step.mana,[]);log(s,p,p.name+' paga '+step.mana+'.','mana');}catch(e){log(s,p,p.name+' no puede pagar '+step.mana+': '+e.message,'warning');halt=true;}break;}
   case 'poison':{const n=Math.max(0,amt(step.count));for(const q of who(step.who,tp)){q.poison+=n;log(s,q,q.name+' recibe '+n+' contador(es) de veneno ('+q.poison+').','poison');}break;}
   case 'proliferate':{for(let k=0;k<(step.times||1);k++){// Elección por defecto favorable: tus contadores, el veneno rival y los -1/-1 en criaturas rivales.
     for(const q of s.players){if(q.id!==p.id&&q.poison>0&&!q.eliminated)q.poison++;for(const x of q.battlefield)for(const key of Object.keys(x.counters||{})){if(!(x.counters[key]>0))continue;const mine=q.id===p.id;const bad=/^-/.test(key);if((mine&&!bad)||(!mine&&bad))x.counters[key]++;}}}
     log(s,p,p.name+' prolifera'+(step.times>1?' dos veces':'')+'.','effect');break;}
   case 'addMana':{if(step.per){const n=Math.max(0,amt(step.per));const [k]=Object.keys(step.fixed);p.mana[k]+=n;log(s,p,p.name+' añade '+('{'+k+'}').repeat(n)+'.','mana');break;}addMana(s,p,step,payload.color);break;}
   case 'impulse':{const n=Math.max(0,amt(step.n));const until=step.until==='next'?s.turn+s.players.filter(q=>!q.eliminated).length:s.turn;const got=[];for(let i=0;i<n&&p.library.length;i++){const x=p.library.pop();x.playableBy=p.id;x.playableUntil=until;p.exile.push(x);got.push(x.name);}log(s,p,p.name+' exilia '+got.join(', ')+' y puede jugarla(s) '+(step.until==='next'?'hasta el final de su próximo turno.':'este turno.'),'effect');break;}
   case 'copySpell':{const e=s.stack.find(x=>x.id===target.spellId);if(!e)break;const copy={...JSON.parse(JSON.stringify(e)),id:'copy-'+(++s.nextInstance),controllerId:p.id};copy.card.iid='copy-'+s.nextInstance;copy.card.copy=true;s.stack.push(copy);resetResponseRound(s);log(s,p,p.name+' copia '+e.card.name+'.','effect');break;}
   case 'bounceOwn':createPrompt(s,p,{kind:'bounceOwn',text:'Devuelve a tu mano un permanente tuyo ('+c.name+').',options:p.battlefield.filter(x=>FX.matchCard(x,{...step.spec,controller:undefined},{})).map(x=>snap(x,'battlefield',p.id)),min:1,max:1});break;
   case 'revealAll':{const top=p.library.splice(-step.n).reverse();const hits=top.filter(x=>FX.matchCard(x,step.spec,{}));for(const x of hits)p.hand.push(x);for(const x of top.filter(x=>!hits.includes(x)))p.library.unshift(x);log(s,p,p.name+' revela '+top.length+' y se lleva '+hits.length+': '+hits.map(x=>x.name).join(', ')+'.','effect');break;}
   case 'cascade':{const seen=[];let hit=null;while(p.library.length){const x=p.library.pop();if(!isLand(x)&&(Number(x.cmc)||0)<step.mv){hit=x;break;}seen.push(x);}shuffle(s,seen);p.library.unshift(...seen);if(!hit){log(s,p,'Cascada: no hay ninguna carta válida.','effect');break;}log(s,p,'Cascada: '+p.name+' revela '+hit.name+' y la lanza gratis.','effect');if(isPermanent(hit)||/\b(Instant|Sorcery)\b/.test(hit.type_line||'')){s.stack.push({id:'spell-'+hit.iid+'-'+s.revision,controllerId:p.id,card:hit,from:'exile',effectStatus:FX.uncovered(hit).length?'manual':'supported'});resetResponseRound(s);fire(s,{on:'cast',card:hit,controllerId:p.id});}else p.exile.push(hit);break;}
   case 'note':log(s,p,c.name+': '+step.text,'manual');break;
  }
 }
 creatureDeaths(s);
}
function power(c,p){let v=c.cda&&c.cda.p!=null?c.cda.p:(Number(c.power)||0);if(c.name==='Rat Colony'&&!c.oracle_text&&p)v=2+p.battlefield.filter(x=>x.iid!==c.iid&&isCreature(x)&&/\bRat\b/.test(x.type_line||'')).length;v+=ptCounters(c)[0]+(c.mods?.p||0)+(c.eot?.p||0);return Math.max(0,v);}
// ——— Combate con bloqueadores (0.6) ———
function canBlock(att,blk,defender){if(!isCreature(blk)||blk.tapped)return false;if(defender){for(const [kw,t] of [['Forestwalk','Forest'],['Islandwalk','Island'],['Swampwalk','Swamp'],['Mountainwalk','Mountain'],['Plainswalk','Plains']])if(hasKw(att,kw)&&defender.battlefield.some(x=>new RegExp('\\b'+t+'\\b').test(x.type_line||'')))return false;}{const prot=ABIL(att).filter(a=>a.kind==='protection').flatMap(a=>a.colors);if(prot.length&&FX&&FX.colorsOf(blk).some(x=>prot.includes(x)))return false;}if(hasKw(blk,"Can't block")||hasKw(att,'Unblockable'))return false;if(hasKw(att,'Flying')&&!hasKw(blk,'Flying')&&!hasKw(blk,'Reach'))return false;const art=/\bArtifact\b/.test(blk.type_line||''),bc=FX?FX.colorsOf(blk):[];if(hasKw(att,'Fear')&&!art&&!bc.includes('B'))return false;if(hasKw(att,'Intimidate')&&!art&&!bc.some(x=>(FX?FX.colorsOf(att):[]).includes(x)))return false;if(hasKw(att,'Skulk')&&power(blk)>power(att))return false;{const ev=ABIL(att).find(a=>a.kind==='static'&&a.type==='evasion');if(ev&&power(blk)<=ev.maxPower)return false;}return true;}
function validateBlocks(s,combat,blocks){
 if(!Array.isArray(blocks)||blocks.length>60)throw Error('Bloqueos no válidos.');
 const attacker=player(s,combat.attackerId),defender=player(s,combat.targetPlayerId),used=new Set(),per=new Map();
 for(const b of blocks){
  if(!b||!combat.attackers.includes(b.attackerId))throw Error('Bloqueador no corresponde a un atacante.');
  if(used.has(b.blockerId))throw Error('Cada criatura bloquea a un solo atacante.');used.add(b.blockerId);
  const blk=defender.battlefield.find(c=>c.iid===b.blockerId),att=attacker.battlefield.find(c=>c.iid===b.attackerId);
  if(!blk)throw Error('El bloqueador debe ser una criatura del jugador atacado.');if(!att)continue;
  if(!canBlock(att,blk,defender))throw Error(blk.name+' no puede bloquear a '+att.name+(hasKw(att,'Flying')?' (vuela).':'.'));
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
   if(h.player){const tox=ABIL(h.source).filter(a=>a.kind==='toxic').reduce((n,a)=>n+a.n,0);if(hasKw(h.source,'Infect'))h.player.poison+=h.amount;else h.player.life-=h.amount;if(tox)h.player.poison+=tox;toPlayer+=h.amount;if(!struck.includes(h.source))struck.push(h.source);if(h.source.isCommander)h.player.commanderDamage[attacker.id]=(h.player.commanderDamage[attacker.id]||0)+h.amount;}
   else{if(hasKw(h.source,'Infect')||hasKw(h.source,'Wither'))h.card.counters['-1/-1']=(h.card.counters['-1/-1']||0)+h.amount;else h.card.damage=(h.card.damage||0)+h.amount;if(hasKw(h.source,'Deathtouch'))h.card.deathtouched=true;notes.push(h.source.name+' hace '+h.amount+' a '+h.card.name);}
   if(hasKw(h.source,'Lifelink')){h.so.life+=h.amount;fire(s,{on:'lifegain',playerId:h.so.id,amount:h.amount});}
  }
  creatureDeaths(s);
  for(const src of struck)fire(s,{on:'combat-damage',card:src,controllerId:attacker.id,playerId:target.id});
 }
 if(toPlayer)fire(s,{on:'combat-damage-batch',controllerId:attacker.id,playerId:target.id});
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
  case 'x':v=ctx.x||0;break;
  case 'spellsThisTurn':v=p.spellsTurn===s.turn?p.spellsCount||0:0;break;
  case 'oppPoison':v=s.players.filter(q=>q.id!==p.id).reduce((n,q)=>n+(q.poison||0),0);break;
  case 'eventToughness':v=Number((ctx.ev||src)?.eventToughness)||0;break;
  case 'eventPower':v=Number((ctx.ev||src)?.eventPower)||0;break;
  case 'eventAmount':v=Number((ctx.ev||src)?.eventAmount)||0;break;
  case 'selfPower':v=src&&src.mods?power(src,p):Number(src?.power)||0;break;
  case 'lastMv':v=ctx.lastMv||0;break;
  case 'sacMv':v=Number(src?.sacrificedMv)||0;break;
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
  if(a.condition?.monstrous&&!src.monstrous)continue;
  if(a.condition?.spec&&q.battlefield.filter(x=>FX.matchCard(x,{...a.condition.spec,controller:undefined},ctxOf(q.id,src,q.id))).length<a.condition.count)continue;
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
 if(['upkeep','endstep','combat','main','lifegain'].includes(ev.on))return a.opp?ev.playerId!==q.id:(!a.mine||ev.playerId===q.id);
 if(ev.on==='cast')return ev.controllerId===q.id&&(!a.spell||FX.matchCard(ev.card,a.spell,{}));
 if(ev.on==='combat-damage-batch')return ev.controllerId===q.id;
 const subj=a.subject,card=ev.card;if(!subj||!card)return false;
 if(ev.on==='combat-damage'&&a.opponent&&ev.playerId===q.id)return false;
 if(a.untapped&&card.tapped)return false;
 if(subj.self)return card.iid===src.iid||(!!subj.or&&FX.matchCard(card,subj.or,ctxOf(ev.controllerId,src,q.id)));
 if(subj.equipped||subj.enchanted)return card.iid===src.attachedTo;
 return FX.matchCard(card,subj,ctxOf(ev.controllerId,src,q.id));
}
// Pone en la pila las habilidades que se disparan (orden APNAP: las del jugador activo se resuelven al final).
function fire(s,ev){
 if(!FX)return;if(s.triggerBudget===undefined)s.triggerBudget=200;if(s.triggerBudget<=0)return;
 const found=[];
 for(const q of apnap(s)){const pool=[...q.battlefield];if(['dies','leaves','to-graveyard'].includes(ev.on)&&ev.controllerId===q.id&&ev.card&&!pool.some(c=>c.iid===ev.card.iid))pool.push(ev.card);
  for(const src of pool)for(const a of ABIL(src))if(a.kind==='trigger'&&triggerMatches(s,a,ev,src,q))found.push({a,src,q});
  for(const src of q.command)for(const a of ABIL(src))if(a.kind==='trigger'&&a.eminence&&triggerMatches(s,a,ev,src,q))found.push({a,src,q});}
 for(const {a,src,q} of found){
  if(a.once){src.onceTurn=src.onceTurn||{};if(src.onceTurn[a.text]===s.turn)continue;src.onceTurn[a.text]=s.turn;}
  if(a.batch){src.batchSeen=src.batchSeen||{};const k=s.revision+':'+ev.on;if(src.batchSeen[a.text]===k)continue;src.batchSeen={[a.text]:k};}
  if(--s.triggerBudget<0){log(s,q,'Demasiados disparos encadenados: resuelve el resto a mano.','warning');return;}
  pushAbility(s,q,src,a.steps,a.text,{optional:a.optional,event:ev});
 }
}
const ev2=ev=>['dies','enters','leaves','to-graveyard'].includes(ev.on)?ev.controllerId:ev.playerId||ev.controllerId;
function pushAbility(s,q,src,steps,text,opts={}){
 s.stack.push({id:'ability-'+(++s.nextInstance),controllerId:q.id,ability:true,optional:!!opts.optional,card:{iid:src.iid,name:src.name,id:src.id,image_uris:src.image_uris,card_faces:src.card_faces?.map(f=>({name:f.name,image_uris:f.image_uris})),type_line:'Habilidad',oracle_text:text,abilitySteps:steps,...(opts.event?{eventPlayerId:ev2(opts.event),...(opts.event.card?{eventCardIid:opts.event.card.iid,eventPower:opts.event.card.power,eventToughness:opts.event.card.toughness}:{}),...(opts.event.amount!==undefined?{eventAmount:opts.event.amount}:{})}:{}),...(src.power!==undefined?{power:src.power,toughness:src.toughness}:{}),...(src.chosenType?{chosenType:src.chosenType}:{}),...(opts.x!==undefined||src.xValue!==undefined?{xValue:opts.x??src.xValue}:{})},effectStatus:'supported'});
 resetResponseRound(s);log(s,q,(opts.activated?q.name+' activa una habilidad de ':'Se dispara una habilidad de ')+src.name+(opts.optional?' (opcional)':'')+'.','trigger');
}
// ——— Entrar al campo ———
function entersTapped(s,p,card){for(const a of ABIL(card))if(a.kind==='static'&&a.type==='entersTapped'){if(a.with){card.counters[a.with.counter]=(card.counters[a.with.counter]||0)+a.with.n;return true;}if(a.revealUnless){if(!p.hand.some(x=>FX.matchCard(x,a.revealUnless,{})))return true;continue;}if(a.fewer!==undefined){if(p.battlefield.filter(x=>x.iid!==card.iid&&isLand(x)).length>a.fewer)return true;continue;}if(a.opponents){if(s.players.filter(q=>q.id!==p.id&&!q.eliminated).length<a.opponents)return true;continue;}if(!a.unless)return true;const n=p.battlefield.filter(x=>x.iid!==card.iid&&FX.matchCard(x,{...a.unless.spec,controller:undefined,other:false},{})).length;if(n<a.unless.count)return true;}return false;}
function enter(s,p,card,opts={}){
 card.sick=true;card.tapped=!!opts.tapped||entersTapped(s,p,card);delete card.attacking;
 p.battlefield.push(card);
 if(/\bPlaneswalker\b/.test(card.type_line||'')&&Number(card.loyalty)>0&&!card.counters.Lealtad)card.counters.Lealtad=Number(card.loyalty);
 for(const a of ABIL(card)){if(a.kind!=='static')continue;
  if(a.type==='entersWith'){const n=typeof a.n==='number'?a.n:a.n?.of==='x'?Number(card.xValue)||0:0;if(n>0)card.counters[a.counter]=(card.counters[a.counter]||0)+n;}
  if(a.type==='shock'&&!card.tapped){if(p.bot){if(p.life>10){p.life-=a.life;log(s,p,p.name+' paga '+a.life+' vidas: '+card.name+' entra enderezada.','life');}else{card.tapped=true;log(s,p,card.name+' entra girada.','effect');}}else createPrompt(s,p,{kind:'shock',sourceIid:card.iid,life:a.life,text:card.name+': ¿pagas '+a.life+' vidas para que entre enderezada?',options:[{iid:'pay',name:'Pagar '+a.life+' vidas · entra enderezada',zone:'mode',playerId:p.id},{iid:'tap',name:'No pagar · entra girada',zone:'mode',playerId:p.id}],min:1,max:1});}
 }
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
  case 'discard':for(const o of chosen){const t=take(o);if(t){toGraveyard(s,t.q,t.card);log(s,t.q,t.q.name+' descarta '+t.card.name+'.','effect');}}break;
  case 'sacrifice':for(const o of chosen){const q=player(s,o.playerId),c=q.battlefield.find(x=>x.iid===o.iid);if(c)leaveBattlefield(s,q,c,'graveyard','se sacrifica y ');}break;
  case 'legend':for(const o of pr.options)if(!picks.includes(o.iid)){const c=p.battlefield.find(x=>x.iid===o.iid);if(c)leaveBattlefield(s,p,c,'graveyard','(regla de leyendas) ');}break;
  case 'search':{let top=null;for(const o of chosen){const t=take(o);if(!t)continue;if(pr.to==='battlefield'){enter(s,p,t.card,{tapped:pr.tapped});log(s,p,p.name+' busca '+t.card.name+' y la pone en el campo.','effect');}else if(pr.to==='graveyard'){p.graveyard.push(t.card);log(s,p,p.name+' busca '+t.card.name+' y la pone en su cementerio.','effect');}else if(pr.to==='top'){top=t.card;log(s,p,p.name+' busca una carta y la pondrá encima de su biblioteca.','effect');}else{p.hand.push(t.card);log(s,p,p.name+' busca una carta y la pone en su mano.','effect');}}if(!chosen.length)log(s,p,p.name+' no elige ninguna carta.','effect');shuffle(s,p.library);if(top)p.library.push(top);log(s,p,p.name+' baraja su biblioteca.','shuffle');break;}
  case 'return':for(const o of chosen){const t=take(o);if(!t)continue;if(t.q.id!==p.id)t.card.ownerId=t.q.id;if(pr.to==='battlefield')enter(s,p,t.card,{tapped:pr.tapped});else p.hand.push(t.card);log(s,p,p.name+' regresa '+t.card.name+' del cementerio '+(pr.to==='battlefield'?'al campo':'a su mano')+'.','effect');}break;
  case 'exile-card':for(const o of chosen){const t=take(o);if(t){t.q.exile.push(t.card);log(s,p,p.name+' exilia '+t.card.name+' del cementerio de '+t.q.name+'.','effect');}}break;
  case 'shock':if(src){if(picks[0]==='pay'){p.life-=pr.life;log(s,p,p.name+' paga '+pr.life+' vidas: '+src.name+' queda enderezada.','life');}else{src.tapped=true;log(s,p,src.name+' entra girada.','effect');}}break;
  case 'bounceOwn':for(const o of chosen){const c2=p.battlefield.find(x=>x.iid===o.iid);if(c2)leaveBattlefield(s,p,c2,'hand','');}break;
  case 'attach':if(src&&chosen[0]){src.attachedTo=chosen[0].iid;log(s,p,src.name+' queda unida a '+chosen[0].name+'.','effect');}break;
  case 'mode':for(const o of [...chosen].reverse()){const i=Number(String(o.iid).split('-')[1]);if(pr.modes?.[i])pushAbility(s,p,pr.source,pr.modes[i],o.name);}log(s,p,p.name+' elige: '+chosen.map(o=>o.name).join(' · ')+'.','effect');break;
  case 'creature-type':{const v=String(value||'').trim().replace(/[^\p{L} '-]/gu,'').slice(0,30);if(pr.rest&&v){const t2=v.charAt(0).toUpperCase()+v.slice(1);log(s,p,p.name+' elige el tipo '+t2+'.','effect');pushAbility(s,p,{...pr.source,chosenType:t2},pr.rest,pr.source.name+' · '+t2);break;}if(src&&v){src.chosenType=v.charAt(0).toUpperCase()+v.slice(1);log(s,p,p.name+' elige el tipo '+src.chosenType+' para '+src.name+'.','effect');}break;}
  case 'color':if(src&&['W','U','B','R','G'].includes(value)){src.chosenColor=value;log(s,p,p.name+' elige el color {'+value+'} para '+src.name+'.','effect');}break;
  case 'scry':{const moved=[];for(const o of chosen){const t=take(o);if(!t)continue;moved.push(t.card.name);if(pr.surveil)p.graveyard.push(t.card);else p.library.unshift(t.card);}log(s,p,p.name+(pr.surveil?' vigila ':' adivina ')+pr.options.length+': '+chosen.length+(pr.surveil?' al cementerio':' al fondo')+'.','effect');break;}
  case 'dig':{for(const o of chosen){const t=take(o);if(t)p.hand.push(t.card);}for(const o of (pr.all||pr.options))if(!picks.includes(o.iid)){const t=take(o);if(t)p.library.unshift(t.card);}log(s,p,p.name+' toma '+chosen.length+' carta(s) y pone el resto al fondo.','effect');break;}
  case 'putFromHand':for(const o of chosen){const t=take(o);if(t){log(s,p,p.name+' pone '+t.card.name+' en el campo.','effect');enter(s,p,t.card,{tapped:pr.tapped});}}break;
  case 'putBack':for(const o of chosen){const t=take(o);if(t)p.library.push(t.card);}log(s,p,p.name+' pone '+chosen.length+' carta(s) encima de su biblioteca.','effect');break;
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
case 'MOVE':{const {card,index}=locate(p,d.from,d.iid);if(!ZONES.includes(d.to)||d.from===d.to)throw Error('Destino no válido.');p[d.from].splice(index,1);card.tapped=false;card.damage=0;card.counters={};card.sick=true;if(d.to!=='battlefield')restoreKeywords(card);const home=card.ownerId&&card.ownerId!==p.id&&(['graveyard','exile','library','command'].includes(d.to)||(d.to==='hand'&&d.from==='battlefield'))?s.players.find(q=>q.id===card.ownerId):null;const dest=home||p;if(home)delete card.ownerId;const died=d.from==='battlefield'&&d.to==='graveyard'&&isCreature(card);const leftBf=()=>{if(d.from!=='battlefield'||d.to==='battlefield')return;if(died)fire(s,{on:'dies',card,controllerId:p.id});fire(s,{on:'leaves',card,controllerId:p.id});if(d.to==='graveyard')fire(s,{on:'to-graveyard',card,controllerId:p.id});};if(card.token&&d.from==='battlefield'&&d.to!=='battlefield'){log(s,p,card.name+' (ficha) deja de existir.','move');leftBf();break;}log(s,p,p.name+' mueve una carta de '+d.from+' a '+d.to+'.','move');if(d.to==='library'&&d.position==='bottom')dest.library.unshift(card);else if(d.to==='battlefield')enter(s,p,card);else dest[d.to].push(card);leftBf();break;}
case 'TAP':{const {card}=locate(p,'battlefield',d.iid);const tapped=typeof d.tapped==='boolean'?d.tapped:!card.tapped;if(tapped===card.tapped)break;const source=tapped&&d.produceMana!==false?manaSource(card,p):null;if(source){tapForMana(s,p,card,d.color);break;}card.tapped=tapped;log(s,p,p.name+(tapped?' gira ':' endereza ')+card.name+'.','tap');break;}
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
case 'CAST':{const from=d.from||'hand';if(!['hand','command','graveyard','exile'].includes(from))throw Error('Solo se asiste lanzar desde mano, zona de mando, cementerio o exilio.');const {card,index}=locate(p,from,d.iid);if(from==='exile'&&!(card.playableBy===p.id&&s.turn<=card.playableUntil))throw Error(card.name+' no se puede jugar desde el exilio ahora.');const castOpts=FX?FX.castOptions(card):{};if(from==='graveyard'&&(isLand(card)||!castOpts.flashback))throw Error(card.name+' no tiene escarmiento: usa Mover para casos especiales.');if(d.autoPay===true&&isLand(card))throw Error('Las tierras no necesitan pago automático.');if(isLand(card)){requireActive(s,p);if(p.landsPlayed>=1)throw Error('Ya jugaste una tierra este turno. Usa mover para excepciones manuales.');p[from].splice(index,1);delete card.playableBy;delete card.playableUntil;p.landsPlayed++;log(s,p,p.name+' juega '+card.name+'.','land');enter(s,p,card);break;}if(!/\bInstant\b/.test(card.type_line||'')&&!hasKw(card,'Flash')){if(s.activePlayerId!==p.id)throw Error(card.name+' no es instantáneo ni tiene destello: solo en tu turno.');if(s.stack.length||s.pendingCombat)throw Error(card.name+' no es instantáneo: espera a que la pila y el combate estén vacíos.');}const cc=castCost(s,p,card,from,d),tax=cc.tax;
// Coste alternativo: exiliar cartas de la mano, pagar vida o gratis con tu comandante.
const alt=Number.isInteger(d.alt)?(FX?FX.altCosts(card)[d.alt]:null):null;if(Number.isInteger(d.alt)&&!alt)throw Error('Coste alternativo no válido.');let altExile=[];
if(alt){if(alt.notYourTurn&&s.activePlayerId===p.id)throw Error('Ese coste alternativo solo vale en el turno de otro jugador.');if(alt.commander&&!p.battlefield.some(x=>x.isCommander))throw Error('Necesitas controlar a tu comandante para lanzarla gratis.');if(alt.life&&p.life<alt.life)throw Error('No tienes vidas suficientes.');
 if(alt.exile){const ids=[...new Set(Array.isArray(d.exile)?d.exile:[])];if(ids.length!==alt.exile.count)throw Error('Elige '+alt.exile.count+' carta(s) de tu mano para exiliar.');altExile=ids.map(id=>{if(id===card.iid)throw Error('No puedes exiliar la carta que lanzas.');const x=locate(p,'hand',id).card;if(!alt.exile.spec.any&&!FX.matchCard(x,alt.exile.spec,{}))throw Error(x.name+' no cumple el coste alternativo.');return x;});}}
// Costes adicionales: sacrificar, descartar o pagar vida al lanzar.
const extra=FX?FX.additionalCost(card):null;let extraSac=null,extraDiscard=null;
if(extra?.sacrifice&&!(extra.orMana&&!(Array.isArray(d.sacrifice)?d.sacrifice[0]:d.sacrifice))){const id=Array.isArray(d.sacrifice)?d.sacrifice[0]:d.sacrifice;if(!id)throw Error(card.name+' pide un coste adicional («'+extra.text+'»): elige qué sacrificar.');extraSac=locate(p,'battlefield',id).card;if(!FX.matchCard(extraSac,{...extra.sacrifice,controller:undefined},{}))throw Error(extraSac.name+' no sirve para el coste adicional.');}
if(extra?.discard){const id=Array.isArray(d.discard)?d.discard[0]:d.discard;if(!id||id===card.iid)throw Error(card.name+' pide descartar una carta como coste adicional.');extraDiscard=locate(p,'hand',id).card;if(!extra.discard.any&&!FX.matchCard(extraDiscard,extra.discard,{}))throw Error(extraDiscard.name+' no sirve para el coste adicional.');}
if(extra?.life&&p.life<extra.life)throw Error('No tienes vidas suficientes para el coste adicional.');
// Delve y convocar: cartas del cementerio exiliadas y criaturas/artefactos girados pagan genérico.
const helpersDelve=castOpts.delve?Math.min(Math.max(0,Math.floor(Number(d.delve)||0)),p.graveyard.filter(c=>c.iid!==card.iid).length):0;
const helpersTap=(castOpts.convoke||castOpts.improvise)&&Array.isArray(d.convoke)?[...new Set(d.convoke)].map(id=>{const x=locate(p,'battlefield',id).card;if(x.tapped)throw Error(x.name+' ya está girada.');if(castOpts.convoke&&!isCreature(x)&&!(castOpts.improvise&&/\bArtifact\b/.test(x.type_line||'')))throw Error(x.name+' no puede ayudar a pagar.');if(!castOpts.convoke&&!/\bArtifact\b/.test(x.type_line||''))throw Error(x.name+' no es un artefacto.');return x;}):[];
if(alt){}else if(d.autoPay===true){if(d.autoPayRevision!==s.revision)throw Error('La vista previa del pago ya no está vigente. Revisa las tierras antes de confirmar.');const plan=autoPaymentPlan(s,p.id,d.iid,from,{cast:d});if(!plan.ok)throw Error(plan.reason);if(!Array.isArray(d.landIds)||d.landIds.length!==plan.landIds.length||d.landIds.some((id,i)=>id!==plan.landIds[i]))throw Error('Las fuentes del pago cambiaron. Genera una nueva vista previa.');payWithPlan(s,p,plan,cc.card,tax);log(s,p,p.name+' confirma el pago automático: gira '+plan.landIds.length+' fuente(s) propia(s) y usa su reserva.','mana');}else if(d.payMana)p.mana=payment(p.mana,cc.card,tax);p[from].splice(p[from].findIndex(x=>x.iid===card.iid),1);delete card.playableBy;delete card.playableUntil;if(from==='command')p.commanderCasts++;
for(const k of ['xValue','kicked','buyback','overloaded','flashback','sacrificedMv'])delete card[k];if(cc.x)card.xValue=cc.x;if(d.kicker&&castOpts.kicker)card.kicked=true;if(d.buyback&&castOpts.buyback)card.buyback=true;if(d.overload&&castOpts.overload)card.overloaded=true;if(from==='graveyard')card.flashback=true;if(extraSac)card.sacrificedMv=Number(extraSac.cmc)||0;
s.stack.push({id:'spell-'+card.iid+'-'+s.revision,controllerId:p.id,card,from,effectStatus:(FX?FX.uncovered(card).length===0:effectSteps(card))?'supported':'manual'});resetResponseRound(s);log(s,p,p.name+' lanza '+card.name+(cc.x?' (X='+cc.x+')':'')+(card.kicked?' con estímulo':'')+(card.buyback?' con retroceso':'')+(card.overloaded?' con sobrecarga':'')+(card.flashback?' con escarmiento':'')+(alt?' con su coste alternativo':'')+(tax>0?' (impuesto '+tax+').':tax<0?' (cuesta '+(-tax)+' menos).':'.')+(!alt&&!d.payMana&&!d.autoPay?' Pago manual.':''),'cast');
if(helpersDelve){const gone=p.graveyard.filter(c=>c.iid!==card.iid).slice(0,helpersDelve);for(const x of gone){p.graveyard.splice(p.graveyard.indexOf(x),1);p.exile.push(x);}log(s,p,p.name+' exilia '+gone.length+' carta(s) de su cementerio (delve).','effect');}
for(const x of helpersTap)x.tapped=true;if(helpersTap.length)log(s,p,p.name+' gira '+helpersTap.length+' permanente(s) para ayudar a pagar.','effect');
if(p.spellsTurn!==s.turn){p.spellsTurn=s.turn;p.spellsCount=0;}p.spellsCount++;
for(const x of altExile){p.hand.splice(p.hand.findIndex(y=>y.iid===x.iid),1);p.exile.push(x);log(s,p,p.name+' exilia '+x.name+' de su mano como coste alternativo.','effect');}if(alt?.life){p.life-=alt.life;log(s,p,p.name+' paga '+alt.life+' vidas.','effect');}
if(extraDiscard){p.hand.splice(p.hand.findIndex(x=>x.iid===extraDiscard.iid),1);p.graveyard.push(extraDiscard);log(s,p,p.name+' descarta '+extraDiscard.name+' como coste adicional.','effect');}
if(extra?.life){p.life-=extra.life;log(s,p,p.name+' paga '+extra.life+' vidas como coste adicional.','effect');}
if(extraSac)leaveBattlefield(s,p,extraSac,'graveyard','se sacrifica como coste adicional y ');
if(castOpts.cascade)pushAbility(s,p,card,[{type:'cascade',mv:Number(card.cmc)||0}],'Cascada de '+card.name);
fire(s,{on:'cast',card,controllerId:p.id});break;}
case 'RESOLVE':{if(!s.stack.length)throw Error('La pila está vacía.');if(s.stack.at(-1).controllerId!==p.id)requireActive(s,p);if(s.responseChecks===true&&!responseStatus(s).ready)throw Error('Faltan confirmaciones en la ronda de respuestas del hechizo superior.');const e=s.stack.pop();resetResponseRound(s);const owner=player(s,e.controllerId);if(e.ability){if(d.decline===true&&e.optional){log(s,owner,owner.name+' decide no usar la habilidad de '+e.card.name+'.','resolve');break;}log(s,owner,'Se resuelve la habilidad de '+e.card.name+'.','resolve');resolveEffect(s,owner,e.card,d,e.id);break;}log(s,owner,'Se resuelve '+e.card.name+'.','resolve');if(e.card.copy&&!isPermanent(e.card)){resolveEffect(s,owner,e.card,d,e.id);break;}if(isPermanent(e.card))enter(s,owner,e.card);else if(e.card.buyback)owner.hand.push(e.card);else if(e.card.flashback)owner.exile.push(e.card);else toGraveyard(s,owner,e.card);resolveEffect(s,owner,e.card,d,e.id);for(const k of ['xValue','kicked','buyback','overloaded','flashback','sacrificedMv'])delete e.card[k];break;}
case 'TOKEN':{const kind=['creature','artifact','enchantment'].includes(d.kind)?d.kind:'creature';const count=d.count===undefined?1:Number(d.count);if(!Number.isInteger(count)||count<1||count>20)throw Error('Crea entre 1 y 20 fichas a la vez.');const sub=String(d.types||'').replace(/[^\p{L} '-]/gu,'').trim().slice(0,40);const kws=(Array.isArray(d.keywords)?d.keywords:[]).filter(k=>['Flying','Reach','Vigilance','Haste','Trample','Lifelink','Deathtouch','Menace','First strike','Double strike','Indestructible','Defender'].includes(k));const colors=(Array.isArray(d.colors)?d.colors:[]).filter(x=>['W','U','B','R','G'].includes(x));const pt=v=>{const n=Number(v??1);if(!Number.isInteger(n)||n<0||n>99)throw Error('Fuerza y resistencia deben ser números entre 0 y 99.');return String(n);};const base={name:String(d.name||sub||'Ficha').slice(0,80),type_line:'Token '+(kind==='creature'?'Creature':kind==='artifact'?'Artifact':'Enchantment')+(sub?' — '+sub:''),oracle_text:String(d.text||'').slice(0,300),keywords:kws,colors,color_identity:colors,token:true};if(kind==='creature'){base.power=pt(d.power);base.toughness=pt(d.toughness);}log(s,p,p.name+' crea '+(count>1?count+' fichas de ':'')+base.name+(kind==='creature'?' '+base.power+'/'+base.toughness:'')+'.','token');makeToken(s,p,{...base,tapped:d.tapped===true},count);break;}
case 'COUNTER':{const {card}=locate(p,'battlefield',d.iid);const name=String(d.name||'+1/+1').trim().slice(0,30);if(['__proto__','constructor','prototype'].includes(name)||!COUNTER_NAME.test(name))throw Error('Nombre de contador no válido.');const next=Math.max(0,(Number(card.counters[name])||0)+number(d.delta));if(next)card.counters[name]=next;else delete card.counters[name];log(s,p,card.name+': '+(next?next+' contador(es) '+name:'sin contadores '+name)+'.','counter');creatureDeaths(s);break;}
case 'KEYWORD':{const {card}=locate(p,'battlefield',d.iid);if(!KEYWORDS.includes(d.keyword))throw Error('Habilidad no reconocida.');if(typeof d.on!=='boolean')throw Error('Indica si se añade o se quita.');const mk=card.manualKw||{add:[],remove:[]};const add=new Set(mk.add),rem=new Set(mk.remove);if(d.on){add.add(d.keyword);rem.delete(d.keyword);}else{rem.add(d.keyword);add.delete(d.keyword);}card.manualKw={add:[...add],remove:[...rem]};applyStatics(s);log(s,p,card.name+(d.on?' gana ':' pierde ')+d.keyword+'.','keyword');break;}
case 'TAKE':{const from=player(s,d.fromPlayerId);if(from.id===p.id)throw Error('Usa Mover para tus propias cartas.');if(!['graveyard','exile'].includes(d.from))throw Error('Solo puedes tomar cartas del cementerio o exilio de otro jugador.');if(!['hand','battlefield','graveyard','exile'].includes(d.to))throw Error('Destino no válido.');const {card,index}=locate(from,d.from,d.iid);from[d.from].splice(index,1);card.ownerId=card.ownerId||from.id;restoreKeywords(card);card.tapped=false;card.damage=0;card.counters={};card.sick=true;if(d.to==='battlefield')enter(s,p,card);else p[d.to].push(card);log(s,p,p.name+' toma '+card.name+' del '+(d.from==='graveyard'?'cementerio':'exilio')+' de '+from.name+' y la pone en '+({hand:'su mano',battlefield:'el campo',graveyard:'su cementerio',exile:'su exilio'}[d.to])+'.','move');break;}
case 'COMBAT':{requireActive(s,p);if(s.pendingCombat||s.stack.length)throw Error('Hay un combate o pila pendiente.');const target=player(s,d.targetPlayerId);if(target.id===p.id||target.eliminated)throw Error('Elige un oponente disponible.');const ids=[...new Set(d.attackers||[])];if(!ids.length)throw Error('Selecciona atacantes.');for(const id of ids){const {card}=locate(p,'battlefield',id);if(!isCreature(card)||card.tapped||(card.sick&&!(card.keywords||[]).includes('Haste')))throw Error('Hay un atacante no disponible.');}for(const id of ids){const {card}=locate(p,'battlefield',id);if(!(card.keywords||[]).includes('Vigilance'))card.tapped=true;}for(const id of ids){const {card}=locate(p,'battlefield',id);if(hasKw(card,'Defender'))throw Error(card.name+' tiene defensor y no puede atacar.');}s.pendingCombat={attackerId:p.id,targetPlayerId:target.id,attackers:ids,autoEndTurn:!!d.autoEndTurn,blocks:[]};s.phase=2;p.attackedTurn=s.turn;for(const id of ids){const {card}=locate(p,'battlefield',id);card.attacking=true;}if(target.bot&&BOT()){s.pendingCombat.blocks=BOT().suggestBlocks(api,s);s.pendingCombat.blocksDeclared=true;if(s.pendingCombat.blocks.length)log(s,target,target.name+' (bot) declara '+s.pendingCombat.blocks.length+' bloqueo(s).','combat');}log(s,p,p.name+' declara '+ids.length+' atacante(s) contra '+target.name+'. Confirma bloqueos antes de aplicar daño.','combat');for(const id of ids){const {card}=locate(p,'battlefield',id);fire(s,{on:'attacks',card,controllerId:p.id,playerId:target.id});}break;}
case 'DECLARE_BLOCKS':{const combat=s.pendingCombat;if(!combat)throw Error('No hay un combate pendiente.');if(p.id!==combat.targetPlayerId)throw Error('Solo el jugador atacado declara sus bloqueos.');combat.blocks=validateBlocks(s,combat,d.blocks||[]);combat.blocksDeclared=true;log(s,p,p.name+' declara '+combat.blocks.length+' bloqueo(s).','combat');break;}
case 'RESOLVE_COMBAT':{requireActive(s,p);if(!s.pendingCombat||d.confirm!==true)throw Error('Confirma la resolución del combate.');if(s.stack.length)throw Error('Resuelve primero las habilidades que están en la pila.');if(Array.isArray(d.blockedIds)&&!Array.isArray(d.blocks)){const combat=s.pendingCombat,attacker=player(s,combat.attackerId),target=player(s,combat.targetPlayerId);const blocked=new Set(d.blockedIds||[]);if([...blocked].some(id=>!combat.attackers.includes(id)))throw Error('Bloqueador no corresponde a un atacante.');let damage=0;for(const id of combat.attackers){const card=attacker.battlefield.find(c=>c.iid===id);if(!card||blocked.has(id))continue;let n=power(card,attacker);if((card.keywords||[]).includes('Double strike'))n*=2;damage+=n;if(card.isCommander)target.commanderDamage[attacker.id]=(target.commanderDamage[attacker.id]||0)+n;if((card.keywords||[]).includes('Lifelink'))attacker.life+=n;}target.life-=damage;log(s,attacker,damage+' de daño no bloqueado a '+target.name+'. Daño a criaturas, arrollar, prevención y otros efectos se resuelven manualmente.','combat');s.pendingCombat=null;status(s);if(combat.autoEndTurn&&!s.winnerId)endTurn(s,p);break;}const combat=s.pendingCombat;const blocks=validateBlocks(s,combat,Array.isArray(d.blocks)?d.blocks:combat.blocks||[]);{const att=player(s,combat.attackerId),def=player(s,combat.targetPlayerId);const bush=(c,q)=>{const b=c&&ABIL(c).find(a=>a.kind==='bushido');if(b){c.eot=c.eot||{p:0,t:0,kws:[]};c.eot.p+=b.n;c.eot.t+=b.n;log(s,q,c.name+' gana +'+b.n+'/+'+b.n+' (bushido).','effect');}};for(const id of new Set(blocks.map(b=>b.attackerId)))bush(att.battlefield.find(x=>x.iid===id),att);for(const b of blocks)bush(def.battlefield.find(x=>x.iid===b.blockerId),def);applyStatics(s);}fightCombat(s,combat,blocks);s.pendingCombat=null;for(const c of p.battlefield)delete c.attacking;status(s);if(combat.autoEndTurn&&!s.winnerId&&!s.stack.length)endTurn(s,p);break;}
case 'CHOOSE':{const pr=(s.prompts||[]).find(x=>x.id===d.promptId);if(!pr)throw Error('Esa elección ya no está pendiente.');if(pr.playerId!==p.id)throw Error('Esta elección corresponde a otro jugador.');
 if(!LIST_PROMPT(pr)){if(typeof d.value!=='string'||!d.value.trim())throw Error('Elige una opción.');answerPrompt(s,pr,[],d.value);break;}
 const picks=Array.isArray(d.picks)?[...new Set(d.picks)]:[];if(picks.some(id=>!pr.options.some(o=>o.iid===id)))throw Error('Opción no válida.');if(picks.length<pr.min||picks.length>pr.max)throw Error(pr.min===pr.max?'Elige '+pr.min+'.':'Elige entre '+pr.min+' y '+pr.max+'.');answerPrompt(s,pr,picks);break;}
case 'ACTIVATE':{
 const {card}=locate(p,'battlefield',d.iid);const ab=ABIL(card).filter(x=>x.kind==='activated')[Number(d.index)||0];if(!ab)throw Error('Esa habilidad no existe.');
 if(ab.sorcery&&(s.activePlayerId!==p.id||s.stack.length||s.pendingCombat))throw Error('Esta habilidad solo se activa como un conjuro: en tu turno y con la pila vacía.');
 if(ab.onceTurn&&card.activatedTurn===s.turn)throw Error('Esta habilidad solo se activa una vez por turno.');
 const c=ab.cost;
 if(c.loyalty!==undefined){if(card.loyaltyTurn===s.turn)throw Error('Ya usaste una habilidad de lealtad de '+card.name+' este turno.');const have=Number(card.counters.Lealtad)||0;if(c.loyalty<0&&have<-c.loyalty)throw Error(card.name+' no tiene lealtad suficiente.');card.counters.Lealtad=have+c.loyalty;card.loyaltyTurn=s.turn;log(s,p,card.name+': '+(c.loyalty>0?'+':'')+c.loyalty+' lealtad ('+card.counters.Lealtad+').','counter');}
 if(c.tap){if(card.tapped)throw Error(card.name+' ya está girada.');if(isCreature(card)&&card.sick&&!hasKw(card,'Haste'))throw Error(card.name+' acaba de entrar: aún no puede girarse.');}
 const pick=(zone,ids,need,spec,label)=>{ids=[...new Set(Array.isArray(ids)?ids:[])];if(ids.length!==need)throw Error('Elige '+need+' '+label+'.');return ids.map(id=>{const x=locate(p,zone,id).card;if(spec.other&&x.iid===card.iid)throw Error('El coste pide otra carta distinta de '+card.name+'.');if(!spec.any&&!FX.matchCard(x,{...spec,controller:undefined},{srcIid:card.iid}))throw Error(x.name+' no cumple el coste.');return x;});};
 const sacs=c.sac?pick('battlefield',d.sacrifice,c.sac.count,c.sac.spec,'permanente(s) para sacrificar'):[];
 const discards=c.discard?pick('hand',d.discard,c.discard.count,c.discard.spec,'carta(s) para descartar'):[];
 const lifeCost=c.life||(c.lifeIdentity?(p.command.find(x=>x.isCommander)||p.battlefield.find(x=>x.isCommander))?.color_identity?.length||0:0);if(lifeCost&&p.life<lifeCost)throw Error('No tienes vidas suficientes.');
 if(c.removeCounters&&(Number(card.counters?.[c.removeCounters.kind])||0)<c.removeCounters.count)throw Error('Faltan contadores para el coste.');
 const x=/\{X\}/.test(c.mana||'')?Math.max(0,Math.min(99,Math.floor(Number(d.x)||0))):undefined;
 if(c.mana){const m=c.mana.replace(/\{X\}/g,x?'{'+x+'}':'')||'{0}';payCost(s,p,m,[...(c.tap||c.sacSelf?[card.iid]:[]),...sacs.map(y=>y.iid)]);}
 if(c.tap)card.tapped=true;
 if(lifeCost)p.life-=lifeCost;
 if(c.removeCounters){const k=c.removeCounters.kind;card.counters[k]-=c.removeCounters.count;if(card.counters[k]<=0)delete card.counters[k];}
 for(const x of discards){p.hand.splice(p.hand.findIndex(y=>y.iid===x.iid),1);p.graveyard.push(x);}
 card.activatedTurn=s.turn;
 // Habilidades de maná sin {T} (altares): no usan la pila.
 if(ab.steps.every(st=>st.type==='addMana')){for(const st of ab.steps)addMana(s,p,st,d.color);for(const x of sacs)leaveBattlefield(s,p,x,'graveyard','se sacrifica y ');if(c.sacSelf)leaveBattlefield(s,p,card,'graveyard','se sacrifica y ');break;}
 pushAbility(s,p,card,ab.steps,ab.text,{activated:true,x});
 for(const x of sacs)leaveBattlefield(s,p,x,'graveyard','se sacrifica y ');
 if(c.sacSelf)leaveBattlefield(s,p,card,'graveyard','se sacrifica y ');
 break;}
case 'CYCLE':{const {card}=locate(p,'hand',d.iid);const o=FX?FX.castOptions(card):{};if(!o.cycling&&!o.typecycling)throw Error(card.name+' no tiene ciclo.');payCost(s,p,o.cycling||o.typecycling.mana,[]);p.hand.splice(p.hand.findIndex(x=>x.iid===card.iid),1);p.graveyard.push(card);log(s,p,p.name+' recicla '+card.name+'.','effect');if(o.cycling)draw(s,p,1);else{const opts=p.library.filter(x=>FX.matchCard(x,o.typecycling.spec,{})).map(x=>snap(x,'library',p.id));if(opts.length)createPrompt(s,p,{kind:'search',to:'hand',text:'Busca en tu biblioteca ('+card.name+').',options:opts,min:0,max:1});else{shuffle(s,p.library);log(s,p,p.name+' no encuentra cartas válidas y baraja.','effect');}}break;}
case 'NINJUTSU':{const from=d.from==='command'?'command':'hand';const {card}=locate(p,from,d.iid);const o=FX?FX.castOptions(card):{};if(!o.ninjutsu||(from==='command'&&!o.ninjutsu.commander))throw Error(card.name+' no tiene ninjutsu'+(from==='command'?' de comandante':'')+'.');
 const combat=s.pendingCombat;if(!combat||combat.attackerId!==p.id)throw Error('Ninjutsu se usa durante tu ataque.');if(!combat.blocksDeclared)throw Error('Espera a que el defensor declare sus bloqueos.');if(s.stack.length)throw Error('Resuelve primero la pila.');
 if(!combat.attackers.includes(d.returnIid)||(combat.blocks||[]).some(b=>b.attackerId===d.returnIid))throw Error('Elige una criatura atacante que no haya sido bloqueada.');
 const back=locate(p,'battlefield',d.returnIid).card;payCost(s,p,o.ninjutsu.mana,[back.iid]);
 combat.attackers=combat.attackers.filter(x=>x!==back.iid);leaveBattlefield(s,p,back,'hand','');
 p[from].splice(p[from].findIndex(x=>x.iid===card.iid),1);log(s,p,p.name+' usa ninjutsu: '+card.name+' entra al campo girada y atacando.','effect');enter(s,p,card,{tapped:true});card.attacking=true;combat.attackers.push(card.iid);break;}
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
const api={activated,castCost,maxHand,costReduction,amountOf,KEYWORDS,PHASES,COLORS,ZONES,SUMMARY,createGame,dispatch,botTurn,validateDeck,viewFor,power,toughness,ptCounters,cost,simpleLandMana,manaSource,autoPaymentPlan,responseStatus,effectPlan,legalTargets,canBlock,isCreature,isLand,hasKw};
return api;
});
