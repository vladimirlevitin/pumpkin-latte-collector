'use strict';
// 0.5.34: the "Страница сейчас недоступна" notice inside the post dialog is recognised by text alone.
const assert=require('node:assert/strict');
const C=require('../core.js');
const box=text=>({innerText:text});
const ru='Публикация Elizabeth Spektor\nСтраница сейчас недоступна\nВозможно, это связано с технической проблемой, которую мы уже решаем. Попробуйте обновить страницу.\nПерейти в Ленту\nНазад\nПерейти в Справочный центр\nОтветить как Владимир';
const en='Post by Someone\nThis page isn’t available right now\nThis may be due to a technical issue that we’re working on. Try refreshing the page.\nGo to Feed\nGo back';
assert.equal(C.unavailableNotice(box(ru)),true,'Russian notice');
assert.equal(C.unavailableNotice(box(en)),true,'English notice');
assert.equal(C.unavailableNotice({textContent:ru}),true,'textContent fallback');
assert.equal(C.unavailableNotice(box('Обычный пост про Тель-Авив. Кто знает хорошего адвоката?\nКомментарии: 12')),false,'normal short post');
assert.equal(C.unavailableNotice(box('Страница сейчас недоступна '+'длинное обсуждение '.repeat(100))),false,'long post that merely quotes the phrase');
assert.equal(C.unavailableNotice(box('')),false,'empty');
assert.equal(C.unavailableNotice(null),false,'no root');
console.log('unavailable notice: ok');
