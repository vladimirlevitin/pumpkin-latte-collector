/* Adapter for the existing authenticated backpack-pilot browse response.
 * It enriches browse.items before the unchanged WordPress UI consumes them.
 * No write, no password/token access, no raw data exfiltration. */
'use strict';
(function(root,factory){
 const api=factory(typeof module==='object'&&module.exports?require('./facets.js'):root.BackpackFacets);
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BackpackCatalogAdapter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(F){
 if(!F)throw Error('Facets module missing');
 function adaptBrowse(response){
  if(!response||!Array.isArray(response.items))throw Error('Invalid authenticated browse response');
  return {...response,items:response.items.map(function(p){
    const auto=F.classify(p);
    // Keep existing reviewed classifications; append conservative suggestions
    // to the existing topics/cities arrays consumed by the published UI.
    const unique=a=>[...new Set(a.filter(x=>typeof x==='string'&&x.trim()))];
    return {...p,
      tags:unique([...(Array.isArray(p.tags)?p.tags:[]),...auto.topics,...auto.conditions]),
      cities:unique([...(Array.isArray(p.cities)?p.cities:[]),...auto.regions]),
      facet_provenance:{topics:'automatic_suggestion',regions:'text_mention_not_geocode'}
    };
  })};
 }
 return {adaptBrowse};
});
