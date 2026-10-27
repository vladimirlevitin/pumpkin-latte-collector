/* Applies a narrow, fail-closed stage-only patch to existing backpack-pilot Edge source.
   This does not deploy or write to Supabase. It preserves authentication and search. */
'use strict';
const fs=require('node:fs');
const original="items:(rows||[]).map((x:any)=>({...x,image_url:null}))";
const replacement="items:(rows||[]).map((x:any)=>({...x,image_url:null,...backpackAutoFacets(x)}))";
const injection=`
/* Backpack private-admin catalog suggestions; no geocoding or public publication. */
function backpackAutoFacets(x:any){
 const text=(String(x?.text_content||"")+" "+(Array.isArray(x?.comment_texts)?x.comment_texts.slice(0,20).join(" "):"")).toLocaleLowerCase("ru");
 const topics:Record<string,RegExp>={
  "Пешие маршруты":/поход|хайкинг|треккинг|маслул|маршрут|троп|нахаль/u,
  "Вода и купание":/водопад|купани|купаться|пляж|озеро|источник|родник|бассейн|водоём|водоем/u,
  "Кемпинг":/палатк|кемпинг|ночевк|ночёвк|костёр|лагерь/u,
  "С детьми":/дети|детям|ребенк|ребёнк|семьей|семьёй|малыш|коляск/u,
  "Животные и птицы":/пеликан|птиц|шакал|животн|зоопарк|фламинго|черепах/u,
  "Городские прогулки":/экскурси|музей|городск|архитектур|старый город|квартал/u,
  "Транспорт":/автобус|поезд|общественн.{0,12}транспорт|парковк|такси/u,
  "Безопасность":/опасн|закрыт.{0,15}маршрут|предупрежден|предупреждён|спасател|пожар|запрет/u,
  "С собакой":/с собак|собакой|собаками|питомц/u,
  "Без машины":/без машины|без автомобил/u,
  "Бесплатно":/бесплатн|без оплаты|вход свободный/u
 };
 const regions:Record<string,RegExp>={
  "Иерусалим и окрестности":/иерусалим|jerusalem|ירושלים/u,
  "Голаны":/голан|golan|רמת הגולן/u,
  "Галилея":/галиле|galilee|גליל/u,
  "Кинерет и Тверия":/кинерет|киннерет|твери|kinneret|tiberias|כנרת|טבריה/u,
  "Хайфа и Кармель":/хайф|кармел|haifa|carmel|חיפה|כרמל/u,
  "Мёртвое море":/м[её]ртв.{0,5}мор|dead sea|ים המלח/u,
  "Негев":/негев|negev|נגב/u,
  "Эйлат и Арава":/эйлат|eilat|арава|arava|אילת|ערבה/u,
  "Тель-Авив и центр":/тель.?авив|tel.?aviv|תל אביב|шапира/u,
  "Эмек Хефер":/эмек хефер|emek hefer|עמק חפר/u
 };
 const unique=(a:any[])=>Array.from(new Set(a.filter(v=>typeof v==="string"&&v.trim())));
 const t=Object.entries(topics).filter(([_,r])=>r.test(text)).map(([k])=>k);
 const r=Object.entries(regions).filter(([_,rx])=>rx.test(text)).map(([k])=>k);
 return {tags:unique([...(Array.isArray(x.tags)?x.tags:[]),...t]),
         cities:unique([...(Array.isArray(x.cities)?x.cities:[]),...r])};
}
`;
function patch(source){
 if(typeof source!=='string')throw Error('Source must be a string');
 if(source.split(original).length!==2)throw Error('Expected unique browse mapper not found: aborting');
 if(source.includes('function backpackAutoFacets('))throw Error('Already patched: aborting');
 const marker='const SUPABASE_URL=';
 if(!source.includes(marker))throw Error('Expected Edge Function header absent');
 return source.replace(marker,injection+'\n'+marker).replace(original,replacement);
}
if(require.main===module){
 const [input,output]=process.argv.slice(2);
 if(!input||!output){console.error('Usage: node stage-edge-patch.js original-edge-index.ts staged-edge-index.ts');process.exit(2);}
 const originalSource=fs.readFileSync(input,'utf8');
 const result=patch(originalSource);
 fs.writeFileSync(output,result,'utf8');
 console.log('Staged source written, unchanged login/session/search/WordPress app sections');
}
module.exports={patch};
