{-# LANGUAGE OverloadedStrings #-}
module Database (Env, openDatabase, db) where

import Control.Concurrent.Chan
import Control.Exception (bracket)
import Control.Monad (void, replicateM_)
import Control.Monad.IO.Class (liftIO)
import Data.ByteString (ByteString)
import Database.PostgreSQL.Simple
import Servant (Handler)

newtype Env = Env (Chan Connection)
db :: Env -> (Connection -> IO a) -> Handler a
db (Env pool) action = liftIO $ bracket (readChan pool) (writeChan pool) action

openDatabase :: ByteString -> IO Env
openDatabase url = do
  connection <- connectPostgreSQL url
  schema connection
  pool <- newChan
  writeChan pool connection
  replicateM_ 3 (connectPostgreSQL url >>= writeChan pool)
  pure (Env pool)

schema :: Connection -> IO ()
schema c = withTransaction c $ do
  void (query_ c "SELECT pg_advisory_xact_lock(72649321) IS NULL" :: IO [Only Bool])
  void $ execute_ c "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL)"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL)"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('private','public')),body JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL,published_at TIMESTAMPTZ)"
  void $ execute_ c "CREATE INDEX IF NOT EXISTS notes_owner ON notes(owner_id)"
  void $ execute_ c "CREATE INDEX IF NOT EXISTS notes_public ON notes(published_at DESC) WHERE visibility='public'"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS mutations(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,note_id TEXT NOT NULL,result JSONB NOT NULL,PRIMARY KEY(user_id,id))"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
  versions <- query_ c "SELECT version FROM schema_migrations WHERE version=1" :: IO [Only Int]
  if not (null versions) then pure () else do
    void $ execute_ c "ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '', ADD COLUMN bio TEXT NOT NULL DEFAULT '', ADD COLUMN avatar TEXT NOT NULL DEFAULT ''"
    void $ execute_ c "CREATE TABLE follows(actor_id TEXT NOT NULL REFERENCES users(id),target_id TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,target_id),CHECK(actor_id<>target_id))"
    void $ execute_ c "CREATE INDEX follows_target ON follows(target_id)"
    void $ execute_ c "CREATE TABLE blocks(actor_id TEXT NOT NULL REFERENCES users(id),target_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(actor_id,target_id),CHECK(actor_id<>target_id))"
    void $ execute_ c "CREATE TABLE mutes(actor_id TEXT NOT NULL REFERENCES users(id),target_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(actor_id,target_id),CHECK(actor_id<>target_id))"
    void $ execute_ c "CREATE TABLE likes(user_id TEXT NOT NULL REFERENCES users(id),note_id TEXT NOT NULL REFERENCES notes(id),PRIMARY KEY(user_id,note_id))"
    void $ execute_ c "CREATE INDEX likes_note ON likes(note_id)"
    void $ execute_ c "CREATE TABLE replies(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),note_id TEXT NOT NULL REFERENCES notes(id),content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),deleted BOOLEAN NOT NULL DEFAULT false)"
    void $ execute_ c "CREATE INDEX replies_note ON replies(note_id,created_at,id)"
    void $ execute_ c "CREATE TABLE notifications(id BIGSERIAL PRIMARY KEY,recipient_id TEXT NOT NULL REFERENCES users(id),actor_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('follow','like','reply')),note_id TEXT REFERENCES notes(id),reply_id TEXT REFERENCES replies(id),event_key TEXT NOT NULL UNIQUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),read_at TIMESTAMPTZ)"
    void $ execute_ c "CREATE INDEX notifications_recipient ON notifications(recipient_id,id DESC)"
    void $ execute_ c "CREATE TABLE reports(id BIGSERIAL PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id),target_id TEXT NOT NULL REFERENCES users(id),note_id TEXT REFERENCES notes(id),reason TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved BOOLEAN NOT NULL DEFAULT false)"
    void $ execute_ c "CREATE INDEX notes_social_feed ON notes(published_at DESC,id DESC) WHERE visibility='public'"
    void $ execute_ c "INSERT INTO schema_migrations(version) VALUES (1)"
