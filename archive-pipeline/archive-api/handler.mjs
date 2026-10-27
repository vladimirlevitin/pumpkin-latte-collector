// Staging API. JWT verification is delegated to Supabase Auth, never decoded as trust.
export function createHandler({env,fetcher=fetch}){
 const origin=env.ALLOWED_ORIGIN;
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'access-control-allow-origin':origin,'vary':'Origin','x-content-type-options':'nosniff'}});
 return async request=>{
  if(request.headers.get('origin')&&request.headers.get('origin')!==origin)return reply(403,{error:'origin_denied'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
   'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
   'access-control-allow-headers':'authorization,content-type,apikey','vary':'Origin'}});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!origin)return reply(503,{error:'staging_not_configured'});
  const url=new URL(env.SUPABASE_URL);
  if(['ltznpjfnkpydautbsrej.supabase.co','bybgnzeaoaxnxwdugnwo.supabase.co'].includes(url.hostname))return reply(503,{error:'production_disabled'});
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer [A-Za-z0-9._~-]+$/.test(authorization))return reply(401,{error:'unauthorized'});
  try{
   const auth=await fetcher(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization},signal:AbortSignal.timeout(10000)});
   if(!auth.ok)return reply(401,{error:'unauthorized'});
   const user=await auth.json();
   if(!/^[0-9a-f-]{36}$/i.test(user.id||''))return reply(401,{error:'unauthorized'});
   const raw=await request.text();if(raw.length>12000)return reply(413,{error:'request_too_large'});
   let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'invalid_json'});}
   const group=String(body.group||''),query=String(body.query||'').trim();
   if(!/^[A-Za-z0-9_.-]{1,128}$/.test(group)||!query||query.length>2000)return reply(400,{error:'invalid_query'});
   const topics=Array.isArray(body.topics)?body.topics.map(String):[];
   if(topics.length>30||topics.some(x=>!/^[A-Za-z0-9_-]{1,100}$/.test(x)))return reply(400,{error:'invalid_topics'});
   let vector=null,warning=null;
   if(body.semantic!==false&&env.GEMINI_API_KEY){
    try{
     const embedded=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',{
      method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
      body:JSON.stringify({content:{parts:[{text:'task: search result | query: '+query}]},outputDimensionality:768}),signal:AbortSignal.timeout(30000)});
     if(!embedded.ok)throw Error('embedding_unavailable');
     const j=await embedded.json();vector=j?.embedding?.values;
     if(!Array.isArray(vector)||vector.length!==768||vector.some(x=>!Number.isFinite(x)))throw Error('invalid_embedding');
    }catch{vector=null;warning='semantic_unavailable_using_keywords';}
   }else if(body.semantic!==false)warning='semantic_not_configured_using_keywords';
   const serviceHeaders={'content-type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY};
   if(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ'))serviceHeaders.authorization='Bearer '+env.SUPABASE_SERVICE_ROLE_KEY;
   const response=await fetcher(env.SUPABASE_URL+'/rest/v1/rpc/bur_archive_search',{
    method:'POST',headers:serviceHeaders,
    body:JSON.stringify({p_user_id:user.id,p_group:group,p_query:query,p_vector:vector,p_topics:topics,p_limit:Math.max(1,Math.min(100,Number(body.limit)||20))}),signal:AbortSignal.timeout(20000)});
   if(!response.ok){const error=await response.json().catch(()=>({}));return reply(error.code==='42501'?403:502,{error:error.code==='42501'?'group_access_denied':'search_failed'});}
   return reply(200,{...(await response.json()),warning});
  }catch{return reply(502,{error:'upstream_unavailable'});}
 };
}
