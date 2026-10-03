#!/usr/bin/env python3
"""Verified test-account cleanup and repeatable, attributed poetry fixtures.

Uses Python's standard library, PostgreSQL CLI tools, and the normal Haskell API.
Cleanup defaults to a preview; --apply always creates a full database backup first.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'demo/poetry.json'
NAMESPACE = uuid.UUID('5f539e21-69f5-4760-af2a-464b87bda35a')
TEST_CREDENTIALS = [
    (r'conflict_\d{13}', 'teum-conflict-password'),
    (r'(?:rich|legacy)_\d{13}', 'rich-text-test-password'),
    (r'tabs_\d{13}', 'teum-tabs-test-password'),
    (r'ui_\d{13}', 'teum-browser-test-2026'),
    (r'test_[a-f0-9]{12}', 'teum-test-password-2026'),
    (r'social_[a-f0-9]{12}', 'social-test-password-2026'),
    (r'sns_[a-f0-9]{13}', 'social-browser-password'),
]


def sql(database, statement):
    result = subprocess.run(['psql', '-X', '--dbname', database, '-v', 'ON_ERROR_STOP=1', '-Atq'],
                            input=statement, text=True, capture_output=True)
    if result.returncode:
        # A failed SQL statement may contain password hashes; don't echo it.
        raise RuntimeError('Database operation failed; transaction rolled back. Check schema/connection.')
    return result.stdout.strip()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def verified_test(user):
    for pattern, password in TEST_CREDENTIALS:
        if re.fullmatch(pattern, user['name']):
            actual = hashlib.pbkdf2_hmac('sha256', password.encode(), user['salt'].encode(), 600000).hex()
            return hmac.compare_digest(actual, user['password_hash'])
    return False


def cleanup(args):
    users = json.loads(sql(args.database, 'SELECT coalesce(json_agg(u),\'[]\') FROM users u;'))
    doomed = [u for u in users if verified_test(u)]
    report = {'remove': sorted(u['name'] for u in doomed),
              'preserve': sorted(u['name'] for u in users if u not in doomed)}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not args.apply or not doomed:
        print(f'{len(doomed)} verified test accounts. ' + ('No changes.' if not args.apply else 'Nothing to remove.'))
        return
    backup_dir = ROOT / '.data/backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / ('before-demo-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.dump')
    with backup.open('xb') as output:
        os.chmod(backup, 0o600)
        subprocess.run(['pg_dump', '--dbname', args.database, '--format=custom'], stdout=output, check=True)
    # Serialize deletion with API writes and recheck the exact credentials observed.
    expected = [{k: u[k] for k in ('id', 'name', 'salt', 'password_hash')} for u in doomed]
    statement = f"""
      BEGIN;
      SET LOCAL standard_conforming_strings=on;
      LOCK TABLE users,sessions,notes,mutations,follows,blocks,mutes,likes,replies,notifications,reports IN SHARE ROW EXCLUSIVE MODE;
      CREATE TEMP TABLE doomed ON COMMIT DROP AS
        SELECT u.id FROM users u JOIN jsonb_to_recordset({literal(json.dumps(expected))}::jsonb)
          AS x(id text,name text,salt text,password_hash text)
          ON (u.id,u.name,u.salt,u.password_hash)=(x.id,x.name,x.salt,x.password_hash);
      DO $$ BEGIN IF (SELECT count(*) FROM doomed)<>{len(doomed)} THEN
        RAISE EXCEPTION 'Account changed during review'; END IF; END $$;
      CREATE TEMP TABLE doomed_notes ON COMMIT DROP AS SELECT id FROM notes WHERE owner_id IN (SELECT id FROM doomed);
      CREATE TEMP TABLE doomed_replies ON COMMIT DROP AS SELECT id FROM replies
        WHERE user_id IN (SELECT id FROM doomed) OR note_id IN (SELECT id FROM doomed_notes);
      DELETE FROM notifications WHERE recipient_id IN (SELECT id FROM doomed) OR actor_id IN (SELECT id FROM doomed)
        OR note_id IN (SELECT id FROM doomed_notes) OR reply_id IN (SELECT id FROM doomed_replies);
      DELETE FROM reports WHERE reporter_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed)
        OR note_id IN (SELECT id FROM doomed_notes);
      DELETE FROM replies WHERE id IN (SELECT id FROM doomed_replies);
      DELETE FROM likes WHERE user_id IN (SELECT id FROM doomed) OR note_id IN (SELECT id FROM doomed_notes);
      DELETE FROM follows WHERE actor_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed);
      DELETE FROM blocks WHERE actor_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed);
      DELETE FROM mutes WHERE actor_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed);
      DELETE FROM mutations WHERE user_id IN (SELECT id FROM doomed) OR note_id IN (SELECT id FROM doomed_notes);
      DELETE FROM sessions WHERE user_id IN (SELECT id FROM doomed);
      DELETE FROM notes WHERE id IN (SELECT id FROM doomed_notes);
      DELETE FROM users WHERE id IN (SELECT id FROM doomed);
      COMMIT;
    """
    sql(args.database, statement)
    backup.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'Removed {len(doomed)} verified test accounts. Backup: {backup}')


class API:
    def __init__(self, base):
        self.base = base.rstrip('/')

    def call(self, path, method='GET', data=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(self.base + path, method=method, headers=headers,
                                         data=None if data is None else json.dumps(data).encode())
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None


def stable_id(key):
    return str(uuid.uuid5(NAMESPACE, key))


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(state, output, ensure_ascii=False, indent=2)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def validate(data):
    accounts = data['accounts']
    poems = data['poems']
    assert len(accounts) == len({a['username'] for a in accounts}) == 6
    assert len(poems) == len({p['sourcePage'] for p in poems}) == 36
    for a in accounts:
        assert '샘플' in a['bio'] and sum(p['account'] == a['username'] for p in poems) == 6
    for p in poems:
        assert p['text'].strip() and p['author'] == '김소월'
        assert p['sourceUrl'] == 'https://ko.wikisource.org/w/index.php?oldid=' + str(p['sourceRevision'])
        assert not any(mark in p['text'] for mark in ('<poem', '{{', '[[', '<ref'))


def note_body(poem, account, data):
    attribution = (f"김소월 · 『진달래꽃』(1925)\n"
                   f"출처: 위키문헌 · {poem['transcription']}\n{poem['sourceUrl']}\n"
                   f"원작: 퍼블릭 도메인 · 전사: 위키문헌 기여자, CC BY-SA 4.0\n{data['licenseUrl']}\n"
                   "본문 추출·마크업 및 주석 제거 · 샘플 큐레이션")
    return {'title': poem['title'], 'content': poem['text'] + '\n\n—\n' + attribution,
            'kind': 'text', 'items': [], 'color': account['color'], 'labels': [],
            'pinned': False, 'archived': False, 'trashed': False, 'sourceId': None, 'richText': None}


def seed(args):
    data = json.loads(DATA.read_text())
    validate(data)
    api = API(args.api)
    api.call('/health')
    state_path = Path(args.state)
    state = json.loads(state_path.read_text()) if state_path.exists() else {'api': api.base, 'accounts': {}}
    if state['api'] != api.base:
        raise RuntimeError('Use a separate --state file for each API/database.')
    sessions, notes = {}, {}
    try:
        for account in data['accounts']:
            username = account['username']
            if username not in state['accounts']:
                state['accounts'][username] = {'password': secrets.token_urlsafe(32)}
                save_state(state_path, state)  # Recover after a lost register response.
            entry = state['accounts'][username]
            credentials = {'username': username, 'password': entry['password']}
            try:
                session = api.call('/auth/login', 'POST', credentials)
            except urllib.error.HTTPError as error:
                if error.code != 401:
                    raise
                # A same-name account with a different password yields 409: never adopt it.
                session = api.call('/auth/register', 'POST', credentials)
            sessions[username] = session['token']
            if entry.get('id', session['user']['id']) != session['user']['id']:
                raise RuntimeError('Sample account identity changed; refusing to overwrite.')
            entry['id'] = session['user']['id']
            save_state(state_path, state)
            api.call('/social/profile', 'PUT', {k: account[k] for k in ('displayName', 'bio', 'avatar')}, session['token'])
            notes[username] = {n['id']: n for n in api.call('/notes', token=session['token'])}
        accounts = {a['username']: a for a in data['accounts']}
        # Interleave themes and put the most familiar poems near the top of the feed.
        ordered = [data['poems'][group * 6 + index] for index in reversed(range(6)) for group in range(6)]
        changed = 0
        for poem in ordered:
            token = sessions[poem['account']]
            nid = stable_id('poem:' + poem['sourcePage'])
            body = note_body(poem, accounts[poem['account']], data)
            n = notes[poem['account']].get(nid)
            if not n or n['body'] != body:
                n = api.call('/notes/' + nid, 'PUT', {'body': body, 'bodyFormat': 2,
                             'baseRevision': n['revision'] if n else 0, 'mutationId': str(uuid.uuid4())}, token)
                changed += 1
            if n['visibility'] != 'public':
                api.call('/notes/' + nid + '/visibility', 'PATCH', {'visibility': 'public',
                         'baseRevision': n['revision'], 'mutationId': str(uuid.uuid4())}, token)
        comments = [
            '꽃을 보내는 마음이 마지막 연에서 오래 남네요.',
            '고요한 밤에 소리 내어 읽어 보고 싶은 시예요.',
            '짧은 네 줄만으로 강가의 풍경이 떠올라요.',
            '잊었다는 말 뒤의 그리움을 다시 읽게 됩니다.',
            '길 위에서 잠시 멈춰 읽고 싶은 문장이네요.',
            '혼자 바라보는 풍경이 차분하게 다가와요.',
        ]
        for index, account in enumerate(data['accounts']):
            poem = data['poems'][index * 6]
            nid = stable_id('poem:' + poem['sourcePage'])
            reader = data['accounts'][(index + 1) % 6]['username']
            token = sessions[reader]
            api.call('/social/notes/' + nid + '/like', 'PUT', {'enabled': True}, token)
            api.call('/social/notes/' + nid + '/replies', 'POST', {
                'id': stable_id('reply:' + poem['sourcePage']), 'content': comments[index] + ' (샘플 감상)'}, token)
        print(f'Seeded 6 sample accounts, 36 poems, 6 likes and 6 replies. Changed note bodies: {changed}.')
        print(f'Private credentials/state: {state_path}')
    finally:
        for token in sessions.values():
            try:
                api.call('/auth/logout', 'POST', token=token)
            except (OSError, urllib.error.HTTPError):
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    clean = commands.add_parser('cleanup', help='Preview verified test accounts; --apply backs up and removes them')
    clean.add_argument('--database', default='host=127.0.0.1 port=55432 dbname=teum')
    clean.add_argument('--apply', action='store_true')
    load = commands.add_parser('seed', help='Create/update only the six managed poetry accounts through the API')
    load.add_argument('--api', default='http://127.0.0.1:8081/api')
    load.add_argument('--state', default=str(ROOT / '.data/poetry-demo-state.json'))
    commands.add_parser('validate', help='Validate the vendored poetry dataset without network or DB writes')
    args = parser.parse_args()
    if args.command == 'cleanup':
        cleanup(args)
    elif args.command == 'seed':
        seed(args)
    else:
        validate(json.loads(DATA.read_text()))
        print('PASS: six sample profiles, 36 unique attributed poems.')


if __name__ == '__main__':
    main()
