// Generado por build.cjs: pégalo completo en el editor del Worker.
// Fixed upstream routes only. No arbitrary URL proxy, cookies or credentials forwarded.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function serveAPI(request){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/archidekt\/(\d{1,12})\/?$/);
 if(!match)return json({error:'Ruta no encontrada.'},404);
 if(request.method!=='GET')return json({error:'Método no permitido.'},405);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{
  const response=await fetch('https://archidekt.com/api/decks/'+match[1]+'/',{headers:{'Accept':'application/json','User-Agent':'MesaCommander/0.2 (public-deck-import)'},signal:controller.signal,redirect:'manual'});
  if(response.status===401||response.status===403)return json({error:'Archidekt no permite acceder a este deck. Comprueba que sea público; si lo es, intenta de nuevo más tarde o importa su exportación de texto.'},response.status);
  if(response.status===404)return json({error:'No se encontró el deck. Revisa el enlace y que el deck sea público.',upstream:true},404);
  if(response.status===429)return json({error:'Archidekt recibió demasiadas consultas. Espera un momento y vuelve a intentar.'},429);
  if(!response.ok)return json({error:'Archidekt no pudo responder. Intenta de nuevo o utiliza la lista exportada.'},502);
  if(!response.headers.get('content-type')?.includes('application/json'))return json({error:'Archidekt devolvió una página en lugar del deck. Puedes importar su lista exportada.'},502);
  const reader=response.body.getReader();let bytes=0,chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4000000){await reader.cancel();return json({error:'El deck supera el tamaño permitido para importar.'},413);}chunks.push(value);}
  const buffer=new Uint8Array(bytes);let pos=0;for(const c of chunks){buffer.set(c,pos);pos+=c.length;}const source=JSON.parse(new TextDecoder().decode(buffer));
  if(!Array.isArray(source.cards)||source.cards.length>1000)return json({error:'La respuesta no contiene un deck compatible.'},422);
  // Only deck/card data needed by the importer, never owner profiles/comments.
  return json({id:source.id,name:source.name,deckFormat:source.deckFormat,categories:source.categories,cards:source.cards.filter(x=>!x.deletedAt).map(x=>({quantity:x.quantity,categories:x.categories,card:x.card?{uid:x.card.uid,displayName:x.card.displayName,oracleCard:x.card.oracleCard,edition:x.card.edition,collectorNumber:x.card.collectorNumber,artist:x.card.artist}:null}))});
 }catch(e){console.warn('Archidekt upstream failure:',e.name,e.message);return json({error:e.name==='AbortError'?'Archidekt tardó demasiado en responder. Vuelve a intentarlo.':'No se pudo consultar Archidekt. Reintenta o importa el texto exportado.'},502);}finally{clearTimeout(timer);}
}

// Mesa Commander — servicio de importación de Archidekt para la versión de GitHub Pages.
// Reutiliza la ruta fija de src/server.js (solo decks públicos, sin cookies ni datos del dueño)
// y añade CORS únicamente para los orígenes de la app.

const ALLOWED=[/^https:\/\/juanalfonso11\.github\.io$/i,/^http:\/\/localhost(:\d+)?$/,/^http:\/\/127\.0\.0\.1(:\d+)?$/];
function cors(origin){const ok=origin&&ALLOWED.some(r=>r.test(origin));return ok?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Accept','Access-Control-Max-Age':'86400',Vary:'Origin'}:{Vary:'Origin'};}
// Credenciales TURN temporales (Cloudflare Realtime) para que el juego online atraviese redes móviles y NAT.
// Secretos del Worker: TURN_KEY_ID y TURN_KEY_API_TOKEN. Sin ellos responde 503 y la app usa los servidores por defecto.
async function ice(env,headers){
 const h={...headers,'Content-Type':'application/json','Cache-Control':'no-store'};
 if(!env?.TURN_KEY_ID||!env?.TURN_KEY_API_TOKEN)return new Response(JSON.stringify({error:'TURN no configurado.'}),{status:503,headers:h});
 const r=await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/'+env.TURN_KEY_ID+'/credentials/generate-ice-servers',{method:'POST',headers:{Authorization:'Bearer '+env.TURN_KEY_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({ttl:86400})});
 if(!r.ok)return new Response(JSON.stringify({error:'Cloudflare TURN respondió '+r.status}),{status:502,headers:h});
 const {iceServers}=await r.json();
 // Las URL del puerto 53 se quedan colgadas en los navegadores.
 const list=(Array.isArray(iceServers)?iceServers:[iceServers]).map(s=>({...s,urls:[].concat(s.urls).filter(u=>!/:53(\?|$)/.test(u))}));
 return new Response(JSON.stringify({iceServers:list}),{status:200,headers:h});
}
export default {
 async fetch(request,env){
  const headers=cors(request.headers.get('Origin'));
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(new URL(request.url).pathname==='/api/ice')return ice(env,headers);
  const response=await serveAPI(request);
  const out=new Response(response.body,response);for(const [k,v] of Object.entries(headers))out.headers.set(k,v);
  // Caché corta en el borde para no repetir consultas del mismo deck.
  if(response.status===200)out.headers.set('Cache-Control','public, max-age=60');
  return out;
 }
};
