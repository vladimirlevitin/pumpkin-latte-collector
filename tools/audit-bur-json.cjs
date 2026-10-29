/* Offline audit: reads private exports, emits aggregate statistics only. */
'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const C=require('../bur-extension/candidate/core.js'),G=require('../bur-extension/candidate/archive-graph.js');
const files=process.argv.slice(2);if(!files.length)throw Error('Supply private raw JSON paths');
async function main(){for(const file of files){
 const raw=fs.readFileSync(file),data=JSON.parse(raw),posts=data.posts;
 assert.equal(data.schema,'bur-collector/1');assert.ok(Array.isArray(posts));
 const order=data.job_summary.discovery_order;
 assert.equal(new Set(posts.map(p=>p.post_id)).size,posts.length);
 assert.deepEqual([...order].sort(),posts.map(p=>p.post_id).sort());
 for(const p of posts){
  const normalized=C.normalizePost(p,data.group),merged=C.mergePosts(normalized,p,data.group);
  assert.equal(merged.post_id,p.post_id);assert.equal(merged.post_text,p.post_text);
  assert.equal(merged.comments.length,p.comments.length);
  for(const comment of p.comments){
   const c=merged.comments.find(c=>c.id===comment.id);assert.ok(c);
   for(const key of ['text','author','author_url','parent_id','permalink'])assert.equal(c[key],comment[key],key);
  }
  for(const media of p.media||[])assert.ok(merged.media.some(m=>m.url===media.url||new URL(m.url).pathname===new URL(media.url).pathname));
 }
 const graph=await G.enrich(posts,data.group),authorKeys=new Set(graph.authors.map(a=>a.key));
 for(const p of graph.posts)for(const r of [p,...p.comments])assert.ok(!r.author_key||authorKeys.has(r.author_key));
 const comments=posts.flatMap(p=>p.comments||[]);
 console.log(JSON.stringify({version:data.collector_version,sha256:crypto.createHash('sha256').update(raw).digest('hex'),posts:posts.length,comments:comments.length,postAuthors:posts.filter(p=>p.author).length,postTimestamps:posts.filter(p=>p.published_at).length,dateLabels:posts.filter(p=>p.published_label).length,media:posts.reduce((n,p)=>n+(p.media||[]).length,0),replyParents:comments.filter(c=>c.parent_id).length,emptyComments:comments.filter(c=>!c.text).length,commentLinksFields:comments.filter(c=>Array.isArray(c.links)).length,unknownCompleteness:posts.filter(p=>p.deep?.completeness==='unknown_not_all_threads_verified').length,relationalAuthors:graph.authors.length,relationalAuthorReferences:'PASS',preservation:'PASS'},null,2));
}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
