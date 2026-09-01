# DAPA MCP Architecture

## 목표와 범위

v0.1.0은 `Search → Retrieve → Verify → Compare → Cite` 흐름의 기반을 제공한다. 법제처
Open API와 로컬 공개지식 `DAPA_info`를 독립 Provider로 두며, 외부 API 키가
없어도 DAPA 검색과 MCP 서버는 정상 동작한다.

```text
MCP Client
    ├── public HTTPS Streamable HTTP (`/law` → `/api/mcp`)
    └── local stdio
    ▼
Tool Registry (Zod boundary)
    ├── Generic LawProvider ── HTTPS ── 국가법령정보 공동활용 API
    │     ├── 목록·상세·기준일 검색
    │     ├── 연혁(`lsHistory`)
    │     └── 조문·부칙·개정문·제개정이유 정규화
    ├── DapaCatalogProvider ── DAPA 공식 홈페이지 목록 스냅샷
    │     ├── 법령·행정규칙 범위·분류·발령 메타데이터
    │     └── 목록 출처와 동기화 상태
    └── DapaInfoProvider ─────── DAPA_info JSON
```

## 주요 결정

- 도구는 17개를 역할별로 노출하고, 범용 법령 기능과 DAPA 지식을 분리한다.
- 모든 도구 입력과 외부 응답은 Zod로 경계에서 파싱한다.
- Provider 결과는 출처, 문서 ID, 검색 시각, 검증 상태를 공통 형식으로 반환한다.
- `NOT_FOUND`는 정상 응답에서 0건이 명시된 경우에만 사용한다.
- 타임아웃, 429, 5xx, HTML/손상된 JSON은 `SOURCE_UNAVAILABLE` 계열로 보존한다.
- stdio transport에서 stdout은 JSON-RPC 전용이며 진단 출력은 stderr만 사용한다.
- 기준일 검색은 `eflaw`의 `efYd=YYYYMMDD~YYYYMMDD` 범위로 조회하며 현재 법령을
  조용히 대체하지 않는다.
- DAPA 카탈로그는 기관별 범위와 목록 메타데이터의 기준이며, 실제 조문·법적 본문은
  국가법령정보 공동활용 API가 기준이다.
- `get_dapa_legal_content`는 카탈로그 제목·발령번호·발령일자로 국가법령정보 문서를
  식별한 뒤 동일한 `LawProvider` 상세 경로를 사용한다.
- 웹 클라이언트는 Vercel의 공개 HTTPS Streamable HTTP 엔드포인트를 사용하고,
  CLI 클라이언트는 기존 로컬 stdio를 계속 사용할 수 있다.
- HTTP 전송은 요청마다 새 MCP 서버·transport를 만드는 stateless 구조다. 파싱된 DAPA Provider와
  법령 Provider는 Vercel warm instance 안에서 재사용해 파일 I/O와 캐시를 반복 생성하지 않는다.
- HTTP 요청은 1 MiB로 제한하고 응답에는 CORS와 `Cache-Control: no-store`를 적용한다.
  전역 rate limit은 분산 함수 메모리가 아니라 Vercel Firewall에서 `/law`와 `/api/mcp`에 적용한다.
- 국가법령정보 API 요청에는 설정 가능한 Referer와 User-Agent를 보내되, OC가 포함된 전체 URL은
  로그나 도구 응답에 노출하지 않는다.

## 벤치마크 기록

`korean-law-mcp`의 2026-08-20 커밋
`cc2c2f0b94af3cb43fcb09d9df17c018277a5b81`을 분석했다. 참고한 패턴은 Provider
분리, 중앙 Tool Registry, TTL cache, timeout/retry, stdio/HTTP transport 분리,
명시적 업스트림 장애 분류다. 원본은 MIT이지만 이 저장소는 코드를 복사하지 않고
별도 구현한다.

## 공식 API

- 목록: `https://www.law.go.kr/DRF/lawSearch.do`
- 본문: `https://www.law.go.kr/DRF/lawService.do`
- 인증: `OC` 쿼리 값, 환경변수 `LAW_API_OC`
- 검색 target: `law`, `eflaw`, `admrul`, `prec`, `detc`, `expc`, `decc`

## DAPA 카탈로그 동기화

- 동기화 명령: `npm run sync:dapa-catalog`
- 저장 위치: `DAPA_info/legal/catalog.json`
- 행정규칙 페이지 파라미터: `currPage`, `listCo`, `ruleId=24422`
- 동기화 시 전체 건수, 페이지 수, ID 중복을 검증한다.

API 키와 전체 요청 URL은 로그에 남기지 않는다.
