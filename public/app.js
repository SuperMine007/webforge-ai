'use strict';
const state={files:{},currentFile:null,models:[],selectedModel:'anthropic/claude-3.5-sonnet',tokenMode:'auto',manualTokens:4000,opencodeApiKey:null,opencodeConnected:false,opencodeHistory:[],modelTier:'default',currentProvider:'openrouter',folders:{},terminals:[{id:1,name:'pwsh',output:[]}],activeTerminal:1,terminalCounter:1};
const $=id=>document.getElementById(id),$$=sel=>document.querySelectorAll(sel);

// DOM refs
const promptInput=$('promptInput'),btnGenerate=$('btnGenerate'),btnToken=$('btnToken'),tokenLabel=$('tokenLabel'),tokenDropdown=$('tokenDropdown'),tokenSelect=$('tokenSelect'),btnModel=$('btnModel'),modelName=$('modelName'),modelDropdown=$('modelDropdown'),modelSearch=$('modelSearch'),freeOnly=$('freeOnly'),modelList=$('modelList'),modelManual=$('modelManual'),providerSelect=$('providerSelect'),btnClear=$('btnClear'),btnDownload=$('btnDownload'),fileTree=$('fileTree'),fileTab=$('fileTab'),lineNums=$('lineNums'),codeContent=$('codeContent'),codeEditor=$('codeEditor'),btnEdit=$('btnEdit'),btnSave=$('btnSave'),btnCopy=$('btnCopy'),previewFrame=$('previewFrame'),previewPlaceholder=$('previewPlaceholder'),previewBody=$('previewBody'),btnRefresh=$('btnRefresh'),btnNewTab=$('btnNewTab'),statusBar=$('statusBar'),statusText=$('statusText'),statusTokens=$('statusTokens'),statusCredits=$('statusCredits'),statusTier=$('statusTier'),loadingOverlay=$('loadingOverlay'),toastContainer=$('toastContainer'),terminalOutput=$('terminalOutput'),terminalInput=$('terminalInput'),btnNewFile=$('btnNewFile'),btnNewFolder=$('btnNewFolder'),btnUpload=$('btnUpload'),fileInput=$('fileInput'),manualTokenSection=$('manualTokenSection'),manualTokenInput=$('manualTokenInput'),tokenManualMin=$('tokenManualMin'),tokenManualMax=$('tokenManualMax'),tokenManualRec=$('tokenManualRec'),modelDropdownHeader=$('modelDropdownHeader'),panelArea=$('panelArea'),breadcrumbFile=$('breadcrumbFile'),statusLang=$('statusLang'),fileMenu=$('fileMenu');

function init(){
  loadModels();loadCredits();loadRecommendations();
  providerSelect.addEventListener('change',()=>loadModels());
  btnGenerate.addEventListener('click',generate);
  promptInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();generate()}});

  // Token mode
  btnToken.addEventListener('click',e=>{e.stopPropagation();tokenSelect.classList.toggle('open')});
  $$('.token-opt').forEach(opt=>opt.addEventListener('click',()=>{
    state.tokenMode=opt.dataset.mode;tokenLabel.textContent=opt.querySelector('span').textContent;
    $$('.token-opt').forEach(o=>o.classList.remove('active'));opt.classList.add('active');tokenSelect.classList.remove('open');
    if(manualTokenSection)manualTokenSection.style.display=opt.dataset.mode==='manual'?'block':'none';
    loadRecommendations();
  }));
  document.addEventListener('click',e=>{if(!tokenSelect.contains(e.target))tokenSelect.classList.remove('open')});
  if(manualTokenInput)manualTokenInput.addEventListener('input',()=>{const v=parseInt(manualTokenInput.value,10);if(!isNaN(v)&&v>=100)state.manualTokens=Math.min(32000,v)});

  // Model dropdown
  btnModel.addEventListener('click',e=>{e.stopPropagation();modelDropdown.classList.toggle('open')});
  modelSearch.addEventListener('input',renderModels);
  freeOnly.addEventListener('change',renderModels);
  modelManual.addEventListener('keydown',e=>{if(e.key==='Enter'&&modelManual.value.trim()){selectModel(modelManual.value.trim());modelDropdown.classList.remove('open')}});
  document.addEventListener('click',e=>{if(!modelDropdown.contains(e.target)&&e.target!==btnModel)modelDropdown.classList.remove('open')});

  // Clear & Download
  btnClear.addEventListener('click',()=>{if(!Object.keys(state.files).length)return;if(confirm('Clear all files?')){state.files={};state.currentFile=null;state.folders={};renderFileTree();btnDownload.classList.add('hidden');toast('Cleared','info')}});
  btnDownload.addEventListener('click',downloadZip);

  // File actions
  btnNewFile.addEventListener('click',createNewFile);
  if(btnNewFolder)btnNewFolder.addEventListener('click',createNewFolder);
  btnUpload.addEventListener('click',()=>fileInput.click());
  fileInput.addEventListener('change',handleUpload);

  // Code editing
  btnEdit.addEventListener('click',()=>{if(!state.currentFile)return;codeEditor.value=state.files[state.currentFile]||'';codeEditor.classList.remove('hidden');codeContent.classList.add('hidden');btnEdit.classList.add('hidden');btnSave.classList.remove('hidden');codeEditor.focus()});
  btnSave.addEventListener('click',()=>{if(!state.currentFile)return;state.files[state.currentFile]=codeEditor.value;codeContent.innerHTML=highlight(codeEditor.value,state.currentFile);renderLineNums(codeEditor.value);closeEditor();buildPreview();toast('Saved','ok')});
  btnCopy.addEventListener('click',()=>{if(!state.currentFile)return;navigator.clipboard.writeText(state.files[state.currentFile]||'').then(()=>toast('Copied!','ok'))});
  codeEditor.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const s=codeEditor.selectionStart;codeEditor.value=codeEditor.value.slice(0,s)+'  '+codeEditor.value.slice(codeEditor.selectionEnd);codeEditor.selectionStart=codeEditor.selectionEnd=s+2}if(e.ctrlKey&&e.key==='s'){e.preventDefault();btnSave.click()}});
  codeEditor.addEventListener('input',()=>renderLineNums(codeEditor.value));
  codeEditor.addEventListener('scroll',()=>lineNums.scrollTop=codeEditor.scrollTop);

  // Preview
  btnRefresh.addEventListener('click',buildPreview);
  btnNewTab.addEventListener('click',()=>{const h=state.files['index.html'];if(!h)return;window.open(URL.createObjectURL(new Blob([h],{type:'text/html'})))});
  $$('.device-btn').forEach(btn=>btn.addEventListener('click',()=>{$$('.device-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');previewBody.dataset.device=btn.dataset.device;buildPreview()}));

  // Mobile tabs (Files, Code, Preview, Terminal)
  $$('.mob-tab').forEach(tab=>tab.addEventListener('click',()=>{
    $$('.mob-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');
    const p=tab.dataset.panel;
    const sidebar=document.querySelector('.sidebar');
    const codep=document.querySelector('.code-panel');
    const prevp=document.querySelector('.preview-panel');
    // Hide everything first
    [sidebar,codep,prevp].forEach(el=>{if(el){el.classList.remove('mob-visible');el.style.display=''}});
    panelArea.classList.add('hidden');panelArea.style.height='250px';
    // Show the selected panel
    if(p==='terminal'){
      panelArea.classList.remove('hidden');panelArea.style.height='100%';
      if(sidebar)sidebar.style.display='none';
      terminalInput.focus();
    } else if(p==='sidebar'){
      if(sidebar){sidebar.classList.add('mob-visible');sidebar.style.display='flex'}
    } else if(p==='code'){
      if(sidebar)sidebar.style.display='none';
      if(codep)codep.classList.add('mob-visible');
    } else if(p==='preview'){
      if(sidebar)sidebar.style.display='none';
      if(prevp)prevp.classList.add('mob-visible');
    }
  }));

  // Terminal panel toggle
  $('menuTerminalMenu')?.addEventListener('click',()=>togglePanel());
  $('btnClosePanel')?.addEventListener('click',()=>{panelArea.classList.add('hidden');panelArea.style.height='250px'});
  $('btnNewTerminal')?.addEventListener('click',()=>createTerminal());
  $('btnSplitTerminal')?.addEventListener('click',()=>createTerminal());
  $('btnKillTerminal')?.addEventListener('click',()=>killActiveTerminal());
  $('btnMaxPanel')?.addEventListener('click',()=>{const h=panelArea.style.height;panelArea.style.height=(h==='100%')?'250px':'100%'});
  terminalInput.addEventListener('keydown',handleTerminalInput);

  // Shell select
  const shellSelect=$('terminalShellSelect');
  if(shellSelect)shellSelect.addEventListener('change',()=>{
    const v=shellSelect.value;
    const t=state.terminals.find(t=>t.id===state.activeTerminal);
    if(t){
      t.shellType=v;
      t.name={powershell:'pwsh',cmd:'cmd',bash:'bash',opencode:'ai'}[v]||v;
      if(v!=='opencode'){terminalOutput.innerHTML='';addTerminalLine('Switched to '+(v==='bash'?'Git Bash':v),'info');}
    }
    applyTerminalShellUI(v);
    renderTerminalInstances();
  });

  // Panel tabs (Terminal / Problems / Output)
  $$('.panel-tab').forEach(tab=>tab.addEventListener('click',()=>{
    $$('.panel-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');
    const ptab=tab.dataset.ptab;
    const pc=document.querySelector('.panel-content');
    if(pc)pc.style.display='flex';
    if(ptab==='problems'){terminalOutput.innerHTML='';addTerminalLine('No problems detected.','success')}
    else if(ptab==='output'){terminalOutput.innerHTML='';addTerminalLine('Output channel active.','info')}
    else{restoreTerminalOutput()}
  }));

  // File menu
  setupMenu('menuFile',fileMenu);
  $$('.ctx-item').forEach(item=>item.addEventListener('click',()=>{const a=item.dataset.action;closeAllMenus();if(a==='newFile')createNewFile();else if(a==='newFolder')createNewFolder();else if(a==='upload')fileInput.click();else if(a==='saveFile'){if(!codeEditor.classList.contains('hidden'))btnSave.click();else toast('No unsaved changes','info');}else if(a==='download')downloadZip();else if(a==='clearAll')btnClear.click()}));

  // Edit menu
  setupMenu('menuEdit','editMenu');
  setupMenu('menuView','viewMenu');
  setupMenu('menuHelp','helpMenu');

  // Close menus on outside click
  document.addEventListener('click',()=>closeAllMenus());

  // Activity bar buttons - show sidebar with different content per panel
  $$('.ab-btn[data-panel]').forEach(btn=>btn.addEventListener('click',()=>{
    const panelName=btn.dataset.panel;
    const sidebar=document.querySelector('.sidebar');
    const wasActive=btn.classList.contains('active');
    $$('.ab-btn').forEach(b=>b.classList.remove('active'));
    if(wasActive){
      sidebar.style.display='none';
    } else {
      btn.classList.add('active');
      sidebar.style.display='flex';
      // Show the right panel, hide others
      $$('.sidebar-panel').forEach(p=>p.classList.add('hidden'));
      const panelMap={explorer:'panelExplorer',search:'panelSearch',scm:'panelScm',extensions:'panelExtensions'};
      const target=$(panelMap[panelName]);
      if(target)target.classList.remove('hidden');
      // Update title
      const titleEl=$('sidebarTitleText');
      const titles={explorer:'EXPLORER',search:'SEARCH',scm:'SOURCE CONTROL',extensions:'EXTENSIONS'};
      if(titleEl)titleEl.textContent=titles[panelName]||'EXPLORER';
      // Show/hide collapse button (only for explorer)
      const ta=$('sidebarTitleActions');
      if(ta)ta.style.display=panelName==='explorer'?'flex':'none';
      // Focus search input
      if(panelName==='search')setTimeout(()=>$('sidebarSearchInput')?.focus(),50);
    }
  }));

  // Sidebar section header collapse
  $('sidebarProjectHeader')?.addEventListener('click',e=>{
    if(e.target.closest('.sb-btn'))return;
    const chevron=$('sidebarProjectHeader').querySelector('.chevron');
    const isOpen=chevron.style.transform!=='rotate(0deg)';
    chevron.style.transform=isOpen?'rotate(0deg)':'rotate(90deg)';
    fileTree.style.display=isOpen?'none':'';
  });

  // Collapse all
  $('btnCollapseAll')?.addEventListener('click',()=>{
    const chevron=$('sidebarProjectHeader')?.querySelector('.chevron');
    if(chevron)chevron.style.transform='rotate(0deg)';
    fileTree.style.display='none';
  });

  // Tab close
  fileTab.querySelector('.tab-close')?.addEventListener('click',e=>{
    e.stopPropagation();
    state.currentFile=null;
    fileTab.querySelector('.tab-label').textContent='Welcome';
    if(breadcrumbFile)breadcrumbFile.textContent='Welcome';
    if(statusLang)statusLang.textContent='Plain Text';
    codeContent.innerHTML='<code>// Select a file from the explorer</code>';
    lineNums.innerHTML='';closeEditor();
  });

  // Split editor (toggles preview)
  $('btnSplitEditor')?.addEventListener('click',()=>{
    const pp=document.querySelector('.preview-panel');
    if(pp){pp.style.display=pp.style.display==='none'?'flex':'none'}
  });

  // More actions
  $('btnMoreActions')?.addEventListener('click',()=>toast('More actions menu','info'));

  // Status bar buttons
  $('btnRemote')?.addEventListener('click',()=>toast('Remote connection status','info'));
  $('btnBranch')?.addEventListener('click',()=>toast('Branch: main','info'));
  $('btnNotifications')?.addEventListener('click',()=>toast('No new notifications','info'));

  // Sidebar search
  $('sidebarSearchInput')?.addEventListener('input',doSearch);

  // Keyboard shortcuts
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey&&e.key==='k'){e.preventDefault();promptInput.focus()}
    if(e.ctrlKey&&e.key==='`'){e.preventDefault();togglePanel()}
    if(e.ctrlKey&&e.key==='n'){e.preventDefault();createNewFile()}
    if(e.ctrlKey&&e.key==='o'){e.preventDefault();fileInput.click()}
    if(e.ctrlKey&&e.key==='s'&&state.currentFile){e.preventDefault();if(!codeEditor.classList.contains('hidden'))btnSave.click()}
    if(e.ctrlKey&&e.key==='b'){e.preventDefault();const sb=document.querySelector('.sidebar');sb.style.display=sb.style.display==='none'?'flex':'none'}
  });

  // Auto-show code panel on mobile
  if(window.innerWidth<=768){
    document.querySelector('.code-panel')?.classList.add('mob-visible');
    document.querySelector('.sidebar').style.display='none';
    // Set Code tab as active on mobile
    $$('.mob-tab').forEach(t=>{t.classList.remove('active');if(t.dataset.panel==='code')t.classList.add('active')});
  }

  setStatus('Ready');
}

function setupMenu(btnId,menuEl){
  const btn=$(btnId);
  if(typeof menuEl==='string')menuEl=$(menuEl);
  if(!btn||!menuEl)return;
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    closeAllMenus();
    const r=btn.getBoundingClientRect();
    menuEl.style.top=r.bottom+'px';menuEl.style.left=r.left+'px';
    menuEl.classList.remove('hidden');
  });
}
function closeAllMenus(){$$('.context-menu').forEach(m=>m.classList.add('hidden'))}

function togglePanel(){panelArea.classList.toggle('hidden');if(!panelArea.classList.contains('hidden')){panelArea.style.height='250px';terminalInput.focus()}}

// Multi-terminal management
function applyTerminalShellUI(type){
  const ui=$('opencodeUi');
  if(type==='opencode'){
    ui?.classList.remove('hidden');
    $('opencodeInput')?.focus();
  } else {
    ui?.classList.add('hidden');
    terminalInput.focus();
  }
}

function createTerminal(){
  // Save current terminal output
  saveTerminalOutput();
  state.terminalCounter++;
  const shellSelect=$('terminalShellSelect');
  const type=shellSelect?shellSelect.value:'powershell';
  const shellName={powershell:'pwsh',cmd:'cmd',bash:'bash',opencode:'ai'}[type]||'pwsh';
  const t={id:state.terminalCounter,name:shellName+' '+state.terminalCounter,output:'',shellType:type};
  state.terminals.push(t);
  state.activeTerminal=t.id;
  terminalOutput.innerHTML='';
  if(type!=='opencode')addTerminalLine('New terminal session #'+t.id+' started','info');
  applyTerminalShellUI(type);
  renderTerminalInstances();
}

function killActiveTerminal(){
  if(state.terminals.length<=1){
    terminalOutput.innerHTML='';
    addTerminalLine('Terminal cleared.','warning');
    return;
  }
  state.terminals=state.terminals.filter(t=>t.id!==state.activeTerminal);
  state.activeTerminal=state.terminals[state.terminals.length-1].id;
  restoreTerminalOutput();
  renderTerminalInstances();
  toast('Terminal killed','info');
}

function saveTerminalOutput(){
  const t=state.terminals.find(t=>t.id===state.activeTerminal);
  if(t)t.output=terminalOutput.innerHTML;
}

function restoreTerminalOutput(){
  const t=state.terminals.find(t=>t.id===state.activeTerminal);
  if(t)terminalOutput.innerHTML=t.output||'';
}

function switchTerminal(id){
  saveTerminalOutput();
  state.activeTerminal=id;
  restoreTerminalOutput();
  renderTerminalInstances();
  const t=state.terminals.find(x=>x.id===id);
  if(t){
    const shellSelect=$('terminalShellSelect');
    if(shellSelect)shellSelect.value=t.shellType||'powershell';
    applyTerminalShellUI(t.shellType||'powershell');
  }
}

function renderTerminalInstances(){
  const container=document.querySelector('.terminal-instances');
  if(!container)return;
  container.innerHTML='';
  state.terminals.forEach(t=>{
    const div=document.createElement('div');
    div.className='term-instance'+(t.id===state.activeTerminal?' active':'');
    div.innerHTML='<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 6l3 2-3 2" stroke="currentColor" stroke-width="1.3"/><path d="M9 11h4" stroke="currentColor" stroke-width="1.3"/></svg><span>'+t.name+'</span>';
    div.addEventListener('click',()=>switchTerminal(t.id));
    container.appendChild(div);
  });
}

// Sidebar search
function doSearch(){
  const q=($('sidebarSearchInput')?.value||'').toLowerCase();
  const resultsEl=$('searchResults');
  if(!resultsEl)return;
  if(!q){resultsEl.innerHTML='<div class="empty-tree"><p>Type to search across files</p></div>';return}
  let html='';
  Object.keys(state.files).forEach(fname=>{
    const content=state.files[fname]||'';
    const lines=content.split('\n');
    lines.forEach((line,i)=>{
      if(line.toLowerCase().includes(q)){
        html+='<div class="search-result-item" data-file="'+fname+'" data-line="'+(i+1)+'">';
        html+='<span class="sr-file">'+fname+'</span>';
        html+='<span class="sr-line">:'+( i+1)+'</span>';
        html+='<div class="sr-text">'+line.substring(0,80).replace(/</g,'&lt;')+'</div></div>';
      }
    });
  });
  resultsEl.innerHTML=html||'<div class="empty-tree"><p>No results found</p></div>';
  resultsEl.querySelectorAll('.search-result-item').forEach(item=>item.addEventListener('click',()=>openFile(item.dataset.file)));
}

function createNewFile(){const name=prompt('New File Name:');if(name&&name.trim()){state.files[name.trim()]='';renderFileTree();openFile(name.trim())}}
function createNewFolder(){const name=prompt('New Folder Name:');if(name&&name.trim()){state.folders[name.trim()]=true;renderFileTree();toast('Folder created','ok')}}

// Load models
async function loadModels(){
  const provider=providerSelect.value;state.currentProvider=provider;
  if(provider==='nim'){try{const res=await fetch('/nim-models');const data=await res.json();state.models=data.models||[];if(state.models.length>0){state.selectedModel=state.models[0].id;modelName.textContent=state.selectedModel}renderModels();setStatus(state.models.length+' NIM models loaded','ok',3000)}catch(e){setStatus('NIM model load failed','error')}return}
  try{const res=await fetch('/models');const data=await res.json();state.models=data.models||[];renderModels();setStatus(state.models.length+' models loaded','ok',3000)}catch(e){setStatus('Model load failed','error')}
}

function renderModels(){
  let models=state.models;if(freeOnly.checked)models=models.filter(m=>m.isFree);const q=modelSearch.value.toLowerCase();if(q)models=models.filter(m=>m.id.toLowerCase().includes(q));
  modelList.innerHTML='';if(!models.length){modelList.innerHTML='<div class="model-item" style="color:var(--text3)">No models</div>';return}
  models.forEach(m=>{const div=document.createElement('div');div.className='model-item'+(m.id===state.selectedModel?' selected':'')+(m.isFree?' model-item-free':'');div.textContent=m.id+(m.isFree?' FREE':'');div.addEventListener('click',()=>{selectModel(m.id);modelDropdown.classList.remove('open')});modelList.appendChild(div)});
}

function detectModelTier(model){const m=(model||'').toLowerCase();if(m.includes(':free')||m.includes('/free'))return'free';if(m.includes('gemini'))return'gemini';if(m.includes('flash'))return'flash';if(m.includes('nim'))return'nim';return'default'}
function getTierName(tier){return{free:'Free',gemini:'Gemini',flash:'Flash',nim:'NVIDIA NIM',default:'Standard'}[tier]||'Standard'}

function selectModel(id){
  state.selectedModel=id;modelName.textContent=id;const tier=detectModelTier(id);state.modelTier=tier;
  if(modelDropdownHeader)modelDropdownHeader.innerHTML=`<span>Select Model</span><span class="model-tier-badge">${getTierName(tier)}</span>`;
  $$('.model-item').forEach(i=>i.classList.remove('selected'));const item=[...modelList.querySelectorAll('.model-item')].find(i=>i.textContent.startsWith(id));if(item)item.classList.add('selected');
  if(statusTier){statusTier.textContent=getTierName(tier);statusTier.style.display=tier!=='default'?'inline-block':'none'}
  loadRecommendations();
}

async function loadRecommendations(){try{const res=await fetch('/recommendations?model='+encodeURIComponent(state.selectedModel));const data=await res.json();if(statusTokens)statusTokens.textContent=data.rec+' tokens';if(tokenManualMin)tokenManualMin.textContent=data.min;if(tokenManualMax)tokenManualMax.textContent=data.max;if(tokenManualRec)tokenManualRec.textContent=data.rec;if(state.tokenMode==='manual'&&manualTokenInput)manualTokenInput.placeholder='Tokens (rec: '+data.rec+')'}catch(e){}}
async function loadCredits(){try{const res=await fetch('/credits');const data=await res.json();if(data.limit){statusCredits.textContent='$'+Math.max(0,data.limit-data.usage).toFixed(2)}else{statusCredits.textContent='Free'}}catch(e){}}

async function generate(){
  const prompt=promptInput.value.trim();if(!prompt){toast('Enter a prompt','warning');return}if(!state.selectedModel){toast('Select a model','warning');return}
  setStatus('Generating...','busy');loadingOverlay.classList.remove('hidden');
  try{
    const res=await fetch('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,model:state.selectedModel,provider:providerSelect.value,tokenMode:state.tokenMode,manualTokens:state.tokenMode==='manual'?state.manualTokens:null})});
    const data=await res.json();
    if(data.files&&Object.keys(data.files).length){state.files={...state.files,...data.files};renderFileTree();buildPreview();btnDownload.classList.remove('hidden');toast('Generated '+Object.keys(data.files).length+' files','ok');setStatus('Generated','ok',5000);if(data.tokensUsed&&statusTokens)statusTokens.textContent=data.tokensUsed+' tokens'}
    if(data.warning)toast(data.warning,data.warning.includes('insufficient')?'error':'warning');
    promptInput.value='';
  }catch(e){toast('Error: '+e.message,'error');setStatus('Error','error')}finally{loadingOverlay.classList.add('hidden')}
}

function getFileIcon(name){
  const ext=(name||'').split('.').pop().toLowerCase();
  const colors={html:'#e44d26',css:'#563d7c',js:'#f7df1e',ts:'#3178c6',json:'#fbc02d',md:'#42a5f5',svg:'#ffb300',png:'#26a69a',jpg:'#26a69a',txt:'#90a4ae'};
  const c=colors[ext]||'var(--text3)';
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="${c}" stroke-width="1.1"/><path d="M9 1v4h4" stroke="${c}" stroke-width="1.1"/></svg>`;
}
function getLangFromFile(name){const ext=(name||'').split('.').pop().toLowerCase();return{html:'HTML',css:'CSS',js:'JavaScript',ts:'TypeScript',json:'JSON',md:'Markdown',svg:'SVG',txt:'Plain Text'}[ext]||'Plain Text'}

function renderFileTree(){
  const keys=Object.keys(state.files);const folders=Object.keys(state.folders||{});
  if(!keys.length&&!folders.length){fileTree.innerHTML='<div class="empty-tree"><p>No files yet</p><small>Generate or upload files</small></div>';return}
  const priority=['index.html','style.css','script.js'];
  keys.sort((a,b)=>{const pa=priority.indexOf(a),pb=priority.indexOf(b);if(pa!==-1&&pb!==-1)return pa-pb;if(pa!==-1)return-1;if(pb!==-1)return 1;return a.localeCompare(b)});
  fileTree.innerHTML='';
  folders.forEach(folder=>{
    const div=document.createElement('div');div.className='folder-item';
    div.innerHTML=`<svg class="chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="currentColor"/></svg><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4v8h12V6H8L6 4H2z" stroke="#dcb67a" stroke-width="1.1" fill="#dcb67a" fill-opacity="0.15"/></svg><span>${folder}</span>`;
    fileTree.appendChild(div);
  });
  keys.forEach(key=>{
    const size=new Blob([state.files[key]||'']).size;const sizeStr=size>1024?(size/1024).toFixed(1)+'KB':size+'B';
    const div=document.createElement('div');div.className='file-item'+(key===state.currentFile?' active':'');
    div.innerHTML=`<span class="file-icon">${getFileIcon(key)}</span><span class="file-item-name">${key}</span><span class="file-item-size">${sizeStr}</span><button class="file-del" title="Delete"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3"/></svg></button>`;
    div.addEventListener('click',e=>{if(e.target.closest('.file-del'))return;openFile(key)});
    div.querySelector('.file-del').addEventListener('click',e=>{e.stopPropagation();deleteFile(key)});
    fileTree.appendChild(div);
  });
}

function openFile(key){
  state.currentFile=key;$$('.file-item').forEach(f=>f.classList.toggle('active',f.querySelector('.file-item-name')?.textContent===key));
  fileTab.querySelector('.tab-label').textContent=key;
  if(breadcrumbFile)breadcrumbFile.textContent=key;
  if(statusLang)statusLang.textContent=getLangFromFile(key);
  const code=state.files[key]||'';codeContent.innerHTML=highlight(code,key);renderLineNums(code);closeEditor();
}

function renderLineNums(code){lineNums.innerHTML=code.split('\n').map((_,i)=>'<span>'+(i+1)+'</span>').join('')}
function deleteFile(key){if(!confirm('Delete '+key+'?'))return;delete state.files[key];if(state.currentFile===key)state.currentFile=null;renderFileTree();buildPreview();toast('Deleted','info')}
function handleUpload(e){Array.from(e.target.files).forEach(file=>{const reader=new FileReader();reader.onload=ev=>{state.files[file.name]=ev.target.result;renderFileTree();buildPreview();toast('Uploaded '+file.name,'ok')};reader.readAsText(file)});e.target.value=''}
function closeEditor(){codeEditor.classList.add('hidden');codeContent.classList.remove('hidden');btnEdit.classList.remove('hidden');btnSave.classList.add('hidden')}

function highlight(code,filename){
  const ext=(filename||'').split('.').pop().toLowerCase();const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');let r=esc(code);
  if(['js','ts','html','htm'].includes(ext)){r=r.replace(/(\/\/[^\n]*)/g,'<span style="color:#6A9955">$1</span>').replace(/(["'`](?:[^"'`\\]|\\.)*?["'`])/g,'<span style="color:#ce9178">$1</span>').replace(/\b(\d+(?:\.\d+)?)\b/g,'<span style="color:#b5cea8">$1</span>').replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|true|false|null|undefined|try|catch|throw)\b/g,'<span style="color:#569cd6">$1</span>')}
  if(ext==='css'){r=r.replace(/(\/\*[\s\S]*?\*\/)/g,'<span style="color:#6A9955">$1</span>').replace(/([.#]?[\w-]+)\s*\{/g,'<span style="color:#d7ba7d">$1</span> {').replace(/([\w-]+)\s*:/g,'<span style="color:#9cdcfe">$1</span>:')}
  return r;
}

function buildPreview(){
  const html=state.files['index.html'];if(!html){previewFrame.classList.remove('loaded');previewPlaceholder.classList.remove('hidden');return}
  previewPlaceholder.classList.add('hidden');let full=html;
  const st=state.files['style.css']?'<style>'+state.files['style.css']+'</style>':'';const sc=state.files['script.js']?'<script>'+state.files['script.js']+'<\/script>':'';
  full=full.replace('</head>',st+'</head>');full=full.replace('</body>',sc+'</body>');
  if(!full.includes('</head>')&&!full.includes('</body>'))full=st+sc+full;
  previewFrame.srcdoc=full;previewFrame.onload=()=>previewFrame.classList.add('loaded');
}

async function downloadZip(){
  if(!Object.keys(state.files).length)return;
  try{const res=await fetch('/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:state.files})});const blob=await res.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='project.zip';a.click();toast('Downloaded ZIP','ok')}catch(e){toast('Download failed','error')}
}

function addTerminalLine(text,type='output',isHtml=false){
  const div=document.createElement('div');
  if(isHtml){div.innerHTML=text}else{div.className='t-line '+({'output':'t-output','info':'t-info','error':'t-error','success':'t-success','warning':'t-warning','cmd':'t-cmd','stderr':'t-stderr'}[type]||'t-output');div.textContent=text}
  terminalOutput.appendChild(div);terminalOutput.scrollTop=terminalOutput.scrollHeight;
}

async function handleTerminalInput(e){
  if(e.key!=='Enter')return;const cmd=terminalInput.value.trim();if(!cmd)return;terminalInput.value='';
  addTerminalLine('❯ '+cmd,'cmd');
  if(cmd==='clear'){terminalOutput.innerHTML='';return}
  if(cmd==='help'){addTerminalLine('WebForge Terminal Help','info');addTerminalLine('─'.repeat(40),'info');addTerminalLine('/connect <api-key> - Connect to OpenCode','info');addTerminalLine('opencode - Launch OpenCode assistant','info');addTerminalLine('clear - Clear terminal','info');addTerminalLine('help - Show help','info');addTerminalLine('exit - Close panel','info');addTerminalLine('─'.repeat(40),'info');addTerminalLine('Shell: ls, cd, cat, node, npm, etc.','info');return}
  if(cmd==='opencode'){addTerminalLine('OpenCode mode ready!','success');addTerminalLine('Use /connect <your-api-key> to authenticate','info');return}
  if(cmd==='exit'){panelArea.classList.add('hidden');return}
  if(cmd.startsWith('/connect ')){
    const apiKey=cmd.substring(9).trim();if(!apiKey){addTerminalLine('Usage: /connect <your-api-key>','error');return}
    addTerminalLine('Connecting to OpenCode...','info');
    try{const res=await fetch('/opencode/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey})});const data=await res.json();
      if(res.ok&&data.success){state.opencodeApiKey=apiKey;state.opencodeConnected=true;state.opencodeHistory=[];addTerminalLine('Connected to OpenCode!','success');addTerminalLine('Now type your request or question','info')}else{addTerminalLine(data.error||'Connection failed','error')}
    }catch(ex){addTerminalLine('Connection error: '+ex.message,'error')}return;
  }
  if(state.opencodeConnected){
    addTerminalLine('Sending to OpenCode...','info');state.opencodeHistory.push({role:'user',content:cmd});
    try{const res=await fetch('/opencode/chat/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiKey:state.opencodeApiKey,messages:[{role:'system',content:'You are a helpful coding assistant. Help with code questions, file creation, and general programming tasks.'},...state.opencodeHistory]})});
      const reader=res.body.getReader();const decoder=new TextDecoder();let responseText='',buffer='';
      const responseDiv=document.createElement('div');responseDiv.className='t-line t-output t-streaming';terminalOutput.appendChild(responseDiv);
      while(true){const{done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();
        for(const line of lines){if(line.startsWith('data: ')){try{const data=JSON.parse(line.slice(6));if(data.error){addTerminalLine('OpenCode error: '+data.error,'error');state.opencodeHistory.pop();return}if(data.chunk){responseText+=data.chunk;responseDiv.textContent=responseText;terminalOutput.scrollTop=terminalOutput.scrollHeight}if(data.done)responseDiv.classList.remove('t-streaming')}catch(ex){}}}}
      if(responseText)state.opencodeHistory.push({role:'assistant',content:responseText});else{state.opencodeHistory.pop();addTerminalLine('No response','warning')}
    }catch(ex){addTerminalLine('Error: '+ex.message,'error');state.opencodeHistory.pop()}return;
  }
  addTerminalLine('Executing...','info');
  try{const res=await fetch('/terminal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd,stream:true})});
    const reader=res.body.getReader();const decoder=new TextDecoder();let buffer='';
    while(true){const{done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();
      for(const line of lines){if(line.startsWith('data: ')){try{const data=JSON.parse(line.slice(6));if(data.type==='stdout')addTerminalLine(data.data,'output');else if(data.type==='stderr')addTerminalLine(data.data,'stderr');else if(data.type==='error')addTerminalLine(data.data,'error')}catch(ex){}}}}
    if(buffer.startsWith('data: ')){try{const data=JSON.parse(buffer.slice(6));if(data.type==='done'&&data.exitCode!==0)addTerminalLine('Exit code: '+data.exitCode,'warning')}catch(ex){}}
  }catch(ex){addTerminalLine('Error: '+ex.message,'error')}
}

function setStatus(msg,type='',duration=0){statusText.textContent=msg;statusBar.className='status-bar '+(type||'');if(duration)setTimeout(()=>{if(statusText.textContent===msg)setStatus('Ready')},duration)}
function toast(msg,type='info',duration=4000){
  const t=document.createElement('div');t.className='toast '+type;
  const icons={ok:'<path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',error:'<circle cx="8" cy="8" r="6" stroke="currentColor"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor"/>',warning:'<path d="M8 2L1 14h14L8 2z" stroke="currentColor"/><path d="M8 6v4M8 11v.5" stroke="currentColor"/>',info:'<circle cx="8" cy="8" r="6" stroke="currentColor"/><path d="M8 7v4M8 5v.5" stroke="currentColor"/>'};
  t.innerHTML=`<svg class="toast-icon" viewBox="0 0 16 16" fill="none">${icons[type]||icons.info}</svg><div class="toast-content"><div class="toast-title">${msg}</div></div>`;
  toastContainer.appendChild(t);setTimeout(()=>t.classList.add('removing'),duration);setTimeout(()=>t.remove(),duration+300);
}

init();