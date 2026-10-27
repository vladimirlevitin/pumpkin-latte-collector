'use strict';
/* Pure preflight for Bur JSON -> archive ingest. No database writes here. */
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BurArchivePreflight=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const ID=/^\d{8,30}$/;
 function validate(batch){
  const errors=[],warnings=[],seen=new Set(),rows=[];
  if(!batch||batch.schema!=='bur-collector/1')errors.push('Unsupported batch schema');
  const group=String(batch?.group||'');
  if(!/^[a-zA-Z0-9_-]{2,128}$/.test(group))errors.push('Invalid group');
  const id=String(batch?.job_summary?.id||'');
  if(!id||id.length>200)errors.push('Missing batch id');
  if(!Array.isArray(batch?.posts))errors.push('Missing posts array');
  for(const [idx,post] of (Array.isArray(batch?.posts)?batch.posts:[]).entries()){
    const postId=String(post?.post_id||'');
    if(!ID.test(postId)){errors.push('post '+idx+': missing numeric post_id');continue;}
    const key=group+'/'+postId;if(seen.has(key)){warnings.push('duplicate post '+postId);continue;}
    seen.add(key);
    rows.push({group_slug:group,post_id:postId,source:post,source_url:String(post?.source_page||''),observed_at:String(post?.snapshot_at||batch.created_at||''),batch_id:id});
  }
  if(batch?.job_summary?.checkpoint_post_id&&!batch?.job_summary?.checkpoint_found_at)
    warnings.push('Checkpoint not confirmed; do not certify archive continuity');
  if(batch?.job_summary?.deep_errors>0)warnings.push('Partial deep extraction');
  return {ok:errors.length===0,errors,warnings,rows,unique_posts:rows.length,raw_posts:batch?.posts?.length||0,group,batch_id:id};
 }
 return {validate};
});