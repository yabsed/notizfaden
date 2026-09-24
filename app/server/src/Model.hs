{-# LANGUAGE OverloadedStrings, DeriveGeneric #-}
module Model
  ( Visibility(..), Item(..), NoteBody(..), Save(..), Sharing(..)
  , Credentials(..), User(..), Note(..), err
  ) where

import Data.Aeson
import Data.Aeson.Types (Parser)
import Data.Char (toLower)
import Data.Text (Text)
import Data.Time (UTCTime)
import Database.PostgreSQL.Simple.FromRow
import Database.PostgreSQL.Simple.Newtypes (Aeson(..))
import GHC.Generics (Generic)
import Servant (Handler, ServerError(..), throwError)

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

instance FromJSON Note where
  parseJSON = withObject "Note" $ \o -> do
    User owner name <- o .: "author" >>= parseUser
    Note <$> o .: "id" <*> pure owner <*> o .: "revision" <*> o .: "visibility" <*> o .: "body" <*> o .: "updatedAt" <*> pure name
    where parseUser :: Value -> Parser User
          parseUser = withObject "User" $ \u -> User <$> u .: "id" <*> u .: "name"

err :: ServerError -> Text -> Handler a
err status message = throwError status {errBody = encode (object ["message" .= message]), errHeaders = [("Content-Type", "application/json")]}
