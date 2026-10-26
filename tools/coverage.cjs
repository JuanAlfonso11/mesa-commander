// Mide qué cartas de decks de Archidekt aplica la mesa sola y cuáles quedan manuales.
// Uso: node tools/coverage.cjs <link de Archidekt> [más links]   (necesita internet; no pasa por el navegador)
const MD=require('../src/data.js'),MFX=require('../src/effects.js');
const realFetch=globalThis.fetch;
// La app pide primero su propia ruta /api/archidekt/ID; aquí vamos directo a Archidekt.
globalThis.fetch=(url,opt={})=>{const m=String(url).match(/^\/api\/archidekt\/(\d+)/);return realFetch(m?'https://archidekt.com/api/decks/'+m[1]+'/':url,{...opt,credentials:undefined,headers:{...opt.headers,'User-Agent':'MesaCommander/0.7 (coverage)'}});};
(async()=>{
 const pending=new Map();let total=0,auto=0;
 for(const url of process.argv.slice(2)){
  const d=await MD.archidekt(url);const cards=[d.commander,...(d.cards||[])].filter(Boolean);const seen=new Set();let deckAuto=0;
  for(const c of cards){if(seen.has(c.name))continue;seen.add(c.name);total++;const miss=MFX.uncovered(c);if(!miss.length){auto++;deckAuto++;continue;}const e=pending.get(c.name)||{lines:miss,decks:new Set()};e.decks.add(d.name);pending.set(c.name,e);}
  console.log(`# ${d.name} (${d.commander?.name||'sin comandante'}): ${deckAuto}/${seen.size} cartas automáticas`);
 }
 console.log(`\nTotal: ${auto}/${total} automáticas (${Math.round(100*auto/Math.max(1,total))}%). Pendientes: ${pending.size}\n`);
 for(const [name,e] of [...pending].sort((a,b)=>a[0].localeCompare(b[0])))console.log(`- ${name} [${[...e.decks].join(', ')}]\n    ${e.lines.join('\n    ')}`);
})().catch(e=>{console.error(e.message);process.exit(1);});
