# 🏠 Household Manager (Tauri)

기존 PyQt 가계부 앱([household](https://github.com/rlatjd1f/household))을 **Tauri 2 + Svelte 5 + TypeScript**로 새로 만든 데스크톱 가계부입니다.
기존 앱과 **같은 데이터베이스 파일**을 그대로 사용하므로 따로 옮길 필요가 없습니다.

## ✨ 기능
- **가계부 여러 개**: 만들기·이름 변경·삭제 (삭제 시 하위 데이터도 함께 삭제)
- **설정**: 소비/소득/결제수단/자본 분류 트리, 이름 수정(더블클릭·F2), 삭제(Delete), 중분류 색상(색 없음 포함)
- **월별 가계부**: 엑셀처럼 바로 입력하는 지출/소득 표
  - 결제수단→수단명, 대분류→항목 연결 드롭다운, 분류 색상으로 행 표시
  - 항상 날짜 오름차순, 새 행은 맨 아래에 생기고 저장하면 날짜 자리로 이동
  - 엔터로 아래 행 이동(마지막 행에서는 새 행 추가), `Ctrl+S` 모두 저장
  - 금액 입력 검증(`12,000원`, `-5000` 환불 허용), 분류 없음·다른 달 날짜 저장 전 확인
  - 상단 요약(예산 초과 빨강/초록, 수입, 검색 결과 합계)
- **예산**: 소비 대분류 × 12개월, 일괄 적용, 월별 총합
- **자산**: 추가·수정·삭제
- **리포트**: 월별(분류별, Top 10, 일별 지출, 분석 문구) / 연도별(수입·지출 추이, 월별 요약, Top 5)
- **엑셀 내보내기/가져오기**: 기존 앱과 같은 양식 (분류 색상은 셀 배경색), 가져오기는 해당 연도만 교체하고 한 번에 반영

## 🛠 기술 스택
| 역할 | 사용 기술 |
|---|---|
| 데스크톱 | Tauri 2 (Rust) |
| 화면 | Svelte 5 + TypeScript (SvelteKit, 정적 빌드) |
| 표 | AG Grid Community |
| 차트 | ECharts |
| 데이터 | SQLite (rusqlite, 앱에 포함) |
| 엑셀 | exceljs |

Rust는 데이터베이스 연결과 파일 읽기/쓰기만 담당하고(`src-tauri/src/lib.rs`), 앱 로직은 모두 `src/lib`의 TypeScript에 있습니다.

## 💾 데이터 위치 (기존 앱과 동일)
- Windows: `%LOCALAPPDATA%\HouseholdManager\household.db`
- macOS: `~/Library/Application Support/HouseholdManager/household.db`
- 테스트용으로 `HOUSEHOLD_DB_PATH` 환경 변수를 지정하면 그 파일을 사용합니다.

## 🚀 개발
준비물: Node.js 22, Rust(stable), Windows는 Visual Studio C++ Build Tools

```bash
npm install
npm run tauri dev      # 데스크톱 앱으로 실행
npm run dev            # 브라우저 미리보기 (메모리 DB + 예시 데이터, 실제 DB는 건드리지 않음)
npm run check          # 타입 검사
npm run tauri build    # 설치 파일 만들기
```

## 📦 배포
`v*` 태그를 푸시하면 GitHub Actions(`.github/workflows/release.yml`)가 Windows·macOS 설치 파일을 만들고,
커밋 메시지를 분류해 한국어 릴리즈 노트와 함께 릴리즈를 만듭니다.

## 📝 커밋 컨벤션
`feat` 기능 추가 · `fix` 버그 수정 · `style` 디자인 · `docs` 문서 · `refactor` 리팩토링 (내용은 한국어로 작성)
