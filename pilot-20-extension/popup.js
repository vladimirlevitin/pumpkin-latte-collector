const $=id=>document.getElementById(id);
async function refresh(){const s=await chrome.runtime.sendMessage({type:'state'});$('status').textContent=JSON.stringify({running:s.running,current:s.current,queue:s.queue?.map(x=>({id:x.facebook_post_id,status:x.status,old:x.old_comment_count,new:x.new_comment_count,error:x.last_error})),log:s.log?.slice(-8)},null,2);}
for(const id of ['load','start','stop'])$(id).onclick=async()=>{const token=$('token').value.trim();const r=await chrome.runtime.sendMessage({type:id,token});if(r?.error)alert(r.error);await refresh()};
refresh();setInterval(refresh,2000);
