function modelField(value,max=5000){
  if(typeof value!=='string' || value.length>max) throw new Error('Champ invalide ou trop long.');
  return value.trim();
}
function option(value,values){
  if(!values.includes(value)) throw new Error('Valeur non reconnue.');
  return value;
}
function applyChange(state,change){
  const {action,item}=change;
  const date=new Date().toISOString();
  if(action==='project'){
    const existing=state.projects.find(project=>project.id===item.id);
    if(item.id && !existing) throw new Error('Projet introuvable.');
    const updated={id:existing?.id??crypto.randomUUID(),name:modelField(item.name,140),domain:option(item.domain,domains),description:modelField(item.description)};
    if(!updated.name) throw new Error('Saisissez le nom du projet.');
    state.projects=existing?state.projects.map(project=>project.id===existing.id?updated:project):[...state.projects,updated];
    state.history.unshift({date,title:updated.name,detail:existing?'Projet modifié.':'Projet créé.'});
    return;
  }
  const existing=state.tasks.find(task=>task.id===item.id);
  if(action==='approve'||action==='return'){
    if(!existing||!existing.gate||existing.status!==statuses[2]) throw new Error('Cette action ne figure plus dans la file.');
    const note=modelField(item.note);
    if(!note) throw new Error('Ajoutez une note pour préciser la portée ou les corrections.');
    existing.approval=action==='approve'?note:'';
    existing.status=action==='approve'?statuses[1]:statuses[0];
    state.history.unshift({date,title:existing.title,detail:(action==='approve'?'Autorisation consignée · ':'Renvoyé pour révision · ')+note});
    return;
  }
  if(action!=='task'||(item.id&&!existing)) throw new Error('Action introuvable.');
  const task={id:existing?.id??crypto.randomUUID(),project:option(item.project,state.projects.map(p=>p.id)),title:modelField(item.title,150),owner:option(item.owner,owners),priority:option(item.priority,['Haute','Normale','Basse']),next:modelField(item.next),sources:modelField(item.sources),deliverables:modelField(item.deliverables),notes:modelField(item.notes),kind:option(item.kind,kinds),status:option(item.status,statuses),due:modelField(item.due,10),gate:existing?.gate||item.gate===true,approval:existing?.approval??''};
  const rawProgress=item.progress===undefined?existing?.progress:item.progress;
  if(task.kind===kinds[0]&&rawProgress!==''&&rawProgress!=null){
    if(!/^\d{1,2}$/.test(String(rawProgress))) throw new Error('La progression doit être un entier de 0 à 99.');
    task.progress=Number(rawProgress);
  }else if(existing?.progress!==undefined){
    task.progress=null;
  }
  if(!task.title||!task.next) throw new Error('Renseignez un titre et une prochaine action.');
  if(task.kind==='Fait vérifié' && !task.sources) throw new Error('Ajoutez une source au fait vérifié.');
  if(task.due){
    const date=new Date(task.due+'T12:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(task.due)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==task.due) throw new Error('Échéance invalide.');
  }
  if(task.approval && ['title','owner','project','kind','next','sources','deliverables','notes'].some(key=>task[key]!==existing[key])) task.approval='';
  if(task.gate && task.status===statuses[2]) task.approval='';
  if(task.gate && task.status===statuses[3] && !task.approval) throw new Error('Une autorisation est requise avant de clôturer cette action.');
  state.tasks=existing?state.tasks.map(current=>current.id===task.id?task:current):[...state.tasks,task];
  const changes=existing?Object.keys(task).filter(key=>task[key]!==existing[key]):[];
  if(!existing||changes.length){
    const labels={project:'projet',title:'titre',owner:'pilote',priority:'priorité',next:'suite',sources:'sources',deliverables:'livrables',notes:'contexte',kind:'type',status:'statut',due:'échéance',gate:'validation requise',approval:'autorisation',progress:'progression'};
    const detail=existing?changes.map(key=> key==='status'?existing.status+' → '+task.status : labels[key]+' modifié').join(' · '):'Fiche créée · '+task.kind+' · '+task.status;
    state.history.unshift({date,title:task.title,detail});
  }
}

const byId=id=>document.getElementById(id);
const statuses=['À traiter','En cours','En attente de validation','Terminé','Bloqué'];
const kinds=['Action à faire','Fait vérifié','Hypothèse','Décision'];
const owners=['ChatGPT','Claude','Vibe','Moi'];
const roles=[
  'Analyse les demandes, propose les prochaines actions et vérifie le code et les tests.',
  'Relit les livrables, approfondit les sujets complexes et prépare les documents et les entretiens.',
  'Coordonne les relais, suit les échéances et prépare les mises à jour de l’agenda sur accord.',
  'Fixe les priorités, tranche les décisions et autorise les actions externes.'
];
const domains=['Emploi / cyber','Projets techniques','Finances / admin','Organisation personnelle'];
const domainIcons=['▧','⌘','▤','◇'];
const parisToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const isLate=task=>task.kind===kinds[0]&&task.status!==statuses[3]&&task.due&&task.due<parisToday();
const nav=[['overview','◉','Vue d’ensemble'],['resume','▶','Reprendre en 10 minutes'],['tasks','☷','Registre des fiches'],['team','◇','Agents IA'],['queue','◷','Validations'],['history','↺','Historique']];
const pages=[...nav,...domains.map((domain,i)=>['domain-'+i,domainIcons[i],domain])];
let state, current='overview', filters={}, formAction, formItem;
const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const htmlDate=value=>{
  if(!value)return '—';
  const dayOnly=value.length===10;
  return new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',...(dayOnly?{}:{timeStyle:'short'}),timeZone:'Europe/Paris'}).format(new Date(dayOnly?value+'T12:00:00Z':value));
};
const link=(url,label)=>'<a class="source" href="'+escapeText(url)+'" '+(url.startsWith('#')?'':'target="_blank" rel="noopener noreferrer"')+'>'+escapeText(label)+' ↗</a>';
const links=value=>String(value||'').split('\n').filter(Boolean).map(line=>{
  const clean=line.trim();
  try {
    const url=new URL(clean);
    if(['http:','https:'].includes(url.protocol)) return link(url.href,url.hostname);
  } catch {}
  return '<p>'+escapeText(clean)+'</p>';
}).join('');
const badge=status=>'<span class="badge tone-'+statuses.indexOf(status)+'">'+escapeText(status)+'</span>';
const options=(items,selected,all)=> (all?'<option value="">'+escapeText(all)+'</option>':'')+items.map(item=>{
  const value=typeof item==='string'?item:item.id;
  const caption=typeof item==='string'?item:item.name;
  return '<option value="'+escapeText(value)+'" '+(value===selected?'selected':'')+'>'+escapeText(caption)+'</option>';
}).join('');
const hero=(tag,title,description)=>'<section class="hero"><div class="eyebrow">'+tag+'</div><h1>'+escapeText(title)+'</h1><p>'+escapeText(description)+'</p></section>';
const projectOf=task=>state.projects.find(project=>project.id===task.project);
const active=tasks=>tasks.filter(task=>task.kind===kinds[0]&&task.status!==statuses[3]);
const ordered=tasks=>[...tasks].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||['Haute','Normale','Basse'].indexOf(a.priority)-['Haute','Normale','Basse'].indexOf(b.priority));
const pending=()=>state.tasks.filter(task=>task.status===statuses[2]);
const taskButton=task=>'<button class="link-button" data-action="editTask" data-id="'+escapeText(task.id)+'">'+escapeText(task.title)+'</button>';
function stats(tasks){
  return '<div class="stats">'+statuses.map((status,i)=>'<button data-action="status" data-id="'+i+'" class="stat tone-'+i+(filters.status===status?' selected':'')+'"><strong>'+tasks.filter(t=>t.kind===kinds[0]&&t.status===status).length+'</strong><span>'+status+'</span></button>').join('')+'</div>';
}
function projectsList(projects){
  return '<div class="projects">'+projects.map(project=>{
    const total=active(state.tasks.filter(task=>task.project===project.id)).length;
    return '<button class="project" data-action="projectView" data-id="'+escapeText(project.id)+'"><span class="project-icon">'+domainIcons[domains.indexOf(project.domain)]+'</span><strong class="project-title">'+escapeText(project.name)+'</strong><p>'+escapeText(project.description)+'</p><small>'+total+' action'+(total===1?' ouverte':'s ouvertes')+' →</small></button>';
  }).join('')+'</div>';
}
function taskProgress(task){
  return task.status===statuses[3]?100:(task.progress??null);
}
function progressBar(value,label){
  const meter=value===null
    ? '<progress class="unset" max="100" value="0" aria-hidden="true"></progress>'
    : '<progress max="100" value="'+value+'" aria-label="'+escapeText(label)+'"></progress>';
  return '<span class="progress-meter">'+meter+'<span>'+(value===null?'Non renseigné':value+' %')+'</span></span>';
}
function ownerCard(owner,index,tasks){
  const assigned=tasks.filter(task=>task.kind===kinds[0]&&task.owner===owner);
  const known=assigned.map(taskProgress).filter(value=>value!==null);
  const average=known.length?Math.round(known.reduce((sum,value)=>sum+value,0)/known.length):null;
  return '<button class="person '+(filters.owner===owner?'selected':'')+'" data-action="owner" data-id="'+owner+'" aria-pressed="'+(filters.owner===owner)+'"><span class="avatar">'+['G','C','V','M'][index]+'</span><strong>'+owner+'</strong><p>'+roles[index]+'</p>'+progressBar(average,'Progression moyenne de '+owner)+'<small>'+known.length+' / '+assigned.length+' tâches avec une progression renseignée</small></button>';
}
function rows(tasks){
  const query=(filters.query||'').toLocaleLowerCase('fr');
  const result=ordered(tasks.filter(task=>
    (!filters.late||isLate(task)) && ['project','owner','kind','status','priority'].every(key=>!filters[key]||task[key]===filters[key]) &&
    (!query||[task.title,task.next,task.notes,projectOf(task)?.name].some(value=>value?.toLocaleLowerCase('fr').includes(query)))));
  if(!result.length)return '<p class="empty">Aucune fiche dans cette vue.</p>';
  return '<div class="table-wrap"><table><thead><tr><th scope="col">Fiche / prochaine action</th><th scope="col">Pilote</th><th scope="col">Statut</th><th scope="col">Priorité</th><th scope="col">Échéance</th><th scope="col">Progression</th></tr></thead><tbody>'+result.map(task=>'<tr><td>'+taskButton(task)+'<small>'+escapeText(projectOf(task)?.name)+' · '+escapeText(task.kind)+'</small><small>'+escapeText(task.next)+'</small></td><td>'+escapeText(task.owner)+'</td><td>'+(task.kind===kinds[0]?badge(task.status):'—')+'</td><td class="'+(task.priority==='Haute'?'high':'')+'">'+escapeText(task.priority)+'</td><td>'+htmlDate(task.due)+(isLate(task)?'<small class="high">En retard</small>':'')+'</td><td>'+(task.kind===kinds[0]?progressBar(taskProgress(task),'Progression de '+task.title):'—')+'</td></tr>').join('')+'</tbody></table></div>';
}
function taskPanel(tasks,title,withFilters=false){
  return '<section class="panel section"><div class="panel-header"><h2>'+title+'</h2>'+(withFilters?'<div class="filters"><input id="query" aria-label="Rechercher une fiche" placeholder="Rechercher…" value="'+escapeText(filters.query)+'">'+[['owner',owners,'Tous les pilotes'],['status',statuses,'Tous les statuts'],['project',state.projects,'Tous les projets'],['kind',kinds,'Tous les types'],['priority',['Haute','Normale','Basse'],'Toutes les priorités']].map(([key,items,label])=>'<select data-filter="'+key+'" aria-label="'+label+'">'+options(items,filters[key],label)+'</select>').join('')+'<label class="check"><input type="checkbox" data-filter="late" '+(filters.late?'checked':'')+'> En retard</label></div>':'')+'</div><div id="tableResults">'+rows(tasks)+'</div></section>';
}
function taskScope(){
  if(current.startsWith('domain-'))return state.tasks.filter(task=>projectOf(task)?.domain===domains[Number(current.slice(7))]);
  if(current.startsWith('project/'))return state.tasks.filter(task=>task.project===current.slice(8));
  return state.tasks;
}
function pickNextTask(tasks,today){
  const urgency=task=>task.due&&task.due<=today?0:task.status===statuses[1]?1:2;
  const priorities=['Haute','Normale','Basse'];
  return tasks.filter(task=>task.kind===kinds[0]&&task.owner==='Moi'&&[statuses[0],statuses[1]].includes(task.status)&&task.next?.trim())
    .sort((a,b)=>urgency(a)-urgency(b)||priorities.indexOf(a.priority)-priorities.indexOf(b.priority)||(a.due||'9999').localeCompare(b.due||'9999'))[0];
}
function resumeView(tasks){
  const task=pickNextTask(tasks,parisToday());
  const intro=hero('Reprise','Reprendre en 10 minutes','Une action qui t’est attribuée, avec assez de contexte pour commencer.');
  if(!task) return intro+'<section class="panel"><h2>Aucune action prête à reprendre</h2><p>Ouvre le registre pour choisir une tâche et préciser sa prochaine action.</p><a class="source" href="#tasks">Ouvrir le registre →</a></section>';
  const project=projectOf(task);
  return intro+'<section class="panel resume-card"><div class="panel-header"><h2>'+taskButton(task)+'</h2>'+badge(task.status)+'</div>'
    +'<p>'+escapeText(project?.name)+' · Priorité '+escapeText(task.priority)+(task.due?' · Échéance '+htmlDate(task.due):'')+'</p>'
    +'<h3>Prochaine action</h3><p>'+escapeText(task.next)+'</p>'
    +'<ol><li>Prends deux minutes pour relire la fiche et ses sources.</li><li>Avance sur la prochaine action, puis note le point de reprise dans la fiche.</li></ol>'
    +(task.sources?'<div class="sources">'+links(task.sources)+'</div>':'')
    +'<button class="primary" data-action="editTask" data-id="'+escapeText(task.id)+'">Ouvrir la fiche</button></section>';
}
function render(){
  if(!state)return;
  const activePage=pages.find(page=>page[0]===current);
  const project=current.startsWith('project/')?state.projects.find(p=>p.id===current.slice(8)):null;
  byId('trail').textContent='Espace de travail / '+(activePage?.[2]??project?.name??'Projet');
  byId('nav').innerHTML=[...pages.slice(0,nav.length),null,...pages.slice(nav.length)].map(page=>page?'<a class="nav-link '+(current===page[0]?'active':'')+'" href="#'+page[0]+'" '+(current===page[0]?'aria-current="page"':'')+'><span class="nav-icon" aria-hidden="true">'+page[1]+'</span>'+page[2]+(page[0]==='queue'&&pending().length?' · '+pending().length:'')+'</a>':'<div class="nav-label">Domaines</div>').join('');
  const scoped=taskScope();
  let body;
  if(current==='overview'){
    const highlights=ordered(active(state.tasks)).filter(task=>task.priority==='Haute'||task.due).slice(0,5);
    body=hero('Vue d’ensemble','Tableau de bord','Retrouvez les priorités, les projets ouverts et les prochaines actions de l’équipe.')+stats(state.tasks)
      +'<section class="section"><div class="section-title"><h2>Projets</h2><span class="subtle">'+state.projects.length+' dans le QG</span></div>'+projectsList(state.projects)+'</section>'
      +'<div class="split">'+taskPanel(highlights,'Priorités et échéances')+'<section class="panel section"><h2>QG partagé</h2><p class="subtle">Parcours de démonstration et code à partager.</p><div class="sources">'+link('#team','Rôles de l’équipe')+link('#queue','Essayer la validation')+'</div></section></div>';
  }else if(current==='resume'){
    body=resumeView(scoped);
  }else if(current==='tasks'){
    body=hero('Registre','Tâches et repères','Recherchez les actions, faits vérifiés, hypothèses et décisions par projet et par pilote.')+taskPanel(scoped,'Toutes les fiches',true);
  }else if(current==='team'){
    body=hero('Coordination','Agents IA','Rôles, tâches attribuées et progression moyenne sur les tâches renseignées.')
      +'<div class="people">'+owners.map((owner,index)=>ownerCard(owner,index,scoped)).join('')+'</div>'
      +taskPanel(scoped,'Fiches par pilote',true);
  }else if(current==='queue'){
    body=hero('Validation','File de validation','Relisez le contenu et la portée avant d’autoriser une action publique ou irréversible.')
      +'<div class="queue">'+(pending().map(task=>'<article class="panel">'+badge(task.status)+'<h3>'+taskButton(task)+'</h3><p>'+escapeText(task.owner)+' · '+escapeText(projectOf(task)?.name)+'</p><p>'+escapeText(task.next)+'</p><p>'+escapeText(task.deliverables)+'</p><div class="sources">'+links(task.sources)+'</div><footer>'+(task.gate?'<button class="primary" data-action="approve" data-id="'+escapeText(task.id)+'">Consigner l’autorisation</button><button data-action="return" data-id="'+escapeText(task.id)+'">Demander une révision</button>':'<button data-action="editTask" data-id="'+escapeText(task.id)+'">Ouvrir la fiche</button>')+'</footer></article>').join('')||'<div class="panel"><h2>Aucune demande en attente</h2><p>Choisissez « En attente de validation » dans une fiche pour l’ajouter à cette file.</p></div>')+'</div>';
  }else if(current==='history'){
    const decisions=state.tasks.filter(task=>task.kind==='Décision');
    body=hero('Traçabilité','Historique','Consultez les décisions et l’historique des modifications du Site.')
      +'<section class="panel"><h2>Décisions</h2>'+decisions.map(task=>'<article class="entry"><h3>'+taskButton(task)+'</h3><p>'+escapeText(task.notes)+'</p><div class="sources">'+links(task.sources)+'</div></article>').join('')+'</section>'
      +'<section class="panel section"><h2>Changements et validations</h2>'+state.history.map(event=>'<article class="entry"><time>'+htmlDate(event.date)+'</time><h3>'+escapeText(event.title)+'</h3><p>'+escapeText(event.detail)+'</p>'+(event.source?link(event.source,'Source'):'')+'</article>').join('')+'</section>';
  }else if(project){
    body=hero(escapeText(project.domain),project.name,project.description)+stats(scoped)
      +'<div class="section"><button data-action="editProject" data-id="'+escapeText(project.id)+'">Modifier le projet</button></div>'
      +taskPanel(scoped,'Reprendre le projet',true);
  }else if(current.startsWith('domain-')&&activePage){
    const domain=activePage[2];
    body=hero('Tableau de bord',domain,'Suivez les projets, les échéances et les prochaines actions de ce domaine.')+stats(scoped)
      +'<section class="section"><div class="section-title"><h2>Projets</h2></div>'+projectsList(state.projects.filter(p=>p.domain===domain))+'</section>'+taskPanel(scoped,'Fiches du domaine',true);
  }else{
    body=hero('Projets','Page introuvable','Revenez à la vue d’ensemble pour ouvrir un projet.');
  }
  byId('content').innerHTML=body;
}
function field(label,name,value='',type='text',extra=''){
  const full=['textarea','check'].includes(type)?' wide':'';
  const control=type==='textarea'?'<textarea name="'+name+'" '+extra+'>'+escapeText(value)+'</textarea>':'<input name="'+name+'" type="'+type+'" value="'+escapeText(value)+'" '+extra+'>';
  return '<label class="'+full+'">'+label+control+'</label>';
}
function select(label,name,items,value){
  return '<label>'+label+'<select name="'+name+'">'+options(items,value)+'</select></label>';
}
function openForm(action,item={}){
  formAction=action;formItem=item;
  let title,fields;
  if(action==='project'){
    title=item.id?'Modifier le projet':'Nouveau projet';
    fields=field('Nom du projet','name',item.name,'text','required maxlength="140"')
      +select('Domaine','domain',domains,item.domain??domains[Number(current.slice(7))])
      +field('Contexte du projet','description',item.description,'textarea');
  }else if(action==='approve'||action==='return'){
    title=action==='approve'?'Consigner l’autorisation':'Demander une révision';
    fields='<p class="wide">'+escapeText(item.title)+'</p>'+field(action==='approve'?'Portée précise de l’autorisation':'Corrections demandées','note','','textarea','required');
  }else{
    title=item.id?'Modifier la fiche':'Nouvelle fiche';
    fields=field('Titre','title',item.title,'text','required maxlength="150"')
      +select('Projet','project',state.projects,item.project??(current.startsWith('project/')?current.slice(8):state.projects.find(p=>p.domain===domains[Number(current.slice(7))])?.id))
      +select('Type','kind',kinds,item.kind)+select('Pilote','owner',owners,item.owner??'Moi')
      +select('Statut','status',statuses,item.status)+select('Priorité','priority',['Normale','Haute','Basse'],item.priority)
      +field('Échéance','due',item.due,'date')
      +field('Progression estimée (0 à 99 %)', 'progress', item.progress??'', 'number', 'min="0" max="99" step="1" placeholder="Non renseigné"')
      +'<p class="wide subtle">Le statut « Terminé » affiche 100 %. Laissez le champ vide si la progression est inconnue.</p>'
      +field('Prochaine action','next',item.next,'textarea','required')
      +field('Contexte / état de reprise','notes',item.notes,'textarea')
      +field('Sources (un lien ou repère par ligne)','sources',item.sources,'textarea')
      +field('Livrables attendus ou liens vers les preuves','deliverables',item.deliverables,'textarea')
      +'<div class="detail-links wide sources">'+links(item.sources)+links(item.deliverables)+'</div>'
      +'<label class="check wide"><input type="checkbox" name="gate" '+(item.gate?'checked disabled':'')+'> Action publique ou irréversible · autorisation requise</label>'
      +(item.approval?'<p class="wide">Autorisation consignée · '+escapeText(item.approval)+'</p>':'')
      +(item.id?'<div class="wide"><button id="handoff" type="button">Préparer une transmission</button><div id="handoffText"></div></div>':'');
  }
  byId('dialogTitle').textContent=title;
  byId('fields').innerHTML='<div class="form-grid">'+fields+'</div>';
  byId('formError').textContent='';
  if(byId('handoff'))byId('handoff').onclick=()=>showHandoff(item);
  byId('save').textContent=action==='approve'?'Autoriser':action==='return'?'Renvoyer':'Enregistrer';
  if(!byId('dialog').open)byId('dialog').showModal();
}
function showHandoff(item){
  const context=['Fiche QG — '+item.title,'Projet : '+projectOf(item)?.name,'Pilote : '+item.owner,'Statut : '+item.status,'Type : '+item.kind,'Échéance : '+(item.due||'à renseigner'),'Prochaine action : '+item.next].join('\n');
  const release=item.gate?'\nValidation humaine requise pour l’action externe.':'';
  const request='\n\nPropose une suite et indique ce qui reste à vérifier. Fournis tes sources et la prochaine action.';
  const target=byId('handoffText');
  target.innerHTML='<p class="subtle">Relisez le texte avant de le transmettre. Vous pouvez ajouter les liens autorisés.</p><textarea id="handoffDraft" aria-label="Texte à copier"></textarea><button id="handoffCopy" type="button">Copier</button><span id="handoffFeedback" role="status"></span>';
  const draft=byId('handoffDraft');
  draft.value=context+release+request;
  draft.focus();
  draft.select();
  byId('handoffCopy').onclick=async()=>{
    try{await navigator.clipboard.writeText(draft.value);byId('handoffFeedback').textContent=' Copié.';}
    catch{draft.focus();draft.select();byId('handoffFeedback').textContent=' Copiez le texte sélectionné.';}
  };
}
function load(){
  state=makeDemoState();
  render();
}
byId('resetDemo').onclick=()=>{
  filters={};
  load();
  byId('notice').textContent='Démonstration réinitialisée.';
};
byId('form').addEventListener('submit',async event=>{
  event.preventDefault();
  const fields=new FormData(event.currentTarget);
  const item={...Object.fromEntries(fields),id:formItem.id,gate:fields.has('gate')};
  const rev=state.rev;
  byId('save').disabled=true;
  byId('formError').textContent='';
  try{
    const next=structuredClone(state);
    applyChange(next,{rev,action:formAction,item});
    state={...next,rev:rev+1};
    byId('dialog').close();
    byId('notice').textContent='Modification enregistrée.';
    render();
  }catch(error){byId('formError').textContent=error.message;}
  finally{byId('save').disabled=false;}
});
for(const button of ['close','cancel'])byId(button).onclick=()=>byId('dialog').close();
byId('newProject').onclick=()=>state&&openForm('project');
byId('newTask').onclick=()=>state&&openForm('task');
byId('content').addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');
  if(!button)return;
  const {action,id}=button.dataset;
  if(action==='retry'){load();return;}
  if(action==='status'){
    const status=statuses[Number(id)];
    if(current==='overview'){
      location.hash='tasks';
      current='tasks';
      filters={status,kind:kinds[0]};
    }else filters={...filters,status:filters.status===status?'':status,kind:kinds[0]};
    render();
  }
  if(action==='owner'){filters.owner=filters.owner===id?'':id;render();}
  if(action==='projectView')location.hash='project/'+id;
  if(action==='editProject')openForm('project',state.projects.find(p=>p.id===id));
  if(['editTask','approve','return'].includes(action))openForm(action==='editTask'?'task':action,state.tasks.find(t=>t.id===id));
});
byId('content').addEventListener('input',event=>{
  if(event.target.id!=='query'&&!event.target.dataset.filter)return;
  filters[event.target.dataset.filter??'query']=event.target.type==='checkbox'?event.target.checked:event.target.value;
  byId('tableResults').innerHTML=rows(taskScope());
});
function route(){
  const page=location.hash.slice(1)||'overview';
  if(page!==current)filters={};
  current=page;
  render();
}
window.addEventListener('hashchange',route);
route();
load();

function makeDemoState(){
  const date=(offset)=>{
    const day=new Date();
    day.setDate(day.getDate()+offset);
    return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(day);
  };
  const projects=[
    {id:'demo-emploi',name:'Portefeuille de candidatures',domain:domains[0],description:'Préparer un dossier de candidature et faire relire les pièces.'},
    {id:'demo-tech',name:'Contrôles qualité',domain:domains[1],description:'Suivre la préparation et la publication d’un tableau de bord de test.'},
    {id:'demo-admin',name:'Suivi des abonnements',domain:domains[2],description:'Préparer une revue des renouvellements et des échéances.'},
    {id:'demo-perso',name:'Atelier de présentation',domain:domains[3],description:'Préparer une démonstration et répartir les retours.'}
  ];
  const task=(id,project,title,owner,next,overrides={})=>({
    id,project,title,owner,next,status:'À traiter',kind:'Action à faire',due:'',priority:'Normale',
    notes:'Scénario fictif.',sources:'',deliverables:'',gate:false,approval:'',...overrides
  });
  return {rev:0,projects,tasks:[
    task('cv','demo-emploi','Relire le CV de démonstration','Claude','Vérifier que chaque compétence est illustrée par un exemple.',{due:date(3),progress:30,priority:'Haute',deliverables:'Liste des formulations à retravailler.'}),
    task('review','demo-tech','Vérifier les tests du tableau de bord','ChatGPT','Relire les résultats et signaler les cas à couvrir.',{due:date(2),status:'En cours',progress:65,priority:'Haute',sources:'Cahier de validation fictif · QA-03'}),
    task('publish','demo-tech','Autoriser la publication du tableau de bord fictif','Moi','Vérifier le contenu de la page et préciser le public autorisé.',{status:'En attente de validation',gate:true,due:date(1),progress:85,deliverables:'Aperçu de la page fictive et liste des données affichées.',sources:'Dossier de publication fictif · PUB-01'}),
    task('renewal','demo-admin','Confirmer la date d’un renouvellement','Vibe','Attendre la confirmation de la date par le fournisseur fictif.',{status:'Bloqué',progress:25,due:date(-2),priority:'Haute'}),
    task('agenda','demo-perso','Préparer le déroulé de l’atelier','Moi','Lister les étapes et faire relire la durée de chaque partie.',{due:date(5),progress:0}),
    task('fact','demo-tech','Le jeu d’essai couvre trois navigateurs','ChatGPT','Étendre le jeu d’essai au prochain passage.',{kind:'Fait vérifié',sources:'Rapport de test fictif · QA-01'}),
    task('hypothesis','demo-admin','Un renouvellement pourrait être repoussé','Vibe','Relever la clause et confirmer la date.',{kind:'Hypothèse'}),
    task('decision','demo-perso','Préférer une démonstration de cinq minutes','Moi','Préparer un passage par la file de validation.',{kind:'Décision',notes:'Décision du scénario de démonstration.'})
  ],history:[{date:date(-1),title:'Format de l’atelier',detail:'Décision du scénario : prévoir cinq minutes pour le parcours.'}]};
}
