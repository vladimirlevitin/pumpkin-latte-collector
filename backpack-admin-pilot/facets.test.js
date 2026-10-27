'use strict';
const assert=require('node:assert/strict');const F=require('./facets.js');
const rows=[
 F.normalize({id:'1',text_content:'Подскажите маршрут с собакой вокруг Мертвого моря',canonical_url:'https://www.facebook.com/groups/backpackIL/posts/1/',comment_count:5,posted_at:'2026-01-01'}),
 F.normalize({id:'2',text_content:'Где увидеть пеликанов в Эмек Хефер? Не в Тверии.',comment_count:12,posted_at:'2025-01-01'}),
 F.normalize({id:'3',text_content:'Отдых с палатками в Галилее',comment_count:0,posted_at:'2024-01-01'})
];
assert(rows[0].facets.topics.includes('Пешие маршруты'));
assert(rows[0].facets.regions.includes('Мёртвое море'));
assert(rows[0].facets.conditions.includes('С собакой'));
assert(rows[1].facets.topics.includes('Животные и птицы'));
assert.equal(F.filter(rows,{regions:['Мёртвое море']}).length,1);
assert.equal(F.filter(rows,{hasComments:true}).length,2);
assert.equal(F.filter(rows,{sort:'comments'})[0].id,'2');
assert.equal(F.filter(rows,{sort:'oldest'})[0].id,'3');
assert.equal(F.filter(rows,{query:'палатками'})[0].id,'3');
assert.equal(F.counts(rows,'conditions').find(x=>x[0]==='С ночёвкой')[1],1);
assert.equal(F.filter(rows,{regions:['Негев']}).length,0);
console.log('PASS facets, location, themes, conditions, comments, filters, sorting');
