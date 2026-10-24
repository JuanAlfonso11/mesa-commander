/* Mesa Commander — bots 0.6. Deciden solo con información pública (campo, vidas, pila) y su propia mano.
   Deterministas: el mismo estado produce las mismas acciones. */
(function(root, factory) {
  var api=factory(); if(typeof module==='object'&&module.exports) module.exports=api; root.MBOT=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const SPELL_CAP=8;
const kw=(c,k)=>(c.keywords||[]).includes(k);
const cmcOf=c=>Number.isFinite(Number(c.cmc))?Number(c.cmc):((c.mana_cost||'').match(/\{[^}]+\}/g)||[]).reduce((n,x)=>n+(/^\{\d+\}$/.test(x)?Number(x.slice(1,-1)):1),0);
function opponents(s,id){return s.players.filter(q=>q.id!==id&&!q.eliminated);}
// Valor aproximado de una criatura en mesa, para elegir objetivos y bloqueos.
function threat(MC,c,owner){if(!MC.isCreature(c))return cmcOf(c)*0.6;let v=MC.power(c,owner)*1.5+MC.toughness(c)*0.5;for(const k of ['Flying','Deathtouch','Lifelink','Double strike','Trample','First strike','Menace'])if(kw(c,k))v+=1.5;if(c.isCommander)v+=4;return v;}
// Objetivo preferido para un paso de efecto. null si no conviene lanzarlo.
function chooseTarget(MC,s,me,step,options){
 if(!options.length)return null;
 const mine=o=>o.target.playerId===me.id;
 const card=o=>o.target.iid?s.players.find(q=>q.id===o.target.playerId).battlefield.find(c=>c.iid===o.target.iid):null;
 const owner=o=>s.players.find(q=>q.id===o.target.playerId);
 if(step.type==='counter'){const theirs=options.filter(o=>{const e=s.stack.find(x=>x.id===o.target.spellId);return e&&e.controllerId!==me.id;});return theirs[0]||null;}
 if(step.type==='counters'){const own=options.filter(mine).sort((a,b)=>threat(MC,card(b),me)-threat(MC,card(a),me));return own[0]||null;}
 if(step.type==='draw')return options.find(mine)||null;
 if(step.type==='loseLife'){const opp=options.filter(o=>!mine(o)&&!o.target.iid).sort((a,b)=>owner(a).life-owner(b).life);return opp[0]||null;}
 if(step.type==='damage'){
  // Mata la mejor criatura rival que muera con este daño; si no, a la cara del rival con menos vidas.
  const kills=options.filter(o=>o.target.iid&&!mine(o)).filter(o=>{const c=card(o);return MC.isCreature(c)&&!kw(c,'Indestructible')&&MC.toughness(c)-(c.damage||0)<=step.amount;}).sort((a,b)=>threat(MC,card(b),owner(b))-threat(MC,card(a),owner(a)));
  if(kills.length&&threat(MC,card(kills[0]),owner(kills[0]))>=3)return kills[0];
  const faces=options.filter(o=>!o.target.iid&&!mine(o)).sort((a,b)=>owner(a).life-owner(b).life);
  return faces[0]||kills[0]||null;
 }
 if(['destroy','exile','bounce'].includes(step.type)){const theirs=options.filter(o=>!mine(o)).sort((a,b)=>threat(MC,card(b),owner(b))-threat(MC,card(a),owner(a)));return theirs[0]||null;}
 return null;
}
// Objetivos para todos los pasos; null si alguno no tiene un objetivo razonable.
function planTargets(MC,s,me,entry){const plan=MC.effectPlan(s,entry);if(!plan.supported)return {targets:[]};const targets=[];for(const t of plan.targeted){const step=plan.steps[t.index];const pick=chooseTarget(MC,s,me,step,t.options);if(!pick)return null;targets.push(pick.target);}return {targets};}
// ¿Vale la pena lanzar esta carta ahora?
function castScore(MC,s,me,c,from){
 const steps=MC.effectPlan(s,{card:c,controllerId:me.id,id:'preview'});
 const spell=/\b(Instant|Sorcery)\b/.test(c.type_line||'');
 if(spell&&!steps.supported)return null; // no lanza hechizos que no entiende
 if(spell&&steps.steps.some(x=>x.type==='counter'))return null; // guarda contrahechizos
 if(spell&&steps.steps.some(x=>x.type==='wipe')){const mineN=me.battlefield.filter(MC.isCreature).length,theirs=opponents(s,me.id).reduce((n,q)=>n+q.battlefield.filter(MC.isCreature).length,0);if(theirs<mineN+2)return null;}
 if(!spell&&!/\b(Creature|Artifact|Enchantment|Planeswalker|Battle)\b/.test(c.type_line||''))return null;
 if(steps.targeted.length&&!planTargets(MC,s,me,{card:c,controllerId:me.id,id:'preview'}))return null;
 let v=cmcOf(c)*2;if(from==='command')v+=6;if(MC.isCreature(c))v+=2;
 if(steps.steps.some(x=>x.type==='ramp'))v+=me.battlefield.length<8?5:0;
 if(steps.steps.some(x=>x.type==='draw')&&me.hand.length<=3)v+=3;
 if(steps.steps.some(x=>['destroy','exile','damage'].includes(x.type)))v+=3;
 return v;
}
function landScore(MC,me,land){
 const src=MC.manaSource(land,me);if(!src)return 0;
 const have=new Set();for(const c of me.battlefield){const x=MC.manaSource(c,me);if(x)x.options.forEach(o=>have.add(o));}
 const wanted=new Map();for(const c of [...me.hand,...me.command])for(const sym of (c.mana_cost||'').match(/\{[WUBRG]\}/g)||[]){const k=sym[1];wanted.set(k,(wanted.get(k)||0)+1);}
 let v=1+src.options.length*0.2;for(const o of src.options)if(wanted.has(o))v+=have.has(o)?wanted.get(o)*0.3:wanted.get(o)*2;
 if(/enters (the battlefield )?tapped/i.test(land.oracle_text||''))v-=0.5;
 return v;
}
function botTurn(MC,state,id){
 let s=state,events=[];let me=s.players.find(p=>p.id===id);
 if(!me||!me.bot||s.activePlayerId!==id||s.pendingCombat||s.stack.length||s.winnerId)return {state:s,events,error:'El bot no puede actuar ahora.'};
 let seq=0;
 function act(type,payload={}){const r=MC.dispatch(s,{id:'bot-'+s.turn+'-'+s.revision+'-'+(++seq),type,actorId:id,payload});if(r.ok){s=r.state;events.push(...r.events);me=s.players.find(p=>p.id===id);}return r.ok;}
 if(!me.turnDrawn)act('DRAW',{count:1});
 // 1. Tierra: la que más colores útiles aporta.
 if(me.landsPlayed<1){const lands=me.hand.filter(MC.isLand).map(c=>({c,v:landScore(MC,me,c)})).sort((a,b)=>b.v-a.v);if(lands.length)act('CAST',{iid:lands[0].c.iid,from:'hand'});}
 // 2. Hechizos: de mayor valor a menor, pagando con el pago automático (sin girar tierras de más).
 for(let i=0;i<SPELL_CAP&&!s.winnerId;i++){
  const options=[...me.hand.map(c=>({c,from:'hand'})),...me.command.map(c=>({c,from:'command'}))].filter(({c})=>!MC.isLand(c));
  let best=null;
  for(const o of options){const plan=MC.autoPaymentPlan(s,id,o.c.iid,o.from);if(!plan.ok)continue;const v=castScore(MC,s,me,o.c,o.from);if(v===null)continue;if(!best||v>best.v)best={...o,plan,v};}
  if(!best)break;
  if(!act('CAST',{iid:best.c.iid,from:best.from,autoPay:true,autoPayRevision:s.revision,landIds:best.plan.landIds}))break;
  const entry=s.stack.at(-1);const t=planTargets(MC,s,me,entry)||{targets:[]};
  if(!act('RESOLVE',t.targets.length?{targets:t.targets}:{}))return {state:s,events};
 }
 if(s.winnerId)return {state:s,events};
 // 3. Ataque.
 const plan=attackPlan(MC,s,me);
 if(plan)act('COMBAT',{attackers:plan.attackers,targetPlayerId:plan.targetId,autoEndTurn:true});else act('NEXT_TURN');
 return {state:s,events};
}
function attackPlan(MC,s,me){
 const ready=me.battlefield.filter(c=>MC.isCreature(c)&&!c.tapped&&(!c.sick||kw(c,'Haste'))&&!kw(c,'Defender')&&MC.power(c,me)>0);
 const opps=opponents(s,me.id);if(!ready.length||!opps.length)return null;
 let best=null;
 for(const q of opps){
  const blockers=q.battlefield.filter(c=>MC.isCreature(c)&&!c.tapped);
  const chosen=ready.filter(a=>{
   const able=blockers.filter(b=>MC.canBlock(a,b));if(!able.length)return true;
   if(kw(a,'Menace')&&able.length<2)return true;
   // Ataca si ningún bloqueador posible lo mata sin morir.
   return !able.some(b=>{const kills=MC.power(b,q)>=MC.toughness(a)||kw(b,'Deathtouch');const dies=MC.power(a,me)>=MC.toughness(b)||kw(a,'Deathtouch');return kills&&!dies&&!kw(a,'Indestructible');});
  });
  const total=ready.reduce((n,a)=>n+MC.power(a,me)*(kw(a,'Double strike')?2:1),0);
  const lethal=total>=q.life&&blockers.length===0;
  const group=lethal?ready:chosen;if(!group.length)continue;
  const dmg=group.reduce((n,a)=>n+MC.power(a,me),0);
  const score=dmg*2-q.life*0.15+(lethal?100:0)-blockers.length*0.5;
  if(!best||score>best.score)best={targetId:q.id,attackers:group.map(c=>c.iid),score};
 }
 if(!best)return null;
 // Guarda defensores si los rivales pueden matarle en su próximo ataque.
 const incoming=opps.reduce((n,q)=>n+q.battlefield.filter(MC.isCreature).reduce((m,c)=>m+MC.power(c,q),0),0);
 if(incoming>=me.life&&best.score<100){const keep=me.battlefield.filter(c=>MC.isCreature(c)&&best.attackers.includes(c.iid)&&!kw(c,'Vigilance')).sort((a,b)=>MC.toughness(b)-MC.toughness(a)).slice(0,Math.ceil(best.attackers.length/2)).map(c=>c.iid);best.attackers=best.attackers.filter(x=>!keep.includes(x));if(!best.attackers.length)return null;}
 return best;
}
// Bloqueos sugeridos para el defensor del combate pendiente (bot o ayuda para humanos).
function suggestBlocks(MC,s){
 const combat=s.pendingCombat;if(!combat)return [];
 const att=s.players.find(p=>p.id===combat.attackerId),def=s.players.find(p=>p.id===combat.targetPlayerId);
 const attackers=combat.attackers.map(id=>att.battlefield.find(c=>c.iid===id)).filter(Boolean).sort((a,b)=>MC.power(b,att)-MC.power(a,att));
 const free=def.battlefield.filter(c=>MC.isCreature(c)&&!c.tapped);const used=new Set(),blocks=[];
 const dmgOf=a=>MC.power(a,att)*(kw(a,'Double strike')?2:1);
 let incoming=attackers.reduce((n,a)=>n+dmgOf(a),0);
 const cmdrLethal=attackers.some(a=>a.isCommander&&(def.commanderDamage[att.id]||0)+dmgOf(a)>=21);
 for(const a of attackers){
  if(kw(a,'Menace'))continue;
  const able=free.filter(b=>!used.has(b.iid)&&MC.canBlock(a,b));if(!able.length)continue;
  const dies=b=>MC.power(a,att)>=MC.toughness(b)||kw(a,'Deathtouch');const kills=b=>MC.power(b,def)>=MC.toughness(a)||kw(b,'Deathtouch');
  let pick=able.find(b=>kills(b)&&!dies(b))||able.find(b=>!dies(b))||able.filter(b=>kills(b)&&threat(MC,b,def)<=threat(MC,a,att)).sort((x,y)=>threat(MC,x,def)-threat(MC,y,def))[0];
  const danger=incoming>=def.life||(cmdrLethal&&a.isCommander)||incoming>=def.life*0.5;
  if(!pick&&danger)pick=able.slice().sort((x,y)=>threat(MC,x,def)-threat(MC,y,def))[0];
  if(pick){used.add(pick.iid);blocks.push({attackerId:a.iid,blockerId:pick.iid});if(!kw(a,'Trample'))incoming-=dmgOf(a);}
 }
 return blocks;
}
return {botTurn,suggestBlocks,attackPlan,chooseTarget};
});
