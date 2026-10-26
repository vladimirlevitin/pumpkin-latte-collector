'use strict';const assert=require('node:assert/strict'),C=require('../core.js');
const id='1700000000000001',url='https://www.facebook.com/groups/backpackIL/posts/'+id+'/';
const old={group:'backpackIL',post_id:id,permalink:url,post_text:'Текст главного поста',comments:[{id:'998877',text:'Как попасть... Ещё',text_is_partial:true,permalink:url+'?comment_id=998877'}]};
const next={...old,comments:[{id:'998877',text:'Как попасть на парковку? Машина едет до моста, далее пешком.',text_is_partial:false,author:'Марина'}]};
const merged=C.mergePosts(old,next,'backpackIL');assert.equal(merged.comments.length,1);assert.equal(merged.comments[0].text,next.comments[0].text);assert.equal(merged.comments[0].text_is_partial,false);assert.equal(merged.comments[0].author,'Марина');assert.ok(merged.comments[0].permalink.includes('comment_id=998877'));
console.log('PASS: expanded comments replace earlier truncated versions with same ID without losing author/link');
