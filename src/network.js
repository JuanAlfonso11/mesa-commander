(function(root){'use strict';
/* Mesa Commander — red P2P 0.6. Anfitrión autoritativo con PeerJS.
   Novedades: latido para detectar conexiones muertas, reconexión automática de invitados con reintentos,
   reenvío de acciones no confirmadas (son idempotentes), y el anfitrión puede reabrir la misma sala tras recargar. */
let peer=null,host=false,links=new Map(),server=null,seats=[],game=null,room='',myId='p1',started=false,reconnectToken='',timer;
let callbacks={};const emit=(event,value)=>callbacks[event]?.(value);
let everWelcomed=false,joinConfig=null,retry={n:0,timer:null,active:false},beat=null,lastFromHost=0,pending=new Map(),closing=false;
const HOST_KEY='mesa-host-session',GUEST_KEY='mesa-guest-session',MAX_RETRY=12;
const now=()=>Date.now();
const store={get(k){try{return JSON.parse(root.localStorage?.getItem(k)||'null');}catch{return null;}},set(k,v){try{root.localStorage?.setItem(k,JSON.stringify(v));}catch{}},del(k){try{root.localStorage?.removeItem(k);}catch{}}};
function tokenFor(r){try{return root.localStorage?.getItem('mesa-token-'+r)||root.sessionStorage?.getItem('mesa-token-'+r)||'';}catch{return '';}}
function saveToken(r,t){try{root.localStorage?.setItem('mesa-token-'+r,t);}catch{}try{root.sessionStorage?.setItem('mesa-token-'+r,t);}catch{}}
const every=(fn,ms)=>typeof root.setInterval==='function'?root.setInterval(fn,ms):null;
const stopEvery=id=>{if(id!==null&&typeof root.clearInterval==='function')root.clearInterval(id);};
// Los canales WebRTC descartan en silencio los mensajes grandes (~16 KB). Todo lo que pase de CHUNK
// (decks, estado de la mesa) se codifica en ASCII sin comillas y se envía en trozos numerados.
const CHUNK=12000,MAX_PARTS=200;let msgSeq=0;
function safeSend(c,data){if(!c?.open)return;try{const text=JSON.stringify(data);if(text.length<=CHUNK/2){c.send(data);return;}const enc=encodeURIComponent(text);const id=(++msgSeq).toString(36)+'-'+now().toString(36),n=Math.ceil(enc.length/CHUNK);if(n>MAX_PARTS)throw Error('Mensaje demasiado grande.');for(let i=0;i<n;i++)c.send({type:'chunk',id,i,n,part:enc.slice(i*CHUNK,(i+1)*CHUNK)});}catch{emit('error','No se pudo enviar el cambio. Revisa la conexión.');}}
function assembler(){const parts=new Map();return raw=>{
 if(!raw||typeof raw!=='object'||raw.type!=='chunk')return raw;
 const {id,i,n,part}=raw;if(typeof id!=='string'||id.length>40||!Number.isInteger(n)||!Number.isInteger(i)||n<1||n>MAX_PARTS||i<0||i>=n||typeof part!=='string'||part.length>CHUNK||!/^[A-Za-z0-9%\-_.!~*'()]*$/.test(part))return null;
 let e=parts.get(id);if(!e){if(parts.size>=6)parts.delete(parts.keys().next().value);e={n,got:0,list:new Array(n)};parts.set(id,e);}
 if(e.n!==n||e.list[i]!==undefined)return null;e.list[i]=part;e.got++;if(e.got<n)return null;
 parts.delete(id);try{return JSON.parse(decodeURIComponent(e.list.join('')));}catch{return null;}};}
function publicSeats(){return seats.map(p=>({id:p.id,name:p.name,bot:p.bot,connected:p.id==='p1'||!![...links.values()].find(x=>x.id===p.id&&x.conn.open)}));}
function persistHost(){if(host&&room)store.set(HOST_KEY,{room,seats,game,started,savedAt:now()});}
function broadcast(){for(const x of links.values())if(x.id)safeSend(x.conn,{type:'state',state:MC.viewFor(game,x.id)});persistHost();emit('state',game);}
function roster(){for(const x of links.values())safeSend(x.conn,{type:'roster',players:publicSeats()});emit('roster',publicSeats());}
async function loadPeer(){if(root.Peer)return;await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='./peerjs.min.js';s.onload=resolve;s.onerror=()=>reject(Error('No se pudo cargar la conexión. Usa la versión publicada o juega localmente.'));document.head.append(s);});}
function checkDeck(d){if(!d||!Array.isArray(d.cards)||d.cards.length>250||!d.commander)throw Error('El invitado necesita un deck con comandante (máximo 250 cartas).');return JSON.parse(JSON.stringify(d));}
function error(e){emit('error',e?.type==='peer-unavailable'?'No se encuentra la sala. Comprueba el código y que el anfitrión siga conectado.':e?.type==='unavailable-id'?'Ese código ya está ocupado. Crea otra sala.':'La conexión se interrumpió. Reintentando…');}
function stopRetry(){clearTimeout(retry.timer);retry={n:0,timer:null,active:false};}
function reset(){closing=true;clearTimeout(timer);stopRetry();stopEvery(beat);beat=null;try{peer?.destroy();}catch{}peer=null;links.clear();server=null;started=false;game=null;room='';seats=[];host=false;joinConfig=null;everWelcomed=false;pending.clear();closing=false;}
// El anfitrión vuelve a registrarse en el servidor de señalización si el móvil suspendió la conexión.
function watchSignal(p){p.on('disconnected',()=>{if(closing||p!==peer||p.destroyed)return;emit('status','Reconectando con el servidor de salas…');let n=0;const again=()=>{if(p!==peer||p.destroyed||p.open)return;try{p.reconnect();}catch{}if(++n<MAX_RETRY)setTimeout(again,Math.min(30000,1500*2**n));};setTimeout(again,800);});}
function heartbeatHost(){stopEvery(beat);beat=every(()=>{const t=now();for(const [key,x] of links){if(!x.conn.open)continue;if(t-x.last>25000){try{x.conn.close();}catch{}links.delete(key);roster();continue;}safeSend(x.conn,{type:'ping',t});}},5000);}
function attach(c){const record={conn:c,id:null,last:now()};links.set(c.peer,record);let last=0,count=0,rawLast=0,rawCount=0;const unpack=assembler();
c.on('data',raw=>{try{record.last=now();if(now()-rawLast>1000){rawLast=now();rawCount=0;}if(++rawCount>400)return;const data=unpack(raw);if(!data||typeof data!=='object'||JSON.stringify(data).length>1800000)return;if(data.type==='pong')return;if(now()-last>1000){last=now();count=0;}if(++count>30)return;
if(data.type==='hello'){if(record.id){const assigned=seats.find(p=>p.id===record.id);safeSend(c,{type:'welcome',id:assigned.id,token:assigned.token});return;}let seat=seats.find(p=>p.token&&p.token===data.token);if(!seat){if(started)throw Error('La partida ya comenzó. Solo se permite reconectar con el mismo navegador.');seat=seats.find(p=>p.bot);if(!seat)throw Error('La sala está llena.');seat.name=String(data.name||'Invitado').slice(0,40);seat.deck=checkDeck(data.deck);seat.bot=false;seat.token=MD.uid();}for(const other of links.values())if(other!==record&&other.id===seat.id)other.conn.close();record.id=seat.id;safeSend(c,{type:'welcome',id:seat.id,token:seat.token,started});roster();persistHost();if(game)safeSend(c,{type:'state',state:MC.viewFor(game,seat.id)});return;}
if(!record.id)return;
if(data.type==='action'&&game){const action={...data.action,actorId:record.id};const r=MC.dispatch(game,action);if(r.ok){game=r.state;broadcast();safeSend(c,{type:'ack',id:action.id});}else safeSend(c,{type:'error',message:r.error,id:action.id});}
if(data.type==='peek'&&game){const p=game.players.find(p=>p.id===record.id);safeSend(c,{type:'peek',cards:p.library});}
if(data.type==='chat'){const msg={name:seats.find(p=>p.id===record.id).name,text:String(data.text||'').slice(0,400),at:now()};emit('chat',msg);for(const x of links.values())safeSend(x.conn,{type:'chat',message:msg});}
}catch(e){safeSend(c,{type:'error',message:e.message});}});c.on('close',()=>{if(links.get(c.peer)===record)links.delete(c.peer);roster();});c.on('error',error);}
function openHostPeer(id,resolve,reject,attempt=0){
 peer=new Peer(id);const p=peer;watchSignal(p);
 p.on('open',()=>{emit('connected',room);roster();heartbeatHost();resolve(room);});
 p.on('connection',attach);
 p.on('error',e=>{// Al reabrir, el servidor puede tardar en liberar el código anterior.
  if(e?.type==='unavailable-id'&&attempt<6&&started){try{p.destroy();}catch{}setTimeout(()=>openHostPeer(id,resolve,reject,attempt+1),5000);emit('status','Liberando el código de la sala… intento '+(attempt+2));return;}
  if(p.open){error(e);return;}error(e);reject(Error('No se pudo abrir la sala. Prueba otra red o una mesa local.'));});
 setTimeout(()=>{if(p===peer&&!p.open&&!started)reject(Error('No se pudo contactar con la sala. Prueba otra red.'));},15000);
}
async function create(config,on){reset();callbacks=on;host=true;seats=config.players.map(p=>({...p,token:p.id==='p1'?'':null}));room=Array.from(crypto.getRandomValues(new Uint8Array(8)),v=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[v%32]).join('');persistHost();await loadPeer();return await new Promise((resolve,reject)=>openHostPeer('mesa-v1-'+room,resolve,reject));}
// Reabre la sala guardada con el mismo código y asientos: los invitados recuperan su asiento con su token.
async function resumeHost(on){const saved=store.get(HOST_KEY);if(!saved?.room||!Array.isArray(saved.seats))throw Error('No hay una sala guardada para reabrir.');reset();callbacks=on;host=true;room=saved.room;seats=saved.seats;game=saved.game||null;started=!!saved.started&&!!game;await loadPeer();const r=await new Promise((resolve,reject)=>openHostPeer('mesa-v1-'+room,resolve,reject));if(game)emit('state',game);return r;}
function connectToHost(){
 if(!peer||peer.destroyed){peer=new Peer();peer.on('error',e=>{if(!everWelcomed){error(e);return;}if(e?.type==='peer-unavailable'){scheduleRetry();return;}error(e);if(!server?.open)scheduleRetry();});peer.on('disconnected',()=>{if(!closing&&peer&&!peer.destroyed)try{peer.reconnect();}catch{}});}
 const go=()=>{const conn=peer.connect('mesa-v1-'+room,{reliable:true,serialization:'json'});server=conn;const unpack=assembler();
  conn.on('open',()=>{lastFromHost=now();safeSend(conn,{type:'hello',name:joinConfig.name,deck:joinConfig.deck,token:reconnectToken});});
  conn.on('data',raw=>{if(conn!==server)return;lastFromHost=now();const d=unpack(raw);if(!d||typeof d!=='object')return;
   if(d.type==='ping'){safeSend(conn,{type:'pong',t:d.t});return;}
   if(d.type==='welcome'){everWelcomed=true;myId=d.id;reconnectToken=d.token;saveToken(room,d.token);store.set(GUEST_KEY,{room,name:joinConfig.name,id:d.id,savedAt:now()});const wasRetry=retry.active;stopRetry();emit('welcome',d.id);emit('connected',room);if(wasRetry)emit('status','Reconectado a la sala '+room+'.');for(const a of pending.values())safeSend(conn,{type:'action',action:a});}
   if(d.type==='state'){started=true;emit('state',d.state);}
   if(d.type==='ack')pending.delete(d.id);
   if(d.type==='roster')emit('roster',d.players);
   if(d.type==='error'){if(d.id)pending.delete(d.id);emit('error',d.message);}
   if(d.type==='chat')emit('chat',d.message);if(d.type==='peek')emit('peek',d.cards);});
  conn.on('close',()=>{if(conn!==server||closing)return;if(!everWelcomed){emit('disconnected','La sala cerró la conexión.');return;}emit('disconnected','Se perdió la conexión con el anfitrión. Reintentando…');scheduleRetry();});
  conn.on('error',()=>{if(conn===server&&!conn.open)scheduleRetry();});
 };
 if(peer.open)go();else peer.on('open',go);
}
function scheduleRetry(){if(closing||host||!joinConfig||!everWelcomed)return;if(retry.timer)return;if(retry.n>=MAX_RETRY){retry.active=false;emit('disconnected','No se pudo volver a la sala. Pulsa Reconectar cuando el anfitrión vuelva.');return;}retry.active=true;const wait=Math.min(20000,1500*2**retry.n);retry.n++;emit('status','Reconectando con el anfitrión (intento '+retry.n+')…');retry.timer=setTimeout(()=>{retry.timer=null;try{server?.close();}catch{}if(peer&&(peer.destroyed||peer.disconnected)){try{peer.destroy();}catch{}peer=null;}connectToHost();},wait);}
function guestWatchdog(){stopEvery(beat);beat=every(()=>{if(host||!server)return;if(server.open&&now()-lastFromHost>20000){try{server.close();}catch{}scheduleRetry();}},5000);}
async function join(code,config,on){reset();callbacks=on;room=String(code||'').toUpperCase().replace(/[^A-Z2-9]/g,'');if(room.length!==8)throw Error('El código tiene 8 letras o números.');joinConfig={name:config.name,deck:config.deck};await loadPeer();reconnectToken=tokenFor(room);connectToHost();guestWatchdog();timer=setTimeout(()=>{if(!server?.open&&!retry.active)emit('error','La sala no respondió. Verifica el código; algunas redes móviles bloquean WebRTC.');},18000);}
// Reintento manual (botón Reconectar).
function rejoin(){if(host||!room||!joinConfig)throw Error('No hay una sala de invitado que reconectar.');stopRetry();try{server?.close();}catch{}try{peer?.destroy();}catch{}peer=null;connectToHost();}
function start(){if(!host||started)throw Error('No puedes iniciar esta sala.');game=MC.createGame({players:seats,mode:'online'});started=true;broadcast();return game;}
function action(a){if(host){const r=MC.dispatch(game,a);if(!r.ok)throw Error(r.error);game=r.state;broadcast();}else{pending.set(a.id,a);if(pending.size>50)pending.delete(pending.keys().next().value);if(!server?.open){scheduleRetry();throw Error('Sin conexión al anfitrión. Tu acción se enviará al reconectar.');}safeSend(server,{type:'action',action:a});}}
function sync(s){if(!host)throw Error('Solo el anfitrión puede sincronizar.');game=s;broadcast();}
function chat(text){if(host){const m={name:seats[0].name,text:String(text).slice(0,400),at:now()};emit('chat',m);for(const x of links.values())safeSend(x.conn,{type:'chat',message:m});}else safeSend(server,{type:'chat',text});}
function peek(){if(host)emit('peek',game.players.find(p=>p.id==='p1').library);else safeSend(server,{type:'peek'});}
function forget(){store.del(HOST_KEY);store.del(GUEST_KEY);}
root.MN={create,join,resumeHost,rejoin,start,action,sync,chat,peek,reset,forget,savedHost:()=>store.get(HOST_KEY),savedGuest:()=>store.get(GUEST_KEY),get isHost(){return host;},get room(){return room;},get myId(){return host?'p1':myId;},get connected(){return host?!!peer?.open:!!server?.open;},get reconnecting(){return retry.active;},get pendingCount(){return pending.size;}};
})(globalThis);
