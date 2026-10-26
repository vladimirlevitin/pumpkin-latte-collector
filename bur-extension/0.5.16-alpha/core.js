/* FB Bur core 0.5.16-alpha; offline-testable, no Facebook API bypass. */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FBBurCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const collector='fb-group-bur/0.5.16-alpha';
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
      const text=cut(typeof c==='string'?c:(c.text||c.body||''),12000);
      if((!text||text.length<3)&&!src.id)continue;
      const id=src.id?String(src.id):'visible-'+hash(text);
      const incoming={id,text,author:src.author||null,author_url:src.author_url||null,
        permalink:src.permalink||null,parent_id:src.parent_id||null,
        text_is_partial:src.text_is_partial===true||truncated(text),
        extraction:src.extraction||'visible_dom_unverified'};
      const prev=byId.get(id);
      if(!prev){byId.set(id,incoming);continue;}
      // Repeated scans must UPGRADE an already captured truncated comment,
      // not preserve its first short text forever under the same permalink ID.
      const better=(!incoming.text_is_partial&&prev.text_is_partial) ||
        (incoming.text_is_partial===prev.text_is_partial&&incoming.text.length>prev.text.length);
      const best=better?incoming:prev,other=better?prev:incoming;
      byId.set(id,{...best,author:best.author||other.author,
        author_url:best.author_url||other.author_url,
        permalink:best.permalink||other.permalink,
        parent_id:best.parent_id||other.parent_id});
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
      if(v&&v.text) variants.push({text:cut(v.text),quality:v.quality||'unknown'});
    }
    if(original && !variants.some(v=>v.text===original)) variants.push({text:original,quality});
    if(p.text && clean(p.text)!==original && !variants.some(v=>v.text===clean(p.text))) variants.push({text:cut(p.text),quality:'legacy_card'});
    const cleaned={
      ...p, group:g, key:g+'|'+identity,identity,post_id:pid,
      id_quality:pid?'permalink':'text_fingerprint_unverified',
      permalink:pid?canonicalUrl(g,pid):(p.permalink||null),
      post_text:cut(original,30000),post_text_quality:quality,
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
      text_variants:variants.slice(-20), comments,comments_status:comments.length?'visible_partial_unverified':'none_extracted_unknown',
      first_seen:old.first_seen||incoming.first_seen,snapshot_at:incoming.snapshot_at,
      id_quality:old.post_id||incoming.post_id?'permalink':'text_fingerprint_unverified',
      text_flags:textQuality(chosen.text)};
    return merged;
  }
  function detectPostLink(node,group) {
    for(const a of node.querySelectorAll('a[href]')) {
      const url=a.getAttribute('href'); const id=idFromPermalink(url,group);
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
    if(!/[A-Za-zА-Яа-яЁё\u0590-\u05FF]/.test(s))return false;
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
      if(parts.length===1&&!blocked.has(parts[0].toLowerCase())&&/^[A-Za-z0-9._-]{2,100}$/.test(parts[0]))return {id:parts[0],url:u.origin+'/'+parts[0]};
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
      if(!profile||!plausibleAuthorName(name))continue;
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
    return cut(String(text||'').split('\n').filter(l=>!/^(?:Ответить|Нравится|Поделиться|Reply|Like|Share|Отредактировано|Подписаться|Показать \d+ ответ(?:а|ов)?|Посмотреть \d+ ответ(?:а|ов)?)$/iu.test(clean(l))).join('\n'),12000);
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
      if(el.querySelector('a[href],button,[role="button"]')){
        const copy=el.cloneNode(true);
        for(const chrome of copy.querySelectorAll('a[href],button,[role="button"],h2,h3,[data-ad-rendering-role="profile_name"]'))chrome.remove();
        text=copy.textContent||'';
      }
      const t=stripCommentChrome(text);if(t&&t.length<12000&&clean(t)!==clean(author?.name))candidates.push(t);
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
      if(article.querySelector('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]'))continue;
      const author=commentAuthor(article),link=commentLink(article);
      const value=ownCommentText(article,author);if(!value&&!link)continue;
      const parent=nearestParentComment(article,node),parent_id=link?.parent_id||(parent?commentLink(parent)?.id||null:null);
      const identity=link?.id||'visible-'+hash((author?.name||'')+'|'+parent_id+'|'+value);
      if(seen.has(identity))continue;seen.add(identity);
      items.push({id:identity,text:value,author:author?.name||null,author_url:author?.url||null,
        permalink:link?.url||null,parent_id,text_is_partial:truncated(value),extraction:'visible_dom_unverified'});
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
  function permalinkPostRoot(doc,group,loc){
    const id=idFromPermalink(loc,group);if(!id)return null;
    const bodies=[...doc.querySelectorAll('[data-ad-comet-preview="message"],[data-ad-preview="message"],[data-testid="post_message"]')];
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
  function expandVisible(nodes,maxClicks=16,mode='post') {
    let clicks=0;
    const bodySelectors='[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="post_message"]';
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
        try{el.click();clicks++;}catch(_){ }
      }
    }
    return clicks;
  }
  function extractCard(node,group,loc) {
    const raw=cut(node.innerText||node.textContent||'');
    if(raw.length<35)return null;
    const bodyNode=node.querySelector('[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-testid="post_message"]');
    let link=detectPostLink(node,group);
    // On a permalink page the post itself may not contain its own anchor.
    // Use the verified page URL only when the card also has an identified post-body element.
    if(!link && bodyNode && loc){const id=idFromPermalink(loc,group);if(id)link={id,url:canonicalUrl(group,id)};}
    if(!link)return null; // never invent IDs for production posts
    let body=bodyNode?cut(bodyNode.innerText||bodyNode.textContent||'',30000):'';
    if(!body){
      // Mature Pumpkin-Latte approach: prefer visible own text blocks over author/menu/card chrome.
      const candidates=[];
      for(const el of node.querySelectorAll('[dir="auto"],div[lang],span[lang]')){
        if(el.closest('[role="article"]')!==node||el.closest('button,[role="button"]'))continue;
        if(el.querySelector('[role="article"]'))continue; // would mix nested comments
        const txt=cut(el.innerText||el.textContent||'',30000);
        if(txt.length<65||txt.length>15000)continue;
        const rect=el.getBoundingClientRect?.();const base=node.getBoundingClientRect?.();
        if(rect&&base&&rect.top>base.top+Math.max(500,base.height*.60))continue;
        candidates.push(txt);
      }
      candidates.sort((a,b)=>b.length-a.length);body=candidates[0]||'';
    }
    const main=body||raw;
    const comments=extractVisibleComments(node);
    const t=node.querySelector('time[datetime],abbr[data-utime],a[aria-label] time[datetime]');
    let published_at=null;
    if(t){const rawTime=t.getAttribute('datetime')||(t.getAttribute('data-utime')?new Date(Number(t.getAttribute('data-utime'))*1000).toISOString():null);
      if(rawTime&&!Number.isNaN(Date.parse(rawTime)))published_at=new Date(rawTime).toISOString();}
    return normalizePost({group,post_id:link.id,permalink:link.url,post_text:main,
      post_text_quality:body?'body_selector':'whole_card_unstructured',visible_card_text:raw,
      comments,published_at,source_page:loc||'',snapshot_at:new Date().toISOString(),collector,
      warning:comments.length?'Only already visible comments; thread completeness unknown.':'No separately extracted visible comments; completeness unknown.'},group);
  }
  return {collector,clean,hash,idFromPermalink,canonicalUrl,textQuality,truncated,
    normalizePost,mergePosts,postNodes,extractCard,extractVisibleComments,expandVisible,permalinkPostRoot};
});
