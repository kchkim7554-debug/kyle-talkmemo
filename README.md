# 💬 카일 · 스마트 톡메모 (kyle-talkmemo)

카일 님(김기춘)과 스마트(AI 비서)가 **채팅처럼 메모를 남기고 할 일을 관리하는 전용 웹앱**입니다.
톡메모 앱의 사용감에, 노션 「주제별 정리」 16개 폴더와 1:1로 맞춘 카테고리를 붙였습니다.

- 만든 날: 2026-11-17
- 버전: v1.0.0
- 초기 PIN: **7554** (설정에서 변경 가능)

---

## 1. 되는 일

| 기능 | 설명 |
| --- | --- |
| 채팅형 메모 | 화면 아래 입력바에 적고 전송하면 말풍선으로 쌓입니다. PC는 `Enter` 전송 · `Shift+Enter` 줄바꿈, 모바일은 `전송` 버튼 |
| 주제 17개 | 노션 16개 주제 + `일반 메모`. 입력바의 주제 칩에서 고르고, 위쪽 칩으로 골라 보기 |
| 할 일 | `☑ 할 일`을 켜고 보내면 할 일로 등록. ○ 버튼으로 완료/해제, `미완료만` 필터 |
| 중요 표시 | ☆ 을 눌러 별표, `중요만` 필터 |
| 상태 | 대기 → 처리중 → 완료 (버튼 한 번에 한 단계) |
| 스마트 답글 | 메모마다 `smartReply` 영역 — 스마트가 답한 내용이 파란 인용 상자로 붙습니다 |
| 수정 · 삭제 | ⋯ 메뉴에서 내용 수정, 복사, 삭제 |
| 검색 | 상단 🔍 — 메모 내용·스마트 답글·주제 이름까지 |
| 정렬 | 최신 아래(대화형) ↔ 최신 위 |
| 글자 크기 | 설정에서 보통/크게 |
| PIN 잠금 | 4자리, SHA-256 해시로만 저장. 30일 자동 유지, 설정에서 잠금 |
| 공유 | Firebase 실시간 동기화 + `localStorage` 폴백(오프라인에서도 기록) |
| PWA | `manifest.webmanifest` + 서비스 워커 → 폰 홈 화면에 추가하면 앱처럼 |

## 2. 파일

```
projects/kyle-talkmemo/
├── index.html              화면 뼈대 (잠금·목록·입력바)
├── styles.css              디자인 (모바일/PC 반응형)
├── app.js                  로직 (PIN·메모·동기화)
├── manifest.webmanifest    PWA 설정
├── sw.js                   오프라인 셸 캐시
├── robots.txt              Disallow: / (검색 차단)
├── icons/                  홈 화면 아이콘 (192·512·maskable·apple 180)
├── tools/smart_post.py     스마트가 답글·메모를 남기는 도우미 (REST)
└── README.md
```

검증에 쓴 스크립트는 `work/ktm_test.py`(화면·기능), `work/ktm_sync_test.py`(실시간 동기화·답글), `work/ktm_qa.py`(설정·주제·PWA)에 있습니다.

## 3. 접속 주소 (배포 완료)

### 👉 https://kchkim7554-debug.github.io/kyle-talkmemo/

- 저장소: `github.com/kchkim7554-debug/kyle-talkmemo` (public, `main` 브랜치 루트)
- GitHub Pages 소스: `main` / `/(root)` — 2026-11-17 배포
- 첫 화면에서 PIN **7554** 입력 → 메인

**폰에 앱처럼 붙이기**

1. 폰 브라우저(Chrome·삼성 인터넷)에서 위 주소를 연다.
2. 메뉴(⋮ 또는 ≡) → **홈 화면에 추가** → 이름 `톡메모` → 추가.
3. 홈 화면 아이콘으로 열면 주소창 없는 앱 화면으로 뜬다(iOS는 Safari → 공유 → 홈 화면에 추가).

**PIN 바꾸기**: 메인 화면 오른쪽 위 **⚙ 설정** → `🔑 PIN 변경` → 새 4자리 두 번 입력.
(잊어버리면 기기 데이터를 지워야 하므로, 바꾼 PIN은 따로 적어 두세요.)

로컬에서 열어 보기:

```bash
cd projects/kyle-talkmemo
python3 -m http.server 8787
# 브라우저에서 http://localhost:8787
```

다시 배포할 때(앱 폴더 내용이 저장소 루트):

```bash
git clone https://github.com/kchkim7554-debug/kyle-talkmemo.git
cp -r projects/kyle-talkmemo/. kyle-talkmemo/
git add -A && git commit -m "변경 내용" && git push
```

## 4. 검증한 것 (2026-11-17, 로컬 Chromium)

| 항목 | 결과 |
| --- | --- |
| PIN 7554 입력 → 메인 진입 | 통과 (오답 시 흔들림 + 안내) |
| 메모 작성 · 주제(의료일정) 배지 | 통과 |
| 할 일 등록 → `완료` 표시 · `미완료만` 필터에서 제외 | 통과 |
| 중요(★) 표시 · 주제 필터(도시락 → 빈 상태) | 통과 |
| 검색(내용 일치 / 불일치 안내) | 통과 |
| PC 화면(1280px) · Enter 전송 | 통과 |
| localStorage 저장(새로고침 후 유지) | 통과 (메모 4건) |
| 동기화 경로 전환(배너 버튼 → 게시판 경로) | 통과 · `실시간 공유 중` 표시 |
| Firebase 저장 → 외부(스마트) 답글 → 앱에 실시간 표시 | 통과 (상태 `처리중`까지 반영) |
| 앱에서 삭제 → Firebase 메모 제거 + 삭제 표식 | 통과 |
| 서비스 워커 · manifest 연결 | 통과 |
| 콘솔 오류 | 없음 |

검증용으로 잠깐 올렸던 Firebase `board/talkmemo_v1_9852` 데이터는 모두 삭제했습니다(현재 비어 있음).

## 5. 동기화 경로 (중요)

같은 Firebase 프로젝트(`grandfirst-board`)의 Realtime Database를 씁니다. 현재 규칙이 `board` 아래만 열려 있어서,

| 경로 | 지금 상태 | 비고 |
| --- | --- | --- |
| `talkmemo_v1_9852` (전용, 기본값) | ✅ 실시간 공유 중 | 2026-11-17 규칙 게시 완료 — 앱을 열면 자동으로 이 경로에 붙습니다 |
| `board/talkmemo_v1_9852` | ✅ 동작 | 기존 게시판 규칙(공개 읽기·쓰기)을 함께 씀. 안 씀 |
| 로컬만 | ✅ | 동기화 안 함 |

게시판 앱 데이터(`board/config`, `board/notices`)는 톡메모가 건드리지 않습니다.

전용 경로 규칙(이미 게시됨, 참고용):

```json
{
  "rules": {
    "board": { ".read": true, ".write": true },
    "talkmemo_v1_9852": { ".read": true, ".write": true }
  }
}
```

앱 설정의 경로가 `전용 경로`(기본값)면 자동으로 잇습니다(앱이 시작할 때 전용 경로를 먼저 확인).
`board/...` 경로는 편하지만 **주소를 아는 사람이 읽을 수 있는 공간**이므로, 개인 메모를 오래 쌓을 곳은 전용 경로를 권합니다.

## 6. 스마트(저) 쪽에서 쓰는 법

```bash
# 미완료 메모 보기
python3 tools/smart_post.py --path board list

# 특정 메모에 답글 달기 (상태도 함께 바꿀 수 있음)
python3 tools/smart_post.py --path board reply m1abcd "확인했습니다. 12월 7일 오전에 다녀오시면 됩니다." --status 처리중

# 스마트 이름으로 새 메모 남기기
python3 tools/smart_post.py --path board note "예약 확인 필요" --cat medical --todo
```

`--path`는 `dedicated`(기본값, 지금 열려 있음) 또는 `board`(게시판 DB 경로, 안 씀).

## 7. 개인정보

- 첫 화면 PIN 잠금 (기본 7554, SHA-256 해시만 저장, 평문 저장 없음)
- `<meta name="robots" content="noindex, nofollow, noarchive">` + `robots.txt` `Disallow: /`
- 메모 원문은 브라우저 `localStorage`와(동기화 시) Firebase에 저장됩니다. PIN은 화면 잠금이고 DB 암호화가 아닙니다.
- 스마트에게 넘길 내용은 설정의 `📋 미완료 메모 복사`로 복사해 대화에 붙여넣으면 됩니다.
