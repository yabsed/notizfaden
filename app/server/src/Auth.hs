{-# LANGUAGE OverloadedStrings #-}
module Auth (auth, register, login, logout) where

import Control.Monad (unless, void)
import Control.Monad.IO.Class (liftIO)
import Crypto.Hash (Digest, SHA256, hash)
import Crypto.KDF.PBKDF2 (Parameters(..), fastPBKDF2_SHA256)
import Crypto.Random (getRandomBytes)
import Data.Aeson (Value, object, (.=))
import Data.ByteArray (constEq)
import Data.ByteArray.Encoding (Base(Base16), convertToBase)
import qualified Data.ByteString as BS
import Data.Char (isAsciiLower, isDigit)
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Data.UUID as UUID
import qualified Data.UUID.V4 as UUID
import Database.PostgreSQL.Simple
import Servant
import Database (Env, db)
import Model

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
