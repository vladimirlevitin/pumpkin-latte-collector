'use strict';
const assert=require('node:assert/strict'),A=require('./catalog-adapter.js');
const inData={ok:true,stats:{posts:2},items:[
 {batch_key:'one',text_content:'Маршрут с собакой у Мёртвого моря',tags:['Проверено редактором'],cities:[],canonical_url:'https://www.facebook.com/groups/backpackIL/posts/123'},
 {batch_key:'two',text_content:'Пеликаны в Эмек Хефер',comment_count:2}
]};
const out=A.adaptBrowse(inData);
assert.equal(out.stats.posts,2);
assert(out.items[0].tags.includes('Пешие маршруты'));
assert(out.items[0].tags.includes('С собакой'));
assert(out.items[0].tags.includes('Проверено редактором'));
assert(out.items[0].cities.includes('Мёртвое море'));
assert.equal(out.items[0].canonical_url,inData.items[0].canonical_url);
assert(out.items[1].cities.includes('Эмек Хефер'));
assert.equal(inData.items[0].tags.length,1,'input not mutated');
assert.throws(()=>A.adaptBrowse({}),/Invalid/);
console.log('PASS browse contract adapter, legacy UI filters, original source links, no mutation');