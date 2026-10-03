{-# LANGUAGE OverloadedStrings #-}
module RichText (richTextContent) where

import Control.Monad (guard)
import Data.Aeson
import Data.Aeson.Types (Parser, parseMaybe)
import qualified Data.Aeson.KeyMap as KM
import qualified Data.ByteString.Lazy as L
import Data.Text (Text)
import qualified Data.Text as T

-- A deliberately small, versioned schema shared with the client. No HTML,
-- links, arbitrary attributes or recursive blocks can enter a rich document.
richTextContent :: Value -> Maybe Text
richTextContent value = do
  guard (L.length (encode value) <= 2000000)
  parseMaybe parseRich value
  where
    parseRich = withObject "RichText" $ \o -> do
      only ["version", "doc"] o
      version <- o .: "version" :: Parser Int
      guard (version == 1)
      o .: "doc" >>= withObject "Document" (\doc -> do
        only ["type", "content"] doc
        kind <- doc .: "type" :: Parser Text
        guard (kind == "doc")
        blocks <- doc .: "content" :: Parser [Value]
        guard (not $ null blocks)
        T.intercalate "\n" <$> traverse parseBlock blocks)
    parseBlock = withObject "Block" $ \o -> do
      only ["type", "content", "attrs"] o
      kind <- o .: "type" :: Parser Text
      case kind of
        "paragraph" -> guard (not $ KM.member "attrs" o)
        "heading" -> o .: "attrs" >>= withObject "Heading attributes" (\attrs -> do
          only ["level"] attrs
          level <- attrs .: "level" :: Parser Int
          guard (level `elem` [1, 2]))
        _ -> fail "Unsupported block"
      nodes <- o .:? "content" .!= []
      T.concat <$> traverse parseInline nodes
    parseInline = withObject "Inline" $ \o -> do
      kind <- o .: "type" :: Parser Text
      marks <- o .:? "marks" .!= []
      guard (length marks <= 3)
      mapM_ parseMark marks
      case kind of
        "text" -> do
          only ["type", "text", "marks"] o
          text <- o .: "text"
          guard (not $ T.null text)
          pure text
        "hardBreak" -> only ["type", "marks"] o >> pure "\n"
        _ -> fail "Unsupported inline node"
    parseMark = withObject "Mark" $ \o -> do
      only ["type"] o
      kind <- o .: "type" :: Parser Text
      guard (kind `elem` ["bold", "italic", "underline"])
    only keys o = guard (all (`elem` keys) $ KM.keys o)
