// Simula partidas completas entre bots con decks reales para cazar errores del motor.
// Uso: node tools/sim.cjs [partidas] [turnos]
const MC=require('../src/core.js'),fs=require('node:fs');
const decks=JSON.parse(fs.readFileSync(__dirname+'/fixtures/decks.json','utf8'));
const games=+process.argv[2]||10,turns=+process.argv[3]||30;let problems=0,stats={triggers:0,prompts:0,activations:0,turns:0};
function invariants(s){const seen=new Map();for(const p of s.players)for(const z of MC.ZONES)for(const c of p[z]){if(seen.has(c.iid))throw Error('Carta duplicada '+c.name+' en '+z+' y '+seen.get(c.iid));seen.set(c.iid,p.id+'.'+z);}for(const e of s.stack)if(!e.ability&&seen.has(e.card.iid))throw Error('Hechizo en pila y en zona: '+e.card.name);}
for(let g=0;g<games;g++){
 let s=MC.createGame({seed:1000+g,players:['a','b','c','d'].map((id,i)=>({id,name:'Bot '+id,bot:true,deck:decks[i%2]}))});
 let guard=0;
 try{
  while(!s.winnerId&&s.turn<=turns&&guard++<turns*40){
   const top=s.stack.at(-1);
   if(top){const r=MC.dispatch(s,{id:'sim-'+g+'-'+guard,type:'RESOLVE',actorId:top.controllerId,payload:{}});if(!r.ok){const r2=MC.dispatch(s,{id:'sim-m-'+g+'-'+guard,type:'RESOLVE',actorId:top.controllerId,payload:{manual:true}});if(!r2.ok)throw Error('No se pudo resolver '+top.card.name+': '+r.error+' / '+r2.error);s=r2.state;}else s=r.state;continue;}
   if(s.pendingCombat){const r=MC.dispatch(s,{id:'sim-c-'+g+'-'+guard,type:'RESOLVE_COMBAT',actorId:s.pendingCombat.attackerId,payload:{confirm:true}});if(!r.ok)throw Error('Combate: '+r.error);s=r.state;continue;}
   const before=s.revision,r=MC.botTurn(s,s.activePlayerId);
   if(r.error)throw Error('Bot: '+r.error);s=r.state;
   for(const e of r.events){if(e.type==='trigger')stats.triggers++;if(e.type==='prompt')stats.prompts++;}
   invariants(s);
   if(s.revision===before){const r2=MC.dispatch(s,{id:'sim-t-'+g+'-'+guard,type:'NEXT_TURN',actorId:s.activePlayerId,payload:{}});if(!r2.ok)throw Error('Atascado: '+r2.error);s=r2.state;}
  }
  stats.turns+=s.turn;if(s.prompts?.length)throw Error('Elecciones sin responder: '+s.prompts.map(p=>p.kind).join(','));
  const manual=s.log.filter(e=>e.type==='manual').length;
  console.log(`partida ${g}: turno ${s.turn}, ganador ${s.winnerId||'—'}, vidas ${s.players.map(p=>p.life).join('/')}, avisos manuales ${manual}`);
 }catch(e){problems++;console.log(`partida ${g}: ERROR ${e.stack.split('\n').slice(0,3).join(' | ')}`);}
}
console.log(JSON.stringify(stats),'problemas',problems);process.exit(problems?1:0);
