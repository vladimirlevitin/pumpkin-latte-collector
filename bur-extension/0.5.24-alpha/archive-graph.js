/* Additive relational export. Existing Bur fields remain available to old importers. */
(function(root,factory){const api=factory();if(typeof module!=='undefined')module.exports=api;root.FBBurGraph=api;})(globalThis,function(){
 'use strict';
 async function sha256(value){const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
 function profile(value){
  try{
   const u=new URL(value);if(!/(^|\.)facebook\.com$/.test(u.hostname))return null;
   let id=u.pathname==='/profile.php'?u.searchParams.get('id'):u.pathname.match(/^\/groups\/[^/]+\/user\/(\d+)/)?.[1]||u.pathname.match(/^\/people\/[^/]+\/(\d+)/)?.[1];
   if(id&&/^\d+$/.test(id))return {id,url:'https://www.facebook.com/profile.php?id='+id};
   if(/^\/[a-z0-9._-]+\/?$/i.test(u.pathname)&&!u.pathname.endsWith('.php'))return {id:null,url:'https://www.facebook.com'+u.pathname.replace(/\/$/,'')};
  }catch(_){}
  return null;
 }
 async function enrich(input,group){
  const authors=new Map(),posts=[];
  async function author(row,owner){
   if(!row.author||row.author_is_anonymous)return null;
   const p=profile(row.author_url),name=String(row.author).trim();if(!name)return null;
   // Numeric Facebook identity uses the same basis as legacy persistAuthor.
   // A label alone is scoped to its source; identical names do not prove identity.
   const basis=p?.id||p?.url||group+'|'+owner+'|'+name;
   const key='author:'+await sha256(basis);
   const record={key,display_name:name,facebook_author_id:p?.id||null,profile_url:p?.url||null,identity_quality:p?.id?'facebook_id':p?.url?'profile_url':'display_name_only',first_seen_at:row.first_seen||row.snapshot_at||null,last_seen_at:row.snapshot_at||null};
   const previous=authors.get(key);
   if(previous){record.first_seen_at=[previous.first_seen_at,record.first_seen_at].filter(Boolean).sort()[0]||null;record.last_seen_at=[previous.last_seen_at,record.last_seen_at].filter(Boolean).sort().at(-1)||null;}
   authors.set(key,record);return key;
  }
  for(const source of input){
   if(source.group&&source.group!==group)throw Error('Cross-group relational export');
   const row={...source},postKey=row.key||group+'|post:'+row.post_id;row.key=postKey;
   row.author_key=await author(row,postKey);row.comments=[];
   const commentKeys=new Map((source.comments||[]).filter(c=>c.id).map(c=>[String(c.id),postKey+'|comment:'+c.id]));
   let index=0;
   for(const sourceComment of source.comments||[]){
    const comment={...sourceComment};comment.key=commentKeys.get(String(comment.id))||postKey+'|unverified-comment:'+await sha256(String(comment.text||'')+'|'+index++);comment.post_key=postKey;
    comment.author_key=await author(comment,comment.key);
    comment.parent_comment_key=comment.parent_id?commentKeys.get(String(comment.parent_id))||null:null;
    if(comment.parent_id&&!comment.parent_comment_key)comment.parent_reference_status='parent_not_in_batch';
    row.comments.push(comment);
   }
   posts.push(row);
  }
  return {posts,authors:[...authors.values()].sort((a,b)=>a.key.localeCompare(b.key))};
 }
 return {enrich,profile};
});
