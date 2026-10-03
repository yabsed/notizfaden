{-# LANGUAGE DataKinds, TypeOperators, OverloadedStrings #-}
module Social (SocialAPI, socialServer, optionalUser, blocked) where

import Control.Monad (unless, when, void, forM)
import Control.Monad.IO.Class (liftIO)
import Data.Aeson
import Data.Int (Int64)
import Data.Maybe (fromMaybe, isJust)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time (UTCTime, defaultTimeLocale, formatTime)
import Data.Time.Format.ISO8601 (iso8601ParseM)
import qualified Data.UUID as UUID
import Database.PostgreSQL.Simple
import Database.PostgreSQL.Simple.Newtypes (Aeson(..))
import Database.PostgreSQL.Simple.ToField (toField)
import Servant
import System.Environment (lookupEnv)
import Auth (auth)
import Database (Env, db)
import Model

data ProfileInput = ProfileInput Text Text Text
instance FromJSON ProfileInput where
  parseJSON = withObject "Profile" $ \o -> ProfileInput <$> o .: "displayName" <*> o .: "bio" <*> o .: "avatar"
newtype Flag = Flag Bool
instance FromJSON Flag where parseJSON = withObject "Flag" $ \o -> Flag <$> o .: "enabled"
data ReplyInput = ReplyInput Text Text
instance FromJSON ReplyInput where parseJSON = withObject "Reply" $ \o -> ReplyInput <$> o .: "id" <*> o .: "content"
data ReportInput = ReportInput Text (Maybe Text)
instance FromJSON ReportInput where parseJSON = withObject "Report" $ \o -> ReportInput <$> o .: "reason" <*> o .:? "noteId"

type SocialAPI = "social" :> Header "Authorization" Text :>
  ( "feed" :> QueryParam "following" Bool :> QueryParam "author" Text :> QueryParam "q" Text :> QueryParam "cursor" Text :> Get '[JSON] Value
  :<|> "people" :> QueryParam "q" Text :> Get '[JSON] [Value]
  :<|> "profiles" :> Capture "id" Text :> Get '[JSON] Value
  :<|> "profile" :> ReqBody '[JSON] ProfileInput :> Put '[JSON] Value
  :<|> "profiles" :> Capture "id" Text :> Capture "relationship" Text :> ReqBody '[JSON] Flag :> Put '[JSON] Value
  :<|> "profiles" :> Capture "id" Text :> "connections" :> QueryParam "kind" Text :> Get '[JSON] [Value]
  :<|> "notes" :> Capture "id" Text :> Get '[JSON] Value
  :<|> "notes" :> Capture "id" Text :> "like" :> ReqBody '[JSON] Flag :> Put '[JSON] Value
  :<|> "notes" :> Capture "id" Text :> "replies" :> QueryParam "cursor" Text :> Get '[JSON] Value
  :<|> "notes" :> Capture "id" Text :> "replies" :> ReqBody '[JSON] ReplyInput :> Post '[JSON] Value
  :<|> "notes" :> Capture "id" Text :> "replies" :> Capture "reply" Text :> DeleteNoContent
  :<|> "notifications" :> QueryParam "cursor" Int64 :> Get '[JSON] Value
  :<|> "notifications" :> Capture "through" Int64 :> PutNoContent
  :<|> "profiles" :> Capture "id" Text :> "report" :> ReqBody '[JSON] ReportInput :> PostNoContent
  :<|> "admin" :> "reports" :> Get '[JSON] [Value]
  :<|> "admin" :> "reports" :> Capture "id" Int64 :> ReqBody '[JSON] Flag :> PutNoContent
  )

socialServer :: Env -> Server SocialAPI
socialServer env header = feed env header :<|> people env header :<|> getProfile env header :<|> editProfile env header
  :<|> relationship env header :<|> connections env header :<|> getPost env header :<|> like env header
  :<|> replies env header :<|> reply env header :<|> deleteReply env header :<|> notifications env header
  :<|> readNotifications env header :<|> report env header :<|> reports env header :<|> resolveReport env header

optionalUser :: Env -> Maybe Text -> Handler Text
optionalUser _ Nothing = pure ""
optionalUser env h = uId <$> auth env h

blocked :: Connection -> Text -> Text -> IO Bool
blocked c a b = do
  [Only yes] <- query c "SELECT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=? AND target_id=?) OR (actor_id=? AND target_id=?))" (a,b,b,a)
  pure yes

jsonRows :: ToRow p => Connection -> Query -> p -> IO [Value]
jsonRows c sql p = map (\(Only (Aeson v)) -> v) <$> query c sql p

profile :: Connection -> Text -> Text -> IO Value
profile c viewer ident = do
  rows <- jsonRows c "SELECT jsonb_build_object('id',u.id,'name',u.name,'displayName',u.display_name,'bio',u.bio,'avatar',u.avatar,'followers',(SELECT count(*) FROM follows WHERE target_id=u.id),'followingCount',(SELECT count(*) FROM follows WHERE actor_id=u.id),'posts',(SELECT count(*) FROM notes WHERE owner_id=u.id AND visibility='public' AND NOT (body->>'trashed')::boolean),'following',EXISTS(SELECT 1 FROM follows WHERE actor_id=v.id AND target_id=u.id),'blocked',EXISTS(SELECT 1 FROM blocks WHERE actor_id=v.id AND target_id=u.id),'blockedBy',EXISTS(SELECT 1 FROM blocks WHERE actor_id=u.id AND target_id=v.id),'muted',EXISTS(SELECT 1 FROM mutes WHERE actor_id=v.id AND target_id=u.id)) FROM users u CROSS JOIN (SELECT ?::text id) v WHERE u.id=?" (viewer,ident)
  pure $ case rows of [v] -> v; _ -> Null

noteQuery :: Query
noteQuery = "SELECT n.id,n.owner_id,n.revision,n.visibility,n.body,n.updated_at,u.name FROM notes n JOIN users u ON u.id=n.owner_id "

readable :: Connection -> Text -> Text -> IO (Maybe Note)
readable c viewer ident = do
  ns <- query c (noteQuery <> "WHERE n.id=? AND n.visibility='public' AND NOT (n.body->>'trashed')::boolean FOR SHARE OF n") (Only ident)
  case ns of
    [n@(Note _ owner _ _ _ _ _)] -> do
      denied <- blocked c viewer owner
      pure $ if denied then Nothing else Just n
    _ -> pure Nothing

withPost :: Env -> Text -> Text -> (Connection -> Note -> IO a) -> Handler a
withPost env viewer ident action = do
  result <- db env $ \c -> withTransaction c $ do
    n <- readable c viewer ident
    traverse (action c) n
  maybe (err err404 "공개 메모를 찾을 수 없습니다.") pure result

post :: Connection -> Text -> Note -> IO Value
post c viewer n@(Note ident owner _ _ _ _ _) = do
  author <- profile c viewer owner
  [(likes, repliesCount, liked, published)] <- query c "SELECT (SELECT count(*) FROM likes WHERE note_id=?),(SELECT count(*) FROM replies r WHERE r.note_id=? AND NOT r.deleted AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=? AND b.target_id=r.user_id) OR (b.target_id=? AND b.actor_id=r.user_id)) AND NOT EXISTS(SELECT 1 FROM mutes m WHERE m.actor_id=? AND m.target_id=r.user_id)),EXISTS(SELECT 1 FROM likes WHERE note_id=? AND user_id=?),published_at FROM notes WHERE id=?" (ident,ident,viewer,viewer,viewer,ident,viewer,ident) :: IO [(Int64,Int64,Bool,Maybe UTCTime)]
  pure $ object ["note" .= publicNote n,"profile" .= author,"likes" .= likes,"replies" .= repliesCount,"liked" .= liked,"publishedAt" .= published]

parseCursor :: Maybe Text -> Handler (Maybe UTCTime,Text)
parseCursor Nothing = pure (Nothing, "")
parseCursor (Just cursor) = do
  let (time, rest) = T.breakOn "|" cursor
      ident = T.drop 1 rest
  case (iso8601ParseM (T.unpack time) :: Maybe UTCTime, UUID.fromText ident) of
    (Just t, Just _) -> pure (Just t, ident)
    _ -> err err400 "잘못된 페이지 요청입니다."

cursorFor :: UTCTime -> Text -> Text
cursorFor t ident = T.pack (formatTime defaultTimeLocale "%Y-%m-%dT%H:%M:%S%QZ" t) <> "|" <> ident

feed :: Env -> Maybe Text -> Maybe Bool -> Maybe Text -> Maybe Text -> Maybe Text -> Handler Value
feed env h following author search cursor = do
  viewer <- optionalUser env h
  (before, ident) <- parseCursor cursor
  db env $ \c -> withTransaction c $ do
    ns <- query c (noteQuery <> "WHERE n.visibility='public' AND NOT (n.body->>'trashed')::boolean AND (?=false OR n.owner_id=? OR EXISTS(SELECT 1 FROM follows WHERE actor_id=? AND target_id=n.owner_id)) AND (?::text IS NULL OR n.owner_id=?) AND position(lower(?) in lower(concat(n.body->>'title',' ',n.body->>'content',' ',n.body->'items',' ',u.name,' ',u.display_name)))>0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=? AND b.target_id=n.owner_id) OR (b.target_id=? AND b.actor_id=n.owner_id)) AND NOT EXISTS(SELECT 1 FROM mutes m WHERE m.actor_id=? AND m.target_id=n.owner_id) AND (?::timestamptz IS NULL OR (n.published_at,n.id)<(?,?)) ORDER BY n.published_at DESC,n.id DESC LIMIT 31") [toField (fromMaybe False following),toField viewer,toField viewer,toField author,toField author,toField (T.take 100 $ fromMaybe "" search),toField viewer,toField viewer,toField viewer,toField before,toField before,toField ident]
    items <- mapM (post c viewer) (take 30 ns)
    next <- if length ns <= 30 then pure Nothing else case last (take 30 ns) of
      Note nid _ _ _ _ _ _ -> do
        [Only t] <- query c "SELECT published_at FROM notes WHERE id=?" (Only nid)
        pure $ Just (cursorFor t nid)
    pure $ object ["items" .= items,"cursor" .= next]

people :: Env -> Maybe Text -> Maybe Text -> Handler [Value]
people env h search = do
  viewer <- optionalUser env h
  db env $ \c -> do
    ids <- query c "SELECT u.id FROM users u WHERE position(lower(?) in lower(u.name || ' ' || u.display_name))>0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.actor_id=u.id AND b.target_id=?) ORDER BY u.name LIMIT 40" (T.take 100 $ fromMaybe "" search,viewer)
    mapM (\(Only ident) -> profile c viewer ident) ids

getProfile :: Env -> Maybe Text -> Text -> Handler Value
getProfile env h ident = do
  viewer <- optionalUser env h
  result <- db env $ \c -> profile c viewer ident
  if result == Null then err err404 "사용자를 찾을 수 없습니다." else pure result

editProfile :: Env -> Maybe Text -> ProfileInput -> Handler Value
editProfile env h (ProfileInput name bio avatar) = do
  user <- auth env h
  unless (T.length (T.strip name) <= 40 && T.length bio <= 300 && avatar `elem` ["","🌱","🌼","🌙","🍊","🐈","🐻","🪴","☕","🌊","📚"]) $ err err400 "이름은 40자, 소개는 300자까지 입력할 수 있어요."
  db env $ \c -> do
    void $ execute c "UPDATE users SET display_name=?,bio=?,avatar=? WHERE id=?" (T.strip name,bio,avatar,uId user)
    profile c (uId user) (uId user)

emit :: Connection -> Text -> Text -> Text -> Maybe Text -> Maybe Text -> Text -> IO ()
emit c recipient actor kind noteId replyId key = when (recipient /= actor) $ do
  void $ execute c "INSERT INTO notifications(recipient_id,actor_id,kind,note_id,reply_id,event_key) VALUES (?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING" (recipient,actor,kind,noteId,replyId,key)

relationship :: Env -> Maybe Text -> Text -> Text -> Flag -> Handler Value
relationship env h target kind (Flag enabled) = do
  user <- auth env h
  let actor = uId user
  unless (actor /= target && kind `elem` ["follow","block","mute"]) $ err err400 "잘못된 관계 요청입니다."
  result <- db env $ \c -> withTransaction c $ do
    -- All relationship changes for a pair share a lock, including block/follow races.
    void (query c "SELECT pg_advisory_xact_lock(hashtext(?)) IS NULL" (Only $ T.intercalate ":" $ if actor < target then [actor,target] else [target,actor]) :: IO [Only Bool])
    p <- profile c actor target
    denied <- blocked c actor target
    if p == Null || (kind == "follow" && enabled && denied) then pure Nothing else do
      let table = case kind of "follow" -> "follows"; "block" -> "blocks"; _ -> "mutes"
      if enabled then void $ execute c ("INSERT INTO " <> table <> "(actor_id,target_id) VALUES (?,?) ON CONFLICT DO NOTHING") (actor,target)
        else void $ execute c ("DELETE FROM " <> table <> " WHERE actor_id=? AND target_id=?") (actor,target)
      when (kind == "block" && enabled) $ do
        void $ execute c "DELETE FROM follows WHERE (actor_id=? AND target_id=?) OR (actor_id=? AND target_id=?)" (actor,target,target,actor)
        void $ execute c "DELETE FROM notifications WHERE kind='follow' AND ((actor_id=? AND recipient_id=?) OR (actor_id=? AND recipient_id=?))" (actor,target,target,actor)
      when (kind == "follow") $ if enabled
        then emit c target actor "follow" Nothing Nothing ("follow:"<>actor<>":"<>target)
        else void $ execute c "DELETE FROM notifications WHERE event_key=?" (Only $ "follow:"<>actor<>":"<>target)
      Just <$> profile c actor target
  maybe (err err404 "사용자를 찾을 수 없거나 연결할 수 없습니다.") pure result

connections :: Env -> Maybe Text -> Text -> Maybe Text -> Handler [Value]
connections env h target kind = do
  viewer <- optionalUser env h
  db env $ \c -> do
    denied <- blocked c viewer target
    if denied then pure [] else do
      let sql = if kind == Just "following" then "SELECT target_id FROM follows WHERE actor_id=? ORDER BY created_at DESC LIMIT 100" else "SELECT actor_id FROM follows WHERE target_id=? ORDER BY created_at DESC LIMIT 100"
      ids <- query c sql (Only target)
      values <- forM ids $ \(Only ident) -> do
        hidden <- blocked c viewer ident
        if hidden then pure Null else profile c viewer ident
      pure (filter (/=Null) values)

getPost :: Env -> Maybe Text -> Text -> Handler Value
getPost env h ident = do
  viewer <- optionalUser env h
  withPost env viewer ident (\c n -> post c viewer n)

like :: Env -> Maybe Text -> Text -> Flag -> Handler Value
like env h ident (Flag enabled) = do
  user <- auth env h
  let actor = uId user
  withPost env actor ident $ \c n@(Note _ owner _ _ _ _ _) -> do
    if enabled then do
      void $ execute c "INSERT INTO likes(user_id,note_id) VALUES (?,?) ON CONFLICT DO NOTHING" (actor,ident)
      emit c owner actor "like" (Just ident) Nothing ("like:"<>actor<>":"<>ident)
    else do
      void $ execute c "DELETE FROM likes WHERE user_id=? AND note_id=?" (actor,ident)
      void $ execute c "DELETE FROM notifications WHERE event_key=?" (Only $ "like:"<>actor<>":"<>ident)
    post c actor n

replyValue :: Connection -> Text -> Text -> IO Value
replyValue c viewer ident = do
  [(owner,content,time)] <- query c "SELECT user_id,content,created_at FROM replies WHERE id=?" (Only ident) :: IO [(Text,Text,UTCTime)]
  author <- profile c viewer owner
  pure $ object ["id" .= ident,"content" .= content,"createdAt" .= time,"profile" .= author]

replies :: Env -> Maybe Text -> Text -> Maybe Text -> Handler Value
replies env h ident cursor = do
  viewer <- optionalUser env h
  (after,cid) <- parseCursor cursor
  withPost env viewer ident $ \c _ -> do
    rows <- query c "SELECT r.id,r.created_at FROM replies r WHERE r.note_id=? AND NOT r.deleted AND (?::timestamptz IS NULL OR (r.created_at,r.id)>(?,?)) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=? AND b.target_id=r.user_id) OR (b.target_id=? AND b.actor_id=r.user_id)) AND NOT EXISTS(SELECT 1 FROM mutes WHERE actor_id=? AND target_id=r.user_id) ORDER BY r.created_at,r.id LIMIT 31" (ident,after,after,cid,viewer,viewer,viewer) :: IO [(Text,UTCTime)]
    values <- mapM (replyValue c viewer . fst) (take 30 rows)
    let next = if length rows <= 30 then Nothing else let (rid,t) = last (take 30 rows) in Just (cursorFor t rid)
    pure $ object ["items" .= values,"cursor" .= next]

reply :: Env -> Maybe Text -> Text -> ReplyInput -> Handler Value
reply env h ident (ReplyInput rid raw) = do
  user <- auth env h
  let content = T.strip raw; actor = uId user
  unless (isJust (UUID.fromText rid) && not (T.null content) && T.length content <= 3000) $ err err400 "답글은 1~3,000자로 입력해 주세요."
  result <- withPost env actor ident $ \c (Note _ owner _ _ _ _ _) -> do
    void $ execute c "INSERT INTO replies(id,user_id,note_id,content) VALUES (?,?,?,?) ON CONFLICT DO NOTHING" (rid,actor,ident,content)
    [Only matches] <- query c "SELECT EXISTS(SELECT 1 FROM replies WHERE id=? AND user_id=? AND note_id=? AND content=? AND NOT deleted)" (rid,actor,ident,content)
    if not matches then pure Nothing else do
      emit c owner actor "reply" (Just ident) (Just rid) ("reply:"<>rid)
      Just <$> replyValue c actor rid
  maybe (err err409 "다른 답글에 사용된 요청입니다. 다시 작성해 주세요.") pure result

deleteReply :: Env -> Maybe Text -> Text -> Text -> Handler NoContent
deleteReply env h ident rid = do
  user <- auth env h
  result <- withPost env (uId user) ident $ \c (Note _ owner _ _ _ _ _) -> do
    count <- execute c "UPDATE replies SET deleted=true WHERE id=? AND note_id=? AND (user_id=? OR ?=?)" (rid,ident,uId user,uId user,owner)
    when (count>0) $ void $ execute c "DELETE FROM notifications WHERE reply_id=?" (Only rid)
    pure count
  if result == 0 then err err404 "답글을 찾을 수 없습니다." else pure NoContent

notificationFilter :: Query
notificationFilter = " FROM notifications e LEFT JOIN notes n ON n.id=e.note_id WHERE e.recipient_id=? AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=e.recipient_id AND b.target_id=e.actor_id) OR (b.target_id=e.recipient_id AND b.actor_id=e.actor_id) OR (b.actor_id=e.recipient_id AND b.target_id=n.owner_id) OR (b.target_id=e.recipient_id AND b.actor_id=n.owner_id)) AND NOT EXISTS(SELECT 1 FROM mutes m WHERE m.actor_id=e.recipient_id AND (m.target_id=e.actor_id OR m.target_id=n.owner_id)) AND (e.note_id IS NULL OR (n.visibility='public' AND NOT (n.body->>'trashed')::boolean)) AND (e.reply_id IS NULL OR EXISTS(SELECT 1 FROM replies r WHERE r.id=e.reply_id AND NOT r.deleted))"

notifications :: Env -> Maybe Text -> Maybe Int64 -> Handler Value
notifications env h cursor = do
  user <- auth env h
  db env $ \c -> do
    rows <- query c ("SELECT e.id,e.actor_id,e.kind,e.note_id,e.created_at,e.read_at" <> notificationFilter <> " AND (?::bigint IS NULL OR e.id<?) ORDER BY e.id DESC LIMIT 31") (uId user,cursor,cursor) :: IO [(Int64,Text,Text,Maybe Text,UTCTime,Maybe UTCTime)]
    values <- forM (take 30 rows) $ \(ident,actor,kind,nid,time,readAt) -> do
      p <- profile c (uId user) actor
      pure $ object ["id" .= ident,"profile" .= p,"kind" .= kind,"noteId" .= nid,"createdAt" .= time,"read" .= isJust readAt]
    [Only unread] <- query c ("SELECT count(*)" <> notificationFilter <> " AND e.read_at IS NULL") (Only $ uId user) :: IO [Only Int64]
    let next = if length rows<=30 then Nothing else let (ident,_,_,_,_,_) = last (take 30 rows) in Just ident
    pure $ object ["items" .= values,"cursor" .= next,"unread" .= unread]

readNotifications :: Env -> Maybe Text -> Int64 -> Handler NoContent
readNotifications env h through = do
  user <- auth env h
  db env $ \c -> void $ execute c "UPDATE notifications SET read_at=now() WHERE recipient_id=? AND id<=? AND read_at IS NULL" (uId user,through)
  pure NoContent

report :: Env -> Maybe Text -> Text -> ReportInput -> Handler NoContent
report env h target (ReportInput raw nid) = do
  user <- auth env h
  let reason = T.strip raw
  unless (not (T.null reason) && T.length reason<=1000) $ err err400 "신고 사유는 1~1,000자로 입력해 주세요."
  allowed <- db env $ \c -> do
    [Only ok] <- query c "SELECT EXISTS(SELECT 1 FROM users WHERE id=?) AND (?::text IS NULL OR EXISTS(SELECT 1 FROM notes WHERE id=? AND owner_id=? AND visibility='public' AND NOT (body->>'trashed')::boolean))" (target,nid,nid,target)
    when ok $ void $ execute c "INSERT INTO reports(reporter_id,target_id,note_id,reason) VALUES (?,?,?,?)" (uId user,target,nid,reason)
    pure ok
  unless allowed $ err err404 "신고 대상을 찾을 수 없습니다."
  pure NoContent

requireAdmin :: Env -> Maybe Text -> Handler ()
requireAdmin env h = do
  user <- auth env h
  admin <- liftIO $ lookupEnv "NOTIZFADEN_ADMIN_USERNAME"
  unless (admin == Just (T.unpack $ uName user)) $ err err403 "관리자 권한이 필요합니다."

reports :: Env -> Maybe Text -> Handler [Value]
reports env h = do
  requireAdmin env h
  db env $ \c -> jsonRows c "SELECT jsonb_build_object('id',r.id,'reason',r.reason,'noteId',r.note_id,'targetId',r.target_id,'targetName',u.name,'createdAt',r.created_at,'resolved',r.resolved) FROM reports r JOIN users u ON u.id=r.target_id ORDER BY r.resolved,r.id DESC LIMIT 100" ()

resolveReport :: Env -> Maybe Text -> Int64 -> Flag -> Handler NoContent
resolveReport env h ident (Flag resolved) = do
  requireAdmin env h
  db env $ \c -> void $ execute c "UPDATE reports SET resolved=? WHERE id=?" (resolved,ident)
  pure NoContent
