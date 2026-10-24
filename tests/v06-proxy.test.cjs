const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const MD=require('../src/data.js');
const sample={id:7,name:'Deck público',categories:[{name:'Commander',includedInDeck:true}],cards:[{quantity:1,categories:['Commander'],card:{uid:'abcdef01-2345-4678-9abc-def012345678',oracleCard:{name:'Boss',superTypes:['Legendary'],types:['Creature'],colorIdentity:['Green'],cmc:2,manaCost:'{G}{G}',legalities:{commander:'legal'}}}}]};
function response(status,body){return {status,ok:status>=200&&status<300,headers:{get:k=>k.toLowerCase()==='content-type'?'application/json':null},json:async()=>body};}
async function withFetch(fn,run){const prev=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=prev;}}
// El worker se carga en un contexto aislado con el código real de src/server.js.
function worker(fetch){const ctx={console,fetch,Response,Request,TextDecoder,Uint8Array,AbortController,setTimeout,clearTimeout,URL,Object};vm.createContext(ctx);
 const server=fs.readFileSync('src/server.js','utf8').replace('export async function serveAPI','async function serveAPI');
 const w=fs.readFileSync('proxy/worker.js','utf8').replace(/^import .*$/m,'').replace('export default','globalThis.handler=');
 vm.runInContext(server+'\n'+w,ctx);return ctx.handler;}

test('GitHub Pages: después del 404 propio usa el servicio configurado, sin cookies, antes que Archidekt directo',async()=>{
 const calls=[];globalThis.MESA_CONFIG={archidektProxy:'https://mesa-commander-api.ejemplo.workers.dev/'};
 try{await withFetch(async(url,opt)=>{calls.push([url,opt.credentials]);return url.startsWith('/')?response(404,'<html>'):response(200,sample);},async()=>{const d=await MD.archidekt('https://archidekt.com/decks/7/nombre');assert.equal(d.commander.name,'Boss');});}
 finally{delete globalThis.MESA_CONFIG;}
 assert.deepEqual(calls,[['/api/archidekt/7','same-origin'],['https://mesa-commander-api.ejemplo.workers.dev/api/archidekt/7','omit']]);
});

test('una dirección de servicio que no es https se ignora',async()=>{
 const calls=[];globalThis.MESA_CONFIG={archidektProxy:'javascript:alert(1)'};
 try{await withFetch(async url=>{calls.push(url);return url.startsWith('/')?response(404,'x'):response(200,sample);},()=>MD.archidekt('https://archidekt.com/decks/7/'));}
 finally{delete globalThis.MESA_CONFIG;}
 assert.deepEqual(calls,['/api/archidekt/7','https://archidekt.com/api/decks/7/']);
});

test('worker: CORS solo para la app y sigue limitado a la ruta fija de decks',async()=>{
 let upstream=0;const handle=worker(async()=>{upstream++;return Response.json(sample);});
 const ok=await handle.fetch(new Request('https://api.ex/api/archidekt/7',{headers:{Origin:'https://juanalfonso11.github.io'}}));
 assert.equal(ok.status,200);assert.equal(ok.headers.get('access-control-allow-origin'),'https://juanalfonso11.github.io');assert.equal((await ok.json()).cards.length,1);
 const other=await handle.fetch(new Request('https://api.ex/api/archidekt/7',{headers:{Origin:'https://malicioso.example'}}));
 assert.equal(other.headers.get('access-control-allow-origin'),null);
 const pre=await handle.fetch(new Request('https://api.ex/api/archidekt/7',{method:'OPTIONS',headers:{Origin:'https://juanalfonso11.github.io'}}));
 assert.equal(pre.status,204);
 const before=upstream;const bad=await handle.fetch(new Request('https://api.ex/otra-cosa?url=https://evil'));assert.equal(bad.status,404);assert.equal(upstream,before);
});

test('worker: /api/ice genera credenciales TURN con los secretos y quita el puerto 53; sin secretos responde 503',async()=>{
 const calls=[];const handle=worker(async(url,opt)=>{calls.push([url,opt.headers.Authorization]);return new Response(JSON.stringify({iceServers:[{urls:['stun:stun.cloudflare.com:3478','stun:stun.cloudflare.com:53']},{urls:['turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:53?transport=udp','turns:turn.cloudflare.com:443?transport=tcp'],username:'u',credential:'c'}]}),{status:201});});
 const r=await handle.fetch(new Request('https://api.ex/api/ice',{headers:{Origin:'https://juanalfonso11.github.io'}}),{TURN_KEY_ID:'k1',TURN_KEY_API_TOKEN:'t1'});
 assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://juanalfonso11.github.io');
 const j=await r.json();assert.deepEqual(j.iceServers[1].urls,['turn:turn.cloudflare.com:3478?transport=udp','turns:turn.cloudflare.com:443?transport=tcp']);assert.equal(j.iceServers[1].credential,'c');
 assert.deepEqual(calls,[['https://rtc.live.cloudflare.com/v1/turn/keys/k1/credentials/generate-ice-servers','Bearer t1']]);
 assert.equal((await handle.fetch(new Request('https://api.ex/api/ice'),{})).status,503);
});
