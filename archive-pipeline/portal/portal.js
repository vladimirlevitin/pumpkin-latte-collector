(()=>{'use strict';
const $=id=>document.getElementById(id),config=window.BUR_CONFIG||{};let token='',requestId=0;
const message=text=>$('message').textContent=text;
function checkConfig(){
 if(!config.supabaseUrl||!config.apiUrl||!config.publishableKey||config.publishableKey.startsWith('sb_secret_'))throw Error('Настройте отдельное тестовое окружение. Ключ сервера в портал помещать нельзя.');
 for(const value of [config.supabaseUrl,config.apiUrl]){const u=new URL(value);if(u.protocol!=='https:'||['ltznpjfnkpydautbsrej.supabase.co','bybgnzeaoaxnxwdugnwo.supabase.co','metzia.store'].includes(u.hostname))throw Error('Эта оболочка предназначена для отдельного тестового окружения.');}
}
function showLogin(){token='';requestId++;$('login').hidden=false;$('archive').hidden=true;$('logout').hidden=true;$('results').replaceChildren();$('summary').textContent='';}
function sourceUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.facebook.com','web.facebook.com'].includes(u.hostname)?u.href:null;}catch{return null;}}
function render(data){
 $('results').replaceChildren();const rows=Array.isArray(data.results)?data.results:[];
 $('summary').textContent=`Найдено фрагментов: ${rows.length}. ${data.semantic_used?'Поиск по смыслу и словам.':'Поиск по ключевым словам.'}`;
 for(const row of rows){
  const article=document.createElement('article'),text=document.createElement('div'),badge=document.createElement('span');
  badge.className='badge';badge.textContent=row.capture_status==='complete'?'Извлечение отмечено полным':'Полнота извлечения не подтверждена';
  text.className='text';text.textContent=String(row.text||'');article.append(badge,text);
  if(row.topics?.length){const tags=document.createElement('p');tags.className='muted';tags.textContent=row.topics.join(' · ');article.append(tags);}
  const href=sourceUrl(row.url);if(href){const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть оригинал в Facebook ↗';article.append(link);}
  $('results').append(article);
 }
 message(data.warning?'Семантический поиск недоступен. Показаны результаты по ключевым словам.':'');
}
$('loginForm').onsubmit=async event=>{
 event.preventDefault();$('signIn').disabled=true;message('');
 try{checkConfig();const r=await fetch(config.supabaseUrl+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.publishableKey,'content-type':'application/json'},body:JSON.stringify({email:$('email').value,password:$('password').value})});
  if(!r.ok)throw Error('Не удалось войти. Проверьте данные доступа.');const data=await r.json();if(!data.access_token)throw Error('Сессия не получена.');
  token=data.access_token;$('password').value='';$('login').hidden=true;$('archive').hidden=false;$('logout').hidden=false;$('query').focus();
 }catch(error){message(error.message);}finally{$('signIn').disabled=false;}
};
$('searchForm').onsubmit=async event=>{
 event.preventDefault();const seq=++requestId;$('search').disabled=true;$('results').replaceChildren();message('Ищу…');
 try{checkConfig();const r=await fetch(config.apiUrl,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({group:$('group').value.trim(),query:$('query').value.trim(),topics:$('topics').value.split(',').map(x=>x.trim()).filter(Boolean),semantic:$('semantic').checked})});
  if(seq!==requestId)return;
  if(r.status===401){showLogin();throw Error('Сессия закончилась. Войдите снова.');}
  if(r.status===403)throw Error('У этой учётной записи нет доступа к группе.');
  if(!r.ok)throw Error('Поиск временно недоступен.');const data=await r.json();if(seq===requestId)render(data);
 }catch(error){message(error.message);}finally{$('search').disabled=false;}
};
$('logout').onclick=()=>{showLogin();message('Вы вышли из архива.');$('password').value='';};
try{checkConfig();}catch(error){message(error.message);}
})();
