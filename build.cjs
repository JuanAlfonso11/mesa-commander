const fs=require('node:fs');
let page=fs.readFileSync('src/shell.html','utf8');
for(const [token,path] of Object.entries({STYLE:'style.css',EFFECTS:'effects.js',BOTS:'bots.js',CORE:'core.js',DATA:'data.js',NETWORK:'network.js',UI:'ui.js'}))page=page.replace('/*'+token+'*/',()=>fs.readFileSync('src/'+path,'utf8'));
page=page.replace('/*ART*/',()=> 'globalThis.MESA_ART='+fs.readFileSync('src/starter-art.json','utf8')+';');fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/index.html',page);console.log('Built public/index.html',Buffer.byteLength(page),'bytes');
