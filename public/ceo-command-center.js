import {mountCeoTaskWorkspace} from './ceo-tasks.js';

// A presentation mount only: all authority/state remain in the existing CEO task service.
function install(){
 if(document.getElementById('ceoOperatingPanel'))return;
 const ledger=document.getElementById('systemLedgerPanel');if(!ledger)return;
 const panel=document.createElement('article');panel.id='ceoOperatingPanel';panel.className='panel ceo-command-panel';
 const heading=document.createElement('div');heading.className='ceo-command-heading';
 const title=document.createElement('h3');title.textContent='CEO 经营任务';
 const description=document.createElement('p');description.textContent='对话与指挥台共享任务、审批和回执；演练记录不计作真实经营成果。';
 heading.append(title,description);panel.append(heading);ledger.before(panel);
 if(location.protocol!=='http:'||!['localhost','127.0.0.1'].includes(location.hostname)){
  const warning=document.createElement('p');warning.textContent='经营任务当前仅支持本机指挥台连接。';panel.append(warning);return;
 }
 const root=document.createElement('div');panel.append(root);
 mountCeoTaskWorkspace(root,{apiBase:`http://${location.hostname}:3173/api/ceo/`});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
