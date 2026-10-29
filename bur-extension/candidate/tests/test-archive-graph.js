'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),G=require('../archive-graph.js');
(async()=>{
 const group='any-group',post={group,post_id:'1700000000000000',key:group+'|post:1700000000000000',author:'Alice Example',author_url:'https://www.facebook.com/groups/other/user/12345678/',post_text:'Full source',comments:[{id:'11',text:'Parent',author:'Same Person',author_url:'https://www.facebook.com/profile.php?id=12345678'},{id:'12',parent_id:'11',text:'Reply',author:'Same Name'},{id:'13',text:'Another person',author:'Same Name'},{id:'14',parent_id:'missing',text:'Orphan reference',author:'Anonymous participant',author_is_anonymous:true}]};
 const graph=await G.enrich([post],group),row=graph.posts[0];
 assert.equal(graph.authors.length,3);
 assert.equal(row.author_key,'author:'+crypto.createHash('sha256').update('12345678').digest('hex'));
 assert.equal(row.author_key,row.comments[0].author_key);
 assert.notEqual(row.comments[1].author_key,row.comments[2].author_key);
 assert.equal(row.comments[1].parent_comment_key,row.comments[0].key);
 assert.equal(row.comments[3].parent_comment_key,null);assert.equal(row.comments[3].parent_reference_status,'parent_not_in_batch');
 assert.equal(row.comments[3].author_key,null);
 assert.equal(post.author_key,undefined);assert.equal(post.comments[0].post_key,undefined);
 assert.deepEqual((await G.enrich([post],group)).authors,graph.authors);
 await assert.rejects(G.enrich([{...post,group:'foreign'}],group),/Cross-group/);
 console.log('PASS separate author records, legacy numeric author key compatibility, profile aliases, no same-name conflation, anonymous labels, parent keys, missing-parent evidence, immutable source');
})().catch(e=>{console.error(e);process.exitCode=1;});
