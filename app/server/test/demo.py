"""Exercise cleanup on a disposable schema, including same-prefix real users and cross-user data."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace
import uuid

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('demo', root / 'scripts/demo.py')
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)
env = {**os.environ, 'PGHOST': '127.0.0.1', 'PGPORT': '55432'}
database = 'notizfaden_cleanup_' + uuid.uuid4().hex[:8] + '_test'
dsn = 'host=127.0.0.1 port=55432 dbname=' + database
schema = subprocess.check_output(['pg_dump', '-d', 'notizfaden_social_test', '--schema-only', '--no-owner'], env=env)
subprocess.run(['createdb', database], env=env, check=True)
try:
    subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database], input=schema, env=env, check=True, stdout=subprocess.DEVNULL)
    salt = 'fixed-test-salt'
    password_hash = hashlib.pbkdf2_hmac('sha256', b'teum-test-password-2026', salt.encode(), 600000).hex()
    demo.sql(dsn, f"""
      INSERT INTO users(id,name,salt,password_hash) VALUES
        ('test-user','test_123456abcdef','{salt}','{password_hash}'),
        ('real-user','ordinary_person','{salt}','{password_hash}'),
        ('collision-user','test_abcdef123456','different-salt','different-hash');
      INSERT INTO notes VALUES
        ('test-note','test-user',1,'public','{{"content":"test"}}',now(),now()),
        ('real-note','real-user',1,'public','{{"content":"preserve copied text","sourceId":"test-note"}}',now(),now());
      INSERT INTO replies(id,user_id,note_id,content) VALUES
        ('cross-reply','real-user','test-note','real reply to test'),
        ('test-reply','test-user','real-note','test reply to real'),
        ('real-reply','real-user','real-note','preserve');
      INSERT INTO likes VALUES ('test-user','real-note'),('real-user','test-note'),('real-user','real-note');
      INSERT INTO notifications(recipient_id,actor_id,kind,note_id,reply_id,event_key) VALUES
        ('test-user','real-user','reply','test-note','cross-reply','cross'),
        ('real-user','test-user','reply','real-note','test-reply','test'),
        ('real-user','real-user','reply','real-note','real-reply','real');
      INSERT INTO reports(reporter_id,target_id,note_id,reason) VALUES ('real-user','test-user','test-note','test');
      INSERT INTO follows VALUES ('real-user','test-user',now()),('test-user','real-user',now());
      INSERT INTO blocks VALUES ('test-user','collision-user');
      INSERT INTO mutes VALUES ('collision-user','test-user');
      INSERT INTO sessions VALUES ('test-session','test-user',now());
      INSERT INTO mutations VALUES ('test-user','mutation','test-note','{{}}');
    """)
    snapshot = demo.sql(dsn, "SELECT row_to_json(n) FROM notes n WHERE id='real-note'")
    demo.cleanup(SimpleNamespace(database=dsn, apply=False))
    assert demo.sql(dsn, 'SELECT count(*) FROM users') == '3', 'preview must not delete'
    demo.cleanup(SimpleNamespace(database=dsn, apply=True))
    assert json.loads(demo.sql(dsn, 'SELECT json_agg(name ORDER BY name) FROM users')) == ['ordinary_person', 'test_abcdef123456']
    assert demo.sql(dsn, "SELECT row_to_json(n) FROM notes n WHERE id='real-note'") == snapshot
    for table in ('notes', 'likes', 'replies', 'notifications'):
        assert demo.sql(dsn, f'SELECT count(*) FROM {table}') == '1', table
    for table in ('reports', 'follows', 'blocks', 'mutes', 'sessions', 'mutations'):
        assert demo.sql(dsn, f'SELECT count(*) FROM {table}') == '0', table
    demo.cleanup(SimpleNamespace(database=dsn, apply=True))
    print('PASS: cleanup preview, exact credentials, name collisions, cross-user references, preserved copies, rerun.')
finally:
    subprocess.run(['dropdb', database], env=env, check=True)
