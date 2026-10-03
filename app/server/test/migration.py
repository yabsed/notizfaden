"""Verify migration from the pre-SNS schema in a temporary PostgreSQL database.
Needs the local PostgreSQL CLI and compiled server. Never touches the app database.
"""
import json, os, signal, subprocess, time, urllib.request, uuid
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
NAME = 'notizfaden_migration_' + uuid.uuid4().hex[:10]
HOST = os.getenv('PGHOST', '127.0.0.1')
PORT = os.getenv('PGPORT', '55432')
API_PORT = os.getenv('NOTIZFADEN_MIGRATION_PORT', '8083')
conn = ['-h', HOST, '-p', PORT]
def sql(text):
    return subprocess.check_output(['psql', *conn, '-d', NAME, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', text], text=True).strip()

def legacy_snapshot():
    # New profile columns are intentionally excluded; all original data must match.
    return sql("SELECT jsonb_build_object('users',(SELECT jsonb_agg(jsonb_build_array(id,name,salt,password_hash)) FROM users),'notes',(SELECT jsonb_agg(to_jsonb(n)) FROM notes n),'sessions',(SELECT jsonb_agg(to_jsonb(s)) FROM sessions s),'mutations',(SELECT jsonb_agg(to_jsonb(m)) FROM mutations m))")

subprocess.run(['createdb', *conn, NAME], check=True)
process = None
try:
    sql("""
      CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE notes(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('private','public')),body JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL,published_at TIMESTAMPTZ);
      CREATE TABLE mutations(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,note_id TEXT NOT NULL,result JSONB NOT NULL,PRIMARY KEY(user_id,id));
      INSERT INTO users VALUES ('legacy-user','legacy_user','existing-salt','existing-password-hash');
      INSERT INTO sessions VALUES ('existing-token-hash','legacy-user','2030-01-01');
      INSERT INTO notes VALUES ('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','legacy-user',7,'public','{"title":"기존 메모","content":"보존할 내용","kind":"text","items":[],"color":"yellow","labels":["개인라벨"],"pinned":true,"archived":false,"trashed":false,"sourceId":null}','2026-01-02','2026-01-01');
      INSERT INTO mutations VALUES ('legacy-user','existing-mutation','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','{"receipt":"preserve"}');
    """)
    before = legacy_snapshot()
    for _ in range(2):
        env = {**os.environ, 'PORT': API_PORT, 'DATABASE_URL': f'host={HOST} port={PORT} dbname={NAME}'}
        process = subprocess.Popen(['bash', str(APP / 'scripts/server.sh')], cwd=APP, env=env, start_new_session=True, stdout=subprocess.DEVNULL)
        for attempt in range(100):
            if process.poll() is not None: raise AssertionError('Migration server exited')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{API_PORT}/api/health', timeout=1) as response:
                    assert json.load(response)['status'] == 'ok'
                break
            except OSError: time.sleep(.1)
        else: raise AssertionError('Migration server did not start')
        assert before == legacy_snapshot(), 'Original users, credentials, notes, revisions, timestamps and receipts must survive'
        assert sql('SELECT count(*) FROM schema_migrations WHERE version=1') == '1'
        with urllib.request.urlopen(f'http://127.0.0.1:{API_PORT}/api/social/feed') as response:
            posts = json.load(response)['items']
        assert len(posts) == 1 and posts[0]['note']['revision'] == 7
        assert posts[0]['note']['body']['labels'] == ['개인라벨']
        os.killpg(process.pid, signal.SIGTERM); process.wait(timeout=10); process = None
    print('PASS: legacy data/credentials preserved, existing public link available, migration applied once across restarts')
finally:
    if process is not None and process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM); process.wait(timeout=10)
    subprocess.run(['dropdb', *conn, NAME], check=True)
