"""Run against a disposable local API. Creates isolated users, leaves no public notes."""
import json, os, uuid, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = os.getenv('TEUM_TEST_API', 'http://127.0.0.1:8081/api')
def call(path, method='GET', data=None, token=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r: code, raw = r.status, r.read()
    except urllib.error.HTTPError as e: code, raw = e.code, e.read()
    assert code == expected, (path, code, raw.decode())
    return json.loads(raw) if raw else None

def ident(): return str(uuid.uuid4())
def credentials(): return {'username': 'test_' + uuid.uuid4().hex[:12], 'password': 'teum-test-password-2026'}
def save(note_id, body, rev=0, mutation=None): return {'body': body, 'baseRevision': rev, 'mutationId': mutation or ident()}
body = {'title': 'API test', 'content': 'private thought', 'kind': 'text', 'items': [], 'color': 'default', 'labels': [], 'pinned': False, 'archived': False, 'trashed': False, 'sourceId': None}
call('/health')
a, b = credentials(), credentials()
alice = call('/auth/register', 'POST', a)
bob = call('/auth/register', 'POST', b)
at, bt = alice['token'], bob['token']
call('/auth/login', 'POST', {**a, 'password': 'incorrect-password'}, expected=401)
assert call('/auth/login', 'POST', a)['user'] == alice['user']
call('/notes', expected=401)
id1 = ident(); mutation = ident(); initial = save(id1, body, mutation=mutation)
note = call('/notes/' + id1, 'PUT', initial, at)
assert note['revision'] == 1 and note['visibility'] == 'private'
assert call('/notes/' + id1, 'PUT', initial, at) == note, 'retry must be idempotent'
assert call('/notes', token=bt) == []
call('/public/' + id1, expected=404)
call('/notes/' + id1, 'PUT', save(id1, body, 1), bt, expected=404)
call('/notes/' + id1 + '/visibility', 'PATCH', {'baseRevision': 1, 'mutationId': ident(), 'visibility': 'public'}, bt, expected=404)
conflict = call('/notes/' + id1, 'PUT', save(id1, body, 0), at, expected=409)
assert conflict['current']['revision'] == 1
public = call('/notes/' + id1 + '/visibility', 'PATCH', {'baseRevision': 1, 'mutationId': ident(), 'visibility': 'public'}, at)
assert call('/public/' + id1)['visibility'] == 'public'
assert any(n['id'] == id1 for n in call('/public'))
fork_id = ident()
fork = call('/notes/' + fork_id, 'PUT', save(fork_id, {**body, 'sourceId': id1}), bt)
assert fork['visibility'] == 'private'
private = call('/notes/' + id1 + '/visibility', 'PATCH', {'baseRevision': public['revision'], 'mutationId': ident(), 'visibility': 'private'}, at)
call('/public/' + id1, expected=404)
assert not any(n['id'] == id1 for n in call('/public'))
assert any(n['id'] == fork_id for n in call('/notes', token=bt)), 'private source does not erase existing copy'
call('/notes/' + ident(), 'PUT', save(ident(), {**body, 'sourceId': id1}), bt, expected=404)
# Content writes cannot change visibility, even with extra forged fields.
updated = call('/notes/' + id1, 'PUT', {**save(id1, {**body, 'content': 'updated'}, private['revision']), 'visibility': 'public'}, at)
assert updated['visibility'] == 'private'
# Concurrent updates with the same base revision yield one success, one conflict.
def concurrent(text):
    try: return call('/notes/' + id1, 'PUT', save(id1, {**body, 'content': text}, updated['revision']), at)
    except AssertionError as e:
        assert e.args[0][1] == 409
        return None
with ThreadPoolExecutor(max_workers=2) as pool:
    writes = list(pool.map(concurrent, ['first edit', 'second edit']))
assert sum(w is not None for w in writes) == 1
latest = next(n for n in call('/notes', token=at) if n['id'] == id1)
shared = call('/notes/' + id1 + '/visibility', 'PATCH', {'baseRevision': latest['revision'], 'mutationId': ident(), 'visibility': 'public'}, at)
call('/notes/' + id1, 'PUT', save(id1, {**shared['body'], 'trashed': True}, shared['revision']), at)
call('/public/' + id1, expected=404)
call('/auth/logout', 'POST', token=at, expected=200)
call('/notes', token=at, expected=401)
print('PASS: registration, login, ownership, privacy, idempotent writes, conflicts, fork, unpublish, trash, logout')
