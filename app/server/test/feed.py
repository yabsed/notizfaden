"""Unified feed: ranking, following, search tiers, privacy and both cursors.
Run with the isolated test API/DB; only this run's generated note gets backdated.
"""
import json
import os
import subprocess
import urllib.error
import urllib.request
from urllib.parse import urlencode
import uuid

BASE = os.getenv('NOTIZFADEN_TEST_API', 'http://127.0.0.1:8082/api')
DATABASE = os.getenv('NOTIZFADEN_TEST_DATABASE', 'host=127.0.0.1 port=55432 dbname=notizfaden_social_test')


def call(path, method='GET', data=None, user=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if user:
        headers['Authorization'] = 'Bearer ' + user['token']
    request = urllib.request.Request(BASE + path, method=method, headers=headers,
                                     data=None if data is None else json.dumps(data).encode())
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            code, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        code, raw = error.code, error.read()
    assert code == expected, (path, code, raw.decode())
    return json.loads(raw) if raw else None


def sql(query):
    return subprocess.check_output(['psql', '-X', '-d', DATABASE, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', query], text=True).strip()


assert call('/health')['testDatabase'] is True
assert sql('SELECT current_database()').endswith('_test')
users = [call('/auth/register', 'POST', {'username': 'test_' + uuid.uuid4().hex[:12], 'password': 'teum-test-password-2026'}) for _ in range(4)]
writer, viewer, alice, bob = users
title = '통합피드_' + uuid.uuid4().hex
body = {'title': title, 'content': '봄의 정원', 'kind': 'text', 'items': [], 'color': 'green',
        'labels': [], 'pinned': False, 'archived': False, 'trashed': False, 'sourceId': None}
created = []


def make(owner=writer, public=True):
    note = call('/notes/' + str(uuid.uuid4()), 'PUT', {'body': body, 'baseRevision': 0, 'mutationId': str(uuid.uuid4())}, owner)
    created.append((owner, note['id']))
    return share(note, owner, 'public') if public else note


def share(note, owner=writer, visibility='private'):
    return call('/notes/' + note['id'] + '/visibility', 'PATCH', {'visibility': visibility, 'baseRevision': note['revision'], 'mutationId': str(uuid.uuid4())}, owner)


def feed(**params):
    return call('/social/feed?' + urlencode({'author': writer['user']['id'], **params}), user=viewer)


def ids(page):
    return [post['note']['id'] for post in page['items']]


def relate(target, kind='follow', enabled=True):
    return call('/social/profiles/' + target['user']['id'] + '/' + kind, 'PUT', {'enabled': enabled}, viewer)


def people(**params):
    return [p['id'] for p in call('/social/people?' + urlencode(params), user=viewer)]


def like(note, user):
    call('/social/notes/' + note['id'] + '/like', 'PUT', {'enabled': True}, user)


def reply(note, user):
    rid = str(uuid.uuid4())
    call('/social/notes/' + note['id'] + '/replies', 'POST', {'id': rid, 'content': '함께 읽어요'}, user)
    return rid


try:
    expired, popular, newer, zero, secret = make(), make(), make(), make(), make(public=False)
    for who in (viewer, alice, bob):
        like(expired, who)
    # UUIDs from this run only; the guard fails if the API and DB are mismatched.
    changed = sql(f"UPDATE notes SET published_at=now()-interval '8 days' WHERE id='{expired['id']}' AND owner_id='{writer['user']['id']}' RETURNING id")
    assert changed == expired['id']
    like(popular, alice)
    bob_reply = reply(popular, bob)
    like(newer, alice)
    for _ in range(5):
        reply(newer, alice)
    like(newer, writer)
    reply(newer, writer)
    assert ids(feed(sort='latest')) == [zero['id'], newer['id'], popular['id'], expired['id']]
    assert ids(feed(sort='top')) == [popular['id'], newer['id'], zero['id']], 'unique non-author participants, not raw likes/comments'
    assert ids(feed(sort='top', q='  봄의 정원  ')) == ids(feed(sort='top'))
    assert not ids(feed(sort='top', q='no-matching-text'))
    assert secret['id'] not in ids(feed(sort='top'))
    relate(bob, 'mute')
    assert ids(feed(sort='top'))[:2] == [newer['id'], popular['id']], 'muted reactions do not boost rank'
    relate(bob, 'mute', False)
    relate(bob, 'block')
    assert ids(feed(sort='top'))[:2] == [newer['id'], popular['id']]
    relate(bob, 'block', False)
    call('/social/notes/' + popular['id'] + '/replies/' + bob_reply, 'DELETE', user=bob, expected=204)
    assert ids(feed(sort='top'))[:2] == [newer['id'], popular['id']], 'deleted replies do not boost rank'
    assert not ids(feed(following='true'))
    own = make(viewer)
    assert own['id'] not in ids(call('/social/feed?following=true', user=viewer))
    relate(writer)
    assert len(ids(feed(following='true'))) == 4
    relate(writer, 'mute')
    assert not ids(feed(sort='top', following='true'))
    assert writer['user']['id'] not in people(following='true')
    relate(writer, 'mute', False)
    relate(writer, 'block')
    assert not ids(feed(sort='top'))
    relate(writer, 'block', False)
    popular = share(popular)
    assert popular['id'] not in ids(feed(sort='top'))
    popular = share(popular, visibility='public')
    newer = call('/notes/' + newer['id'], 'PUT', {'body': {**body, 'trashed': True}, 'baseRevision': newer['revision'], 'mutationId': str(uuid.uuid4())}, writer)
    assert newer['id'] not in ids(feed(sort='top'))
    # Follow-only people includes accounts with no public posts.
    relate(alice)
    assert people(following='true') == [alice['user']['id']]
    name = '검색정원' + uuid.uuid4().hex[:8]
    for person, display in [(writer, name), (alice, name), (bob, name + '가꾸기')]:
        call('/social/profile', 'PUT', {'displayName': display, 'bio': '', 'avatar': ''}, person)
    assert people(q=name)[:3] == [alice['user']['id'], writer['user']['id'], bob['user']['id']], 'exact matches first; followed accounts win ties'
    assert people(q=name + '가꾸기')[0] == bob['user']['id']
    assert people(q=name, following='true') == [alice['user']['id']]
    for _ in range(32):
        make()
    for sort in ('top', 'latest'):
        first = feed(sort=sort)
        second = feed(sort=sort, cursor=first['cursor'])
        combined = ids(first) + ids(second)
        assert len(first['items']) == 30 and not set(ids(first)) & set(ids(second)) and second['cursor'] is None
        assert len(combined) == (34 if sort == 'top' else 35)
        if sort == 'top':
            assert first['cursor'].split('|')[0] == 'top'
            call('/social/feed?' + urlencode({'sort': 'latest', 'cursor': first['cursor']}), expected=400)
    for params in ({'sort': 'invalid'}, {'sort': 'top', 'cursor': 'invalid'}):
        call('/social/feed?' + urlencode(params), expected=400)
    for path in ('/social/feed?following=true', '/social/people?following=true'):
        call(path, expected=401)
    print('PASS: latest/top, seven-day window, distinct participants, self/deleted/blocked/muted reactions, privacy, following-only, people relevance, cursors.')
finally:
    for owner in users:
        for note in call('/notes', user=owner):
            if note['visibility'] == 'public':
                share(note, owner)
