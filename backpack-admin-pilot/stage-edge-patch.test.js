'use strict';
const assert=require('node:assert/strict');
const {patch}=require('./stage-edge-patch.js');
const fixture=[
  'const SUPABASE_URL="test";',
  'const userAuth=(req)=>sessionHash(req);',
  'if(api==="browse"){',
  ' return json({ok:true,items:(rows||[]).map((x:any)=>({...x,image_url:null}))});',
  '}',
  'if(api==="search"){return search();}'
].join('\n');
const next=patch(fixture);
assert(next.includes('function backpackAutoFacets('));
assert(next.includes('...backpackAutoFacets(x)'));
assert(next.includes('const userAuth=(req)=>sessionHash(req);'));
assert(next.includes('if(api==="search"){return search();}'));
assert.throws(()=>patch(next));
assert.throws(()=>patch('unrelated source'));
console.log('PASS narrow edge patch, unchanged auth and search, repeat-run abort');
