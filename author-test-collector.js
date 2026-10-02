(()=>{
'use strict';

const VERSION='pla-author-test-v2.6.7';
const UI_ID='pla-author-test-panel';
const DB_NAME='pumpkin_latte_author_test';
const DB_VERSION=1;
const GROUP_PATH=(location.pathname.match(/\/groups\/([^/?]+)/)||[])[1]||'facebook-group';

if(window.__PLA_AUTHOR_TEST?.panel){
  const p=window.__PLA_AUTHOR_TEST.panel;
  if(!p.isConnected&&document.body)document.body.appendChild(p);
  p.style.display='block';
  window.__PLA_AUTHOR_TEST.refresh?.();
  return;
}

const norm=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const text=e=>norm(e?.innerText||e?.textContent||'');
const esc=s=>norm(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowIso=()=>new Date().toISOString();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const RX_TIME=/^(?:\d+\s*(?:мин|минута|минуты|минут|ч|час|часа|часов|дн|день|дня|дней|нед|неделя|недели|недель|min|m|hr|h|day|days|week|weeks)\.?|\d{1,2}:\d{2}\s*\/\s*\d{1,2}:\d{2})$/i;
const RX_UI=/^(?:Нравится|Ответить|Поделиться|Like|Reply|Share|Комментировать|Автор|Администратор|Author|Admin|·)$/i;

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('posts'))db.createObjectStore('posts',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
const reqP=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
async function store(mode='readonly'){const db=await openDb();return db.transaction('posts',mode).objectStore('posts');}
async function getAll(){return reqP((await store()).getAll());}
async function put(row){return reqP((await store('readwrite')).put(row));}
async function clearAll(){return reqP((await store('readwrite')).clear());}
async function countAll(){return reqP((await store()).count());}

function postMeta(root){
  for(const a of root.querySelectorAll('a[href]')){
    const href=a.href||a.getAttribute('href')||'';
    const m=href.match(/\/groups\/[^/]+\/posts\/(\d+)/);
    if(m)return {id:m[1],url:`https://www.facebook.com/groups/${GROUP_PATH}/posts/${m[1]}/`};
    try{
      const u=new URL(href,location.origin);
      const id=u.searchParams.get('story_fbid');
      if(id&&/^\d+$/.test(id))return {id,url:href};
    }catch{}
  }
  return {id:null,url:null};
}

function plausibleName(name){
  const s=norm(name);
  if(!s||s.length<2||s.length>80)return false;
  if(!/[A-Za-zА-Яа-яЁё\u0590-\u05FF]/.test(s))return false;
  if(RX_TIME.test(s)||RX_UI.test(s))return false;
  if(/^(?:https?:\/\/|www\.)/i.test(s))return false;
  if(/\b[a-z0-9-]+\.(?:com|net|org|co|il|gov|edu|io|me)\b/i.test(s))return false;
  if(/^[\d\s:/.\-]+$/.test(s))return false;
  return true;
}

function stableProfile(href){
  try{
    const u=new URL(href,location.origin);
    const host=u.hostname.toLowerCase();
    if(!['facebook.com','www.facebook.com','m.facebook.com'].includes(host))return null;

    const parts=u.pathname.split('/').filter(Boolean);
    if(!parts.length)return null;

    // Facebook group member links are the normal author links inside group posts.
    // Accept them before the generic "groups" block and normalize to profile.php?id=...
    if(
      parts.length>=4 &&
      parts[0].toLowerCase()==='groups' &&
      parts[2].toLowerCase()==='user' &&
      /^\d+$/.test(parts[3])
    ){
      const id=parts[3];
      return {id,url:`https://www.facebook.com/profile.php?id=${id}`};
    }

    const first=parts[0].toLowerCase();
    const blocked=new Set([
      'l.php','groups','posts','permalink','photo','photos','watch','reel','reels',
      'story.php','stories','events','marketplace','gaming','help','login','share',
      'sharer.php','plugins','pages','places','page','people','public','hashtag',
      'search','notifications','messages','friends','settings','privacy','bookmarks'
    ]);
    if(blocked.has(first))return null;

    if(first==='profile.php'){
      const id=u.searchParams.get('id');
      return /^\d+$/.test(id||'')?{id,url:`https://www.facebook.com/profile.php?id=${id}`}:null;
    }

    // For username profiles accept only a single clean path segment.
    if(parts.length!==1)return null;
    const id=parts[0];
    if(!/^[A-Za-z0-9._-]{2,100}$/.test(id))return null;
    return {id,url:`https://www.facebook.com/${id}`};
  }catch{return null;}
}

function extractAuthor(root){
  const rr=root.getBoundingClientRect?.()||{top:0,height:1000};
  const msg=root.querySelector('[data-ad-preview="message"],[data-ad-comet-preview="message"]');
  const mr=msg?.getBoundingClientRect?.();
  const msgTop=mr&&Number.isFinite(mr.top)?mr.top:Infinity;
  const headerBottom=Math.min(rr.top+Math.min(180,Math.max(100,rr.height*.32)),msgTop+4);
  const accepted=[];
  const debug=[];

  for(const a of root.querySelectorAll('a[href]')){
    const nearest=a.closest?.('[role="article"]');
    if(nearest&&nearest!==root)continue;
    if(a.closest?.('button,[role="button"],[role="slider"]'))continue;
    const name=norm(text(a));
    const href=a.href||a.getAttribute('href')||'';
    const r=a.getBoundingClientRect?.()||{top:Infinity,bottom:Infinity};
    const profile=stableProfile(href);
    let reason='accepted';
    if(!plausibleName(name))reason='bad_name';
    else if(!profile)reason='bad_profile';
    else if(Number.isFinite(r.top)&&r.top>headerBottom)reason='below_header';
    if(debug.length<8&&name)debug.push({name,href:profile?.url||href.slice(0,180),reason});
    if(reason!=='accepted')continue;

    const semantic=!!a.closest?.('h2,h3,strong,[data-ad-rendering-role="profile_name"]');
    let score=35;
    if(Number.isFinite(r.top)&&r.top<=rr.top+90)score+=30;
    if(Number.isFinite(r.bottom)&&r.bottom<=msgTop+4)score+=20;
    if(semantic)score+=25;
    if(name.includes(' '))score+=5;
    accepted.push({score,display_name:name,facebook_author_id:profile.id,profile_url:profile.url});
  }

  accepted.sort((a,b)=>b.score-a.score);
  const a=accepted[0];
  return {
    author:a&&a.score>=65?{display_name:a.display_name,facebook_author_id:a.facebook_author_id,profile_url:a.profile_url}:null,
    debug
  };
}

function extractText(root){
  const msg=root.querySelector('[data-ad-preview="message"],[data-ad-comet-preview="message"]');
  if(msg&&text(msg))return text(msg);
  const rr=root.getBoundingClientRect?.()||{top:0,height:1000};
  const candidates=[];
  for(const e of root.querySelectorAll('[dir="auto"],div[lang],span[lang]')){
    if(e.closest?.('[role="article"]')!==root)continue;
    if(e.closest?.('button,[role="button"]'))continue;
    const r=e.getBoundingClientRect?.()||{top:Infinity};
    if(r.top>rr.top+Math.max(460,rr.height*.55))continue;
    const s=text(e);
    if(s.length<2||s.length>12000||RX_UI.test(s)||RX_TIME.test(s))continue;
    candidates.push(s);
  }
  candidates.sort((a,b)=>b.length-a.length);
  return candidates[0]||'';
}

function rawDate(root){
  for(const e of root.querySelectorAll('[data-utime]')){
    const u=Number(e.getAttribute('data-utime'));
    if(Number.isFinite(u)&&u>1e9)return {iso:new Date(u*1000).toISOString(),raw:String(u)};
  }
  for(const a of root.querySelectorAll('a[href]')){
    const href=a.href||'';
    if(!/\/posts\/\d+|story_fbid=/.test(href))continue;
    const raw=norm([a.getAttribute('aria-label'),a.getAttribute('title'),text(a)].filter(Boolean).join(' '));
    if(raw)return {iso:null,raw};
  }
  return {iso:null,raw:null};
}

function topArticles(){
  return [...document.querySelectorAll('[role="article"]')].filter(a=>!a.parentElement?.closest?.('[role="article"]'));
}

let running=false,timer=null,target=20,seen=new Set(),stats={seen:0,new:0,with_author:0,no_author:0},counts=0;

async function process(root){
  const meta=postMeta(root);
  const body=extractText(root);
  const basis=meta.id||body.slice(0,240);
  if(!basis)return;
  const key=meta.id?`fb:pumpkinlatte:post:${meta.id}`:`local:${btoa(unescape(encodeURIComponent(basis))).slice(0,80)}`;
  if(seen.has(key))return;
  seen.add(key);stats.seen++;
  const {author,debug}=extractAuthor(root);
  const date=rawDate(root);
  const row={key,facebook_post_id:meta.id,canonical_url:meta.url,text:body,author,author_debug:debug,posted_at:date.iso,date_raw:date.raw,seen_at:nowIso()};
  const prev=(await getAll()).find(x=>x.key===key);
  if(!prev)stats.new++;
  if(author)stats.with_author++; else stats.no_author++;
  await put(row);
  counts=await countAll();
}

async function tick(){
  if(!running)return;
  const arts=topArticles().filter(a=>{const r=a.getBoundingClientRect();return r.bottom>-300&&r.top<innerHeight*2&&r.height>120});
  for(const a of arts){
    if(!running)break;
    try{await process(a);}catch(e){console.warn('PLA author test',e);}
  }
  render();
  if(stats.new>=target){stop(`✓ Набрано ${target} новых постов`);return;}
  scrollBy(0,Math.min(350,Math.max(220,innerHeight*.28)));
  timer=setTimeout(tick,2800);
}

function start(){
  if(running)return;
  target=Math.max(1,Math.min(100,Number(input.value)||20));
  running=true;render('Собираю авторов пассивно…');tick();
}
function stop(msg='Остановлено'){
  running=false;
  if(timer)clearTimeout(timer);
  timer=null;
  render(msg);
}
async function exportJson(){
  const posts=await getAll();
  const out={version:VERSION,exported_at:nowIso(),group:GROUP_PATH,summary:{posts:posts.length,session:{...stats}},posts};
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`pumpkin_author_test_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  render('JSON сохранён');
}
async function clear(){
  if(!confirm('Очистить только данные AUTHOR TEST? Основной архив не затрагивается.'))return;
  await clearAll();seen.clear();stats={seen:0,new:0,with_author:0,no_author:0};counts=0;render('AUTHOR TEST очищен');
}

function render(msg=''){
  if(!status)return;
  status.innerHTML=(msg?`<b>${esc(msg)}</b><br>`:'')+`Статус: <b>${running?'РАБОТАЕТ':'ОСТАНОВЛЕН'}</b><br>В тестовой базе: <b>${counts}</b> постов<br>Сейчас: просмотрено <b>${stats.seen}</b> · новых <b>${stats.new}</b><br>Автор найден: <b>${stats.with_author}</b> · не найден: <b>${stats.no_author}</b>`;
}

const panel=document.createElement('div');
panel.id=UI_ID;
panel.style='position:fixed;top:12px;right:12px;width:380px;max-height:90vh;overflow:auto;z-index:2147483647;background:#fff;color:#111;border:2px solid #8a2be2;border-radius:12px;padding:14px;font:16px/1.4 Arial,sans-serif;box-shadow:0 4px 20px #0005';
panel.innerHTML=`<b style="font-size:18px">Pumpkin — AUTHOR TEST</b><span id="pla-at-x" style="float:right;cursor:pointer;font-size:22px">✕</span><div><small>${VERSION}</small></div><label style="display:block;margin-top:10px">Новых постов для проверки<input id="pla-at-count" type="number" min="1" max="100" value="20" style="display:block;width:100%;box-sizing:border-box;padding:8px;margin-top:4px"></label><div style="display:flex;gap:7px;margin-top:10px"><button id="pla-at-start" style="flex:1;padding:9px">▶ Старт</button><button id="pla-at-stop" style="flex:1;padding:9px">■ Стоп</button></div><button id="pla-at-export" style="width:100%;padding:9px;margin-top:7px">Экспорт JSON</button><button id="pla-at-clear" style="width:100%;padding:8px;margin-top:7px">Очистить AUTHOR TEST</button><div id="pla-at-status" style="margin-top:10px"></div><div style="margin-top:8px;font-size:12px;color:#555">Тестовая версия ничего не нажимает в Facebook и не пишет в Supabase. Проверяем только авторов и даты.</div>`;
document.body.appendChild(panel);
const status=panel.querySelector('#pla-at-status');
const input=panel.querySelector('#pla-at-count');
panel.querySelector('#pla-at-start').onclick=start;
panel.querySelector('#pla-at-stop').onclick=()=>stop();
panel.querySelector('#pla-at-export').onclick=exportJson;
panel.querySelector('#pla-at-clear').onclick=clear;
panel.querySelector('#pla-at-x').onclick=()=>{stop();panel.style.display='none'};

async function refresh(){counts=await countAll();render();}
window.__PLA_AUTHOR_TEST={panel,start,stop,exportJson,refresh,version:VERSION};
refresh().catch(()=>render('Готов'));
})();
