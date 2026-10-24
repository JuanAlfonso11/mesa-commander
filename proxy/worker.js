// Mesa Commander — servicio de importación de Archidekt para la versión de GitHub Pages.
// Reutiliza la ruta fija de src/server.js (solo decks públicos, sin cookies ni datos del dueño)
// y añade CORS únicamente para los orígenes de la app.
import {serveAPI} from '../src/server.js';
const ALLOWED=[/^https:\/\/juanalfonso11\.github\.io$/i,/^http:\/\/localhost(:\d+)?$/,/^http:\/\/127\.0\.0\.1(:\d+)?$/];
function cors(origin){const ok=origin&&ALLOWED.some(r=>r.test(origin));return ok?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Accept','Access-Control-Max-Age':'86400',Vary:'Origin'}:{Vary:'Origin'};}
export default {
 async fetch(request){
  const headers=cors(request.headers.get('Origin'));
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const response=await serveAPI(request);
  const out=new Response(response.body,response);for(const [k,v] of Object.entries(headers))out.headers.set(k,v);
  // Caché corta en el borde para no repetir consultas del mismo deck.
  if(response.status===200)out.headers.set('Cache-Control','public, max-age=60');
  return out;
 }
};
