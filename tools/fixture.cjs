// Guarda decks de Archidekt (ya convertidos como los guarda la app) para pruebas sin conexión.
// Uso: node tools/fixture.cjs <salida.json> <link> [más links]
const fs=require('node:fs'),MD=require('../src/data.js');
const realFetch=globalThis.fetch;
globalThis.fetch=(url,opt={})=>{const m=String(url).match(/^\/api\/archidekt\/(\d+)/);return realFetch(m?'https://archidekt.com/api/decks/'+m[1]+'/':url,{...opt,credentials:undefined,headers:{...opt.headers,'User-Agent':'MesaCommander/0.8 (fixtures)'}});};
(async()=>{const [out,...urls]=process.argv.slice(2);const decks=[];for(const u of urls)decks.push(await MD.archidekt(u));fs.writeFileSync(out,JSON.stringify(decks));console.log('ok',decks.map(d=>d.name+' '+(d.cards.length+1)).join(' | '));})().catch(e=>{console.error(e.message);process.exit(1);});
