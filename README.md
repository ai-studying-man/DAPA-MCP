# DAPA MCP

DAPA MCP는 대한민국 방위사업 업무를 지원하는 읽기 전용 Model Context Protocol
서버다. LLM의 기억 대신 법제처 국가법령정보 공동활용 Open API와 출처가 표시된
`DAPA_info`를 조회한다. 핵심 원칙은 `Search → Retrieve → Verify → Compare → Cite → Explain`이다.

> v0.1.0 Core와 법령정보 MCP Parity 1차를 구현한다. 로컬 stdio와 17개 도구,
> DAPA 공식 법령·행정규칙 카탈로그, 법령 상세 구조화, 연혁 조회, 기준일 검색을 제공한다. Streamable HTTP, 특허,
> 논문, 뉴스, 공개데이터, 신구조문 비교는 아직 구현하지 않았으며
> [ROADMAP.md](./ROADMAP.md)에 구분되어 있다.

## 왜 MCP인가

- 현행 법령과 과거·폐지 규정을 혼동하지 않도록 공식 Source를 우선한다.
- 인용한 법령명·조문·사건번호를 다시 조회해 검증한다.
- 정상 0건인 `NOT_FOUND`와 timeout·429·5xx·손상 응답인 `SOURCE_UNAVAILABLE`을 구분한다.
- 조직·업무 지식에도 출처, 확인일, 검증 여부를 붙인다.

## Architecture

```text
Claude / Gemini / Codex / MCP Client
                  │ stdio
                  ▼
         DAPA MCP Tool Registry
           ├── LawProvider ── 국가법령정보 Open API
           ├── DapaCatalogProvider ── DAPA 공식 목록 스냅샷
           └── DapaInfoProvider ── DAPA_info
```

상세 설계와 벤치마크 기록은 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)를 참고한다.

## 설치와 실행

요구사항은 Node.js 20.19 이상이다.

```bash
npm install
cp .env.example .env
npm run build
npm test
npm run start
```

`npm run start`는 stdio JSON-RPC 서버이므로 터미널에서 대기하는 것이 정상이다.
일반 로그를 stdout으로 출력하지 않는다.

공식 DAPA 법령·행정규칙 목록을 갱신하려면 다음 명령을 실행한다.

```bash
npm run sync:dapa-catalog
```

카탈로그의 각 항목을 국가법령정보 공동활용 Open API의 최신 목록과 대조해
미매칭 목록을 만들려면 다음 명령을 실행한다. 행정규칙은 DAPA 기관 범위에서
현행 목록과 연혁 목록을 함께 수집한 뒤 문서 ID·발령번호·발령일자·제목 순으로
연결한다. 개발용 스크립트에는 공개 기본 인증값을 명시적으로 전달한다.

```bash
LAW_API_OC=dusgh4847 npm run audit:dapa-catalog
```

PowerShell에서는 다음처럼 실행한다.

```powershell
$env:LAW_API_OC = "dusgh4847"
npm run audit:dapa-catalog
Remove-Item Env:LAW_API_OC
```

결과는 [DAPA_info/legal/coverage-report.json](./DAPA_info/legal/coverage-report.json)에
저장된다. `missing`은 DAPA 공식 목록의 제목이 국가법령정보 API에서 동일하게 검색되지
않았다는 뜻이며, 법적 부존재를 단정하지 않는다. 폐지·제정 이력, 제목 표기 차이, 원문이
파일로만 제공되는 항목은 별도 확인이 필요하다. `title_variant`는 DAPA 표시 제목과
API canonical 제목이 다르지만 대응 문서로 확인된 경우다. `metadata_mismatch`는 제목은 같지만
행정규칙 발령번호·발령일자가 다른 경우이고, `external_only`는 DAPA가 국가법령정보
외부 원문 링크만 제공하는 법령이다.

이 보고서는 카탈로그 스냅샷과 API 목록 조회 시점에 종속된다. 카탈로그를 다시
동기화하거나 API 최신성이 중요할 때는 반드시 감사도 다시 실행해야 하며, `missing`
건수는 법적 부존재가 아니라 아직 API 문서와 연결되지 않은 후보를 뜻한다. 따라서
전체 카탈로그가 국가법령정보 본문으로 완전히 커버된 것으로 간주하지 않는다.

`업무·정책` 메뉴와 각 페이지의 하위 탭 본문을 `DAPA_info/policy/catalog.json`으로
갱신하려면 다음 명령을 실행한다. 방위사업청 내부 페이지만 수집하며 `menuSeq`와 최종
페이지 ID를 기준으로 중복을 제거한다. 동시에 두 번 실행하면 잠금 파일을 감지해 두 번째
동기화를 종료한다.

```bash
npm run sync:dapa-policy
```

공식 14개 범주·40개 세부 API를 현재 실서버에 순차 호출해 목록·본문 연결과 오류를
점검하려면 다음 명령을 실행한다. 맞춤형 기본 샘플 코드는 공식 가이드의 L/A/O 코드를
사용하며, 환경변수로 교체할 수 있다.

```bash
LAW_API_OC=dusgh4847 npm run backtest:law-api
```

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---:|---:|---|
| `LAW_API_OC` | 아니오 | `dusgh4847` | 국가법령정보 공동활용 공개 기본 인증값; 별도 값으로 재정의 가능 |
| `LAW_API_TIMEOUT_MS` | 아니오 | `10000` | 요청 timeout |
| `LAW_API_RETRY_LIMIT` | 아니오 | `2` | 429/5xx 재시도 상한 |
| `LAW_API_CACHE_TTL_MS` | 아니오 | `300000` | API 검색 캐시 TTL(밀리초), `0`이면 캐시 비활성화 |
| `LAW_API_MAX_TEXT_RESPONSE_BYTES` | 아니오 | `8388608` | JSON/HTML API 응답 최대 바이트 |
| `LAW_API_MAX_RESOURCE_RESPONSE_BYTES` | 아니오 | `26214400` | 별표·서식 파일 최대 바이트 |
| `LAW_API_MAX_TOOL_RESPONSE_CHARS` | 아니오 | `250000` | 법령 API MCP 도구의 JSON 출력 최대 문자 수 |
| `DAPA_INFO_PATH` | 아니오 | `./DAPA_info` | 공개지식 루트 |

기본 인증값 `dusgh4847`은 누구나 바로 사용할 수 있도록 코드와 문서에 공개한다. 별도
인증값을 사용하려면 `LAW_API_OC`로 재정의한다. `.env`는 Git에서 제외된다.

### 국가법령정보 API 설정

별도 인증 절차 없이 기본 인증값으로 법령 API를 사용할 수 있다. 자체 인증값이 있으면
MCP Client가 서버를 시작할 때 `LAW_API_OC` 환경변수로 전달하고, `source_health`에서
`law: healthy`를 확인한다.

## MCP 도구

| 도구 | 역할 |
|---|---|
| `search_legal` | 법령·행정규칙·판례·헌재·해석례·행정심판 검색 |
| `search_legal_content` | 국가법령정보 API 후보 목록을 조회한 뒤 각 문서의 상세 본문·조문을 함께 조회 |
| `get_legal_detail` | 검색 결과 `documentId` 상세조회 |
| `get_legal_history` | 법령 제정·개정·폐지 연혁 조회 |
| `list_legal_apis` | DAPA 관련 국가법령정보 14개 범주·40개 목록/본문 API 카탈로그 조회 |
| `query_legal_api` | 카탈로그 `apiId`로 공식 목록·본문을 온디맨드 조회 |
| `get_legal_api_body` | 목록 `apiId`와 결과 식별자로 본문 API 자동 연결; 별표·서식 파일 본문 추출 |
| `verify_citations` | 법령 조문과 사건번호 검증 |
| `search_dapa_info` | 조직·용어·업무 공개지식 검색 |
| `get_dapa_organization` | 조직명·별칭 상세조회 |
| `search_dapa_policy` | 업무·정책 메뉴와 하위 탭의 본문 검색 |
| `get_dapa_policy_page` | 검색 결과 ID로 업무·정책 전체 본문 조회 |
| `search_dapa_legal_catalog` | DAPA 공식 법령·행정규칙 목록 검색 |
| `get_dapa_legal_catalog_item` | DAPA 공식 목록 항목 상세조회 |
| `get_dapa_legal_content` | DAPA 항목을 국가법령정보 본문과 연결해 조회 |
| `dapa_catalog_status` | DAPA 공식 목록 동기화 상태 |
| `source_health` | Provider 설정과 상태 확인 |

`committee_decision`은 입력 계약만 제공하고 실제 Provider는 아직 설정하지 않는다.
`asOfDate`는 법제처 `eflaw` 기준일 검색으로 처리하며, 해당 기준일 자료가 없으면
`NOT_FOUND`를 반환한다. `currentOnly` 기본값은 `true`이며, 행정규칙도 명시적인 연혁·폐지
상태를 제외한다. 과거 자료가 필요하면 `currentOnly: false`를 사용하고, 최신 API 재조회가
필요하면 `forceRefresh: true`를 사용한다. 성공한 검색 결과의 기본 캐시 TTL은 5분이다.

### 국가법령정보 API 범위

`list_legal_apis`는 아래 14개 범주의 API 메타데이터만 반환한다. 실제 응답 본문은
`query_legal_api`가 요청 시점에 법제처에서 목록을 조회하고, `get_legal_api_body`가 목록
결과의 식별자 또는 첨부 링크를 받아 본문을 조회하므로 전체 법령 데이터를 MCP 컨텍스트나
`DAPA_info`에 적재하지 않는다. `list_legal_apis`의 각 API에는 실행 가능한 `bodyTool`과,
별도 본문 API가 있는 경우 `bodyApiId`가 함께 반환된다.

| 범주 | 목록·본문 처리 |
|---|---|
| 사전컨설팅 의견서 | 감사원 `baiPvcs` 목록·본문 |
| 중앙부처 1차 해석 | 방위사업청 `dapaCgmExpc` 목록·본문 |
| 법령정보 지식베이스 | 용어·조문·관련법령·지능형 검색 9종 |
| 맞춤형 | 법령·행정규칙·자치법규 목록 및 조문 6종; `vcode` 필요 |
| 법령용어 | `lstrm` 목록·본문 |
| 별표·서식 | 법령·행정규칙·자치법규 목록 및 HWP/HWPX/PDF/XLSX/DOCX 원문 본문 추출 |
| 조약 | `trty` 목록·본문 |
| 헌재결정례 | `detc` 목록·본문 |
| 법령해석례 | `expc` 목록·본문 |
| 행정심판례 | `decc` 목록·본문 |
| 법령 | `law` 목록·본문 |
| 행정규칙 | `admrul` 목록·본문 |
| 자치법규 | `ordin` 목록·본문 |
| 판례 | `prec` 목록·본문 |

별표·서식은 공식 가이드에 독립 본문 API가 없으므로 목록 응답의
`별표서식파일링크` 또는 `별표서식PDF파일링크`를 `get_legal_api_body`의
`attachmentUrl`에 전달한다. 서버가 공식 법제처 링크만 내려받아 파일을 Markdown 본문으로
변환한다. 맞춤형 목록은 연결된 일반 법령 본문 API로, 맞춤형 조문 API는 자체 응답으로
해석된다.

DAPA 카탈로그는 공식 홈페이지의 범위·분류·발령 메타데이터를 보존하고, 실제 조문과
법적 본문은 `search_legal` 및 `get_legal_detail`의 국가법령정보 공동활용 API에서 조회한다.

## MCP Client 연결

모든 예시의 `/absolute/path/to/DAPA MCP`를 실제 절대경로로 바꾸고 먼저 빌드한다.

### Codex CLI

현재 Codex CLI의 로컬 stdio 등록 명령은 다음 형태다.

```bash
codex mcp add dapa-mcp -- node "/absolute/path/to/DAPA MCP/dist/index.js"
codex mcp list
```

### Claude Code

[Claude Code 공식 MCP 문서](https://code.claude.com/docs/en/mcp)의 stdio 형식을 사용한다.

```bash
claude mcp add --transport stdio dapa-mcp -- \
  node "/absolute/path/to/DAPA MCP/dist/index.js"
claude mcp list
```

Claude Desktop은 현재 로컬 서버를 Desktop Extension으로 배포하는 방식을 권장한다.
v0.1.0은 `.mcpb` 패키지를 제공하지 않으므로 개발 중에는 Claude Code stdio 연결을 사용한다.

### Gemini CLI

[Gemini CLI 공식 MCP 문서](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)에
따라 `~/.gemini/settings.json`의 `mcpServers`에 추가한다.

```json
{
  "mcpServers": {
    "dapa-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/DAPA MCP/dist/index.js"],
      "timeout": 30000,
      "trust": false
    }
  }
}
```

### ChatGPT와 OpenAI API

ChatGPT custom connector와 OpenAI Responses API의 MCP 도구는 원격 MCP `server_url`을
사용한다. v0.1.0은 로컬 stdio 전용이므로 직접 연결을 지원한다고 표시하지 않는다.
Streamable HTTP와 인증이 추가되는 Phase 2 이후
[OpenAI 공식 Remote MCP 문서](https://platform.openai.com/docs/guides/tools-remote-mcp)를
기준으로 연결한다.

## DAPA_info 추가 방법

구조화 항목은 `items` 배열을 가진 JSON으로 작성한다. 필수 필드는 `id`, `name`,
`category`, `description`, `source`, `sourceUrl`, `lastVerifiedAt`, `verified`다.
확인되지 않은 정보는 `verified: false`로 저장하고 공식 사실처럼 표현하지 않는다.
설명 자료는 Markdown으로 두되 법적 근거를 대신하지 않는다고 명시한다.

```json
{
  "items": [
    {
      "id": "term-example",
      "name": "예시 용어",
      "aliases": [],
      "category": "terminology",
      "description": "쉬운 설명",
      "source": "공식 문서명",
      "sourceUrl": "https://example.go.kr/source",
      "lastVerifiedAt": "2026-08-27",
      "verified": false
    }
  ]
}
```

## 개발과 검증

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

테스트는 정규화, 로컬 지식 검색, 공식 API wire fake, 429/5xx/손상 응답,
인용 검증, 실제 stdio MCP 목록·호출을 포함한다.

## 보안과 법률상 주의

- 공개 가능한 정보만 저장한다. 개인정보, 비공개 사업정보, 군사기밀, 내부망 주소를 금지한다.
- MCP 결과는 법률의견이나 정책결정을 대신하지 않는다.
- `verified: true`는 공식 Source에서 해당 데이터를 조회했다는 뜻이지 법적 판단의 보증이 아니다.
- 뉴스는 향후 추가되어도 법적 근거로 사용하지 않는다.

## 데이터 출처와 License

- [국가법령정보 공동활용](https://open.law.go.kr/)
- [방위사업청](https://www.dapa.go.kr/)
- 벤치마크: [korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp), MIT

소스 코드는 [MIT License](./LICENSE)로 배포한다. 제공 데이터의 권리와 이용조건은
각 원 제공기관 정책을 따른다. 자세한 고지는 [NOTICE](./NOTICE)에 있다.
