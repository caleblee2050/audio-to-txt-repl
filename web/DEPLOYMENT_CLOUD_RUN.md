# Cloud Run 배포 및 도메인 연결 가이드 (AIttx.nolmong.co.kr)

이 문서는 Google Cloud Run으로 배포하고, 가비아에서 등록한 `nolmong.co.kr`의 서브도메인 `AIttx.nolmong.co.kr`을 서비스에 연결하는 절차를 설명합니다.

## 사전 준비
- Google Cloud 프로젝트 생성 및 결제 설정
- IAM 권한: 배포자 계정에 최소 `Cloud Run Admin`, `Cloud Build Editor` 권한 권장
- API 활성화: Cloud Run Admin API, Cloud Build API, Artifact Registry

## 코드/런타임 구성 요약
- 서버: Express (`web/server/index.js`)가 `/api/*` 제공, 빌드된 프론트엔드를 `/dist`에서 정적 서빙 및 SPA 폴백
- 빌드: `npm run build`로 Vite 번들 생성
- 실행: `npm start`로 서버 실행 (Cloud Run은 기본 `PORT=8080`을 컨테이너에 주입하며, 서버는 `process.env.PORT`를 사용)
- Dockerfile: `web/Dockerfile` 멀티스테이지(빌드/런타임) 구성

## 배포 (gcloud, 소스에서 직접)
아래 명령은 `web` 폴더 기준입니다.

1) 빌드 확인 (선택)
```
npm run build
```

2) Cloud Run 배포 (소스에서 바로)
```
gcloud run deploy aittx-service \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --update-env-vars GOOGLE_API_KEY=YOUR_KEY,TWILIO_ACCOUNT_SID=SID,TWILIO_AUTH_TOKEN=TOKEN,TWILIO_PHONE_FROM=+8210XXXXXXX
```
- `--region`: 서울 리전 사용 시 `asia-northeast3`를 고려하되, 커스텀 도메인 매핑 제한사항 때문에 `asia-northeast1`(도쿄) 등 사용을 권장할 수 있습니다.
- `--allow-unauthenticated`: 공개 접근 허용
- `--update-env-vars`: 운영 환경변수를 컨테이너에 주입 (로컬 `.env`는 VCS에서 제외됨)

참고: Dockerfile이 존재하므로 `--source .`는 Dockerfile 기반으로 이미지를 빌드합니다.([Cloud Run Source Deploy 문서](https://cloud.google.com/run/docs/deploying-source-code))

3) 배포 URL 테스트
- 배포 후 출력되는 Cloud Run 기본 URL(예: `https://aittx-service-xxxxx-run.app`)로 접속
- `GET /api/health`로 환경 구성 확인 (`geminiConfigured`가 true)

## 커스텀 도메인 연결 (빠른 방법: Domain Mappings)
Cloud Run의 도메인 매핑 기능으로 `AIttx.nolmong.co.kr`을 서비스에 연결합니다.([Cloud Run 도메인 매핑 문서](https://cloud.google.com/run/docs/mapping-custom-domains))

1) 도메인 소유권 검증
- Cloud Console에서 Domain Mappings 추가 시 `nolmong.co.kr`의 소유권 검증 필요
- 안내에 따라 Search Console 검증용 TXT 레코드를 가비아 DNS에 추가

2) 서비스에 도메인 매핑 추가
- Cloud Run 콘솔 → Domain mappings → `Add Mapping`
- 서비스 선택 후 `AIttx.nolmong.co.kr` 입력하여 매핑 생성

3) 가비아 DNS 설정
- 매핑 생성 마지막 단계에 표시되는 DNS 레코드 타입(A/AAAA/CNAME)에 맞춰 가비아 DNS에 추가합니다.
- 일반적으로 서브도메인은 `CNAME`으로 `ghs.googlehosted.com`을 가리키는 항목이 제공됩니다.
- 예시:
```
호스트: AIttx
타입: CNAME
값: ghs.googlehosted.com
TTL: 1시간 (기본)
```
- 경우에 따라 A/AAAA 레코드가 제시될 수 있으며, 해당 값 그대로 입력합니다.

4) 인증서 발급 대기
- Google 관리형 인증서가 자동 발급/갱신됩니다. 보통 15분~24시간 대기 필요

주의: Cloud Run 도메인 매핑은 프리뷰 제한사항이 있어 프로덕션에는 글로벌 외부 HTTP(S) 로드 밸런서를 권장합니다.([문서](https://cloud.google.com/run/docs/mapping-custom-domains))

## 권장 방법: 글로벌 외부 HTTP(S) 로드 밸런서
프로덕션 품질로 도메인/인증서/보안/캐싱 제어가 필요한 경우 다음을 권장합니다.
- 서버리스 NEG로 Cloud Run 서비스를 대상 그룹으로 등록
- HTTPS 로드 밸런서 생성 및 `AIttx.nolmong.co.kr`용 관리형 인증서 연결
- Cloud DNS에서 A/AAAA 레코드를 LB IP로 설정

## 가비아 DNS 팁
- `AIttx.nolmong.co.kr`처럼 서브도메인 매핑은 일반적으로 CNAME을 사용합니다. Cloud Run에서 출력한 레코드를 그대로 입력하세요.
- `www` 서브도메인을 추가로 연결하려면 `www.nolmong.co.kr`도 별도 매핑 후 CNAME으로 연결하세요.([사례: CNAME → ghs.googlehosted.com](https://serverfault.com/questions/1053154/how-to-map-google-domains-domain-name-to-google-cloud-run-project-i-cant-make))

## 운영 체크리스트
- 환경변수는 Cloud Run 서비스 리비전별로 관리 (`--update-env-vars`)
- 로그/모니터링: Cloud Logging/Monitoring
- 헬스체크: `GET /api/health`
- 새 기능 반영: `gcloud run deploy`로 리비전 갱신