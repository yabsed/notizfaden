# Notizfaden

나를 위해 적고, 가끔은 함께. 빠른 입력과 카드형 메모를 기반으로 만든 개인 메모 + 선택적 공유 앱입니다.

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
- 체크리스트, 색상, 고정, 라벨, 검색, 보관함, 휴지통과 복원, JSON 내보내기.
- 계정 없이 시작: IndexedDB/Dexie에 저장. 초기 안내 메모 8개도 수정/삭제 가능합니다.
- 계정 생성/로그인, 계정별 기기 저장소, PostgreSQL 영속 저장, 15초 간격 및 앱 포커스/재접속 동기화.
- Private/Public 전환, 최신 공개 메모 100개 둘러보기, 공개 링크, 내 비공개 메모로 이어 쓰기.
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

API와 웹 개발 서버가 실행 중이어야 합니다. 오프라인 검사는 프로덕션 preview 서버도 필요합니다.

```sh
cd app
npm run build
npm --workspace client run preview  # 별도 터미널, :5174
npm test
python3 server/test/api.py
```

브라우저 검사는 설치된 Chrome을 사용하며, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 환경변수로 경로를 바꿀 수 있습니다. API 검사는 임의의 테스트 계정을 만들고 공개 상태를 마지막에 해제/휴지통 처리합니다. 서버 검사 주소는 `NOTIZFADEN_TEST_API`로 바꿀 수 있습니다.

`npm run check`는 Svelte 컴포넌트와 TypeScript를 검사합니다. `npm run build`에도 이 검사가 포함됩니다.

## 구조와 참고 코드

- `client/src/main.ts`, `App.svelte`: 앱 시작, 화면 탐색과 컴포넌트 연결. 화면 구성 전용 스타일은 `App.svelte`에서 관리합니다.
- `client/src/session.svelte.ts`: 로그인 상태, 계정 연결/로그아웃, 다른 탭의 세션 변경 처리.
- `client/src/sync.svelte.ts`: 전송 대기와 재시도, revision 충돌 보존, 공개 범위 변경, 편집 중 보호, 주기/포커스/재접속 동기화. `createSync`는 컴포넌트 초기화 중 호출하며 해당 컴포넌트가 해제되면 타이머와 이벤트 리스너도 정리합니다.
- `client/src/api.ts`: HTTP 요청과 API 오류 처리. `db.ts`는 IndexedDB 저장/조회와 초기 메모, `model.ts`는 타입과 순수 함수를 담당합니다.
- `client/src/components/*.svelte`: 메모 카드, 편집기, 계정/공개 메모 대화상자와 각 컴포넌트 전용 스타일. googlekeepclone의 TodoItem, ContentList, TodoCreate 구성을 참고했습니다. Svelte 5 runes와 입력 바인딩을 사용하며, 편집 내용의 일반 객체 스냅샷을 순서대로 자동 저장합니다.
- `client/src/style.css`: 전역 테마, 기본 요소와 공유 스타일. googlekeepclone의 테마 색상, 카드/입력창 치수, 서랍과 폰트 자산을 사용했습니다. 원본 MIT 라이선스는 `THIRD_PARTY_LICENSES.txt`, 폰트 라이선스는 `client/public/fonts`에 있습니다.
- `server/src/Main.hs`: 서버 설정, 시작과 Servant 라우트 연결.
- `server/src/Model.hs`: 요청/응답 타입, JSON과 DB 행 변환, 공통 API 오류 응답.
- `server/src/Database.hs`: DB 연결과 트랜잭션 실행 기반, 스키마 초기화.
- `server/src/Auth.hs`: 계정 생성/로그인, 암호 해시, 서버 세션과 인증.
- `server/src/Notes.hs`: 메모 조회/저장/공개, 권한 검사와 충돌 처리. 본문 저장과 공개 변경은 동일한 트랜잭션 규칙을 사용합니다.
- Memos의 공개 범위 및 관계별 권한 검사 원칙을 참고했습니다. Memos의 PROTECTED는 로그인 사용자 전체이므로 Friends로 재사용하지 않았습니다.

비밀번호는 PBKDF2-HMAC-SHA256 600,000회로 저장하고, 서버에는 30일 세션 토큰의 SHA256 해시만 보관합니다. 클라이언트 토큰은 해당 기기의 localStorage에 있습니다. Private는 사용자 간 접근 제한이며 종단 간 암호화는 아닙니다.

첫 버전의 범위: 텍스트와 체크리스트, Private/Public 공유입니다. 친구 관계, 이미지 첨부, 댓글, 위젯, 비밀번호 복구, 공개 서비스 운영용 차단/신고/요청 제한은 아직 없습니다. 동기화는 개인 메모 전체 목록을 가져오는 방식이므로 큰 규모에는 커서/페이지네이션이 필요합니다. 휴지통 메모는 자동/영구 삭제하지 않습니다. 이미 복사된 공개 메모는 원본 공개 취소로 회수되지 않으며, 원본 열람은 서버가 다시 권한을 확인합니다.

이 컴퓨터에서 웹 빌드를 유지하면서 Android 테스트 APK를 만드는 단축 명령:

```sh
cd app
npm run android:build -- http://YOUR_PC_IP:5173
```

출력: `client/android/app/build/outputs/apk/debug/app-debug.apk`. URL을 생략하면 기기 내부 메모 기능만 사용할 수 있는 빌드가 됩니다. 실제 기기/에뮬레이터가 연결되어 있지 않아 APK 설치 후 한글 키보드와 시스템 뒤로 가기는 기기에서 추가 확인이 필요합니다.
