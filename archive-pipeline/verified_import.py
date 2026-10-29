"""Staging-only Bur -> existing Supabase import RPC with durable verified receipts.

Dry-run by default. Known production projects are always rejected for writes.
No secrets in files, logs, extension, or portal. Standard library only.
"""
import argparse,hashlib,json,os,re,time,urllib.request,urllib.error,urllib.parse
from pathlib import Path

PRODUCTION={'ltznpjfnkpydautbsrej.supabase.co','bybgnzeaoaxnxwdugnwo.supabase.co','metzia.store'}
ID=re.compile(r'^\d{8,30}$')

def validate_graph(payload):
    if payload.get('relational_schema')!='bur-author-graph/1':raise ValueError('unsupported relational schema')
    records=payload.get('authors')
    if not isinstance(records,list):raise ValueError('invalid authors')
    authors={}
    for record in records:
        if not isinstance(record,dict):raise ValueError('invalid author record')
        key=record.get('key','');quality=record.get('identity_quality')
        if not isinstance(key,str) or not re.fullmatch(r'author:[a-f0-9]{64}',key) or key in authors:raise ValueError('duplicate or invalid author key')
        if not isinstance(record.get('display_name'),str) or not record['display_name'].strip():raise ValueError('missing author name')
        if quality=='facebook_id':
            basis=record.get('facebook_author_id')
            if not isinstance(basis,str) or not re.fullmatch(r'\d{1,30}',basis):raise ValueError('invalid author identity')
        elif quality=='profile_url':
            basis=record.get('profile_url','')
            if not isinstance(basis,str):raise ValueError('invalid author profile')
            url=urllib.parse.urlsplit(basis)
            if url.scheme!='https' or url.hostname!='www.facebook.com' or url.query or url.fragment:raise ValueError('invalid author profile')
        elif quality=='display_name_only':basis=None
        else:raise ValueError('invalid author identity quality')
        if basis and key!='author:'+hashlib.sha256(basis.encode()).hexdigest():raise ValueError('author identity hash mismatch')
        authors[key]=record
    group=payload['group']
    def reference(owner,key):
        author=owner.get('author_key')
        if not author:return
        if not isinstance(author,str) or owner.get('author_is_anonymous') or author not in authors:raise ValueError('dangling or anonymous author reference')
        if authors[author]['identity_quality']=='display_name_only':
            basis=group+'|'+key+'|'+str(owner.get('author') or '').strip()
            if author!='author:'+hashlib.sha256(basis.encode()).hexdigest():raise ValueError('unscoped display-name identity')
    for post in payload['posts']:
        key=group+'|post:'+post['post_id']
        if post.get('key')!=key:raise ValueError('invalid post graph key')
        reference(post,key);comments={}
        for comment in post.get('comments',[]):
            if not isinstance(comment,dict):raise ValueError('invalid comment record')
            ck=comment.get('key')
            if not isinstance(ck,str) or not ck.startswith(key+'|') or ck in comments or comment.get('post_key')!=key:raise ValueError('invalid comment graph owner')
            if not isinstance(comment.get('id'),str) or not comment['id'] or ck!=key+'|comment:'+comment['id']:raise ValueError('missing or inconsistent stable comment id')
            comments[ck]=comment;reference(comment,ck)
        for ck,comment in comments.items():
            seen={ck};parent=comment.get('parent_comment_key')
            while parent:
                if not isinstance(parent,str):raise ValueError('invalid parent key')
                if parent not in comments:raise ValueError('foreign or missing parent key')
                if parent in seen:raise ValueError('parent cycle')
                seen.add(parent);parent=comments[parent].get('parent_comment_key')

def validate(payload):
    if not isinstance(payload,dict) or payload.get('schema')!='bur-collector/1':
        raise ValueError('unsupported schema')
    group=payload.get('group')
    if not isinstance(group,str) or not re.fullmatch(r'[\w.-]{1,128}',group,re.ASCII):
        raise ValueError('invalid group slug')
    summary=payload.get('job_summary') or {}
    if summary.get('stage')!='done' or not summary.get('id'):
        raise ValueError('incomplete or unidentified batch')
    if summary.get('checkpoint_post_id') and not summary.get('checkpoint_found_at'):
        raise ValueError('unconfirmed checkpoint; continuity not established')
    posts=payload.get('posts')
    if not isinstance(posts,list) or not posts or len(posts)>5000:
        raise ValueError('invalid posts array')
    ids=[]
    for post in posts:
        if not isinstance(post,dict) or not isinstance(post.get('post_id'),str) or not ID.fullmatch(post['post_id']):
            raise ValueError('post_id must be a digit string')
        if post.get('group',group)!=group:
            raise ValueError('cross-group payload')
        ids.append(post['post_id'])
        if not isinstance(post.get('comments',[]),list):
            raise ValueError('invalid comments')
    if len(ids)!=len(set(ids)):
        raise ValueError('duplicate post ids; preserve source and review')
    order=summary.get('discovery_order')
    if not isinstance(order,list) or any(not isinstance(x,str) for x in order) or len(order)!=len(ids) or set(order)!=set(ids):
        raise ValueError('discovery order mismatch')
    if payload.get('relational_schema'):validate_graph(payload)
    return group,ids

def target(base):
    u=urllib.parse.urlsplit(base)
    if u.hostname in PRODUCTION or any((u.hostname or '').endswith('.'+x) for x in PRODUCTION):
        raise ValueError('production writes prohibited')
    if u.username or u.password or u.query or u.fragment or u.path not in ('','/'):
        raise ValueError('invalid base URL')
    if u.scheme!='https' and not (u.scheme=='http' and u.hostname in ('localhost','127.0.0.1')):
        raise ValueError('HTTPS required')
    return base.rstrip('/')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError('redirect rejected; credentials must stay on selected host')

class Client:
    def __init__(self,base,key,attempts=4):
        self.base=target(base);self.key=key;self.attempts=attempts
        self.opener=urllib.request.build_opener(NoRedirect)
    def request(self,path,data=None,method='POST',raw=False):
        body=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode() if data is not None else None
        headers={'apikey':self.key,'Content-Type':'application/json','x-upsert':'false'}
        if self.key.startswith('eyJ'):headers['Authorization']='Bearer '+self.key
        for attempt in range(self.attempts):
            try:
                req=urllib.request.Request(self.base+path,data=body,method=method,headers=headers)
                with self.opener.open(req,timeout=120) as response: result=response.read()
                return result if raw else json.loads(result)
            except urllib.error.HTTPError as exc:
                # Do not log provider bodies, headers, tokens, or raw personal data.
                if exc.code not in (429,500,502,503,504) or attempt==self.attempts-1:
                    raise RuntimeError('HTTP '+str(exc.code)) from None
            except (TimeoutError,urllib.error.URLError):
                if attempt==self.attempts-1:raise RuntimeError('network failure; safe to retry') from None
            time.sleep(min(8,2**attempt))

def import_batch(path,client,receipt_dir):
    target(client.base)
    path=Path(path);raw=path.read_bytes()
    if len(raw)>50*1024*1024:raise ValueError('batch exceeds 50 MiB')
    payload=json.loads(raw);group,ids=validate(payload)
    digest=hashlib.sha256(raw).hexdigest()
    object_path=group+'/'+digest+'.json'
    encoded=urllib.parse.quote(object_path,safe='/')
    try:
        client.request('/storage/v1/object/bur-raw/'+encoded,raw)
    except RuntimeError as exc:
        if str(exc) not in ('HTTP 409','HTTP 400'):raise
        # A conflict never proves an identical object: download and verify below.
    stored=client.request('/storage/v1/object/authenticated/bur-raw/'+encoded,method='GET',raw=True)
    if hashlib.sha256(stored).hexdigest()!=digest:
        raise ValueError('raw object checksum mismatch; database not called')
    graph=payload.get('relational_schema')=='bur-author-graph/1'
    receipt=client.request('/rest/v1/rpc/'+('bur_import_archived_graph' if graph else 'bur_import_archived_json'),{
        'payload':payload,'source_filename':path.name,'storage_bucket':'bur-raw',
        'storage_path':object_path,'source_file_sha256':digest})
    if not isinstance(receipt,dict) or receipt.get('ok') is not True or not receipt.get('crawl_run_id'):
        raise ValueError('database acknowledgement missing')
    if receipt.get('source_file_sha256')!=digest or receipt.get('storage_path')!=object_path or receipt.get('archived') is not True:
        raise ValueError('database acknowledgement does not identify exact source')
    if graph and receipt.get('relational_schema')!='bur-author-graph/1':raise ValueError('relational acknowledgement missing')
    verified=client.request('/rest/v1/rpc/'+('bur_verify_graph_receipt' if graph else 'bur_verify_import_receipt'),{
        'p_run_id':receipt['crawl_run_id'],'p_group':group,'p_sha256':digest,'p_post_ids':ids})
    if not isinstance(verified,dict) or verified.get('verified') is not True or verified.get('post_count')!=len(ids):
        raise ValueError('database readback failed; batch remains unacknowledged locally')
    if graph and verified.get('relational_verified') is not True:raise ValueError('relational database readback failed')
    result={'sha256':digest,'group':group,'batch_id':payload['job_summary']['id'],
            'crawl_run_id':receipt['crawl_run_id'],'post_count':len(ids),'verified':True,
            'partial_deep':bool(payload['job_summary'].get('deep_errors')) or
              int(payload['job_summary'].get('deep_done') or 0)<len(ids),
            'target':client.base}
    if graph:result['relational_verified']=True
    directory=Path(receipt_dir);directory.mkdir(parents=True,exist_ok=True)
    # Receipt is never used to skip remote verification. Atomic replace survives a crash.
    out=directory/(digest+'.json');tmp=out.with_suffix('.tmp')
    with tmp.open('w',encoding='utf-8') as f:
        json.dump(result,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
    os.replace(tmp,out)
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files',nargs='+');parser.add_argument('--apply',action='store_true')
    parser.add_argument('--url');parser.add_argument('--receipts',default='work/import-receipts')
    args=parser.parse_args()
    if not args.apply:
        for file in args.files:
            group,ids=validate(json.loads(Path(file).read_bytes()))
            print(json.dumps({'file':Path(file).name,'group':group,'posts':len(ids),'dry_run':True}))
        return
    if not args.url:parser.error('--url must name an isolated staging instance')
    key=os.environ.get('BUR_STAGING_SECRET','')
    if not key:parser.error('BUR_STAGING_SECRET not set')
    client=Client(args.url,key)
    for file in args.files:print(json.dumps(import_batch(file,client,args.receipts)))

if __name__=='__main__':main()
