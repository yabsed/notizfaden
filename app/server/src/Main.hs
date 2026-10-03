{-# LANGUAGE DataKinds, TypeOperators, OverloadedStrings #-}
module Main where

import Data.Aeson (Value, object, (.=))
import qualified Data.ByteString.Char8 as B
import Data.Maybe (fromMaybe)
import Data.String (fromString)
import Data.Text (Text)
import qualified Data.Text as T
import Network.Wai (mapResponseHeaders)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Servant
import System.Environment (lookupEnv)
import Text.Read (readMaybe)
import Auth
import Database (Env, openDatabase, db)
import Database.PostgreSQL.Simple (Only(..), query_)
import Model
import Notes
import Social

type API = "api" :> (NoteAPI :<|> SocialAPI)

type NoteAPI =
  ( "health" :> Get '[JSON] Value
  :<|> "auth" :> "register" :> ReqBody '[JSON] Credentials :> Post '[JSON] Value
  :<|> "auth" :> "login" :> ReqBody '[JSON] Credentials :> Post '[JSON] Value
  :<|> "auth" :> "logout" :> Header "Authorization" Text :> Post '[JSON] NoContent
  :<|> "me" :> Header "Authorization" Text :> Get '[JSON] User
  :<|> "notes" :> Header "Authorization" Text :> Get '[JSON] [Note]
  :<|> "notes" :> Header "Authorization" Text :> Capture "id" Text :> ReqBody '[JSON] Save :> Put '[JSON] Note
  :<|> "notes" :> Header "Authorization" Text :> Capture "id" Text :> "visibility" :> ReqBody '[JSON] Sharing :> Patch '[JSON] Note
  :<|> "public" :> Header "Authorization" Text :> Get '[JSON] [Note]
  :<|> "public" :> Header "Authorization" Text :> Capture "id" Text :> Get '[JSON] Note )

server :: Env -> Server API
server env = noteServer env :<|> socialServer env

noteServer :: Env -> Server NoteAPI
noteServer env = health env :<|> register env :<|> login env :<|> logout env :<|> auth env :<|> listOwn env :<|> saveNote env :<|> shareNote env :<|> listPublic env :<|> getPublic env

-- Test clients must check the actual database, even when a proxy is misconfigured.
health :: Env -> Handler Value
health env = db env $ \c -> do
  names <- query_ c "SELECT current_database()" :: IO [Only Text]
  let isolated = case names of
        [Only name] -> "_test" `T.isSuffixOf` name
        _ -> False
  pure $ object ["status" .= ("ok" :: Text), "testDatabase" .= isolated]

main :: IO ()
main = do
  url <- fromMaybe "host=127.0.0.1 port=55432 dbname=teum" <$> lookupEnv "DATABASE_URL"
  port <- fromMaybe 8081 . (>>= readMaybe) <$> lookupEnv "PORT"
  host <- fromMaybe "127.0.0.1" <$> lookupEnv "BIND_HOST"
  origins <- map (B.pack . T.unpack . T.strip) . T.splitOn "," . T.pack . fromMaybe "http://localhost:5173,http://127.0.0.1:5173,https://localhost" <$> lookupEnv "ALLOWED_ORIGINS"
  env <- openDatabase (B.pack url)
  let policy = simpleCorsResourcePolicy { corsOrigins=Just (origins,False), corsRequestHeaders=["Content-Type","Authorization"], corsMethods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"] }
      app :: Application
      app = cors (const $ Just policy) $ \req send -> serve (Proxy :: Proxy API) (server env) req (send . mapResponseHeaders (("Cache-Control","no-store"):))
  putStrLn $ "Notizfaden Haskell API listening on " ++ host ++ ":" ++ show port
  runSettings (setHost (fromString host) $ setPort port defaultSettings) app
