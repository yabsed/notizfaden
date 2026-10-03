{-# LANGUAGE OverloadedStrings #-}
module Ordering (NoteOrder, getOrder, saveOrder) where

import Control.Monad (unless, void)
import Data.Aeson
import Data.Int (Int64)
import qualified Data.Set as Set
import Data.Maybe (isJust)
import Data.Text (Text)
import qualified Data.UUID as UUID
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Simple.Newtypes (Aeson(..))
import Servant
import Auth (auth)
import Database (Env, db)
import Model (User(..), err)

newtype NoteOrder = NoteOrder [Text]
instance FromJSON NoteOrder where
  parseJSON = withObject "NoteOrder" $ \o -> NoteOrder <$> o .: "ids"
instance ToJSON NoteOrder where
  toJSON (NoteOrder ids) = object ["ids" .= ids]

-- Personal notebook organization never changes a note revision/publication or
-- leaks into public notes. Concurrent device reorders use last accepted write.
getOrder :: Env -> Maybe Text -> Handler NoteOrder
getOrder env header = do
  user <- auth env header
  db env $ \c -> do
    rows <- query c "SELECT ids FROM note_order WHERE user_id=?" (Only $ uId user)
    pure $ case rows of
      [Only (Aeson ids)] -> NoteOrder ids
      _ -> NoteOrder []

saveOrder :: Env -> Maybe Text -> NoteOrder -> Handler NoteOrder
saveOrder env header order@(NoteOrder ids) = do
  user <- auth env header
  unless (length ids <= 10000 && Set.size (Set.fromList ids) == length ids && all (isJust . UUID.fromText) ids) $
    err err400 "메모 순서의 형식을 확인해 주세요."
  allowed <- db env $ \c -> withTransaction c $ do
    counts <- if null ids then pure [Only (0 :: Int64)] else
      query c "SELECT count(*) FROM notes WHERE owner_id=? AND id IN ?" (uId user, In ids)
    if counts /= [Only (fromIntegral $ length ids)] then pure False else do
      void $ execute c "INSERT INTO note_order(user_id,ids) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET ids=EXCLUDED.ids" (uId user,Aeson ids)
      pure True
  unless allowed $ err err400 "동기화된 내 메모만 정렬할 수 있어요."
  pure order
