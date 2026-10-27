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
function obstruction(doc,view,target=null){
 const evidence=target?.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]')||
  [...(target?.querySelectorAll('a[href]')||[])].find(a=>/\/groups\/[^/]+\/(?:posts|permalink)\/\d+/.test(a.getAttribute('href')||'')&&!/[?&](?:reply_)?comment_id=/.test(a.getAttribute('href')||''));
 const first=visibleDialogs(doc,view).find(({el})=>!target||!(el===target||el.contains(target)||(target.contains(el)&&evidence&&el.contains(evidence))));if(!first)return null;
 return dialogBlock(first.el,first.coverage);
}
function dialogBlock(el,coverage){
 const raw=(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,280);
 return {kind:'facebook_dialog',role:el.getAttribute('role')||el.tagName.toLowerCase(),
  coverage:Math.round(coverage*100),media:Boolean(el.querySelector('img,video')),
  aria_label:(el.getAttribute('aria-label')||'').slice(0,160)||null,
  id:(el.id||'').slice(0,120)||null,
  class_name:(typeof el.className==='string'?el.className:'').slice(0,180)||null,
  text_sample:raw||null};
}
function deepObstruction(doc,view,target=null){
 // Deep mode is different from feed mode: Facebook legitimately creates nested or
 // sibling comment/reply dialogs while the selected post remains open. Those are
 // collector-owned UI, not fatal obstructions.
 if(!target)return obstruction(doc,view,null);
 for(const {el,coverage} of visibleDialogs(doc,view)){
  if(el===target||el.contains(target))continue; // selected post shell / parent wrapper
  const raw=(el.innerText||el.textContent||'').trim().slice(0,1600);
  const auth=/(?:log\s*in|login|sign\s*in|войти|вход\s+(?:в|на)\s+(?:аккаунт|уч[её]тную\s+запись|систему|facebook|meta)|session expired|checkpoint|подтвердите|verify your account|אימות|התחבר)/iu.test(raw);
  const commentish=Boolean(el.querySelector?.('a[href*="comment_id="],a[href*="reply_comment_id="],[role="article"]'))||
    /(?:ответить|reply|посмотреть\s+\d+\s+ответ|смотреть другие комментарии|comment)/iu.test(raw);
  const media=Boolean(el.querySelector?.('img,video'));
  const postTitle=/^Публикация(?:\s+|$)/iu.test(raw);
  // Live 0.5.11: Facebook may represent the same selected post as a SIBLING
  // dialog rather than a nested one. On an already verified permalink URL,
  // a visible "Публикация <author>..." dialog is part of the current post UI.
  // Authentication/checkpoint text still wins and remains fatal.
  if(postTitle&&!auth)continue;
  if(target.contains(el)){
   if(auth)return dialogBlock(el,coverage);
   if(media&&!commentish)return dialogBlock(el,coverage);
   continue; // nested comment/reply wrappers belong to the current post
  }
  if(commentish&&!auth&&!media)continue; // sibling thread dialog opened by collector
  return dialogBlock(el,coverage);
 }
 return null;
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
async function rewindToTop(doc,view,wait){
 const rounds=[];let stable=0;
 try{if(view.history&&'scrollRestoration' in view.history)view.history.scrollRestoration='manual';}catch{}
 for(let cycle=0;cycle<18;cycle++){
  const candidates=getCandidates(doc,view),before=[];
  for(const el of candidates)before.push(position(el,doc,view));
  try{view.scrollTo?.(0,0);}catch{}
  const root=doc.scrollingElement||doc.documentElement;
  try{if(root)root.scrollTop=0;}catch{}
  try{if(doc.documentElement)doc.documentElement.scrollTop=0;}catch{}
  try{if(doc.body)doc.body.scrollTop=0;}catch{}
  for(const el of candidates){
   if(el===root||el===doc.documentElement||el===doc.body)continue;
   try{el.scrollTop=0;}catch{}
  }
  await wait(cycle<5?320:180);
  const afterCandidates=getCandidates(doc,view),after=afterCandidates.map(el=>position(el,doc,view));
  const docPos=Math.max(0,Number(view.scrollY)||0,Number(root?.scrollTop)||0,Number(doc.documentElement?.scrollTop)||0,Number(doc.body?.scrollTop)||0);
  const maxPos=Math.max(docPos,...after,0);
  const atTop=maxPos<=4;
  stable=atTop?stable+1:0;
  rounds.push({cycle:cycle+1,before_max:Math.max(...before,0),after_max:maxPos,containers:afterCandidates.length,at_top:atTop});
  if(stable>=3)return {ok:true,stable_rounds:stable,cycles:cycle+1,position:maxPos,rounds:rounds.slice(-6)};
 }
 return {ok:false,stable_rounds:stable,cycles:18,position:rounds.at(-1)?.after_max??null,rounds:rounds.slice(-8)};
}
// A Facebook post permalink often renders the SELECTED post inside a modal.
// This is an intended detail view, unlike a photo gallery during feed discovery.
function selectedPostIdentity(doc,view){
 const loc=view.location||doc.location||{},path=String(loc.pathname||'');
 const m=path.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)(?:\/|$)/);
 if(m)return {group:decodeURIComponent(m[1]),id:m[2]};
 const href=String(loc.href||doc.location?.href||'');
 const story=href.match(/[?&]story_fbid=(\d+)(?:&|$)/);
 if(story)return {group:null,id:story[1]};
 return null;
}
function detailDialog(doc,view){
 const selected=selectedPostIdentity(doc,view);
 if(!selected)return null;
 const visible=visibleDialogs(doc,view).map(x=>x.el).filter(el=>{const r=el.getBoundingClientRect?.();return r&&r.width>=150&&r.height>=130;});
 // Facebook often nests several visible dialog wrappers around one selected post.
 // Treat the wrapper that actually contains post evidence as the detail root; do not
 // require there to be exactly one role=dialog in the DOM.
 const candidates=[];
 for(const el of visible){
  const raw=(el.innerText||el.textContent||'').trim();
  const body=el.querySelector?.('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]');
  const article=[...(el.querySelectorAll?.('[role="article"]')||[])].find(x=>(x.innerText||x.textContent||'').trim().length>=120);
  const titleEvidence=/^Публикация(?:\s+|$)/iu.test(raw);
  const fallback=raw.length>=180 &&
    Boolean(el.querySelector?.('[contenteditable="true"],[role="textbox"]'));
  const links=[...el.querySelectorAll('a[href]')].map(a=>{try{return new URL(a.getAttribute('href'),'https://www.facebook.com');}catch{return null;}}).filter(Boolean);
  const postLinks=links.map(u=>({u,m:u.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)(?:\/|$)/)}))
    .filter(x=>x.m&&/(^|\.)facebook\.com$/.test(x.u.hostname)&&!x.u.searchParams.has('comment_id')&&!x.u.searchParams.has('reply_comment_id'));
  const matching=postLinks.some(x=>x.m[2]===selected.id&&(!selected.group||decodeURIComponent(x.m[1])===selected.group));
  // A valid Facebook post may contain links to OTHER group posts. Those links are
  // content, not proof that this dialog belongs to another post. 0.5.5 treated any
  // non-matching post link as a veto and falsely rejected many real detail dialogs.
  if(!(matching||body||article||fallback||titleEvidence))continue;
  const r=el.getBoundingClientRect?.();
  candidates.push({el,area:Math.max(0,(r?.width||0)*(r?.height||0)),matching,body:Boolean(body),article:Boolean(article),titleEvidence});
 }
 if(!candidates.length)return null;
 // Prefer explicit post-body evidence, then the largest wrapper so nested shells
 // around the same post do not look like an unrelated modal.
 candidates.sort((a,b)=>Number(b.body)-Number(a.body)||Number(b.matching)-Number(a.matching)||Number(b.article)-Number(a.article)||Number(b.titleEvidence)-Number(a.titleEvidence)||b.area-a.area);
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
 const modal=detailDialog(doc,view);const blocked=deepObstruction(doc,view,modal);if(blocked)return {moved:false,blocked,tries:[]};if(!modal)return {moved:false,blocked:obstruction(doc,view),tries:[]};
 return advanceDialog(modal,view,wait);
}
return {getCandidates,position,move,advance,rewindToTop,obstruction,deepObstruction,visibleDialogs,selectedPostIdentity,detailDialog,commentThreadDialog,advanceDialog,advanceDetail};
});
