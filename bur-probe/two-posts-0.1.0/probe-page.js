(()=>{'use strict';
const F=globalThis.BurFeedScroll;
const expected=String(globalThis.__FB_BUR_PROBE_EXPECTED__||'');
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const authRe=/(?:log\s*in|login|sign\s*in|войти|вход|session expired|checkpoint|подтвердите|verify your account|אימות|התחבר)/iu;
function looseId(href){
 try{
  const u=new URL(href,location.href);
  const m=u.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)(?:\/|$)/);
  if(m)return {group:decodeURIComponent(m[1]),id:m[2],source:'group_path'};
  const story=u.searchParams.get('story_fbid');
  return story?{group:null,id:story,source:'story_fbid'}:null;
 }catch{return null;}
}
function postLinks(el){
 const out=[];
 for(const a of [...el.querySelectorAll('a[href]')].slice(0,1200)){
  try{
   const u=new URL(a.getAttribute('href'),location.href),id=looseId(u.href);
   if(id&&!u.searchParams.has('comment_id')&&!u.searchParams.has('reply_comment_id'))out.push({id:id.id,group:id.group,path:u.pathname});
  }catch{}
  if(out.length>=20)break;
 }
 return out;
}
const visible=F?.visibleDialogs?F.visibleDialogs(document,window):[];
const target=F?.detailDialog?F.detailDialog(document,window):null;
const selected=F?.selectedPostIdentity?F.selectedPostIdentity(document,window):null;
const dialogs=visible.map(({el,coverage},index)=>{
 const raw=norm(el.innerText||el.textContent||'');
 const rect=el.getBoundingClientRect();
 const links=postLinks(el);
 const body=Boolean(el.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]'));
 const articleLong=[...el.querySelectorAll('[role="article"]')].some(x=>norm(x.innerText||x.textContent||'').length>=120);
 const textbox=Boolean(el.querySelector('[contenteditable="true"],[role="textbox"]'));
 const commentish=Boolean(el.querySelector('a[href*="comment_id="],a[href*="reply_comment_id="],[role="article"]'))||/(?:ответить|reply|посмотреть\s+\d+\s+ответ|смотреть другие комментарии|comment)/iu.test(raw);
 const parents=visible.map((v,i)=>({i,el:v.el,area:(v.el.getBoundingClientRect().width||0)*(v.el.getBoundingClientRect().height||0)}))
   .filter(x=>x.i!==index&&x.el.contains(el)).sort((a,b)=>a.area-b.area);
 const chain=[];for(let n=el,c=0;n&&c<6;n=n.parentElement,c++)chain.push({tag:n.tagName?.toLowerCase()||null,role:n.getAttribute?.('role')||null,aria_label:n.getAttribute?.('aria-label')||null,data_pagelet:n.getAttribute?.('data-pagelet')||null,class_name:typeof n.className==='string'?n.className.slice(0,180):null});
 return {
  index,parent_dialog_index:parents[0]?.i??null,is_target:el===target,
  contains_target:Boolean(target&&el.contains(target)),target_contains_this:Boolean(target&&target.contains(el)),
  rect:{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)},
  coverage_pct:Math.round(coverage*100),media:Boolean(el.querySelector('img,video')),
  role:el.getAttribute('role')||el.tagName.toLowerCase(),aria_modal:el.getAttribute('aria-modal')||null,
  aria_label:el.getAttribute('aria-label')||null,id:el.id||null,class_name:typeof el.className==='string'?el.className.slice(0,220):null,
  text_sample:raw.slice(0,280)||null,
  begins_publication:/^Публикация(?:\s+|$)/iu.test(raw),auth:authRe.test(raw),commentish,
  evidence:{body,article_long:articleLong,textbox,fallback:raw.length>=180&&textbox,matching_expected_link:links.some(x=>x.id===expected)},
  post_links:links,ancestor_chain:chain
 };
});
const oldStrict=location.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/);
const result={
 captured_at:new Date().toISOString(),
 expected_post_id:expected,
 current_url:location.href,current_path:location.pathname,document_ready_state:document.readyState,
 viewport:{width:innerWidth,height:innerHeight,device_pixel_ratio:devicePixelRatio},
 url_identity_loose:looseId(location.href),
 old_strict_identity:oldStrict?{group:decodeURIComponent(oldStrict[1]),id:oldStrict[2]}:null,
 selected_post_identity:selected||null,
 visible_dialog_count:dialogs.length,
 target_found:Boolean(target),
 target_dialog_index:dialogs.findIndex(x=>x.is_target),
 generic_obstruction_no_target:F?.obstruction?F.obstruction(document,window,null):null,
 generic_obstruction_with_target:F?.obstruction?F.obstruction(document,window,target):null,
 deep_obstruction:F?.deepObstruction?F.deepObstruction(document,window,target):null,
 counts:{
  role_dialog:document.querySelectorAll('[role="dialog"]').length,
  aria_modal:document.querySelectorAll('[aria-modal="true"]').length,
  post_body:document.querySelectorAll('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]').length,
  role_article:document.querySelectorAll('[role="article"]').length,
  textbox:document.querySelectorAll('[contenteditable="true"],[role="textbox"]').length
 },
 dialogs
};
globalThis.__FB_BUR_PROBE_RESULT__=result;
})();