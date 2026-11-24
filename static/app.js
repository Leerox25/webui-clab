(() => {
'use strict';
const cy = cytoscape({container:document.getElementById('cy'), elements:[], layout:{name:'preset'}, minZoom:.2,maxZoom:3,wheelSensitivity:.2,
  style:[
    {selector:'node.equipment',style:{'label':'data(label)','width':64,'height':64,'shape':'round-rectangle','background-color':'#fff','background-image':'data(icon)','background-fit':'contain','background-position-x':'50%','background-position-y':'50%','background-clip':'node','border-width':2,'border-color':'data(color)','color':'#1c2b27','font-family':'system-ui, sans-serif','font-size':12,'font-weight':700,'text-valign':'bottom','text-halign':'center','text-margin-y':8,'text-background-color':'#fff','text-background-opacity':.85,'text-background-padding':2,'text-background-shape':'roundrectangle','shadow-blur':14,'shadow-color':'#0f2a2440','shadow-opacity':.8,'shadow-offset-y':3}},
    {selector:'node.shape-zone',style:{'label':'data(label)','shape':'rectangle','width':'data(w)','height':'data(h)','background-color':'#d9e8cf','background-opacity':.47,'border-width':1,'border-style':'dashed','border-color':'#8da98a','color':'#587055','font-family':'DM Mono, monospace','font-size':11,'text-valign':'top','text-halign':'left','text-margin-x':12,'text-margin-y':10,'z-index':-1,'events':'yes'}},
    {selector:'node.shape-text',style:{'label':'data(label)','shape':'rectangle','width':'label','height':24,'padding':'4px','background-opacity':0,'border-width':0,'color':'#43584c','font-family':'DM Mono, monospace','font-size':13,'font-weight':500,'text-valign':'center','text-halign':'center','z-index':1}},
    {selector:'edge',style:{'width':2.5,'line-color':'#8aa89a','target-arrow-shape':'none','curve-style':'bezier','line-cap':'round','source-label':'data(sp)','target-label':'data(tp)','source-text-offset':34,'target-text-offset':34,'font-size':9,'font-family':'ui-monospace, monospace','color':'#48625a','text-background-color':'#fff','text-background-opacity':.9,'text-background-padding':2,'text-background-shape':'roundrectangle'}},
    {selector:'node.equipment:selected',style:{'border-color':'#2f6bff','border-width':4}},{selector:'node.shape:selected',style:{'border-color':'#2f6bff','border-width':2}},{selector:'edge:selected',style:{'line-color':'#2f6bff','width':4}}
  ], userPanningEnabled:true, userBoxSelectionEnabled:true, boxSelectionEnabled:true, autounselectify:false});
const TYPES={router:{prefix:'r',color:'#0f766e',name:'Routeur'},switch:{prefix:'sw',color:'#d9772b',name:'Switch L2'},switch3:{prefix:'sw',color:'#b4521b',name:'Switch L3',base:'switch'},pc:{prefix:'pc',color:'#3b82a6',name:'PC'},server:{prefix:'srv',color:'#475569',name:'Serveur'}};
const svgIcon=(c,body)=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="-9 -9 66 66" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`);
const ICONS={
 router:c=>svgIcon(c,'<circle cx="24" cy="24" r="17"/><path d="M24 9v10M20 13l4-4 4 4M24 39V29M20 35l4 4 4-4M9 24h10M13 20l-4 4 4 4M39 24H29M35 20l4 4-4 4"/>'),
 switch:c=>svgIcon(c,'<rect x="5" y="14" width="38" height="20" rx="4"/><path d="M12 22h16M24 18l4 4-4 4M36 26H20M24 22l-4 4 4 4" transform="translate(0 -1)"/>'),
 switch3:c=>svgIcon(c,'<rect x="5" y="12" width="38" height="20" rx="4"/><path d="M12 20h16M24 16l4 4-4 4M36 24H20M24 20l-4 4 4 4" transform="translate(0 -1)"/><circle cx="37" cy="37" r="8.5" fill="white"/><text x="37" y="41.5" font-size="12" font-weight="800" text-anchor="middle" stroke="none" fill="'+c+'" font-family="sans-serif">3</text>'),
 pc:c=>svgIcon(c,'<rect x="7" y="8" width="34" height="23" rx="3"/><path d="M18 40h12M24 31v9"/>'),
 server:c=>svgIcon(c,'<rect x="9" y="6" width="30" height="11" rx="2"/><rect x="9" y="19" width="30" height="11" rx="2"/><rect x="9" y="32" width="30" height="10" rx="2"/><path d="M15 11.5h.01M15 24.5h.01M15 37h.01"/>')};
const iconFor=t=>ICONS[t](TYPES[t].color);
let tool='select', pending=null, serial={router:0,switch:0,pc:0,server:0,text:0,zone:0,edge:0},linkStart=null;
const stage=document.getElementById('stage'), preview=document.getElementById('preview'), toastEl=document.getElementById('toast');
const say=(s)=>{toastEl.textContent=s;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),2100)};
const slug=s=>String(s).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,48);
const TOOL_HINT={select:'Sélection — glissez pour déplacer, clic droit pour le menu',link:'Relier — cliquez sur deux équipements',text:'Texte — cliquez sur le plan',zone:'Zone — tracez un rectangle'};
function setTool(next){tool=next;pending=null;linkStart=null;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===next));document.getElementById('toolTag').textContent=TOOL_HINT[next]||TYPES[next]&&('Cliquez sur le plan pour poser : '+TYPES[next].name)||next;const zone=next==='zone';cy.autoungrabify(next==='link');cy.userPanningEnabled(!zone);cy.boxSelectionEnabled(!zone);stage.style.cursor=zone?'crosshair':next==='select'?'default':'crosshair';preview.style.display='none'}
document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
function rawState(){return{nodes:cy.nodes('.equipment').map(n=>{const o={id:n.id(),type:n.data('type'),x:n.position('x'),y:n.position('y')};if(n.data('type')==='switch')o.config=JSON.parse(JSON.stringify(n.data('config')||defaultSwitchConfig()));const ip=normalizeIpConfig(n.data('ip'));if(!ipIsEmpty(ip))o.ip=JSON.parse(JSON.stringify(ip));if(n.data('ospf'))o.ospf=JSON.parse(JSON.stringify(n.data('ospf')));if(n.data('vrrp'))o.vrrp=JSON.parse(JSON.stringify(n.data('vrrp')));if(n.data('portchannels'))o.portchannels=JSON.parse(JSON.stringify(n.data('portchannels')));if(n.data('bgp'))o.bgp=JSON.parse(JSON.stringify(n.data('bgp')));if(n.data('mpls'))o.mpls=JSON.parse(JSON.stringify(n.data('mpls')));if(n.data('ipsec'))o.ipsec=JSON.parse(JSON.stringify(n.data('ipsec')));return o}),links:cy.edges().map(e=>({source:e.data('source'),target:e.data('target')})),shapes:cy.nodes('.shape').map(n=>({id:n.id(),type:n.data('type'),label:n.data('label'),x:n.position('x'),y:n.position('y'),...(n.data('type')==='zone'?{w:n.data('w'),h:n.data('h')}:{})}))}}
function addState(s){cy.elements().remove();(s.shapes||[]).filter(x=>x.type==='zone').forEach(x=>cy.add({group:'nodes',data:{id:x.id,type:'zone',label:x.label,w:x.w||180,h:x.h||120},position:{x:x.x,y:x.y},classes:'shape shape-zone'}));(s.nodes||[]).forEach(x=>cy.add({group:'nodes',data:{id:x.id,type:x.type,label:x.id,icon:iconFor(x.type==='switch'&&x.l3?'switch3':x.type),color:TYPES[x.type==='switch'&&x.l3?'switch3':x.type].color,...(x.type==='switch'&&x.l3?{l3:true}:{}),...Object.fromEntries(['rip','eigrp','isis','l2'].filter(k=>x[k]).map(k=>[k,JSON.parse(JSON.stringify(x[k]))])),...(x.type==='switch'?{config:normalizeSwitchConfig(x.config)}:{}),...(x.ip?{ip:normalizeIpConfig(x.ip)}:{}),...(x.ospf?{ospf:normalizeOspfConfig(x.ospf)}:{}),...(x.vrrp?{vrrp:JSON.parse(JSON.stringify(x.vrrp))}:{}),...(x.portchannels?{portchannels:JSON.parse(JSON.stringify(x.portchannels))}:{}),...(x.bgp?{bgp:normalizeBgp(x.bgp)}:{}),...(x.mpls?{mpls:normalizeMpls(x.mpls)}:{}),...(x.ipsec?{ipsec:normalizeIpsec(x.ipsec)}:{})},position:{x:x.x,y:x.y},classes:`equipment ${x.type}`}));(s.shapes||[]).filter(x=>x.type==='text').forEach(x=>cy.add({group:'nodes',data:{id:x.id,type:'text',label:x.label},position:{x:x.x,y:x.y},classes:'shape shape-text'}));(s.links||[]).forEach(e=>{if(cy.getElementById(e.source).length&&cy.getElementById(e.target).length){let id;do{id=`edge${++serial.edge}`}while(cy.getElementById(id).length);cy.add({group:'edges',data:{id,source:e.source,target:e.target}})}});updateCounter()}
function updateCounter(){const nn=cy.nodes('.equipment').length,ne=cy.edges().length;document.getElementById('counter').textContent=`${nn} équipement${nn>1?'s':''} · ${ne} lien${ne>1?'s':''}`;document.getElementById('emptyHint').hidden=cy.nodes().length>0;document.getElementById('nodeList').replaceChildren(...cy.nodes('.equipment').map(n=>{const o=document.createElement('option');o.value=n.id();return o}))}
function addEquipment(type,pos){const base=TYPES[type].base||type,id=newId(base);const n=cy.add({group:'nodes',data:{id,type:base,label:id,icon:iconFor(type),color:TYPES[type].color,...(base==='switch'?{config:defaultSwitchConfig(),...(type==='switch3'?{l3:true}:{})}:{})},position:{x:pos.x,y:pos.y},classes:`equipment ${base}`});updateCounter();return n}
const kindPop=document.getElementById('kindPop');
function askSwitchKind(ev){return new Promise(resolve=>{const r=stage.getBoundingClientRect();kindPop.style.left=Math.max(8,Math.min(ev.clientX-r.left,r.width-190))+'px';kindPop.style.top=Math.max(8,Math.min(ev.clientY-r.top,r.height-110))+'px';kindPop.hidden=false;
 const done=v=>{kindPop.hidden=true;document.removeEventListener('pointerdown',away,true);document.removeEventListener('keydown',esc,true);kindPop.onclick=null;resolve(v)};
 const away=e=>{if(!kindPop.contains(e.target))done(null)},esc=e=>{if(e.key==='Escape'){e.stopPropagation();done(null)}};
 kindPop.onclick=e=>{const b=e.target.closest('button[data-k]');if(b)done(b.dataset.k)};document.addEventListener('pointerdown',away,true);document.addEventListener('keydown',esc,true)})}
async function placeEquipment(type,pos,ev){if(type==='switch'){type=await askSwitchKind(ev);if(!type)return null}return addEquipment(type,pos)}
function newId(t){t=TYPES[t].base||t;const prefix=TYPES[t].prefix;serial[t]++;let id;do{id=prefix+serial[t]}while(cy.getElementById(id).length);return id}
function modelAt(ev){const r=stage.getBoundingClientRect(), x=ev.clientX-r.left, y=ev.clientY-r.top, p=cy.pan(), z=cy.zoom();return{x:(x-p.x)/z,y:(y-p.y)/z,rx:x,ry:y}}
cy.on('tap',async ev=>{const target=ev.target;if(tool==='link'){if(target===cy||!target.hasClass('equipment'))return;if(!linkStart){linkStart=target.id();target.select();say('Choisissez le second nœud.')}else if(linkStart!==target.id()){const already=cy.edges().some(e=>(e.data('source')===linkStart&&e.data('target')===target.id())||(e.data('target')===linkStart&&e.data('source')===target.id()));if(!already){let id;do{id=`edge${++serial.edge}`}while(cy.getElementById(id).length);cy.add({group:'edges',data:{id,source:linkStart,target:target.id()}})}cy.$id(linkStart).unselect();target.unselect();linkStart=null;updateCounter();if(!keepLink(ev))setTool('select')}return}
 if(tool==='select'||tool==='zone')return;if(target!==cy&&target.hasClass('shape'))return;if(target!==cy&&target.hasClass('equipment'))return;
 const p=modelAt(ev.originalEvent||{clientX:stage.getBoundingClientRect().left+ev.renderedPosition.x,clientY:stage.getBoundingClientRect().top+ev.renderedPosition.y});
 if(TYPES[tool]){const nn=await placeEquipment(tool,p,ev.originalEvent);if(nn&&!(ev.originalEvent&&ev.originalEvent.shiftKey))setTool('select')}
 if(tool==='text'){const label=await ask('Texte à afficher','Mon texte');if(label&&label.trim()){let id;do{id=`txt${++serial.text}`}while(cy.getElementById(id).length);cy.add({group:'nodes',data:{id,type:'text',label:label.trim().slice(0,120)},position:{x:p.x,y:p.y},classes:'shape shape-text'});setTool('select')}}
});
cy.on('dbltap','node.shape-zone',async ev=>{const n=ev.target, size=await ask('Taille de la zone (largeur x hauteur)',`${Math.round(n.data('w'))}x${Math.round(n.data('h'))}`);if(!size)return;const m=size.trim().match(/^(\d+(?:\.\d+)?)\s*[x×, ]\s*(\d+(?:\.\d+)?)$/i);if(!m){say('Format attendu : largeur x hauteur');return}const w=Number(m[1]),h=Number(m[2]);if(w<20||h<20||w>3000||h>3000){say('Dimensions autorisées : 20 à 3000 px.');return}n.data({w,h})});
const point=(ev)=>{const r=stage.getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top}};
stage.addEventListener('pointerdown',ev=>{if(tool!=='zone'||ev.target.closest('button'))return;ev.preventDefault();stage.setPointerCapture(ev.pointerId);const p=point(ev);pending={x:p.x,y:p.y};preview.style.left=`${p.x}px`;preview.style.top=`${p.y}px`;preview.style.width='0';preview.style.height='0';preview.style.display='block'});
stage.addEventListener('pointermove',ev=>{if(!pending)return;const p=point(ev),x=Math.min(p.x,pending.x),y=Math.min(p.y,pending.y);preview.style.left=`${x}px`;preview.style.top=`${y}px`;preview.style.width=`${Math.abs(p.x-pending.x)}px`;preview.style.height=`${Math.abs(p.y-pending.y)}px`});
stage.addEventListener('pointerup',async ev=>{if(!pending)return;const p=point(ev),start=pending;pending=null;preview.style.display='none';const w=Math.abs(p.x-start.x),h=Math.abs(p.y-start.y);if(w<20||h<20)return;const label=await ask('Nom de la zone','ZONE');if(!label)return;const a=modelAt({clientX:stage.getBoundingClientRect().left+Math.min(start.x,p.x),clientY:stage.getBoundingClientRect().top+Math.min(start.y,p.y)}),z=cy.zoom();let id;do{id=`zone${++serial.zone}`}while(cy.getElementById(id).length);cy.add({group:'nodes',data:{id,type:'zone',label:label.trim().slice(0,120)||'ZONE',w:w/z,h:h/z},position:{x:a.x+w/z/2,y:a.y+h/z/2},classes:'shape shape-zone'});cy.nodes('.shape-zone').forEach(n=>n.move({zIndex:0}))});
function defaultSwitchConfig(){return{stp:true,priority:32768,ports:{},vlans:[]}}
function normalizeSwitchConfig(cfg){const c=cfg&&typeof cfg==='object'?cfg:{};return{stp:c.stp!==false,priority:Number.isInteger(Number(c.priority))?Math.max(0,Math.min(61440,Number(c.priority))):32768,ports:c.ports&&typeof c.ports==='object'?JSON.parse(JSON.stringify(c.ports)):{},vlans:Array.isArray(c.vlans)?JSON.parse(JSON.stringify(c.vlans)):[]}}
function parseVlans(text){const out=[];String(text||'').split(/[\s,;]+/).filter(Boolean).forEach(tok=>{const m=tok.match(/^(\d+)\s*-\s*(\d+)$/);if(m){const a=Number(m[1]),b=Number(m[2]);if(a<=b)for(let v=a;v<=b;v++)out.push(v)}else{const n=Number(tok);if(Number.isInteger(n))out.push(n)}});return[...new Set(out)].sort((a,b)=>a-b)}
function allPortsFor(id){const counts={};const ports=[];cy.edges().forEach(e=>{['source','target'].forEach(side=>{const nodeId=e.data(side);counts[nodeId]=(counts[nodeId]||0)+1;if(nodeId===id)ports.push(`eth${counts[nodeId]}`)})});return ports}
function lagMembers(node){const lags=node.data('portchannels');return new Set(Array.isArray(lags)?lags.flatMap(l=>l.members||[]):[])}
function routedPorts(node){return node.data('type')==='switch'&&node.data('l3')?new Set(normalizeIpConfig(node.data('ip')).ifaces.filter(i=>/^(eth\d+|bond\d+)$/.test(i.dev)&&!i.vlan&&!i.gre).map(i=>i.dev)):new Set()}
function portsForSwitch(id){const node=cy.getElementById(id),all=portsAll(id);if(!node||!node.length)return all;const r=routedPorts(node);return all.filter(p=>!r.has(p))}
function portsAll(id){const node=cy.getElementById(id);const physical=allPortsFor(id);if(!node||!node.length)return physical;const members=lagMembers(node);const lags=Array.isArray(node.data('portchannels'))?node.data('portchannels').map(l=>l.name).filter(Boolean):[];return physical.filter(p=>!members.has(p)).concat(lags)}
function updateSwitchConfig(node,cfg){node.data('config',cfg)}
function renderSwitchPanel(){const panel=document.getElementById('switchPanel'),controls=document.getElementById('switchControls'),name=document.getElementById('switchName');const node=cy.nodes('.equipment.switch:selected').first();controls.replaceChildren();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();const cfg=normalizeSwitchConfig(node.data('config'));updateSwitchConfig(node,cfg);
 const stpRow=document.createElement('div');stpRow.className='switch-row';stpRow.innerHTML='<label for="switchStp">STP (Spanning Tree)</label><select id="switchStp"><option value="true">Activé</option><option value="false">Désactivé</option></select>';const stp=stpRow.querySelector('select');stp.value=String(cfg.stp);stp.addEventListener('change',()=>{cfg.stp=stp.value==='true';updateSwitchConfig(node,cfg)});controls.append(stpRow);
 const prioRow=document.createElement('div');prioRow.className='switch-row';prioRow.innerHTML='<label for="switchPriority">Priorité STP (pas de 4096)</label><select id="switchPriority"></select>';const prio=prioRow.querySelector('select');for(let value=0;value<=61440;value+=4096){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);prio.append(option)}const snapped=Math.max(0,Math.min(61440,Math.round(cfg.priority/4096)*4096));cfg.priority=snapped;prio.value=String(snapped);prio.addEventListener('change',()=>{cfg.priority=Number(prio.value);updateSwitchConfig(node,cfg)});controls.append(prioRow);
 const ports=portsForSwitch(node.id());if(!ports.length){const empty=document.createElement('div');empty.className='switch-row';empty.textContent='Aucun lien : les paramètres de ports apparaîtront après connexion.';empty.style.fontSize='9px';empty.style.color='#718078';controls.append(empty)}
 ports.forEach(port=>{const pc=cfg.ports[port]||{mode:'access',vlan:1};const row=document.createElement('div');row.className='switch-row switch-port';const title=document.createElement('div');title.className='port-name';title.textContent=port;row.append(title);const mode=document.createElement('select');mode.setAttribute('aria-label',`${port} mode`);mode.innerHTML='<option value="access">Access</option><option value="trunk">Trunk</option>';mode.value=pc.mode==='trunk'?'trunk':'access';row.append(mode);const value=document.createElement('input');value.setAttribute('aria-label',mode.value==='trunk'?`${port} VLAN trunk`:`${port} VLAN access`);value.placeholder=mode.value==='trunk'?'VLANs, ex. 10-20,30':'VLAN';if(mode.value==='trunk')value.value=(pc.vlans||[]).join(',');else{value.type='number';value.min='1';value.max='4094';value.value=pc.vlan||1}row.append(value);
  let native=null;
  if(mode.value==='trunk'){native=document.createElement('input');native.type='number';native.min='1';native.max='4094';native.setAttribute('aria-label',`${port} VLAN natif`);native.placeholder='VLAN natif (non taggé)';native.value=pc.native||'';row.append(native)}
 const savePort=()=>{if(mode.value==='trunk'){const vlans=parseVlans(value.value);if(!vlans.length||vlans.some(v=>!Number.isInteger(v)||v<1||v>4094)){say('VLAN trunk : entrez une liste de VLANs de 1 à 4094.');return}const item={mode:'trunk',vlans};const nv=native&&native.value.trim();if(nv){const n=Number(nv);if(!Number.isInteger(n)||n<1||n>4094){say('VLAN natif : valeur de 1 à 4094.');return}if(vlans.includes(n)){say('Le VLAN natif '+n+' ne doit pas être aussi taggé.');return}item.native=n}cfg.ports[port]=item}else{const vlan=Number(value.value);if(!Number.isInteger(vlan)||vlan<1||vlan>4094){say('VLAN access : valeur autorisée de 1 à 4094.');return}cfg.ports[port]={mode:'access',vlan}}updateSwitchConfig(node,cfg)};
 mode.addEventListener('change',()=>{const prior=cfg.ports[port]||{mode:'access',vlan:1};if(mode.value==='trunk'){const item={mode:'trunk',vlans:prior.mode==='trunk'&&prior.vlans&&prior.vlans.length?prior.vlans:[prior.vlan||1]};if(prior.native)item.native=prior.native;cfg.ports[port]=item}else{cfg.ports[port]={mode:'access',vlan:prior.mode==='access'?prior.vlan:((prior.vlans&&prior.vlans[0])||1)}}updateSwitchConfig(node,cfg);renderSwitchPanel()});value.addEventListener('change',savePort);if(native)native.addEventListener('change',savePort);controls.append(row)});
 const vlanBlock=ipBlock('Base VLAN locale');
 cfg.vlans.forEach((entry,index)=>{const row=document.createElement('div');row.className='ip-row';row.append(ipHead('VLAN '+(entry.id||'?')+(entry.name?' · '+entry.name:''),()=>{cfg.vlans.splice(index,1);updateSwitchConfig(node,cfg);renderSwitchPanel()}));row.append(numField('VLAN 1-4094',entry.id,v=>{entry.id=Number(v)},1,4094));row.append(ipField('Nom (ex. BUREAU)',entry.name,v=>{if(v)entry.name=v;else delete entry.name}));vlanBlock.append(row)});
 const vlanAdd=document.createElement('button');vlanAdd.className='ip-add';vlanAdd.textContent='+ Déclarer un VLAN';vlanAdd.addEventListener('click',()=>{cfg.vlans.push({id:1,name:''});updateSwitchConfig(node,cfg);renderSwitchPanel()});vlanBlock.append(vlanAdd);controls.append(vlanBlock);
}
function defaultIpConfig(){return{ifaces:[],loopback:[],routes:[]}}
function normalizeIpConfig(cfg){const c=cfg&&typeof cfg==='object'?cfg:{};const out={ifaces:Array.isArray(c.ifaces)?c.ifaces:[],loopback:Array.isArray(c.loopback)?c.loopback:[],routes:Array.isArray(c.routes)?c.routes:[]};if(c.dhcpServer&&typeof c.dhcpServer==='object')out.dhcpServer=c.dhcpServer;return out}
function ipConfigFor(node){const ip=normalizeIpConfig(node.data('ip'));node.data('ip',ip);return ip}
function ipIsEmpty(ip){return!(ip.ifaces.length||ip.loopback.length||ip.routes.length||ip.dhcpServer)}
function candidateDevices(node){if(node.data('type')==='switch')return node.data('l3')?['br0',...portsAll(node.id())]:['br0'];const p=portsForSwitch(node.id());return p.length?p:['eth1']}
function ipField(ph,value,onchange,wide){const el=document.createElement('input');el.placeholder=ph;el.value=value===undefined||value===null?'':String(value);if(wide)el.className='ip-wide';el.addEventListener('change',()=>onchange(el.value.trim()));return el}
function ipBlock(title){const b=document.createElement('div');b.className='ip-block';const t=document.createElement('label');t.textContent=title;b.append(t);return b}
function ipDelete(handler){const b=document.createElement('button');b.className='ip-del';b.textContent='suppr';b.title='Supprimer';b.addEventListener('click',handler);return b}
function ipHead(text,handler){const h=document.createElement('div');h.className='ip-dev';const s=document.createElement('span');s.textContent=text;h.append(s,ipDelete(handler));return h}
// ---- Capacités par type d'équipement ----
const kindOf=n=>n.data('type')==='switch'?(n.data('l3')?'switch3':'switch2'):n.data('type');
const typeKey=n=>n.data('type')==='switch'&&n.data('l3')?'switch3':n.data('type');
const CAPS={
 router:new Set(['iface','vlansub','gre','loopback','routes','dhcpServer','ospf','bgp','mpls','vrrp','ipsec','lag','rip','eigrp','isis']),
 switch2:new Set(['iface','svi','lag','switching','l2']),
 switch3:new Set(['iface','svi','loopback','routes','dhcpServer','ospf','bgp','vrrp','lag','switching','l2','rip','eigrp']),
 pc:new Set(['iface','routes']),
 server:new Set(['iface','vlansub','loopback','routes','dhcpServer','lag'])};
const can=(n,f)=>CAPS[kindOf(n)].has(f);
const PCAP={ipPanel:'iface',routesPanel:'routes',dhcpPanel:'dhcpServer',switchPanel:'switching',lagPanel:'lag',ospfPanel:'ospf',bgpPanel:'bgp',mplsPanel:'mpls',vrrpPanel:'vrrp',ipsecPanel:'ipsec',ripPanel:'rip',eigrpPanel:'eigrp',isisPanel:'isis',l2Panel:'l2'};
function applyCaps(){const n=cy.nodes('.equipment:selected').first();Object.entries(PCAP).forEach(([id,f])=>{if(!n.length||!can(n,f))document.getElementById(id).hidden=true})}
// l'état envoyé au backend ne contient que ce que le type d'équipement sait faire
function getState(){const s=rawState();s.nodes.forEach(o=>{const n=cy.getElementById(o.id);if(o.type==='switch'&&n.data('l3'))o.l3=true;[['ospf','ospf'],['bgp','bgp'],['mpls','mpls'],['vrrp','vrrp'],['ipsec','ipsec'],['portchannels','lag']].forEach(([k,f])=>{if(!can(n,f))delete o[k]});['rip','eigrp','isis','l2'].forEach(k=>{const v=n.data(k);if(v&&can(n,k))o[k]=JSON.parse(JSON.stringify(v))});
 if(o.ip){if(!can(n,'routes'))delete o.ip.routes;if(!can(n,'dhcpServer'))delete o.ip.dhcpServer;if(!can(n,'loopback'))delete o.ip.loopback;if(!can(n,'gre'))o.ip.ifaces=(o.ip.ifaces||[]).filter(i=>!i.gre);if(ipIsEmpty(normalizeIpConfig(o.ip)))delete o.ip}});return s}
function macGen(){const used=new Set();cy.nodes('.equipment').forEach(n=>((n.data('ip')||{}).ifaces||[]).forEach(i=>i.mac&&used.add(String(i.mac).toLowerCase())));let m;do{m='02:'+Array.from({length:5},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join(':')}while(used.has(m));return m}
const lf=(label,input,cls)=>{const w=document.createElement('label');w.className='lf'+(cls?' '+cls:'');const s=document.createElement('span');s.textContent=label;w.append(s,input);return w};
const hintDiv=t=>{const d=document.createElement('div');d.className='ip-hint';d.textContent=t;return d};
function portNeighbor(id,port){for(const e of cy.edges()){if(e.data('source')===id&&e.data('sp')===port)return{id:e.data('target'),port:e.data('tp')};if(e.data('target')===id&&e.data('tp')===port)return{id:e.data('source'),port:e.data('sp')}}return null}
function ifaceHead(dev,sub,del){const h=document.createElement('div');h.className='ip-dev';const s=document.createElement('span');const b=document.createElement('b');b.textContent=dev;const sm=document.createElement('small');sm.textContent=sub;s.append(b,sm);h.append(s,ipDelete(del));return h}
function selectField(options,value,onchange){const s=document.createElement('select');const vals=options.includes(value)||!value?options:[value,...options];vals.forEach(o=>{const e=document.createElement('option');e.value=o;e.textContent=o;s.append(e)});s.value=value||vals[0]||'';s.addEventListener('change',()=>onchange(s.value));return s}
function detailsBox(title){const d=document.createElement('details');d.className='ip-more';const sm=document.createElement('summary');sm.textContent=title;d.append(sm);return d}
function renderIpPanel(){
 const ids=['ip','routes','dhcp'],P=Object.fromEntries(ids.map(k=>[k,document.getElementById(k+'Panel')])),C=Object.fromEntries(ids.map(k=>[k,document.getElementById(k+'Controls')]));
 ids.forEach(k=>C[k].replaceChildren());
 const node=cy.nodes('.equipment:selected').first();
 if(!node||!node.length){ids.forEach(k=>P[k].hidden=true);return}
 ids.forEach(k=>{P[k].hidden=false;document.getElementById(k+'Name').textContent=node.id()});
 const ip=ipConfigFor(node),isSw=node.data('type')==='switch',devs=candidateDevices(node);
 // ----- Interfaces -----
 const ifaces=ipBlock('Interfaces configurées');
 if(!ip.ifaces.length)ifaces.append(hintDiv('Aucune interface configurée. Ajoutez un port ci-dessous pour lui donner une adresse.'));
 ip.ifaces.forEach((iface,index)=>{const card=document.createElement('div');card.className='ip-row iface-card';const nb=portNeighbor(node.id(),iface.dev);
  const sub=iface.gre?'tunnel GRE':iface.vlan?`VLAN ${iface.vlan.id} sur ${iface.vlan.parent}`:nb?`${isSw?'port routé ':''}→ ${nb.id} (${nb.port})`:(iface.dev==='br0'?'gestion du switch':'non relié');
  card.append(ifaceHead(iface.dev,sub,()=>{ip.ifaces.splice(index,1);renderIpPanel()}));
  if(iface.gre){card.append(lf('Adresse locale',ipField('10.0.0.1',iface.gre.local,v=>{iface.gre.local=v})),lf('Adresse distante',ipField('10.2.0.2',iface.gre.remote,v=>{iface.gre.remote=v})),lf('TTL (option)',numField('64',iface.gre.ttl,v=>{if(v)iface.gre.ttl=Number(v);else delete iface.gre.ttl},1,255)),lf('Clé GRE (option)',numField('',iface.gre.key,v=>{if(v)iface.gre.key=Number(v);else delete iface.gre.key},0,4294967295)))}
  else{const dh=document.createElement('label');dh.className='ip-check ip-wide';const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!iface.dhcp;cb.addEventListener('change',()=>{iface.dhcp=cb.checked;if(cb.checked){delete iface.ipv4;delete iface.ipv6}renderIpPanel()});dh.append(cb,document.createTextNode('Adresse automatique (client DHCP)'));card.append(dh);
   if(!iface.dhcp){card.append(lf('Adresse IPv4',ipField('10.0.0.1/24',iface.ipv4,v=>{if(v)iface.ipv4=v;else delete iface.ipv4})),lf('Adresse IPv6',ipField('2001:db8::1/64',iface.ipv6,v=>{if(v)iface.ipv6=v;else delete iface.ipv6})))}
   const mac=ipField('aa:bb:cc:dd:ee:ff',iface.mac,v=>{if(v)iface.mac=v;else delete iface.mac});const mw=document.createElement('div');mw.className='macrow';const gen=document.createElement('button');gen.type='button';gen.className='ip-del gen';gen.textContent='↻ nouvelle';gen.title='Générer une adresse MAC unique';gen.onclick=()=>{iface.mac=macGen();renderIpPanel()};mw.append(mac,gen);card.append(lf('Adresse MAC',mw,'ip-wide'),lf('MTU (option)',numField('1500',iface.mtu,v=>{if(v)iface.mtu=Number(v);else delete iface.mtu})));card.append(linkBox(iface))}
  ifaces.append(card)});
 C.ip.append(ifaces);
 // ----- Ajout -----
 const add=ipBlock('Ajouter');const free=devs.filter(d=>!ip.ifaces.some(x=>x.dev===d));
 if(free.length){const chips=document.createElement('div');chips.className='chip-row';free.forEach(d=>{const nb=portNeighbor(node.id(),d);const b=document.createElement('button');b.type='button';b.className='chip-btn';b.textContent='+ '+d+(nb?' → '+nb.id:'');b.title='Ajouter l\'interface '+d+' (adresse MAC générée)';b.onclick=()=>{ip.ifaces.push({dev:d,mac:macGen()});renderIpPanel()};chips.append(b)});add.append(chips)}
 else add.append(hintDiv(isSw?'L\'interface de gestion br0 est déjà configurée.':'Tous les ports connectés sont configurés. Reliez d\'autres équipements pour en obtenir.'));
 if(can(node,'vlansub')){const box=detailsBox('Sous-interface VLAN (802.1Q)');const row=document.createElement('div');row.className='ip-row';const par=selectField(devs,devs[0],()=>{}),vid=numField('1-4094','',()=>{},1,4094);const go=document.createElement('button');go.type='button';go.className='ip-add ip-wide';go.textContent='+ Créer la sous-interface';go.onclick=()=>{const id=Number(vid.value);if(!Number.isInteger(id)||id<1||id>4094){say('VLAN attendu entre 1 et 4094.');return}const dev=`${par.value}.${id}`;if(ip.ifaces.some(x=>x.dev===dev)){say('Cette interface est déjà configurée.');return}ip.ifaces.push({dev,vlan:{parent:par.value,id},mac:macGen()});renderIpPanel()};row.append(lf('Interface parente',par),lf('VLAN',vid),go);box.append(row);add.append(box)}
 if(can(node,'svi')){const b=document.createElement('button');b.type='button';b.className='ip-add';b.textContent='+ SVI : interface virtuelle d\'un VLAN (br0.<vlan>)';b.onclick=async()=>{const raw=await ask('VLAN de la SVI (1-4094)','');if(!raw)return;const id=Number(raw.trim());if(!Number.isInteger(id)||id<1||id>4094){say('VLAN attendu entre 1 et 4094.');return}const dev='br0.'+id;if(ip.ifaces.some(x=>x.dev===dev)){say('Cette SVI est déjà configurée.');return}ip.ifaces.push({dev,vlan:{parent:'br0',id},mac:macGen()});renderIpPanel()};add.append(b)}
 if(can(node,'gre')){const box=detailsBox('Tunnel GRE');const row=document.createElement('div');row.className='ip-row';const nm=ipField('gre1','gre1',()=>{}),lo=ipField('10.0.0.1','',()=>{}),re=ipField('10.2.0.2','',()=>{}),ttl=numField('option','',()=>{},1,255),key=numField('option','',()=>{},0,4294967295);const go=document.createElement('button');go.type='button';go.className='ip-add ip-wide';go.textContent='+ Créer le tunnel';go.onclick=()=>{const dev=nm.value.trim();if(!dev){say('Nom du tunnel requis.');return}if(ip.ifaces.some(x=>x.dev===dev)){say('Cette interface est déjà configurée.');return}const t={local:lo.value.trim(),remote:re.value.trim()};if(ttl.value.trim())t.ttl=Number(ttl.value.trim());if(key.value.trim())t.key=Number(key.value.trim());ip.ifaces.push({dev,gre:t});renderIpPanel()};row.append(lf('Nom',nm),lf('Adresse locale',lo),lf('Adresse distante',re),lf('TTL',ttl),lf('Clé',key),go);box.append(row);add.append(box)}
 C.ip.append(add);
 if(can(node,'loopback')){const lo=ipBlock('Loopback');lo.append(hintDiv('Adresse stable du nœud (ex. router-id). Une par ligne.'));const ta=document.createElement('textarea');ta.rows=2;ta.className='ip-wide';ta.placeholder='10.255.0.1/32';ta.value=ip.loopback.join('\n');ta.addEventListener('change',()=>{ip.loopback=ta.value.split(/\s+/).filter(Boolean)});lo.append(ta);C.ip.append(lo)}
 // ----- Routes statiques -----
 const routes=ipBlock('Routes configurées');routes.append(hintDiv('Une route dit par où envoyer le trafic vers un réseau. 0.0.0.0/0 est la route par défaut (passerelle).'));
 ip.routes.forEach((route,index)=>{const row=document.createElement('div');row.className='ip-row';row.append(ipHead(route.dst==='0.0.0.0/0'?'route par défaut':'route '+(index+1),()=>{ip.routes.splice(index,1);renderIpPanel()}),lf('Réseau de destination',ipField('0.0.0.0/0',route.dst,v=>{route.dst=v})),lf('Passerelle (via)',ipField('10.0.0.254',route.via,v=>{if(v)route.via=v;else delete route.via})),lf('Interface (option)',ipField('eth1',route.dev,v=>{if(v)route.dev=v;else delete route.dev})),lf('Métrique (route flottante)',numField('ex. 200',route.metric,v=>{if(v)route.metric=Number(v);else delete route.metric},1,65535)));routes.append(row)});
 const rb=document.createElement('div');rb.className='chip-row';[['+ Route par défaut',{dst:'0.0.0.0/0',via:''}],['+ Route vers un réseau',{dst:'',via:''}]].forEach(([t,r])=>{const b=document.createElement('button');b.type='button';b.className='chip-btn';b.textContent=t;b.onclick=()=>{ip.routes.push({...r});renderIpPanel()};rb.append(b)});routes.append(rb);C.routes.append(routes);
 // ----- Serveur DHCP -----
 const ds=ipBlock('Serveur DHCP (dnsmasq)');const dc=document.createElement('label');dc.className='ip-check';const dcb=document.createElement('input');dcb.type='checkbox';dcb.checked=!!ip.dhcpServer;dcb.addEventListener('change',()=>{if(dcb.checked)ip.dhcpServer={dev:devs[0],range:''};else delete ip.dhcpServer;renderIpPanel()});dc.append(dcb,document.createTextNode('Ce nœud distribue des adresses DHCP'));ds.append(dc);
 if(ip.dhcpServer){const row=document.createElement('div');row.className='ip-row';const d=ip.dhcpServer;row.append(lf('Interface d\'écoute',selectField(devs,d.dev,v=>{d.dev=v})),lf('Plage (début,fin)',ipField('10.0.0.100,10.0.0.200',d.range,v=>{d.range=v})),lf('Passerelle annoncée',ipField('10.0.0.1',d.router,v=>{if(v)d.router=v;else delete d.router})),lf('DNS annoncé',ipField('1.1.1.1',d.dns,v=>{if(v)d.dns=v;else delete d.dns})));ds.append(row)}
 C.dhcp.append(ds);
  if(isSw)renderSwitchPanel();
 applyCaps()}

// ---- Options avancées (programme CCNP) ----
const selPairs=(pairs,value,onchange)=>{const s=document.createElement('select');pairs.forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o)});s.value=value||'';s.addEventListener('change',()=>onchange(s.value));return s};
function redistBlock(c,opts,title){const b=ipBlock(title||'Redistribution');const w=document.createElement('div');w.className='ip-members';opts.forEach(o=>w.append(chk(o,(c.redistribute||[]).includes(o),on=>{const s=new Set(c.redistribute||[]);on?s.add(o):s.delete(o);c.redistribute=[...s]})));b.append(w);return b}
function protoPanel(prefix,key,enableLabel,hint,defaults,body){const render=()=>{const panel=document.getElementById(prefix+'Panel'),controls=document.getElementById(prefix+'Controls'),name=document.getElementById(prefix+'Name');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 controls.append(chk(enableLabel,!!node.data(key),v=>{node.data(key,v?defaults(node):null);render();renderSummary()}));
 if(!node.data(key)){controls.append(hintDiv(hint));applyCaps();return}
 body(node,node.data(key),controls,render);applyCaps()};return render}
const netArea=(label,list,set)=>lf(label,textArea('10.0.0.0/24',(list||[]).join('\n'),v=>set(parseList(v))),'ip-wide');
const renderRipPanel=protoPanel('rip','rip','Activer RIP v2 sur ce nœud','RIP : vecteur de distance, métrique = nombre de sauts (15 max). Annoncez les réseaux directement connectés.',()=>({networks:[],passive:[],redistribute:[],defaultOriginate:false}),
 (node,c,controls)=>{const b=ipBlock('Réseaux');b.append(netArea('Réseaux annoncés (un par ligne)',c.networks,v=>{c.networks=v}),netArea('Interfaces passives (une par ligne)',c.passive,v=>{c.passive=v}),chk('Annoncer une route par défaut (default-information originate)',c.defaultOriginate,v=>{c.defaultOriginate=v}));controls.append(b,redistBlock(c,['connected','static','ospf','bgp']))});
const renderEigrpPanel=protoPanel('eigrp','eigrp','Activer EIGRP sur ce nœud','EIGRP (démon eigrpd de FRR) : expérimental, certaines fonctions Cisco peuvent manquer. Tous les voisins doivent partager le même numéro d\'AS.',()=>({asn:100,routerId:'',networks:[],passive:[],redistribute:[]}),
 (node,c,controls)=>{const b=ipBlock('Processus');const g=document.createElement('div');g.className='ip-row';g.append(lf('Numéro d\'AS (1-65535)',numField('100',c.asn,v=>{c.asn=Number(v)},1,65535)),lf('Router-id (option)',ipField('1.1.1.1',c.routerId,v=>{c.routerId=v})),lf('Variance (équilibrage à coûts inégaux)',numField('1',c.variance,v=>{if(v)c.variance=Number(v);else delete c.variance},1,128)));b.append(g,netArea('Réseaux annoncés (un par ligne)',c.networks,v=>{c.networks=v}),netArea('Interfaces passives (une par ligne)',c.passive,v=>{c.passive=v}));controls.append(b,redistBlock(c,['connected','static','ospf','bgp']))});
const renderIsisPanel=protoPanel('isis','isis','Activer IS-IS sur ce nœud','IS-IS : état de liens sur CLNS. Le NET identifie le routeur (49.<aire>.<system-id>.00) : il doit être unique dans le domaine.',
 n=>({tag:'LAB',net:'49.0001.0000.0000.'+(parseInt(String(n.id()).replace(/\D/g,'')||'1',10)%65536).toString(16).padStart(4,'0')+'.00',level:'level-2-only',loopback:true,redistribute:[],interfaces:[]}),
 (node,c,controls,re)=>{const b=ipBlock('Processus');const g=document.createElement('div');g.className='ip-row';g.append(lf('Nom du processus',ipField('LAB',c.tag,v=>{c.tag=v})),lf('NET',ipField('49.0001.0000.0000.0001.00',c.net,v=>{c.net=v})),lf('Niveau',selPairs([['level-2-only','Level-2 seul'],['level-1','Level-1 seul'],['level-1-2','Level-1-2']],c.level,v=>{c.level=v})));b.append(g,chk('Annoncer la loopback (passive)',c.loopback!==false,v=>{c.loopback=v}));controls.append(b,redistBlock(c,['connected','static'],'Redistribution (niveau selon le type)'));
 const ib=ipBlock('Interfaces');(c.interfaces||[]).forEach((it,i)=>{const row=document.createElement('div');row.className='ip-row';row.append(ipHead(it.dev,()=>{c.interfaces.splice(i,1);re()}),lf('Métrique',numField('10',it.metric,v=>{if(v)it.metric=Number(v);else delete it.metric},1,16777214)),chk('Point à point',it.network==='point-to-point',v=>{if(v)it.network='point-to-point';else delete it.network}),chk('Passive',it.passive,v=>{if(v)it.passive=true;else delete it.passive}));ib.append(row)});
 const free=candidateDevices(node).filter(d=>d!=='br0'&&!(c.interfaces||[]).some(x=>x.dev===d));if(free.length){const chips=document.createElement('div');chips.className='chip-row';free.forEach(d=>{const bt=document.createElement('button');bt.type='button';bt.className='chip-btn';bt.textContent='+ '+d;bt.onclick=()=>{(c.interfaces=c.interfaces||[]).push({dev:d});re()};chips.append(bt)});ib.append(chips)}else if(!(c.interfaces||[]).length)ib.append(hintDiv('Reliez ce nœud pour activer IS-IS sur ses interfaces.'));controls.append(ib)});
// OSPF : options avancées (dans le panneau OSPF existant)
function ospfAdvanced(node,c){const box=detailsBox('Options avancées (CCNP)');const g=document.createElement('div');g.className='ip-row';
 g.append(lf('Auto-cost reference-bandwidth (Mbit/s)',numField('100',c.autoCostRef,v=>{if(v)c.autoCostRef=Number(v);else delete c.autoCostRef},1,4294967)),lf('Route par défaut (default-information originate)',selPairs([['','Non'],['on','Si présente'],['always','Toujours (always)']],c.defaultOriginate||'',v=>{if(v)c.defaultOriginate=v;else delete c.defaultOriginate})));box.append(g);
 const rb=redistBlock(c,['connected','static','bgp','rip','eigrp']);box.append(rb);
 const ab=ipBlock('Type des aires');(c.areas||[]).forEach(area=>{ab.append(lf('Aire '+area.id,selPairs([['','Normale'],['stub','Stub'],['totally-stub','Totally stubby'],['nssa','NSSA'],['totally-nssa','Totally NSSA']],area.type||'',v=>{if(v)area.type=v;else delete area.type})))});box.append(ab);
 const io=ipBlock('Options par interface');c.ifOptions=c.ifOptions||{};const devs=candidateDevices(node).filter(d=>d!=='br0');if(!devs.length)io.append(hintDiv('Reliez ce nœud pour régler OSPF par interface.'));
 devs.forEach(dev=>{const o=c.ifOptions[dev]=c.ifOptions[dev]||{};const row=document.createElement('div');row.className='ip-row';const clean=()=>{c.ifOptions[dev]=o;Object.keys(o).forEach(k=>{if(o[k]===''||o[k]===undefined||o[k]===false)delete o[k]});if(!Object.keys(o).length)delete c.ifOptions[dev]};
  const ni=(label,key,max)=>lf(label,numField('',o[key],v=>{o[key]=v===''?'':Number(v);clean()},0,max));
  row.append(ipHead(dev,()=>{delete c.ifOptions[dev];renderOspfPanel()}),lf('Type de réseau',selPairs([['','Par défaut'],['point-to-point','Point à point'],['broadcast','Broadcast']],o.network||'',v=>{o.network=v;clean()})),ni('Hello (s)','hello',65535),ni('Dead (s)','dead',65535),ni('Priorité DR (0 = jamais DR)','priority',255),lf('Clé MD5 (authentification)',ipField('mot-de-passe',o.authKey,v=>{o.authKey=v;clean()})),chk('BFD (détection rapide de panne)',o.bfd,v=>{o.bfd=v;clean()}));io.append(row)});
 box.append(io);return box}
// STP / L2 avancé
const renderL2Panel=()=>{const panel=document.getElementById('l2Panel'),controls=document.getElementById('l2Controls'),name=document.getElementById('l2Name');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 const c=JSON.parse(JSON.stringify(node.data('l2')||{}));c.ports=c.ports||{};
 const commit=()=>{const o={};['ageing','hello','forwardDelay','maxAge'].forEach(k=>{if(c[k]!==''&&c[k]!==undefined&&c[k]!==null)o[k]=Number(c[k])});if(c.mcastSnooping){o.mcastSnooping=true;if(c.mcastQuerier)o.mcastQuerier=true}const ports={};Object.entries(c.ports).forEach(([d,p])=>{const q={};['cost','priority'].forEach(k=>{if(p[k]!==''&&p[k]!==undefined&&p[k]!==null)q[k]=Number(p[k])});if(p.rootGuard)q.rootGuard=true;if(p.bpduGuard)q.bpduGuard=true;if(Object.keys(q).length)ports[d]=q});if(Object.keys(ports).length)o.ports=ports;node.data('l2',Object.keys(o).length?o:null);renderSummary()};
 const nf=(label,key,min,max,ph)=>lf(label,numField(ph||'',c[key],v=>{c[key]=v;commit()},min,max));
 const b=ipBlock('Bridge');const g=document.createElement('div');g.className='ip-row';g.append(nf('Vieillissement MAC (s)','ageing',10,1000000,'300'),nf('STP hello-time (s)','hello',1,10,'2'),nf('STP forward-delay (s)','forwardDelay',4,30,'15'),nf('STP max-age (s)','maxAge',6,40,'20'));b.append(hintDiv('Les timers STP vont ensemble : renseignez-les tous ou aucun. Contrainte : max-age ≥ 2×(hello+1) et ≤ 2×(forward-delay−1).'),g,chk('IGMP snooping (limite le multicast aux ports intéressés)',c.mcastSnooping,v=>{c.mcastSnooping=v;commit();renderL2Panel()}));if(c.mcastSnooping)b.append(chk('Querier IGMP (émet les requêtes en l\'absence de routeur multicast)',c.mcastQuerier,v=>{c.mcastQuerier=v;commit()}));controls.append(b);
 const pb=ipBlock('STP par port');const ports=portsForSwitch(node.id());if(!ports.length)pb.append(hintDiv('Reliez ce switch pour régler STP port par port.'));
 ports.forEach(p=>{const o=c.ports[p]=c.ports[p]||{};const row=document.createElement('div');row.className='ip-row';row.append(ipHead(p,()=>{delete c.ports[p];commit();renderL2Panel()}),lf('Coût',numField('',o.cost,v=>{o.cost=v;commit()},1,200000000)),lf('Priorité (0-63)',numField('32',o.priority,v=>{o.priority=v;commit()},0,63)),chk('Root guard',o.rootGuard,v=>{o.rootGuard=v;commit()}),chk('BPDU guard',o.bpduGuard,v=>{o.bpduGuard=v;commit()}));pb.append(row)});
 pb.append(hintDiv('Pas de PortFast ni de RSTP/MSTP : le STP du noyau Linux est de type 802.1D classique.'));controls.append(pb);applyCaps()};
function linkBox(iface){const box=detailsBox('Simulation de lien (délai, perte, débit)'+(iface.link?' ●':''));const row=document.createElement('div');row.className='ip-row';iface.link=iface.link||{};const L=iface.link;const prune=()=>{iface.link=L;Object.keys(L).forEach(k=>{if(L[k]===''||L[k]===undefined)delete L[k]});if(!Object.keys(L).length)delete iface.link};
 const f=(label,key,ph,min,max,step)=>{const i=numField(ph,L[key],v=>{L[key]=v===''?'':Number(v);prune()},min,max);if(step)i.step=step;return lf(label,i)};
 row.append(f('Délai (ms)','delay','20',0,60000),f('Gigue (ms)','jitter','5',0,60000),f('Perte (%)','loss','1',0,100,'0.1'),f('Débit (kbit/s)','rate','10000',8,10000000));box.append(row);prune();return box}
function renderPanels(){renderSwitchPanel();renderIpPanel();renderOspfPanel();renderVrrpPanel();renderLagPanel();renderBgpPanel();renderMplsPanel();renderIpsecPanel();renderRipPanel();renderEigrpPanel();renderIsisPanel();renderL2Panel();applyCaps();markActive()}
function ipsecDefaults(){return{connections:[{name:'vpn-1',localAddrs:'',remoteAddrs:'',localId:'',remoteId:'',psk:'',localTs:'',remoteTs:'',proposals:'aes256-sha256-modp2048',espProposals:'aes256-sha256',startAction:'trap'}]}}
function normalizeIpsec(c){const o=c&&typeof c==='object'?c:{};return{connections:Array.isArray(o.connections)?o.connections:[]}}
function renderIpsecPanel(){const panel=document.getElementById('ipsecPanel'),controls=document.getElementById('ipsecControls'),name=document.getElementById('ipsecName');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 controls.append(chk('Activer IPsec (tunnels IKEv2) sur ce nœud',!!node.data('ipsec'),v=>{node.data('ipsec',v?ipsecDefaults():null);renderIpsecPanel()}));
 if(!node.data('ipsec')){const h=document.createElement('div');h.className='ip-hint';h.textContent='Tunnel site-à-site : les deux passerelles doivent déclarer les mêmes identités, la même clé partagée et des sélecteurs de trafic symétriques (votre réseau local en local_ts, celui du pair en remote_ts).';controls.append(h);return}
 const s=normalizeIpsec(node.data('ipsec'));node.data('ipsec',s);
 const blk=ipBlock('Connexions');
 s.connections.forEach((conn,index)=>{const row=document.createElement('div');row.className='ip-row';
  row.append(bgpEntryHead('tunnel '+(conn.name||'?'),()=>{s.connections.splice(index,1);renderIpsecPanel()}));
  row.append(ipField('Nom ex. vers-site-b',conn.name,v=>{conn.name=v},true));
  row.append(ipField('Adresse locale ex. 10.99.0.11',conn.localAddrs,v=>{conn.localAddrs=v}));
  row.append(ipField('Adresse distante ex. 10.99.0.12',conn.remoteAddrs,v=>{conn.remoteAddrs=v}));
  row.append(ipField('Identité locale ex. gw-a',conn.localId,v=>{conn.localId=v}));
  row.append(ipField('Identité distante ex. gw-b',conn.remoteId,v=>{conn.remoteId=v}));
  row.append(ipField('Clé partagée (PSK)',conn.psk,v=>{conn.psk=v},true));
  row.append(ipField('Sélecteur local ex. 10.1.0.0/24',conn.localTs,v=>{conn.localTs=v},true));
  row.append(ipField('Sélecteur distant ex. 10.2.0.0/24',conn.remoteTs,v=>{conn.remoteTs=v},true));
  row.append(ipField('Proposition IKE',conn.proposals,v=>{conn.proposals=v}));
  row.append(ipField('Proposition ESP',conn.espProposals,v=>{conn.espProposals=v}));
  const act=document.createElement('div');act.className='ip-members ip-wide';
  const lbl=document.createElement('span');lbl.textContent='Amorçage';lbl.style.font='9px DM Mono, monospace';lbl.style.color='#718078';
  act.append(lbl,sel(['trap','start','none'],conn.startAction||'trap',v=>{conn.startAction=v}));
  row.append(act);
  blk.append(row)});
 const add=document.createElement('button');add.className='ip-add';add.textContent='+ Ajouter une connexion';
 add.addEventListener('click',()=>{s.connections.push({name:'vpn-'+(s.connections.length+1),localAddrs:'',remoteAddrs:'',localId:'',remoteId:'',psk:'',localTs:'',remoteTs:'',proposals:'aes256-sha256-modp2048',espProposals:'aes256-sha256',startAction:'trap'});renderIpsecPanel()});
 blk.append(add);controls.append(blk);
 const hint=document.createElement('div');hint.className='ip-hint';hint.textContent='Contrôle : swanctl --list-sas (état ESTABLISHED et compteurs du CHILD SA).';
 controls.append(hint)}
function mplsDefaults(){return{ldp:{routerId:'',transportAddress:'',interfaces:[]}}}
function normalizeMpls(c){const o=c&&typeof c==='object'?c:{};const l=o.ldp&&typeof o.ldp==='object'?o.ldp:{};return{ldp:{routerId:l.routerId||'',transportAddress:l.transportAddress||'',interfaces:Array.isArray(l.interfaces)?l.interfaces:[]}}}
function renderMplsPanel(){const panel=document.getElementById('mplsPanel'),controls=document.getElementById('mplsControls'),name=document.getElementById('mplsName');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 controls.append(chk('Activer MPLS (LDP) sur ce nœud',!!node.data('mpls'),v=>{node.data('mpls',v?mplsDefaults():null);renderMplsPanel()}));
 if(!node.data('mpls')){const h=document.createElement('div');h.className='ip-hint';h.textContent='MPLS/LDP distribue des étiquettes pour les préfixes appris par l’IGP : configurez aussi OSPF sur ce nœud, avec une loopback comme router-id.';controls.append(h);return}
 const m=normalizeMpls(node.data('mpls'));node.data('mpls',m);
 const blk=ipBlock('LDP');
 const row=document.createElement('div');row.className='ip-row';
 row.append(ipField('Router-id (adresse de loopback) ex. 1.1.1.1',m.ldp.routerId,v=>{m.ldp.routerId=v}));
 row.append(ipField('Adresse de transport (défaut : router-id)',m.ldp.transportAddress,v=>{m.ldp.transportAddress=v}));
 const ports=document.createElement('div');ports.className='ip-members ip-wide';
 const avail=allPortsFor(node.id());
 avail.forEach(p=>ports.append(chk(p,m.ldp.interfaces.includes(p),on=>{m.ldp.interfaces=on?m.ldp.interfaces.concat([p]):m.ldp.interfaces.filter(x=>x!==p)})));
 if(!avail.length){const e=document.createElement('div');e.className='ip-hint';e.textContent='Aucun lien sur ce nœud : MPLS ne peut pas être activé sur une interface.';ports.append(e)}
 row.append(ports);blk.append(row);controls.append(blk);
 const hint=document.createElement('div');hint.className='ip-hint';hint.textContent='Contrôle : vtysh -c "show mpls ldp neighbor" pour les sessions, ip -f mpls route show pour le LFIB.';
 controls.append(hint)}
function sel(options,value,onchange,aria){const s=document.createElement('select');if(aria)s.setAttribute('aria-label',aria);options.forEach(o=>{const t=document.createElement('option');t.value=o;t.textContent=o===''?'(aucun)':o;s.append(t)});s.value=value||'';s.addEventListener('change',()=>onchange(s.value));return s}
function chk(label,checked,onchange){const l=document.createElement('label');l.className='ip-check';const c=document.createElement('input');c.type='checkbox';c.checked=!!checked;c.addEventListener('change',()=>onchange(c.checked));l.append(c,document.createTextNode(label));return l}
function bgpDefaults(){return{asn:65001,routerId:'',networks:[],redistribute:[],neighbors:[],prefixLists:[],communityLists:[],routeMaps:[]}}
function normalizeBgp(c){const o=Object.assign(bgpDefaults(),c&&typeof c==='object'?c:{});['networks','redistribute','neighbors','prefixLists','communityLists','routeMaps'].forEach(k=>{o[k]=Array.isArray(o[k])?o[k]:[]});return o}
function bgpEntryHead(label,onDel){const h=document.createElement('div');h.className='ip-dev';const s=document.createElement('span');s.textContent=label;h.append(s,ipDelete(onDel));return h}
function renderBgpPanel(){const panel=document.getElementById('bgpPanel'),controls=document.getElementById('bgpControls'),name=document.getElementById('bgpName');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 controls.append(chk('Activer BGP sur ce nœud',!!node.data('bgp'),v=>{node.data('bgp',v?bgpDefaults():null);renderBgpPanel()}));
 if(!node.data('bgp')){const h=document.createElement('div');h.className='ip-hint';h.textContent='BGP annonce les préfixes listés (ou redistribués) vers les voisins déclarés. Chaque voisin doit être joignable en IP depuis ce nœud.';controls.append(h);return}
 const b=normalizeBgp(node.data('bgp'));node.data('bgp',b);
 const sys=ipBlock('Système autonome');const sysRow=document.createElement('div');sysRow.className='ip-row';
 sysRow.append(numField('AS local',b.asn,v=>{b.asn=Number(v)},1,4294967295));
 sysRow.append(ipField('Router-id (option)',b.routerId,v=>{b.routerId=v}));
 sys.append(sysRow);controls.append(sys);
 const ann=ipBlock('Annonces');ann.append(textArea('Réseaux annoncés, un par ligne (ex. 1.1.1.1/32)',b.networks.join('\n'),v=>{b.networks=parseList(v)}));
 const redist=document.createElement('div');redist.className='ip-members';
 ['connected','static','ospf'].forEach(k=>redist.append(chk(k,b.redistribute.includes(k),on=>{b.redistribute=on?b.redistribute.concat([k]).filter((x,i,a)=>a.indexOf(x)===i):b.redistribute.filter(x=>x!==k)})));
 ann.append(redist);controls.append(ann);
 const nbs=ipBlock('Voisins');
 b.neighbors.forEach((nb,i)=>{const row=document.createElement('div');row.className='ip-row';
  row.append(bgpEntryHead('voisin '+(nb.ip||'?'),()=>{b.neighbors.splice(i,1);renderBgpPanel()}));
  row.append(ipField('IP du voisin ex. 10.0.0.2',nb.ip,v=>{nb.ip=v}));
  row.append(numField('AS distant',nb.remoteAs,v=>{nb.remoteAs=Number(v)},1,4294967295));
  row.append(ipField('Description',nb.description,v=>{if(v)nb.description=v;else delete nb.description},true));
  row.append(sel([''].concat(allPortsFor(node.id())),nb.updateSource||'',v=>{if(v)nb.updateSource=v;else delete nb.updateSource},'update-source'));
  row.append(numField('Multihop 2-255',nb.multihop,v=>{if(v)nb.multihop=Number(v);else delete nb.multihop},2,255));
  row.append(numField('Keepalive',nb.keepalive,v=>{if(v)nb.keepalive=Number(v);else delete nb.keepalive},0,65535));
  row.append(numField('Hold',nb.hold,v=>{if(v)nb.hold=Number(v);else delete nb.hold},0,65535));
  const flags=document.createElement('div');flags.className='ip-members ip-wide';
  flags.append(chk('next-hop-self',nb.nextHopSelf,on=>{nb.nextHopSelf=on}));
  flags.append(chk('route-reflector-client',nb.routeReflectorClient,on=>{nb.routeReflectorClient=on}));
  flags.append(chk('send-community',nb.sendCommunity,on=>{nb.sendCommunity=on}));
  row.append(flags);
  const rmNames=[''].concat(b.routeMaps.map(r=>r.name).filter(Boolean));
  const rmRow=document.createElement('div');rmRow.className='ip-members ip-wide';
  const inL=document.createElement('span');inL.textContent='route-map in';inL.style.font='9px DM Mono, monospace';inL.style.color='#718078';
  const outL=document.createElement('span');outL.textContent='out';outL.style.font='9px DM Mono, monospace';outL.style.color='#718078';
  rmRow.append(inL,sel(rmNames,nb.routeMapIn||'',v=>{if(v)nb.routeMapIn=v;else delete nb.routeMapIn},'route-map in'),outL,sel(rmNames,nb.routeMapOut||'',v=>{if(v)nb.routeMapOut=v;else delete nb.routeMapOut},'route-map out'));
  row.append(rmRow);nbs.append(row)});
 const addNb=document.createElement('button');addNb.className='ip-add';addNb.textContent='+ Ajouter un voisin';
 addNb.addEventListener('click',()=>{b.neighbors.push({ip:'',remoteAs:b.asn===65001?65002:65001});renderBgpPanel()});
 nbs.append(addNb);controls.append(nbs);
 const pls=ipBlock('Prefix-lists');
 b.prefixLists.forEach((pl,pi)=>{const row=document.createElement('div');row.className='ip-row';
  row.append(bgpEntryHead('prefix-list '+(pl.name||'?'),()=>{b.prefixLists.splice(pi,1);renderBgpPanel()}));
  row.append(ipField('Nom ex. PL-ANNOUNCE',pl.name,v=>{pl.name=v},true));
  pl.entries=pl.entries||[];
  pl.entries.forEach((e,ei)=>{const sub=document.createElement('div');sub.className='ip-row ip-wide';
   sub.append(bgpEntryHead('entrée '+(ei+1),()=>{pl.entries.splice(ei,1);renderBgpPanel()}));
   sub.append(numField('seq',e.seq,v=>{e.seq=Number(v)},1));
   sub.append(sel(['permit','deny'],e.action||'permit',v=>{e.action=v}));
   sub.append(ipField('Préfixe ex. 10.0.0.0/24',e.prefix,v=>{e.prefix=v},true));
   sub.append(numField('ge',e.ge,v=>{if(v)e.ge=Number(v);else delete e.ge},0,32));
   sub.append(numField('le',e.le,v=>{if(v)e.le=Number(v);else delete e.le},0,32));
   row.append(sub)});
  const addE=document.createElement('button');addE.className='ip-add ip-wide';addE.textContent='+ entrée';
  addE.addEventListener('click',()=>{pl.entries.push({seq:10,action:'permit',prefix:''});renderBgpPanel()});
  row.append(addE);pls.append(row)});
 const addPl=document.createElement('button');addPl.className='ip-add';addPl.textContent='+ Ajouter une prefix-list';
 addPl.addEventListener('click',()=>{b.prefixLists.push({name:'PL-'+(b.prefixLists.length+1),entries:[{seq:10,action:'permit',prefix:''}]});renderBgpPanel()});
 pls.append(addPl);controls.append(pls);
 const cls=ipBlock('Community-lists');
 b.communityLists.forEach((cl,ci)=>{const row=document.createElement('div');row.className='ip-row';
  row.append(bgpEntryHead('community-list '+(cl.name||'?'),()=>{b.communityLists.splice(ci,1);renderBgpPanel()}));
  row.append(ipField('Nom ex. CL-100',cl.name,v=>{cl.name=v},true));
  cl.entries=cl.entries||[];
  cl.entries.forEach((e,ei)=>{const sub=document.createElement('div');sub.className='ip-row ip-wide';
   sub.append(bgpEntryHead('entrée '+(ei+1),()=>{cl.entries.splice(ei,1);renderBgpPanel()}));
   sub.append(numField('seq',e.seq,v=>{e.seq=Number(v)},1));
   sub.append(sel(['permit','deny'],e.action||'permit',v=>{e.action=v}));
   sub.append(ipField('Communauté ex. 65001:100',e.community,v=>{e.community=v},true));
   row.append(sub)});
  const addE=document.createElement('button');addE.className='ip-add ip-wide';addE.textContent='+ entrée';
  addE.addEventListener('click',()=>{cl.entries.push({seq:5,action:'permit',community:''});renderBgpPanel()});
  row.append(addE);cls.append(row)});
 const addCl=document.createElement('button');addCl.className='ip-add';addCl.textContent='+ Ajouter une community-list';
 addCl.addEventListener('click',()=>{b.communityLists.push({name:'CL-'+(b.communityLists.length+1),entries:[{seq:5,action:'permit',community:''}]});renderBgpPanel()});
 cls.append(addCl);controls.append(cls);
 const rms=ipBlock('Route-maps');
 b.routeMaps.forEach((rm,ri)=>{const row=document.createElement('div');row.className='ip-row';
  row.append(bgpEntryHead('route-map '+(rm.name||'?'),()=>{b.routeMaps.splice(ri,1);renderBgpPanel()}));
  row.append(ipField('Nom ex. RM-OUT',rm.name,v=>{rm.name=v},true));
  rm.entries=rm.entries||[];
  const plNames=[''].concat(b.prefixLists.map(p=>p.name).filter(Boolean));
  const clNames=[''].concat(b.communityLists.map(c=>c.name).filter(Boolean));
  rm.entries.forEach((e,ei)=>{const sub=document.createElement('div');sub.className='ip-row ip-wide';
   sub.append(bgpEntryHead('entrée '+(ei+1),()=>{rm.entries.splice(ei,1);renderBgpPanel()}));
   sub.append(numField('seq',e.seq,v=>{e.seq=Number(v)},1));
   sub.append(sel(['permit','deny'],e.action||'permit',v=>{e.action=v}));
   sub.append(sel(plNames,e.matchPrefixList||'',v=>{if(v)e.matchPrefixList=v;else delete e.matchPrefixList},'match prefix-list'));
   sub.append(sel(clNames,e.matchCommunity||'',v=>{if(v)e.matchCommunity=v;else delete e.matchCommunity},'match community'));
   sub.append(numField('set local-pref',e.setLocalPreference,v=>{if(v)e.setLocalPreference=Number(v);else delete e.setLocalPreference},0,4294967295));
   sub.append(numField('set metric',e.setMed,v=>{if(v)e.setMed=Number(v);else delete e.setMed},0,4294967295));
   sub.append(ipField('set community',e.setCommunity,v=>{if(v)e.setCommunity=v;else delete e.setCommunity}));
   sub.append(numField('prepend AS x',e.setAsPathPrepend,v=>{if(v)e.setAsPathPrepend=Number(v);else delete e.setAsPathPrepend},1,10));
   row.append(sub)});
  const addE=document.createElement('button');addE.className='ip-add ip-wide';addE.textContent='+ entrée';
  addE.addEventListener('click',()=>{rm.entries.push({seq:10,action:'permit'});renderBgpPanel()});
  row.append(addE);rms.append(row)});
 const addRm=document.createElement('button');addRm.className='ip-add';addRm.textContent='+ Ajouter une route-map';
 addRm.addEventListener('click',()=>{b.routeMaps.push({name:'RM-'+(b.routeMaps.length+1),entries:[{seq:10,action:'permit'}]});renderBgpPanel()});
 rms.append(addRm);controls.append(rms)}
function renderLagPanel(){const panel=document.getElementById('lagPanel'),controls=document.getElementById('lagControls'),name=document.getElementById('lagName');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 const head=document.createElement('label');head.className='ip-check';const cb=document.createElement('input');cb.type='checkbox';cb.checked=Array.isArray(node.data('portchannels'))&&node.data('portchannels').length>0;
 cb.addEventListener('change',()=>{node.data('portchannels',cb.checked?[{name:'bond0',mode:'802.3ad',members:allPortsFor(node.id()).slice(0,2)}]:null);renderPanels()});
 head.append(cb,document.createTextNode('Agréger des liens sur ce nœud (EtherChannel)'));controls.append(head);
 if(!node.data('portchannels')){const hint=document.createElement('div');hint.className='ip-hint';hint.textContent='L’agrégation (LACP 802.3ad, active-backup…) regroupe plusieurs liens vers un même voisin en un port logique. Configurez la même agrégation des deux côtés.';controls.append(hint);return}
 const list=node.data('portchannels'),avail=allPortsFor(node.id());
 const block=ipBlock('Agrégations');
 list.forEach((lag,index)=>{const row=document.createElement('div');row.className='ip-row';row.append(ipHead(`${lag.name||'?'} · ${lag.mode||''}`,()=>{list.splice(index,1);if(!list.length)node.data('portchannels',null);renderPanels()}));
  row.append(ipField('Nom ex. bond0',lag.name,v=>{lag.name=v}));
  const mode=document.createElement('select');mode.setAttribute('aria-label','Mode');['802.3ad','active-backup','balance-rr','balance-xor'].forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;mode.append(o)});mode.value=lag.mode||'802.3ad';mode.addEventListener('change',()=>{lag.mode=mode.value;renderPanels()});row.append(mode);
  const wrap=document.createElement('div');wrap.className='ip-wide ip-members';const taken=new Set(list.filter((l,i)=>i!==index).flatMap(l=>l.members||[]));
  avail.forEach(p=>{const lab=document.createElement('label');lab.className='ip-check';const c=document.createElement('input');c.type='checkbox';c.checked=(lag.members||[]).includes(p);c.disabled=taken.has(p);c.addEventListener('change',()=>{const cur=new Set(lag.members||[]);if(c.checked)cur.add(p);else cur.delete(p);lag.members=avail.filter(x=>cur.has(x));renderPanels()});lab.append(c,document.createTextNode(p));wrap.append(lab)});
  row.append(wrap);block.append(row)});
 const add=document.createElement('button');add.className='ip-add';add.textContent='+ Ajouter une agrégation';add.addEventListener('click',()=>{list.push({name:`bond${list.length}`,mode:'802.3ad',members:[]});renderPanels()});
 block.append(add);controls.append(block)}
function numField(ph,value,onchange,min,max,wide){const el=document.createElement('input');el.type='number';if(min!==undefined)el.min=String(min);if(max!==undefined)el.max=String(max);el.placeholder=ph;el.value=value===undefined||value===null?'':String(value);if(wide)el.className='ip-wide';el.addEventListener('change',()=>onchange(el.value));return el}
function renderVrrpPanel(){const panel=document.getElementById('vrrpPanel'),controls=document.getElementById('vrrpControls'),name=document.getElementById('vrrpName');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 const head=document.createElement('label');head.className='ip-check';const cb=document.createElement('input');cb.type='checkbox';cb.checked=Array.isArray(node.data('vrrp'))&&node.data('vrrp').length>0;
 cb.addEventListener('change',()=>{node.data('vrrp',cb.checked?[{dev:candidateDevices(node)[0],vrid:10,priority:100,preempt:true,ipv4:[]}]:null);renderVrrpPanel()});
 head.append(cb,document.createTextNode('Activer VRRP sur ce nœud'));controls.append(head);
 if(!node.data('vrrp')){const hint=document.createElement('div');hint.className='ip-hint';hint.textContent='VRRP partage une adresse virtuelle entre plusieurs routeurs : configurez la même instance sur au moins deux nœuds du même segment.';controls.append(hint);return}
 const list=node.data('vrrp');const devs=candidateDevices(node);
 const block=ipBlock('Instances VRRP');
 list.forEach((inst,index)=>{const row=document.createElement('div');row.className='ip-row';row.append(ipHead(`VRID ${inst.vrid||'?'} · ${inst.dev||'?'}`,()=>{list.splice(index,1);if(!list.length)node.data('vrrp',null);renderVrrpPanel()}));
  const devSel=document.createElement('select');devSel.setAttribute('aria-label','Interface');devs.forEach(d=>{const o=document.createElement('option');o.value=d;o.textContent=d;devSel.append(o)});if(inst.dev&&!devs.includes(inst.dev)){const o=document.createElement('option');o.value=inst.dev;o.textContent=inst.dev;devSel.append(o)}devSel.value=inst.dev||devs[0];devSel.addEventListener('change',()=>{inst.dev=devSel.value});row.append(devSel);
  row.append(numField('VRID 1-255',inst.vrid,v=>{inst.vrid=Number(v)},1,255));
  row.append(numField('Priorité 1-254',inst.priority,v=>{inst.priority=Number(v)},1,254));
  const preempt=document.createElement('label');preempt.className='ip-check';const pc=document.createElement('input');pc.type='checkbox';pc.checked=inst.preempt!==false;pc.addEventListener('change',()=>{inst.preempt=pc.checked});preempt.append(pc,document.createTextNode('Preempt'));row.append(preempt);
  row.append(textArea('Adresses virtuelles, une par ligne avec préfixe (ex. 10.10.0.254/24)',(inst.ipv4||[]).join('\n'),v=>{inst.ipv4=parseList(v)}));
  block.append(row)});
 const add=document.createElement('button');add.className='ip-add';add.textContent='+ Ajouter une instance';
 add.addEventListener('click',()=>{list.push({dev:devs[0],vrid:10,priority:100,preempt:true,ipv4:[]});renderVrrpPanel()});
 block.append(add);controls.append(block)}
function normalizeOspfConfig(cfg){const c=cfg&&typeof cfg==='object'?cfg:{};return{...c,routerId:c.routerId||'',areas:Array.isArray(c.areas)?c.areas:[],costs:c.costs&&typeof c.costs==='object'?c.costs:{}}}
function parseList(v){return String(v||'').split(/[\s,;]+/).filter(Boolean)}
function parseCosts(v){const out={};parseList(v).forEach(pair=>{const p=pair.split('=');if(p.length===2&&p[0]&&p[1]&&Number.isFinite(Number(p[1])))out[p[0].trim()]=Number(p[1])});return out}
function costsToString(c){return Object.entries(c||{}).map(([k,v])=>`${k}=${v}`).join(', ')}
function textArea(ph,value,onchange){const el=document.createElement('textarea');el.rows=2;el.className='ip-wide';el.placeholder=ph;el.value=value||'';el.addEventListener('change',()=>onchange(el.value));return el}
function renderOspfPanel(){const panel=document.getElementById('ospfPanel'),controls=document.getElementById('ospfControls'),name=document.getElementById('ospfName');controls.replaceChildren();const node=cy.nodes('.equipment:selected').first();if(!node||!node.length){panel.hidden=true;return}panel.hidden=false;name.textContent=node.id();
 const head=document.createElement('label');head.className='ip-check';const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!node.data('ospf');
 cb.addEventListener('change',()=>{node.data('ospf',cb.checked?{routerId:'',areas:[{id:'0.0.0.0',networks:[],passive:[]}],costs:{}}:null);renderOspfPanel()});
 head.append(cb,document.createTextNode('Activer OSPF sur ce nœud'));controls.append(head);
 if(!node.data('ospf')){const hint=document.createElement('div');hint.className='ip-hint';hint.textContent='OSPF annonce les réseaux listés sur les interfaces qui les portent : configurez d’abord l’adressage IP.';controls.append(hint);return}
 const c=normalizeOspfConfig(node.data('ospf'));node.data('ospf',c);
 const ridRow=document.createElement('div');ridRow.className='ip-block';const ridLabel=document.createElement('label');ridLabel.textContent='Router-id (optionnel)';ridRow.append(ridLabel,ipField('ex. 10.255.0.1',c.routerId,v=>{c.routerId=v},true));controls.append(ridRow);
 const areasBlock=ipBlock('Aires OSPF');
 c.areas.forEach((area,index)=>{const row=document.createElement('div');row.className='ip-row';row.append(ipHead(`aire ${index+1}`,()=>{c.areas.splice(index,1);renderOspfPanel()}));row.append(ipField('Aire ex. 0.0.0.0',area.id,v=>{area.id=v},true));row.append(textArea('Réseaux annoncés, un par ligne (ex. 10.0.0.0/24)',(area.networks||[]).join('\n'),v=>{area.networks=parseList(v)}));row.append(textArea('Interfaces passives, une par ligne (ex. eth1)',(area.passive||[]).join('\n'),v=>{area.passive=parseList(v)}));areasBlock.append(row)});
 const addArea=document.createElement('button');addArea.className='ip-add';addArea.textContent='+ Ajouter une aire';addArea.addEventListener('click',()=>{c.areas.push({id:'0.0.0.0',networks:[],passive:[]});renderOspfPanel()});areasBlock.append(addArea);controls.append(areasBlock);
 const costBlock=ipBlock('Coût par interface (optionnel)');costBlock.append(ipField('eth1=10, eth2=100',costsToString(c.costs),v=>{c.costs=parseCosts(v)},true));controls.append(costBlock);controls.append(ospfAdvanced(node,c))}
async function loadCapabilities(){const badge=document.getElementById('capBadge'),list=document.getElementById('capList'),warning=document.getElementById('capWarning');const names={bridge:'Bridge',vlan:'VLAN',stp:'STP',mpls:'MPLS'};try{const r=await api('/api/capabilities');if(!r.httpOk)throw new Error(r.error||'API indisponible');const features=r.features||{};const supported=Object.values(features).filter(Boolean).length;badge.textContent=`${supported}/5 SUPPORTÉES`;list.replaceChildren();Object.keys(names).forEach(key=>{const item=document.createElement('div');item.className='cap-item';const label=document.createElement('span');label.textContent=names[key];const value=document.createElement('b');value.className=features[key]?'cap-ok':'cap-no';value.textContent=features[key]?'OUI':'NON';item.append(label,value);list.append(item)});const warnings=[];if(!r.docker)warnings.push('Docker absent ou inaccessible.');if(!r.containerlab)warnings.push('Containerlab absent ou inaccessible.');if(!features.vlan)warnings.push('VLAN non supporté.');if(!features.stp)warnings.push('STP non supporté.');warning.textContent=warnings.join(' ')}catch(e){badge.textContent='INDISPONIBLE';warning.textContent=`Impossible de vérifier les capacités : ${e.message}`}}
document.addEventListener('keydown',ev=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if((ev.key==='Delete'||ev.key==='Backspace')&&tool==='select'){cy.$(':selected').remove();updateCounter()}if(ev.ctrlKey&&ev.key.toLowerCase()==='s'){ev.preventDefault();doSave()}const keys={r:'router',w:'switch',p:'pc',s:'server',t:'text',l:'link',v:'select'};if(!ev.ctrlKey&&!ev.metaKey&&keys[ev.key.toLowerCase()])setTool(keys[ev.key.toLowerCase()])});
async function api(url,opts={}){try{const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts}),data=await res.json();return{...data,httpOk:res.ok}}catch(e){return{ok:false,error:`Connexion impossible : ${e.message}`}}}
document.getElementById('save').onclick=doSave;
document.getElementById('load').onclick=async()=>{const r=await api('/api/load');if(r.httpOk&&r.nodes){addState(r);say('Laboratoire chargé.')}else say(r.error||'Chargement impossible.')};
const logEl=document.getElementById('log'),logState=document.getElementById('logState');
function showDock(tab='console'){document.querySelector('.dock').classList.remove('closed');document.querySelectorAll('.dock-tab').forEach(t=>t.classList.toggle('active',t.dataset.pane===tab));document.querySelectorAll('.dock-pane').forEach(p=>p.hidden=p.dataset.pane!==tab)}
function appendLog(text){logEl.textContent+=(logEl.textContent?'\n':'')+text;logEl.scrollTop=logEl.scrollHeight}
const result=r=>[r.stdout,r.stderr,r.error].filter(Boolean).join('\n');
document.getElementById('deploy').onclick=async()=>{if(!confirm('Déployer cette topologie containerlab ?'))return;showDock();logState.textContent='DÉPLOIEMENT';appendLog('$ containerlab deploy …');const r=await api('/api/deploy',{method:'POST',body:JSON.stringify({state:getState()})});appendLog(result(r)||'Déploiement terminé.');logState.textContent=r.ok?'TERMINÉ':'ERREUR'};
document.getElementById('destroy').onclick=async()=>{if(!confirm('Détruire le laboratoire webui ?'))return;showDock();const r=await api('/api/destroy',{method:'POST',body:'{}'});appendLog(result(r)||'Destruction terminée.');logState.textContent=r.ok?'TERMINÉ':'ERREUR'};
async function execCmd(){const node=document.getElementById('execNode').value.trim(),command=document.getElementById('execCmd').value.trim();if(!node||!command){say('Saisissez un nœud et une commande.');return}logState.textContent='EXÉCUTION';appendLog(`${node}$ ${command}`);const r=await api('/api/exec',{method:'POST',body:JSON.stringify({node,command})});appendLog(result(r)||'(aucune sortie)');logState.textContent=r.ok?'TERMINÉ':'ERREUR'}
document.getElementById('execBtn').onclick=execCmd;document.getElementById('termBtn').onclick=async()=>{const node=document.getElementById('execNode').value.trim();if(!node){say('Saisissez un nœud.');return}const r=await api('/api/terminal',{method:'POST',body:JSON.stringify({node})});if(r.ok)window.open(r.url,'_blank');else say(r.error)};document.getElementById('execCmd').addEventListener('keydown',e=>{if(e.key==='Enter')execCmd()});cy.on('add remove','node, edge',updateCounter);cy.on('add remove','edge',renderPanels);cy.on('select unselect','node',renderPanels);setTool('select');loadCapabilities();
// ---- Dialogue de saisie (remplace prompt()) ----
const askDlg=document.getElementById('askDlg'),askInput=document.getElementById('askInput');
function ask(title,value=''){return new Promise(resolve=>{document.getElementById('askTitle').textContent=title;askInput.value=value;askDlg.returnValue='';askDlg.showModal();askInput.select();askDlg.addEventListener('close',()=>resolve(askDlg.returnValue==='ok'?askInput.value:null),{once:true})})}

// ---- Étiquettes d'interfaces sur les liens (même numérotation que allPortsFor / le backend) ----
function refreshPorts(){const c={};cy.edges().forEach(e=>{const s=e.data('source'),t=e.data('target');c[s]=(c[s]||0)+1;const sp='eth'+c[s];c[t]=(c[t]||0)+1;e.data({sp,tp:'eth'+c[t]})})}
cy.on('add remove','edge',refreshPorts);

// ---- Annuler / refaire (instantanés de l'état) ----
let hist=[],hi=-1,histTimer;
function snap(){const j=JSON.stringify(getState());if(hist[hi]===j)return;hist=hist.slice(0,hi+1);hist.push(j);if(hist.length>100)hist.shift();hi=hist.length-1;syncUndo();scheduleAuto()}
function syncUndo(){document.getElementById('undo').disabled=hi<=0;document.getElementById('redo').disabled=hi>=hist.length-1}
function goto(i){if(i<0||i>=hist.length)return;addState(JSON.parse(hist[i]));clearTimeout(histTimer);hi=i;syncUndo()}
cy.on('add remove position data','node,edge',()=>{clearTimeout(histTimer);histTimer=setTimeout(snap,300)});
document.getElementById('undo').onclick=()=>{clearTimeout(histTimer);snap();goto(hi-1)};
document.getElementById('redo').onclick=()=>goto(hi+1);
document.getElementById('fit').onclick=()=>cy.fit(cy.nodes(),60);
document.getElementById('zoomIn').onclick=()=>cy.zoom({level:cy.zoom()*1.25,renderedPosition:{x:stage.clientWidth/2,y:stage.clientHeight/2}});
document.getElementById('zoomOut').onclick=()=>cy.zoom({level:cy.zoom()/1.25,renderedPosition:{x:stage.clientWidth/2,y:stage.clientHeight/2}});

// ---- Renommer / dupliquer ----
function renameNode(node,raw){const name=String(raw).trim(),old=node.id();
 if(!node.hasClass('equipment')){if(!name)return false;node.data('label',name.slice(0,120));return true}
 if(name===old)return true;
 if(!/^[A-Za-z0-9_-]{1,48}$/.test(name)){say('Nom invalide : lettres, chiffres, - et _ (48 max), sans espace.');return false}
 if(cy.getElementById(name).length){say(`« ${name} » existe déjà.`);return false}
 // l'id est le nom d'hôte du conteneur : on reconstruit le graphe avec le nouvel id, liens inclus
 const st=getState();st.nodes.find(n=>n.id===old).id=name;st.links.forEach(l=>{if(l.source===old)l.source=name;if(l.target===old)l.target=name});
 addState(st);cy.getElementById(name).select();return true}

// ---- Inspecteur (en-tête du panneau de droite) ----
const nameInput=document.getElementById('nodeName');
function renderInspector(){const sel=cy.nodes(':selected'),n=sel.length===1?sel.first():null;document.getElementById('inspHead').hidden=!n;document.getElementById('inspEmpty').hidden=!!n;if(!n)return;nameInput.value=n.data('label')||n.id();const t=n.data('type');document.getElementById('inspType').textContent=n.hasClass('equipment')?typeName(n):t==='zone'?'Zone':'Texte';const ic=document.getElementById('inspIcon');ic.src=n.hasClass('equipment')?iconFor(typeKey(n)):'';ic.hidden=!n.hasClass('equipment');if(n.hasClass('equipment'))document.getElementById('execNode').value=n.id()}
cy.on('select unselect add remove','node',renderInspector);
nameInput.addEventListener('change',()=>{const n=cy.nodes(':selected').first();if(n.length&&!renameNode(n,nameInput.value))renderInspector()});
nameInput.addEventListener('keydown',e=>{if(e.key==='Enter')nameInput.blur();if(e.key==='Escape'){renderInspector();nameInput.blur()}});
const focusName=()=>{if(cy.nodes(':selected').length===1){nameInput.focus();nameInput.select()}};

// ---- Panneaux repliables ----

// ---- Glisser-déposer depuis la palette ----
document.querySelectorAll('.pal[draggable]').forEach(b=>b.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',b.dataset.tool);e.dataTransfer.effectAllowed='copy'}));
stage.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'});
stage.addEventListener('drop',async e=>{e.preventDefault();const t=e.dataTransfer.getData('text/plain');if(!TYPES[t])return;const p=modelAt(e),n=await placeEquipment(t,p,e);if(n){cy.nodes().unselect();n.select();setTool('select')}});

// ---- Menu contextuel ----
const ctx=document.getElementById('ctx');let ctxTarget=null;
const hideCtx=()=>{ctx.hidden=true};
cy.on('cxttap',ev=>{const t=ev.target;if(t===cy){hideCtx();return}cy.elements().unselect();t.select();ctxTarget=t;const eq=t.isNode()&&t.hasClass('equipment');
 ctx.innerHTML='';[['Renommer','F2',()=>t.isNode()?focusName():null,t.isNode()],['Configurer…','Entrée',()=>openEditor(),eq],['Dupliquer','Ctrl+D',()=>duplicateNode(),eq],['Ouvrir la console',null,()=>{showDock();document.getElementById('execCmd').focus()},eq],['Supprimer','Suppr',()=>{t.remove();updateCounter()},true]].filter(i=>i[3]).forEach(([label,key,fn])=>{const b=document.createElement('button');b.innerHTML=`<span>${label}</span>${key?`<kbd>${key}</kbd>`:''}`;if(label==='Supprimer')b.className='danger';b.onclick=()=>{hideCtx();fn()};ctx.append(b)});
 const r=stage.getBoundingClientRect(),oe=ev.originalEvent;ctx.style.left=Math.min(oe.clientX-r.left,r.width-180)+'px';ctx.style.top=Math.min(oe.clientY-r.top,r.height-150)+'px';ctx.hidden=false});
stage.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('pointerdown',e=>{if(!ctx.contains(e.target))hideCtx()});

// ---- Raccourcis ----
document.addEventListener('keydown',ev=>{if(askDlg.open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;const k=ev.key.toLowerCase(),mod=ev.ctrlKey||ev.metaKey;
 if(ev.key==='F2'){ev.preventDefault();focusName()}
 else if(mod&&k==='z'){ev.preventDefault();ev.shiftKey?document.getElementById('redo').click():document.getElementById('undo').click()}
 else if(mod&&k==='y'){ev.preventDefault();document.getElementById('redo').click()}
 else if(mod&&k==='d'){ev.preventDefault();duplicateNode()}
 else if(mod&&k==='c'){if(copySel())say('Copié.')}
 else if(mod&&k==='v'){ev.preventDefault();pasteClip()}
 else if(ev.key==='Enter'&&document.activeElement.tagName!=='BUTTON'){openEditor()}
 else if(ev.key==='Escape'){hideCtx();if(!editorEl.hidden){closeEditor();return}setTool('select');cy.elements().unselect()}});

// ---- Création de lien : clic-clic, glisser, Maj, verrou ----
function createLink(a,b){if(a===b||cy.edges().some(e=>(e.data('source')===a&&e.data('target')===b)||(e.data('source')===b&&e.data('target')===a)))return false;let id;do{id=`edge${++serial.edge}`}while(cy.getElementById(id).length);cy.add({group:'edges',data:{id,source:a,target:b}});updateCounter();return true}
let linkLock=false,dragFrom=null,dragMoved=false,dragFree=null;const ghost=document.getElementById('ghost'),ghostLine=document.getElementById('ghostLine'),lockBtn=document.getElementById('lock');
const keepLink=ev=>linkLock||!!(ev&&ev.originalEvent&&ev.originalEvent.shiftKey);
lockBtn.onclick=()=>{linkLock=!linkLock;lockBtn.classList.toggle('on',linkLock);lockBtn.setAttribute('aria-pressed',String(linkLock));if(linkLock)setTool('link');say(linkLock?"Verrou activé : l'outil Relier reste actif.":'Verrou désactivé.')};
cy.on('tapstart','node.equipment',ev=>{const shift=!!(ev.originalEvent&&ev.originalEvent.shiftKey);if(tool!=='link'&&!(tool==='select'&&shift))return;dragFrom=ev.target.id();dragMoved=false;if(tool!=='link'){dragFree=ev.target;ev.target.ungrabify()}});
stage.addEventListener('pointermove',ev=>{if(!dragFrom)return;const n=cy.getElementById(dragFrom),rp=n.renderedPosition(),p=point(ev);if(!dragMoved&&Math.hypot(p.x-rp.x,p.y-rp.y)<8)return;dragMoved=true;ghost.classList.add('on');ghostLine.setAttribute('x1',rp.x);ghostLine.setAttribute('y1',rp.y);ghostLine.setAttribute('x2',p.x);ghostLine.setAttribute('y2',p.y)});
cy.on('tapend',ev=>{if(dragFree){dragFree.grabify();dragFree=null}if(!dragFrom)return;const from=dragFrom,moved=dragMoved;dragFrom=null;ghost.classList.remove('on');if(!moved)return;const t=ev.target;if(t!==cy&&t.hasClass('equipment')&&t.id()!==from){if(!createLink(from,t.id()))say('Ces deux équipements sont déjà reliés.');cy.elements().unselect();if(tool==='link'&&!keepLink(ev))setTool('select')}else say('Relâchez sur un autre équipement pour créer le lien.')});

// ---- Copier / coller / dupliquer ----
let clip=null,pasteN=0;
function copySel(){const ids=new Set(cy.nodes('.equipment:selected').map(n=>n.id()));if(!ids.size)return false;const st=getState();clip={nodes:st.nodes.filter(n=>ids.has(n.id)).map(n=>JSON.parse(JSON.stringify(n))),links:st.links.filter(l=>ids.has(l.source)&&ids.has(l.target))};pasteN=0;return true}
function pasteClip(){if(!clip)return;pasteN++;const st=getState(),map={},fresh=[],xs=clip.nodes.map(n=>n.x),dx=(Math.max(...xs)-Math.min(...xs)+110)*pasteN;clip.nodes.forEach(n=>{const c=JSON.parse(JSON.stringify(n));c.id=newId(c.type);map[n.id]=c.id;c.x+=dx;st.nodes.push(c);fresh.push(c.id)});clip.links.forEach(l=>st.links.push({source:map[l.source],target:map[l.target]}));addState(st);fresh.forEach(id=>cy.getElementById(id).select())}
function duplicateNode(){if(copySel())pasteClip()}

// ---- Thème clair / sombre ----
function applyTheme(dark){document.documentElement.dataset.theme=dark?'dark':'light';cy.style().selector('node.equipment').style({'background-color':dark?'#1d2a36':'#fff','color':dark?'#e6edf3':'#1c2b27','text-background-color':dark?'#16202a':'#fff'}).selector('edge').style({'line-color':dark?'#5d7a8c':'#8aa89a','color':dark?'#a9bac7':'#48625a','text-background-color':dark?'#16202a':'#fff'}).selector('node.shape-text').style({'color':dark?'#c4d2dd':'#43584c'}).selector('node.shape-zone').style({'background-color':dark?'#2c4a3d':'#d9e8cf','color':dark?'#a8c9b7':'#587055'}).update()}
let dark=false;try{const t=localStorage.getItem('theme');dark=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}
applyTheme(dark);
document.getElementById('theme').onclick=()=>{dark=!dark;applyTheme(dark);try{localStorage.setItem('theme',dark?'dark':'light')}catch(e){}};
document.getElementById('askCancel').onclick=()=>askDlg.close('cancel');

// ---- Fenêtre de configuration flottante (suit la sélection) ----
const CATS=[{id:'iface',name:'Interfaces',desc:'Ports, adresses IP, MAC, MTU, sous-interfaces VLAN, GRE, agrégation',panels:['ipPanel','lagPanel']},
 {id:'sw',name:'Commutation',desc:'Ports access / trunk, VLAN, STP',panels:['switchPanel','l2Panel']},
 {id:'route',name:'Routage',desc:'Routes statiques, OSPF, BGP, MPLS / LDP',panels:['routesPanel','ospfPanel','eigrpPanel','ripPanel','isisPanel','bgpPanel','mplsPanel']},
 {id:'ha',name:'Redondance & VPN',desc:'VRRP, IPsec',panels:['vrrpPanel','ipsecPanel']},
 {id:'srv',name:'Services',desc:'Serveur DHCP',panels:['dhcpPanel']}];
const PNAME={ipPanel:'Interfaces',lagPanel:'Agrégation',switchPanel:'Ports & VLAN',routesPanel:'Routes statiques',ospfPanel:'OSPF',bgpPanel:'BGP',mplsPanel:'MPLS',vrrpPanel:'VRRP',ipsecPanel:'IPsec',dhcpPanel:'DHCP',ripPanel:'RIP',eigrpPanel:'EIGRP',isisPanel:'IS-IS',l2Panel:'STP avancé'};
const editorEl=document.getElementById('editor'),edHome=document.getElementById('edHome'),edTabs=document.getElementById('edTabs'),edBody=document.getElementById('editorBody'),edCrumb=document.getElementById('edCrumb'),centerEl=document.querySelector('.center');
const PDESC={ipPanel:'ports, adresses IP, MAC, MTU, sous-interfaces',lagPanel:'agrégation de liens',switchPanel:'ports access / trunk, VLAN, STP',routesPanel:'routes statiques',ospfPanel:'OSPF',bgpPanel:'BGP',mplsPanel:'MPLS / LDP',vrrpPanel:'VRRP',ipsecPanel:'IPsec',dhcpPanel:'serveur DHCP',ripPanel:'RIP',eigrpPanel:'EIGRP',isisPanel:'IS-IS',l2Panel:'timers STP, IGMP'};
let ed={cat:null,panel:null,node:null};
const panelVisible=id=>!document.getElementById(id).hidden;
function panelOn(n,id){const ip=normalizeIpConfig(n.data('ip'));if(FEATURES[id])return !!n.data(FEATURES[id])&&(!Array.isArray(n.data(FEATURES[id]))||n.data(FEATURES[id]).length>0);if(id==='routesPanel')return ip.routes.length>0;if(id==='dhcpPanel')return !!ip.dhcpServer;return false}
const el=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html!==undefined)e.innerHTML=html;return e};
const typeName=n=>{const t=n.data('type');return t==='switch'?(n.data('l3')?'Switch L3':'Switch L2'):TYPES[t].name};
function setL3(n,flag){if(!!n.data('l3')===flag)return;
 if(!flag){const ip=normalizeIpConfig(n.data('ip'));const has=n.data('ospf')||n.data('bgp')||n.data('vrrp')||n.data('rip')||n.data('eigrp')||ip.dhcpServer||ip.loopback.length||ip.ifaces.some(i=>/^br0\./.test(i.dev));
  if(has&&!confirm('Passer en L2 supprime la configuration L3 de ce switch (SVI, OSPF, BGP, VRRP, DHCP, loopback). Continuer ?'))return;
  ['ospf','bgp','vrrp','rip','eigrp'].forEach(k=>n.data(k,null));ip.ifaces=ip.ifaces.filter(i=>!/^br0\./.test(i.dev));delete ip.dhcpServer;ip.loopback=[];n.data('ip',ip)}
 const k=flag?'switch3':'switch';n.data({l3:flag,icon:iconFor(k),color:TYPES[k].color});
 renderPanels();renderInspector();renderSummary();renderEditor()}
function segControl(n){const w=el('div','seg');w.append(el('span','seg-label','Niveau'));[[false,'L2','Commutation seule'],[true,'L3','Routage inter-VLAN, OSPF, BGP, VRRP']].forEach(([f,t,d])=>{const b=el('button',!!n.data('l3')===f?'active':'',t);b.title=d;b.type='button';b.onclick=()=>setL3(n,f);w.append(b)});return w}
function renderEditor(){const n=ed.node&&ed.node.length?ed.node:null;edCrumb.replaceChildren();
 if(!n){edCrumb.append(el('span','',"Configuration"));edHome.hidden=false;edTabs.hidden=true;edBody.hidden=true;document.getElementById('edBack').hidden=true;edHome.replaceChildren(el('div','insp-empty','<b>Aucun équipement sélectionné</b>Cliquez sur un équipement du plan : cette fenêtre reste ouverte et suit votre sélection.'));return}
 const img=el('img');img.src=iconFor(typeKey(n));edCrumb.append(img,el('span','',n.id()),el('small','',typeName(n)));
 const cat=CATS.find(c=>c.id===ed.cat&&c.panels.some(panelVisible));if(!cat)ed.cat=null;
 if(cat){edCrumb.append(el('i','','›'),el('span','cur',cat.name))}
 document.getElementById('edBack').hidden=!cat;edHome.hidden=!!cat;edTabs.hidden=!cat;edBody.hidden=!cat;
 if(!cat){edHome.replaceChildren();if(n.data('type')==='switch')edHome.append(segControl(n));CATS.forEach(c=>{const vis=c.panels.filter(panelVisible);if(!vis.length)return;const d=vis.map(id=>PDESC[id]).join(', ');const b=el('button','cat','<b>'+c.name+'</b><span>'+d.charAt(0).toUpperCase()+d.slice(1)+'</span>');const chips=el('div','chips');vis.forEach(id=>{if(panelOn(n,id))chips.append(el('em','chip',PNAME[id]))});if(c.id==='iface'&&normalizeIpConfig(n.data('ip')).ifaces.length){const k=normalizeIpConfig(n.data('ip')).ifaces.length;chips.append(el('em','chip',k+' interface'+(k>1?'s':'')))}if(chips.children.length)b.append(chips);b.onclick=()=>{ed.cat=c.id;ed.panel=vis[0];renderEditor()};edHome.append(b)});return}
 const vis=cat.panels.filter(panelVisible);if(!vis.includes(ed.panel))ed.panel=vis[0];
 edTabs.replaceChildren();edTabs.hidden=vis.length<2;vis.forEach(id=>{const b=el('button',id===ed.panel?'active':'',PNAME[id]+(panelOn(n,id)?'<span class="dot"></span>':''));b.onclick=()=>{ed.panel=id;renderEditor()};edTabs.append(b)});
 Object.keys(PNAME).forEach(id=>document.getElementById(id).classList.toggle('off',id!==ed.panel))}
function syncEditorNode(){const s=cy.nodes(':selected'),n=s.length===1&&s.first().hasClass('equipment')?s.first():null;ed.node=n;if(!editorEl.hidden)renderEditor()}
function clampEditor(){const c=centerEl.getBoundingClientRect(),w=Math.min(editorEl.offsetWidth||560,c.width-16),h=Math.min(editorEl.offsetHeight||480,c.height-16);editorEl.style.width=w+'px';editorEl.style.height=h+'px';editorEl.style.left=Math.max(8,Math.min(parseFloat(editorEl.style.left)||24,c.width-w-8))+'px';editorEl.style.top=Math.max(8,Math.min(parseFloat(editorEl.style.top)||70,c.height-h-8))+'px'}
function saveEditorPos(){try{localStorage.setItem('edpos',JSON.stringify({l:editorEl.style.left,t:editorEl.style.top,w:editorEl.style.width,h:editorEl.style.height}))}catch(e){}}
try{const p=JSON.parse(localStorage.getItem('edpos')||'null');if(p){editorEl.style.left=p.l;editorEl.style.top=p.t;editorEl.style.width=p.w;editorEl.style.height=p.h}else{editorEl.style.left='24px';editorEl.style.top='70px';editorEl.style.width='560px';editorEl.style.height='480px'}}catch(e){}
function openEditor(){editorEl.hidden=false;ed.cat=null;syncEditorNode();clampEditor();renderEditor()}
function closeEditor(){editorEl.hidden=true;renderSummary()}
document.getElementById('edClose').onclick=closeEditor;
document.getElementById('edBack').onclick=()=>{ed.cat=null;renderEditor()};
document.getElementById('openEditor').onclick=openEditor;
cy.on('dbltap','node.equipment',()=>{if(tool==='select')openEditor()});
cy.on('select unselect add remove','node',syncEditorNode);
// déplacement par l'en-tête + redimensionnement (poignée native) ; le tout reste dans la zone du plan
document.getElementById('edHead').addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const h=e.currentTarget,sx=e.clientX-editorEl.offsetLeft,sy=e.clientY-editorEl.offsetTop;h.setPointerCapture(e.pointerId);h.classList.add('drag');h.onpointermove=ev=>{editorEl.style.left=(ev.clientX-sx)+'px';editorEl.style.top=(ev.clientY-sy)+'px';clampEditor()};h.onpointerup=()=>{h.onpointermove=null;h.classList.remove('drag');saveEditorPos()}});
new ResizeObserver(()=>{if(!editorEl.hidden){clampEditor();saveEditorPos()}}).observe(editorEl);
window.addEventListener('resize',()=>{if(!editorEl.hidden)clampEditor()});

// ---- Résumé dans l'inspecteur ----
function renderSummary(){const n=cy.nodes('.equipment:selected').first(),one=cy.nodes(':selected').length===1&&n.length;document.getElementById('inspBody').hidden=!one;if(!one)return;
 const sm=document.getElementById('swMode');sm.replaceChildren();if(n.data('type')==='switch')sm.append(segControl(n));
 const box=document.getElementById('inspSum');box.replaceChildren();
 const feats=Object.keys(PNAME).filter(id=>id!=='ipPanel'&&id!=='switchPanel'&&panelVisible(id)&&panelOn(n,id)).map(id=>PNAME[id]);if(n.data('type')==='switch')feats.unshift(normalizeSwitchConfig(n.data('config')).stp?'STP':'STP off');
 if(feats.length){box.append(el('h4','','Fonctions'));const c=el('div','chips');feats.forEach(f=>c.append(el('em','chip',f)));box.append(c)}
 const ip=normalizeIpConfig(n.data('ip')),rows=[...ip.ifaces.map(i=>[i.dev,i.ipv4||i.ipv6||(i.dhcp?'DHCP':'—')]),...ip.loopback.map(a=>['lo',a])];
 if(rows.length){box.append(el('h4','','Interfaces'));rows.slice(0,8).forEach(([d,a])=>box.append(el('div','ifl','<span>'+d+'</span><span>'+a+'</span>')))}
 if(!feats.length&&!rows.length)box.append(el('div','none',"Rien de configuré pour l'instant."))}
cy.on('select unselect add remove','node',renderSummary);

editorEl.addEventListener('change',()=>renderSummary());editorEl.addEventListener('click',()=>setTimeout(renderSummary,0));
// ---- Dock (console / capacités) ----
document.querySelectorAll('.dock-tab').forEach(t=>t.addEventListener('click',()=>showDock(t.dataset.pane)));
document.getElementById('dockToggle').onclick=()=>document.querySelector('.dock').classList.toggle('closed');

document.querySelectorAll('[data-icon]').forEach(e=>{const i=document.createElement('img');i.src=iconFor(e.dataset.icon);i.alt='';e.append(i)});
// ---- Fond en points qui suit zoom et déplacement ----
cy.on('viewport',()=>{const z=cy.zoom(),p=cy.pan(),s=Math.max(8,22*z);stage.style.backgroundSize=`${s}px ${s}px`;stage.style.backgroundPosition=`${p.x}px ${p.y}px`});
// ---- Largeur du panneau de droite ----
const shell=document.querySelector('.shell'),rz=document.getElementById('resizer');
const setRw=w=>shell.style.setProperty('--rw',Math.max(300,Math.min(760,w))+'px');
try{const w=localStorage.getItem('rw');if(w)setRw(Number(w))}catch(e){}
rz.addEventListener('pointerdown',e=>{rz.setPointerCapture(e.pointerId);rz.classList.add('drag');rz.onpointermove=ev=>{setRw(innerWidth-ev.clientX);cy.resize()}});
rz.addEventListener('pointerup',()=>{rz.classList.remove('drag');rz.onpointermove=null;try{localStorage.setItem('rw',parseInt(getComputedStyle(shell).getPropertyValue('--rw')))}catch(e){}});
// ---- Pastille « ACTIF » sur les panneaux dont la fonction est activée ----
const FEATURES={ripPanel:'rip',eigrpPanel:'eigrp',isisPanel:'isis',l2Panel:'l2',ospfPanel:'ospf',bgpPanel:'bgp',mplsPanel:'mpls',ipsecPanel:'ipsec',vrrpPanel:'vrrp',lagPanel:'portchannels'};
function markActive(){const n=cy.nodes('.equipment:selected').first();Object.entries(FEATURES).forEach(([id,k])=>{const p=document.getElementById(id);if(n.length&&n.data(k))p.dataset.on='';else delete p.dataset.on})}
// ---- Sauvegarde automatique + historique (dans ce navigateur) ----
const VKEY='lab01.versions';
const getVersions=()=>{try{return JSON.parse(localStorage.getItem(VKEY)||'[]')}catch(e){return[]}};
function putVersions(v){while(v.length){try{localStorage.setItem(VKEY,JSON.stringify(v));return}catch(e){v.shift()}}}
function pushVersion(label,auto){const st=getState();if(auto&&!st.nodes.length&&!st.shapes.length)return;const j=JSON.stringify(st),v=getVersions(),last=v[v.length-1];
 if(last&&JSON.stringify(last.state)===j){if(!auto&&last.auto){last.auto=false;last.label=label;last.t=Date.now();putVersions(v)}return}
 const item={t:Date.now(),label,auto,n:st.nodes.length,l:st.links.length,state:st};
 if(auto&&last&&last.auto&&item.t-last.t<120000)v[v.length-1]=item;else v.push(item);
 while(v.length>30){const i=v.findIndex(x=>x.auto);v.splice(i>=0?i:0,1)}putVersions(v)}
let autoT;function scheduleAuto(){clearTimeout(autoT);autoT=setTimeout(()=>pushVersion('Sauvegarde auto',true),4000)}
async function doSave(){const r=await api('/api/save',{method:'POST',body:JSON.stringify(getState())});say(r.ok?'État sauvegardé.':(r.error||'Échec de la sauvegarde.'));if(r.ok)pushVersion('Sauvegarde manuelle',false)}
const histDlg=document.getElementById('histDlg');
document.getElementById('history').onclick=()=>{const list=document.getElementById('histList');list.replaceChildren();const v=getVersions().slice().reverse();if(!v.length)list.append(el('div','none',"Aucune sauvegarde pour l'instant."));
 v.forEach(it=>{const row=el('div','hist-row');row.append(el('div','','<b>'+it.label+'</b><small>'+new Date(it.t).toLocaleString('fr-FR')+' · '+it.n+' équipement(s), '+it.l+' lien(s)</small>'));const b=el('button','btn','Restaurer');b.type='button';b.onclick=()=>{pushVersion('Avant restauration',false);addState(it.state);snap();histDlg.close();say('Version restaurée.')};row.append(b);list.append(row)});histDlg.showModal()};
document.getElementById('load').addEventListener('click',()=>setTimeout(()=>histDlg.close(),600));
document.getElementById('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(getState(),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lab01-'+new Date().toISOString().slice(0,16).replace(/[:T]/g,'-')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000);say('Export téléchargé.')};
const importFile=document.getElementById('importFile');document.getElementById('importBtn').onclick=()=>importFile.click();
importFile.onchange=async()=>{const f=importFile.files[0];importFile.value='';if(!f)return;if(f.size>5e6){say('Fichier trop volumineux (5 Mo max).');return}
 try{const s=JSON.parse(await f.text());if(!s||typeof s!=='object'||!Array.isArray(s.nodes)||(s.links!==undefined&&!Array.isArray(s.links)))throw new Error('format');pushVersion('Avant import',false);addState(s);snap();histDlg.close();say('Fichier importé : '+f.name)}catch(e){say("Import impossible : ce n'est pas un export LAB/01 valide.")}};
window.addEventListener('beforeunload',()=>pushVersion('Sauvegarde auto',true));

// ---- Redimensionnement et repli des volets ----
const rzL=document.getElementById('resizerL'),grip=document.getElementById('dockGrip');
const setLw=w=>shell.style.setProperty('--lw',Math.max(110,Math.min(360,w))+'px');
const setDh=h=>shell.style.setProperty('--dh',Math.max(110,Math.min(centerEl.clientHeight-170,h))+'px');
const remember=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
const recall=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
function dragger(handle,onmove,key,read){handle.addEventListener('pointerdown',e=>{handle.setPointerCapture(e.pointerId);handle.classList.add('drag');handle.onpointermove=onmove});handle.addEventListener('pointerup',()=>{handle.classList.remove('drag');handle.onpointermove=null;remember(key,read())})}
dragger(rzL,ev=>setLw(ev.clientX),'lw',()=>parseInt(getComputedStyle(shell).getPropertyValue('--lw')));
dragger(grip,ev=>setDh(centerEl.getBoundingClientRect().bottom-12-ev.clientY),'dh',()=>parseInt(getComputedStyle(shell).getPropertyValue('--dh')));
{const l=recall('lw'),d=recall('dh');if(l)setLw(Number(l));if(d)setDh(Number(d))}
['Left','Right'].forEach(side=>{const cls=side==='Left'?'nl':'nr',b=document.getElementById('toggle'+side);if(recall(cls)==='1')shell.classList.add(cls);b.onclick=()=>{shell.classList.toggle(cls);remember(cls,shell.classList.contains(cls)?'1':'0')}});
new ResizeObserver(()=>cy.resize()).observe(stage);
// L'état est gardé dans le sessionStorage de l'onglet : un rechargement le retrouve,
// un nouvel onglet ou un nouveau lancement de l'appli démarre vierge.
try{const t=sessionStorage.getItem('lab01.tab');if(t){addState(JSON.parse(t));say('Session restaurée après rechargement.')}}catch(e){}
addEventListener('pagehide',()=>{try{sessionStorage.setItem('lab01.tab',JSON.stringify(getState()))}catch(e){}});
updateCounter();snap();
})();
