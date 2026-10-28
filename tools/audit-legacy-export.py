"""Inspect a private legacy export without printing personal records."""
from pathlib import Path
import sys,json,hashlib
raw=Path(sys.argv[1]).read_bytes();data=json.loads(raw)
authors={r['key']:r for r in data['authors']};posts={r['key'] for r in data['posts']};comments={r['key'] for r in data['comments']}
assert len(authors)==len(data['authors']) and len(posts)==len(data['posts']) and len(comments)==len(data['comments'])
broken=sum(bool(r.get('author_key')) and r['author_key'] not in authors for r in data['posts']+data['comments'])
assert broken==0
assert all(c['post_key'] in posts for c in data['comments'])
numeric=[a for a in authors.values() if str(a.get('facebook_author_id') or '').isdigit()]
matching=sum(a['key']=='author:'+hashlib.sha256(str(a['facebook_author_id']).encode()).hexdigest() for a in numeric)
print(json.dumps({'sha256':hashlib.sha256(raw).hexdigest(),'collector_version':data['collector_version'],'schema_version':data['schema_version'],'exported_at':data['exported_at'],'posts':len(posts),'comments':len(comments),'authors':len(authors),'media':len(data['media']),'post_dates':sum(bool(p.get('posted_at')) for p in data['posts']),'post_author_refs':sum(bool(p.get('author_key')) for p in data['posts']),'comment_author_refs':sum(bool(c.get('author_key')) for c in data['comments']),'broken_author_refs':broken,'parent_comment_refs':sum(bool(c.get('parent_comment_key')) for c in data['comments']),'numeric_author_keys':len(numeric),'numeric_author_key_formula_matches':matching,'provenance':'collector version label matches c0db6ad and 47873c3; exact deployed source and origin of accumulated records are not established'},indent=2))
