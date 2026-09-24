{-# LANGUAGE DataKinds, TypeOperators, OverloadedStrings, DeriveGeneric, ScopedTypeVariables #-}
module Main where

import Control.Concurrent.MVar
import Control.Monad (unless, void)
import Control.Monad.IO.Class (liftIO)
import Crypto.Hash (Digest, SHA256, hash)
import Crypto.KDF.PBKDF2 (Parameters(..), fastPBKDF2_SHA256)
import Crypto.Random (getRandomBytes)
import Data.Aeson
import Data.Aeson.Types (Parser)
import Data.ByteArray (constEq)
import Data.ByteArray.Encoding (Base(Base16), convertToBase)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Char8 as B
import Data.Char (toLower, isAsciiLower, isDigit)
import Data.List (nub)
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Time
import qualified Data.UUID as UUID
import qualified Data.UUID.V4 as UUID
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Simple.FromRow
import Database.PostgreSQL.Simple.Newtypes (Aeson(..))
import Data.String (fromString)
import GHC.Generics
import Network.Wai (mapResponseHeaders)
import Network.Wai.Handler.Warp
import Network.Wai.Middleware.Cors
import Servant
import System.Environment (lookupEnv)
import Text.Read (readMaybe)

-- UI geometry is adapted from googlekeepclone; authorization follows memos'
-- principle that a note link never grants access to its other endpoint.
data Visibility = Private | Public deriving (Eq, Show)
instance ToJSON Visibility where toJSON Private = String "private"; toJSON Public = String "public"
instance FromJSON Visibility where
  parseJSON = withText "Visibility" $ \v -> case v of
    "private" -> pure Private
    "public" -> pure Public
    _ -> fail "Unsupported visibility"

opts :: Options
opts = defaultOptions { fieldLabelModifier = \s -> case drop 1 s of { c:cs -> toLower c:cs; [] -> [] } }
data Item = Item { iId :: Text, iText :: Text, iDone :: Bool } deriving (Generic, Show, Eq)
instance ToJSON Item where toJSON = genericToJSON opts
instance FromJSON Item where parseJSON = genericParseJSON opts

data NoteBody = NoteBody
  { nTitle :: Text, nContent :: Text, nKind :: Text, nItems :: [Item]
  , nColor :: Text, nLabels :: [Text], nPinned :: Bool, nArchived :: Bool
  , nTrashed :: Bool, nSourceId :: Maybe Text
  } deriving (Generic, Show, Eq)
instance ToJSON NoteBody where toJSON = genericToJSON opts
instance FromJSON NoteBody where parseJSON = genericParseJSON opts

data Save = Save { sBaseRevision :: Int, sMutationId :: Text, sBody :: NoteBody } deriving Generic
instance FromJSON Save where parseJSON = genericParseJSON opts

data Sharing = Sharing { vBaseRevision :: Int, vMutationId :: Text, vVisibility :: Visibility } deriving Generic
instance FromJSON Sharing where parseJSON = genericParseJSON opts

data Credentials = Credentials { cUsername :: Text, cPassword :: Text } deriving Generic
instance FromJSON Credentials where parseJSON = genericParseJSON opts

data User = User { uId :: Text, uName :: Text } deriving (Show, Generic)
instance ToJSON User where toJSON = genericToJSON opts
instance FromRow User where fromRow = User <$> field <*> field

data Note = Note Text Text Int Visibility NoteBody UTCTime Text
instance ToJSON Note where
  toJSON (Note ident owner rev visibility body updated name) = object
    ["id" .= ident, "author" .= User owner name, "revision" .= rev,
     "visibility" .= visibility, "body" .= body, "updatedAt" .= updated]
instance FromRow Note where
  fromRow = do
    ident <- field; owner <- field; rev <- field; visibility <- field
    Aeson body <- field; updated <- field; name <- field
    pure $ Note ident owner rev (if (visibility :: Text) == "public" then Public else Private) body updated name

newtype Env = Env (MVar Connection)
db :: Env -> (Connection -> IO a) -> Handler a
db (Env lock) action = liftIO $ withMVar lock action

err :: ServerError -> Text -> Handler a
err status message = throwError status {errBody = encode (object ["message" .= message]), errHeaders = [("Content-Type", "application/json")]}

randomHex :: Int -> IO Text
randomHex n = TE.decodeUtf8 . convertToBase Base16 <$> (getRandomBytes n :: IO BS.ByteString)
passwordHash :: Text -> Text -> BS.ByteString
passwordHash salt password = fastPBKDF2_SHA256 (Parameters 600000 32) (TE.encodeUtf8 password) (TE.encodeUtf8 salt)
tokenHash :: Text -> Text
tokenHash token = T.pack . show $ (hash (TE.encodeUtf8 token) :: Digest SHA256)

auth :: Env -> Maybe Text -> Handler User
auth env header = do
  token <- maybe (err err401 "로그인이 필요합니다.") pure (header >>= T.stripPrefix "Bearer ")
  users <- db env $ \c -> query c "SELECT u.id,u.name FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>now()" (Only $ tokenHash token)
  case users of [user] -> pure user; _ -> err err401 "로그인이 만료되었습니다. 다시 로그인해 주세요."

session :: Env -> User -> Handler Value
session env user = do
  token <- liftIO $ randomHex 32
  db env $ \c -> void $ execute c "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,now()+interval '30 days')" (tokenHash token, uId user)
  pure $ object ["token" .= token, "user" .= user]

register :: Env -> Credentials -> Handler Value
register env (Credentials raw password) = do
  let name = T.toLower $ T.strip raw
  unless (T.length name >= 3 && T.length name <= 30 && T.all (\c -> isAsciiLower c || isDigit c || c == '_') name) $ err err400 "아이디는 영문 소문자, 숫자, 밑줄로 3~30자입니다."
  unless (T.length password >= 10 && T.length password <= 128) $ err err400 "비밀번호는 10~128자로 입력해 주세요."
  ident <- liftIO $ UUID.toText <$> UUID.nextRandom
  salt <- liftIO $ randomHex 16
  let digest = TE.decodeUtf8 $ convertToBase Base16 (passwordHash salt password)
  created <- db env $ \c -> execute c "INSERT INTO users(id,name,salt,password_hash) VALUES (?,?,?,?) ON CONFLICT(name) DO NOTHING" (ident,name,salt,digest)
  if created == 0 then err err409 "이미 사용 중인 아이디입니다." else session env (User ident name)

login :: Env -> Credentials -> Handler Value
login env (Credentials name password) = do
  unless (T.length password <= 128 && T.length name <= 30) $ err err400 "입력값이 너무 깁니다."
  users <- db env $ \c -> query c "SELECT id,name,salt,password_hash FROM users WHERE name=?" (Only $ T.toLower $ T.strip name) :: IO [(Text,Text,Text,Text)]
  let (ident, uname, salt, expected) = case users of
        [row] -> row
        _ -> ("", "", "00000000000000000000000000000000", T.replicate 64 "0")
      actual = convertToBase Base16 (passwordHash salt password) :: BS.ByteString
  if actual `constEq` TE.encodeUtf8 expected && not (T.null ident)
    then session env (User ident uname)
    else err err401 "아이디 또는 비밀번호를 확인해 주세요."

logout :: Env -> Maybe Text -> Handler NoContent
logout env header = do
  _ <- auth env header
  let token = fromMaybe "" (header >>= T.stripPrefix "Bearer ")
  db env $ \c -> void $ execute c "DELETE FROM sessions WHERE token_hash=?" (Only $ tokenHash token)
  pure NoContent

noteSelect :: Query
noteSelect = "SELECT n.id,n.owner_id,n.revision,n.visibility,n.body,n.updated_at,u.name FROM notes n JOIN users u ON u.id=n.owner_id "

listOwn :: Env -> Maybe Text -> Handler [Note]
listOwn env header = do
  user <- auth env header
  db env $ \c -> query c (noteSelect <> "WHERE n.owner_id=? ORDER BY n.updated_at DESC") (Only $ uId user)

listPublic :: Env -> Handler [Note]
listPublic env = db env $ \c -> query_ c (noteSelect <> "WHERE n.visibility='public' AND NOT (n.body->>'trashed')::boolean ORDER BY n.published_at DESC LIMIT 100")

getPublic :: Env -> Text -> Handler Note
getPublic env ident = do
  rows <- db env $ \c -> query c (noteSelect <> "WHERE n.id=? AND n.visibility='public' AND NOT (n.body->>'trashed')::boolean") (Only ident)
  case rows of [n] -> pure n; _ -> err err404 "공개 메모를 찾을 수 없습니다."

validUUID :: Text -> Bool
validUUID = maybe False (const True) . UUID.fromText
validBody :: NoteBody -> Bool
validBody b = T.length (nTitle b) <= 300 && T.length (nContent b) <= 100000
  && nKind b `elem` ["text","checklist"]
  && nColor b `elem` ["default","red","orange","yellow","green","cyan","lightblue","purple","pink","brown","grey"]
  && length (nItems b) <= 500 && all (\i -> T.length (iText i) <= 3000 && validUUID (iId i)) (nItems b)
  && length (nub $ map iId $ nItems b) == length (nItems b)
  && length (nLabels b) <= 20 && all (\l -> not (T.null $ T.strip l) && T.length l <= 32) (nLabels b)

-- A mutation receipt lives in the same transaction as the write. A lost response
-- can be retried without incrementing the revision twice.
mutate :: Env -> User -> Text -> Text -> Int -> Maybe NoteBody -> Maybe Visibility -> Handler Note
mutate env user ident mutation base incoming sharing = do
  unless (validUUID ident && validUUID mutation && base >= 0) $ err err400 "잘못된 메모 요청입니다."
  result <- db env $ \c -> withTransaction c $ do
    -- Serializes even concurrent creation of a previously absent UUID.
    void (query c "SELECT pg_advisory_xact_lock(hashtext(?)) IS NULL" (Only ident) :: IO [Only Bool])
    receipts <- query c "SELECT result FROM mutations WHERE user_id=? AND id=? AND note_id=?" (uId user,mutation,ident) :: IO [Only (Aeson Value)]
    case receipts of
      [Only (Aeson value)] -> pure $ Left (Right value)
      _ -> do
        existing <- query c (noteSelect <> "WHERE n.id=? FOR UPDATE OF n") (Only ident)
        case existing of
          [current@(Note _ owner rev visibility old _ _)]
            | owner /= uId user -> pure $ Left (Left (404, Nothing))
            | base /= rev -> pure $ Left (Left (409, Just current))
            | otherwise -> write c (rev+1) (fromMaybe old incoming) (fromMaybe visibility sharing)
          [] | base == 0, Just body <- incoming, sharing == Nothing -> do
            sourceOK <- case nSourceId body of
              Nothing -> pure True
              Just src -> do
                allowed <- query c "SELECT id FROM notes WHERE id=? AND visibility='public' AND NOT (body->>'trashed')::boolean" (Only src) :: IO [Only Text]
                pure $ not (null allowed)
            if sourceOK then write c 1 body Private else pure $ Left (Left (404,Nothing))
          _ -> pure $ Left (Left (409, Nothing))
  case result of
    Right note -> pure note
    Left (Right value) -> case fromJSON value of
      Success note -> pure note
      Error _ -> err err500 "저장 결과를 읽을 수 없습니다."
    Left (Left (404,_)) -> err err404 "메모를 찾을 수 없습니다."
    Left (Left (_,current)) -> throwError err409 {errBody=encode $ object ["message" .= ("다른 기기에서 수정되었습니다." :: Text),"current" .= current], errHeaders=[("Content-Type","application/json")]}
  where
    write :: Connection -> Int -> NoteBody -> Visibility -> IO (Either (Either (Int, Maybe Note) Value) Note)
    write c rev body visibility = do
      let vis = if visibility == Public then ("public" :: Text) else "private"
      void $ execute c "INSERT INTO notes(id,owner_id,revision,visibility,body,updated_at,published_at) VALUES (?,?,?,?,?,now(),CASE WHEN ?='public' THEN now() ELSE NULL END) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,visibility=EXCLUDED.visibility,body=EXCLUDED.body,updated_at=now(),published_at=CASE WHEN notes.published_at IS NULL AND EXCLUDED.visibility='public' THEN now() ELSE notes.published_at END" (ident,uId user,rev,vis,Aeson body,vis)
      rows <- query c (noteSelect <> "WHERE n.id=?") (Only ident)
      case rows of
        [note] -> do
          void $ execute c "INSERT INTO mutations(user_id,id,note_id,result) VALUES (?,?,?,?)" (uId user,mutation,ident,Aeson $ toJSON note)
          pure $ Right note
        _ -> fail "Note missing after write"

instance FromJSON Note where
  parseJSON = withObject "Note" $ \o -> do
    User owner name <- o .: "author" >>= parseUser
    Note <$> o .: "id" <*> pure owner <*> o .: "revision" <*> o .: "visibility" <*> o .: "body" <*> o .: "updatedAt" <*> pure name
    where parseUser :: Value -> Parser User
          parseUser = withObject "User" $ \u -> User <$> u .: "id" <*> u .: "name"

saveNote :: Env -> Maybe Text -> Text -> Save -> Handler Note
saveNote env header ident request = do
  user <- auth env header
  unless (validBody $ sBody request) $ err err400 "메모의 길이나 형식을 확인해 주세요."
  mutate env user ident (sMutationId request) (sBaseRevision request) (Just $ sBody request) Nothing

shareNote :: Env -> Maybe Text -> Text -> Sharing -> Handler Note
shareNote env header ident request = do
  user <- auth env header
  mutate env user ident (vMutationId request) (vBaseRevision request) Nothing (Just $ vVisibility request)

type API = "api" :>
  ( "health" :> Get '[JSON] Value
  :<|> "auth" :> "register" :> ReqBody '[JSON] Credentials :> Post '[JSON] Value
  :<|> "auth" :> "login" :> ReqBody '[JSON] Credentials :> Post '[JSON] Value
  :<|> "auth" :> "logout" :> Header "Authorization" Text :> Post '[JSON] NoContent
  :<|> "me" :> Header "Authorization" Text :> Get '[JSON] User
  :<|> "notes" :> Header "Authorization" Text :> Get '[JSON] [Note]
  :<|> "notes" :> Header "Authorization" Text :> Capture "id" Text :> ReqBody '[JSON] Save :> Put '[JSON] Note
  :<|> "notes" :> Header "Authorization" Text :> Capture "id" Text :> "visibility" :> ReqBody '[JSON] Sharing :> Patch '[JSON] Note
  :<|> "public" :> Get '[JSON] [Note]
  :<|> "public" :> Capture "id" Text :> Get '[JSON] Note )

server :: Env -> Server API
server env = pure (object ["status" .= ("ok" :: Text)]) :<|> register env :<|> login env :<|> logout env :<|> auth env :<|> listOwn env :<|> saveNote env :<|> shareNote env :<|> listPublic env :<|> getPublic env

schema :: Connection -> IO ()
schema c = withTransaction c $ do
  void $ execute_ c "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL)"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL)"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),revision INTEGER NOT NULL,visibility TEXT NOT NULL CHECK(visibility IN ('private','public')),body JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL,published_at TIMESTAMPTZ)"
  void $ execute_ c "CREATE INDEX IF NOT EXISTS notes_owner ON notes(owner_id)"
  void $ execute_ c "CREATE INDEX IF NOT EXISTS notes_public ON notes(published_at DESC) WHERE visibility='public'"
  void $ execute_ c "CREATE TABLE IF NOT EXISTS mutations(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,note_id TEXT NOT NULL,result JSONB NOT NULL,PRIMARY KEY(user_id,id))"

main :: IO ()
main = do
  url <- fromMaybe "host=127.0.0.1 port=55432 dbname=teum" <$> lookupEnv "DATABASE_URL"
  port <- fromMaybe 8081 . (>>= readMaybe) <$> lookupEnv "PORT"
  host <- fromMaybe "127.0.0.1" <$> lookupEnv "BIND_HOST"
  origins <- map (B.pack . T.unpack . T.strip) . T.splitOn "," . T.pack . fromMaybe "http://localhost:5173,http://127.0.0.1:5173,https://localhost" <$> lookupEnv "ALLOWED_ORIGINS"
  connection <- connectPostgreSQL (B.pack url)
  schema connection
  env <- Env <$> newMVar connection
  let policy = simpleCorsResourcePolicy { corsOrigins=Just (origins,False), corsRequestHeaders=["Content-Type","Authorization"], corsMethods=["GET","POST","PUT","PATCH","OPTIONS"] }
      app :: Application
      app = cors (const $ Just policy) $ \req send -> serve (Proxy :: Proxy API) (server env) req (send . mapResponseHeaders (("Cache-Control","no-store"):))
  putStrLn $ "Notizfaden Haskell API listening on " ++ host ++ ":" ++ show port
  runSettings (setHost (fromString host) $ setPort port defaultSettings) app
