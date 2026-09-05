# DAPA MCP

DAPA MCP는 대한민국 방위사업 업무를 지원하는 읽기 전용 Model Context Protocol
서버다. LLM의 기억 대신 법제처 국가법령정보 공동활용 Open API와 출처가 표시된
`DAPA_info`를 조회한다. 핵심 원칙은 `Search → Retrieve → Verify → Compare → Cite → Explain`이다.

> v0.1.0 Core와 법령정보 MCP Parity 1차를 구현한다. 로컬 stdio, Vercel용
> Streamable HTTP와 17개 도구, DAPA 공식 법령·행정규칙 카탈로그, 법령 상세 구조화,
> 연혁 조회, 기준일 검색을 제공한다. 특허, 논문, 뉴스, 공개데이터, 신구조문 비교는 아직 구현하지 않았으며
> [ROADMAP.md](./ROADMAP.md)에 구분되어 있다.

## 왜 MCP인가

- 현행 법령과 과거·폐지 규정을 혼동하지 않도록 공식 Source를 우선한다.
- 인용한 법령명·조문·사건번호를 다시 조회해 검증한다.
- 정상 0건인 `NOT_FOUND`와 timeout·429·5xx·손상 응답인 `SOURCE_UNAVAILABLE`을 구분한다.
- 조직·업무 지식에도 출처, 확인일, 검증 여부를 붙인다.

## Architecture

```text
ChatGPT / Claude Web-compatible MCP client ── HTTPS /law ─┐
Codex / Claude Code / Gemini CLI ───────── local stdio ───┤
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
연결한다. 개발용 스크립트에는 인증값을 환경변수로 전달하며 실제 값은 저장소와 셸 명령
기록에 남기지 않는다.

```bash
LAW_API_OC="<your-oc>" npm run audit:dapa-catalog
```

PowerShell에서는 다음처럼 실행한다.

```powershell
$env:LAW_API_OC = "<your-oc>"
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
LAW_API_OC="<your-oc>" npm run backtest:law-api
```

## 환경변수

| 이름 | 필수 | 기본값 | 설명 |
|---|---:|---:|---|
| `LAW_API_OC` | 예 | 없음 | 국가법령정보 공동활용 인증값; 환경변수 또는 로컬 `.env`로 설정 |
| `LAW_API_TIMEOUT_MS` | 아니오 | `15000` | 개별 공식 API 요청 timeout; Vercel 함수 한도 안에서 부분 결과를 반환하도록 제한 |
| `LAW_API_RETRY_LIMIT` | 아니오 | `1` | 429/5xx 및 빈 응답·점검 HTML 재시도 상한 |
| `LAW_API_CACHE_TTL_MS` | 아니오 | `300000` | API 검색 캐시 TTL(밀리초), `0`이면 캐시 비활성화 |
| `LAW_API_DETAIL_CACHE_TTL_MS` | 아니오 | `21600000` | 법령 상세 본문 캐시 TTL(기본 6시간), `0`이면 캐시 비활성화 |
| `LAW_API_MAX_TEXT_RESPONSE_BYTES` | 아니오 | `8388608` | JSON/HTML API 응답 최대 바이트 |
| `LAW_API_MAX_RESOURCE_RESPONSE_BYTES` | 아니오 | `26214400` | 별표·서식 파일 최대 바이트 |
| `LAW_API_MAX_CONCURRENCY` | 아니오 | `8` | 서버 인스턴스 하나가 국가법령정보에 동시에 보내는 요청 상한; 모든 법령 Provider가 공유 |
| `LAW_API_MAX_QUEUE` | 아니오 | `128` | 서버 인스턴스별 공식 API 대기 요청 상한; 초과 요청은 빠르게 제한 오류로 반환 |
| `LAW_API_CONTENT_SEARCH_BUDGET_MS` | 아니오 | `25000` | 통합 목록·본문 검색 전체 시간 예산; 남은 시간이 없으면 새 공식 API 호출을 시작하지 않고 부분 결과 반환 |
| `LAW_API_MAX_TOOL_RESPONSE_CHARS` | 아니오 | `250000` | 법령 API MCP 도구의 JSON 출력 최대 문자 수 |
| `LAW_API_REFERER` | 아니오 | `https://www.law.go.kr/` | 클라우드에서 공식 API에 전달할 Referer |
| `LAW_API_USER_AGENT` | 아니오 | `dapa-mcp/0.1 (...)` | 공식 API에 전달할 서버 식별자 |
| `MCP_MAX_REQUEST_BYTES` | 아니오 | `1048576` | HTTP MCP 요청 본문 최대 바이트(1 MiB) |
| `DAPA_INFO_PATH` | 아니오 | `./DAPA_info` | 공개지식 루트 |

서버는 `LAW_API_OC` 환경변수 또는 로컬 `.env`에 설정된 인증값을 사용한다. 인증값 자체는
저장소, 문서, URL, 로그에 기록하지 않는다. `.env`는 Git에서 제외된다. 값이 없으면 서버는
시작되지만 `source_health`에서 `law: not_configured`로 알려 주고 법령 API 호출은 하지 않는다.

### 국가법령정보 API 설정

국가법령정보 공동활용 인증값을 발급받은 뒤 MCP Client가 서버를 시작할 때 `LAW_API_OC`
환경변수로 전달하고, `source_health`에서
`law: healthy`를 확인한다. 공개 Vercel 배포에서는 Project Settings의 환경변수에 저장하고
문서나 클라이언트 설정에 값을 직접 넣지 않는다.

### 조직 배포 기준

여러 직원이 사용하는 운영 구성은 다음 흐름을 기준으로 한다.

```text
직원용 LLM → 조직 OAuth/SSO → DAPA MCP 여러 인스턴스 → 공용 Redis 캐시 → 국가법령정보 API
                                      └→ 지연·오류율·호출량 모니터링
```

현재 저장소는 공식 데이터 파싱, 인스턴스 안의 검색·본문 캐시, 동일 검색 병합,
공식 API 동시 호출 상한과 통합 검색 시간 예산을 제공한다. 반면 조직 사용자 인증과
인스턴스 사이의 공용 Redis 캐시는 배포 환경의 인증 제공자와 저장소를 선택해야 하므로
기본 코드에 임의의 사업자나 계정을 고정하지 않는다. 운영 전에는 `No authentication`
구성을 조직 OAuth로 바꾸고, 사용자별 rate limit과 공용 캐시를 연결해야 한다.

## MCP 도구

| 도구 | 역할 |
|---|---|
| `search_legal` | 법령·행정규칙·자치법규·판례·헌재·해석례·행정심판 검색 |
| `search_legal_content` | 법령·행정규칙·자치법규·판례·헌재·해석례·행정심판의 자연어 본문검색; 자료 유형 자동 판별, 최대 500자, 기본 `fast`, 전체 검토는 `thorough` |
| `get_legal_detail` | 검색 결과 `documentId` 상세조회 |
| `get_legal_history` | 법령 제정·개정·폐지 연혁 조회 |
| `list_legal_apis` | DAPA 관련 국가법령정보 14개 범주·40개 목록/본문 API 카탈로그 조회 |
| `query_legal_api` | 카탈로그 `apiId`로 공식 목록·본문을 온디맨드 조회 |
| `get_legal_api_body` | 목록 `apiId`와 결과 식별자로 본문 API 자동 연결; 별표·서식 파일 본문 추출 |
| `verify_citations` | 법령명·조문번호·표기된 조문제목과 사건번호 검증 |
| `search_dapa_info` | 조직·용어·업무 공개지식 검색 |
| `get_dapa_organization` | 조직명·별칭 상세조회 |
| `search_dapa_policy` | 업무·정책 메뉴와 하위 탭의 본문 검색 |
| `get_dapa_policy_page` | 검색 결과 ID로 업무·정책 전체 본문 조회 |
| `search_dapa_legal_catalog` | DAPA 공식 법령·행정규칙 목록 검색 |
| `get_dapa_legal_catalog_item` | DAPA 공식 목록 항목 상세조회 |
| `get_dapa_legal_content` | DAPA 항목을 국가법령정보 본문과 연결해 조회 |
| `dapa_catalog_status` | DAPA 공식 목록 동기화 상태 |
| `source_health` | Provider 설정과 상태 확인 |

### 서버 답변 지침

MCP 서버는 연결 초기화 때 Codex, Claude 등 지원 클라이언트에 답변 지침을 전달한다.
지침은 다음 원칙을 적용한다.

- 국가법령정보 공동활용 API의 최신 본문을 최우선 근거로 사용하고, DAPA 카탈로그는
  소관 범위와 분류를 확인하는 보조자료로 사용한다.
- 별도 기관 지정이 없는 직원 질문은 방위사업청 업무 질문으로 해석한다. 같은 용어가
  여러 기관에 있으면 방위사업청 소관·공동소관 또는 방위사업청 업무에 직접 적용되는
  법령·행정규칙·판례·해석례를 먼저 검토하고, 다른 기관 자료는 비교·보충 근거로 분리한다.
- 같은 용어나 쟁점이 여러 법령·행정규칙에 있으면 대표 문서 하나에서 멈추지 않고
  서로 독립적으로 관련된 모든 문서의 본문을 확인한다. 예를 들어 `야전운용시험`은
  `방위사업관리규정`과 `국방전력발전업무훈령`을 각각 조회하고 다른 관련 문서도 확인한다.
- 법령·행정규칙의 문서명과 제○조 제○항 제○호, 별표·서식 번호를 원문에 존재하는
  수준까지 표시한다. 판례·결정례·해석례는 사건·안건번호, 날짜와 판단 위치를 표시한다.
- 법령·행정규칙뿐 아니라 판례, 헌재결정례, 법령해석례, 행정심판례와 지원되는 공식 API
  범주를 함께 조회한다. 0건, API 미지원, 인증 실패와 출처 장애를 구분해 알린다.
- 검색 결과는 법률 자문이나 정답이 아니라 공식 근거에 기반한 검토 방향이다. 적용 가능성,
  해석상 쟁점과 추가 확인사항을 밝히며 최종 판단은 담당자가 원문과 사실관계를 확인해 수행한다.

권장 답변 순서는 `[검토 범위]` → `[방위사업청 우선 근거]` →
`[다른 기관 비교·보충 근거]` → `[조회 결과 없음 또는 한계]` → `[검토 방향]` →
`[사람의 최종 확인]`이다. 제목이나 검색 메타데이터만으로 관련성을 확정하지 않고 후보별
상세 본문을 확인한 뒤 인용한다.

`committee_decision`은 입력 계약만 제공하고 실제 Provider는 아직 설정하지 않는다.
`asOfDate`는 법제처 `eflaw` 기준일 검색으로 처리하며, 해당 기준일 자료가 없으면
`NOT_FOUND`를 반환한다. `currentOnly` 기본값은 `true`이며, 행정규칙도 명시적인 연혁·폐지
상태를 제외한다. 과거 자료가 필요하면 `currentOnly: false`를 사용하고, 최신 API 재조회가
필요하면 `forceRefresh: true`를 사용한다. 성공한 검색 결과의 기본 캐시 TTL은 5분이다.
`query_legal_api`와 `get_legal_api_body`도 같은 `currentOnly`·`asOfDate` 입력을 사용하며,
응답의 `temporalScope`로 적용 범위(`current`, `all`, `as_of`, `not_applicable`)를 확인할 수 있다.
법령·행정규칙 외 구분은 시간 필터가 적용되지 않으면 `not_applicable`로 명시한다.

`search_legal_content`의 기본 `fast` 모드는 법령·행정규칙·자치법규·판례·헌재결정례·법령해석례·행정심판례에서 입력 문장과 핵심 용어로 첫 페이지를 조회하고,
상위 3개 본문에서 직접 근거가 확인되면 즉시 반환한다. 근거가 부족할 때만 요청한 `limit` 범위에서
최대 5개까지 확장한다. `thorough` 모드는 검색어 최대 3개·2페이지·본문 최대 10개를 확인한다.
본문 요청은 작은 묶음으로 제한하며 동일 검색과 동일 문서의 동시 요청은 하나로 합치고 성공한 상세 본문은
기본 6시간 재사용한다. 본문에서 질의가 확인된 결과는 `match: "content"`, 검색 메타데이터만
일치한 결과는 `match: "metadata"`로 구분한다. 법령·행정규칙은 관련 조문을, 판례 계열은 관련 판단 원문을 `excerpts`로 제한해 반환한다. 한 후보가 여러 국가법령정보 문서와 연결되면
`get_dapa_legal_content`의 `matches` 배열에 각 문서의 본문을 모두 반환한다.

동시 직원 요청은 서버 인스턴스별 `LAW_API_MAX_CONCURRENCY` 상한을 공유해 국가법령정보
API로 한꺼번에 몰리지 않게 하고, `LAW_API_MAX_QUEUE`를 넘는 요청은 무한 대기시키지 않는다.
목록과 본문 조회, 대기열은 모두 같은 전체 시간 예산을 사용한다. 이 메모리 캐시와 상한은 Vercel의 서로 다른 함수
인스턴스 사이에는 공유되지 않는다. 조직 운영에서는 Redis 같은 공용 캐시, 사용자 인증,
사용자별 rate limit과 지연·오류율 모니터링을 배포 계층에 별도로 구성해야 한다.

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

Vercel 배포 후 ChatGPT 개발자 모드의 앱 생성 화면에
`https://<Vercel 도메인>/law`를 입력한다. 개인 개발·검증 배포만 **No authentication**을
사용할 수 있고, 직원용 운영 배포는 회사 OAuth/SSO가 세 MCP 경로를 모두 보호해야 한다.
Vercel의 일반 로그인 화면이 아니라 MCP 클라이언트가 사용할 수 있는 OAuth 인증이어야 한다.

Vercel 배포 체크리스트와 ChatGPT, Claude, Gemini, Codex의 등록 절차는
[클라이언트 연결 가이드](./docs/REMOTE_MCP.md)를 따른다.

### GitHub Pages 정책 페이지

Plugin 공개 심사에 사용할 개인정보처리방침과 이용약관은 `docs/`에 정적 페이지로 제공한다.
저장소 Settings → Pages에서 Source를 **GitHub Actions**로 한 번 선택하면 `main`의 변경 때마다
자동 배포된다. 배포 후 주소는 다음과 같다.

- 개인정보처리방침: `https://ai-studying-man.github.io/DAPA-MCP/privacy/`
- 이용약관: `https://ai-studying-man.github.io/DAPA-MCP/terms/`
- 서비스 안내: `https://ai-studying-man.github.io/DAPA-MCP/`

이 주소들은 Plugin 메타데이터의 Website, Privacy policy URL, Terms of Service URL에 사용한다.
MCP 서버 연결 주소인 `https://dapa-law-mcp.vercel.app/law`와는 구분한다.

### ChatGPT·Codex 플러그인 마켓플레이스

저장소에는 원격 DAPA MCP 앱을 참조하는 플러그인 패키지와 GitHub 마켓플레이스
카탈로그가 포함되어 있다. 플러그인은 `.app.json`으로 ChatGPT에 등록된 앱을 참조하므로
GPT 웹과 Codex의 지원 화면에서 함께 사용할 수 있다.

플러그인 페이지에서 마켓플레이스를 추가할 때 다음 값을 사용한다.

| 항목 | 값 |
|---|---|
| 출처 | `https://github.com/ai-studying-man/DAPA-MCP` |
| Git ref | `main` |
| Sparse 경로 | 비워 둠 |

마켓플레이스를 추가한 뒤 `DAPA MCP` 플러그인을 설치하고 새 대화를 시작한다. 저장소의
`.app.json`은 기존 원격 앱 연결을 참조할 뿐 새 앱을 생성하거나 접근 권한을 부여하지
않으므로, 조직 배포 시 관리자는 해당 앱과 플러그인을 대상 역할에 허용해야 한다.

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
인용 검증, 실제 stdio 및 Streamable HTTP MCP 초기화·목록·호출을 포함한다.

## 보안과 법률상 주의

- 공개 가능한 정보만 저장한다. 개인정보, 비공개 사업정보, 군사기밀, 내부망 주소를 금지한다.
- 직원용 HTTP 서버는 조직 OAuth/SSO로 `/law`, `/mcp`, `/api/mcp`를 모두 보호하고
  사용자별·조직 전체 rate limit, 허용 Origin, 감사 로그를 적용한다.
- MCP 결과는 법률의견이나 정책결정을 대신하지 않는다.
- `verified: true`는 공식 Source에서 해당 데이터를 조회했다는 뜻이지 법적 판단의 보증이 아니다.
- 뉴스는 향후 추가되어도 법적 근거로 사용하지 않는다.

## 데이터 출처와 License

- [국가법령정보 공동활용](https://open.law.go.kr/)
- [방위사업청](https://www.dapa.go.kr/)
- 벤치마크: [korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp), MIT

소스 코드는 [MIT License](./LICENSE)로 배포한다. 제공 데이터의 권리와 이용조건은
각 원 제공기관 정책을 따른다. 자세한 고지는 [NOTICE](./NOTICE)에 있다.
