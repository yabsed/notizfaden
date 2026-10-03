# Notizfaden

나를 위해 적고, 가끔은 함께. 빠른 입력과 Keep 스타일의 카드형 메모를 기반으로 만든 메모 SNS입니다.

프런트엔드는 Svelte 5 + TypeScript + Vite, 서버는 Haskell + Servant + PostgreSQL입니다.

기존 설치본의 메모와 로그인을 유지하기 위해 Android 패키지 ID(`io.teum.notes`), 브라우저 저장소 키, 기본 개발 DB 이름은 이전 값을 사용합니다. 앱에 표시되는 이름은 Notizfaden입니다.

## 실행

필요한 도구: Node.js 22.12 이상, GHC 9.10.3, Cabal, PostgreSQL 18(서버 및 CLI). 이 컴퓨터에는 도구와 개발용 라이브러리를 준비했습니다.

```sh
cd app
npm install
npm start
```

- 웹: http://localhost:5173
- Haskell API: http://127.0.0.1:8081/api/health
- 개발 DB: localhost:55432, 데이터는 `app/.data/postgres`에 유지됩니다.
- 첫 실행은 Haskell 의존성 빌드 때문에 시간이 걸립니다. `npm start`는 DB를 시작하고 API와 웹을 실행합니다.
- DB는 개발용으로 localhost에만 열리며 로컬 접속을 신뢰합니다. 외부 운영용 DB에는 인증을 설정하고 `DATABASE_URL`을 지정하세요.

별도로 실행할 때:

```sh
npm run db
npm run server
npm run dev
```

외부 PostgreSQL 사용:

```sh
DATABASE_URL='host=127.0.0.1 port=5432 dbname=notizfaden user=notizfaden password=...' npm start
```

새 Fedora 환경의 시스템 개발 패키지:

```sh
sudo dnf install gcc gcc-c++ make gmp-devel ncurses-devel libpq-devel postgresql-server
```

현재 컴퓨터의 관리자 권한 없는 설치를 위해 `scripts/env.sh`가 `~/.ghcup/prereqs`와 `.data/native`도 인식합니다. 이 경로들은 Git에 포함되지 않으며, 시스템 개발 패키지가 있으면 필요 없습니다.

## 구현된 기능

- 반응형 카드/목록 화면, 라이트/다크 테마, 자동 저장, 제목 없는 메모.
- Tiptap 본문 편집: H1/H2/일반 본문, 굵게·기울임·밑줄, 서식 지우기, 실행 취소·다시 실행과 단축키. 카드·공개 메모·복사·내보내기·오프라인 저장에서도 서식을 유지합니다.
- 체크리스트, 색상, 고정, 라벨, 검색, 보관함, 휴지통과 복원, JSON 내보내기.
- 계정 없이 시작: IndexedDB/Dexie에 저장. 초기 안내 메모 8개도 수정/삭제 가능합니다.
- 계정 생성/로그인, 계정별 기기 저장소, PostgreSQL 영속 저장, 15초 간격 및 앱 포커스/재접속 동기화.
- 공개 메모는 읽기 모드, 비공개 메모는 편집 모드로 열립니다. 상단 편집 도구는 편집 중에만 표시되며, 피드와 내 메모는 같은 카드·상세 화면을 사용합니다.
- 하나의 메모에서 Private/Public 전환, 공개 링크, 내 비공개 메모로 이어 쓰기. 공개 후에도 같은 메모를 편집하며 좋아요·답글과 최초 공개 시각을 유지합니다.
- Keep 색상과 카드/목록 보기를 유지한 전체·팔로잉 피드, 사람·공개 메모 검색, 프로필의 공개 메모 모음. 피드·답글·알림은 30개 단위 커서로 더 읽을 수 있습니다.
- 표시 이름·소개·이모지 아바타, 팔로우/해제, 팔로워·팔로잉 목록, 좋아요/취소, 답글 작성·삭제. 같은 좋아요·답글 요청의 재시도는 중복 생성하지 않습니다.
- 팔로우·좋아요·답글의 앱 내 알림, 읽음 상태와 배지. 배지는 30초마다 갱신되며 운영체제 푸시 알림은 아닙니다.
- 차단·뮤트·신고, 관리자 신고 검토함. 차단은 양방향 메모 접근과 상호작용을 막고 기존 팔로우도 해제합니다. 뮤트는 피드·답글·알림에서 숨기며 직접 공개 링크는 열 수 있습니다.
- 내 메모의 전체/공개/비공개 필터와 공개 탭에 통합한 내 프로필, 모바일 하단 탐색, 피드 당겨서 새로고침. 개인 라벨·고정·보관 상태·복사 출처는 공개 응답에서 제외합니다.
- 서버가 공개 범위 변경을 승인해야 UI가 완료로 표시합니다. 일반 본문 저장 요청은 공개 범위를 바꾸지 않습니다.
- revision 충돌 시 양쪽 버전을 보존할 수 있으며, mutation ID로 동일 요청 재시도를 중복 적용하지 않습니다.
- 프로덕션 웹 빌드는 서비스 워커로 앱 자산을 미리 캐시합니다. 개인 메모는 IndexedDB에서 읽고 공개 API 응답은 캐시하지 않습니다.

회원가입에 이메일은 사용하지 않습니다. 아이디는 영문/숫자/밑줄 3~30자, 비밀번호는 10~128자입니다. 시작 메모를 계정에 복사하는 것은 로그인 화면에서 선택할 수 있습니다. 로그아웃 후에도 미전송 메모는 같은 계정의 기기 저장소에 보존됩니다.

## Android

`client/android`는 생성된 실제 Capacitor Android 프로젝트입니다. 웹과 동일한 Svelte 화면과 저장/동기화 코드를 사용합니다.

```sh
cd app/client
# Android에서는 접근 가능한 API 주소가 필요합니다. 상대 경로 /api는 웹 개발용입니다.
VITE_API_URL=https://your-api.example VITE_PUBLIC_URL=https://your-web.example npm run build
npx cap sync android
npx cap open android
```

API의 `ALLOWED_ORIGINS` 기본값에 Capacitor origin인 `https://localhost`가 포함되어 있습니다. 실제 API는 HTTPS로 제공하세요. Java 21과 Android SDK 36이 필요합니다. `android/local.properties`의 `sdk.dir`에 SDK 경로를 설정한 뒤 `./gradlew assembleDebug`로 APK를 만들 수 있습니다.

로컬 Wi-Fi에서 테스트 APK를 만들 때만 HTTP 개발 모드를 사용합니다. 앱 자산은 여전히 APK 내부에서 읽습니다.

```sh
VITE_API_URL=http://YOUR_PC_IP:5173 VITE_PUBLIC_URL=http://YOUR_PC_IP:5173 npm run build
NOTIZFADEN_ANDROID_DEV=1 npx cap sync android
cd android
./gradlew assembleDebug
```

PC에서 `npm start`를 실행하고 휴대폰을 같은 네트워크에 연결하세요. `NOTIZFADEN_ANDROID_DEV` 없이 다시 동기화하면 기본 HTTPS 설정으로 돌아갑니다. 현재 환경에서 빌드용 JDK 21은 `.data/jdk21`에 준비했습니다.

## 검사

검사는 개발 DB와 분리된 `notizfaden_social_test`에서 실행합니다. 개발 PostgreSQL(:55432)이 켜진 상태에서 별도 터미널로 테스트 환경을 시작하세요.

```sh
cd app
npm run test:env  # 테스트 DB 생성, 빌드, API :8082 / 웹 :5175 / preview :5176
```

다른 터미널에서:

```sh
cd app
npm test
python3 server/test/api.py
NOTIZFADEN_TEST_ADMIN=1 python3 server/test/social.py
python3 server/test/demo.py  # 임시 DB에서 테스트 계정 정리·실계정 보존 검사
python3 server/test/migration.py  # 별도 임시 DB를 만들고 제거
```

브라우저 검사는 설치된 Chrome을 사용하며, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 환경변수로 경로를 바꿀 수 있습니다. API·브라우저 검사는 `/api/health`의 `testDatabase`를 먼저 확인합니다. 서버가 실제 연결한 DB 이름이 `_test`로 끝나지 않으면 계정을 만들기 전에 중단합니다. 기본 주소도 개발 서버 대신 격리된 서버를 가리킵니다. 서버 검사 주소는 `NOTIZFADEN_TEST_API`로 바꿀 수 있습니다.

`npm run check`는 Svelte 컴포넌트와 TypeScript를 검사합니다. `npm run build`에도 이 검사가 포함됩니다.

별도 포트로 검증할 때는 Vite의 `NOTIZFADEN_API_PROXY`, Playwright의 `NOTIZFADEN_TEST_URL`과 `NOTIZFADEN_PREVIEW_URL`을 지정할 수 있습니다. API의 `ALLOWED_ORIGINS`에도 해당 웹 주소를 추가하세요. 새 SNS 흐름은 `tests/social.spec.ts`에서 두 계정과 모바일 화면으로 확인합니다. `server/test/social.py`는 권한·공개 취소·차단·뮤트·동시 요청·페이지네이션을 검사합니다. 관리자 경로까지 검사하려면 **격리된 테스트 DB**의 서버를 `NOTIZFADEN_ADMIN_USERNAME=social_admin`으로 띄우고 검사에 `NOTIZFADEN_TEST_ADMIN=1`을 지정하세요. 서식 입력·복원·단축키·붙여넣기·모바일 배치·공개 메모 복사는 `tests/rich-text.spec.ts`, 오프라인 서식 보존은 `tests/offline.spec.ts`에서 검사합니다. 실제 Android 한글 키보드의 조합 입력은 기기에서 추가 확인이 필요합니다.

## 본문 서식과 호환성

`NoteBody.richText`는 선택적 `{ version: 1, doc: ... }` 문서입니다. 문단, H1/H2, 줄바꿈, 텍스트와 bold/italic/underline만 허용하며, `content`에는 같은 문서에서 추출한 일반 텍스트를 저장해 기존 검색과 빈 메모 판정을 유지합니다. 서식이 없는 기존 메모는 줄바꿈을 보존하여 편집합니다. 본문은 100,000자, 서식 JSON은 UTF-8 기준 2,000,000바이트로 제한합니다. 체크리스트 전환 시 실제 서식이 있다면 제거를 확인합니다.

API 서버를 먼저 업데이트한 뒤 웹/Android 클라이언트를 배포하세요. PostgreSQL JSONB와 IndexedDB의 기존 레코드는 별도 마이그레이션 없이 읽습니다. 서버는 문서 구조와 일반 텍스트의 일치를 검증하며, 새 클라이언트의 본문 저장 요청은 `bodyFormat: 2`를 보냅니다. 구버전 클라이언트의 서식 없는 메타데이터 변경은 기존 서식을 보존하고, 서식을 잃는 본문 변경은 거부합니다. 구버전 서버가 서식을 제거해서 응답하면 새 클라이언트는 기기의 수정본을 보존하고 서버 업데이트가 필요하다고 안내합니다.

Tiptap 소스는 `submodules/tiptap`에 보관하며, 앱은 해당 스냅샷의 패키지 버전인 `3.30.3`을 npm 의존성으로 고정합니다. 서브모듈 전체를 앱 실행 전에 빌드할 필요는 없습니다. 관련 MIT 고지는 `THIRD_PARTY_LICENSES.txt`와 프로덕션 빌드의 `/third-party-licenses.txt`에 포함됩니다.

## 구조와 참고 코드

- `client/src/main.ts`, `App.svelte`: 앱 시작, 화면 탐색과 컴포넌트 연결. 화면 구성 전용 스타일은 `App.svelte`에서 관리합니다.
- `client/src/session.svelte.ts`: 로그인 상태, 계정 연결/로그아웃, 다른 탭의 세션 변경 처리.
- `client/src/sync.svelte.ts`: 전송 대기와 재시도, revision 충돌 보존, 공개 범위 변경, 편집 중 보호, 주기/포커스/재접속 동기화. `createSync`는 컴포넌트 초기화 중 호출하며 해당 컴포넌트가 해제되면 타이머와 이벤트 리스너도 정리합니다.
- `client/src/api.ts`: HTTP 요청과 API 오류 처리. `db.ts`는 IndexedDB 저장/조회와 초기 메모, `model.ts`는 타입과 순수 함수를 담당합니다.
- `client/src/components/*.svelte`: 메모 카드, 편집기, 계정/공개 메모 대화상자와 각 컴포넌트 전용 스타일. googlekeepclone의 TodoItem, ContentList, TodoCreate 구성을 참고했습니다. Svelte 5 runes와 입력 바인딩을 사용하며, 편집 내용의 일반 객체 스냅샷을 순서대로 자동 저장합니다.
- `client/src/components/RichTextEditor.svelte`, `RichTextView.svelte`, `client/src/richText.ts`: Tiptap 편집, 허용된 서식만 표시하는 공통 뷰, 일반 텍스트 변환. 입력마다 에디터를 다시 생성하지 않아 선택 영역과 실행 취소 기록을 유지합니다.
- `client/src/style.css`: 전역 테마, 기본 요소와 공유 스타일. googlekeepclone의 테마 색상, 카드/입력창 치수, 서랍과 폰트 자산을 사용했습니다. 원본 MIT 라이선스는 `THIRD_PARTY_LICENSES.txt`, 폰트 라이선스는 `client/public/fonts`에 있습니다.
- `server/src/Main.hs`: 서버 설정, 시작과 Servant 라우트 연결.
- `server/src/Model.hs`: 요청/응답 타입, JSON과 DB 행 변환, 공통 API 오류 응답.
- `server/src/Database.hs`: 4개 연결 풀, 트랜잭션, 버전별 스키마 마이그레이션. 서버 시작 시 잠금을 잡고 한 번씩 적용하며 기존 사용자·메모·세션·revision은 유지합니다.
- `server/src/Social.hs`, `client/src/social.ts`, `SocialView.svelte`, `NoteCard.svelte`, `NoteDiscussion.svelte`, `Person.svelte`: 소셜 API와 화면. 별도 게시물 테이블 없이 공개 메모의 ID에 관계·반응·답글을 연결합니다.
- `server/src/Auth.hs`: 계정 생성/로그인, 암호 해시, 서버 세션과 인증.
- `server/src/Notes.hs`: 메모 조회/저장/공개, 권한 검사와 충돌 처리. 본문 저장과 공개 변경은 동일한 트랜잭션 규칙을 사용합니다.
- `server/src/RichText.hs`: 버전이 있는 서식 문서의 허용 노드·속성·길이 검증과 일반 텍스트 추출.
- Memos의 공개 범위 및 관계별 권한 검사 원칙을 참고했습니다. Memos의 PROTECTED는 로그인 사용자 전체이므로 Friends로 재사용하지 않았습니다.

비밀번호는 PBKDF2-HMAC-SHA256 600,000회로 저장하고, 서버에는 30일 세션 토큰의 SHA256 해시만 보관합니다. 클라이언트 토큰은 해당 기기의 localStorage에 있습니다. Private는 사용자 간 접근 제한이며 종단 간 암호화는 아닙니다.

현재 범위는 텍스트·체크리스트 기반 메모 SNS입니다. 이미지 첨부·업로드형 아바타, 중첩 답글, 운영체제 푸시 알림, Bluesky 계정/AT Protocol 연동, 위젯, 비밀번호 복구, 요청 속도 제한은 아직 없습니다. 사람 검색은 최대 40명, 팔로워·팔로잉 목록은 최대 100명을 표시합니다. 동기화는 개인 메모 전체 목록을 가져오는 방식이므로 큰 규모에는 커서/페이지네이션이 필요합니다. 휴지통 메모는 자동/영구 삭제하지 않습니다. 이미 복사된 공개 메모는 원본 공개 취소로 회수되지 않으며, 원본 열람은 서버가 다시 권한을 확인합니다.

관리자 신고함은 서버 환경변수 `NOTIZFADEN_ADMIN_USERNAME`에 **이미 생성한 계정의 정확한 아이디**를 지정하고 서버를 재시작하면 해당 계정의 프로필에서 열 수 있습니다. 미설정 시 모든 계정의 관리자 API 접근을 거부합니다. 신고 대상/사유를 열람하고 검토 완료·다시 열기를 제공하며, 강제 계정 정지·글 삭제 기능은 포함하지 않습니다.

SNS 변경을 반영할 때는 API 서버를 재시작한 다음 웹을 새로고침하거나 새 APK를 설치하세요. 로그인 정보·Android 패키지 ID·개인 메모 저장소는 그대로 사용합니다. 비공개 메모에는 좋아요·댓글을 표시하지 않습니다. 공개에서 비공개로 전환하면 좋아요·답글과 해당 알림을 삭제하며, 다시 공개해도 복원되지 않습니다. 휴지통 이동은 열람과 알림 노출을 막습니다. 차단은 로그인한 계정 사이의 접근 제어이며 공개 글을 비로그인 방문자에게 숨기는 기능은 아닙니다.

이 컴퓨터에서 웹 빌드를 유지하면서 Android 테스트 APK를 만드는 단축 명령:

```sh
cd app
npm run android:build -- http://YOUR_PC_IP:5173
```

출력: `client/android/app/build/outputs/apk/debug/app-debug.apk`. URL을 생략하면 기기 내부 메모 기능만 사용할 수 있는 빌드가 됩니다. 실제 기기/에뮬레이터가 연결되어 있지 않아 APK 설치 후 한글 키보드와 시스템 뒤로 가기는 기기에서 추가 확인이 필요합니다.

## 탐색과 시 샘플

탐색에서 검색어가 없으면 공개 상태이며 휴지통에 없는 메모를 기준으로 **가장 최근 게시한 작성자 12명**을 보여줍니다. 작성자는 한 번만 표시하고 본인·양방향 차단·뮤트 계정은 제외합니다. 편집 시각은 순위에 영향을 주지 않습니다. 검색어가 있으면 이름·표시 이름에 해당 문자열을 포함한 사람(이름순, 최대 40명)과 제목·본문·작성자 정보에 일치하는 공개 메모(게시순)를 찾습니다. 공개 메모가 없는 계정도 이름 검색으로 찾을 수 있습니다. 개인 라벨과 비공개 내용은 검색하지 않습니다.

`demo/poetry.json`에는 김소월의 『진달래꽃』(1925) 수록작 36편과 주제별 샘플 계정 6개가 있습니다. 원작은 위키문헌의 PD-old-70 표기를 확인했고, 위키문헌 현대어·전사본의 이용 조건은 CC BY-SA 4.0으로 표시합니다. 작품마다 작가·고정 판본 URL·출처·이용 조건을 본문에 넣습니다. 위키 마크업, 중복 제목, 편집자 주석을 제거하고 행갈이와 연 구분은 보존합니다. 샘플 계정 소개와 감상 댓글에도 샘플임을 표시합니다.

```sh
cd app
python3 scripts/demo.py validate
python3 scripts/fetch-poetry.py  # 고정된 위키문헌 판본에서 본문을 다시 추출해 검증 (네트워크 필요)
python3 scripts/demo.py cleanup  # 삭제 후보와 보존 계정만 표시
python3 scripts/demo.py cleanup --apply  # 전체 DB 백업 후 검증된 테스트 계정만 삭제
python3 scripts/demo.py seed  # 개발 API :8081에 샘플 6계정 / 36편 / 좋아요 6개 / 댓글 6개
```

정리는 계정 이름의 정확한 테스트 생성 형식과 테스트 비밀번호의 PBKDF2 해시를 모두 대조합니다. 같은 접두사여도 일치하지 않는 계정은 보존합니다. 삭제 전 전체 DB를 `.data/backups/before-demo-*.dump`에 저장하고, 관련 테스트 데이터는 한 트랜잭션에서 정리합니다. 다른 사용자가 복사해 둔 메모 본문은 유지합니다. `--database`로 정리 대상 DB를 지정할 수 있습니다.

시 주입은 Python에서 일반 Haskell API를 호출합니다. 고정된 계정 이름과 UUID로 재실행해도 중복되지 않으며, 같은 본문은 다시 저장하지 않습니다. 임의 생성한 계정 비밀번호·사용자 ID는 Git에서 제외된 `.data/poetry-demo-state.json`(권한 600)에만 저장합니다. 이 파일은 재실행을 위해 보관하세요. 같은 이름의 타 계정은 가져오지 않습니다. 다른 DB에서 실행할 때는 `--api`와 별도의 `--state` 파일을 함께 지정하세요.
