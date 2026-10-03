"""Social integration tests. Use a disposable database and NOTIZFADEN_TEST_API.
For moderation coverage run its server with NOTIZFADEN_ADMIN_USERNAME=social_admin.
"""
import json, os, uuid, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

BASE = os.getenv('NOTIZFADEN_TEST_API', 'http://127.0.0.1:8081/api')
def call(path, method='GET', data=None, token=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: code, raw = r.status, r.read()
    except urllib.error.HTTPError as e: code, raw = e.code, e.read()
    assert code == expected, (path, code, raw.decode())
    return json.loads(raw) if raw else None

def uid(): return str(uuid.uuid4())
def register(): return call('/auth/register', 'POST', {'username': 'social_' + uuid.uuid4().hex[:12], 'password': 'social-test-password-2026'})
a, b, c = register(), register(), register()
at, bt, ct = (u['token'] for u in (a,b,c))
ai, bi, ci = (u['user']['id'] for u in (a,b,c))
body = {'title': 'public garden', 'content': 'a shared thought', 'kind': 'text', 'items': [], 'color': 'green', 'labels': ['secret-personal-label'], 'pinned': True, 'archived': True, 'trashed': False, 'sourceId': None}
created = []
def make(content=body, public=True):
    ident = uid()
    n = call('/notes/'+ident, 'PUT', {'body': content, 'baseRevision': 0, 'mutationId': uid()}, at)
    created.append(ident)
    return visibility(n, 'public') if public else n

def visibility(n, value):
    return call('/notes/'+n['id']+'/visibility', 'PATCH', {'visibility': value, 'baseRevision': n['revision'], 'mutationId': uid()}, at)
def relation(target, kind, flag=True, token=bt, expected=200):
    return call('/social/profiles/'+target+'/'+kind, 'PUT', {'enabled': flag}, token, expected)
def feed(token=bt, **params): return call('/social/feed?'+urlencode(params), token=token)
def ids(page): return [x['note']['id'] for x in page['items']]

try:
    n = make(); nid = n['id']; secret = make({**body, 'title': 'private-secret-query'}, False)
    assert secret['id'] not in ids(feed(q='private-secret-query'))
    assert not feed(q='secret-personal-label')['items']
    for path in ['/public/'+nid, '/social/notes/'+nid]:
        result = call(path, token=bt)
        exposed = result.get('note', result)['body']
        assert exposed['labels'] == [] and not exposed['pinned'] and not exposed['archived'] and exposed['sourceId'] is None
    assert next(x for x in call('/notes', token=at) if x['id']==nid)['body']['labels'] == body['labels']
    assert call('/social/profiles/'+ai)['posts'] == 1
    profile = call('/social/profile', 'PUT', {'displayName': '가든 작가', 'bio': '오늘의 기록', 'avatar': '🌱'}, at)
    assert profile['displayName'] == '가든 작가'
    assert any(p['id']==ai for p in call('/social/people?'+urlencode({'q':'가든 작가'})))
    call('/social/profile', 'PUT', {'displayName':'x'*41,'bio':'','avatar':''}, at,400)
    call('/social/notes/'+nid+'/like','PUT',{'enabled':True},expected=401)
    assert nid not in ids(feed(following='true'))
    relation(ai,'follow'); relation(ai,'follow')
    assert nid in ids(feed(following='true'))
    assert call('/social/profiles/'+ai,token=bt)['followers']==1
    assert call('/social/profiles/'+ai+'/connections?kind=followers',token=bt)[0]['id']==bi
    relation(bi,'follow',token=bt,expected=400)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: call('/social/notes/'+nid+'/like','PUT',{'enabled':True},bt), range(4)))
    assert call('/social/notes/'+nid,token=bt)['likes']==1
    rid=uid(); reply={'id':rid,'content':'함께 읽고 있어요'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        values=list(pool.map(lambda _:call('/social/notes/'+nid+'/replies','POST',reply,bt),range(4)))
    assert all(v['id']==rid for v in values)
    assert call('/social/notes/'+nid,token=bt)['replies']==1
    call('/social/notes/'+nid+'/replies','POST',reply,ct,409)
    call('/social/notes/'+nid+'/replies','POST',{**reply,'content':'different'},bt,409)
    call('/social/notes/'+nid+'/replies/'+rid,'DELETE',token=ct,expected=404)
    # Edits retain the thread, reactions and original feed position.
    published = call('/social/notes/'+nid)['publishedAt']
    n=call('/notes/'+nid,'PUT',{'body':{**body,'content':'edited shared thought'},'baseRevision':n['revision'],'mutationId':uid()},at)
    post=call('/social/notes/'+nid,token=bt)
    assert post['note']['body']['content']=='edited shared thought' and post['likes']==1 and post['replies']==1 and post['publishedAt']==published
    notices=call('/social/notifications',token=at)
    assert sorted(x['kind'] for x in notices['items'])==['follow','like','reply'] and notices['unread']==3
    call('/social/notifications/'+str(max(x['id'] for x in notices['items'])),'PUT',token=bt,expected=204)
    assert call('/social/notifications',token=at)['unread']==3, 'cannot read another account notifications'
    call('/social/notifications/'+str(max(x['id'] for x in notices['items'])),'PUT',token=at,expected=204)
    assert call('/social/notifications',token=at)['unread']==0
    n=visibility(n,'private')
    call('/social/notes/'+nid,token=at,expected=404)
    assert nid not in [r['id'] for r in call('/social/reactions',token=at)]
    for path in ['/public/'+nid,'/social/notes/'+nid,'/social/notes/'+nid+'/replies']:
        call(path,token=bt,expected=404)
    call('/social/notes/'+nid+'/like','PUT',{'enabled':True},bt,404)
    assert [x['kind'] for x in call('/social/notifications',token=at)['items']]==['follow']
    n=visibility(n,'public')
    assert call('/social/notes/'+nid)['replies']==0
    assert call('/social/notes/'+nid)['likes']==0, 'republishing must not resurrect reactions'
    assert all(x['kind']=='follow' for x in call('/social/notifications',token=at)['items'])
    summary=next(x for x in call('/social/reactions',token=at) if x['id']==nid)
    assert summary['likes']==0 and summary['replies']==0
    call('/social/notes/'+nid+'/replies','POST',reply,bt)
    call('/social/notes/'+nid+'/like','PUT',{'enabled':True},bt)
    # Mutes hide feeds and incoming notifications; direct links remain readable.
    relation(ai,'mute'); assert nid not in ids(feed()); call('/social/notes/'+nid,token=bt)
    relation(bi,'mute',token=at); assert not call('/social/notifications',token=at)['items']
    assert call('/social/notes/'+nid,token=at)['replies']==0
    relation(ai,'mute',False); relation(bi,'mute',False,at)
    # Blocks are symmetric, remove follows, and also protect the legacy public/fork API.
    relation(ai,'block'); assert nid not in ids(feed())
    assert nid not in [n['id'] for n in call('/public',token=bt)]
    for path in ['/public/'+nid,'/social/notes/'+nid,'/social/notes/'+nid+'/replies']:
        call(path,token=bt,expected=404)
    relation(ai,'follow',expected=404)
    call('/notes/'+uid(),'PUT',{'body':{**body,'sourceId':nid},'baseRevision':0,'mutationId':uid()},bt,404)
    assert call('/social/profiles/'+ai,token=bt)['followers']==0
    assert not call('/social/notifications',token=at)['items']
    relation(ai,'block',False)
    assert all(x['kind']!='follow' for x in call('/social/notifications',token=at)['items'])
    call('/social/notes/'+nid+'/replies/'+rid,'DELETE',token=at,expected=204)
    assert call('/social/notes/'+nid)['replies']==0
    assert all(x['kind']!='reply' for x in call('/social/notifications',token=at)['items'])
    # Feed and conversation cursors never duplicate entries across pages.
    for i in range(31): make({**body,'title':f'page {i}'})
    page1=feed(author=ai); page2=feed(author=ai,cursor=page1['cursor'])
    assert len(page1['items'])==30 and len(page2['items'])==2 and not set(ids(page1)) & set(ids(page2)) and page2['cursor'] is None
    call('/social/feed?cursor=invalid',expected=400)
    for i in range(32): call('/social/notes/'+nid+'/replies','POST',{'id':uid(),'content':f'reply {i}'},bt)
    r1=call('/social/notes/'+nid+'/replies'); r2=call('/social/notes/'+nid+'/replies?'+urlencode({'cursor':r1['cursor']}))
    assert len(r1['items'])==30 and len(r2['items'])==2 and not set(x['id'] for x in r1['items']) & set(x['id'] for x in r2['items'])
    e1=call('/social/notifications',token=at); e2=call('/social/notifications?cursor='+str(e1['cursor']),token=at)
    assert len(e1['items'])==30 and e2['items'] and not set(x['id'] for x in e1['items']) & set(x['id'] for x in e2['items'])
    call('/social/profiles/'+ai+'/report','POST',{'reason':'test report','noteId':nid},bt,204)
    call('/social/admin/reports',token=bt,expected=403)
    if os.getenv('NOTIZFADEN_TEST_ADMIN'):
        credentials={'username':'social_admin','password':'social-admin-test-password'}
        try: admin=call('/auth/register','POST',credentials)
        except AssertionError as e:
            assert e.args[0][1]==409
            admin=call('/auth/login','POST',credentials)
        reports=call('/social/admin/reports',token=admin['token']); report=next(r for r in reports if r['noteId']==nid)
        call('/social/admin/reports/'+str(report['id']),'PUT',{'enabled':True},admin['token'],204)
        assert next(r for r in call('/social/admin/reports',token=admin['token']) if r['id']==report['id'])['resolved']
    print('PASS: profiles, sanitized public notes, search privacy, follows, concurrent idempotent likes/replies, edit continuity, private/block/mute permissions, notifications, pagination, reports and admin authorization')
finally:
    for n in call('/notes',token=at):
        if n['visibility']=='public': visibility(n,'private')
