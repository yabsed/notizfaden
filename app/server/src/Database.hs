{-# LANGUAGE OverloadedStrings #-}
module Database (Env, openDatabase, db) where

import Control.Concurrent.MVar
import Control.Monad (void)
import Control.Monad.IO.Class (liftIO)
import Data.ByteString (ByteString)
import Database.PostgreSQL.Simple
import Servant (Handler)

newtype Env = Env (MVar Connection)
db :: Env -> (Connection -> IO a) -> Handler a
db (Env lock) action = liftIO $ withMVar lock action

openDatabase :: ByteString -> IO Env
openDatabase url = do
  connection <- connectPostgreSQL url
  schema connection
  Env <$> newMVar connection

schema :: Connection -> IO ()
schema c = withTransaction c $ do
  void $ execute_ c "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL)"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL)"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('private','public')),body JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL,published_at TIMESTAMPTZ)"
  void $ execute_ c "CREATE INDEX IF NOT EXISTS notes_owner ON notes(owner_id)"
  void $ execute_ c "CREATE INDEX IF NOT EXISTS notes_public ON notes(published_at DESC) WHERE visibility='public'"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS mutations(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,note_id TEXT NOT NULL,result JSONB NOT NULL,PRIMARY KEY(user_id,id))"
