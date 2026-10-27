'use strict';
/* Deterministic, conservative facets for the private Backpack admin archive.
   No network, no mutations. Tags are suggestions, not verified facts. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BackpackFacets=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const rules={
  topics:{
   'Пешие маршруты':[/(поход|походы|хайкинг|треккинг|маслул|маршрут|тропа|нахаль|трекинг)\\b/iu],
   'Вода и купание':[/(водопад|купани|купаться|пляж|озеро|источник|родник|бассейн|река|водоем|водоём)\\w*/iu],
   'Кемпинг':[/(палатк|кемпинг|ночевк|ночёвк|костёр|кемп|лагерь)\\w*/iu],
   'С детьми':[/(дети|детям|ребенк|ребёнк|семьей|семьёй|малыш|коляск)\\w*/iu],
   'Животные и птицы':[/(пеликан|птиц|шакал|животн|зоопарк|фламинго|черепах|олень)\\w*/iu],
   'Городские прогулки':[/(экскурси|музей|городск|архитектур|старый город|квартал)\\w*/iu],
   'Транспорт':[/(автобус|поезд|общественн.{0,12}транспорт|парковк|машин|такси)\\w*/iu],
   'Безопасность':[/(опасн|закрыт.{0,15}маршрут|предупрежден|предупреждён|спасател|жара|пожар|запрет)\\w*/iu]
  },
  regions:{
   'Иерусалим и окрестности':[/иерусалим|jerusalem|ירושלים/iu],
   'Голаны':[/голан|golan|רמת הגולן/iu],
   'Галилея':[/галиле|galilee|גליל/iu],
   'Кинерет и Тверия':[/кинерет|киннерет|твери|kinneret|tiberias|כנרת|טבריה/iu],
   'Хайфа и Кармель':[/хайф|кармел|haifa|carmel|חיפה|כרמל/iu],
   'Мёртвое море':[/м[её]ртв.{0,5}мор|dead sea|ים המלח/iu],
   'Негев':[/негев|negev|נגב/iu],
   'Эйлат и Арава':[/эйлат|eilat|арава|arava|אילת|ערבה/iu],
   'Тель-Авив и центр':[/тель.?авив|tel.?aviv|תל אביב|шапира/iu],
   'Эмек Хефер':[/эмек хефер|emek hefer|עמק חפר/iu]
  },
  conditions:{
   'С собакой':[/(с собак|собакой|собаками|питомц)\\w*/iu],
   'Без машины':[/без машины|без автомобил|общественн.{0,12}транспорт/iu],
   'Бесплатно':[/бесплатн|без оплаты|вход свободный/iu],
   'С ночёвкой':[/ноч[её]вк|палатк|кемпинг/iu]
  }
 };
 function textOf(p){return String(p?.text_content??p?.text??'')+' '+(Array.isArray(p?.comment_texts)?p.comment_texts.slice(0,30).join(' '):'');}
 function classify(p){
  const content=textOf(p);const out={};
  for(const [facet,groups] of Object.entries(rules))out[facet]=Object.entries(groups).filter(([name,patterns])=>patterns.some(pat=>pat.test(content))).map(([name])=>name);
  return out;
 }
 function normalize(p){const auto=classify(p);return {...p,facets:auto,sortDate:p?.posted_at||p?.received_at||null,commentCount:Number(p?.comment_count??p?.comments??0),sourceUrl:p?.canonical_url||p?.url||''};}
 function filter(rows,{topics=[],regions=[],conditions=[],query='',sort='newest',hasComments=false}={}){
  const q=String(query).trim().toLocaleLowerCase('ru');
  const matches=(selected,actual)=>!selected.length||selected.some(s=>actual.includes(s));
  const result=rows.filter(p=>matches(topics,p.facets?.topics||[])&&matches(regions,p.facets?.regions||[])&&matches(conditions,p.facets?.conditions||[])&&(!hasComments||p.commentCount>0)&&(!q||textOf(p).toLocaleLowerCase('ru').includes(q)));
  return result.slice().sort((a,b)=>sort==='comments'?b.commentCount-a.commentCount:sort==='oldest'?Date.parse(a.sortDate||0)-Date.parse(b.sortDate||0):Date.parse(b.sortDate||0)-Date.parse(a.sortDate||0));
 }
 function counts(rows,type){const out={};for(const p of rows){for(const v of p.facets?.[type]||[])out[v]=(out[v]||0)+1;}return Object.entries(out).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ru'));}
 return {classify,normalize,filter,counts,topicNames:Object.keys(rules.topics),regionNames:Object.keys(rules.regions),conditionNames:Object.keys(rules.conditions)};
});