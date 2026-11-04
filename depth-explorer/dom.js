/* DOM diagnostics only. No text/author/media extraction or Facebook API calls. */
(() => {
'use strict';
const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&!e.closest('[aria-hidden="true"]');};
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function identity(url){try{const u=new URL(url,'https://www.facebook.com');if(u.origin!=='https://www.facebook.com')return null;const m=u.pathname.match(/^\/groups\/([^/]+)(?:\/(?:posts|permalink)\/(\d+))?\/?$/);return m?{group:decodeURIComponent(m[1]),post:m[2]||null,url:u.origin+u.pathname}:null;}catch{return null;}}
function signal(){
 // Match short UI elements exactly, never an arbitrary quotation in a post body.
 const known=[['unavailable',/^(?:Страница сейчас недоступна|Эта страница сейчас недоступна|Этот контент сейчас недоступен|This page isn't available (?:right )?now|This content isn't available (?:right )?now|Page isn't available (?:right )?now|הדף הזה אינו זמין כרגע)[.!]?$/iu],
 ['temporary_error',/^(?:Что-то пошло не так|Something went wrong|Произошла ошибка)[.!]?$/iu],
 ['rate_limit',/^(?:Вы временно заблокированы|You're temporarily blocked|Попробуйте ещё раз позже|Попробуйте еще раз позже|Try again later)[.!]?$/iu]];
 for(const e of document.querySelectorAll('h1,h2,h3,[role="heading"],[role="alert"],span,div')){
  if(e.children.length>2||e.closest('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-ad-rendering-role="story_message"],[data-testid="post_message"],[role="article"]')||!visible(e))continue;
  const t=clean(e.textContent);if(t.length>150)continue;
  for(const [kind,re] of known)if(re.test(t))return {kind,label:t};
 }
 if(/^\/(?:login|checkpoint|recover)(?:\/|\.php|$)/.test(location.pathname))return {kind:'authentication',label:'Facebook authentication/checkpoint URL'};
 return null;
}
function dialogLayers(){return [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].filter(visible);}
function dialogs(){const layers=dialogLayers();return layers.filter(e=>!layers.some(other=>other!==e&&e.contains(other)));}
function root(){const d=dialogs();return d.at(-1)||document.querySelector('[role="main"],main')||document.body;}
const load=/^(?:(?:Смотреть|Посмотреть|Показать|Загрузить|Просмотреть)\s+(?:(?:другие|предыдущие|ещ[её]|больше|все|\d+[\s.,]?\d*)\s+)*(?:комментари(?:и|ев|й|я)|ответ(?:а|ов|ы)?)(?:\s+\d+)?|(?:View|See|Load)\s+(?:(?:more|previous|all|\d+)\s+)*(?:comments|replies|reply))$/iu;
const sort=/^(?:Все комментарии|Самые актуальные|Наиболее актуальные|Самые новые|Новые|All comments|Most relevant|Newest)$/iu;
function controls(){const out=[];for(const e of root().querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"]')){
 if(!visible(e)||e.closest('a[href]')||e.matches('[disabled],[aria-disabled="true"]'))continue;
 const label=clean(e.innerText||e.getAttribute('aria-label')||e.textContent);
 if(load.test(label))out.push({e,kind:/ответ|repl/iu.test(label)?'replies':'comments',label});
 else if(/^(?:Ещё|See more|עוד)$/iu.test(label)&&e.closest('[role="article"]')?.querySelector('a[href*="comment_id="]'))out.push({e,kind:'comment_text',label});
 else if(sort.test(label)&&e.getAttribute('aria-haspopup'))out.push({e,kind:'sort',label});
 }
 return out;
}
function snapshot(){const r=root(),articles=[...r.querySelectorAll('[role="article"]')];return {
 ready:document.readyState,visibility:document.visibilityState,online:navigator.onLine,
 dialogCount:dialogs().length,dialogLayers:dialogLayers().length,postBodies:r.querySelectorAll('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]').length,
 commentElements:articles.filter(a=>Boolean(a.querySelector('a[href*="comment_id="]'))).length,
 replyElements:r.querySelectorAll('a[href*="reply_comment_id="]').length,
 displayedCounts:[...r.querySelectorAll('button,[role="button"],span')].filter(e=>e.children.length===0&&visible(e)).map(e=>clean(e.textContent)).filter(t=>/^[\d\s.,]+(?:тыс\.?|млн\.?|[KkMm])?\s+(?:комментари(?:и|ев|й|я)|comments|ответ(?:а|ов|ы)?|replies)$/iu.test(t)).slice(0,20),
 loading:r.querySelectorAll('[role="progressbar"],[aria-busy="true"]').length,
 controls:controls().map(x=>({kind:x.kind,label:x.label})),
 scrollY:Math.round(scrollY),documentHeight:document.documentElement.scrollHeight,
 heapBytes:typeof performance.memory?.usedJSHeapSize==='number'?performance.memory.usedJSHeapSize:null
 };}
function feedLinks(){const out=[],seen=new Set();for(const a of document.querySelectorAll('a[href]')){const i=identity(a.href);if(!i?.post||i.group!==identity(location.href)?.group||/[?&](?:reply_)?comment_id=/.test(a.href)||a.closest('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-ad-rendering-role="story_message"]')||!visible(a)||seen.has(i.post))continue;seen.add(i.post);out.push({id:i.post,url:i.url});}return out;}
function scrollOne(){
 const scope=root(),candidates=[];const add=e=>{if(e&&!candidates.includes(e)&&visible(e)&&e.scrollHeight>e.clientHeight+8&&/auto|scroll/.test(getComputedStyle(e).overflowY))candidates.push(e);};
 // Deepest reply scroller first; feed ancestors first on the feed page.
 for(const e of [...scope.querySelectorAll('div,section')].reverse())add(e);
 for(let e=scope;e&&e!==document.body;e=e.parentElement)add(e);
 const doc=document.scrollingElement;candidates.push(doc);
 const tries=[];
 for(const e of candidates){const before=e.scrollTop;e.scrollTop+=Math.max(300,Math.min(850,e.clientHeight*.7));const after=e.scrollTop;tries.push({container:e===doc?'document':e.getAttribute('role')||e.tagName.toLowerCase(),before:Math.round(before),after:Math.round(after)});if(after>before+2)return {moved:true,tries};}
 return {moved:false,tries};
}
window.DepthDOM={identity,signal,snapshot,controls,feedLinks,scrollOne,root,visible,clean,dialogs};
})();
