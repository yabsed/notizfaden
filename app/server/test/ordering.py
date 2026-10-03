"""Personal note ordering: account isolation, persistence and unchanged public notes."""
import json
import os
import uuid
import urllib.request
import urllib.error

BASE = os.getenv('NOTIZFADEN_TEST_API', 'http://127.0.0.1:8082/api')


def call(path, method='GET', data=None, token=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, data=None if data is None else json.dumps(data).encode(), method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            code, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        code, raw = error.code, error.read()
    assert code == expected, (path, code, raw.decode())
    return json.loads(raw) if raw else None


assert call('/health').get('testDatabase') is True, 'Requires isolated _test database'
credentials = {'username': 'test_' + uuid.uuid4().hex[:12], 'password': 'teum-test-password-2026'}
alice = call('/auth/register', 'POST', credentials)['token']
bob = call('/auth/register', 'POST', {**credentials, 'username': 'test_' + uuid.uuid4().hex[:12]})['token']
body = {'title': '순서를 바꾸는 메모', 'content': '본문과 공개 시각은 그대로', 'kind': 'text', 'items': [], 'color': 'green', 'labels': [], 'pinned': False, 'archived': False, 'trashed': False, 'sourceId': None}
ids = [str(uuid.uuid4()) for _ in range(3)]
for ident in ids:
    call('/notes/' + ident, 'PUT', {'body': body, 'baseRevision': 0, 'mutationId': str(uuid.uuid4())}, alice)
shared = call('/notes/' + ids[0] + '/visibility', 'PATCH', {'visibility': 'public', 'baseRevision': 1, 'mutationId': str(uuid.uuid4())}, alice)
try:
    before = call('/notes', token=alice)
    public_before = call('/public/' + ids[0])
    assert call('/note-order', token=alice) == {'ids': []}
    call('/note-order', expected=401)
    call('/note-order', 'PUT', {'ids': []}, expected=401)
    desired = {'ids': [ids[2], ids[0], ids[1]]}
    for _ in range(2):
        assert call('/note-order', 'PUT', desired, alice) == desired
    second_device = call('/auth/login', 'POST', credentials)['token']
    assert call('/note-order', token=second_device) == desired
    assert call('/note-order', token=bob) == {'ids': []}
    # Even a readable public note cannot be inserted into someone else's order.
    call('/note-order', 'PUT', {'ids': [ids[0]]}, bob, 400)
    for invalid in [[str(uuid.uuid4())], [ids[0], ids[0]], ['not-a-uuid'], [ids[0]] * 10001]:
        call('/note-order', 'PUT', {'ids': invalid}, alice, 400)
    assert call('/note-order', token=alice) == desired
    assert call('/notes', token=alice) == before, 'reordering must not edit note revisions/timestamps'
    assert call('/public/' + ids[0]) == public_before, 'personal order must not change public data'
    assert call('/note-order', 'PUT', {'ids': []}, alice) == {'ids': []}
    assert call('/note-order', token=second_device) == {'ids': []}
finally:
    call('/notes/' + ids[0] + '/visibility', 'PATCH', {'visibility': 'private', 'baseRevision': shared['revision'], 'mutationId': str(uuid.uuid4())}, alice)
print('Ordering API: persistence, isolation, validation and unchanged notes passed')
