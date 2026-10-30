/* FB Bur core 0.5.28-alpha; offline-testable, no Facebook API bypass. */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FBBurCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const collector='fb-group-bur/0.5.28-alpha';
  const clean = (s) => String(s || '').replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').replace(/[ \t]+/g,' ').replace(/\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const cut = (s,n=40000) => clean(s).slice(0,n);
  const IDPAT=/(?:\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d+))|(?:[?&]story_fbid=(\d+))/;
  function idFromPermalink(url,group) {
    try {
      const u = new URL(url,'https://www.facebook.com');
      if (!/(^|\.)facebook\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)/);
      if (m && decodeURIComponent(m[1])===String(group)) return m[2];
      const story=u.searchParams.get('story_fbid');
      const g=u.searchParams.get('id');
      if (story && /^\d+$/.test(story) && (!g || g===String(group))) return story;
    } catch (_) {}
    return null;
  }
  function canonicalUrl(group,id) {return id?'https://www.facebook.com/groups/'+encodeURIComponent(group)+'/posts/'+id+'/':null;}
  function hash(s) {
    let h=2166136261;
    for (let i=0;i<s.length;i++) h=Math.imul(h^s.charCodeAt(i),16777619);
    return (h>>>0).toString(36);
  }
  function truncated(s) {const t=clean(s);if(/(?:Показать меньше|See less|הצג פחות)/iu.test(t))return false;return /(?:\.\.\.|…)?\s*(?:Ещё|See more|עוד)\s*$/iu.test(t)||/(?:^|\n)\s*(?:Ещё|See more|עוד)(?=\s*(?:\n|$))/iu.test(t);}
  const uiPattern=/(?:^|\n)(?:Нравится|Ответить|Поделиться|Комментировать(?: как .*)?|Подписаться|Смотреть другие комментарии|Посмотреть \d+ ответ(?:а|ов)?|Like|Reply|Share|Follow|View \d+ replies)(?:\n|$)/mi;
  function textQuality(s) {return {truncated:truncated(s),ui_mixed:uiPattern.test(String(s||''))};}
  function commentsNormalize(comments) {
    const byId=new Map();
    for(const c of Array.isArray(comments)?comments:[]) {
      const src=c&&typeof c==='object'?c:{};
      const text=clean(typeof c==='string'?c:(c.text||c.body||''));
      if((!text||text.length<3)&&!src.id)continue;
      const id=src.id?String(src.id):'visible-'+hash(text);
      const incoming={...src,id,text,author:src.author||null,author_url:src.author_url||null,
        permalink:src.permalink||null,parent_id:src.parent_id||null,
        links:normalizeLinks(src.links),media:uniqueMedia(src.media),
        published_at:src.published_at||null,published_label:src.published_label||null,
        published_date:src.published_date||null,date_precision:src.date_precision||'unknown',date_source:src.date_source||null,
        ...dateFields(src),date_precision:src.date_precision||'unknown',
        text_is_partial:src.text_is_partial===true||truncated(text),
        extraction:src.extraction||'visible_dom_unverified'};
      const prev=byId.get(id);
      if(!prev){byId.set(id,incoming);continue;}
      // Repeated scans must UPGRADE an already captured truncated comment,
      // not preserve its first short text forever under the same permalink ID.
      const better=(!incoming.text_is_partial&&prev.text_is_partial) ||
        (incoming.text_is_partial===prev.text_is_partial&&incoming.text.length>prev.text.length);
      const best=better?incoming:prev,other=better?prev:incoming;
      byId.set(id,{...other,...best,author:best.author||other.author,
        author_url:best.author_url||other.author_url,
        permalink:best.permalink||other.permalink,
        parent_id:best.parent_id||other.parent_id,
        links:normalizeLinks([...other.links,...best.links]),media:uniqueMedia([...other.media,...best.media]),
        ...betterDate(prev,incoming)});
    }
    return [...byId.values()];
  }
  function normalizePost(raw, group) {
    const p=raw&&typeof raw==='object'?raw:{};
    const g=String(p.group||group||'');
    const pid=String(p.post_id||idFromPermalink(p.permalink,g)||'')||null;
    const original=clean(p.post_text||p.text||'');
    const fingerprint=hash(original.slice(0,1800));
    const identity=pid?'post:'+pid:(p.identity||'fingerprint:'+fingerprint);
    const quality=p.post_text_quality || (p.text?'legacy_card':'unknown');
    const card=cut(p.visible_card_text||p.text||original);
    const comments=commentsNormalize(p.comments);
    const variants=[];
    for(const v of (Array.isArray(p.text_variants)?p.text_variants:[])) {
      if(v&&v.text) variants.push({text:clean(v.text),quality:v.quality||'unknown'});
    }
    if(original && !variants.some(v=>v.text===original)) variants.push({text:original,quality});
    if(p.text && clean(p.text)!==original && !variants.some(v=>v.text===clean(p.text))) variants.push({text:clean(p.text),quality:'legacy_card'});
    const cleaned={
      ...p, group:g, key:g+'|'+identity,identity,post_id:pid,
      id_quality:pid?'permalink':'text_fingerprint_unverified',
      permalink:pid?canonicalUrl(g,pid):(p.permalink||null),
      post_text:original,post_text_quality:quality,
      visible_card_text:card,
      comments,comments_status:comments.length?'visible_partial_unverified':'none_extracted_unknown',
      text_variants:variants,
      text_flags:textQuality(original),
      snapshot_at:p.snapshot_at||p.seen_at||new Date().toISOString(),
      first_seen:p.first_seen||p.seen_at||p.snapshot_at||null,
      collector:p.collector||'legacy_import',
    };
    return cleaned;
  }
  function mergePosts(oldRaw,newRaw,group) {
    if(!oldRaw) return normalizePost(newRaw,group);
    const old=normalizePost(oldRaw,group), incoming=normalizePost(newRaw,group);
    const all=[...old.text_variants,...incoming.text_variants];
    const seen=new Set();let variants=[];
    for(const v of all){if(!v.text||seen.has(v.text))continue;seen.add(v.text);variants.push(v);}
    // Prefer isolated post body over whole-card capture, but protect longer and older variants.
    const candidates=variants.filter(v=>v.quality==='body_selector');
    const chosen=(candidates.length?candidates:variants).slice().sort((a,b)=>{
      const at=truncated(a.text)?1:0,bt=truncated(b.text)?1:0;
      if(at!==bt) return at-bt;
      return b.text.length-a.text.length;
    })[0]||{text:'',quality:'unknown'};
    const comments=commentsNormalize([...old.comments,...incoming.comments]);
    const merged={...old,...incoming,post_text:chosen.text,post_text_quality:chosen.quality,
      visible_card_text:(incoming.visible_card_text||'').length>(old.visible_card_text||'').length?incoming.visible_card_text:old.visible_card_text,
      text_variants:variants, comments,comments_status:comments.length?'visible_partial_unverified':'none_extracted_unknown',
      author:incoming.author||old.author||null,
      author_url:incoming.author?(incoming.author_url||null):(old.author_url||null),
      author_is_anonymous:incoming.author?incoming.author_is_anonymous===true:old.author_is_anonymous===true,
      ...betterDate(old,incoming),
      media:uniqueMedia([...(old.media||[]),...(incoming.media||[])]),
      first_seen:old.first_seen||incoming.first_seen,snapshot_at:incoming.snapshot_at,
      id_quality:old.post_id||incoming.post_id?'permalink':'text_fingerprint_unverified',
      text_flags:textQuality(chosen.text)};
    return merged;
  }
  function detectPostLink(node,group) {
    for(const a of node.querySelectorAll('a[href]')) {
      const nearest=a.closest?.('[role="article"]');if(nearest&&nearest!==node)continue;
      if(a.closest('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]'))continue;
      const url=a.getAttribute('href');if(/[?&](?:reply_)?comment_id=/.test(url||''))continue;const id=idFromPermalink(url,group);
      if(id) return {id,url:canonicalUrl(group,id)};
    }
    return null;
  }
  // Visible DOM only: author and comment links are accepted only when explicit.
  // Never infer a parent, comment permalink, or author identity from the post itself.
  function commentLink(container) {
    for(const a of container.querySelectorAll('a[href]')){
      if(a.closest('[role="article"]')!==container)continue;
      try{
        const u=new URL(a.getAttribute('href'),'https://www.facebook.com');
        if(!/(^|\.)facebook\.com$/.test(u.hostname))continue;
        // Replies carry both ids; the reply id is the identity of THIS article.
        const reply=u.searchParams.get('reply_comment_id'),parent=u.searchParams.get('comment_id');
        const id=reply||parent;
        if(id && /^\d+$/.test(id))return {id,parent_id:reply&&/^\d+$/.test(parent||'')?parent:null,url:u.origin+u.pathname+u.search};
      }catch(_){}
    }
    return null;
  }
  function plausibleAuthorName(name){
    const s=clean(name);
    if(!s||s.length<2||s.length>100)return false;
    if(!/\p{L}/u.test(s))return false;
    if(/^(?:Ответить|Нравится|Поделиться|Reply|Like|Share|Подписаться)$/iu.test(s))return false;
    if(/^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}$/.test(s))return false;
    if(/^(?:https?:\/\/|www\.)/i.test(s))return false;
    return true;
  }
  function stableProfile(href){
    try{
      const u=new URL(href,'https://www.facebook.com');
      if(!/(^|\.)facebook\.com$/.test(u.hostname))return null;
      const parts=u.pathname.split('/').filter(Boolean);
      if(parts.length>=4&&parts[0].toLowerCase()==='groups'&&parts[2].toLowerCase()==='user'&&/^\d+$/.test(parts[3])){
        return {id:parts[3],url:'https://www.facebook.com/profile.php?id='+parts[3]};
      }
      if(parts[0]?.toLowerCase()==='profile.php'){
        const id=u.searchParams.get('id');return /^\d+$/.test(id||'')?{id,url:'https://www.facebook.com/profile.php?id='+id}:null;
      }
      if(parts[0]?.toLowerCase()==='people'&&parts.length>=2){return {id:null,url:u.origin+u.pathname};}
      const blocked=new Set(['groups','posts','permalink','photo','photos','watch','reel','reels','story.php','events','marketplace','help','login','share','pages','places','search','messages','notifications']);
      if(parts.length===1&&!/\.php$/i.test(parts[0])&&!blocked.has(parts[0].toLowerCase())&&/^[A-Za-z0-9._-]{2,100}$/.test(parts[0]))return {id:parts[0],url:u.origin+'/'+parts[0]};
    }catch(_){}
    return null;
  }
  function commentAuthor(container) {
    const ownBody=container.querySelector('[data-testid="comment_message"],[data-ad-preview="comment"],[data-testid="comment"]');
    const bodyTop=ownBody?.getBoundingClientRect?.().top??Infinity;
    const base=container.getBoundingClientRect?.()||{top:0};
    const candidates=[];
    for(const a of container.querySelectorAll('a[href]')){
      const nearest=a.closest?.('[role="article"]');if(nearest&&nearest!==container)continue;
      const name=clean(a.innerText||a.textContent||''),profile=stableProfile(a.getAttribute('href')||'');
      if(!profile||!plausibleAuthorName(name)||ownBody?.contains(a))continue;
      const r=a.getBoundingClientRect?.()||{top:Infinity,bottom:Infinity};
      if(Number.isFinite(bodyTop)&&Number.isFinite(r.top)&&r.top>bodyTop+6)continue;
      let score=0;if(profile.id)score+=35;if(Number.isFinite(r.top)&&r.top<=base.top+110)score+=30;
      if(a.closest('h2,h3,strong,[data-ad-rendering-role="profile_name"]'))score+=25;
      if(name.includes(' '))score+=5;
      candidates.push({score,name,url:profile.url});
    }
    candidates.sort((a,b)=>b.score-a.score);const best=candidates[0];
    return best&&best.score>=30?{name:best.name,url:best.url}:null;
  }
  function stripCommentChrome(text) {
    return clean(String(text||'').split('\n').filter(l=>!/^(?:Ответить|Нравится|Поделиться|Reply|Like|Share|Отредактировано|Подписаться|Показать \d+ ответ(?:а|ов)?|Посмотреть \d+ ответ(?:а|ов)?)$/iu.test(clean(l))).join('\n'));
  }
  function ownCommentText(article,author){
    const selectors='[data-testid="UFI2Comment/body"],[data-ad-preview="comment"],[data-testid="comment_message"],[data-testid="comment"],.UFICommentBody';
    const explicit=[...article.querySelectorAll(selectors)].find(el=>el.closest('[role="article"]')===article);
    if(explicit){const t=stripCommentChrome(explicit.innerText||explicit.textContent||'');if(t&&clean(t)!==clean(author?.name))return t;}
    const candidates=[];
    for(const el of article.querySelectorAll('[dir="auto"],div[lang],span[lang]')){
      if(el.closest('[role="article"]')!==article||el.closest('a[href],button,[role="button"],h2,h3,[data-ad-rendering-role="profile_name"]'))continue;
      const r=el.getBoundingClientRect?.();if(r&&r.width<=0&&r.height<=0)continue;
      if(el.querySelector('[role="article"]'))continue;
      let text=el.innerText||el.textContent||'';
      if(el.querySelector('button,[role="button"],h2,h3,[data-ad-rendering-role="profile_name"]')){
        const copy=el.cloneNode(true);
        for(const chrome of copy.querySelectorAll('button,[role="button"],h2,h3,[data-ad-rendering-role="profile_name"]'))chrome.remove();
        text=copy.textContent||'';
      }
      const t=stripCommentChrome(text);if(t&&clean(t)!==clean(author?.name))candidates.push(t);
    }
    candidates.sort((a,b)=>b.length-a.length);return candidates[0]||'';
  }
  function nearestParentComment(article,postRoot){
    let p=article.parentElement;
    while(p&&p!==postRoot){if(p.matches?.('[role="article"]'))return p;p=p.parentElement;}
    return null;
  }
  function extractVisibleComments(node) {
    const items=[],seen=new Set();
    const articles=[...node.querySelectorAll('[role="article"]')].filter(a=>a!==node);
    for(const article of articles){
      if(!article.isConnected)continue;
      const bounds=article.getBoundingClientRect?.();if(bounds&&bounds.width<=0&&bounds.height<=0)continue;
      if(article.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]'))continue;
      const author=commentAuthor(article),link=commentLink(article);
      const media=extractMedia(article,link?.url||null),links=extractLinks(article,article);
      const value=ownCommentText(article,author);if(!value&&!link&&!media.length&&!links.length)continue;
      const parent=nearestParentComment(article,node),parent_id=link?.parent_id||(parent?commentLink(parent)?.id||null:null);
      const identity=link?.id||'visible-'+hash((author?.name||'')+'|'+parent_id+'|'+value+'|'+media.map(mediaKey).join('|')+'|'+links.map(x=>x.url).join('|'));
      if(seen.has(identity))continue;seen.add(identity);
      items.push({id:identity,text:value,author:author?.name||null,author_url:author?.url||null,
        permalink:link?.url||null,parent_id,links,media,
        ...extractDate(article),text_is_partial:truncated(value),extraction:'visible_dom_unverified'});
    }
    // Some Facebook layouts expose a comment body without a role=article wrapper.
    const selectors='[data-testid="UFI2Comment/body"],[data-ad-preview="comment"],[data-testid="comment_message"],[data-testid="comment"],.UFICommentBody';
    for(const body of node.querySelectorAll(selectors)){
      if(body.closest('[role="article"]'))continue;
      const bounds=body.getBoundingClientRect?.();if(bounds&&bounds.width<=0&&bounds.height<=0)continue;
      const value=stripCommentChrome(body.innerText||body.textContent||'');if(value.length<3)continue;
      const identity='visible-'+hash(value);if(seen.has(identity))continue;seen.add(identity);
      items.push({id:identity,text:value,author:null,author_url:null,permalink:null,parent_id:null,text_is_partial:truncated(value),extraction:'visible_dom_unverified'});
    }
    return commentsNormalize(items);
  }
  // 0.5.25: a permalink page shows the selected post in a dialog OVER the group feed.
  // Background feed posts must never be taken as the selected post.
  function openPostDialog(doc){
    const view=doc.defaultView;
    const dialogs=[...doc.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(d=>{
      if(d.closest('[aria-hidden="true"]'))return false;
      const r=d.getBoundingClientRect?.();if(!r||r.width<300||r.height<300)return false;
      try{const st=view.getComputedStyle(d);if(st.display==='none'||st.visibility==='hidden')return false;}catch(_){}
      return Boolean(d.querySelector('[role="article"]'));
    });
    return dialogs.length?dialogs[dialogs.length-1]:null;
  }
  function permalinkPostRoot(doc,group,loc){
    const id=idFromPermalink(loc,group);if(!id)return null;
    const dialog=openPostDialog(doc);
    const bodies=[...(dialog||doc).querySelectorAll('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]')];
    for(const body of bodies){
      const r=body.getBoundingClientRect?.();if(r&&r.width<=0&&r.height<=0)continue;
      const article=body.closest('[role="article"]');if(article)return article;
      let p=body.parentElement,best=p;
      for(let i=0;p&&p!==doc.body&&i<9;i++,p=p.parentElement){
        best=p;
        if(p.querySelector?.('a[href*="comment_id="],a[href*="reply_comment_id="],[contenteditable="true"][role="textbox"]'))return p;
        if(p.matches?.('[role="dialog"],main,[role="main"]'))break;
      }
      if(best)return best;
    }
    return null;
  }
  function postNodes(document,host,opts={}) {
    const all=[...document.querySelectorAll('[role="article"], [data-pagelet^="FeedUnit_"]')];
    return all.filter(n=>n.isConnected && !(host&&host.contains(n)) &&
      (opts.includeDialog || !n.closest('[role="dialog"], [aria-modal="true"], dialog[open]')) &&
      !n.parentElement?.closest('[role="article"], [data-pagelet^="FeedUnit_"]') &&
      (typeof getComputedStyle==='undefined'||(getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden')));
  }
  // Do not click photo-grid overlays, links, or the Facebook dialog itself.
  // Reconnaissance expands ONLY the body; reply/comment expansion is allowed
  // later in the deep phase, where a single permalink is already selected.
  function expandVisible(nodes,maxClicks=16,mode='post',dryRun=false) {
    let clicks=0;
    const bodySelectors='[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="post_message"],[data-ad-rendering-role="story_message"]';
    const more=/^(?:Ещё|See more|עוד)$/iu;
    const replies=/^(?:Показать|Посмотреть) (?:\d+ )?ответ(?:а|ов)?$|^View (?:\d+ )?repl(?:y|ies)$|^(?:Показать|Посмотреть|Загрузить) (?:ещ[её] )?(?:\d+ )?комментари(?:ев|я|и)$|^(?:View|See|Load) (?:\d+ )?(?:more|previous) comments$/iu;
    const isVisible=el=>{const st=typeof getComputedStyle==='function'?getComputedStyle(el):null;const re=el.getBoundingClientRect?.();return (!st||(st.display!=='none'&&st.visibility!=='hidden'))&&(!re||(re.width>0&&re.height>0));};
    for(const node of nodes){
      if(clicks>=maxClicks)break;
      if(mode!=='deep' && node.closest?.('[role="dialog"],[aria-modal="true"],dialog[open]'))continue;
      const bodies=[...node.querySelectorAll(bodySelectors)].filter(x=>x.closest('[role="article"]')===node||!x.closest('[role="article"]'));
      const targets=[];
      // Text "Ещё" is eligible ONLY inside an identified main post body.
      for(const body of bodies) for(const el of body.querySelectorAll('button,[role="button"]')){
        if(more.test(clean(el.textContent||'')))targets.push(el);
      }
      if(mode==='deep'){
        // On the selected permalink, also load earlier/more comments. These controls
        // often sit outside the comment's article, so limiting to articles loses threads.
        const commentControls=/^(?:Смотреть|Посмотреть|Показать|Загрузить|Просмотреть)\s+(?:(?:другие|предыдущие|ещ[её]|больше|все|\d+)\s+)*(?:комментари(?:и|ев|й)|ответ(?:а|ов|ы)?)(?:\s+\d+)?$|^(?:View|See|Load)\s+(?:(?:more|previous|all|\d+)\s+)*(?:comments|replies|reply)$/iu;
        for(const el of node.querySelectorAll('button,[role="button"]')){
          const label=clean(el.innerText||el.textContent||el.getAttribute('aria-label')||'');
          if(commentControls.test(label))targets.push(el);
        }
        for(const article of node.querySelectorAll('[role="article"]')){
          if(article===node)continue;
          for(const el of article.querySelectorAll('button,[role="button"]')){
            if(more.test(clean(el.textContent||'')))targets.push(el);
          }
        }
      }
      const seen=new Set();
      for(const el of targets){
        if(clicks>=maxClicks)break;
        if(seen.has(el)||!el.isConnected||!isVisible(el))continue;seen.add(el);
        if(el.closest('a[href]')||(mode!=='deep'&&el.closest('[role="dialog"],[aria-modal="true"],dialog[open]')))continue;
        if(el.querySelector('img,video,svg[aria-label]'))continue;
        const label=String(el.getAttribute('aria-label')||'').toLowerCase();
        if(/фото|photo|изображени|image|gallery|галере|показать все|view all/.test(label))continue;
        try{if(!dryRun)el.click();clicks++;}catch(_){ }
      }
    }
    return clicks;
  }
  function ownElement(el,owner){
    const nearest=el.closest?.('[role="article"]');
    return !nearest||nearest===owner;
  }
  function safeLink(href){
    if(typeof href!=='string'||!href.trim())return null;
    try{
      const u=new URL(href,'https://www.facebook.com');
      if(!['http:','https:'].includes(u.protocol))return null;
      if(/(^|\.)facebook\.com$/.test(u.hostname)&&u.pathname==='/l.php'){
        const target=u.searchParams.get('u');if(target)return safeLink(target);
      }
      return u.href;
    }catch(_){return null;}
  }
  function normalizeLinks(items){
    const result=new Map();
    for(const item of Array.isArray(items)?items:[]){
      const url=safeLink(typeof item==='string'?item:item?.url);if(!url)continue;
      const text=clean(item?.text||'');const key=url+'|'+text;
      if(!result.has(key))result.set(key,{url,text,source_url:item?.source_url||url});
    }
    return [...result.values()];
  }
  function extractLinks(container,owner,ownerUrl=null){
    const result=[];
    const body=container.matches?.('[data-ad-preview="message"],[data-ad-comet-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]')?container:container.querySelector('[data-testid="comment_message"],[data-ad-preview="comment"],[data-testid="UFI2Comment/body"],.UFICommentBody');
    for(const a of container.querySelectorAll('a[href]')){
      if(!ownElement(a,owner))continue;
      if(a.closest('h2,h3,h4,[data-ad-rendering-role="profile_name"]'))continue;
      if(a.closest('[role="button"],button')||a.querySelector('img')&&!clean(a.textContent))continue;
      const href=a.getAttribute('href')||'';
      const inBody=body?.contains(a)||!!a.closest('[dir="auto"]');
      if(!inBody&&ownerUrl){try{const u=new URL(href,'https://www.facebook.com'),own=new URL(ownerUrl);if(u.origin===own.origin&&u.pathname===own.pathname)continue;}catch(_){}}
      if(!inBody&&(stableProfile(href)||/[?&](?:reply_)?comment_id=/.test(href)))continue;
      const url=safeLink(href);if(url)result.push({url,text:clean(a.innerText||a.textContent),source_url:new URL(href,'https://www.facebook.com').href});
    }
    return normalizeLinks(result);
  }
  function mediaKey(item){
    if(item.kind==='video'&&!item.url)return 'video-evidence:'+(item.source_url||'')+'|'+(item.temporary_url||item.poster||'')+'|'+(item.evidence_index??'');
    try{
      const source=new URL(item.source_url||item.url),id=source.searchParams.get('fbid');
      if(id)return (item.kind||'image')+':fbid:'+id;
      const u=new URL(item.url);
      // Ignore expiring CDN query signatures, retain path identity.
      return (item.kind||'image')+':'+u.origin+u.pathname;
    }catch(_){return item.url;}
  }
  function uniqueMedia(items){
    return [...new Map((Array.isArray(items)?items:[]).filter(m=>m&&(safeLink(m.url)||m.kind==='video'&&(safeLink(m.source_url)||safeLink(m.poster)||/^blob:/i.test(m.temporary_url||'')))).map(m=>[mediaKey(m),m])).values()];
  }
  function extractMedia(owner,ownerUrl=null){
    const result=[];
    for(const img of owner.querySelectorAll('img[src]')){
      if(!ownElement(img,owner))continue;
      const src=safeLink(img.currentSrc||img.getAttribute('src'));if(!src)continue;
      const anchor=img.closest('a[href]'),href=anchor?.getAttribute('href')||'';
      const label=(img.alt||'')+' '+(anchor?.getAttribute('aria-label')||'');
      if(stableProfile(href)||img.closest('[data-ad-rendering-role="profile_name"]'))continue;
      if(/emoji|profile_pic|\/t(?:1|39)\.[^/]*-1\//i.test(src)||/profile picture|фото профиля|аватар/iu.test(label))continue;
      const w=img.naturalWidth||Number(img.getAttribute('width'))||0,h=img.naturalHeight||Number(img.getAttribute('height'))||0;
      const rect=img.getBoundingClientRect?.();
      const attachment=/\/(?:photo|photos)(?:[/.?]|$)|[?&]fbid=/.test(href);
      if(!attachment&&((w&&w<120)||(h&&h<100)))continue;
      if(!attachment&&(!(w>=180&&h>=150)||rect&&rect.width<=0&&rect.height<=0))continue;
      result.push({kind:'image',url:src,alt:img.alt||null,source_url:safeLink(href),width:w||null,height:h||null});
    }
    let videoIndex=0;
    for(const video of owner.querySelectorAll('video')){
      if(!ownElement(video,owner))continue;
      const raw=video.currentSrc||video.getAttribute('src')||video.querySelector('source[src]')?.getAttribute('src')||'';
      const url=safeLink(raw),temporary_url=/^blob:/i.test(raw)?raw:null;
      const source=safeLink(video.closest('a[href]')?.getAttribute('href'))||ownerUrl;
      const poster=safeLink(video.poster);
      result.push({kind:'video',url,temporary_url,source_url:source,poster,evidence_index:videoIndex++,availability:url?'direct_url':temporary_url?'temporary_blob_only':'metadata_only',width:video.videoWidth||null,height:video.videoHeight||null});
    }
    return uniqueMedia(result);
  }
  function parseDateEvidence(raw){
    const s=clean(raw);if(!s)return null;
    // A timestamp is exact only when its zone/offset is explicitly supplied.
    if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)){
      const ms=Date.parse(s);if(Number.isFinite(ms))return {published_at:new Date(ms).toISOString(),published_date:s.slice(0,10),date_precision:'timestamp'};
    }
    const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const english=['january','february','march','april','may','june','july','august','september','october','november','december'];
    let year,month,day,m=s.toLowerCase().match(/^(\d{1,2})\s+([а-яёa-z]+)\s+(\d{4})(?:\s|$)/u);
    if(m){day=+m[1];month=months.indexOf(m[2])+1||english.indexOf(m[2])+1;year=+m[3];}
    else if((m=s.toLowerCase().match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s|$)/))){month=english.indexOf(m[1])+1;day=+m[2];year=+m[3];}
    else if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/))){year=+m[1];month=+m[2];day=+m[3];}
    if(!(year&&month&&day)){const fb=parseFacebookDate(s);if(fb)return fb;}
    if(year&&month&&day){const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day)return {published_at:null,published_date:[year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-'),date_precision:'day'};}
    return null;
  }

  // ---- 0.5.26: dates -------------------------------------------------------
  // Facebook shows "3 дн." on the card and the exact moment only in a hover tooltip
  // ("Вторник, 27 октябрь 2026 г. в 13:46"), rendered in the browser's local time.
  const MONTH_STEMS=[['янв','jan'],['фев','feb'],['мар','mar'],['апр','apr'],['ма[йяе]','may'],['июн','jun'],['июл','jul'],['авг','aug'],['сен','sep'],['окт','oct'],['ноя','nov'],['дек','dec']];
  function monthIndex(word){const w=String(word||'').toLowerCase();for(let i=0;i<12;i++){const [ru,en]=MONTH_STEMS[i];if(new RegExp('^(?:'+ru+'|'+en+')','u').test(w))return i;}return -1;}
  function localIso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function tzName(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||null;}catch(_){return null;}}
  // Absolute Facebook date text, with or without weekday / year / time.
  function parseFacebookDate(raw,nowMs){
    const s=clean(raw).replace(/^[^\d,]*?(?:,\s*)/u,'').trim();if(!s)return null;
    const now=new Date(Number.isFinite(nowMs)?nowMs:Date.now());
    let day,month,year=null,hh=null,mi=null,m;
    if((m=s.match(/^(\d{1,2})\s+([A-Za-zА-Яа-яЁё]+)\.?(?:\s+(\d{4})\s*(?:г\.?)?)?(?:\s*(?:в|at)\s*(\d{1,2}):(\d{2}))?\s*$/u))){
      day=+m[1];month=monthIndex(m[2]);if(m[3])year=+m[3];if(m[4]){hh=+m[4];mi=+m[5];}
    }else if((m=s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)?)?\s*$/i))){
      month=monthIndex(m[1]);day=+m[2];if(m[3])year=+m[3];
      if(m[4]){hh=+m[4]%12+(m[6]&&/pm/i.test(m[6])?12:0);if(m[6]&&/am/i.test(m[6])&&+m[4]===12)hh=0;if(!m[6])hh=+m[4];mi=+m[5];}
    }else return null;
    if(month<0||!(day>=1&&day<=31))return null;
    const inferredYear=year==null;
    if(inferredYear){year=now.getFullYear();if(new Date(year,month,day)>now)year--;}
    const d=hh==null?new Date(year,month,day):new Date(year,month,day,hh,mi);
    if(d.getMonth()!==month||d.getDate()!==day)return null;
    return {published_at:hh==null?null:d.toISOString(),published_date:localIso(d),
      date_precision:hh==null?'day':'minute',date_year_inferred:inferredYear||undefined,date_timezone:tzName()};
  }
  // "3 дн." / "16 ч." / "вчера" + the moment it was seen -> approximate date.
  function estimateRelativeDate(label,seenMs){
    const s=clean(label).toLowerCase();if(!s)return null;
    const seen=new Date(Number.isFinite(seenMs)?seenMs:Date.now());
    let m,ms=null,precision;
    if(/^(?:только что|just now|now)$/.test(s)){ms=0;precision='approx_minute';}
    else if((m=s.match(/^(\d+)\s*(?:мин|m\b|min)/u))){ms=+m[1]*60e3;precision='approx_minute';}
    // Facebook rounds down ("3 дн." = 3..4 days ago), so take the middle of the interval.
    else if((m=s.match(/^(\d+)\s*(?:ч|h\b|hr|hour)/u))){ms=(+m[1]+.5)*3600e3;precision='approx_hour';}
    else if((m=s.match(/^(\d+)\s*(?:дн|д\.|d\b|day)/u))){ms=(+m[1]+.5)*86400e3;precision='approx_day';}
    else if((m=s.match(/^(\d+)\s*(?:нед|w\b|wk|week)/u))){ms=(+m[1]+.5)*7*86400e3;precision='approx_week';}
    else if((m=s.match(/^(\d+)\s*(?:г\.|год|лет|y\b|yr|year)/u))){ms=(+m[1]+.5)*365*86400e3;precision='approx_year';}
    else if((m=s.match(/^(вчера|yesterday|сегодня|today)(?:\s*(?:в|at)\s*(\d{1,2}):(\d{2}))?/u))){
      const d=new Date(seen.getFullYear(),seen.getMonth(),seen.getDate()-(/^(?:вчера|yesterday)/.test(m[1])?1:0),m[2]?+m[2]:12,m[3]?+m[3]:0);
      return m[2]?{published_at:d.toISOString(),published_date:localIso(d),date_precision:'minute',date_timezone:tzName()}
                 :{published_date:localIso(d),published_estimated_at:d.toISOString(),date_precision:'day',date_timezone:tzName()};
    }
    if(ms==null)return null;
    const d=new Date(seen.getTime()-ms);
    return {published_date:localIso(d),published_estimated_at:d.toISOString(),date_precision:precision,date_timezone:tzName()};
  }
  const DATE_RANK={timestamp:6,minute:6,day:5,approx_minute:4,approx_hour:4,approx_day:3,approx_week:2,approx_year:1,label:0.5,unknown:0};
  const DATE_KEYS=['published_at','published_date','published_label','published_label_full','published_estimated_at','date_precision','date_source','date_timezone','date_year_inferred'];
  const NO_DATE={published_at:null,published_date:null,published_label:null,published_label_full:undefined,published_estimated_at:undefined,date_precision:'unknown',date_source:null,date_timezone:undefined,date_year_inferred:undefined};
  function dateFields(o){const r={};for(const k of DATE_KEYS)if(o&&o[k]!==undefined&&o[k]!==null)r[k]=o[k];return r;}
  // Keep the most precise date evidence; on a tie keep the earlier observation.
  function betterDate(a,b){
    const ra=DATE_RANK[a?.date_precision||'unknown']??0,rb=DATE_RANK[b?.date_precision||'unknown']??0;
    const win=rb>ra?b:a,lose=win===a?b:a;
    return {...NO_DATE,...dateFields(win),published_label:win?.published_label||lose?.published_label||null};
  }
  // The post's own timestamp link (not a comment's): outside the body, links to the post.
  function postTimestampLink(root){
    if(!root)return null;
    const body=root.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]');
    for(const a of root.querySelectorAll('a[href]')){
      const href=a.getAttribute('href')||'';
      if(/comment_id=/.test(href)||!/multi_permalinks=|\/posts\/\d|\/permalink\/\d/.test(href))continue;
      if(body?.contains(a))continue;
      const t=clean(a.innerText||a.getAttribute('aria-label')||'');if(!t||t.length>40)continue;
      return a;
    }
    return null;
  }
  // Hover the timestamp, read the tooltip, un-hover. One tooltip at a time, so it is ours.
  async function hoverExactDate(root,opts={}){
    const wait=opts.wait||(ms=>new Promise(r=>setTimeout(r,ms)));
    const a=postTimestampLink(root);if(!a)return {status:'no_timestamp_link'};
    const doc=a.ownerDocument,view=doc.defaultView;
    const tips=()=>[...doc.querySelectorAll('[role="tooltip"]')].map(t=>clean(t.innerText||t.textContent)).filter(Boolean);
    const fire=(types)=>{const r=a.getBoundingClientRect();const o={bubbles:true,cancelable:true,view,clientX:r.x+r.width/2,clientY:r.y+r.height/2};
      for(const t of types){const Ctor=t.startsWith('pointer')&&view.PointerEvent?view.PointerEvent:view.MouseEvent;a.dispatchEvent(new Ctor(t,o));}};
    const leave=()=>fire(['pointerout','pointerleave','mouseout','mouseleave']);
    leave();await wait(250);
    const before=new Set(tips());
    fire(['pointerover','pointerenter','mouseover','mouseenter','pointermove','mousemove']);
    let text=null;
    for(let i=0;i<12&&!text;i++){await wait(200);text=tips().find(t=>!before.has(t)&&parseFacebookDate(t))||null;}
    leave();
    if(!text)return {status:'no_tooltip',label:clean(a.innerText||'')};
    const parsed=parseFacebookDate(text);
    if(!parsed)return {status:'unparsed',tooltip:text};
    return {status:'ok',...parsed,published_label:clean(a.innerText||'')||null,published_label_full:text,date_source:'hover_tooltip'};
  }
  // Facebook's own comment total, from the post's comment button label
  // ("Comment on Misha Roo's post, 33 comments"). Includes replies. null if unknown.
  function facebookCommentCount(root){
    if(!root)return null;
    for(const el of root.querySelectorAll('[aria-label]')){
      const s=el.getAttribute('aria-label')||'';
      if(/реакц|reaction|нравится|like/i.test(s))continue;
      const m=s.match(/(\d[\d\s .,]*)\s*(тыс|k\b|млн|m\b)?\.?\s*(?:comments?|комментари)/i);
      if(!m)continue;
      if(m[2])return null; // "1,2 тыс." - not an exact number
      const n=parseInt(m[1].replace(/[^\d]/g,''),10);
      if(Number.isFinite(n))return n;
    }
    return null;
  }
  function extractDate(owner){
    const empty={published_at:null,published_date:null,published_label:null,date_precision:'unknown',date_source:null};
    const body=owner.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"],[data-testid="comment_message"],[data-ad-preview="comment"]');
    const postBody=body?.matches('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]');
    let fallback=null;
    for(const el of owner.querySelectorAll('time[datetime],[data-utime],a[aria-label],a[title],abbr[title],span[title],span[aria-label],a[href]')){
      if(!ownElement(el,owner)||body?.contains(el))continue;
      if(postBody&&el.getBoundingClientRect().top>body.getBoundingClientRect().top+2)continue;
      if(el.closest('[data-ad-rendering-role="profile_name"]'))continue;
      const datetime=el.getAttribute('datetime'),ut=el.getAttribute('data-utime');
      if(ut&&/^\d{9,13}$/.test(ut)){
        const n=Number(ut),d=new Date(ut.length<=10?n*1000:n);
        if(Number.isFinite(d.getTime()))return {...empty,published_at:d.toISOString(),published_date:d.toISOString().slice(0,10),published_label:clean(el.innerText||el.textContent)||null,date_precision:'timestamp',date_source:'data-utime'};
      }
      for(const [source,raw] of [['datetime',datetime],['aria-label',el.getAttribute('aria-label')],['title',el.getAttribute('title')],['visible',el.innerText||el.textContent]]){
        const parsed=parseDateEvidence(raw);
        if(parsed){const evidence={...empty,...parsed,published_label:clean(raw),date_source:source};if(parsed.published_at)return evidence;if(!fallback)fallback=evidence;}
        else if(!fallback&&raw&&/^(?:\d+\s*(?:мин|ч|дн|нед|[mhdy]|days?|hours?|weeks?)\.?|сегодня|вчера|today|yesterday|\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр))/iu.test(clean(raw))){fallback={...empty,published_label:clean(raw),date_precision:'label',date_source:source,...(estimateRelativeDate(raw)||{})};}
      }
    }
    return fallback||empty;
  }
  function extractPostMetadata(node,ownerUrl=null){
    const body=node.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]');
    const bodyTop=body?.getBoundingClientRect?.().top;
    let author=null,author_url=null;
    for(const a of node.querySelectorAll('a[href]')){
      if(!ownElement(a,node)||body?.contains(a))continue;
      const profile=stableProfile(a.getAttribute('href')),name=clean(a.innerText||a.textContent);
      if(!profile||!plausibleAuthorName(name))continue;
      const top=a.getBoundingClientRect?.().top;
      const inHeader=!!a.closest('h2,h3,h4,[data-ad-rendering-role="profile_name"]');
      if(!inHeader&&(!Number.isFinite(bodyTop)||!Number.isFinite(top)||top>bodyTop+2))continue;
      author=name;author_url=profile.url;break;
    }
    let author_is_anonymous=false;
    if(!author){
      for(const heading of node.querySelectorAll('h2,h3,h4,[data-ad-rendering-role="profile_name"]')){
        if(!ownElement(heading,node)||body?.contains(heading))continue;
        const label=clean(heading.innerText||heading.textContent);
        if(/^(?:Анонимный участник|Анонимный пользователь|Anonymous participant|Anonymous member|משתתף אנונימי|משתתפת אנונימית)$/iu.test(label)){
          author=label;author_is_anonymous=true;break;
        }
      }
    }
    return {author,author_url,author_is_anonymous,...extractDate(node),media:extractMedia(node,ownerUrl)};
  }
  function isPinned(node){
    const body=node.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"],[data-ad-rendering-role="story_message"]');
    for(const el of node.querySelectorAll('[aria-label],h2,h3')){
      if(!ownElement(el,node)||body?.contains(el))continue;
      if(body&&el.getBoundingClientRect().top>body.getBoundingClientRect().top+2)continue;
      const label=clean(el.getAttribute('aria-label')||el.innerText||el.textContent);
      if(/^(?:Pinned post|Pinned|Featured post|Закрепл[её]нная публикация|Закреплено|פוסט מוצמד)$/iu.test(label))return true;
    }
    return false;
  }
  function extractCard(node,group,loc) {
    const observedNode=node;
    if(!node.matches?.('[role="article"]')&&!detectPostLink(node,group)){
      const primary=[...node.querySelectorAll('[role="article"]')].filter(a=>!a.parentElement?.closest('[role="article"]')&&detectPostLink(a,group));
      if(primary.length===1)node=primary[0];
    }
    const raw=clean(observedNode.innerText||observedNode.textContent||'');
    const bodyNode=node.querySelector('[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="post_message"],[data-ad-rendering-role="story_message"]');
    let link=detectPostLink(node,group);
    // On a permalink page the post itself may not contain its own anchor.
    // Use the verified page URL only when the card also has an identified post-body element.
    if(!link && bodyNode && loc){
      // 0.5.25: borrow the page URL id only for the post inside the open post dialog
      // (or when no such dialog exists), never for a background feed card.
      const dialog=node.ownerDocument?openPostDialog(node.ownerDocument):null;
      const id=(!dialog||dialog.contains(node))?idFromPermalink(loc,group):null;
      if(id)link={id,url:canonicalUrl(group,id)};
    }
    if(!link)return null; // never invent IDs for production posts
    let body=bodyNode?clean(bodyNode.innerText||bodyNode.textContent||''):'';
    if(!body){
      // Mature Pumpkin-Latte approach: prefer visible own text blocks over author/menu/card chrome.
      const candidates=[];
      for(const el of node.querySelectorAll('[dir="auto"],div[lang],span[lang]')){
        if(el.closest('[role="article"]')!==node||el.closest('button,[role="button"]'))continue;
        if(el.querySelector('[role="article"]'))continue; // would mix nested comments
        const txt=clean(el.innerText||el.textContent||'');
        if(txt.length<65)continue;
        const rect=el.getBoundingClientRect?.();const base=node.getBoundingClientRect?.();
        if(rect&&base&&rect.top>base.top+Math.max(500,base.height*.60))continue;
        candidates.push(txt);
      }
      candidates.sort((a,b)=>b.length-a.length);body=candidates[0]||'';
    }
    const comments=extractVisibleComments(node);
    const metadata=extractPostMetadata(node,link.url);
    const main=body||(metadata.media.length||raw.length<35?'':raw);
    return normalizePost({group,post_id:link.id,permalink:link.url,post_text:main,
      post_text_quality:body?'body_selector':metadata.media.length?'media_only':raw.length<35?'no_body_evidence':'whole_card_unstructured',visible_card_text:raw,
      comments,...metadata,is_pinned:isPinned(observedNode)||isPinned(node),links:extractLinks(bodyNode||node,node,link.url),source_page:loc||'',snapshot_at:new Date().toISOString(),collector,
      warning:comments.length?'Only already visible comments; thread completeness unknown.':'No separately extracted visible comments; completeness unknown.'},group);
  }
  // Only manipulate a sorting menu whose relationship to this post is visible.
  // A missing selector does not establish that Facebook exposed every comment.
  async function ensureAllComments(root,{wait=ms=>new Promise(r=>setTimeout(r,ms)),stopped=async()=>false}={}){
    if(!root)return {status:'not_exposed',verified:false};
    const doc=root.ownerDocument,view=doc.defaultView;
    const visible=el=>{if(!el?.isConnected||el.closest('[aria-hidden="true"]'))return false;const s=view.getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
    const label=el=>clean(el.getAttribute('aria-label')||el.innerText||el.textContent||'');
    const all=/^(?:All comments|Все комментарии|כל התגובות)$/iu;
    const sorted=/^(?:Most relevant|Top comments|Newest|Наиболее актуальные|Самые актуальные|Сначала новые|הרלוונטיות ביותר|החדשות ביותר)$/iu;
    const sortControls=()=>[...root.querySelectorAll('button,[role="button"]')].filter(el=>visible(el)&&el.getAttribute('aria-haspopup')==='menu'&&(all.test(label(el))||sorted.test(label(el))));
    const controls=sortControls();
    if(!controls.length)return {status:'not_exposed',verified:false};
    if(controls.length!==1)return {status:'ambiguous_control',verified:false,known_incomplete:true};
    const control=controls[0],before=label(control);
    if(all.test(before))return {status:'already_all',verified:true,label:before};
    if(await stopped())return {status:'paused',verified:false,paused:true};
    const menus=()=>[...doc.querySelectorAll('[role="menu"],[role="listbox"]')].filter(visible);
    const prior=new Set(menus());
    // An already open menu may belong to the user or another component.
    if(control.getAttribute('aria-expanded')==='true')return {status:'preexisting_menu',verified:false,known_incomplete:true};
    control.click();await wait(450);
    const closeOwn=()=>{if(control.isConnected&&control.getAttribute('aria-expanded')==='true')control.click();};
    const fail=(status,extra={})=>{closeOwn();return {status,verified:false,known_incomplete:true,...extra};};
    if(await stopped())return fail('paused',{paused:true});
    const id=control.getAttribute('aria-controls'),linked=id?doc.getElementById(id):null;
    const fresh=menus().filter(el=>!prior.has(el));
    const candidates=linked&&fresh.includes(linked)?[linked]:id?[]:fresh;
    if(candidates.length!==1)return fail('unowned_menu');
    const menu=candidates[0];
    const options=[...menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],button')].filter(el=>visible(el)&&all.test(label(el)));
    if(options.length!==1)return fail('missing_all_option');
    const option=options[0];option.click();await wait(450);
    if(await stopped())return fail('paused',{paused:true});
    const after=sortControls();
    const verified=after.length===1&&all.test(label(after[0]))||visible(option)&&(option.getAttribute('aria-checked')==='true'||option.getAttribute('aria-selected')==='true');
    if(!verified)closeOwn();
    return {status:verified?'selected_all':'selection_unconfirmed',verified:Boolean(verified),known_incomplete:!verified,previous_label:before,label:after.length===1?label(after[0]):null};
  }
  function feedOrderControl(doc){
    const view=doc.defaultView;
    const visible=el=>{if(!el?.isConnected||el.closest('[aria-hidden="true"]'))return false;const s=view.getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
    const newest=/^(?:New posts|Новые публикации|פוסטים חדשים)$/iu;
    const other=/^(?:New activity|Most relevant|Recent activity|Новые действия|Новая активность|Самые актуальные|Наиболее актуальные|פעילות חדשה|הרלוונטיות ביותר)$/iu;
    const prefix=/^(?:сортировать ленту группы по параметру|Sort group feed by)/iu;
    const candidates=[];
    for(const el of doc.querySelectorAll('button,[role="button"]')){
      if(!visible(el)||!['menu','dialog'].includes(el.getAttribute('aria-haspopup'))||el.closest('[role="article"],[data-pagelet^="FeedUnit_"]'))continue;
      const heading=[...el.querySelectorAll('h2,[role="heading"][aria-level="2"]')].map(x=>clean(x.innerText||x.textContent)).filter(Boolean);
      const full_label=clean(el.innerText||el.getAttribute('aria-label')||'');
      if(heading.length!==1||!prefix.test(full_label)&&!newest.test(heading[0])&&!other.test(heading[0]))continue;
      candidates.push({el,visible,newest,label:heading[0],full_label,order:newest.test(heading[0])?'new_posts':other.test(heading[0])?'ranked':'unknown'});
    }
    return candidates.length===1?candidates[0]:{status:candidates.length?'ambiguous_control':'not_exposed',verified:false};
  }
  function inspectFeedOrder(doc){const control=feedOrderControl(doc);return control.el?{status:control.order==='new_posts'?'already_new_posts':'other_order',verified:control.order==='new_posts',order:control.order,label:control.label,full_label:control.full_label,source:'visible_feed_sort_heading'}:control;}
  async function ensureNewPosts(doc,{wait=ms=>new Promise(r=>setTimeout(r,ms)),stopped=async()=>false}={}){
    const found=feedOrderControl(doc);if(!found.el)return found;
    if(found.order==='new_posts')return inspectFeedOrder(doc);
    if(await stopped())return {status:'paused',verified:false,paused:true};
    const {el:control,visible,newest}=found;
    const panels=()=>[...doc.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')].filter(visible);
    const before=new Set(panels());
    if(control.getAttribute('aria-expanded')==='true')return {status:'preexisting_panel',verified:false};
    control.click();await wait(450);
    const closeOwn=()=>{if(control.isConnected&&control.getAttribute('aria-expanded')==='true')control.click();};
    const fail=(status,extra={})=>{closeOwn();return {status,verified:false,order:'unknown',...extra};};
    if(await stopped())return fail('paused',{paused:true});
    const id=control.getAttribute('aria-controls'),linked=id?doc.getElementById(id):null;
    let fresh=panels().filter(x=>!before.has(x));
    fresh=fresh.filter(x=>!fresh.some(parent=>parent!==x&&parent.contains(x)));
    const own=id?(linked&&fresh.includes(linked)?[linked]:[]):fresh;
    if(own.length!==1)return fail('unowned_panel');
    const options=[...own[0].querySelectorAll('button,[role="button"],[role="radio"],[role="menuitemradio"],[role="menuitem"],[role="option"]')].filter(el=>visible(el)&&newest.test(clean((el.innerText||el.getAttribute('aria-label')||'').split('\n')[0])));
    if(options.length!==1)return fail('missing_new_posts_option');
    options[0].click();await wait(450);
    if(await stopped())return fail('paused',{paused:true});
    const proof=inspectFeedOrder(doc);
    if(!proof.verified)return fail('selection_unconfirmed');
    return {...proof,status:'selected_new_posts',previous_label:found.label};
  }
  return {inspectFeedOrder,ensureNewPosts,ensureAllComments,uniqueMedia,collector,clean,hash,idFromPermalink,canonicalUrl,textQuality,truncated,
    parseDateEvidence,parseFacebookDate,estimateRelativeDate,betterDate,postTimestampLink,hoverExactDate,facebookCommentCount,normalizePost,mergePosts,postNodes,extractCard,extractVisibleComments,expandVisible,permalinkPostRoot};
});
