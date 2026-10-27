'use strict';
const assert=require('node:assert/strict');
const F=require('../feed-scroll.js');
function elem(role,overflowY,scrollHeight,clientHeight,parent){const obj={role,overflowY,scrollHeight,clientHeight,parentElement:parent,tagName:'DIV',getAttribute:x=>x==='role'?role:null};let top=0;Object.defineProperty(obj,'scrollTop',{get(){return top;},set(v){top=Math.max(0,Math.min(scrollHeight-clientHeight,v));}});return obj;}
(async()=>{
 const body=elem('body','visible',2500,900,null),docRoot=elem('html','auto',2500,900,body),main=elem('main','auto',2900,900,body),scroll=elem('feed-holder','auto',3800,900,main),feed=elem('feed','visible',3300,800,scroll);
 const doc={scrollingElement:docRoot,documentElement:docRoot,body,querySelector:s=>s==='[role="feed"]'?feed:s==='[role="main"]'?main:null};
 const view={scrollY:0,innerHeight:800,history:{scrollRestoration:'auto'},getComputedStyle:x=>({overflowY:x.overflowY}),scrollBy:(x,y)=>{docRoot.scrollTop+=y;view.scrollY=docRoot.scrollTop;},scrollTo:(x,y)=>{docRoot.scrollTop=y;view.scrollY=docRoot.scrollTop;}};
 const got=F.getCandidates(doc,view);
 assert.equal(got[0],scroll,'MUST prefer scrollable ancestor of feed, not main');
 const r=await F.advance(doc,view,async()=>{});assert.equal(r.moved,true);assert.equal(r.tries.length,1);assert.ok(scroll.scrollTop>0);
 // The first preferred candidate can be stuck at its bottom; fall through to a real scrolling surface.
 scroll.scrollTop=scroll.scrollHeight-scroll.clientHeight;
 const second=await F.advance(doc,view,async()=>{});assert.equal(second.moved,true);assert.ok(second.tries.length>=2);assert.ok(main.scrollTop>0);
 // If neither can scroll, explicitly report unmoved instead of claiming the feed is exhausted.
 main.scrollTop=main.scrollHeight-main.clientHeight;
 view.scrollY=docRoot.scrollHeight-docRoot.clientHeight;docRoot.scrollTop=view.scrollY;
 const third=await F.advance(doc,view,async()=>{});
 assert.equal(third.moved,false);assert.ok(third.tries.every(x=>x.moved===false));
 // 0.5.18: stale/restored scroll positions must be forced to a verified top.
 scroll.scrollTop=1700;main.scrollTop=900;docRoot.scrollTop=1200;view.scrollY=1200;
 const rewind=await F.rewindToTop(doc,view,async()=>{});
 assert.equal(rewind.ok,true);assert.ok(rewind.stable_rounds>=3);assert.equal(rewind.position,0);
 assert.equal(scroll.scrollTop,0);assert.equal(main.scrollTop,0);assert.equal(docRoot.scrollTop,0);assert.equal(view.scrollY,0);
 assert.equal(view.history.scrollRestoration,'manual');
 console.log('PASS: feed scroll + verified rewind-to-top diagnostics');
})().catch(e=>{console.error(e);process.exitCode=1});
