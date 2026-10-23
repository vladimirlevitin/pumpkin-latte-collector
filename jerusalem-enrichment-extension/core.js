(()=>{
'use strict';

const VERSION='jr-fb-enrichment-v0.1.0';
const SCHEMA_VERSION=2;
const DB_NAME='jerusalem_ru_archive';
const DB_VERSION=1;
const UI_ID='jr-enrichment-hidden-panel';
const GROUP_PATH='374040476267868';
if(!/^\/groups\/374040476267868\/posts\/\d+\/?$/.test(location.pathname))return;
const STATE_KEY=`enrichment:${GROUP_PATH}`;
const MAX_EXPAND_CYCLES=2;
const MAX_CLICKS_PER_CYCLE=2;
const ACTION_DELAY_MS=450;
const INGEST_URL=''; // Server ingestion disabled
const PUBLISHABLE_KEY=''; // No keys in browser
const COLLECTOR_ID_KEY='pla_collector_id';

if(window.__JR_ENRICH_ARCHIVE?.panel){
  const p=window.__JR_ENRICH_ARCHIVE.panel;
  if(!p.isConnected&&document.body)document.body.appendChild(p);
  p.style.display='block';
  window.__JR_ENRICH_ARCHIVE.refresh?.();
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
const syncablePostKey=k=>/^fb:374040476267868:(?:post:[0-9]+|posthash:[a-f0-9]{64})$/.test(String(k||''));

async function sha256(value){
  const bytes=new TextEncoder().encode(String(value||''));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function dedupeDateRaw(raw){
  const s=norm(raw).replace(/\u202f/g,' ');
  const parts=s.split(/\s+/).filter(Boolean);
  if(parts.length>=2&&parts.length%2===0){
    const half=parts.length/2;
    const a=parts.slice(0,half).join(' ');
    const b=parts.slice(half).join(' ');
    if(a===b)return a;
  }
  return s;
}

function atLocalNoon(year,month,day){
  const d=new Date(year,month,day,12,0,0,0);
  return Number.isNaN(d.getTime())?null:d;
}

function parseDate(raw,now=new Date()){
  let s=dedupeDateRaw(raw).toLowerCase().replace(/,/g,' ').replace(/\s+/g,' ').trim();
  if(!s)return null;

  if(/^\d{10,13}$/.test(s)){
    const n=Number(s),d=new Date(s.length===10?n*1000:n);
    return Number.isNaN(d.getTime())?null:d;
  }

  const monthMap={
    'январь':0,'января':0,'янв':0,
    'февраль':1,'февраля':1,'фев':1,
    'март':2,'марта':2,'мар':2,
    'апрель':3,'апреля':3,'апр':3,
    'май':4,'мая':4,
    'июнь':5,'июня':5,'июн':5,
    'июль':6,'июля':6,'июл':6,
    'август':7,'августа':7,'авг':7,
    'сентябрь':8,'сентября':8,'сен':8,'сент':8,
    'октябрь':9,'октября':9,'окт':9,
    'ноябрь':10,'ноября':10,'ноя':10,
    'декабрь':11,'декабря':11,'дек':11
  };

  let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if(m){
    const d=m[4]!==undefined
      ? new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]),Number(m[5]),0,0)
      : atLocalNoon(Number(m[3]),Number(m[2])-1,Number(m[1]));
    return d&&!Number.isNaN(d.getTime())?d:null;
  }

  if(/^(сегодня|today|היום)$/.test(s))return atLocalNoon(now.getFullYear(),now.getMonth(),now.getDate());
  if(/^(вчера|yesterday|אתמול)$/.test(s))return atLocalNoon(now.getFullYear(),now.getMonth(),now.getDate()-1);

  m=s.match(/^(\d+)\s*(мин|минута|минуты|минут|m|min|ч|час|часа|часов|h|hr|дн|день|дня|дней|day|days|нед|неделя|недели|недель|week|weeks)\.?$/i);
  if(m){
    const n=Number(m[1]),unit=m[2].toLowerCase();
    if(/^(мин|минута|минуты|минут|m|min)$/.test(unit))return new Date(now.getTime()-n*60000);
    if(/^(ч|час|часа|часов|h|hr)$/.test(unit))return new Date(now.getTime()-n*3600000);
    const days=/^(нед|неделя|недели|недель|week|weeks)$/.test(unit)?n*7:n;
    return atLocalNoon(now.getFullYear(),now.getMonth(),now.getDate()-days);
  }

  s=s.replace(/\s+г\.?$/,'').trim();
  m=s.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?(?:\s+в\s+(\d{1,2}):(\d{2}))?$/i);
  if(m&&monthMap[m[2]]!==undefined){
    const day=Number(m[1]),month=monthMap[m[2]];
    let year=m[3]?Number(m[3]):now.getFullYear();
    const hasTime=m[4]!==undefined;
    let d=hasTime
      ? new Date(year,month,day,Number(m[4]),Number(m[5]),0,0)
      : atLocalNoon(year,month,day);
    if(!m[3]&&d&&d.getTime()>now.getTime()+7*86400000){
      year--;
      d=hasTime
        ? new Date(year,month,day,Number(m[4]),Number(m[5]),0,0)
        : atLocalNoon(year,month,day);
    }
    return d&&!Number.isNaN(d.getTime())?d:null;
  }

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

function isPlausibleAuthorName(name){
  const s=norm(name);
  if(!s||s.length<2||s.length>80)return false;
  if(!/[A-Za-zА-Яа-яЁё\u0590-\u05FF]/.test(s))return false;
  if(/^\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2}$/.test(s))return false;
  if(/^(?:https?:\/\/|www\.)/i.test(s))return false;
  if(/\b[a-z0-9-]+\.(?:com|net|org|co|il|gov|edu|io|me)\b/i.test(s))return false;
  if(/^[\d\s:/.\-]+$/.test(s))return false;
  return true;
}

function stableProfileFromHref(href){
  try{
    const u=new URL(href,location.origin);
    const host=u.hostname.toLowerCase();
    if(!['facebook.com','www.facebook.com','m.facebook.com'].includes(host))return {facebook_author_id:null,profile_url:null};

    const parts=u.pathname.split('/').filter(Boolean);
    if(!parts.length)return {facebook_author_id:null,profile_url:null};

    if(
      parts.length>=4 &&
      parts[0].toLowerCase()==='groups' &&
      parts[2].toLowerCase()==='user' &&
      /^\d+$/.test(parts[3])
    ){
      const id=parts[3];
      return {facebook_author_id:id,profile_url:`https://www.facebook.com/profile.php?id=${id}`};
    }

    const first=parts[0].toLowerCase();
    const blocked=new Set([
      'l.php','groups','posts','permalink','photo','photos','watch','reel','reels',
      'story.php','stories','events','marketplace','gaming','help','login','share',
      'sharer.php','plugins','pages','places','page','people','public','hashtag',
      'search','notifications','messages','friends','settings','privacy','bookmarks'
    ]);
    if(blocked.has(first))return {facebook_author_id:null,profile_url:null};

    if(first==='profile.php'){
      const id=u.searchParams.get('id');
      return /^\d+$/.test(id||'')
        ?{facebook_author_id:id,profile_url:`https://www.facebook.com/profile.php?id=${id}`}
        :{facebook_author_id:null,profile_url:null};
    }

    if(parts.length!==1)return {facebook_author_id:null,profile_url:null};
    const id=parts[0];
    if(!/^[A-Za-z0-9._-]{2,100}$/.test(id))return {facebook_author_id:null,profile_url:null};
    return {facebook_author_id:id,profile_url:`https://www.facebook.com/${id}`};
  }catch{return {facebook_author_id:null,profile_url:null};}
}

function isPlausibleAuthorRecord(author){
  if(!author||!isPlausibleAuthorName(author.display_name))return false;
  const p=stableProfileFromHref(author.profile_url||'');
  if(!p.profile_url)return false;
  if(String(author.facebook_author_id||'').toLowerCase()==='l.php')return false;
  return true;
}

function extractAuthor(root){
  const rr=root.getBoundingClientRect?.()||{top:0,height:1000};
  const directMessage=root.querySelector?.('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
  const mr=directMessage?.getBoundingClientRect?.();
  const messageTop=mr&&Number.isFinite(mr.top)?mr.top:Infinity;
  const headerBottom=Math.min(rr.top+Math.min(180,Math.max(100,rr.height*.32)),messageTop+4);
  const candidates=[];

  for(const a of root.querySelectorAll('a[href]')){
    const nearest=a.closest?.('[role="article"]');
    if(nearest&&nearest!==root)continue;
    if(a.closest?.('button,[role="button"],[role="slider"]'))continue;

    const name=norm(text(a));
    if(!isPlausibleAuthorName(name))continue;
    if(RX.relativeTime.test(name)||RX.interaction.test(name)||RX.metaOnly.test(name))continue;

    const href=a.href||a.getAttribute('href')||'';
    const p=stableProfileFromHref(href);
    if(!p.profile_url)continue;

    const r=a.getBoundingClientRect?.()||{top:Infinity,bottom:Infinity};
    if(Number.isFinite(r.top)&&r.top>headerBottom)continue;

    const semantic=!!a.closest?.('h2,h3,strong,[data-ad-rendering-role="profile_name"]');
    let score=0;
    if(p.facebook_author_id)score+=35;
    if(Number.isFinite(r.top)&&r.top<=rr.top+90)score+=30;
    if(Number.isFinite(r.bottom)&&r.bottom<=messageTop+4)score+=20;
    if(semantic)score+=25;
    if(name.includes(' '))score+=5;
    candidates.push({score,display_name:name,facebook_author_id:p.facebook_author_id,profile_url:p.profile_url});
  }

  candidates.sort((a,b)=>b.score-a.score);
  const a=candidates[0];
  if(!a||a.score<65)return {display_name:null,facebook_author_id:null,profile_url:null};
  return {display_name:a.display_name,facebook_author_id:a.facebook_author_id,profile_url:a.profile_url};
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

function commentScopeForPost(postArticle){
  // Diagnostic v2.7.1 showed the desired post is itself the large outer role=article
  // and its comments are nested role=article descendants. Keep enrichment strictly
  // inside that article so nearby feed cards cannot contaminate the payload.
  return postArticle||null;
}

function nearbyCommentContainer(node,root,postArticle){
  let p=node?.parentElement||null,best=null;
  for(let i=0;p&&i<9;i++,p=p.parentElement){
    if(p===postArticle||p.contains?.(postArticle))continue;
    if(root&&p!==root&&!root.contains?.(p))break;
    const s=text(p);
    if(s.length>=2&&s.length<=3500){
      const hasMessage=!!p.querySelector?.('[data-ad-preview="message"],[data-ad-comet-preview="message"]');
      const hasCommentLink=!![...p.querySelectorAll?.('a[href]')||[]].some(a=>/[?&](?:comment_id|reply_comment_id)=\d+/.test(a.href||a.getAttribute('href')||''));
      const hasInteraction=/(Нравится|Ответить|Like|Reply|אהבתי|השב)/i.test(s);
      if(hasMessage||hasCommentLink||hasInteraction)best=p;
      if((hasMessage||hasCommentLink)&&s.length<1800)return p;
    }
    if(p===root)break;
  }
  return best;
}

async function buildComments(postArticle,postRecord,scopeRoot=null){
  const root=scopeRoot||postArticle;

  // The group feed uses nested role=article comments. A direct permalink can use
  // a different DOM, so enrichment also discovers comment message nodes and
  // comment permalink anchors.
  const units=[];
  const seenNodes=new Set();
  const pushUnit=(container,forcedText=null)=>{
    if(!container||seenNodes.has(container)||container===postArticle||container.contains?.(postArticle))return;
    const s=norm(forcedText||extractOwnText(container,'comment'));
    if(!s||s===norm(postRecord.text||'')||s.length>12000)return;
    seenNodes.add(container);units.push({container,s});
  };

  for(const article of root.querySelectorAll?.('[role="article"]')||[]){
    if(!visible(article))continue;
    pushUnit(article);
  }

  const postMessage=postArticle.querySelector?.('[data-ad-preview="message"],[data-ad-comet-preview="message"]');
  for(const msg of root.querySelectorAll?.('[data-ad-preview="message"],[data-ad-comet-preview="message"]')||[]){
    if(msg===postMessage||postMessage?.contains?.(msg)||!visible(msg))continue;
    const s=norm(cleanLines(text(msg)).join('\n'));
    if(!s)continue;
    const container=msg.closest?.('[role="article"]')||nearbyCommentContainer(msg,root,postArticle)||msg.parentElement;
    pushUnit(container,s);
  }

  for(const a of root.querySelectorAll?.('a[href]')||[]){
    const href=a.href||a.getAttribute('href')||'';
    if(!/[?&](?:comment_id|reply_comment_id)=\d+/.test(href))continue;
    const container=a.closest?.('[role="article"]')||nearbyCommentContainer(a,root,postArticle);
    if(container)pushUnit(container);
  }

  const rows=[],dedupe=new Set();
  for(let i=0;i<units.length;i++){
    const article=units[i].container,s=units[i].s;
    const author=extractAuthor(article);
    const facebook_comment_id=commentPermalinkId(article);
    const commented_at=commentDate(article);
    const dedupeKey=facebook_comment_id||[author.display_name||'',s,commented_at||''].join('|');
    if(dedupe.has(dedupeKey))continue;dedupe.add(dedupeKey);
    const fallback=await sha256([postRecord.key,author.facebook_author_id||author.display_name||'',s,commented_at||''].join('|'));
    const key=facebook_comment_id?`fb:${GROUP_PATH}:comment:${facebook_comment_id}`:`fb:${GROUP_PATH}:commenthash:${fallback}`;
    const content_hash=await sha256([s,commented_at||''].join('|'));
    rows.push({key,temp_key:`c${rows.length}`,post_key:postRecord.key,parent_temp_key:null,parent_comment_key:null,facebook_comment_id,depth:0,text:s,author,commented_at,content_hash,first_seen_at:nowIso(),last_seen_at:nowIso(),_article:article});
  }
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
  const controls=[...article.querySelectorAll('div[role="button"],span[role="button"],button')].filter(visible);
  // If Facebook already shows "All comments / Все комментарии", do not open the menu.
  if(controls.some(el=>RX.allComments.test(text(el))))return true;

  const candidates=controls.filter(el=>RX.relevantComments.test(text(el)));
  for(const el of candidates.slice(0,1)){
    if(!isClickableControl(el))continue;
    clickSafe(el);await sleep(ACTION_DELAY_MS);
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

async function expandComments(article,maxCycles=MAX_EXPAND_CYCLES,maxClicksPerCycle=MAX_CLICKS_PER_CYCLE){
  let totalClicks=0;
  for(let cycle=0;cycle<maxCycles;cycle++){
    if(!article?.isConnected)break;
    const controls=remainingExpandControls(article).slice(0,maxClicksPerCycle);
    if(!controls.length)break;
    let cycleClicks=0;
    for(const el of controls){
      if(!article.isConnected)break;
      if(clickSafe(el)){totalClicks++;cycleClicks++;await sleep(220);}
    }
    if(cycleClicks)await sleep(Math.max(ACTION_DELAY_MS,650));
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
    // Open exactly one visible helper window from a direct user action.
    // The helper itself never navigates cross-origin; each upload goes through
    // a hidden iframe inside it, so browsers cannot turn every batch into a
    // separate popup when window.name is reset on cross-site navigation.
    syncWin=window.open('about:blank','PLA_SYNC_HOST','width=420,height=300');
    if(syncWin){
      try{
        syncWin.document.open();
        syncWin.document.write('<!doctype html><meta charset="utf-8"><title>Pumpkin Sync</title><body style="font:16px Arial;padding:18px"><b>Pumpkin → Supabase</b><p id="pla-sync-status">Окно синхронизации. Не закрывайте его, пока идёт сбор.</p><div id="pla-sync-frames" style="display:none"></div></body>');
        syncWin.document.close();
      }catch{}
    }
    return syncWin;
  }catch{return null;}
}

function syncWindowStatus(message){
  try{
    if(syncWin&&!syncWin.closed){
      const e=syncWin.document.getElementById('pla-sync-status');
      if(e)e.textContent=message;
    }
  }catch{}
}

async function buildSyncPayload(postKey){
  const post=await getOne('posts',postKey);
  if(!post||!syncablePostKey(post.key))return null;
  const canonical=/^fb:374040476267868:post:[0-9]+$/.test(post.key);
  if(canonical&&!post.facebook_post_id)return null;
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
    facebook_post_id:canonical?String(post.facebook_post_id):null,
    group:{platform:'facebook',identifier:'pumpkinlatte',url:'https://www.facebook.com/groups/pumpkinlatte/'},
    posts:[{...post,facebook_post_id:canonical?String(post.facebook_post_id):null}],
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
    const target='PLA_SYNC_HOST';
    try{w.name=target;}catch{}

    const form=document.createElement('form');
    form.method='POST';form.action=INGEST_URL;form.target=target;form.style.display='none';
    for(const [name,value] of [['api_key',PUBLISHABLE_KEY],['mode','popup'],['ack',ack],['payloads',JSON.stringify(payloads)]]){
      const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.appendChild(input);
    }
    document.body.appendChild(form);
    syncWindowStatus(`Отправляю пакет: ${payloads.length} постов…`);
    try{throw Error('Server sync disabled; use local export');}catch(e){form.remove();resolve({ok:false,error:String(e?.message||e)});return;}
    form.remove();

    let checks=0,done=false;
    const finish=result=>{if(done)return;done=true;resolve(result);};
    const timer=setInterval(()=>{
      checks++;
      if(!syncWin||syncWin.closed){
        clearInterval(timer);finish({ok:false,error:'popup_closed'});return;
      }
      try{
        const href=syncWin.location.href||'';
        if(href.startsWith(location.origin+'/')){
          const u=new URL(href);
          if(u.searchParams.get('pla_sync')===ack){
            clearInterval(timer);
            const ok=u.searchParams.get('pla_ok')==='1';
            const saved=Number(u.searchParams.get('pla_saved')||0);
            const error=u.searchParams.get('pla_error')||'';
            try{
              syncWin.document.open();
              syncWin.document.write('<!doctype html><meta charset="utf-8"><title>Pumpkin Sync</title><body style="font:16px Arial;padding:18px"><b>Pumpkin → Supabase</b><p id="pla-sync-status">'+(ok?'Сохранено в Supabase: '+saved:'Ошибка синхронизации: '+error)+'</p></body>');
              syncWin.document.close();
            }catch{}
            finish({ok,confirmed:true,saved,error});
            return;
          }
        }
      }catch{}
      if(checks>=40){
        clearInterval(timer);
        syncWindowStatus('Пакет отправлен; подтверждение не получено');
        finish({ok:true,confirmed:false,submitted:true});
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
  if(!syncablePostKey(postKey))return;
  if(!force&&syncQueuedKeys.has(postKey))return;
  syncQueuedKeys.add(postKey);
  syncQueue.push(postKey);
  void drainSyncQueue();
}

async function syncAllLocal(){
  // Pilot bridge owns transport; never open collector sync window.
  if(syncBusy){render('Синхронизация уже идёт');return;}
  const posts=await getAll('posts');
  const keys=[...new Set(posts.filter(p=>syncablePostKey(p.key)).map(p=>p.key))];
  syncQueue=[...keys];
  syncQueuedKeys=new Set(keys);
  syncWindowStatus(`Синхронизация всей локальной базы: ${keys.length} постов`);render(`Синхронизация всей локальной базы: ${keys.length} постов`);
  void drainSyncQueue();
}

async function persistAuthor(author){
  if(!isPlausibleAuthorRecord(author))return null;
  const basis=author.facebook_author_id||`${GROUP_PATH}|${author.display_name}|${author.profile_url||''}`;
  const key=`author:${await sha256(basis)}`;
  const prev=await getOne('authors',key);
  await putOne('authors',{key,...author,first_seen_at:prev?.first_seen_at||nowIso(),last_seen_at:nowIso()});
  return key;
}

async function upsertRecord(store,row){
  const prev=await getOne(store,row.key);
  if(prev&&['posts','comments'].includes(store)){
    const oldText=String(prev.text||''),newText=String(row.text||'');
    if(oldText.length>newText.length&&(!newText||oldText.startsWith(newText.slice(0,Math.min(50,newText.length))))){row.text=oldText;row.content_hash=prev.content_hash||row.content_hash;}
    if(store==='posts'&&prev.comments_complete===true&&row.comments_complete===false)row.comments_complete=true;
  }
  if(!prev){await putOne(store,row);return 'new';}
  if(prev.content_hash&&row.content_hash&&prev.content_hash===row.content_hash){await putOne(store,{...prev,...row,first_seen_at:prev.first_seen_at||row.first_seen_at,last_seen_at:nowIso(),comments_complete:row.comments_complete??prev.comments_complete});return 'unchanged';}
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

function currentPagePostId(){
  const href=location.href||'';
  return (href.match(/\/posts\/(\d+)/)||href.match(/[?&]story_fbid=(\d+)/)||[])[1]||null;
}

function hrefPostId(href){
  const s=String(href||'');
  return (s.match(/\/(?:posts|permalink)\/(\d+)/)||s.match(/[?&]story_fbid=(\d+)/)||[])[1]||null;
}

function exactPostAnchorCount(root,id){
  if(!root||!id)return 0;
  let n=0;
  for(const a of root.querySelectorAll?.('a[href]')||[]){
    if(String(hrefPostId(a.href||a.getAttribute('href')||''))===String(id))n++;
  }
  return n;
}

function activePostRoot(id){
  const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible);
  const scored=dialogs.map(d=>{
    const r=d.getBoundingClientRect?.()||{width:0,height:0};
    return {root:d,exact:exactPostAnchorCount(d,id),area:Number(r.width||0)*Number(r.height||0),chars:text(d).length};
  }).filter(x=>x.exact>0);
  scored.sort((a,b)=>b.exact-a.exact||b.area-a.area||b.chars-a.chars);
  return scored[0]?.root||document;
}

function outerArticles(root){
  const all=[...root.querySelectorAll?.('[role="article"]')||[]].filter(visible);
  return all.filter(a=>{
    let p=a.parentElement;
    while(p&&p!==root){
      if(p.matches?.('[role="article"]'))return false;
      p=p.parentElement;
    }
    return true;
  });
}

function currentPostSelection(id=currentPagePostId()){
  if(!id)return null;
  const root=activePostRoot(id);
  const candidates=outerArticles(root).map(article=>{
    const r=article.getBoundingClientRect?.()||{width:0,height:0};
    const exact=exactPostAnchorCount(article,id);
    const nested=[...article.querySelectorAll?.('[role="article"]')||[]].filter(x=>x!==article).length;
    const chars=text(article).length;
    return {article,root,exact,nested,chars,area:Number(r.width||0)*Number(r.height||0)};
  }).filter(x=>x.exact>0);

  candidates.sort((a,b)=>b.exact-a.exact||b.nested-a.nested||b.chars-a.chars||b.area-a.area);
  const best=candidates[0],second=candidates[1];
  if(!best)return null;

  // Primary shape: the opened post usually contains repeated links to its own
  // permalink and nested comment articles. Some Facebook permalink layouts,
  // however, expose only one exact self-link (and posts with few/no comments can
  // have no nested article at all). On an exact /posts/ID/ route, allow that
  // fallback only when the target is still unambiguous among visible outer cards.
  const separated=!second||best.exact>second.exact||best.nested>second.nested+2;
  const strong=best.exact>=2&&best.nested>=1&&best.chars>=120&&separated;
  const fallbackSeparated=!second||
    best.exact>second.exact||
    best.nested>second.nested||
    (best.chars>=Math.max(160,second.chars*1.35)&&best.area>=second.area*.7);
  const permalinkFallback=best.exact>=1&&best.chars>=80&&fallbackSeparated;
  return (strong||permalinkFallback)?best:null;
}

function scrollContainerFor(article,root){
  let p=article?.parentElement||null;
  while(p&&p!==document.body){
    try{
      const cs=getComputedStyle(p);
      if(/auto|scroll/i.test(cs.overflowY||'')&&p.scrollHeight>p.clientHeight+120)return p;
    }catch{}
    if(p===root)break;
    p=p.parentElement;
  }
  if(root&&root!==document){
    try{
      const cs=getComputedStyle(root);
      if(/auto|scroll/i.test(cs.overflowY||'')&&root.scrollHeight>root.clientHeight+120)return root;
    }catch{}
  }
  return document.scrollingElement||document.documentElement;
}

function scrollComments(container){
  try{
    if(container===document.scrollingElement||container===document.documentElement||container===document.body){
      const before=window.scrollY;
      const max=Math.max(0,(document.scrollingElement?.scrollHeight||document.documentElement.scrollHeight)-innerHeight);
      window.scrollBy(0,Math.max(500,innerHeight*.58));
      const after=window.scrollY;
      return {moved:after>before+1,atEnd:after>=max-30,before,after,max};
    }
    const before=container.scrollTop;
    const max=Math.max(0,container.scrollHeight-container.clientHeight);
    container.scrollTop=Math.min(max,before+Math.max(450,container.clientHeight*.62));
    const after=container.scrollTop;
    return {moved:after>before+1,atEnd:after>=max-30,before,after,max};
  }catch{return {moved:false,atEnd:false,before:0,after:0,max:0}}
}

function displayedCommentCount(root){
  let best=null;
  const els=[...root.querySelectorAll?.('[aria-label],[title],button,[role="button"]')||[]];
  for(const el of els){
    const raw=[el.getAttribute?.('aria-label'),el.getAttribute?.('title'),text(el)].filter(Boolean).join(' ');
    if(!raw||raw.length>180)continue;
    let m=raw.match(/(\d{1,5})\s*(?:комментар(?:ий|ия|иев)?|comments?|תגובות)/i);
    if(!m)m=raw.match(/(?:комментар(?:ий|ия|иев)?|comments?|תגובות)\s*(\d{1,5})/i);
    if(m){
      const n=Number(m[1]);
      if(Number.isFinite(n)&&n>=0&&(best===null||n>best))best=n;
    }
  }
  return best;
}

function dateFromPostHeaderText(root){
  const rr=root.getBoundingClientRect?.()||{top:0,height:1000};
  const maxTop=rr.top+Math.min(280,Math.max(180,rr.height*.16));
  for(const el of root.querySelectorAll?.('a,span')||[]){
    const nearest=el.closest?.('[role="article"]');
    if(nearest&&nearest!==root)continue;
    const r=el.getBoundingClientRect?.()||{top:0};
    if(r.top<rr.top-20||r.top>maxTop)continue;
    const raw=norm([el.getAttribute?.('aria-label'),el.getAttribute?.('title'),text(el)].filter(Boolean).join(' '));
    if(!raw||raw.length>120)continue;
    const direct=parseDate(raw);
    if(direct&&!isNaN(direct))return direct;
    const m=raw.match(/\b\d{1,2}\s+[А-Яа-яЁё]+(?:\s+\d{4})?(?:\s+в\s+\d{1,2}:\d{2})?\b/i);
    if(m){const d=parseDate(m[0]);if(d&&!isNaN(d))return d;}
  }
  return null;
}

async function enrichCurrentPost(){
  stop();
  const pagePostId=currentPagePostId();
  if(!pagePostId){
    render('Обогащение: откройте оригинал одного поста Facebook (/posts/ID/)');
    return {ok:false,error:'not_single_post_page'};
  }

  // Pilot bridge owns transport; never open collector sync window.

  let selected=currentPostSelection(pagePostId);
  if(!selected){
    render('Обогащение остановлено: не удалось однозначно определить открытый пост. Ничего не сохранено.');
    return {ok:false,error:'post_target_ambiguous',facebook_post_id:pagePostId};
  }

  let article=selected.article,root=selected.root;
  const scrollContainer=scrollContainerFor(article,root);
  const startWindowY=window.scrollY;
  const startScrollTop=scrollContainer&&scrollContainer!==document.scrollingElement?scrollContainer.scrollTop:null;

  const beforeText=extractOwnText(article,'post');
  const beforePrefix=norm(beforeText).slice(0,120);
  const beforeAuthor=extractAuthor(article)?.display_name||'';
  const initialNested=[...article.querySelectorAll?.('[role="article"]')||[]].filter(x=>x!==article).length;
  const expectedComments=displayedCommentCount(article);

  const postKey=`fb:${GROUP_PATH}:post:${pagePostId}`;
  const existingLocalComments=(await getAll('comments')).filter(x=>x.post_key===postKey);
  const existingLocalCount=existingLocalComments.length;

  // Facebook virtualizes long discussions: older DOM nodes can disappear while
  // new ones are loaded. Keep a cumulative map so comments seen on earlier scroll
  // positions are not lost.
  const commentMap=new Map(existingLocalComments.map(x=>[x.facebook_comment_id||x.key,{...x}]));
  let snapshots=0;

  const collectSnapshot=async()=>{
    selected=currentPostSelection(pagePostId);
    if(!selected)return {ok:false,count:commentMap.size};
    article=selected.article;
    const seed=await buildPostRecord(article);
    seed.facebook_post_id=String(pagePostId);
    seed.key=postKey;
    seed.canonical_url=`https://www.facebook.com/groups/${GROUP_PATH}/posts/${pagePostId}/`;
    const rows=await buildComments(article,seed,article);
    for(const row of rows){
      const k=row.facebook_comment_id||row.key;
      const prev=commentMap.get(k);
      if(!prev||String(row.text||'').length>=String(prev.text||'').length)commentMap.set(k,row);
    }
    snapshots++;
    return {ok:true,count:commentMap.size,current:rows.length};
  };

  await collectSnapshot();
  render('Обогащение: выбран пост · комментариев накоплено '+commentMap.size+(expectedComments!==null?' из '+expectedComments:''));

  let textClicks=0;
  for(let i=0;i<3;i++){
    if(String(currentPagePostId()||'')!==String(pagePostId)){
      render('Обогащение остановлено: Facebook сменил открытый пост. Ничего не сохранено.');
      return {ok:false,error:'route_changed_before_save'};
    }
    const n=await expandPostText(article);
    textClicks+=n;
    if(!n)break;
    await sleep(350);
  }

  render('Обогащение: проверяю режим «Все комментарии»…');
  const allCommentsSelected=await tryAllComments(article);
  await sleep(900);
  await collectSnapshot();

  render('Обогащение: догружаю комментарии, сохраняя каждую порцию…');
  let totalClicks=0,stableUnique=0,previousUnique=commentMap.size,lastScroll={moved:true,atEnd:false};
  let cycles=0;

  for(let cycle=0;cycle<28;cycle++){
    cycles=cycle+1;
    if(String(currentPagePostId()||'')!==String(pagePostId)){
      render('Обогащение остановлено: Facebook сменил открытый пост. Ничего не сохранено.');
      return {ok:false,error:'route_changed_during_enrichment'};
    }

    selected=currentPostSelection(pagePostId);
    if(!selected){
      render('Обогащение остановлено: потерян главный блок поста. Ничего не сохранено.');
      return {ok:false,error:'post_target_lost'};
    }
    article=selected.article;

    await collectSnapshot();
    if(expectedComments!==null&&commentMap.size>=expectedComments)break;

    const ex=await expandComments(article,2,10);
    totalClicks+=ex.totalClicks||0;
    if(ex.totalClicks)await sleep(550);
    await collectSnapshot();
    if(expectedComments!==null&&commentMap.size>=expectedComments)break;

    lastScroll=scrollComments(scrollContainer);
    await sleep(900);
    await collectSnapshot();

    if(commentMap.size===previousUnique)stableUnique++;else stableUnique=0;
    previousUnique=commentMap.size;

    render('Обогащение: накоплено комментариев '+commentMap.size+(expectedComments!==null?' из '+expectedComments:'')+' · цикл '+cycles);

    if(expectedComments!==null&&commentMap.size>=expectedComments)break;
    if(stableUnique>=5&&!(ex.totalClicks>0)&&lastScroll.atEnd)break;
    if(stableUnique>=8&&!(ex.totalClicks>0))break;
  }

  if(String(currentPagePostId()||'')!==String(pagePostId)){
    render('Обогащение остановлено: URL поста изменился. Ничего не сохранено.');
    return {ok:false,error:'route_changed_before_persist'};
  }

  selected=currentPostSelection(pagePostId);
  if(!selected){
    render('Обогащение остановлено: главный блок поста не найден перед сохранением.');
    return {ok:false,error:'post_target_missing_before_persist'};
  }
  article=selected.article;

  const post=await buildPostRecord(article);
  post.facebook_post_id=String(pagePostId);
  post.key=postKey;
  post.canonical_url=`https://www.facebook.com/groups/${GROUP_PATH}/posts/${pagePostId}/`;

  if(!post.posted_at){
    const d=dateFromPostHeaderText(article);
    if(d&&!isNaN(d))post.posted_at=d.toISOString();
  }

  const afterPrefix=norm(post.text||'').slice(0,120);
  const samePostText=(beforePrefix.length>=3&&afterPrefix.length>=3&&
    (beforePrefix.startsWith(afterPrefix.slice(0,Math.min(80,afterPrefix.length)))||
     afterPrefix.startsWith(beforePrefix.slice(0,Math.min(80,beforePrefix.length)))))||
    (beforePrefix.length<3&&beforePrefix===afterPrefix);
  const sameAuthor=!beforeAuthor||!post.author?.display_name||beforeAuthor===post.author.display_name;
  const exactNow=exactPostAnchorCount(article,pagePostId);
  const nestedNow=[...article.querySelectorAll?.('[role="article"]')||[]].filter(x=>x!==article).length;

  if(!samePostText||!sameAuthor||exactNow<1){
    render('Обогащение остановлено защитой: идентичность поста изменилась. Ничего не сохранено.');
    return {ok:false,error:'identity_guard_failed',samePostText,sameAuthor,exactNow,nestedNow};
  }

  await collectSnapshot();
  const comments=[...commentMap.values()];
  if(initialNested>0&&comments.length===0){
    render('Обогащение остановлено защитой: комментарии были видны, но не распознаны. Ничего не сохранено.');
    return {ok:false,error:'comments_guard_failed',initialNested};
  }
  if(comments.length<existingLocalCount){
    render('Обогащение остановлено защитой: новых данных меньше уже сохранённых. Ничего не перезаписано.');
    return {ok:false,error:'comment_regression_guard',existingLocalCount,newCount:comments.length};
  }

  const remaining=remainingExpandControls(article).length;
  const textStillTruncated=/(?:\.\.\.|…)[\s\u00a0]*(?:Ещё|See more|הצג עוד)[\s\u00a0]*$/i.test(post.text||'');
  const missingAuthor=!post.author?.display_name;
  const missingDate=!post.posted_at;
  const reachedExpected=expectedComments===null||comments.length>=expectedComments;
  post.comments_complete=remaining===0&&reachedExpected;
  post.raw_metadata={
    ...(post.raw_metadata||{}),
    capture_mode:'dialog_enrichment_incremental',
    needs_enrichment:!post.comments_complete||textStillTruncated||missingAuthor||missingDate,
    enrichment:{
      at:nowIso(),
      target_exact_links:selected.exact,
      expected_comment_count:expectedComments,
      existing_local_comments:existingLocalCount,
      initial_nested_articles:initialNested,
      final_nested_articles:nestedNow,
      unique_comments_seen:comments.length,
      snapshots,
      scroll_cycles:cycles,
      scroll_at_end:!!lastScroll.atEnd,
      text_clicks:textClicks,
      all_comments_selected:!!allCommentsSelected,
      comment_expand_clicks:totalClicks,
      remaining_expand_controls:remaining,
      text_still_truncated:textStillTruncated,
      missing_author:missingAuthor,
      missing_date:missingDate
    }
  };

  let media=mediaFromRoot(article,'post',post.key).map(m=>({...m,owner_key:post.key}));
  for(const comment of comments){
    if(comment._article){
      for(const m of mediaFromRoot(comment._article,'comment',comment.key))media.push({...m,owner_key:comment.key});
    }
  }

  const result=await persistBundle(post,comments,media);
  lastSavedAt=nowIso();
  await refreshDbCounts();
  // Pilot bridge submits only after additional server-side guards.

  try{
    if(startScrollTop!==null&&scrollContainer)scrollContainer.scrollTop=startScrollTop;
    else window.scrollTo(0,startWindowY);
  }catch{}

  const denominator=expectedComments!==null?'/'+expectedComments:'';
  const msg='Обогащено: комментариев '+comments.length+denominator+
    ' · было локально '+existingLocalCount+
    ' · DOM '+initialNested+'→'+nestedNow+
    ' · '+(post.comments_complete?'обсуждение полное':'ещё неполное')+
    ' · '+(missingDate?'дата не найдена':'дата есть');
  render(msg);
  return {ok:true,facebook_post_id:pagePostId,post_key:post.key,comments:comments.length,expected_comments:expectedComments,existing_local_comments:existingLocalCount,initial_nested:initialNested,final_nested:nestedNow,cycles,snapshots,comments_complete:post.comments_complete,result};
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
  // Pilot bridge owns transport; never open collector sync window.
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
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`jerusalem_ru_archive_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);render('JSON сохранён');
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
    const groupAuthorDoc=dp.parseFromString('<div role="article"><a href="https://www.facebook.com/groups/520446732921183/user/100004442703181/?x=1">Андрей Агрест</a><div data-ad-preview="message">Тест</div></div>','text/html').body.firstElementChild;
    for(const e of groupAuthorDoc.querySelectorAll('*'))e.getBoundingClientRect=()=>({top:0,bottom:20,width:200,height:20});
    groupAuthorDoc.getBoundingClientRect=()=>({top:0,bottom:300,width:640,height:300});
    const gau=extractAuthor(groupAuthorDoc);ok('group user author',gau.facebook_author_id==='100004442703181'&&gau.display_name==='Андрей Агрест',JSON.stringify(gau));
    const junkAuthorDoc=dp.parseFromString('<div role="article"><a href="https://www.facebook.com/pages">Город Germasogeia, Республика Кипр</a><a href="https://l.facebook.com/l.php">moag.gov.il</a><a href="https://www.facebook.com/100087286527616">0:00 / 0:19</a><div data-ad-preview="message">Тест</div></div>','text/html').body.firstElementChild;
    for(const e of junkAuthorDoc.querySelectorAll('*'))e.getBoundingClientRect=()=>({top:0,bottom:20,width:200,height:20});
    junkAuthorDoc.getBoundingClientRect=()=>({top:0,bottom:300,width:640,height:300});
    const jau=extractAuthor(junkAuthorDoc);ok('junk author rejected',!jau.facebook_author_id&&!jau.display_name,JSON.stringify(jau));
    const pd=parseDate('24 сентябрь в 09:52',new Date(2026,9,2,15,0,0));ok('date with time',pd instanceof Date&&pd.getFullYear()===2026&&pd.getMonth()===8&&pd.getDate()===24&&pd.getHours()===9&&pd.getMinutes()===52,pd?.toISOString?.()||'');
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
panel.innerHTML=`<b style="font-size:18px">Jerusalem enrichment pilot</b><span id="pla-x" style="float:right;cursor:pointer;font-size:22px">✕</span><div style="margin-top:8px"><small>${VERSION}</small></div><label style="display:block;margin-top:10px">Остановиться после N новых постов<input id="pla-count" type="number" min="1" max="1000" value="100" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:4px;font-size:16px"></label><div style="display:flex;gap:7px;margin-top:10px"><button id="pla-start" style="flex:1;padding:10px;font-size:16px">▶ Старт</button><button id="pla-stop" style="flex:1;padding:10px;font-size:16px">■ Стоп</button></div><div style="display:flex;gap:7px;margin-top:7px"><button id="pla-export" style="flex:1;padding:9px">Экспорт JSON</button><button id="pla-test" style="flex:1;padding:9px">Самотест</button></div><button id="pla-enrich" style="width:100%;padding:10px;margin-top:7px;background:#fff4de;border:1px solid #f59e0b;border-radius:6px">✨ Обогатить текущий открытый пост</button><button id="pla-sync" style="width:100%;padding:9px;margin-top:7px">Синхронизировать локальную базу → Supabase</button><button id="pla-check" style="width:100%;padding:8px;margin-top:7px">Проверить базу</button><button id="pla-clear" style="width:100%;padding:8px;margin-top:7px">Очистить ТЕСТОВЫЕ данные</button><div id="pla-status" style="margin-top:10px;line-height:1.5"></div><div style="margin-top:8px;font-size:12px;color:#555">Обычный сбор остаётся пассивным. Обогащение работает только внутри однозначно найденного открытого поста/диалога, проверяет ID и текст до записи и ничего не сохраняет при смене поста.</div>`;
document.body.appendChild(panel);panel.style.display='none';
const status=panel.querySelector('#pla-status'),countInput=panel.querySelector('#pla-count');
panel.querySelector('#pla-start').onclick=start;panel.querySelector('#pla-stop').onclick=()=>stop();panel.querySelector('#pla-export').onclick=exportJson;panel.querySelector('#pla-enrich').onclick=()=>{};panel.querySelector('#pla-sync').onclick=()=>{};panel.querySelector('#pla-check').onclick=async()=>{await refreshDbCounts();render('База проверена')};panel.querySelector('#pla-clear').onclick=()=>{};panel.querySelector('#pla-test').onclick=async()=>{const r=await selfTest();console.table(r.tests);console.log('PLA self-test',r)};panel.querySelector('#pla-x').onclick=()=>{stop();panel.style.display='none'};
async function refreshUi(){
  try{await refreshDbCounts();}catch{}
  render(running?'Собираю…':'Панель восстановлена');
}
window.__JR_ENRICH_ARCHIVE={panel,start,stop,scan:scanVisible,enrichCurrentPost,exportJson,selfTest,syncAll:syncAllLocal,buildSyncPayload,version:VERSION,dbName:DB_NAME,stats,refresh:refreshUi};
watchdog=setInterval(async()=>{
  if(!panel.isConnected&&document.body)document.body.appendChild(panel);panel.style.display='none';
  if(running){try{await refreshDbCounts();}catch{};render('Собираю…');}
},2000);
refreshDbCounts().then(()=>render('Готов к запуску')).catch(()=>render('Готов к запуску'));
})();
