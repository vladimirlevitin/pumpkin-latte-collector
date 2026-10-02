(()=>{
'use strict';

const VERSION='pla-fb-archive-v2.6.3-passive-sync-all';
const SCHEMA_VERSION=2;
const DB_NAME='pumpkin_latte_archive';
const DB_VERSION=1;
const UI_ID='pla-fb-archive-panel';
const GROUP_PATH=(location.pathname.match(/\/groups\/([^/?]+)/)||[])[1]||'facebook-group';
const STATE_KEY=`crawl:${GROUP_PATH}`;
const MAX_EXPAND_CYCLES=2;
const MAX_CLICKS_PER_CYCLE=2;
const ACTION_DELAY_MS=450;
const INGEST_URL='https://ltznpjfnkpydautbsrej.supabase.co/functions/v1/collector-ingest';
const PUBLISHABLE_KEY='sb_publishable_tHMD6sI6e5BS9WOqFAeG1A_jFs6ta6d';
const COLLECTOR_ID_KEY='pla_collector_id';

if(window.__PLA_FB_ARCHIVE?.panel){
  const p=window.__PLA_FB_ARCHIVE.panel;
  if(!p.isConnected&&document.body)document.body.appendChild(p);
  p.style.display='block';
  window.__PLA_FB_ARCHIVE.refresh?.();
  return;
}

const RX={
  moreText:/^(ещ[её]|see more|more|הצג עוד)$/i,
  commentExpand:/(view|see|show|load|more|previous).{0,35}(comment|repl)|(?:посмотреть|показать|загрузить|ещ[её]|предыдущ).{0,35}(комментар|ответ)|(?:תגובות נוספות|הצג.*תגובות|תגובות קודמות|הצג.*תשובות)/i,
  allComments:/^(all comments|все комментарии|כל התגובות)$/i,
  relevantComments:/(most relevant|самые актуаль|наиболее актуаль|relevant|רלוונט)/i,
  interaction:/^(Нравится|Ответить|Поделиться|Like|Reply|Share|Комментировать|אהבתי|השב|שתף)$/i,
  metaOnly:/^(Автор|Администратор|Author|Admin|·)$/i,
  relativeTime:/^\d+\s*(мин|минута|минуты|минут|ч|час|часа|часов|дн|день|дня|дней|нед|неделя|недели|недель|min|m|hr|h|day|days|week|weeks)\.?$/i
};

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const text=e=>norm(e?.innerText||e?.textContent||'');
const visible=e=>{if(!e?.getBoundingClientRect)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
const esc=s=>norm(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowIso=()=>new Date().toISOString();

async function sha256(value){
  const bytes=new TextEncoder().encode(String(value||''));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function parseDate(raw){
  const monthMap={январь:0,января:0,янв:0,февраль:1,февраля:1,фев:1,март:2,марта:2,мар:2,апрель:3,апреля:3,апр:3,май:4,мая:4,июнь:5,июня:5,июн:5,июль:6,июля:6,июл:6,август:7,августа:7,авг:7,сентябрь:8,сентября:8,сен:8,сент:8,октябрь:9,октября:9,окт:9,ноябрь:10,ноября:10,ноя:10,декабрь:11,декабря:11,дек:11};
  let s=norm(raw).toLowerCase().replace(/,/g,' ').replace(/\s+г\.?/g,' ');
  let m=s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if(m)return new Date(+m[3],+m[2]-1,+m[1]);
  m=s.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if(m&&monthMap[m[2]]!==undefined)return new Date(+m[3],monthMap[m[2]],+m[1]);
  m=s.match(/(\d{1,2})\s+([а-яё]+)(?:\s+в\s+\d{1,2}:\d{2})?/i);
  if(m&&monthMap[m[2]]!==undefined){const n=new Date();let d=new Date(n.getFullYear(),monthMap[m[2]],+m[1]);if(d>new Date(n.getTime()+2*864e5))d=new Date(n.getFullYear()-1,monthMap[m[2]],+m[1]);return d;}
  if(/сегодня|today|היום/.test(s))return new Date();
  if(/вчера|yesterday|אתמול/.test(s))return new Date(Date.now()-864e5);
  m=s.match(/^(\d+)\s*(мин|минута|минуты|минут|ч|час|часа|часов|дн|день|дня|дней|нед|неделя|недели|недель|min|m|hr|h|day|days|week|weeks)\.?$/i);
  if(m){const u=m[2].toLowerCase(),ms=/мин|min|^m$/.test(u)?6e4:/^ч$|час|hr|^h$/.test(u)?36e5:/нед|week/.test(u)?6048e5:864e5;return new Date(Date.now()-+m[1]*ms);}
  return null;
}

function dateFromRoot(root,mode='post'){
  const rr=root.getBoundingClientRect?.()||{top:0,height:1000};
  const maxTop=rr.top+(mode==='post'?240:180);
  for(const el of root.querySelectorAll?.('time[datetime],abbr[data-utime],[data-utime]')||[]){
    const nearest=el.closest?.('[role="article"]');
    if(nearest&&nearest!==root)continue;
    const r=el.getBoundingClientRect?.()||{top:0};
    if(r.top>maxTop)continue;
    const dt=el.getAttribute('datetime');
    if(dt){const d=new Date(dt);if(!isNaN(d))return d;}
    const ut=el.getAttribute('data-utime');
    if(ut&&/^\d{9,13}$/.test(ut)){const n=Number(ut);const d=new Date(n>1e12?n:n*1000);if(!isNaN(d))return d;}
  }
  for(const el of root.querySelectorAll?.('a[aria-label],a[title],span[aria-label],span[title]')||[]){
    const nearest=el.closest?.('[role="article"]');
    if(nearest&&nearest!==root)continue;
    const r=el.getBoundingClientRect?.()||{top:0};
    if(r.top>maxTop)continue;
    const raw=[el.getAttribute('aria-label'),el.getAttribute('title'),text(el)].filter(Boolean).join(' ');
    const d=parseDate(raw);if(d&&!isNaN(d))return d;
  }
  return null;
}

function topArticles(root=document){
  return [...root.querySelectorAll('[role="article"]')].filter(a=>!a.parentElement?.closest?.('[role="article"]'));
}

function permalinkMeta(article){
  const links=[...article.querySelectorAll('a[href]')];
  const ar=article.getBoundingClientRect?.()||{top:0,height:1000};
  const candidates=[];
  for(const a of links){
    const href=a.href||a.getAttribute('href')||'';
    if(!/(\/posts\/|\/permalink\/|story_fbid=)/.test(href))continue;
    const r=a.getBoundingClientRect?.()||{top:0};
    if(r.top>ar.top+Math.min(260,ar.height*.35))continue;
    const id=(href.match(/\/(?:posts|permalink)\/(\d+)/)||href.match(/[?&]story_fbid=(\d+)/)||[])[1];
    if(!id)continue;
    const d=parseDate([a.getAttribute('aria-label'),a.getAttribute('title'),text(a)].filter(Boolean).join(' '))||dateFromRoot(article,'post');
    candidates.push({facebook_post_id:id,canonical_url:(new URL(href,location.origin)).href.split('?')[0],posted_at:d&&!isNaN(d)?d.toISOString():null,y:r.top});
  }
  candidates.sort((a,b)=>a.y-b.y);
  return candidates[0]||null;
}

function stableProfileFromHref(href){
  try{
    const u=new URL(href,location.origin);
    const id=u.searchParams.get('id');
    if(id)return {facebook_author_id:id,profile_url:u.origin+u.pathname+'?id='+id};
    const p=u.pathname.split('/').filter(Boolean);
    if(!p.length)return {facebook_author_id:null,profile_url:u.href};
    if(p[0]==='groups'||p[0]==='posts'||p[0]==='permalink'||p[0]==='photo')return {facebook_author_id:null,profile_url:u.href};
    return {facebook_author_id:p[0],profile_url:u.origin+'/'+p[0]};
  }catch{return {facebook_author_id:null,profile_url:href||null};}
}

function extractAuthor(root){
  const rr=root.getBoundingClientRect?.()||{top:0,height:1000};
  const candidates=[];
  for(const a of root.querySelectorAll('a[href]')){
    const nearest=a.closest?.('[role="article"]');
    if(nearest&&nearest!==root)continue;
    const name=norm(text(a));
    const href=a.href||a.getAttribute('href')||'';
    if(!name||name.length<2||name.length>120||!href)continue;
    if(RX.relativeTime.test(name)||RX.interaction.test(name)||RX.metaOnly.test(name))continue;
    if(/\/groups\/|\/posts\/|\/permalink\/|story_fbid=|\/photo\//.test(href))continue;
    const r=a.getBoundingClientRect?.()||{top:0};
    if(r.top>rr.top+Math.min(220,rr.height*.35))continue;
    const p=stableProfileFromHref(href);
    let score=0;
    if(p.facebook_author_id)score+=20;
    if(/^https?:\/\/(www\.)?facebook\.com\//.test(href))score+=10;
    score+=Math.max(0,200-Math.max(0,r.top-rr.top))/20;
    candidates.push({score,display_name:name,facebook_author_id:p.facebook_author_id,profile_url:p.profile_url});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const a=candidates[0];
  return a?{display_name:a.display_name,facebook_author_id:a.facebook_author_id,profile_url:a.profile_url}:{display_name:null,facebook_author_id:null,profile_url:null};
}

function cleanLines(s){
  return norm(s).split('\n').map(norm).filter(Boolean).filter(x=>!RX.interaction.test(x)&&!RX.metaOnly.test(x)&&!RX.commentExpand.test(x)&&!RX.moreText.test(x)&&!RX.relativeTime.test(x));
}

function extractOwnText(root,mode='post'){
  const directMessage=root.querySelector?.('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
  if(directMessage&&text(directMessage))return norm(cleanLines(text(directMessage)).join('\n'));
  const baseRect=root.getBoundingClientRect?.()||{top:0,height:1000};
  const candidates=[];
  for(const e of root.querySelectorAll?.('[dir="auto"], div[lang], span[lang]')||[]){
    if(!visible(e))continue;
    const nearest=e.closest?.('[role="article"]');
    if(nearest!==root)continue;
    if(e.closest?.('[role="button"],button'))continue;
    const r=e.getBoundingClientRect?.()||{top:0};
    if(mode==='post'&&r.top>baseRect.top+Math.max(460,baseRect.height*.55))continue;
    const s=norm(cleanLines(text(e)).join('\n'));
    if(s.length<2||s.length>12000)continue;
    let score=s.length;
    if(/[?!.]/.test(s))score+=30;
    if(e.tagName==='DIV')score+=10;
    candidates.push({s,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]?.s||'';
}

function commentPermalinkId(article){
  for(const a of article.querySelectorAll?.('a[href]')||[]){
    const href=a.href||a.getAttribute('href')||'';
    try{
      const u=new URL(href,location.origin);
      const reply=u.searchParams.get('reply_comment_id');
      const cid=reply||u.searchParams.get('comment_id');
      if(cid)return cid;
    }catch{}
  }
  return null;
}

function commentDate(article){
  const d0=dateFromRoot(article,'comment');
  if(d0&&!isNaN(d0))return d0.toISOString();
  for(const a of article.querySelectorAll?.('a[href]')||[]){
    const raw=[a.getAttribute('aria-label'),a.getAttribute('title'),text(a)].filter(Boolean).join(' ');
    const d=parseDate(raw);if(d&&!isNaN(d))return d.toISOString();
  }
  return null;
}

function nearestParentCommentArticle(article,postArticle){
  let p=article.parentElement;
  while(p&&p!==postArticle){if(p.matches?.('[role="article"]'))return p;p=p.parentElement;}
  return null;
}

function mediaFromRoot(root,ownerType,ownerTempKey){
  const out=[];
  for(const img of root.querySelectorAll?.('img[src]')||[]){
    const nearest=img.closest?.('[role="article"]');
    if(nearest!==root)continue;
    const r=img.getBoundingClientRect?.()||{width:+img.getAttribute('width')||0,height:+img.getAttribute('height')||0};
    if((r.width&&r.width<80)||(r.height&&r.height<80))continue;
    const src=img.currentSrc||img.src||'';if(!src)continue;
    out.push({owner_type:ownerType,owner_temp_key:ownerTempKey,media_type:'image',facebook_url:src,link_url:img.closest('a')?.href||null,alt:img.alt||null,width:Math.round(r.width||0)||null,height:Math.round(r.height||0)||null});
  }
  for(const video of root.querySelectorAll?.('video')||[]){
    const nearest=video.closest?.('[role="article"]');if(nearest!==root)continue;
    const src=video.currentSrc||video.src||video.querySelector('source')?.src||'';
    out.push({owner_type:ownerType,owner_temp_key:ownerTempKey,media_type:'video',facebook_url:src||null,link_url:null,alt:null,width:video.videoWidth||null,height:video.videoHeight||null});
  }
  for(const a of root.querySelectorAll?.('a[href]')||[]){
    const nearest=a.closest?.('[role="article"]');if(nearest!==root)continue;
    const href=a.href||''; if(!href)continue;
    const label=norm(text(a)||a.getAttribute('aria-label')||'');
    if(/\.(pdf|docx?|xlsx?|pptx?)(?:$|[?#])/i.test(href))out.push({owner_type:ownerType,owner_temp_key:ownerTempKey,media_type:/\.pdf/i.test(href)?'pdf':'file',facebook_url:null,link_url:href,alt:label||null,width:null,height:null});
  }
  return out;
}

async function buildPostRecord(article){
  const meta=permalinkMeta(article)||{};
  const author=extractAuthor(article);
  const fullText=extractOwnText(article,'post');
  const canonical_url=meta.canonical_url||null;
  const fallbackBasis=[GROUP_PATH,canonical_url||'',author.facebook_author_id||author.display_name||'',meta.posted_at||'',fullText.slice(0,2000)].join('|');
  const fallback=await sha256(fallbackBasis);
  const facebook_post_id=meta.facebook_post_id||null;
  const key=facebook_post_id?`fb:${GROUP_PATH}:post:${facebook_post_id}`:`fb:${GROUP_PATH}:posthash:${fallback}`;
  const content_hash=await sha256([fullText,meta.posted_at||'',canonical_url||''].join('|'));
  return {key,facebook_post_id,canonical_url,posted_at:meta.posted_at||null,text:fullText,author,content_hash,first_seen_at:nowIso(),last_seen_at:nowIso(),comments_complete:false};
}

async function buildComments(postArticle,postRecord){
  const nested=[...postArticle.querySelectorAll('[role="article"]')].filter(a=>a!==postArticle);
  const articleToTemp=new Map();
  const rows=[];
  for(let i=0;i<nested.length;i++)articleToTemp.set(nested[i],`c${i}`);
  for(const article of nested){
    const s=extractOwnText(article,'comment');
    if(!s)continue;
    const author=extractAuthor(article);
    const facebook_comment_id=commentPermalinkId(article);
    const parentArticle=nearestParentCommentArticle(article,postArticle);
    const parentTempKey=parentArticle?articleToTemp.get(parentArticle)||null:null;
    let depth=0,p=parentArticle;while(p&&p!==postArticle&&depth<20){depth++;p=nearestParentCommentArticle(p,postArticle);}
    const commented_at=commentDate(article);
    const fallback=await sha256([postRecord.key,parentTempKey||'',author.facebook_author_id||author.display_name||'',s,commented_at||''].join('|'));
    const key=facebook_comment_id?`fb:${GROUP_PATH}:comment:${facebook_comment_id}`:`fb:${GROUP_PATH}:commenthash:${fallback}`;
    const content_hash=await sha256([s,commented_at||'',parentTempKey||''].join('|'));
    rows.push({key,temp_key:articleToTemp.get(article),post_key:postRecord.key,parent_temp_key:parentTempKey,facebook_comment_id,depth,text:s,author,commented_at,content_hash,first_seen_at:nowIso(),last_seen_at:nowIso(),_article:article});
  }
  const tempToKey=new Map(rows.map(r=>[r.temp_key,r.key]));
  for(const r of rows)r.parent_comment_key=r.parent_temp_key?tempToKey.get(r.parent_temp_key)||null:null;
  return rows;
}

function isClickableControl(el){return el&&visible(el)&&(el.tagName==='BUTTON'||el.getAttribute?.('role')==='button');}
function clickSafe(el){try{el.click();return true}catch{return false}}

async function expandPostText(article){
  if(!article?.isConnected)return 0;
  let n=0;
  for(const el of article.querySelectorAll('div[role="button"],span[role="button"],button')){
    if(el.closest?.('[role="article"]')!==article)continue;
    const s=text(el);
    if(RX.moreText.test(s)&&isClickableControl(el)){clickSafe(el);n++;break;}
  }
  if(n)await sleep(ACTION_DELAY_MS);
  return n;
}

async function tryAllComments(article){
  const candidates=[...article.querySelectorAll('div[role="button"],span[role="button"],button')].filter(el=>RX.relevantComments.test(text(el)));
  for(const el of candidates.slice(0,1)){
    if(!isClickableControl(el))continue;clickSafe(el);await sleep(ACTION_DELAY_MS);
    const options=[...document.querySelectorAll('[role="menuitem"],[role="option"],div[role="button"],span[role="button"]')].filter(x=>RX.allComments.test(text(x))&&visible(x));
    if(options[0]){clickSafe(options[0]);await sleep(ACTION_DELAY_MS);return true;}
  }
  return false;
}

function remainingExpandControls(article){
  return [...article.querySelectorAll('div[role="button"],span[role="button"],button')].filter(el=>{
    const s=text(el);if(!s||s.length>=180||!visible(el))return false;
    const owner=el.closest?.('[role="article"]');
    const nested=owner&&owner!==article;
    return RX.commentExpand.test(s)||(nested&&RX.moreText.test(s));
  });
}

async function expandComments(article){
  let totalClicks=0;
  for(let cycle=0;cycle<MAX_EXPAND_CYCLES;cycle++){
    if(!article?.isConnected)break;
    const controls=remainingExpandControls(article).slice(0,MAX_CLICKS_PER_CYCLE);
    if(!controls.length)break;
    for(const el of controls){
      if(!article.isConnected)break;
      if(clickSafe(el)){totalClicks++;await sleep(180);}
    }
    if(totalClicks)await sleep(ACTION_DELAY_MS);
  }
  return {totalClicks,complete:article?.isConnected?remainingExpandControls(article).length===0:false};
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const name of ['posts','comments','media','authors','crawl_state'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'key'});
      if(!db.objectStoreNames.contains('errors'))db.createObjectStore('errors',{keyPath:'id',autoIncrement:true});
    };
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}

async function txStore(name,mode='readonly'){
  const db=await openDb();return db.transaction(name,mode).objectStore(name);
}
function reqPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});}
async function getOne(store,key){return reqPromise((await txStore(store)).get(key));}
async function putOne(store,value){return reqPromise((await txStore(store,'readwrite')).put(value));}
async function getAll(store){return reqPromise((await txStore(store)).getAll());}
async function clearStore(store){return reqPromise((await txStore(store,'readwrite')).clear());}
async function countStore(store){return reqPromise((await txStore(store)).count());}
let dbCounts={posts:0,comments:0,media:0,authors:0,errors:0};
let lastSavedAt=null;
async function refreshDbCounts(){
  const names=['posts','comments','media','authors','errors'];
  const values=await Promise.all(names.map(countStore));
  dbCounts=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
  return dbCounts;
}

function getCollectorId(){
  let id=localStorage.getItem(COLLECTOR_ID_KEY);
  if(!id){
    id='pla-'+(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36));
    localStorage.setItem(COLLECTOR_ID_KEY,id);
  }
  return id;
}

function ensureSyncWindow(){
  try{
    if(syncWin&&!syncWin.closed)return syncWin;
    syncWin=window.open('about:blank','PLA_SYNC','width=420,height=300');
    if(syncWin){
      try{
        syncWin.document.open();
        syncWin.document.write('<meta charset="utf-8"><title>Pumpkin Sync</title><body style="font:16px Arial;padding:18px"><b>Pumpkin → Supabase</b><p>Окно синхронизации. Не закрывайте его, пока идёт сбор.</p>');
        syncWin.document.close();
      }catch{}
    }
    return syncWin;
  }catch{return null;}
}

async function buildSyncPayload(postKey){
  const post=await getOne('posts',postKey);
  if(!post?.facebook_post_id||!/^fb:pumpkinlatte:post:[0-9]+$/.test(post.key))return null;
  const [allComments,allMedia,allAuthors]=await Promise.all([getAll('comments'),getAll('media'),getAll('authors')]);
  const comments=allComments.filter(c=>c.post_key===postKey);
  const commentKeys=new Set(comments.map(c=>c.key));
  const media=allMedia.filter(m=>m.owner_key===postKey||commentKeys.has(m.owner_key));
  const authorKeys=new Set([post.author_key,...comments.map(c=>c.author_key)].filter(Boolean));
  const authors=allAuthors.filter(a=>authorKeys.has(a.key));
  return {
    collector_version:VERSION,
    schema_version:SCHEMA_VERSION,
    collector_id:getCollectorId(),
    batch_key:post.key,
    facebook_post_id:String(post.facebook_post_id),
    group:{platform:'facebook',identifier:'pumpkinlatte',url:'https://www.facebook.com/groups/pumpkinlatte/'},
    posts:[post],
    comments,
    media,
    authors
  };
}

async function markSyncStatus(postKey,statusValue,error=''){
  const post=await getOne('posts',postKey);
  if(!post)return;
  await putOne('posts',{...post,sync_status:statusValue,sync_error:error||null,synced_at:statusValue==='synced'?nowIso():(post.synced_at||null)});
}

function submitPayloadsAndWait(payloads){
  return new Promise(resolve=>{
    const w=ensureSyncWindow();
    if(!w){resolve({ok:false,error:'popup_blocked'});return;}
    const ack='ack-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    const form=document.createElement('form');
    form.method='POST';form.action=INGEST_URL;form.target='PLA_SYNC';form.style.display='none';
    for(const [name,value] of [['api_key',PUBLISHABLE_KEY],['mode','popup'],['ack',ack],['payloads',JSON.stringify(payloads)]]){
      const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.appendChild(input);
    }
    document.body.appendChild(form);
    try{form.submit();}catch(e){form.remove();resolve({ok:false,error:String(e?.message||e)});return;}
    form.remove();

    let checks=0;
    const timer=setInterval(()=>{
      checks++;
      try{
        if(w.closed){clearInterval(timer);resolve({ok:false,error:'popup_closed'});return;}
        const href=w.location.href||'';
        if(href.startsWith(location.origin+'/')){
          const u=new URL(href);
          if(u.searchParams.get('pla_sync')===ack){
            clearInterval(timer);
            resolve({ok:u.searchParams.get('pla_ok')==='1',confirmed:true,saved:Number(u.searchParams.get('pla_saved')||0),error:u.searchParams.get('pla_error')||''});
            return;
          }
        }
      }catch{}
      if(checks>=12){
        clearInterval(timer);
        resolve({ok:true,confirmed:false,submitted:true});
      }
    },500);
  });
}

async function drainSyncQueue(){
  if(syncBusy)return;
  syncBusy=true;
  while(syncQueue.length){
    const keys=syncQueue.splice(0,20);
    const payloads=[];
    const validKeys=[];
    for(const postKey of keys){
      await markSyncStatus(postKey,'sending');
      const payload=await buildSyncPayload(postKey);
      if(payload){payloads.push(payload);validKeys.push(postKey);}
      else await markSyncStatus(postKey,'local_only','no_facebook_post_id');
    }
    if(!payloads.length)continue;

    const result=await submitPayloadsAndWait(payloads);
    if(result.ok){
      syncSubmitted+=validKeys.length;
      for(const postKey of validKeys){
        await markSyncStatus(postKey,result.confirmed?'synced':'submitted',result.confirmed?'':'awaiting_confirmation');
      }
    }else{
      syncFailed+=validKeys.length;
      for(const postKey of validKeys)await markSyncStatus(postKey,'pending',result.error||'sync_failed');
    }
    render(result.ok?(result.confirmed?'Supabase: пакет сохранён':'Supabase: пакет отправлен'):'Supabase: повторим пакет позже');
    await sleep(400);
  }
  syncBusy=false;
  render();
}

function queueSyncPost(postKey,force=false){
  if(!/^fb:pumpkinlatte:post:[0-9]+$/.test(postKey||''))return;
  if(!force&&syncQueuedKeys.has(postKey))return;
  syncQueuedKeys.add(postKey);
  syncQueue.push(postKey);
  void drainSyncQueue();
}

async function syncAllLocal(){
  ensureSyncWindow();
  if(syncBusy){render('Синхронизация уже идёт');return;}
  const posts=await getAll('posts');
  const keys=[...new Set(posts.filter(p=>/^fb:pumpkinlatte:post:[0-9]+$/.test(p.key||'')).map(p=>p.key))];
  syncQueue=[...keys];
  syncQueuedKeys=new Set(keys);
  render(`Синхронизация всей локальной базы: ${keys.length} постов`);
  void drainSyncQueue();
}

async function persistAuthor(author){
  if(!author?.display_name&&!author?.facebook_author_id)return null;
  const basis=author.facebook_author_id||`${GROUP_PATH}|${author.display_name}|${author.profile_url||''}`;
  const key=`author:${await sha256(basis)}`;
  const prev=await getOne('authors',key);
  await putOne('authors',{key,...author,first_seen_at:prev?.first_seen_at||nowIso(),last_seen_at:nowIso()});
  return key;
}

async function upsertRecord(store,row){
  const prev=await getOne(store,row.key);
  if(!prev){await putOne(store,row);return 'new';}
  if(prev.content_hash&&row.content_hash&&prev.content_hash===row.content_hash){await putOne(store,{...prev,last_seen_at:nowIso(),comments_complete:row.comments_complete??prev.comments_complete});return 'unchanged';}
  await putOne(store,{...prev,...row,first_seen_at:prev.first_seen_at||row.first_seen_at,last_seen_at:nowIso()});
  return 'updated';
}

async function persistBundle(post,comments,media){
  post.author_key=await persistAuthor(post.author);
  delete post.author;
  const postStatus=await upsertRecord('posts',post);
  let commentsNew=0,commentsUpdated=0;
  for(const c of comments){c.author_key=await persistAuthor(c.author);delete c.author;delete c._article;delete c.temp_key;delete c.parent_temp_key;const s=await upsertRecord('comments',c);if(s==='new')commentsNew++;if(s==='updated')commentsUpdated++;}
  let mediaNew=0;
  for(const m of media){m.key=m.key||`media:${await sha256([m.owner_type,m.owner_key||'',m.media_type,m.facebook_url||'',m.link_url||'',m.alt||''].join('|'))}`;m.content_hash=await sha256([m.facebook_url||'',m.link_url||'',m.alt||'',m.width||'',m.height||''].join('|'));const s=await upsertRecord('media',m);if(s==='new')mediaNew++;}
  return {postStatus,commentsNew,commentsUpdated,mediaNew};
}

async function addError(data){try{await reqPromise((await txStore('errors','readwrite')).add({created_at:nowIso(),...data}))}catch{} }

const stats={posts_seen:0,posts_new:0,posts_updated:0,comments_seen:0,comments_new:0,comments_updated:0,media_seen:0,media_new:0,errors:0,comments_incomplete:0};
let running=false,timer=null,targetNew=100,seenSession=new Set(),emptyScans=0,watchdog=null,syncWin=null,syncQueue=[],syncQueuedKeys=new Set(),syncBusy=false,syncSubmitted=0,syncFailed=0;

async function saveCrawlState(extra={}){
  const state={key:STATE_KEY,collector_version:VERSION,schema_version:SCHEMA_VERSION,group:GROUP_PATH,page_url:location.href,updated_at:nowIso(),stats:{...stats},...extra};
  await putOne('crawl_state',state);return state;
}

async function processArticle(article){
  if(!article?.isConnected)return null;

  // PASSIVE MODE: never click or open Facebook controls in the group feed.
  // Read only what Facebook has already rendered; enrichment will be a separate stage.
  const post=await buildPostRecord(article);
  if(seenSession.has(post.key))return null;
  seenSession.add(post.key);stats.posts_seen++;
  const comments=await buildComments(article,post);
  stats.comments_seen+=comments.length;
  post.comments_complete=remainingExpandControls(article).length===0;
  if(!post.comments_complete)stats.comments_incomplete++;
  post.raw_metadata={...(post.raw_metadata||{}),capture_mode:'passive',needs_enrichment:!post.comments_complete||/Ещё|See more|הצג עוד/i.test(post.text||'')};

  let media=mediaFromRoot(article,'post',post.key).map(m=>({...m,owner_key:post.key}));
  for(const c of comments){for(const m of mediaFromRoot(c._article,'comment',c.key))media.push({...m,owner_key:c.key});}
  stats.media_seen+=media.length;

  const result=await persistBundle(post,comments,media);
  if(result.postStatus==='new')stats.posts_new++;
  else if(result.postStatus==='updated')stats.posts_updated++;
  stats.comments_new+=result.commentsNew;stats.comments_updated+=result.commentsUpdated;stats.media_new+=result.mediaNew;

  lastSavedAt=nowIso();
  await saveCrawlState({checkpoint:{post_key:post.key,facebook_post_id:post.facebook_post_id,posted_at:post.posted_at,canonical_url:post.canonical_url,saved_at:lastSavedAt}});
  await refreshDbCounts();
  queueSyncPost(post.key);
  return {post,result};
}

async function scanVisible(){
  const arts=topArticles().filter(a=>{const r=a.getBoundingClientRect();return r.bottom>-300&&r.top<innerHeight*2.0&&r.height>120});
  for(const a of arts){
    if(!running)break;
    if(!a.isConnected)continue;
    try{await processArticle(a)}catch(err){stats.errors++;await addError({stage:'processArticle',message:String(err?.stack||err)});}
  }
  render();
  return arts.length;
}

async function tick(){
  if(!running)return;
  const found=await scanVisible();
  if(stats.posts_new>=targetNew){stop(`✓ Набрано ${targetNew} новых постов`);return;}
  if(!found){
    emptyScans++;
    if(emptyScans>=2){stop('Пауза: новые посты не загрузились. Данные сохранены.');return;}
    timer=setTimeout(tick,3000);
    return;
  }
  emptyScans=0;
  // SAFE MODE: small, slow scroll; no clicks and no menu interaction.
  scrollBy(0,Math.min(350,Math.max(220,innerHeight*.28)));
  timer=setTimeout(tick,2800);
}

function start(){
  if(running)return;
  targetNew=Math.max(1,Math.min(1000,Number(countInput.value)||100));
  ensureSyncWindow();
  emptyScans=0;
  running=true;
  render('Собираю…');
  tick();
}
function stop(msg='Остановлено'){
  running=false;
  if(timer)clearTimeout(timer);timer=null;
  saveCrawlState({status:'stopped'}).catch(()=>{});
  render(msg);
}

async function exportJson(){
  const [authors,posts,comments,media,errors,states]=await Promise.all(['authors','posts','comments','media','errors','crawl_state'].map(getAll));
  const state=states.find(x=>x.key===STATE_KEY)||null;
  const out={collector_version:VERSION,schema_version:SCHEMA_VERSION,exported_at:nowIso(),group:{platform:'facebook',identifier:GROUP_PATH,url:location.href},crawl:state,authors,posts,comments,media,errors,summary:{posts:posts.length,comments:comments.length,media:media.length,authors:authors.length,errors:errors.length,session:{...stats}}};
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`pumpkin_latte_archive_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);render('JSON сохранён');
}

async function clearTestData(){
  if(!confirm('Очистить локальные данные этого тестового сборщика в IndexedDB? Данные Supabase это НЕ затронет.'))return;
  stop();for(const s of ['posts','comments','media','authors','crawl_state','errors'])await clearStore(s);seenSession.clear();for(const k of Object.keys(stats))stats[k]=0;render('Локальные тестовые данные очищены');
}

async function selfTest(){
  const tests=[];const ok=(name,cond,detail='')=>tests.push({name,pass:!!cond,detail});
  try{
    const h=await sha256('abc');ok('SHA-256',h==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const dp=new DOMParser();
    const doc=dp.parseFromString(`<main><div role="article" id="post"><a href="https://www.facebook.com/alice">Alice Example</a><a href="https://www.facebook.com/groups/help/posts/123456789/" aria-label="2 октября 2026">2 октября 2026</a><div data-ad-preview="message">Как оформить арнону?</div><img src="https://example.com/photo.jpg" width="640" height="480" alt="document"><div role="article" id="c1"><a href="https://www.facebook.com/bob">Bob Example</a><div dir="auto">Первый ответ</div><a href="https://www.facebook.com/groups/help/posts/123?comment_id=555">1 ч</a><div role="article" id="r1"><a href="https://www.facebook.com/carol">Carol Example</a><div dir="auto">Уточнение</div><a href="https://www.facebook.com/groups/help/posts/123?comment_id=555&reply_comment_id=556">30 мин</a></div></div></div></main>`,'text/html');
    const p=doc.querySelector('#post');
    for(const e of doc.querySelectorAll('*'))e.getBoundingClientRect=()=>({top:0,bottom:100,width:640,height:100});
    p.getBoundingClientRect=()=>({top:0,bottom:500,width:640,height:500});
    const pm=permalinkMeta(p);ok('post id',pm?.facebook_post_id==='123456789',JSON.stringify(pm));
    ok('post date',!!pm?.posted_at&&pm.posted_at.startsWith('2026-10-02'),pm?.posted_at||'');
    ok('post text',extractOwnText(p,'post').includes('Как оформить арнону?'));
    const au=extractAuthor(p);ok('author',au.display_name==='Alice Example',JSON.stringify(au));
    const pr=await buildPostRecord(p);const cs=await buildComments(p,pr);
    ok('comment id',cs.some(x=>x.facebook_comment_id==='555'));
    ok('reply id',cs.some(x=>x.facebook_comment_id==='556'));
    ok('reply parent',cs.some(x=>x.facebook_comment_id==='556'&&x.parent_comment_key));
    ok('reply depth',cs.some(x=>x.facebook_comment_id==='556'&&x.depth>0));
    ok('relative time filtered',cleanLines('1 дн.\nПолезный ответ').join('\n')==='Полезный ответ');
    const k1=(await buildPostRecord(p)).key,k2=(await buildPostRecord(p)).key;ok('stable post key',k1===k2);
    const noid=dp.parseFromString('<div role="article"><a href="https://www.facebook.com/alice">Alice</a><div data-ad-preview="message">Текст без ID</div></div>','text/html').body.firstElementChild;
    for(const e of noid.querySelectorAll('*'))e.getBoundingClientRect=()=>({top:0,bottom:100,width:640,height:100});
    noid.getBoundingClientRect=()=>({top:0,bottom:100,width:640,height:100});
    const f1=(await buildPostRecord(noid)).key,f2=(await buildPostRecord(noid)).key;ok('fallback hash stable',f1===f2&&f1.includes('posthash:'));
    const tdoc=dp.parseFromString('<div role="article"><span data-utime="1790899200"></span></div>','text/html').body.firstElementChild;
    for(const e of tdoc.querySelectorAll('*'))e.getBoundingClientRect=()=>({top:0,bottom:100,width:640,height:100});
    tdoc.getBoundingClientRect=()=>({top:0,bottom:100,width:640,height:100});
    ok('data-utime date',dateFromRoot(tdoc,'post') instanceof Date);
    ok('date line is not comment text',cleanLines('3 дн.').length===0);
  }catch(e){ok('self-test runtime',false,String(e?.stack||e));}
  const passed=tests.filter(x=>x.pass).length,failed=tests.length-passed;render(`Самотест: ${passed} PASS / ${failed} FAIL`);return {version:VERSION,passed,failed,tests};
}

function render(msg=''){
  if(!status)return;
  status.innerHTML=(msg?`<b>${esc(msg)}</b><br>`:'')+`Статус: <b>${running?'РАБОТАЕТ':'ОСТАНОВЛЕН'}</b><br>В базе: посты <b>${dbCounts.posts}</b> · комментарии <b>${dbCounts.comments}</b> · медиа <b>${dbCounts.media}</b> · авторы <b>${dbCounts.authors}</b> · ошибки <b>${dbCounts.errors}</b><br>Постов просмотрено сейчас: <b>${stats.posts_seen}</b><br>Новых: <b>${stats.posts_new}</b> · обновлённых: <b>${stats.posts_updated}</b><br>Комментариев сейчас: <b>${stats.comments_seen}</b> · новых: <b>${stats.comments_new}</b><br>Неполные комментарии: <b>${stats.comments_incomplete}</b><br>Supabase: отправлено <b>${syncSubmitted}</b> · ждут <b>${syncQueue.length}</b> · ошибки <b>${syncFailed}</b><br>Последнее сохранение: <b>${lastSavedAt?new Date(lastSavedAt).toLocaleTimeString():'—'}</b>`;
}

const panel=document.createElement('div');panel.id=UI_ID;panel.style='position:fixed;top:12px;right:12px;width:400px;max-height:92vh;overflow:auto;z-index:2147483647;background:#fff;color:#111;border:2px solid #1877f2;border-radius:12px;padding:14px;font:16px/1.4 Arial,sans-serif;box-shadow:0 4px 20px #0005';
panel.innerHTML=`<b style="font-size:18px">Pumpkin Latte Archive — PASSIVE + SYNC</b><span id="pla-x" style="float:right;cursor:pointer;font-size:22px">✕</span><div style="margin-top:8px"><small>${VERSION}</small></div><label style="display:block;margin-top:10px">Остановиться после N новых постов<input id="pla-count" type="number" min="1" max="1000" value="100" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:4px;font-size:16px"></label><div style="display:flex;gap:7px;margin-top:10px"><button id="pla-start" style="flex:1;padding:10px;font-size:16px">▶ Старт</button><button id="pla-stop" style="flex:1;padding:10px;font-size:16px">■ Стоп</button></div><div style="display:flex;gap:7px;margin-top:7px"><button id="pla-export" style="flex:1;padding:9px">Экспорт JSON</button><button id="pla-test" style="flex:1;padding:9px">Самотест</button></div><button id="pla-sync" style="width:100%;padding:9px;margin-top:7px">Синхронизировать локальную базу → Supabase</button><button id="pla-check" style="width:100%;padding:8px;margin-top:7px">Проверить базу</button><button id="pla-clear" style="width:100%;padding:8px;margin-top:7px">Очистить ТЕСТОВЫЕ данные</button><div id="pla-status" style="margin-top:10px;line-height:1.5"></div><div style="margin-top:8px;font-size:12px;color:#555">Сборщик не нажимает кнопки Facebook. Он сохраняет уже загруженные данные в IndexedDB и сразу синхронизирует их с приватным архивом Supabase.</div>`;
document.body.appendChild(panel);
const status=panel.querySelector('#pla-status'),countInput=panel.querySelector('#pla-count');
panel.querySelector('#pla-start').onclick=start;panel.querySelector('#pla-stop').onclick=()=>stop();panel.querySelector('#pla-export').onclick=exportJson;panel.querySelector('#pla-sync').onclick=syncAllLocal;panel.querySelector('#pla-check').onclick=async()=>{await refreshDbCounts();render('База проверена')};panel.querySelector('#pla-clear').onclick=clearTestData;panel.querySelector('#pla-test').onclick=async()=>{const r=await selfTest();console.table(r.tests);console.log('PLA self-test',r)};panel.querySelector('#pla-x').onclick=()=>{stop();panel.style.display='none'};
async function refreshUi(){
  try{await refreshDbCounts();}catch{}
  render(running?'Собираю…':'Панель восстановлена');
}
window.__PLA_FB_ARCHIVE={panel,start,stop,scan:scanVisible,exportJson,selfTest,syncAll:syncAllLocal,version:VERSION,dbName:DB_NAME,stats,refresh:refreshUi};
watchdog=setInterval(async()=>{
  if(!panel.isConnected&&document.body)document.body.appendChild(panel);
  if(running){try{await refreshDbCounts();}catch{};render('Собираю…');}
},2000);
refreshDbCounts().then(()=>render('Готов к запуску')).catch(()=>render('Готов к запуску'));
})();