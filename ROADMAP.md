# Roadmap

## v0.1.0 Core (완료)

- stdio MCP 서버와 17개 도구
- 국가법령정보 법령·행정규칙·판례·헌재·해석례·행정심판 검색 어댑터
- DAPA_info 용어·조직 검색
- 인용 파싱·온라인 검증
- 장애와 NOT_FOUND 분리

## Phase 1.5 Legal MCP Parity (진행 중)

- 범용 법령정보 MCP 계층을 DAPA 전문 계층과 분리
- 법령 상세의 기본정보·조문·부칙·개정문·제개정이유·별표·서식 구조화
- 법령 제정·개정·폐지 연혁(`lsHistory`) 조회
- 특정 기준일 적용 법령 검색(`eflaw`)
- 남은 작업: 법제처 전체 API 표면, 조문 단위 조회, 신구조문 비교, 연혁 페이징,
  판례 본문·인용 내용 검증

## Phase 2A DAPA Official Legal Catalog (완료)

- DAPA 공식 법령 페이지 4개 분야 목록 수집
- DAPA 행정규칙 페이지네이션 전체 수집 및 2,626건 스냅샷
- 법령·행정규칙 분류, 발령번호, 발령일자, DAPA 원문 출처 보존
- 카탈로그 검색·항목 조회·동기화 상태 MCP 도구
- DAPA 카탈로그 ID와 국가법령정보 문서 ID 자동 매칭 후 본문 조회
- 국가법령정보 API 기준 카탈로그 커버리지 감사 및 미매칭 JSON 리포트
- 국가법령정보 API 본문 Provider와 DAPA 카탈로그 Provider 분리

## Phase 2B Public Knowledge (진행 예정)

- Streamable HTTP(127.0.0.1 기본, 인증·Origin·rate limit 포함)
- 방위사업청 공개데이터 및 국방표준
- 공식 보도자료, KIPRISPlus, KCI/ScienceON Provider
- Source별 TTL과 요청 예산 고도화

## Phase 3 Advanced Legal Intelligence

- 특정 시점 적용 법령과 연혁 비교
- 신구조문·별표·서식
- 판례 유사도와 관련법 그래프
- 감사 사례와 법령해석 연결

## Phase 4 Private Integration

- 승인된 Private Deployment에서만 계약·사업·원가·조달 내부 Provider 활성화
- 기본값은 비활성화이며 공개 저장소에는 내부 주소나 인증정보를 두지 않음
