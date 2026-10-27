import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
export function chunks(text,size=2000,overlap=200){
 if(!Number.isInteger(size)||size<100||overlap<0||overlap>=size)throw Error('invalid chunk bounds');
 // Code points preserve surrogate pairs and every character, including long threads.
 const chars=Array.from(String(text||'')),out=[];
 for(let start=0;start<chars.length;start+=size-overlap){
  out.push({start,text:chars.slice(start,start+size).join('')});
  if(start+size>=chars.length)break;
 }
 return out;
}
export function prepareUnits(batch){
 if(batch?.schema!=='bur-collector/1'||!Array.isArray(batch.posts))throw Error('invalid batch');
 const group=String(batch.group||'');
 const units=[];
 for(const post of batch.posts){
  const sources=[{kind:'post',key:'body',text:post.post_text||'',commentId:null}];
  for(const c of post.comments||[]){
   const key=String(c.id||c.comment_id||hash(String(c.text||'')+'|'+String(c.author||'')));
   sources.push({kind:'comment',key,text:c.text||'',commentId:c.id||c.comment_id||null});
  }
  for(const source of sources)for(const part of chunks(source.text)){
   const key=[group,post.post_id,source.kind,source.key,part.start].join('|');
   units.push({key,post_id:String(post.post_id),comment_external_id:source.commentId,
    unit_type:source.kind,text:part.text,source_hash:hash(key+'|'+part.text),
    metadata:{bur_chunk_key:key,bur_chunk_offset:part.start,
     capture_status:post.deep?.status||'unknown',completeness:post.deep?.completeness||'unknown',
     parent_comment_id:source.kind==='comment'?(post.comments.find(c=>String(c.id||c.comment_id||hash(String(c.text||'')+'|'+String(c.author||'')))===source.key)?.parent_id||null):null}});
  }
 }
 return units;
}
