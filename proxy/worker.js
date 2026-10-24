// Mesa Commander — servicio de importación de Archidekt para la versión de GitHub Pages.
// Reutiliza la ruta fija de src/server.js (solo decks públicos, sin cookies ni datos del dueño)
// y añade CORS únicamente para los orígenes de la app.
import {serveAPI} from '../src/server.js';
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
