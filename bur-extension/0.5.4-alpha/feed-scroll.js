/* Feed scroll selection: tested separately against nested scroll containers. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;root.BurFeedScroll=api;})(typeof window!=='undefined'?window:globalThis,function(){
'use strict';
function visibleDialogs(doc,view){
 const vw=Math.max(1,Number(view.innerWidth)||1200),vh=Math.max(1,Number(view.innerHeight)||800),out=[];
 const dialogs=[...(doc.querySelectorAll?.('[role="dialog"],[aria-modal="true"],dialog[open]')||[])];
 for(const el of dialogs){
  if(el.getAttribute('aria-hidden')==='true'||el.closest('[aria-hidden="true"]'))continue;
  let style;try{style=view.getComputedStyle(el);}catch{continue;}
  if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;
  const rect=el.getBoundingClientRect?.();
  if(!rect||rect.width<=0||rect.height<=0||rect.bottom<=0||rect.right<=0||rect.top>=vh||rect.left>=vw)continue;
  const coverage=Math.min(vw,Math.max(0,rect.right)-Math.max(0,rect.left))*Math.min(vh,Math.max(0,rect.bottom)-Math.max(0,rect.top))/(vw*vh);
  if(coverage<.12&&el.getAttribute('aria-modal')!=='true')continue;
  out.push({el,coverage});
 }
 return out;
}
function obstruction(doc,view){
 const first=visibleDialogs(doc,view)[0];if(!first)return null;const el=first.el;
 return {kind:'facebook_dialog',role:el.getAttribute('role')||el.tagName.toLowerCase(),coverage:Math.round(first.coverage*100),media:Boolean(el.querySelector('img,video'))};
}
function getCandidates(doc,view){
 const root=doc.scrollingElement||doc.documentElement;
 const feed=doc.querySelector('[role="feed"]');
 const nodes=[];const add=n=>{if(n&&!nodes.includes(n))nodes.push(n);};
 // The proven bookmarklet started with ancestors of the feed, NOT [role=main].
 for(let n=feed;n&&n!==doc.body;n=n.parentElement){
   let overflow='';try{overflow=view.getComputedStyle(n).overflowY||'';}catch{}
   if(/auto|scroll/i.test(overflow)&&n.scrollHeight>n.clientHeight+120)add(n);
 }
 const main=doc.querySelector('[role="main"]');
 if(main){let overflow='';try{overflow=view.getComputedStyle(main).overflowY||'';}catch{}
   if(/auto|scroll/i.test(overflow)&&main.scrollHeight>main.clientHeight+120)add(main);
 }
 add(root);if(doc.body&&doc.body!==root)add(doc.body);
 return nodes;
}
function position(el,doc,view){const root=doc.scrollingElement||doc.documentElement;
 return el===root||el===doc.documentElement||el===doc.body ? Math.max(view.scrollY||0,root?.scrollTop||0) : el.scrollTop||0;
}
function move(el,doc,view){const root=doc.scrollingElement||doc.documentElement;
 const amount=Math.max(300,Math.min(900,Math.round((view.innerHeight||750)*.7)));
 if(el===root||el===doc.documentElement||el===doc.body) view.scrollBy(0,amount);
 else el.scrollTop+=amount;
}
async function advance(doc,view,wait){
 const blocked=obstruction(doc,view);if(blocked)return {moved:false,blocked,tries:[]};
 const tries=[];
 for(const el of getCandidates(doc,view)){
  const before=position(el,doc,view);move(el,doc,view);
  await wait(170);
  const after=position(el,doc,view);
  const label=el===doc.scrollingElement?'document':el===doc.body?'body':el.getAttribute?.('role')||el.tagName||'element';
  tries.push({container:label,before,after,moved:after>before+4});
  if(after>before+4)return {moved:true,tries};
 }
 return {moved:false,tries};
}
// A Facebook post permalink often renders the SELECTED post inside a modal.
// This is an intended detail view, unlike a photo gallery during feed discovery.
function detailDialog(doc,view){
 const path=String(view.location?.pathname||doc.location?.pathname||'');
 if(!/^\/groups\/[^/]+\/posts\/\d+\/?$/.test(path))return null;
 const visible=visibleDialogs(doc,view).map(x=>x.el).filter(el=>{const r=el.getBoundingClientRect?.();return r&&r.width>=150&&r.height>=130;});
 // Facebook often nests several visible dialog wrappers around one selected post.
 // Treat the wrapper that actually contains post evidence as the detail root; do not
 // require there to be exactly one role=dialog in the DOM.
 const candidates=[];
 for(const el of visible){
  const body=el.querySelector?.('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]');
  const article=[...(el.querySelectorAll?.('[role="article"]')||[])].find(x=>(x.innerText||x.textContent||'').trim().length>=120);
  const fallback=(el.innerText||el.textContent||'').trim().length>=180 &&
    Boolean(el.querySelector?.('[contenteditable="true"],[role="textbox"]'));
  if(!(body||article||fallback))continue;
  const r=el.getBoundingClientRect?.();
  candidates.push({el,area:Math.max(0,(r?.width||0)*(r?.height||0)),body:Boolean(body),article:Boolean(article)});
 }
 if(!candidates.length)return null;
 // Prefer explicit post-body evidence, then the largest wrapper so nested shells
 // around the same post do not look like an unrelated modal.
 candidates.sort((a,b)=>Number(b.body)-Number(a.body)||Number(b.article)-Number(a.article)||b.area-a.area);
 return candidates[0].el;
}
function commentThreadDialog(doc,view,before){
 const known=before instanceof Set?before:new Set(before||[]),detail=detailDialog(doc,view);
 for(const {el} of visibleDialogs(doc,view)){
  if(known.has(el)||el===detail||el.contains(detail))continue;
  const hasCommentLink=Boolean(el.querySelector?.('a[href*="comment_id="],a[href*="reply_comment_id="]'));
  const hasCommentArticle=Boolean(el.querySelector?.('[role="article"]'));
  const hasPostBody=Boolean(el.querySelector?.('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]'));
  if(hasCommentLink&&hasCommentArticle&&!hasPostBody)return el;
 }
 return null;
}
async function advanceDialog(modal,view,wait){
 if(!modal||!modal.isConnected)return {moved:false,tries:[]};
 const scrollables=[];
 const elements=[modal,...modal.querySelectorAll('*')];
 for(const el of elements.slice(0,2600)){
  let st;try{st=view.getComputedStyle(el);}catch{continue;}
  if(!/auto|scroll/i.test(st.overflowY||'')||el.scrollHeight<=el.clientHeight+80)continue;
  const r=el.getBoundingClientRect?.();if(!r||r.width<120||r.height<100||r.bottom<=0)continue;
  scrollables.push(el);
 }
 scrollables.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));
 const tries=[];
 for(const el of scrollables){
  const before=el.scrollTop||0;
  el.scrollTop+=Math.max(280,Math.min(850,Math.round((view.innerHeight||700)*.65)));
  await wait(170);
  const after=el.scrollTop||0;
  tries.push({container:'post-dialog',before,after,moved:after>before+4});
  if(after>before+4)return {moved:true,tries};
 }
 return {moved:false,tries};
}
async function advanceDetail(doc,view,wait){
 const modal=detailDialog(doc,view);if(!modal)return {moved:false,blocked:obstruction(doc,view),tries:[]};
 return advanceDialog(modal,view,wait);
}
return {getCandidates,position,move,advance,obstruction,visibleDialogs,detailDialog,commentThreadDialog,advanceDialog,advanceDetail};
});
