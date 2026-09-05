# DAPA MCP 배포와 클라이언트 연결

## 배포 구조

```text
ChatGPT / 원격 MCP 클라이언트
    │ https://<도메인>/law
    ▼
Vercel Streamable HTTP DAPA MCP ── 국가법령정보 API (`OC=서버 내부 설정값`)

Codex / Claude Code / Gemini CLI
    │ local stdio
    └── 로컬 clone의 dist/index.js
```

공개 HTTPS 방식은 직원 PC에 Git, Node.js 또는 터널을 설치하지 않아도 된다. 다만 조직 운영에서는
반드시 회사 OAuth/SSO로 직원을 인증하고 사용자별 호출 제한과 감사 로그를 적용해야 한다. 현재 저장소의
HTTP 엔드포인트는 인증 기능이 없는 개발·검증용이므로 인터넷에 공개한 채 운영하지 않는다. 국가법령정보 API 인증값은 서버 내부 설정으로만 사용한다. GitHub URL
자체는 MCP 주소가 아니고, Vercel이 배포한 HTTPS URL이 MCP 주소다. 인증값은 저장소, URL,
로그와 클라이언트 설정에 기록하지 않는다.

## 1. Vercel Production 배포

Vercel의 New Project에서 GitHub `ai-studying-man/DAPA-MCP`의 `main`을 선택한다.

| 설정 | 값 |
|---|---|
| Framework Preset | `Other` |
| Root Directory | `./` |
| Build Command | 자동 감지 값을 유지 |
| Output Directory | 비움 |
| Install Command | `npm install` 자동 감지 |
| Node.js | 24.x 권장 |

저장소의 `vercel.json`이 MCP 함수에 `DAPA_info`를 포함하고, 최대 실행시간 60초와 다음 경로를
설정한다.

- 직원 등록용: `https://<project>.vercel.app/law`
- 표준 별칭: `https://<project>.vercel.app/mcp`
- 원본 함수: `https://<project>.vercel.app/api/mcp`
- 상태 확인: `https://<project>.vercel.app/health`

서버에 설정된 기본값으로도 동작할 수 있지만, 운영 배포에서는 Vercel Project Settings의
Environment Variables에 `LAW_API_OC`를 저장하는 방식을 권장한다. `.env` 파일과 인증값은
배포하지 않는다.

배포 후 Vercel에서 다음을 확인한다.

1. 회사 OAuth/SSO 프록시 또는 MCP 인증 계층이 `/law`, `/mcp`, `/api/mcp`를 보호하는지 확인한다.
2. `/health`가 HTTP 200과 `{"status":"ok"}`를 반환하는지 확인한다.
3. Firewall에서 Request Path가 `/law` 또는 `/api/mcp`인 요청에 IP별 rate limit을 설정한다.
   초기값은 1분당 60회로 시작하고 실제 사용량을 본 뒤 조정한다.
4. Function Logs에서 OC가 포함된 국가법령정보 전체 URL이 기록되지 않는지 확인한다.
5. 커스텀 도메인을 연결하면 최종 주소를 `https://mcp.gomdori.app/law`처럼 고정한다.

## 2. ChatGPT 등록

현재 ChatGPT의 전체 MCP 앱은 플랜과 워크스페이스 권한에 따라 사용 가능 범위가 다르다.
관리자가 개발자 모드 또는 사용자 지정 MCP 앱 권한을 먼저 허용해야 한다.

1. ChatGPT 웹에서 **Settings → Apps → Advanced Settings**의 Developer mode를 켠다.
2. **Settings → Apps → Create** 또는 워크스페이스의 **Apps → Create**를 연다.
3. 이름에 `DAPA MCP`, endpoint에 `https://<도메인>/law`를 입력한다.
4. 인증 방식은 회사 관리자가 구성한 **OAuth**를 선택한다. 개발용 공개 배포에서만 `No authentication`을 사용한다.
5. **Scan Tools**를 눌러 읽기 전용 도구 17개가 표시되는지 확인하고 생성한다.
6. 새 채팅의 도구 메뉴에서 DAPA MCP를 선택해 `source_health`를 호출한다.

관리자가 앱을 워크스페이스에 게시하면 직원은 각자 서버 주소를 다시 입력하지 않고 승인된
앱을 활성화할 수 있다. 비공개망 또는 로컬 서버가 아니므로 Secure MCP Tunnel은 사용하지 않는다.

## 3. Claude와 Gemini의 원격 연결

원격 MCP URL을 받는 Claude 또는 Gemini 제품에서는 transport를 Streamable HTTP로 선택하고
동일한 `https://<도메인>/law`를 등록한다. 제품별 UI와 플랜 지원 여부는 바뀔 수 있으므로
등록 화면에 원격 MCP URL 입력란이 없는 클라이언트는 아래 로컬 stdio 방식을 사용한다.

## 4. 로컬 stdio 설치

Node.js 20.19 이상과 Git이 있는 PC에서는 다음처럼 설치한다.

```powershell
git clone https://github.com/ai-studying-man/DAPA-MCP.git "C:\DAPA-MCP"
Set-Location "C:\DAPA-MCP"
npm ci
npm run build
npm run check
```

Codex CLI:

```powershell
codex mcp add dapa-mcp -- node "C:\DAPA-MCP\dist\index.js"
codex mcp list
```

Claude Code:

```powershell
claude mcp add --transport stdio dapa-mcp -- node "C:\DAPA-MCP\dist\index.js"
claude mcp list
```

Gemini CLI의 `%USERPROFILE%\.gemini\settings.json`:

```json
{
  "mcpServers": {
    "dapa-mcp": {
      "command": "node",
      "args": ["C:\\DAPA-MCP\\dist\\index.js"],
      "timeout": 30000,
      "trust": false
    }
  }
}
```

## 5. 직원 검증 시나리오

1. `source_health`에서 `law`, `dapa_info`, `dapa_catalog`, `dapa_policy`가 `healthy`인지 확인한다.
2. `야전운용시험의 관련 규정과 근거 조문을 모두 찾아줘`라고 질문한다.
3. `방위사업관리규정`과 `국방전력발전업무훈령`을 각각 식별하고 두 최신 본문을 모두
   조회하는지 확인한다.
4. 판례·헌재결정례·법령해석례·행정심판례의 0건과 API 장애를 구분하는지 확인한다.
5. 문서명, 조·항·호 또는 사건·안건번호, 공식 출처와 사람의 최종 확인 필요성을 표시하는지
   확인한다.

## 6. 장애 판별

| 증상 | 우선 확인 |
|---|---|
| `/health`가 열리지 않음 | Vercel 배포 실패 또는 Deployment Protection |
| Scan Tools 실패 | endpoint가 `/law`인지, HTTPS인지, Production 접근이 공개인지 확인 |
| 도구는 보이나 법령 호출 실패 | `source_health`, Vercel Function Logs, 법제처 응답 상태 확인 |
| DAPA 카탈로그가 unavailable | `DAPA_info/**`가 함수 번들에 포함됐는지 확인 |
| 429가 반복됨 | Vercel Firewall과 호출 빈도 조정, 잠시 후 재시도 |
