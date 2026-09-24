{-# LANGUAGE OverloadedStrings #-}
module Notes (listOwn, listPublic, getPublic, saveNote, shareNote) where

import Control.Monad (unless, void)
import Data.Aeson
import Data.List (nub)
import Data.Maybe (fromMaybe)
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.UUID as UUID
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Simple.Newtypes (Aeson(..))
import Servant
import Auth (auth)
import Database (Env, db)
import Model

-- A public link never grants access to a related private note.
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

saveNote :: Env -> Maybe Text -> Text -> Save -> Handler Note
saveNote env header ident request = do
  user <- auth env header
  unless (validBody $ sBody request) $ err err400 "메모의 길이나 형식을 확인해 주세요."
  mutate env user ident (sMutationId request) (sBaseRevision request) (Just $ sBody request) Nothing

shareNote :: Env -> Maybe Text -> Text -> Sharing -> Handler Note
shareNote env header ident request = do
  user <- auth env header
  mutate env user ident (vMutationId request) (vBaseRevision request) Nothing (Just $ vVisibility request)
