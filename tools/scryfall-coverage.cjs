// Mide cuántas cartas legales en Commander aplica el motor solo, usando los datos masivos de Scryfall.
// Uso: node tools/scryfall-coverage.cjs [salida.json]   (necesita internet; descarga ~160 MB la primera vez)
const fs=require('fs'),path=require('path'),os=require('os');
const MFX=require('../src/effects.js');
const UA={'User-Agent':'MesaCommander/0.8 (coverage)',Accept:'application/json'};
const cache=path.join(os.tmpdir(),'mesa-commander-oracle-cards.json');
async function load(){
 const slim=path.join(__dirname,'.cache','commander-cards.json');if(process.env.SLIM!=='0'&&fs.existsSync(slim))return JSON.parse(fs.readFileSync(slim,'utf8')).map(c=>({...c,legalities:{commander:'legal'}}));
 if(fs.existsSync(cache)&&Date.now()-fs.statSync(cache).mtimeMs<7*864e5)return JSON.parse(fs.readFileSync(cache,'utf8'));
 const meta=await (await fetch('https://api.scryfall.com/bulk-data/oracle-cards',{headers:UA})).json();
 // Scryfall publica JSON (download_uri) o, desde 2026, JSON Lines comprimido (jsonl_download_uri).
 const url=meta.download_uri||meta.jsonl_download_uri;if(!url)throw Error('Scryfall no dio un enlace de descarga.');
 const r=await fetch(url,{headers:UA});if(!r.ok)throw Error('Scryfall '+r.status);
 let buf=Buffer.from(await r.arrayBuffer());if(buf[0]===0x1f&&buf[1]===0x8b)buf=require('zlib').gunzipSync(buf);
 const txt=buf.toString('utf8');const cards=txt.trimStart().startsWith('[')?JSON.parse(txt):txt.split('\n').filter(Boolean).map(l=>JSON.parse(l));
 fs.writeFileSync(cache,JSON.stringify(cards));return cards;
}
// Convierte una línea concreta en una plantilla para agrupar cartas parecidas.
const template=(line,name)=>line.replaceAll(name,'~').replace(/\{[^}]+\}/g,'{M}').replace(/\b\d+\b/g,'N').replace(/[+-]N\/[+-]N/g,'±N/±N').replace(/\b(one|two|three|four|five|six|seven)\b/gi,'N').slice(0,140);
(async()=>{
 const all=await load();
 const cards=all.filter(c=>c.legalities?.commander==='legal'&&!/Token|Emblem|Card \/\/ Card/.test(c.type_line||'')&&c.layout!=='art_series');
 const byRank=cards.slice().sort((a,b)=>(a.edhrec_rank||1e9)-(b.edhrec_rank||1e9));
 const tmpl=new Map(),miss=[];let auto=0;const typeStats={};
 for(const c of byRank){
  let lines;try{lines=MFX.uncovered(c);}catch(e){lines=['ERROR: '+e.message];}
  const t=(c.type_line||'').match(/Creature|Instant|Sorcery|Artifact|Enchantment|Planeswalker|Land|Battle/)?.[0]||'Otro';
  typeStats[t]=typeStats[t]||{n:0,auto:0};typeStats[t].n++;
  if(!lines.length){auto++;typeStats[t].auto++;continue;}
  miss.push({name:c.name,rank:c.edhrec_rank||null,lines});
  for(const l of new Set(lines.map(l=>template(l,c.name.split(' // ')[0])))){const e=tmpl.get(l)||{n:0,top:0,ex:[]};e.n++;if((c.edhrec_rank||1e9)<=5000)e.top++;if(e.ex.length<3)e.ex.push(c.name);tmpl.set(l,e);}
 }
 const cut=k=>{const s=byRank.slice(0,k);const a=s.filter(c=>{try{return !MFX.uncovered(c).length;}catch{return false;}}).length;return `${a}/${s.length} (${Math.round(100*a/s.length)}%)`;};
 const report={fecha:new Date().toISOString(),cartas:cards.length,automaticas:auto,porcentaje:Math.round(100*auto/cards.length),
  top500:cut(500),top1000:cut(1000),top5000:cut(5000),porTipo:typeStats,
  plantillas:[...tmpl].sort((a,b)=>b[1].top-a[1].top||b[1].n-a[1].n).slice(0,400).map(([t,e])=>({t,n:e.n,top5000:e.top,ej:e.ex})),
  pendientesTop:miss.filter(m=>m.rank&&m.rank<=1000).slice(0,1000)};
 const out=process.argv[2]||path.join(os.tmpdir(),'mesa-commander-coverage.json');fs.writeFileSync(out,JSON.stringify(report,null,1));
 console.log(`Commander: ${auto}/${cards.length} automáticas (${report.porcentaje}%). Top 500: ${report.top500} · Top 1000: ${report.top1000} · Top 5000: ${report.top5000}`);
 for(const [t,s] of Object.entries(typeStats))console.log(`  ${t}: ${s.auto}/${s.n}`);
 console.log('Informe: '+out);
})().catch(e=>{console.error(e.message);process.exit(1);});
