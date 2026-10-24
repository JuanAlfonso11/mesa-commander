/* Mesa Commander — lector de efectos. Convierte texto Oracle sencillo en pasos que el motor sabe aplicar.
   Es deliberadamente conservador: si un hechizo tiene una sola frase que no entiende, todo queda manual. */
(function(root, factory) {
  var api=factory(); if(typeof module==='object'&&module.exports) module.exports=api; root.MFX=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const COLORS=['W','U','B','R','G','C'];
const NUM={a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const N='(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
const num=v=>NUM[v]??Number(v);
const COLOR_WORD={white:'W',blue:'U',black:'B',red:'R',green:'G',colorless:'C'};
const KEYWORD={'flying':'Flying','reach':'Reach','vigilance':'Vigilance','haste':'Haste','trample':'Trample','lifelink':'Lifelink','deathtouch':'Deathtouch','menace':'Menace','first strike':'First strike','double strike':'Double strike','indestructible':'Indestructible','defender':'Defender'};
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
const PT_KEYS=Object.keys(PERMANENT_TARGET).sort((a,b)=>b.length-a.length).map(k=>k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
const DAMAGE_TARGET={'any target':'any','target creature':'creature','target player':'player','target opponent':'opponent','target player or planeswalker':'player','target opponent or planeswalker':'opponent','target creature or planeswalker':'creature','each opponent':'each-opponent','each creature':'each-creature','each player':'each-player','each creature and each player':'each-creature-player','each creature you don\'t control':'each-opponent-creature'};

function normalize(card){
 let t=String(card?.oracle_text||'');if(!t)return '';
 const name=String(card.name||'');
 const names=[name,...name.split(' // '),name.split(',')[0]].filter(n=>n&&n.length>2).sort((a,b)=>b.length-a.length);
 for(const n of names)t=t.split(n).join('~');
 return t.replace(/\([^)]*\)/g,'').replace(/\bthis (spell|creature|permanent|artifact|enchantment)\b/gi,'~').replace(/[ \t]+/g,' ').replace(/ +\n/g,'\n').trim();
}
function sentences(text){return text.split(/\n+/).flatMap(line=>line.split(/(?<=\.)\s+/)).map(s=>s.trim().replace(/\.$/,'').trim()).filter(Boolean);}
function tokenStep(count,p,t,desc,withText){
 const words=desc.split(/[ ,]+/).filter(w=>w&&w!=='and');const colors=[];const types=[];
 for(const w of words){if(COLOR_WORD[w])colors.push(COLOR_WORD[w]);else if(!['artifact','legendary','snow'].includes(w))types.push(w[0].toUpperCase()+w.slice(1));}
 const keywords=[];if(withText){for(const part of withText.split(/,\s*|\s+and\s+/)){const k=KEYWORD[part.trim()];if(!k)return null;keywords.push(k);}}
 if(count<1||count>20||p>20||t>20)return null;
 return {type:'token',count,power:p,toughness:t,name:(types.join(' ')||'Criatura'),colors:colors.filter(c=>c!=='C'),keywords};
}
// Devuelve una lista de pasos para una frase, o null si no se reconoce.
function parseSentence(raw){
 const s=raw.toLowerCase().replace(/’/g,"'");let m;
 if(/^(?:it|they) can't be regenerated$/.test(s))return [];
 if(/^~ costs \{\d+\} (?:less|more) to cast(?: for each [a-z ]+)?$/.test(s))return [];
 if(/^its controller gains life equal to its power$/.test(s))return [{type:'gainLife',amount:0,who:'target-controller',fromPower:true}];
 if((m=s.match(new RegExp('^its controller creates '+N+' (\\d+)/(\\d+) ([a-z ,]+?) creature tokens?(?: with ([a-z ,]+))?$')))){const t=tokenStep(num(m[1]),+m[2],+m[3],m[4],m[5]);return t?[{...t,who:'target-controller'}]:null;}
 if((m=s.match(new RegExp('^(?:you )?draw '+N+' cards?$'))))return [{type:'draw',count:num(m[1]),who:'you'}];
 if((m=s.match(new RegExp('^target player draws '+N+' cards?$'))))return [{type:'draw',count:num(m[1]),who:'target-player'}];
 if((m=s.match(new RegExp('^(?:you )?draw '+N+' cards? and (?:you )?lose (\\d+) life$'))))return [{type:'draw',count:num(m[1]),who:'you'},{type:'loseLife',amount:+m[2],who:'you'}];
 if((m=s.match(/^you gain (\d+) life$/)))return [{type:'gainLife',amount:+m[1]}];
 if((m=s.match(/^you lose (\d+) life$/)))return [{type:'loseLife',amount:+m[1],who:'you'}];
 if((m=s.match(/^each opponent loses (\d+) life$/)))return [{type:'loseLife',amount:+m[1],who:'each-opponent'}];
 if((m=s.match(/^each opponent loses (\d+) life and you gain (\d+) life$/)))return [{type:'loseLife',amount:+m[1],who:'each-opponent'},{type:'gainLife',amount:+m[2]}];
 if((m=s.match(/^target (player|opponent) loses (\d+) life$/)))return [{type:'loseLife',amount:+m[2],who:'target-'+m[1]}];
 if((m=s.match(/^target (player|opponent) loses (\d+) life and you gain (\d+) life$/)))return [{type:'loseLife',amount:+m[2],who:'target-'+m[1]},{type:'gainLife',amount:+m[3]}];
 if((m=s.match(/^~ deals (\d+) damage to (.+)$/))&&DAMAGE_TARGET[m[2]])return [{type:'damage',amount:+m[1],target:DAMAGE_TARGET[m[2]]}];
 if((m=s.match(/^destroy all (creatures|artifacts|enchantments|nonland permanents)$/)))return [{type:'wipe',what:m[1]}];
 if((m=s.match(new RegExp('^(destroy|exile) target ('+PT_KEYS+')$'))))return [{type:m[1],target:m[2]}];
 if((m=s.match(new RegExp("^return target ("+PT_KEYS+") to its owner's hand$"))))return [{type:'bounce',target:m[1]}];
 if((m=s.match(/^counter target (spell|noncreature spell|creature spell|instant or sorcery spell)$/)))return [{type:'counter',spell:m[1]}];
 if((m=s.match(new RegExp('^create '+N+' (\\d+)/(\\d+) ([a-z ,]+?) creature tokens?(?: with ([a-z ,]+))?$')))){const t=tokenStep(num(m[1]),+m[2],+m[3],m[4],m[5]);return t?[t]:null;}
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on target creature$'))))return [{type:'counters',count:num(m[1]),target:'creature'}];
 if((m=s.match(new RegExp('^put '+N+' \\+1/\\+1 counters? on each creature you control$'))))return [{type:'counters',count:num(m[1]),target:'each-own'}];
 if((m=s.match(/^(scry|surveil) (\d+)$/)))return [{type:'note',text:(m[1]==='scry'?'Adivina ':'Vigila ')+m[2]+': revisa las primeras cartas de tu biblioteca y ordénalas a mano.'}];
 if((m=s.match(new RegExp('^search your library for (?:up to '+N+' )?(?:a )?basic land cards?, (?:reveal (?:it|them|those cards), )?put (?:it|them|that card|those cards) (onto the battlefield tapped|onto the battlefield|into your hand), then shuffle$'))))return [{type:'ramp',count:m[1]?num(m[1]):1,to:m[2].includes('hand')?'hand':'battlefield',tapped:m[2].includes('tapped')}];
 if(/^search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle$/.test(s))return [{type:'ramp',count:1,to:'battlefield',tapped:true},{type:'ramp',count:1,to:'hand',tapped:false,noShuffle:true}];
 return null;
}
function bounded(steps){
 for(const st of steps){for(const k of ['count','amount','power','toughness'])if(k in st&&(!Number.isInteger(st[k])||st[k]<0||st[k]>(k==='count'?20:100)))return null;}
 return steps;
}
function parseLines(text){const out=[];for(const s of sentences(text)){const r=parseSentence(s);if(!r)return null;out.push(...r);}return out.length?bounded(out):null;}
const LEGACY_OK=e=>e&&((e.type==='draw'&&Number.isInteger(e.count)&&e.count>=0&&e.count<=10)||(['gainLife','damage'].includes(e.type)&&Number.isInteger(e.amount)&&e.amount>=0&&e.amount<=20));
function legacy(e){if(!LEGACY_OK(e))return null;if(e.type==='draw')return [{type:'draw',count:e.count,who:'you'}];if(e.type==='gainLife')return [{type:'gainLife',amount:e.amount}];return [{type:'damage',amount:e.amount,target:'player'}];}
const isSpellType=c=>/\b(Instant|Sorcery)\b/.test(c?.type_line||'');
// Efecto al resolver un instantáneo o conjuro.
function spellSteps(card){
 if(!card)return null;
 if(card.supportedEffect)return legacy(card.supportedEffect);
 if(!isSpellType(card)||card.card_faces?.length>1)return null;
 return parseLines(normalize(card));
}
// Habilidad "Cuando ~ entra" de un permanente. El resto de su texto sigue manual.
function etbSteps(card){
 if(!card||isSpellType(card)||card.card_faces?.length>1)return null;
 const text=normalize(card);if(!text)return null;
 for(const line of text.split(/\n+/)){const m=line.match(/^When ~ enters(?: the battlefield)?(?: under your control)?, (.+)$/i);if(m){const inner=m[1].replace(/^you may /i,'');if(/^you may/i.test(m[1]))return null;return parseLines(inner.charAt(0).toUpperCase()+inner.slice(1));}}
 return null;
}
function stepsFor(entryCard){return isSpellType(entryCard)||entryCard?.supportedEffect?spellSteps(entryCard):etbSteps(entryCard);}
// ¿Qué tipo de objetivo pide el paso? null si ninguno.
function targetKind(step){
 if(step.type==='damage')return ['any','creature','player','opponent'].includes(step.target)?step.target:null;
 if(step.type==='loseLife'||step.type==='draw')return step.who==='target-player'?'player':step.who==='target-opponent'?'opponent':null;
 if(['destroy','exile','bounce'].includes(step.type))return 'permanent';
 if(step.type==='counters'&&step.target==='creature')return 'creature';
 if(step.type==='counter')return 'spell';
 return null;
}
function permanentSpec(step){if(step.type==='counters')return PERMANENT_TARGET.creature;if(step.type==='damage')return PERMANENT_TARGET.creature;return PERMANENT_TARGET[step.target]||null;}
function matchesPermanent(card,spec,ownerId,controllerId){
 if(!spec||!card)return false;const type=card.type_line||'';
 if(spec.nonland&&/\bLand\b/.test(type))return false;
 if(spec.opponent&&ownerId===controllerId)return false;
 return spec.types.some(t=>new RegExp('\\b'+t+'\\b').test(type));
}
function matchesSpell(entry,kind){const t=entry?.card?.type_line||'';if(kind==='spell')return true;if(kind==='noncreature spell')return !/\bCreature\b/.test(t);if(kind==='creature spell')return /\bCreature\b/.test(t);if(kind==='instant or sorcery spell')return /\b(Instant|Sorcery)\b/.test(t);return false;}
// Habilidad de maná: {options:[colores], amount} o null si requiere decisión manual.
function manaAbility(card,player){
 if(!card)return null;const type=card.type_line||'';
 if(card.card_faces?.length>1)return null;
 if(/\bCreature\b/.test(type))return null;
 const isLand=/\bLand\b/.test(type);if(!isLand&&!/\bArtifact\b/.test(type))return null;
 const map={Plains:'W',Island:'U',Swamp:'B',Mountain:'R',Forest:'G'};
 const text=String(card.oracle_text||'').trim();
 if(isLand&&!text){
  const types=Object.keys(map).filter(t=>new RegExp('\\b'+t+'\\b').test(type));
  if(types.length)return {options:types.map(t=>map[t]),amount:1};
  if(card.name==='Wastes')return {options:['C'],amount:1};
  return null;
 }
 // Cada línea con {T} debe ser una habilidad de maná sencilla; si hay alguna rara, queda manual.
 const lines=text.split(/\n+/).map(l=>l.trim().replace(/^\((.*)\)$/,'$1'));const options=new Set();let amount=0;
 for(const line of lines){
  // Otras habilidades (entrar girada, sacrificar para robar…) no cambian lo que da al girarse.
  if(!/\bAdd\b/.test(line))continue;
  if(!/^\{T\}:/.test(line))return null;
  let m=line.match(/^\{T\}: Add ((?:\{[WUBRGC]\})+)\.$/);
  if(m){const sym=m[1].match(/[WUBRGC]/g);if(new Set(sym).size!==1)return null;if(amount&&amount!==sym.length)return null;amount=sym.length;options.add(sym[0]);continue;}
  m=line.match(/^\{T\}: Add (\{[WUBRGC]\}(?:, \{[WUBRGC]\})*,? or \{[WUBRGC]\})\.$/);
  if(m){if(amount&&amount!==1)return null;amount=1;for(const c of m[1].match(/[WUBRGC]/g))options.add(c);continue;}
  if(/^\{T\}: Add one mana of any color\.$/.test(line)){if(amount&&amount!==1)return null;amount=1;['W','U','B','R','G'].forEach(c=>options.add(c));continue;}
  if(/^\{T\}: Add one mana of any color in your commander's color identity\.$/.test(line.replace(/’/g,"'"))){if(amount&&amount!==1)return null;amount=1;const id=player?.command?.find(c=>c.isCommander)?.color_identity||player?.commanderIdentity||[];if(!id.length)options.add('C');else id.forEach(c=>options.add(c));continue;}
  return null;
 }
 if(!options.size||!amount)return null;
 // Una tierra que además hace otra cosa al girarse (dolor, contadores) ya habría fallado arriba.
 return {options:COLORS.filter(c=>options.has(c)),amount};
}
// Etiqueta en español de un paso, para la interfaz.
const TARGET_ES={'creature':'una criatura','creature an opponent controls':'una criatura rival',"creature you don't control":'una criatura que no controlas','artifact':'un artefacto','enchantment':'un encantamiento','artifact or enchantment':'un artefacto o encantamiento','creature or planeswalker':'una criatura o planeswalker','planeswalker':'un planeswalker','land':'una tierra','nonland permanent':'un permanente que no sea tierra',"nonland permanent you don't control":'un permanente rival que no sea tierra','nonland permanent an opponent controls':'un permanente rival que no sea tierra','permanent':'un permanente'};
const WIPE_ES={creatures:'todas las criaturas',artifacts:'todos los artefactos',enchantments:'todos los encantamientos','nonland permanents':'todos los permanentes que no sean tierra'};
const SPELL_ES={spell:'un hechizo','noncreature spell':'un hechizo que no sea de criatura','creature spell':'un hechizo de criatura','instant or sorcery spell':'un instantáneo o conjuro'};
function describe(step){
 const who={you:'Robas','target-player':'El jugador objetivo roba'};
 switch(step.type){
  case 'draw':return (who[step.who]||'Roba')+' '+step.count+' carta(s)';
  case 'gainLife':return 'Ganas '+step.amount+' vidas';
  case 'loseLife':return ({you:'Pierdes ','each-opponent':'Cada oponente pierde ','target-player':'El jugador objetivo pierde ','target-opponent':'El oponente objetivo pierde '}[step.who]||'Pierde ')+step.amount+' vidas';
  case 'damage':return step.amount+' de daño a '+({any:'un objetivo','creature':'una criatura',player:'un jugador',opponent:'un oponente','each-opponent':'cada oponente','each-creature':'cada criatura','each-player':'cada jugador','each-creature-player':'cada criatura y cada jugador','each-opponent-creature':'cada criatura rival'}[step.target]||'un objetivo');
  case 'destroy':return 'Destruye '+(TARGET_ES[step.target]||step.target);
  case 'exile':return 'Exilia '+(TARGET_ES[step.target]||step.target);
  case 'bounce':return 'Devuelve a la mano '+(TARGET_ES[step.target]||step.target);
  case 'wipe':return 'Destruye '+(WIPE_ES[step.what]||step.what);
  case 'counter':return 'Contrarresta '+(SPELL_ES[step.spell]||step.spell);
  case 'token':return 'Crea '+step.count+' ficha(s) '+step.power+'/'+step.toughness+' '+step.name;
  case 'counters':return step.count+' contador(es) +1/+1 '+(step.target==='each-own'?'en cada criatura tuya':'en una criatura');
  case 'ramp':return 'Busca '+step.count+' tierra(s) básica(s) '+(step.to==='hand'?'a tu mano':'al campo'+(step.tapped?' girada(s)':''));
  case 'note':return step.text;
 }
 return 'Efecto';
}
return {normalize,sentences,parseSentence,spellSteps,etbSteps,stepsFor,targetKind,permanentSpec,matchesPermanent,matchesSpell,manaAbility,describe,PERMANENT_TARGET};
});
