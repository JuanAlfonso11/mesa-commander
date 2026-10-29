/* Mesa Commander — lector de efectos. Convierte el texto Oracle en habilidades que el motor aplica:
   hechizos, habilidades disparadas, activadas y estáticas. Si una línea no se entiende, esa línea queda manual
   (la carta sigue jugándose y la mesa la resuelve a mano). */
(function(root, factory) {
  var api=factory(); if(typeof module==='object'&&module.exports) module.exports=api; root.MFX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const COLORS=['W','U','B','R','G','C'];
const NUM={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twice:2};
const N='(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|x)';
// «X» es la cantidad elegida al lanzar o activar.
const num=v=>v==='x'?{of:'x'}:NUM[v]??Number(v);
const COLOR_WORD={white:'W',blue:'U',black:'B',red:'R',green:'G',colorless:'C'};
const KEYWORD={'shadow':'Shadow','horsemanship':'Horsemanship','devoid':'Devoid','split second':'Split second','persist':'Persist','undying':'Undying','exalted':'Exalted','storm':'Storm','affinity for artifacts':'Affinity for artifacts','forestwalk':'Forestwalk','islandwalk':'Islandwalk','swampwalk':'Swampwalk','mountainwalk':'Mountainwalk','plainswalk':'Plainswalk','infect':'Infect','wither':'Wither','partner':'Partner','flying':'Flying','reach':'Reach','vigilance':'Vigilance','haste':'Haste','trample':'Trample','lifelink':'Lifelink','deathtouch':'Deathtouch','menace':'Menace','first strike':'First strike','double strike':'Double strike','indestructible':'Indestructible','defender':'Defender','fear':'Fear','skulk':'Skulk','flash':'Flash','hexproof':'Hexproof','shroud':'Shroud','changeling':'Changeling','prowess':'Prowess','intimidate':'Intimidate'};
// Palabras clave que el motor aplica de verdad (combate, objetivos, momento de lanzar, tipos, disparos).
const KEYWORD_IMPL=new Set(Object.values(KEYWORD));
// Objetivos de permanentes que el motor sabe validar.
const PERMANENT_TARGET={
 'creature':{types:['Creature']},
 'creature an opponent controls':{types:['Creature'],opponent:true},
 "creature you don't control":{types:['Creature'],opponent:true},
 'artifact':{types:['Artifact']},
 'enchantment':{types:['Enchantment']},
 'artifact or enchantment':{types:['Artifact','Enchantment']},
 'creature or planeswalker':{types:['Creature','Planeswalker']},
 'planeswalker':{types:['Planeswalker']},
 'land':{types:['Land']},
 'nonland permanent':{types:['Artifact','Creature','Enchantment','Planeswalker','Battle'],nonland:true},
 "nonland permanent you don't control":{types:['Artifact','Creature','Enchantment','Planeswalker','Battle'],nonland:true,opponent:true},
 'nonland permanent an opponent controls':{types:['Artifact','Creature','Enchantment','Planeswalker','Battle'],nonland:true,opponent:true},
 'permanent':{types:['Artifact','Creature','Enchantment','Land','Planeswalker','Battle']}
};
const DAMAGE_TARGET={'any target':'any','target creature':'creature','target player':'player','target opponent':'opponent','target player or planeswalker':'player','target opponent or planeswalker':'opponent','target creature or planeswalker':'creature','each opponent':'each-opponent','each creature':'each-creature','each player':'each-player','each creature and each player':'each-creature-player','each creature you don\'t control':'each-opponent-creature'};
const TYPE_WORD={creature:'Creature',artifact:'Artifact',enchantment:'Enchantment',land:'Land',planeswalker:'Planeswalker',battle:'Battle',instant:'Instant',sorcery:'Sorcery',permanent:'*',equipment:'Equipment',aura:'Aura'};
const PERMANENT_TYPES=['Artifact','Creature','Enchantment','Land','Planeswalker','Battle'];

// ——— Texto ———
// Cartas de dos caras: se usa la cara frontal (la otra se juega moviéndola a mano).
function faceText(card){const f=card?.card_faces;if(!(f?.length>1))return String(card?.oracle_text||'');if(typeof f[0]?.oracle_text==='string')return f[0].oracle_text;const blocks=String(card.oracle_text||'').split(/\n\n+/);let first=blocks[0]||'';const name=f[0]?.name||String(card.name||'').split(' // ')[0];if(first.startsWith(name+'\n'))first=first.slice(name.length+1);return first;}
function faceType(card){const f=card?.card_faces;if(f?.length>1)return f[0]?.type_line||String(card.type_line||'').split(' // ')[0];return String(card?.type_line||'').split(' // ')[0];}
function normalize(card){
 let t=faceText(card);if(!t)return '';
 const name=String(card.name||'');
 const names=[name,...name.split(' // '),name.split(',')[0]].filter(n=>n&&n.length>2).sort((a,b)=>b.length-a.length);
 for(const n of names)t=t.split(n).join('~');
 return t.replace(/’/g,"'").replace(/\([^)]*\)/g,'').replace(/\bthis (spell|creature|permanent|artifact|enchantment|land|equipment|aura|vehicle|token)\b/gi,'~').replace(/[ \t]+/g,' ').replace(/ +\n/g,'\n').trim();
}
// Frases de un texto. «, then …» separa acciones encadenadas (robar, descartar…), pero no «then shuffle».
function sentences(text){return text.split(/\n+/).flatMap(line=>line.split(/(?<=\.)\s+/)).flatMap(s=>s.split(/, then (?=(?:draw|discard|put|scry|surveil|return|sacrifice|untap|create|you|exile|mill|each)\b)/i)).map(s=>s.trim().replace(/\.$/,'').trim()).filter(Boolean);}
const cap=w=>w.charAt(0).toUpperCase()+w.slice(1);
function singular(w){if(/(zombies|faeries|pixies|aunties|cookies)$/.test(w))return w.slice(0,-1);if(/ves$/.test(w)&&!/(slaves|staves)$/.test(w))return w.slice(0,-3)+'f';if(/ies$/.test(w))return w.slice(0,-3)+'y';if(/(sses|shes|ches|xes)$/.test(w))return w.slice(0,-2);if(/s$/.test(w)&&!/(ss|us|is|folk)$/.test(w))return w.slice(0,-1);return w;}

// ——— Filtros: «otra criatura negra que controlas», «Ratas», «artefacto o encantamiento» ———
const FILTER_SKIP=new Set(['a','an','one','each','all','target','card','cards','spell','spells','or','and','and/or','of','the','up','to','other','another','with']);
function parseObj(raw){
 if(!raw)return null;let s=' '+String(raw).toLowerCase().replace(/,/g,' ').replace(/\s+/g,' ').trim()+' ';
 const spec={types:[],subtypes:[]};
 const take=(re,fn)=>{if(re.test(s)){while(re.test(s))s=s.replace(re,' ');fn();}};// en bucle: «you control» puede repetirse al componer
 take(/ that aren't of the chosen type /,()=>spec.notChosenType=true);
 take(/ of the chosen color /,()=>spec.chosenColor=true);
 take(/ that was dealt damage this turn /,()=>spec.damaged=true);
 take(/ that share a creature type /,()=>{});
 take(/ of (?:the chosen|that) type /,()=>spec.chosenType=true);
 take(/ (?:that )?you control /,()=>spec.controller='you');
 take(/ you don't control | an opponent controls | your opponents control | (?:that )?(?:an|your) opponents? controls? /,()=>spec.controller='opp');
 take(/ (?:on the battlefield|target player controls) /,()=>spec.controller=spec.controller||'any');
 take(/ from (?:your|a|an opponent's|target player's) graveyard /,()=>{});
 take(/ in (?:your|a) graveyard /,()=>{});
 take(/ with mana value (\d+) or less /,()=>{});
 const mv=String(raw).toLowerCase().match(/with mana value (\d+) or less/);if(mv)spec.maxMv=+mv[1];
 const pw=String(raw).toLowerCase().match(/with power (\d+) or less/);if(pw){spec.maxPower=+pw[1];s=s.replace(/ with power \d+ or less /,' ');}
 const gp=String(raw).toLowerCase().match(/with power (\d+) or greater/);if(gp){spec.minPower=+gp[1];s=s.replace(/ with power \d+ or greater /,' ');}
 for(let w of s.trim().split(' ').filter(Boolean)){
  if(w==='another'||w==='other'){spec.other=true;continue;}
  if(w==='chosen'||w==='named'||w==='that'||w==='it'||w==='its')return null;
  if(FILTER_SKIP.has(w))continue;
  if(/^\d+$/.test(w)||NUM[w])continue;
  if(w==='nontoken'){spec.nontoken=true;continue;}if(w==='token'||w==='tokens'){spec.token=true;continue;}
  if(w==='nonland'){spec.nonland=true;continue;}if(w==='noncreature'){spec.noncreature=true;continue;}if(w==='nonartifact'){spec.nonartifact=true;continue;}
  if(w==='nonbasic'){spec.nonbasic=true;continue;}if(w==='basic'){spec.basic=true;continue;}if(w==='legendary'){spec.legendary=true;continue;}if(w==='nonlegendary'){spec.nonlegendary=true;continue;}
  if(['tapped','untapped','attacking','blocking'].includes(w)){spec[w]=true;continue;}
  if(COLOR_WORD[w]){(spec.colors||(spec.colors=[])).push(COLOR_WORD[w]);continue;}
  if(/^non/.test(w)&&COLOR_WORD[w.slice(3)]){(spec.notColors||(spec.notColors=[])).push(COLOR_WORD[w.slice(3)]);continue;}
  const sg=singular(w);if(sg==='sorcerie'||w==='sorceries'){spec.types.push('Sorcery');continue;}
  if(TYPE_WORD[sg]){if(['Equipment','Aura'].includes(TYPE_WORD[sg]))spec.subtypes.push(TYPE_WORD[sg]);else spec.types.push(TYPE_WORD[sg]);continue;}
  if(!/^[a-z'-]+$/.test(w))return null;
  spec.subtypes.push(cap(sg));
 }
 if(!spec.types.length&&!spec.subtypes.length&&!spec.colors&&!spec.nonland&&!spec.noncreature&&!spec.chosenType&&!spec.chosenColor&&!spec.token)return null;
 if(spec.subtypes.length>5)return null;
 return spec;
}
const hasType=(c,t)=>new RegExp('\\b'+t+'\\b').test(c?.type_line||'');
const keywordsOf=c=>c?.keywords||[];
function hasSubtype(c,t){if(hasType(c,t))return true;return hasType(c,'Creature')&&keywordsOf(c).includes('Changeling')&&!['Equipment','Aura','Swamp','Island','Forest','Mountain','Plains'].includes(t);}
function colorsOf(c){if(Array.isArray(c?.colors))return c.colors;if(/^Devoid\b/m.test(c?.oracle_text||''))return [];return COLORS.filter(x=>x!=='C'&&new RegExp('\\{[^}]*'+x+'[^}]*\\}').test(c?.mana_cost||''));}
// ¿La carta cumple el filtro? ctx: {controllerId, srcIid, srcControllerId, chosenType}
function matchCard(c,spec,ctx={}){
 if(!c||!spec)return false;
 if(spec.self)return c.iid===ctx.srcIid||(spec.or?matchCard(c,spec.or,ctx):false);
 const type=c.type_line||'';
 if(spec.types.length){const ok=spec.types.some(t=>t==='*'?PERMANENT_TYPES.some(x=>hasType(c,x)):hasType(c,t));if(!ok)return false;}
 if(spec.subtypes.length&&!spec.subtypes.some(t=>hasSubtype(c,t)))return false;
 if(spec.chosenType&&!(ctx.chosenType&&hasSubtype(c,ctx.chosenType)))return false;
 if(spec.notChosenType&&ctx.chosenType&&hasSubtype(c,ctx.chosenType))return false;
 if(spec.chosenColor&&!(ctx.chosenColor&&colorsOf(c).includes(ctx.chosenColor)))return false;
 if(spec.damaged&&!(c.damage>0))return false;
 if(spec.other&&c.iid===ctx.srcIid)return false;
 if(spec.nontoken&&c.token)return false;if(spec.token&&!c.token)return false;
 if(spec.nonland&&hasType(c,'Land'))return false;if(spec.noncreature&&hasType(c,'Creature'))return false;if(spec.nonartifact&&hasType(c,'Artifact'))return false;
 if(spec.nonbasic&&hasType(c,'Basic'))return false;if(spec.basic&&!hasType(c,'Basic'))return false;
 if(spec.legendary&&!hasType(c,'Legendary'))return false;if(spec.nonlegendary&&hasType(c,'Legendary'))return false;
 if(spec.tapped&&!c.tapped)return false;if(spec.untapped&&c.tapped)return false;if(spec.attacking&&!c.attacking)return false;
 if(spec.colors&&!spec.colors.some(x=>x==='C'?!colorsOf(c).length:colorsOf(c).includes(x)))return false;
 if(spec.notColors&&spec.notColors.some(x=>colorsOf(c).includes(x)))return false;
 if(spec.maxMv!==undefined&&(Number(c.cmc)||0)>spec.maxMv)return false;
 if(spec.maxPower!==undefined&&(Number(c.power)||0)>spec.maxPower)return false;
 if(spec.minPower!==undefined&&(Number(c.power)||0)<spec.minPower)return false;
 if(spec.controller==='you'&&ctx.controllerId!==ctx.srcControllerId)return false;
 if(spec.controller==='opp'&&ctx.controllerId===ctx.srcControllerId)return false;
 if(spec.equipped||spec.enchanted)return false;
 return true;
}

// ——— Cantidades: número fijo o «por cada X», «igual al número de X», devoción ———
function parseAmount(phrase){
 let s=String(phrase||'').toLowerCase().trim();let m;const chosen=/ of (?:that|the chosen) type/.test(s);s=s.replace(/ of (?:that|the chosen) type/,'');
 if(s==='x')return {of:'x'};
 if(/^spells? you've cast this turn$/.test(s))return {of:'spellsThisTurn'};
 if(/^poison counters? your opponents have$/.test(s))return {of:'oppPoison'};
 if(/^its toughness$/.test(s))return {of:'eventToughness'};
 if(/^its power$/.test(s))return {of:'eventPower'};
 if(/^~'s power$/.test(s))return {of:'selfPower'};
 if((m=s.match(/^(?:the number of )?([a-z+/-]+) counters? on ~$/)))return {of:'counters',kind:/\//.test(m[1])?m[1]:cap(m[1])};
 if(/^the number of opponents you have$|^the number of your opponents$/.test(s))return {of:'opponents'};
 if((m=s.match(/^(?:the number of )?(?:cards in your hand)$/)))return {of:'hand'};
 if((m=s.match(/^your devotion to (white|blue|black|red|green)$/)))return {of:'devotion',color:COLOR_WORD[m[1]]};
 if((m=s.match(/^(?:the number of )?(.+?) (?:you control|on the battlefield)$/))){const spec=parseObj(m[1]+(s.includes('on the battlefield')?' on the battlefield':' you control'));if(spec)return {of:'count',spec:chosen?{...spec,chosenType:true}:spec};}
 if((m=s.match(/^(?:the number of )?(.+?) cards? in your graveyard$/))){const spec=parseObj(m[1]);if(spec)return {of:'grave',spec};}
 return null;
}

// ——— Fichas ———
const NAMED_TOKEN={
 treasure:{name:'Treasure',type_line:'Token Artifact — Treasure',oracle_text:'{T}, Sacrifice this artifact: Add one mana of any color.'},
 clue:{name:'Clue',type_line:'Token Artifact — Clue',oracle_text:'{2}, Sacrifice this artifact: Draw a card.'},
 food:{name:'Food',type_line:'Token Artifact — Food',oracle_text:'{2}, {T}, Sacrifice this artifact: You gain 3 life.'},
 blood:{name:'Blood',type_line:'Token Artifact — Blood',oracle_text:'{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.'},
 map:{name:'Map',type_line:'Token Artifact — Map',oracle_text:'{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.'}
};
function tokenStep(count,p,t,desc,withText){
 const words=desc.split(/[ ,]+/).filter(w=>w&&w!=='and');const colors=[];const types=[];
 for(const w of words){if(COLOR_WORD[w])colors.push(COLOR_WORD[w]);else if(!['artifact','legendary','snow'].includes(w))types.push(cap(w));}
 const keywords=[];if(withText){for(const part of withText.split(/,\s*|\s+and\s+/)){const k=KEYWORD[part.trim()];if(!k)return null;keywords.push(k);}}
 if(typeof count==='number'&&(count<1||count>20))return null;if(p>20||t>20)return null;
 return {type:'token',count,power:p,toughness:t,name:(types.join(' ')||'Criatura'),colors:colors.filter(c=>c!=='C'),keywords};
}
const countOf=(word,rest)=>{if(word==='x'||word==='a number of')return null;return num(word);};

// ——— Hechizos y efectos: una frase → pasos ———
const PUMP_RE=/^([+-]\d+)\/([+-]\d+)$/;
function kwList(text){const out=[];for(const part of String(text).split(/,\s*(?:and\s+)?|\s+and\s+/)){const k=KEYWORD[part.trim()];if(!k)return null;out.push(k);}return out;}
// Destino de un efecto sobre una criatura: objetivo, la propia carta o todas las tuyas.
function subjectOf(s){
 s=s.trim();
 if(s==='~'||s==='it'||s==='that creature')return {target:'self'};
 if(s==='equipped creature')return {target:'equipped'};if(s==='enchanted creature')return {target:'enchanted'};
 let m;
 if((m=s.match(/^(?:up to one )?target (.+)$/))){const spec=parseObj(m[1]);if(!spec)return null;return {target:'chosen',spec,phrase:m[1],upTo:/^up to/.test(s)};}
 if((m=s.match(/^(?:all |each )?(.+?)s? you control$/))||(m=s.match(/^(?:all |each )?(other .+?) you control$/))){const spec=parseObj(s.replace(/^(?:all|each) /,''));if(spec)return {target:'each',spec};}
 if((m=s.match(/^(?:all |each )(.+)$/))){const spec=parseObj(m[1]);if(spec)return {target:'each',spec:{...spec,controller:spec.controller||'any'}};}
 if(/^creatures\b/.test(s)){const spec=parseObj(s);if(spec)return {target:'each',spec:{...spec,controller:spec.controller||'any'}};}
 return null;
}
function parseSentence(raw){
 const s=raw.toLowerCase().replace(/’/g,"'").replace(/\s+/g,' ').trim();let m;
 if(/^(?:it|they) can't be regenerated$|^a creature destroyed this way can't be regenerated$/.test(s))return [{type:'noRegen'}];
 if(/^~ costs \{\d+\} (?:less|more) to cast(?: for each [a-z ]+)?$/.test(s))return [];
 if(/^activate only (?:as a sorcery|once each turn)$/.test(s))return [];
 if(/^spend only (?:white|blue|black|red|green|colorless) mana on x$/.test(s))return [];
 if(/^its controller gains life equal to its power$/.test(s))return [{type:'gainLife',amount:0,who:'target-controller',fromPower:true}];
 if((m=s.match(new RegExp('^its controller creates '+N+' (\\d+)/(\\d+) ([a-z ,]+?) creature tokens?(?: with ([a-z ,]+))?$')))){const t=tokenStep(num(m[1]),+m[2],+m[3],m[4],m[5]);return t?[{...t,who:'target-controller'}]:null;}
 if((m=s.match(new RegExp('^its controller creates '+N+' (treasure|clue|food) tokens?$'))))return [{type:'namedToken',kind:m[2],count:num(m[1]),who:'target-controller'}];
 if(/^choose a creature type$/.test(s))return [{type:'chooseType'}];
 if(/^if ~ would be put into a graveyard from anywhere, (?:reveal ~ and )?shuffle it into its owner's library instead$/.test(s))return [];
 if((m=s.match(/^if ~ was kicked, (.+)$/))){const r=parseClause(m[1]);return r&&!/instead/.test(m[1])?r.map(x=>({...x,kicked:true})):null;}
 if((m=s.match(/^regenerate (~|target creature)$/)))return [{type:'regenerate',target:m[1]==='~'?'self':'chosen',spec:specFromObj(parseObj('creature')),phrase:'creature'}];
 if((m=s.match(/^monstrosity (\d+|x)$/)))return [{type:'monstrosity',n:num(m[1])}];
 if(/^you lose life equal to that (?:permanent|creature)'s mana value$/.test(s))return [{type:'loseLife',amount:{of:'lastMv'},who:'you'}];
 if(/^you gain life equal to the sacrificed (?:permanent|creature|artifact)'s mana value$/.test(s))return [{type:'gainLife',amount:{of:'sacMv'}}];
 if((m=s.match(/^its controller may search their library for a basic land card, put (?:it|that card) onto the battlefield( tapped)?, then shuffle$/)))return [{type:'ramp',count:1,to:'battlefield',tapped:!!m[1],who:'target-controller'}];
 if((m=s.match(/^return (?:each|all) (.+?) to (?:its owner's hand|their owners?'s? hands?)$/))){const spec=parseObj(m[1]);if(spec)return [{type:'wipe',what:'filter',spec,bounce:true}];}
 if((m=s.match(/^(destroy|exile) each (.+)$/))){const spec=parseObj(m[2]);if(spec)return [{type:'wipe',what:'filter',spec,exile:m[1]==='exile'}];}
 if((m=s.match(/^look at the top (\w+) cards of your library$/)))return [{type:'lookTop',n:num(m[1])}];
 if(/^put them back in any order$/.test(s))return [{type:'lookBack'}];
 if((m=s.match(/^put (\w+) of them into your hand and the rest on the bottom of your library in any order$/)))return [{type:'lookTake',take:num(m[1])}];
 if((m=s.match(/^put (\w+) cards? from your hand on top of your library in any order$/)))return [{type:'putBack',count:num(m[1])}];
 if((m=s.match(/^(?:morbid — )?that creature gets ([+-]\d+)\/([+-]\d+) until end of turn instead if a creature died this turn$/)))return [{type:'morbid',p:+m[1],t:+m[2]}];
 if(/^each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way$/.test(s)||/^each player discards their hand$/.test(s))return [{type:'wheel',greatest:/greatest/.test(s)}];
 if((m=s.match(/^each player discards their hand, then draws (\w+) cards$/)))return [{type:'wheel',draw:num(m[1])}];
 if((m=s.match(/^draws cards equal to the greatest number of cards a player discarded this way$/)))return [{type:'wheelDraw'}];
 if((m=s.match(/^(?:its|that creature's|that permanent's) controller creates (?:a|an|one) (\d+)\/(\d+) ([a-z ,]+?) creature tokens?(?: with ([a-z ,]+))?$/))){const t2=tokenStep(1,+m[1],+m[2],m[3],m[4]);return t2?[{...t2,who:'target-controller'}]:null;}
 if((m=s.match(/^(its controller|you) (?:may )?draws? (?:up to )?(\w+) cards? at the beginning of the next turn's upkeep$/)))return [{type:'delayed',who:m[1]==='you'?'you':'target-controller',steps:[{type:'draw',count:num(m[2]),who:'you'}]}];
 if((m=s.match(/^create a token that's a copy of (~|target creature you control|target artifact you control)$/)))return [{type:'copyToken',target:m[1]==='~'?'self':'chosen',spec:specFromObj(parseObj(m[1].replace(/^target /,''))||{types:['Creature'],subtypes:[]}),phrase:m[1]}];
 if((m=s.match(/^(?:you may )?put (?:a|an) (basic land|land|creature|artifact) card from your hand onto the battlefield( tapped)?$/)))return [{type:'putFromHand',spec:parseObj(m[1]),tapped:!!m[2]}];
 if((m=s.match(/^put target (.+?) card from your graveyard on top of your library$/))){const spec=parseObj(m[1]);if(spec)return [{type:'returnCard',spec,whose:'you',count:1,to:'top'}];}
 if(/^~ deals \d+ damage to you$/.test(s)){const n=+s.match(/\d+/)[0];return [{type:'loseLife',amount:n,who:'you'}];}
 if((m=s.match(/^(each opponent|each player|target opponent|target player|you) gets? (a|an|one|two|three|\d+) poison counters?$/)))return [{type:'poison',who:{'each opponent':'each-opponent','each player':'each-player','target opponent':'target-opponent','target player':'target-player',you:'you'}[m[1]],count:num(m[2])}];
 if((m=s.match(/^proliferate(?: (twice))?$/)))return [{type:'proliferate',times:m[1]?2:1}];
 if((m=s.match(/^add ((?:\{[wubrgc]\})+)$/))){const sym=m[1].toUpperCase().match(/[WUBRGC]/g);const fixed={};for(const x of sym)fixed[x]=(fixed[x]||0)+1;return [{type:'addMana',fixed}];}
 if((m=s.match(/^add (one|two|three) mana of any (?:one )?color$/)))return [{type:'addMana',any:num(m[1])}];
 if((m=s.match(/^return a (land|creature|permanent|nonland permanent) you control to its owner's hand$/)))return [{type:'bounceOwn',spec:parseObj(m[1])}];
 if((m=s.match(/^put (?:a|one|an) ([+-]1\/[+-]1) counter on each (.+?)$/))){const spec=parseObj(m[2].replace(/ you control$/,' you control'));if(spec)return [{type:'counters',count:1,target:'each',spec:{...spec,controller:spec.controller||'any'},kind:m[1]}];}
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on each (.+?)$')))){const spec=parseObj(m[2]);if(spec)return [{type:'counters',count:num(m[1]),target:'each',spec:{...spec,controller:spec.controller||'any'}}];}
 if((m=s.match(/^(?:you )?create (?:a|an|one) (\d+)\/(\d+) ([a-z ,]+?) creature tokens?(?: with ([a-z ,]+))? for each (.+)$/))){const a=parseAmount(m[5]);const t2=a&&tokenStep(1,+m[1],+m[2],m[3],m[4]);if(t2)return [{...t2,count:a}];}
 if((m=s.match(/^(?:they|that player) loses? (\d+) life$/)))return [{type:'loseLife',amount:+m[1],who:'event-player'}];
 if((m=s.match(/^reveal the top (\w+) cards of your library$/)))return [{type:'revealTop',n:num(m[1])}];
 if((m=s.match(/^put all (.+?) cards revealed this way into your hand and the rest (?:on the bottom of your library|into your graveyard) in (?:any|a random) order$/))){const spec=parseObj(m[1]);if(spec)return [{type:'revealTake',spec}];}
 if((m=s.match(/^(?:you may reveal|put) (?:a|an|up to one) (.+?) card from among them (?:and put it )?into your hand$/))){const spec=parseObj(m[1]);if(spec)return [{type:'lookReveal',spec}];}
 if(/^put the rest on the bottom of your library in (?:any|a random) order$/.test(s))return [{type:'lookRest'}];
 if((m=s.match(/^put (one|two|three) of them into your hand and the rest on the bottom of your library in (?:any|a random) order$/)))return [{type:'lookTake',take:num(m[1])}];
 if((m=s.match(/^exile the top (card|two cards|three cards|four cards|x cards) of your library$/)))return [{type:'exileTop',n:m[1]==='card'?1:num(m[1].split(' ')[0])}];
 if((m=s.match(/^(?:until (end of turn|the end of your next turn), )?you may play (?:that card|those cards|them|it)(?: (this turn|until the end of your next turn))?$/)))return [{type:'playExiled',until:/next/.test((m[1]||'')+(m[2]||''))?'next':'this'}];
 if((m=s.match(/^add \{([wubrgc])\} for each (.+)$/))){const a=parseAmount(m[2].replace(/ on the battlefield$/,' on the battlefield'));if(a)return [{type:'addMana',fixed:{[m[1].toUpperCase()]:1},per:a}];}
 if((m=s.match(/^copy target (instant or sorcery|instant|sorcery) spell(?:, then return it to its owner's hand)?$/)))return [{type:'copySpell',spell:m[1]+' spell'}];
 if(/^you may choose new targets for the copy$/.test(s))return [];
 if((m=s.match(/^that player sacrifices a creature(?: of their choice)?$/)))return [{type:'sacrifice',who:'event-player',count:1,spec:parseObj('creature')}];
 // Robar
 if((m=s.match(new RegExp('^(?:you )?draw '+N+' cards?$'))))return [{type:'draw',count:num(m[1]),who:'you'}];
 if((m=s.match(/^(?:you )?draw a card for each (.+)$/))){const a=parseAmount(m[1]);return a?[{type:'draw',count:a,who:'you'}]:null;}
 if((m=s.match(/^(?:you )?draw (?:x )?cards equal to (.+)$/))){const a=parseAmount(m[1]);return a?[{type:'draw',count:a,who:'you'}]:null;}
 if((m=s.match(new RegExp('^target player draws '+N+' cards?$'))))return [{type:'draw',count:num(m[1]),who:'target-player'}];
 if((m=s.match(new RegExp('^target player draws '+N+' cards? and loses (\\d+) life$'))))return [{type:'draw',count:num(m[1]),who:'target-player'},{type:'loseLife',amount:+m[2],who:'same-player'}];
 if((m=s.match(new RegExp('^each player draws '+N+' cards?$'))))return [{type:'draw',count:num(m[1]),who:'each-player'}];
 if((m=s.match(new RegExp('^(?:you )?draw '+N+' cards? and (?:you )?lose (\\d+) life$'))))return [{type:'draw',count:num(m[1]),who:'you'},{type:'loseLife',amount:+m[2],who:'you'}];
 if((m=s.match(/^you draw x cards and you lose x life, where x is (.+)$/))){const a=parseAmount(m[1]);return a?[{type:'draw',count:a,who:'you'},{type:'loseLife',amount:a,who:'you'}]:null;}
 // Vidas
 if((m=s.match(/^you gain (\d+|x) life$/)))return [{type:'gainLife',amount:num(m[1])}];
 if((m=s.match(/^you gain (\d+) life for each (.+)$/))){const a=parseAmount(m[2]);return a?[{type:'gainLife',amount:{...a,times:+m[1]}}]:null;}
 if(/^you gain life equal to the life lost this way$/.test(s))return [{type:'gainLife',amount:{of:'lastLost'}}];
 if((m=s.match(/^you gain life equal to (.+)$/))){const a=parseAmount(m[1]);return a?[{type:'gainLife',amount:a}]:null;}
 if((m=s.match(/^you lose (\d+) life$/)))return [{type:'loseLife',amount:+m[1],who:'you'}];
 if((m=s.match(/^(each opponent|each player) loses (\d+|x) life$/)))return [{type:'loseLife',amount:num(m[2]),who:m[1]==='each player'?'each-player':'each-opponent'}];
 if((m=s.match(/^each opponent loses (\d+) life for each (.+)$/))){const a=parseAmount(m[2]);return a?[{type:'loseLife',amount:{...a,times:+m[1]},who:'each-opponent'}]:null;}
 if((m=s.match(/^each opponent loses (\d+) life and you gain (\d+) life$/)))return [{type:'loseLife',amount:+m[1],who:'each-opponent'},{type:'gainLife',amount:+m[2]}];
 if((m=s.match(/^each opponent loses x life, where x is (.+?)\. you gain life equal to the life lost this way$/))||(m=s.match(/^each opponent loses x life, where x is (.+)$/))){const a=parseAmount(m[1]);return a?[{type:'loseLife',amount:a,who:'each-opponent',drain:/you gain/.test(s)}]:null;}
 if(/^you gain life equal to the life lost this way$/.test(s))return [{type:'gainLife',amount:{of:'lastLost'}}];
 if((m=s.match(/^target (player|opponent) loses (\d+) life$/)))return [{type:'loseLife',amount:+m[2],who:'target-'+m[1]}];
 if((m=s.match(/^target (player|opponent) loses (\d+) life and you gain (\d+) life$/)))return [{type:'loseLife',amount:+m[2],who:'target-'+m[1]},{type:'gainLife',amount:+m[3]}];
 if((m=s.match(/^target (player|opponent) loses (\d+) life for each (.+)$/))){const a=parseAmount(m[3]);return a?[{type:'loseLife',amount:{...a,times:+m[2]},who:'target-'+m[1]}]:null;}
 if(/^you gain that much life$/.test(s))return [{type:'gainLife',amount:{of:'lastLost'}}];
 if(/^target opponent loses that much life$/.test(s))return [{type:'loseLife',amount:{of:'eventAmount'},who:'target-opponent'}];
 if(/^cascade$/.test(s))return [];
 // Daño
 if((m=s.match(/^~ deals (\d+|x) damage to (.+)$/))&&DAMAGE_TARGET[m[2]])return [{type:'damage',amount:num(m[1]),target:DAMAGE_TARGET[m[2]]}];
 if((m=s.match(/^~ deals damage equal to (.+?) to (.+)$/))&&DAMAGE_TARGET[m[2]]){const a=parseAmount(m[1]);return a?[{type:'damage',amount:a,target:DAMAGE_TARGET[m[2]]}]:null;}
 // Destruir, exiliar, devolver
 if((m=s.match(/^destroy all (creatures|artifacts|enchantments|nonland permanents)$/)))return [{type:'wipe',what:m[1]}];
 if((m=s.match(/^(destroy|exile) all (.+)$/))){const parts=m[2].split(/ and all /);const specs=parts.map(parseObj);if(specs.every(Boolean))return specs.map(spec=>({type:'wipe',what:'filter',spec,exile:m[1]==='exile'}));return null;}
 if((m=s.match(/^(destroy|exile) target (.+)$/))){if(PERMANENT_TARGET[m[2]])return [{type:m[1],target:m[2]}];const spec=parseObj(m[2]);if(spec&&!/graveyard|card/.test(m[2]))return [{type:m[1],target:m[2],spec:{...specFromObj(spec)}}];}
 if((m=s.match(/^return target (.+?) to its owner's hand$/))){if(PERMANENT_TARGET[m[1]])return [{type:'bounce',target:m[1]}];const spec=parseObj(m[1]);if(spec)return [{type:'bounce',target:m[1],spec:specFromObj(spec)}];}
 if((m=s.match(/^return all (.+?) to their owners' hands$/))){const spec=parseObj(m[1]);if(spec)return [{type:'wipe',what:'filter',spec,bounce:true}];}
 if((m=s.match(/^counter target (spell|noncreature spell|creature spell|instant or sorcery spell|instant spell|sorcery spell|artifact, creature, or planeswalker spell|enchantment, instant, or sorcery spell|activated or triggered ability|activated ability, triggered ability, or legendary spell)$/)))return [{type:'counter',spell:m[1]}];
 if((m=s.match(/^counter target (spell|noncreature spell|creature spell|instant or sorcery spell|instant spell|sorcery spell|activated or triggered ability) unless its controller pays ((?:\{[^}]+\})+)$/)))return [{type:'counter',spell:m[1],unless:m[2].toUpperCase()}];
 if(/^if that spell is countered this way, exile it instead of putting it into its owner's graveyard$/.test(s))return [{type:'counterExile'}];
 // Fichas
 if((m=s.match(new RegExp('^(?:you )?create '+N+' (\\d+)/(\\d+) ([a-z ,]+?) creature tokens?(?: with ([a-z ,]+))?$')))){const t=tokenStep(num(m[1]),+m[2],+m[3],m[4],m[5]);return t?[t]:null;}
 if((m=s.match(/^create (?:x|a number of) (\d+)\/(\d+) ([a-z ,]+?) creature tokens?(?: with ([a-z ,]+))?(?:,| equal to) (?:where x is )?(.+)$/))){const a=parseAmount(m[5]);const t=a&&tokenStep(1,+m[1],+m[2],m[3],m[4]);return t?[{...t,count:a}]:null;}
 if((m=s.match(new RegExp('^create '+N+' (treasure|clue|food|blood|map) tokens?$'))))return [{type:'namedToken',kind:m[2],count:num(m[1])}];
 if((m=s.match(/^create a (treasure|clue|food) token for each (.+)$/))){const a=parseAmount(m[2]);return a?[{type:'namedToken',kind:m[1],count:a}]:null;}
 // Contadores
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on target creature$'))))return [{type:'counters',count:num(m[1]),target:'creature'}];
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on each creature you control$'))))return [{type:'counters',count:num(m[1]),target:'each-own'}];
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on ~$'))))return [{type:'counters',count:num(m[1]),target:'self'}];
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on (?:it|that creature)$'))))return [{type:'counters',count:num(m[1]),target:'event'}];
 if((m=s.match(new RegExp('^put '+N+' ([a-z]+) counters? on ~$'))))return [{type:'counters',count:num(m[1]),target:'self',kind:cap(m[2])}];
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on target (.+)$')))){const spec=parseObj(m[2]);if(spec)return [{type:'counters',count:num(m[1]),target:'creature',spec:specFromObj(spec)}];}
 // Adivinar, vigilar, mirar
 if((m=s.match(/^(scry|surveil) (\d+)$/)))return [{type:'scry',count:+m[2],surveil:m[1]==='surveil'}];
 if((m=s.match(/^look at the top (\w+) cards of your library, then put them back in any order$/)))return [{type:'scry',count:num(m[1]),order:true}];
 if(/^you may shuffle$/.test(s))return [];
 if((m=s.match(/^look at target (player|opponent)'s hand$/)))return [{type:'reveal',who:'target-'+m[1]}];
 if((m=s.match(/^look at the top (\w+) cards of your library\. put (\w+) of them into your hand and the rest on the bottom of your library in any order$/)))return [{type:'dig',look:num(m[1]),take:num(m[2])}];
 // Buscar en la biblioteca
 if((m=s.match(new RegExp('^search your library for (?:up to '+N+' )?(?:a )?basic land cards?, (?:reveal (?:it|them|those cards), )?put (?:it|them|that card|those cards) (onto the battlefield tapped|onto the battlefield|into your hand), then shuffle$'))))return [{type:'ramp',count:m[1]?num(m[1]):1,to:m[2].includes('hand')?'hand':'battlefield',tapped:m[2].includes('tapped')}];
 if(/^search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle$/.test(s))return [{type:'ramp',count:2,to:'battlefield',tapped:true,share:true}];
 if(/^search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle$/.test(s))return [{type:'ramp',count:1,to:'battlefield',tapped:true},{type:'ramp',count:1,to:'hand',tapped:false,noShuffle:true}];
 if((m=s.match(/^search your library for (?:a|an) (.+?), (?:reveal (?:it|that card), )?(put (?:it|that card) into your hand|put (?:it|that card) onto the battlefield(?: tapped)?|put (?:it|that card) into your graveyard), then shuffle$/))||(m=s.match(/^search your library for (?:a|an) (.+?), (?:reveal (?:it|that card), )?(then shuffle and put that card on top)$/))){
  const what=m[1].replace(/\bcards?\b/g,'').replace(/\s+/g,' ').trim();const spec=!what?{types:[],subtypes:[],any:true}:parseObj(m[1]);if(!spec)return null;
  return [{type:'search',spec,to:/top/.test(m[2])?'top':/battlefield/.test(m[2])?'battlefield':/graveyard/.test(m[2])?'graveyard':'hand',tapped:/tapped/.test(m[2])}];
 }
 if(/^search your library for a card, put that card into your hand, then shuffle$/.test(s))return [{type:'search',spec:{types:[],subtypes:[],any:true},to:'hand'}];
 // Cementerio
 if((m=s.match(new RegExp('^return (up to '+N+' |'+N+' )?target (?:(.+?) )?cards? from your graveyard to (your hand|the battlefield(?: tapped)?)$')))){const spec=m[4]?parseObj(m[4]):{types:[],subtypes:[],any:true};const cnt=m[2]?num(m[2]):m[3]?num(m[3]):1;if(spec)return [{type:'returnCard',spec,whose:'you',count:cnt,upTo:!!m[2],to:/hand/.test(m[5])?'hand':'battlefield',tapped:/tapped/.test(m[5])}];}
 if((m=s.match(/^(?:put|return) target (.+?) card from a graveyard onto the battlefield under your control$/))){const spec=parseObj(m[1]);if(spec)return [{type:'returnCard',spec,whose:'any',count:1,to:'battlefield'}];}
 if((m=s.match(/^exile target player's graveyard$/)))return [{type:'exileGrave',who:'target-player'}];
 if((m=s.match(/^exile (?:up to (\w+) )?target cards? from (an opponent's|a|target player's|that player's) graveyard$/)))return [{type:'exileCard',count:m[1]?num(m[1]):1,upTo:!!m[1],...(m[2]==="that player's"?{whose:'event'}:{})}];
 if((m=s.match(new RegExp('^(?:target player|each opponent|each player|you) mills? '+N+' cards?$')))){const who=s.startsWith('target')?'target-player':s.startsWith('each player')?'each-player':s.startsWith('each')?'each-opponent':'you';return [{type:'mill',count:num(m[1]),who}];}
 // Descartar y sacrificar (eligen los jugadores afectados)
 if((m=s.match(new RegExp('^(each opponent|each player|target opponent|target player|you) discards? '+N+' cards?$')))||(m=s.match(new RegExp('^(discard) '+N+' cards?$')))){const who={'each opponent':'each-opponent','each player':'each-player','target opponent':'target-opponent','target player':'target-player',you:'you',discard:'you'}[m[1]];return [{type:'discard',who,count:num(m[2])}];}
 if((m=s.match(/^(each opponent|each player|target opponent|target player) discards a card at random$/)))return [{type:'discard',who:{'each opponent':'each-opponent','each player':'each-player','target opponent':'target-opponent','target player':'target-player'}[m[1]],count:1,random:true}];
 if((m=s.match(/^each other player sacrifices a creature(?: of their choice)?$/)))return [{type:'sacrifice',who:'each-opponent',count:1,spec:parseObj('creature')}];
 if((m=s.match(new RegExp('^(each opponent|each player|target opponent|target player) sacrifices '+N+' (.+?)s?$')))){const spec=parseObj(m[3]);if(spec)return [{type:'sacrifice',who:{'each opponent':'each-opponent','each player':'each-player','target opponent':'target-opponent','target player':'target-player'}[m[1]],count:num(m[2]),spec}];}
 if((m=s.match(new RegExp('^sacrifice '+N+' (.+?)s?$')))){if(m[2]==='~')return [{type:'sacrifice',who:'you',self:true,count:1}];const spec=parseObj(m[2]);if(spec)return [{type:'sacrifice',who:'you',count:num(m[1]),spec}];}
 if(/^sacrifice ~$/.test(s))return [{type:'sacrifice',who:'you',self:true,count:1}];
 if((m=s.match(/^target opponent puts a card from their hand on top of their library$/)))return [{type:'handToTop',who:'target-opponent'}];
 // Fuerza, resistencia y habilidades hasta el final del turno
 if((m=s.match(/^(.+?) gets? ([+-]\d+)\/([+-]\d+)(?: and gains? (.+?))? until end of turn$/))||(m=s.match(/^(.+?) gets? ([+-]\d+)\/([+-]\d+) and gains? (.+?) until end of turn$/))){const who=subjectOf(m[1]);const kws=m[4]?kwList(m[4]):[];if(who&&kws)return [{type:'pump',...who,p:+m[2],t:+m[3],kws}];}
 if((m=s.match(/^(.+?) gets? ([+-])(\d+)\/([+-])(\d+) until end of turn for each (.+)$/))){const who=subjectOf(m[1]),a=parseAmount(m[6]);if(who&&a)return [{type:'pump',...who,p:{...a,times:+(m[2]+m[3])},t:{...a,times:+(m[4]+m[5])},kws:[]}];}
 if((m=s.match(/^(.+?) gains? (.+?) until end of turn$/))){const who=subjectOf(m[1]),kws=kwList(m[2]);if(who&&kws)return [{type:'pump',...who,p:0,t:0,kws}];}
 if((m=s.match(/^(.+?) gains? (.+?) and gets? ([+-]\d+)\/([+-]\d+) until end of turn$/))){const who=subjectOf(m[1]),kws=kwList(m[2]);if(who&&kws)return [{type:'pump',...who,p:+m[3],t:+m[4],kws}];}
 if((m=s.match(/^(.+?) can't be blocked this turn$/))){const who=subjectOf(m[1]);if(who)return [{type:'pump',...who,p:0,t:0,kws:['Unblockable']}];}
 // Girar y enderezar
 if(/^untap ~$/.test(s))return [{type:'untap',target:'self'}];
 if(/^untap it$/.test(s))return [{type:'untap',target:'last'}];
 if((m=s.match(/^untap (?:all|each) (.+?) you control$/))){const spec=parseObj(m[1]+' you control');if(spec)return [{type:'untap',target:'each',spec}];}
 if((m=s.match(new RegExp('^untap up to '+N+' lands$'))))return [{type:'untap',target:'lands',count:num(m[1])}];
 if((m=s.match(new RegExp('^untap (?:up to )?'+N+' target lands$'))))return [{type:'untap',target:'lands',count:num(m[1])}];
 if((m=s.match(/^untap target (.+)$/))){const spec=parseObj(m[1]);if(spec)return [{type:'untap',target:'chosen',spec:specFromObj(spec),phrase:m[1]}];}
 if((m=s.match(/^tap target (.+)$/))){const spec=parseObj(m[1]);if(spec)return [{type:'tap',target:'chosen',spec:specFromObj(spec),phrase:m[1]}];}
 if((m=s.match(/^tap all (.+)$/))){const spec=parseObj(m[1]);if(spec)return [{type:'tap',target:'each',spec:{...spec,controller:spec.controller||'any'}}];}
 // Turnos y otros
 if(/^take an extra turn after this one$/.test(s))return [{type:'extraTurn'}];
 // ——— 0.8.4: plantillas frecuentes según Scryfall ———
 if((m=s.match(/^~ deals (\d+) damage to that player$/)))return [{type:'damage',amount:+m[1],target:'event-player'}];
 if((m=s.match(/^then if you control (\w+) or more lands, untap that land$/)))return [{type:'untapIfLands',n:num(m[1])}];
 if(/^exile ~$/.test(s))return [{type:'selfZone',to:'exile'}];
 if(/^shuffle ~ into its owner's library$/.test(s))return [{type:'selfZone',to:'library'}];
 if(/^(?:then )?shuffle$|^(?:then )?that player shuffles$/.test(s))return [{type:'shuffle'}];
 if(/^~ can't be countered$/.test(s))return [];
 if(/^prevent all combat damage that would be dealt this turn$/.test(s))return [{type:'fog'}];
 if(/^you become the monarch$/.test(s))return [{type:'monarch'}];
 if((m=s.match(/^you may play (an|one|two) additional lands? this turn$/)))return [{type:'extraLand',n:m[1]==='two'?2:1}];
 if((m=s.match(new RegExp('^mill '+N+' cards?$'))))return [{type:'mill',count:num(m[1]),who:'you'}];
 if((m=s.match(/^it deals (.+)$/))&&!/^it deals damage equal/.test(s))return parseSentence('~ deals '+m[1]);
 if((m=s.match(new RegExp('^defending player sacrifices '+N+' (.+?)s?$')))){const spec=m[2]==='permanent'?{types:['*'],subtypes:[]}:parseObj(m[2]);if(spec)return [{type:'sacrifice',who:'event-player',count:num(m[1]),spec}];}
 {const own="creature you control",theirs="(creature you don't control|creature an opponent controls|creature or planeswalker you don't control|creature or planeswalker an opponent controls|creature)";
  if((m=s.match(new RegExp('^target ('+own+') fights (?:target |up to one target )?'+theirs+'$')))||(m=s.match(new RegExp('^target ('+own+') deals damage equal to its power to (?:target |up to one target )?'+theirs+'$')))){const a=parseObj(m[1]),b=parseObj(m[2].replace(' or planeswalker',''));if(a&&b)return [{type:'pick',target:'chosen',spec:specFromObj(a),phrase:m[1]},{type:'fight',target:'chosen',spec:specFromObj(b),phrase:m[2],mutual:/ fights /.test(s)}];}}
 if((m=s.match(/^(?:target creature|~) can't block this turn$/)))return [{type:'note',text:'No puede bloquear este turno.'}];
 return null;
}
// Filtro de objetivo de permanente en el formato que valida el motor.
function specFromObj(o){const types=o.types.includes('*')||!o.types.length?(o.subtypes.length?['Creature','Artifact','Enchantment','Land','Planeswalker']:PERMANENT_TYPES):o.types;return {...o,types,opponent:o.controller==='opp',own:o.controller==='you'};}
function bounded(steps){
 for(const st of steps){for(const k of ['count','amount','power','toughness'])if(k in st&&typeof st[k]==='number'&&(!Number.isInteger(st[k])||st[k]<0||st[k]>(k==='count'?20:100)))return null;}
 return steps;
}
// «Pierdes 1 vida y creas una ficha…»: si la frase entera no se reconoce, prueba sus dos mitades.
function parseClause(s){
 const r=parseSentence(s);if(r)return r;
 for(const m of s.matchAll(/,? and (?:then )?/gi)){const left=s.slice(0,m.index),right=s.slice(m.index+m[0].length);const a=parseSentence(left);if(!a)continue;const b=parseSentence(right)||(/^(?:lose|gain|draw|create|put|return|sacrifice|exile|untap|scry|surveil|mill|discard|search)\b/i.test(right)?parseSentence('you '+right):null);if(b)return [...a,...b];}
 return null;
}
function parseLines(text){const out=[];for(const s of sentences(text)){const r=parseClause(s);if(!r)return null;out.push(...r);}
 for(let i=0;i<out.length;i++){const a=out[i],b=out[i+1];
  if(b?.type==='noRegen'&&['destroy','wipe'].includes(a.type)){out.splice(i,2,{...a,noRegen:true});continue;}
  if(b?.type==='counterExile'&&a.type==='counter'){out.splice(i,2,{...a,exile:true});continue;}
  if((a.type==='search'||a.type==='ramp')&&b?.type==='untapIfLands'){out.splice(i,2,{...a,tapped:{unlessLands:b.n}});continue;}
  if(a.type==='lookTop'&&b?.type==='lookBack'){out.splice(i,2,{type:'scry',count:a.n,order:true});continue;}
  if(a.type==='lookTop'&&b?.type==='lookTake'){out.splice(i,2,{type:'dig',look:a.n,take:b.take});continue;}
  if(a.type==='lookTop'&&b?.type==='lookReveal'){const rest=out[i+2]?.type==='lookRest'?1:0;out.splice(i,2+rest,{type:'dig',look:a.n,take:1,spec:b.spec,upTo:true});continue;}
  if(a.type==='revealTop'&&b?.type==='revealTake'){out.splice(i,2,{type:'revealAll',n:a.n,spec:b.spec});continue;}
  if(a.type==='revealTop'&&b?.type==='lookReveal'){const rest=out[i+2]?.type==='lookRest'?1:0;out.splice(i,2+rest,{type:'dig',look:a.n,take:1,spec:b.spec,upTo:true});continue;}
  if(a.type==='morbid'&&out[i-1]?.type==='pump'){out[i-1]={...out[i-1],morbid:{p:a.p,t:a.t}};out.splice(i,1);i--;continue;}
  if(a.type==='wheel'&&b?.type==='wheelDraw'){out.splice(i,2,{type:'wheel',greatest:true});continue;}
  if(a.type==='exileTop'&&b?.type==='playExiled'){out.splice(i,2,{type:'impulse',n:a.n,until:b.until});continue;}
 }
 if(out.some(x=>['lookTop','lookBack','lookTake','lookReveal','lookRest','revealTop','revealTake','morbid','wheelDraw','exileTop','playExiled'].includes(x.type)))return null;
 return out.length?bounded(out):null;}
const LEGACY_OK=e=>e&&((e.type==='draw'&&Number.isInteger(e.count)&&e.count>=0&&e.count<=10)||(['gainLife','damage'].includes(e.type)&&Number.isInteger(e.amount)&&e.amount>=0&&e.amount<=20));
function legacy(e){if(!LEGACY_OK(e))return null;if(e.type==='draw')return [{type:'draw',count:e.count,who:'you'}];if(e.type==='gainLife')return [{type:'gainLife',amount:e.amount}];return [{type:'damage',amount:e.amount,target:'player'}];}
const isSpellType=c=>/\b(Instant|Sorcery)\b/.test(faceType(c));
const ADDITIONAL=/^as an additional cost to cast ~, (.+)$/i;
const MODAL=/^choose (one|two|one or both|one or more) —\s*$/i;
const CAST_OPTION=/^(buyback|kicker|flashback|overload|cycling|(?:commander )?ninjutsu|basic landcycling|plainscycling|islandcycling|swampcycling|mountaincycling|forestcycling|landcycling) ((?:\{[^}]+\})+)$|^(delve|convoke|improvise|cascade)$/i;
const ALT_COST=/^(if it's not your turn, )?you may (?:pay (\d+) life and )?exile (a|an|two|three) (.+?) cards? from your hand rather than pay ~'s mana cost$|^if you control a commander, you may cast ~ without paying its mana cost$|^you may pay (\d+) life rather than pay ~'s mana cost$/i;
// Formas de lanzar: retroceso, estímulo, escarmiento, sobrecarga, ciclo y ninjutsu.
function castOptions(card){const out={};for(const raw of normalize(card).split(/\n+/)){const m=raw.trim().replace(/\.$/,'').match(CAST_OPTION);if(!m)continue;if(m[3]){out[m[3].toLowerCase()]=true;continue;}const k=m[1].toLowerCase();if(k.includes('ninjutsu'))out.ninjutsu={mana:m[2],commander:k.startsWith('commander')};else if(k!=='cycling'&&k.endsWith('cycling')){const what=k.replace(/cycling$/,'');out.typecycling={mana:m[2],spec:what==='basic land'?{types:['Land'],subtypes:[],basic:true}:what==='land'?{types:['Land'],subtypes:[]}:{types:[],subtypes:[cap(what)]}};}else out[k]=m[2];}return out;}
// Costes alternativos (lanzar sin pagar maná).
function altCosts(card){const out=[];for(const raw of normalize(card).split(/\n+/)){const l=raw.trim().replace(/\.$/,'');const m=l.match(ALT_COST);if(!m)continue;
 if(/commander/i.test(l)){out.push({free:true,commander:true,text:l});continue;}
 if(m[5]){out.push({life:+m[5],text:l});continue;}
 const spec=m[4].toLowerCase()==='card'?{types:[],subtypes:[],any:true}:parseObj(m[4]);if(spec)out.push({exile:{spec,count:num(m[3].toLowerCase())},life:m[2]?+m[2]:0,notYourTurn:!!m[1],text:l});}
 return out;}
const SKIP_LINE=l=>{const b=l.trim().replace(/\.$/,'');return ADDITIONAL.test(b)||CAST_OPTION.test(b)||ALT_COST.test(b);};
// «Elige uno —» seguido de viñetas: cada modo debe entenderse.
function modalSteps(lines){
 const i=lines.findIndex(l=>MODAL.test(l.trim()));if(i<0)return undefined;
 const head=lines[i].trim().match(MODAL)[1].toLowerCase();const bullets=lines.slice(i+1).filter(l=>/^•/.test(l.trim())).map(l=>l.trim().replace(/^•\s*/,''));
 const pre=lines.slice(0,i).filter(l=>l.trim());const preSteps=pre.length?parseLines(pre.join('\n')):[];if(pre.length&&!preSteps)return null;
 const modes=bullets.map(b=>{const st=parseLines(b);return st?{label:b,steps:st}:{label:b,steps:[{type:'note',text:'Resuelve a mano: '+b}],manual:true};});if(!modes.length||modes.every(m=>m.manual))return null;
 const range={one:[1,1],two:[2,2],'one or both':[1,2],'one or more':[1,modes.length]}[head];
 return [...preSteps,{type:'mode',min:range[0],max:range[1],modes}];
}
// Efecto al resolver un instantáneo o conjuro.
function spellSteps(card){
 if(!card)return null;
 if(card.abilitySteps)return card.abilitySteps;
 if(card.supportedEffect)return legacy(card.supportedEffect);
 if(!isSpellType(card))return null;
 const lines=normalize(card).split(/\n+/).filter(l=>!SKIP_LINE(l)).map(l=>l.replace(ABILITY_WORD,''));
 const modal=modalSteps(lines);if(modal!==undefined)return modal;
 return parseLines(lines.join('\n'));
}
// Sobrecarga: «objetivo» pasa a ser «cada».
function overloadSteps(card){const lines=normalize(card).split(/\n+/).filter(l=>!SKIP_LINE(l)).map(l=>l.replace(/\btarget\b/gi,'each'));return parseLines(lines.join('\n'));}
// Coste adicional de un hechizo: {sacrifice: filtro} o null.
function additionalCost(card){
 for(const line of normalize(card).split(/\n+/)){const m=line.trim().replace(/\.$/,'').match(ADDITIONAL);if(!m)continue;const k=m[1].toLowerCase();let x;
  if((x=k.match(/^sacrifice (?:a|an) (.+?) or pay ((?:\{[^}]+\})+)$/))){const spec=parseObj(x[1]);if(spec)return {sacrifice:spec,orMana:x[2].toUpperCase(),text:m[1]};}
  if((x=k.match(/^sacrifice (?:a|an) (.+)$/))){const spec=parseObj(x[1]);if(spec)return {sacrifice:spec,text:m[1]};}
  if((x=k.match(/^discard (?:a|an) (.+?)$/))){const spec=x[1]==='card'?{types:[],subtypes:[],any:true}:parseObj(x[1]);if(spec)return {discard:spec,text:m[1]};}
  if((x=k.match(/^pay (\d+) life$/)))return {life:+x[1],text:m[1]};
  return {unknown:true,text:m[1]};
 }
 return null;
}

// ——— Habilidades de permanentes ———
const ABILITY_WORD=/^(?:landfall|morbid|imprint|raid|metalcraft|threshold|constellation|magecraft|alliance|revolt|ferocious|hellbent|delirium|coven|corrupted|eminence|battalion|formidable|domain|kinship|inspired|enrage|addendum|celebration|heroic|bloodthirst|lieutenant|spell mastery|undergrowth|max speed|descend \d+|valiant|survival|eerie|flurry|renew|void|start your engines!?|exhaust) — /i;
function parseTriggerHead(h){
 h=h.toLowerCase();let m;
 const subj=raw=>{raw=raw.trim();if(raw==='~')return {self:true,types:[],subtypes:[]};if((m=raw.match(/^~ or (another .+)$/))){const o=parseObj(m[1]);return o?{self:true,or:o,types:[],subtypes:[]}:null;}if(raw==='equipped creature')return {equipped:true,types:[],subtypes:[]};if(raw==='enchanted creature')return {enchanted:true,types:[],subtypes:[]};const o=parseObj(raw.replace(/^(?:a|an|one or more)\s+/,''));return o;};
 if((m=h.match(/^(?:when|whenever) (.+?) enters(?: the battlefield)?(?: under your control)?(?: or attacks)?( untapped)?$/))){const s=subj(m[1]);return s&&{on:'enters',subject:s,orAttacks:/or attacks$/.test(h),untapped:/untapped$/.test(h)};}
 if((m=h.match(/^(?:when|whenever) (.+?) (?:dies|die|is put into a graveyard from the battlefield)$/))){const s=subj(m[1]);return s&&{on:'dies',subject:s};}
 if((m=h.match(/^(?:when|whenever) (.+?) attacks$/))){const s=subj(m[1]);return s&&{on:'attacks',subject:s};}
 if((m=h.match(/^(?:when|whenever) (.+?) deals combat damage to (?:a player|an opponent)$/))){const s=subj(m[1]);return s&&{on:'combat-damage',subject:s,opponent:/opponent$/.test(h)};}
 if(/^whenever one or more creatures you control deal combat damage to (?:a player|one or more players|an opponent)$/.test(h))return {on:'combat-damage-batch'};
 if(/^at the beginning of each opponent's upkeep$/.test(h))return {on:'upkeep',opp:true};
 if((m=h.match(/^whenever you cast or copy (?:a|an) (.+?) spell$/))){const o=parseObj(m[1]);return o&&{on:'cast',spell:o};}
 if((m=h.match(/^whenever you cast (?:a|an|another) (.+?) spell$/))){if(m[1]==='spell'||!m[1])return {on:'cast',spell:null};const o=parseObj(m[1]);return o&&{on:'cast',spell:o};}
 if(/^whenever you gain life$/.test(h))return {on:'lifegain',mine:true};
 if(/^whenever you draw a card$/.test(h))return {on:'draw',mine:true};
 if(/^whenever an opponent draws a card$/.test(h))return {on:'draw',opp:true};
 if(/^whenever a player draws a card$/.test(h))return {on:'draw'};
 if((m=h.match(/^(?:when|whenever) (.+?) leaves the battlefield$/))){const s=subj(m[1]);return s&&{on:'leaves',subject:s};}
 if((m=h.match(/^whenever (?:a|an|another) (.+?) is put into (?:a|your) graveyard from the battlefield$/))){const o=parseObj(m[1]);return o&&{on:'to-graveyard',subject:o};}
 if((m=h.match(/^whenever one or more (.+?) (?:you control )?enter$/))){const o=parseObj(m[1]+(/you control/.test(h)?' you control':''));return o&&{on:'enters',subject:o,batch:true};}
 if((m=h.match(/^whenever one or more (.+?) (?:you control )?attack$/))){const o=parseObj(m[1]+(/you control/.test(h)?' you control':''));return o&&{on:'attacks',subject:o,batch:true};}
 if(/^whenever you cast a spell$/.test(h))return {on:'cast',spell:null};
 if(/^at the beginning of your upkeep$/.test(h))return {on:'upkeep',mine:true};
 if(/^at the beginning of each upkeep$|^at the beginning of each player's upkeep$/.test(h))return {on:'upkeep',mine:false};
 if(/^at the beginning of your end step$/.test(h))return {on:'endstep',mine:true};
 if(/^at the beginning of each end step$/.test(h))return {on:'endstep',mine:false};
 if(/^at the beginning of combat on your turn$/.test(h))return {on:'combat',mine:true};
 if(/^at the beginning of your precombat main phase$/.test(h))return {on:'main',mine:true};
 return null;
}
// Costes de activación: «{1}{B}, {T}, Sacrifica una Rata».
function parseCost(raw){
 const cost={mana:'',tap:false};
 for(let part of raw.split(/,\s*/)){
  part=part.trim();let m;
  if(/^(\{(?:\d+|[WUBRGCX])\})+$/.test(part)){cost.mana+=part;continue;}
  if(part==='{T}'){cost.tap=true;continue;}
  if(part==='{Q}')return null;
  const p=part.toLowerCase();
  if(/^sacrifice ~$/.test(p)){cost.sacSelf=true;continue;}
  if((m=p.match(new RegExp('^sacrifice '+N+' (.+?)$')))){const spec=parseObj(m[2]);if(!spec)return null;cost.sac={spec,count:num(m[1])};continue;}
  if((m=p.match(/^sacrifice (another .+)$/))){const spec=parseObj(m[1]);if(!spec)return null;cost.sac={spec,count:1};continue;}
  if((m=p.match(/^discard (?:a|an) (.+?)$/))){const spec=m[1]==='card'?{types:[],subtypes:[],any:true}:parseObj(m[1].replace(/ card$/,''));if(!spec)return null;cost.discard={spec,count:1};continue;}
  if(p==='discard your hand')return null;
  if((m=p.match(/^pay (\d+) life$/))){cost.life=+m[1];continue;}
  if(/^pay life equal to the number of colors in your commanders?' color identity$/.test(p)){cost.lifeIdentity=true;continue;}
  if((m=p.match(new RegExp('^remove '+N+' ([a-z+/0-9-]+) counters? from ~$')))){cost.removeCounters={kind:m[2],count:num(m[1])};continue;}
  if((m=p.match(/^exile ~ from your graveyard$/)))return null;
  return null;
 }
 return cost;
}
function staticAbility(line){
 const l=line.toLowerCase().replace(/\.$/,'');let m;
 if(/^~ enters(?: the battlefield)? tapped$/.test(l))return {kind:'static',type:'entersTapped'};
 if((m=l.match(/^~ enters tapped with (a|an|one|two|three|four|\d+) ([a-z]+) counters? on it$/)))return {kind:'static',type:'entersTapped',with:{n:num(m[1]),counter:cap(m[2])}};
 if((m=l.match(/^as ~ enters, you may pay (\d+) life\. if you don't, it enters tapped$/)))return {kind:'static',type:'shock',life:+m[1]};
 if((m=l.match(/^as ~ enters, you may reveal (?:a|an) (.+?) card from your hand\. if you don't, ~ enters tapped$/))){const spec=parseObj(m[1]);if(spec)return {kind:'static',type:'entersTapped',revealUnless:spec};}
 if((m=l.match(/^~ enters(?: the battlefield)? tapped unless you control (\w+) or fewer other lands$/)))return {kind:'static',type:'entersTapped',fewer:num(m[1])};
 if(/^~ enters(?: the battlefield)? tapped unless you have two or more opponents$/.test(l))return {kind:'static',type:'entersTapped',opponents:2};
 if((m=l.match(/^~ enters(?: the battlefield)? tapped unless you control (\w+) or more (.+)$/))){const spec=parseObj(m[2]+' you control');if(spec)return {kind:'static',type:'entersTapped',unless:{spec,count:num(m[1])}};}
 if(/^~ can't be countered$/.test(l))return {kind:'static',type:'uncounterable'};
 if(/^you may look at the top card of your library any time$|^play with the top card of your library revealed$/.test(l))return {kind:'static',type:'none'};
 if((m=l.match(/^~ can't be blocked by creatures with power (\d+) or less$/)))return {kind:'static',type:'evasion',maxPower:+m[1]};
 if(/^compleated$|^partner$/.test(l))return {kind:'static',type:'none'};
 if((m=l.match(/^~ enters with (a|an|one|two|three|four|five|x|\d+) ([+-]1\/[+-]1|[a-z]+) counters? on it$/)))return {kind:'static',type:'entersWith',n:num(m[1]),counter:/\//.test(m[2])?m[2]:cap(m[2])};
 if((m=l.match(/^~ enters(?: the battlefield)? tapped unless you control (\w+) or more other (.+)$/))){const spec=parseObj(m[2]+' you control');if(spec)return {kind:'static',type:'entersTapped',unless:{spec:{...spec,other:true},count:num(m[1])}};}
 if((m=l.match(/^~ enters(?: the battlefield)? tapped unless you control (?:a|an) (.+)$/))){const spec=parseObj(m[1]+' you control');if(spec)return {kind:'static',type:'entersTapped',unless:{spec,count:1}};}
 if((m=l.match(/^(.+?) (?:you control )?gets? ([+-]\d+)\/([+-]\d+)(?: and (?:has|have) (.+))?$/))&&!/until end of turn|for each/.test(l)){const who=m[1].trim();const kws=m[4]?kwList(m[4]):[];if(kws){if(who==='equipped creature')return {kind:'static',type:'anthem',attached:'equipped',p:+m[2],t:+m[3],kws};if(who==='enchanted creature')return {kind:'static',type:'anthem',attached:'enchanted',p:+m[2],t:+m[3],kws};const spec=parseObj(/you control/.test(l)?who+' you control':who);if(spec)return {kind:'static',type:'anthem',spec:{...spec,controller:spec.controller||(/you control/.test(l)?'you':'any')},p:+m[2],t:+m[3],kws};}}
 if((m=l.match(/^(.+?) (?:you control )?(?:have|has) (.+)$/))&&!/maximum hand size|as long as/.test(l)){const who=m[1].trim(),kws=kwList(m[2]);if(kws){if(who==='equipped creature')return {kind:'static',type:'anthem',attached:'equipped',p:0,t:0,kws};if(who==='enchanted creature')return {kind:'static',type:'anthem',attached:'enchanted',p:0,t:0,kws};if(who==='~')return {kind:'static',type:'anthem',self:true,p:0,t:0,kws};const spec=parseObj(/you control/.test(l)?who+' you control':who);if(spec)return {kind:'static',type:'anthem',spec:{...spec,controller:spec.controller||(/you control/.test(l)?'you':'any')},p:0,t:0,kws};}}
 if((m=l.match(/^as long as ~ is monstrous, it has (.+)$/))){const kws=kwList(m[1]);if(kws)return {kind:'static',type:'anthem',self:true,p:0,t:0,kws,condition:{monstrous:true}};}
 if((m=l.match(/^as long as ~ is monstrous, it gets ([+-]\d+)\/([+-]\d+)$/)))return {kind:'static',type:'anthem',self:true,p:+m[1],t:+m[2],kws:[],condition:{monstrous:true}};
 if((m=l.match(/^~ has (.+?) as long as you control (?:a|an) (.+)$/))){const kws=kwList(m[1]),spec=parseObj(m[2]+' you control');if(kws&&spec)return {kind:'static',type:'anthem',self:true,p:0,t:0,kws,condition:{spec,count:1}};}
 if((m=l.match(/^~ gets ([+-]\d+)\/([+-]\d+) for each (.+)$/))){const a=parseAmount(m[3]);if(a)return {kind:'static',type:'anthem',self:true,p:{...a,times:+m[1]},t:{...a,times:+m[2]},kws:[]};}
 if((m=l.match(/^~'s power and toughness are each equal to (?:the number of )?(.+)$/))){const a=parseAmount(m[1]);if(a)return {kind:'static',type:'cda',p:a,t:a};}
 if((m=l.match(/^~'s power is equal to (?:the number of )?(.+)$/))){const a=parseAmount(m[1]);if(a)return {kind:'static',type:'cda',p:a};}
 if((m=l.match(/^(.+?) spells you cast cost \{(\d+)\} less to cast$/))){const spec=m[1]==='all'?{types:[],subtypes:[],any:true}:parseObj(m[1].replace(/ and /g,' or '));if(spec)return {kind:'static',type:'costReduce',spec,amount:+m[2]};}
 if((m=l.match(/^(.+?) spells you cast cost \{1\} less to cast for each (.+) counter on ~$/))){const spec=parseObj(m[1].replace(/ and /g,' or '));if(spec)return {kind:'static',type:'costReduce',spec,amount:{of:'counters',kind:cap(m[2])}};}
 if((m=l.match(/^(?:(.+?) )?spells (your opponents cast )?cost \{(\d+)\} more to cast$/))){const spec=!m[1]?{types:[],subtypes:[],any:true}:parseObj(m[1].replace(/ and /g,' or '));if(spec)return {kind:'static',type:'costMore',spec,amount:+m[3],opp:!!m[2]};}
 if(/^creatures can't attack you unless their controller pays \{2\} for each creature they control that's attacking you$/.test(l))return {kind:'static',type:'attackTax',n:2};
 if(/^you have no maximum hand size$/.test(l))return {kind:'static',type:'handSize',mine:Infinity};
 if(/^untap ~ during each other player's untap step$/.test(l))return {kind:'static',type:'untapOthers',all:false};
 if(/^untap all permanents you control during each other player's untap step$/.test(l))return {kind:'static',type:'untapOthers',all:true};
 if((m=l.match(/^if ~ would be put into a graveyard from anywhere, (?:reveal ~ and )?shuffle it into its owner's library instead$/)))return {kind:'static',type:'shuffleInstead'};
 if((m=l.match(/^each opponent's maximum hand size is reduced by (\w+)$/)))return {kind:'static',type:'handSize',opp:-num(m[1])};
 if((m=l.match(/^you may play (an|two) additional lands? on each of your turns$/)))return {kind:'static',type:'extraLand',n:m[1]==='two'?2:1};
 if(/^~ doesn't untap during your untap step$/.test(l))return {kind:'static',type:'noUntap'};
 if(/^skip your draw step$/.test(l))return {kind:'static',type:'skipDraw'};
 if(/^you may play lands from your graveyard$/.test(l))return {kind:'static',type:'landsFromGrave'};
 if(/^if you would gain life, you gain twice that much life instead$/.test(l))return {kind:'static',type:'lifeGain',mult:2};
 if((m=l.match(/^if you would gain life, you gain that much life plus (\d+) instead$/)))return {kind:'static',type:'lifeGain',plus:+m[1]};
 if(/^if (?:one or more|an effect would create one or more) tokens would be created under your control, twice that many of those tokens are created instead$|^if an effect would create one or more tokens under your control, it creates twice that many of those tokens instead$/.test(l))return {kind:'static',type:'tokenDouble'};
 if(/^enchanted creature can't attack or block$/.test(l))return {kind:'static',type:'anthem',attached:'enchanted',p:0,t:0,kws:["Can't attack","Can't block"]};
 if(/^enchanted creature can't attack$/.test(l))return {kind:'static',type:'anthem',attached:'enchanted',p:0,t:0,kws:["Can't attack"]};
 if(/^~ can't attack or block$/.test(l))return {kind:'static',type:'anthem',self:true,p:0,t:0,kws:["Can't attack","Can't block"]};
 if(/^~ can't attack$/.test(l))return {kind:'static',type:'anthem',self:true,p:0,t:0,kws:["Can't attack"]};
 if(/^~ can't block$/.test(l))return {kind:'static',type:'anthem',self:true,p:0,t:0,kws:["Can't block"]};
 if(/^~ can't be blocked$/.test(l))return {kind:'static',type:'anthem',self:true,p:0,t:0,kws:['Unblockable']};
 if(/^~ can be your commander$|^a deck can have any number of cards named ~$|^a deck can have up to \w+ cards named ~$/.test(l))return {kind:'static',type:'none'};
 if((m=l.match(/^as ~ enters, choose a creature type$/)))return {kind:'static',type:'chooseType'};
 if((m=l.match(/^as ~ enters, choose a color$/)))return {kind:'static',type:'chooseColor'};
 if((m=l.match(/^enchant (creature|land|artifact|permanent|creature you control)$/)))return {kind:'static',type:'enchant',spec:parseObj(m[1])};
 return null;
}
const ABILITY_CACHE=new Map();
// Todas las habilidades de un permanente (o carta). Cada línea que no se entiende va a «manual».
function abilities(card){
 if(!card)return {list:[],manual:[]};
 const key=(card.name||'')+'\u0000'+(card.oracle_text||'')+'\u0000'+(card.type_line||'');
 if(ABILITY_CACHE.has(key))return ABILITY_CACHE.get(key);
 const list=[],manual=[];
 const text=normalize(card);
 const mana=manaAbility(card);if(mana)list.push({kind:'mana',...mana});
 const allLines=text?text.split(/\n+/):[];const consumed=new Set();
 for(let idx=0;idx<allLines.length;idx++){let line=allLines[idx];
  line=line.trim().replace(ABILITY_WORD,'');const bare=line.replace(/\.$/,'');
  if(!bare)continue;
  // Palabras clave sueltas: «Flying, haste».
  {const parts=bare.split(/,\s*/).map(k=>k.trim().toLowerCase());const kw=[],extra=[];let okLine=parts.length>0;
   for(const k of parts){let mk;if(KEYWORD[k])kw.push(KEYWORD[k]);else if((mk=k.match(/^toxic (\d+)$/)))extra.push({kind:'toxic',n:+mk[1]});else if((mk=k.match(/^bushido (\d+)$/)))extra.push({kind:'bushido',n:+mk[1]});else if((mk=k.match(/^annihilator (\d+)$/)))extra.push({kind:'trigger',on:'attacks',subject:{self:true},steps:[{type:'sacrifice',who:'event-player',count:+mk[1],spec:{types:['*'],subtypes:[]}}],optional:false,text:'Annihilator '+mk[1]});else if((mk=k.match(/^crew (\d+)$/)))extra.push({kind:'activated',cost:{mana:'',tap:false,crew:+mk[1]},steps:[{type:'crew'}],text:'Crew '+mk[1]});else if((mk=k.match(/^protection from (white|blue|black|red|green)(?: and from (white|blue|black|red|green))?$/)))extra.push({kind:'protection',colors:[COLOR_WORD[mk[1]],...(mk[2]?[COLOR_WORD[mk[2]]]:[])]});else{okLine=false;break;}}
   if(okLine){if(kw.length)list.push({kind:'keywords',list:kw});list.push(...extra);continue;}}
  let m;
  if((m=bare.match(/^equip ((?:\{[^}]+\})+)$/i))){list.push({kind:'activated',cost:{mana:m[1].toUpperCase(),tap:false},steps:[{type:'attach'}],sorcery:true,text:line,equip:true});continue;}
  if((m=bare.match(/^bushido (\d+)$/i))){list.push({kind:'bushido',n:+m[1]});continue;}
  if(SKIP_LINE(bare))continue;
  if(/^•/.test(bare)){if(!consumed.has(idx))manual.push(line);continue;}
  if(mana&&/^(?:\{(?:\d+|[WUBRGC])\}, )*\{T\}(?:, [^:]+)?: Add\b/.test(bare))continue;
  if(/^\{T\}: Add one mana of the chosen color$/i.test(bare))continue;
  if(ADDITIONAL.test(bare)&&additionalCost(card)&&!additionalCost(card).unknown)continue;
  if(isSpellType(card))continue;
  if(/^at the beginning of each player's draw step, that player draws an additional card$/i.test(bare)){list.push({kind:'static',type:'extraDraw',text:line});continue;}
  // Disparadas: «Cuando/Cada vez que/Al comienzo de…, efecto».
  if((m=line.match(/^((?:When|Whenever|At)\b[^,]*?(?:, (?!if )[^,]*? or [^,]*?)?), (.+)$/i))&&!/^at the beginning of the next/i.test(line)){
   const head=parseTriggerHead(m[1].replace(/~ or another/i,'~ or another'));
   let body=m[2].trim();let optional=false,once=false;
   if(/ This ability triggers only once each turn\.?$/i.test(body)){once=true;body=body.replace(/ This ability triggers only once each turn\.?$/i,'');}
   let eminence=false;if(/^if ~ is in the command zone or on the battlefield, /i.test(body)){eminence=true;body=body.replace(/^if ~ is in the command zone or on the battlefield, /i,'');}
   let pay=null;{const pm=body.match(/^you may pay ((?:\{[^}]+\})+)\. if you do, (.+)$/i);if(pm){pay=pm[1].toUpperCase();body=pm[2];optional=true;}}
   if(/^you may /i.test(body)&&!/^you may pay /i.test(body)){optional=true;body=body.replace(/^you may /i,'');}
   let steps;if(MODAL.test(body)){const rest=[];for(let k=idx+1;k<allLines.length&&/^•/.test(allLines[k].trim());k++){rest.push(allLines[k]);consumed.add(k);}steps=head&&modalSteps([body,...rest]);}else steps=head&&parseLines(cap(body));
   if(head&&steps){list.push({kind:'trigger',...head,steps:pay?[{type:'pay',mana:pay},...steps]:steps,optional,once,eminence,text:line});continue;}
   manual.push(line);continue;
  }
  // Lealtad de planeswalker: «+1: …», «−3: …».
  if((m=line.replace(/\u2212/g,'-').match(/^([+-]?\d+): (.+)$/))&&/\bPlaneswalker\b/.test(card.type_line||'')){const steps=parseLines(m[2]);if(steps){list.push({kind:'activated',cost:{mana:'',tap:false,loyalty:Number(m[1])},steps,sorcery:true,loyalty:true,text:line});continue;}manual.push(line);continue;}
  // Activadas: «Coste: efecto».
  if((m=line.match(/^([^:"]+): (.+)$/))&&!/^(?:choose|when|whenever|at )/i.test(line)){
   const cost=parseCost(m[1]);let body=m[2].trim();const sorcery=/Activate only as a sorcery\.?$/i.test(body);const onceTurn=/Activate only once each turn\.?$/i.test(body);
   body=body.replace(/\s*Activate only (?:as a sorcery|once each turn)\.?$/i,'');
   const steps=cost&&parseLines(body);
   if(cost&&steps){list.push({kind:'activated',cost,steps,sorcery,onceTurn,text:line});continue;}
   manual.push(line);continue;
  }
  const st=staticAbility(bare);if(st){if(st.type!=='none')list.push({...st,text:line});continue;}
  manual.push(line);
 }
 // Prowess es un disparo implícito.
 if(list.some(a=>a.kind==='keywords'&&a.list.includes('Prowess')))list.push({kind:'trigger',on:'cast',spell:{types:[],subtypes:[],noncreature:true},steps:[{type:'pump',target:'self',p:1,t:1,kws:[]}],optional:false,text:'Prowess'});
 const out={list,manual};ABILITY_CACHE.set(key,out);if(ABILITY_CACHE.size>4000)ABILITY_CACHE.delete(ABILITY_CACHE.keys().next().value);
 return out;
}
// Compatibilidad: «Cuando ~ entra» de un permanente (ahora se dispara a la pila al entrar).
function etbSteps(card){
 if(!card||isSpellType(card))return null;
 const t=abilities(card).list.find(a=>a.kind==='trigger'&&a.on==='enters'&&a.subject?.self&&!a.subject.or&&!a.optional);
 return t?t.steps:null;
}
// Pasos de una entrada de la pila: hechizo o habilidad.
function stepsFor(entryCard){if(entryCard?.abilitySteps)return entryCard.abilitySteps;return isSpellType(entryCard)||entryCard?.supportedEffect?spellSteps(entryCard):null;}
// ¿Qué tipo de objetivo pide el paso? null si ninguno.
function targetKind(step){
 if(step.type==='damage')return ['any','creature','player','opponent'].includes(step.target)?step.target:null;
 if(step.type==='loseLife'||step.type==='draw'||step.type==='discard'||step.type==='sacrifice'||step.type==='mill'||step.type==='exileGrave'||step.type==='reveal'||step.type==='handToTop'||step.type==='poison')return step.who==='target-player'?'player':step.who==='target-opponent'?'opponent':null;
 if(['destroy','exile','bounce'].includes(step.type))return 'permanent';
 if(step.type==='counters'&&step.target==='creature')return 'creature';
 if((step.type==='pick'||step.type==='fight')&&step.target==='chosen')return 'permanent';
 if((step.type==='pump'||step.type==='untap'||step.type==='tap'||step.type==='regenerate'||step.type==='copyToken')&&step.target==='chosen')return 'permanent';
 if(step.type==='counter'||step.type==='copySpell')return 'spell';
 return null;
}
function permanentSpec(step){if(step.spec)return step.spec.types?step.spec:null;if(step.type==='counters')return PERMANENT_TARGET.creature;if(step.type==='damage')return PERMANENT_TARGET.creature;return PERMANENT_TARGET[step.target]||null;}
function matchesPermanent(card,spec,ownerId,controllerId,srcIid){
 if(!spec||!card)return false;const type=card.type_line||'';
 if(spec.nonland&&/\bLand\b/.test(type))return false;
 if(spec.opponent&&ownerId===controllerId)return false;
 if(spec.own&&ownerId!==controllerId)return false;
 if(!spec.types.some(t=>new RegExp('\\b'+t+'\\b').test(type)))return false;
 if(spec.subtypes?.length||spec.colors||spec.notColors||spec.nontoken||spec.other||spec.tapped||spec.untapped||spec.attacking||spec.noncreature||spec.nonbasic||spec.legendary)return matchCard(card,{...spec,types:[],controller:undefined},{srcIid});
 return true;
}
function matchesSpell(entry,kind){const t=entry?.card?.type_line||'';if(kind==='activated or triggered ability')return !!entry?.ability;if(kind==='activated ability, triggered ability, or legendary spell')return !!entry?.ability||/\bLegendary\b/.test(t);if(entry?.ability)return false;if(kind==='spell')return true;if(kind==='noncreature spell')return !/\bCreature\b/.test(t);if(kind==='creature spell')return /\bCreature\b/.test(t);if(kind==='instant or sorcery spell')return /\b(Instant|Sorcery)\b/.test(t);if(kind==='instant spell')return /\bInstant\b/.test(t);if(kind==='sorcery spell')return /\bSorcery\b/.test(t);if(kind==='artifact, creature, or planeswalker spell')return /\b(Artifact|Creature|Planeswalker)\b/.test(t);if(kind==='enchantment, instant, or sorcery spell')return /\b(Enchantment|Instant|Sorcery)\b/.test(t);return false;}
// Habilidad de maná: {options:[colores], amount} o null si requiere decisión manual.
// Habilidad de maná con {T}: {options, amount, fixed?, pain?, life?, cost?, sacrifice?, per?, creature?} o null si requiere decisión manual.
function manaAbility(card,player){
 if(!card)return null;const type=faceType(card);
 if(card.card_faces?.length>1&&!card.card_faces[0]?.type_line&&!card.card_faces[0]?.oracle_text)return null;// caras sin datos: a mano
 const isLand=/\bLand\b/.test(type);
 const map={Plains:'W',Island:'U',Swamp:'B',Mountain:'R',Forest:'G'};
 const text=faceText(card).replace(/’/g,"'").trim();
 if(isLand&&!text){
  const types=Object.keys(map).filter(t=>new RegExp('\\b'+t+'\\b').test(type));
  if(types.length)return {options:types.map(t=>map[t]),amount:1,...(/\bCreature\b/.test(type)?{creature:true}:{})};
  if(card.name==='Wastes')return {options:['C'],amount:1};
  return null;
 }
 const name=String(card.name||'');
 const lines=text.split(/\n+/).map(l=>{let x=l.trim().replace(/^\((.*)\)$/,'$1');if(name.length>2)x=x.split(name).join('~');return x.replace(/\bthis (artifact|land|creature)\b/gi,'~');});
 const options=new Set();let amount=0,fixed=null,cost='',sacrifice=false,per=null,lines_n=0;const pain={},life={};
 for(const line of lines){
  if(!/\bAdd\b/.test(line))continue;
  const m0=line.match(/^((?:\{(?:\d+|[WUBRGC])\}, )*\{T\}(?:, [^:]+)?): Add (.+?)\.(?: (.+))?$/);
  if(!m0)continue;// otras habilidades de maná (sin {T}) se tratan como activadas
  let lcost='',llife=0,lsac=false;
  for(const k of m0[1].split(/, /)){if(k==='{T}')continue;if(/^(\{(?:\d+|[WUBRGC])\})+$/.test(k))lcost+=k;else if(/^Pay (\d+) life$/i.test(k))llife=+k.match(/\d+/)[0];else if(/^Sacrifice ~$/i.test(k))lsac=true;else return null;}
  let lpain=0;const rider=m0[3]||'';if(rider){const r=rider.match(/^~ deals (\d+) damage to you\.?$/);if(r)lpain=+r[1];else if(!/^(?:When that mana is spent|Spend this mana only)/i.test(rider))return null;}
  const body=m0[2];let opts=[],n=1,mm,lfixed=null,lper=null;
  if((mm=body.match(/^((?:\{[WUBRGC]\})+)$/))){const sym=mm[1].match(/[WUBRGC]/g);if(new Set(sym).size===1){opts=[sym[0]];n=sym.length;}else{lfixed={};for(const x of sym)lfixed[x]=(lfixed[x]||0)+1;opts=[...new Set(sym)];n=sym.length;}}
  else if((mm=body.match(/^(\{[WUBRGC]\}(?:, \{[WUBRGC]\})*,? or \{[WUBRGC]\})$/)))opts=mm[1].match(/[WUBRGC]/g);
  else if(/^one mana of any color(?: that a land an opponent controls could produce)?$/i.test(body))opts=['W','U','B','R','G'];
  else if((mm=body.match(/^(two|three) mana of any one color$/i))){opts=['W','U','B','R','G'];n=NUM[mm[1].toLowerCase()];}
  else if(/^one mana of any color in your commander's color identity$/i.test(body)){const id=player?.command?.find(c=>c.isCommander)?.color_identity||player?.battlefield?.find(c=>c.isCommander)?.color_identity||player?.commanderIdentity||[];opts=id.length?id:['C'];}
  else if(/^one mana of the chosen color$/i.test(body)){if(!card.chosenColor)return null;opts=[card.chosenColor];}
  else if((mm=body.match(/^\{([WUBRGC])\} for each (.+)$/))){const a=parseAmount(mm[2]);if(!a||!['count','counters'].includes(a.of))return null;opts=[mm[1]];lper=a;}
  else if((mm=body.match(/^an amount of \{([WUBRGC])\} equal to ~'s power$/))){opts=[mm[1]];lper={of:'selfPower'};}
  else if((mm=body.match(/^x mana of any one color, where x is (?:the number of )?(.+)$/i))){const a=parseAmount(mm[1]);if(!a)return null;opts=['W','U','B','R','G'];lper=a;}
  else return null;
  lines_n++;
  if(lines_n>1&&(lfixed||fixed||lper||per||lsac||sacrifice||lcost||cost||n!==amount))return null;// combinaciones raras: a mano
  amount=n;fixed=lfixed;per=lper;cost=lcost;sacrifice=lsac;for(const o of opts){options.add(o);if(lpain)pain[o]=Math.max(pain[o]||0,lpain);if(llife)life[o]=Math.max(life[o]||0,llife);}
  // Si un color sale gratis por otra línea, no duele.
 }
 if(!options.size||!amount)return null;
 if(per&&player){amount=per.of==='counters'?Number(card.counters?.[per.kind])||0:per.of==='selfPower'?Number(card.power)||0:Math.max(0,(per.spec.controller==='any'&&player.all?player.all:player.battlefield||[]).filter(x=>matchCard(x,{...per.spec,controller:undefined},{srcIid:card.iid})).length);}
 const out={options:COLORS.filter(c=>options.has(c)),amount};
 if(fixed)out.fixed=fixed;if(Object.keys(pain).length)out.pain=pain;if(Object.keys(life).length)out.life=life;if(cost)out.cost=cost;if(sacrifice)out.sacrifice=true;if(per)out.per=true;if(/\bCreature\b/.test(type))out.creature=true;
 return out;
}
// Líneas del texto que la mesa NO aplica sola (quedan para resolver a mano). [] = carta automática.
// Frases que el lector no entiende (para saber exactamente qué falta).
const badSentences=text=>{const bad=text.split(/\n+/).filter(l=>!SKIP_LINE(l)&&!MODAL.test(l.trim())).flatMap(l=>sentences(l.replace(ABILITY_WORD,'').replace(/^•\s*/,'')).filter(x=>!parseClause(x)));return bad.length?[...new Set(bad)]:text.split(/\n+/).filter(l=>!SKIP_LINE(l));};
function uncovered(card){
 if(!card)return [];
 const text=normalize(card);if(!text)return /\bLand\b/.test(card.type_line||'')&&!manaAbility(card)?['Tierra sin habilidad de maná reconocida']:[];
 const add=additionalCost(card);const extra=add?.unknown?[add.text]:[];
 if(isSpellType(card)){const st=spellSteps(card);return st?[...extra,...st.filter(x=>x.type==='mode').flatMap(x=>x.modes.filter(m=>m.manual).map(m=>'• '+m.label))]:badSentences(text);}
 return [...extra,...abilities(card).manual];
}
// ——— Etiquetas en español para la interfaz ———
const TARGET_ES={'creature':'una criatura','creature an opponent controls':'una criatura rival',"creature you don't control":'una criatura que no controlas','artifact':'un artefacto','enchantment':'un encantamiento','artifact or enchantment':'un artefacto o encantamiento','creature or planeswalker':'una criatura o planeswalker','planeswalker':'un planeswalker','land':'una tierra','nonland permanent':'un permanente que no sea tierra',"nonland permanent you don't control":'un permanente rival que no sea tierra','nonland permanent an opponent controls':'un permanente rival que no sea tierra','permanent':'un permanente'};
const WIPE_ES={creatures:'todas las criaturas',artifacts:'todos los artefactos',enchantments:'todos los encantamientos','nonland permanents':'todos los permanentes que no sean tierra'};
const SPELL_ES={spell:'un hechizo','noncreature spell':'un hechizo que no sea de criatura','creature spell':'un hechizo de criatura','instant or sorcery spell':'un instantáneo o conjuro','instant spell':'un instantáneo','sorcery spell':'un conjuro'};
const AMOUNT_ES=a=>typeof a==='number'?String(a):a?.of==='opponents'?'1 por oponente':a?.of==='count'?'según tus permanentes':a?.of==='devotion'?'tu devoción':a?.of==='lastLost'?'lo perdido':'X';
function describe(step){
 const who={you:'Robas','target-player':'El jugador objetivo roba','each-player':'Cada jugador roba'};
 const n=x=>AMOUNT_ES(x);
 switch(step.type){
  case 'draw':return (who[step.who]||'Roba')+' '+n(step.count)+' carta(s)';
  case 'gainLife':return 'Ganas '+n(step.amount)+' vidas';
  case 'loseLife':return ({you:'Pierdes ','each-opponent':'Cada oponente pierde ','each-player':'Cada jugador pierde ','target-player':'El jugador objetivo pierde ','target-opponent':'El oponente objetivo pierde ','same-player':'Ese jugador pierde '}[step.who]||'Pierde ')+n(step.amount)+' vidas';
  case 'damage':return n(step.amount)+' de daño a '+({any:'un objetivo','creature':'una criatura',player:'un jugador',opponent:'un oponente','each-opponent':'cada oponente','each-creature':'cada criatura','each-player':'cada jugador','each-creature-player':'cada criatura y cada jugador','each-opponent-creature':'cada criatura rival'}[step.target]||'un objetivo');
  case 'destroy':return 'Destruye '+(TARGET_ES[step.target]||step.target);
  case 'exile':return 'Exilia '+(TARGET_ES[step.target]||step.target);
  case 'bounce':return 'Devuelve a la mano '+(TARGET_ES[step.target]||step.target);
  case 'wipe':return (step.bounce?'Devuelve a la mano ':step.exile?'Exilia ':'Destruye ')+(WIPE_ES[step.what]||'todos los permanentes indicados');
  case 'counter':return 'Contrarresta '+(SPELL_ES[step.spell]||step.spell);
  case 'token':return 'Crea '+n(step.count)+' ficha(s) '+step.power+'/'+step.toughness+' '+step.name;
  case 'namedToken':return 'Crea '+n(step.count)+' ficha(s) de '+({treasure:'Tesoro',clue:'Pista',food:'Comida',blood:'Sangre',map:'Mapa'}[step.kind]||step.kind);
  case 'counters':return step.count+' contador(es) '+(step.kind||'+1/+1')+' '+(step.target==='each-own'?'en cada criatura tuya':step.target==='self'?'en esta carta':'en una criatura');
  case 'ramp':return 'Busca '+step.count+' tierra(s) básica(s) '+(step.to==='hand'?'a tu mano':'al campo'+(step.tapped?' girada(s)':''));
  case 'search':return 'Busca en tu biblioteca '+(step.to==='hand'?'y ponla en tu mano':step.to==='top'?'y ponla encima':'y ponla en el campo');
  case 'returnCard':return 'Regresa '+(step.count>1?step.count+' cartas':'una carta')+' del cementerio '+({hand:'a la mano',top:'encima de tu biblioteca'}[step.to]||'al campo');
  case 'discard':return ({you:'Descartas','each-opponent':'Cada oponente descarta','each-player':'Cada jugador descarta','target-player':'El jugador objetivo descarta','target-opponent':'El oponente objetivo descarta'}[step.who]||'Descarta')+' '+step.count+' carta(s)'+(step.random?' al azar':'');
  case 'sacrifice':return ({you:'Sacrificas','each-opponent':'Cada oponente sacrifica','each-player':'Cada jugador sacrifica','target-player':'El jugador objetivo sacrifica','target-opponent':'El oponente objetivo sacrifica'}[step.who]||'Sacrifica')+(step.self?' esta carta':' '+step.count+' permanente(s)');
  case 'pump':return (step.target==='self'?'Esta carta':step.target==='each'?'Tus criaturas':'Una criatura')+' '+(typeof step.p==='number'?(step.p>=0?'+':'')+step.p+'/'+(step.t>=0?'+':'')+step.t:'±X')+(step.kws?.length?' y '+step.kws.join(', '):'')+' hasta el final del turno';
  case 'untap':return 'Endereza '+(step.target==='lands'?'hasta '+step.count+' tierras':step.target==='each'?'tus permanentes':step.target==='self'?'esta carta':'un permanente');
  case 'tap':return 'Gira '+(step.target==='each'?'los permanentes indicados':'un permanente');
  case 'scry':return (step.surveil?'Vigila ':'Adivina ')+step.count;
  case 'dig':return 'Mira '+step.look+' y toma '+step.take;
  case 'mill':return 'Muele '+step.count;
  case 'exileGrave':return 'Exilia el cementerio de un jugador';
  case 'exileCard':return 'Exilia una carta de un cementerio rival';
  case 'reveal':return 'Mira la mano de un jugador';
  case 'handToTop':return 'Un oponente pone una carta de su mano encima de su biblioteca';
  case 'extraTurn':return 'Juegas un turno adicional';
  case 'attach':return 'Equipa a una criatura tuya';
  case 'mode':return 'Elige '+(step.min===step.max?step.min:step.min+'-'+step.max)+' modo(s)';
  case 'chooseType':return 'Elige un tipo de criatura';
  case 'regenerate':return 'Regenera '+(step.target==='self'?'esta carta':'una criatura');
  case 'monstrosity':return 'Monstruosidad '+n(step.n);
  case 'putBack':return 'Pon '+step.count+' carta(s) de tu mano encima de tu biblioteca';
  case 'wheel':return 'Cada jugador descarta su mano y roba';
  case 'delayed':return 'Robo en el próximo mantenimiento';
  case 'copyToken':return 'Crea una ficha copia';
  case 'putFromHand':return 'Pon una carta de tu mano en el campo';
  case 'pay':return 'Paga '+step.mana;
  case 'impulse':return 'Exilia '+step.n+' y puedes jugarla(s) '+(step.until==='next'?'hasta tu próximo turno':'este turno');
  case 'copySpell':return 'Copia un hechizo';
  case 'poison':return 'Veneno +'+n(step.count);
  case 'proliferate':return 'Proliferar'+(step.times>1?' dos veces':'');
  case 'addMana':return 'Añade maná';
  case 'bounceOwn':return 'Devuelve a tu mano un permanente tuyo';
  case 'revealAll':return 'Revela '+step.n+' y toma las que cumplan';
  case 'note':return step.text;
 }
 return 'Efecto';
}
return {castOptions,altCosts,overloadSteps,uncovered,abilities,additionalCost,parseObj,matchCard,hasSubtype,colorsOf,parseAmount,NAMED_TOKEN,KEYWORD_IMPL,normalize,sentences,parseSentence,spellSteps,etbSteps,stepsFor,targetKind,permanentSpec,matchesPermanent,matchesSpell,manaAbility,describe,PERMANENT_TARGET};
});
