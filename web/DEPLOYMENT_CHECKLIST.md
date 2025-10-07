# 배포·도메인 연결 사용자 체크리스트

이 체크리스트는 당신이 직접 해야 하는 동작만 모았습니다. 아래 순서대로 진행하세요.

## 1) PC 준비(한 번만)
- gcloud CLI 설치: https://cloud.google.com/sdk/docs/install
- 로그인: `gcloud auth login`
- 프로젝트 선택: `gcloud config set project <YOUR_PROJECT_ID>`
- 리전 설정(도메인 매핑 지원 리전 권장): `gcloud config set run/region asia-northeast1`
- 필수 API 활성화:
  - `gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com`
- 결제 설정(미설정 시): Cloud Console → Billing → 프로젝트 연결

## 2) 환경변수 설정(웹 서버)
- `web/.env.example`를 복사해 `web/.env` 생성
- 다음 값 입력:
  - `GOOGLE_API_KEY=` Gemini API 키
  - `TWILIO_ACCOUNT_SID=` (선택) 문자 발송용 SID
  - `TWILIO_AUTH_TOKEN=` (선택) 문자 발송용 토큰
  - `TWILIO_PHONE_FROM=` (선택) 문자 발신번호(+8210… 등)
- 주의: `.env`는 이미 `.gitignore`에 포함되어 있어 Git에 올라가지 않습니다.

## 3) 배포 실행(소스에서 바로)
- 터미널 작업 디렉토리: `cd web`
- 간편 배포 스크립트 실행: `./deploy_cloud_run.sh`
  - 스크립트가 Vite 빌드 후 Cloud Run에 Dockerfile로 배포합니다.
  - 기본 서비스명: `aittx-service`, 리전: `asia-northeast1`
  - `.env`가 있으면 환경변수를 자동 주입합니다.
- 직접 명령으로 배포(원하면):
```
gcloud run deploy aittx-service \
  --source . \
  --region asia-northeast1 \
  --no-invoker-iam-check \
  --ingress all \
  --update-env-vars GOOGLE_API_KEY=<키>,TWILIO_ACCOUNT_SID=<SID>,TWILIO_AUTH_TOKEN=<TOKEN>,TWILIO_PHONE_FROM=<+8210…>
```
참고:
- 일부 조직 정책(예: 도메인 제한 공유)이 `--allow-unauthenticated`를 차단할 수 있습니다. 이 경우 `--no-invoker-iam-check`와 `--ingress all` 조합을 사용하세요.
- 최신 gcloud가 필요할 수 있으니 `gcloud components update` 후 실행하세요.

## 4) 배포 확인
- 배포 완료 후 출력된 Cloud Run URL(예: `https://aittx-service-xxxxx-run.app`) 접속
- 헬스 체크: `curl -s https://<SERVICE_URL>/api/health`
  - `{"ok":true, "geminiConfigured":true}` 확인

## 5) 커스텀 도메인 연결(AIttx.nolmong.co.kr)
- Cloud Console → Cloud Run → Domain mappings → `Add Mapping`
  - 서비스: `aittx-service`
  - 호스트명: `AIttx.nolmong.co.kr` (DNS 입력 시 일반적으로 소문자 `aittx` 사용)
- 안내에 나온 도메인 소유권 검증(TXT)이 있다면 가비아 DNS에 추가
- 마지막 단계에 표기된 DNS 레코드 값을 가비아에 그대로 등록
  - 서브도메인은 보통 `CNAME`으로 `ghs.googlehosted.com`을 가리키는 값이 제공됩니다.
  - 경우에 따라 `A/AAAA` IP가 제공될 수 있으니 콘솔에 나온 값을 그대로 사용하세요.
- 가비아 DNS 등록 후 인증서 대기(보통 15분~24시간)
  - 확인: `nslookup aittx.nolmong.co.kr` 로 레코드가 보이는지 확인

## 6) 최종 확인
- 브라우저에서 `https://AIttx.nolmong.co.kr` 접속
- UI 작동 및 `/api/health` 응답 확인
- 필요한 경우 Cloud Run 콘솔에서 환경변수 수정 후 다시 배포

## 7) 운영(필요 시)
- 로그: Cloud Logging에서 서비스 로그 확인
- 재배포: 코드 변경 후 `cd web && ./deploy_cloud_run.sh`
- 문자 발송 기능 사용 시 Twilio 값이 올바른지 점검

---

질문이나 오류가 생기면, 오류 메시지와 현재 단계(체크리스트 번호)를 알려주세요. 거기서 이어서 도와드리겠습니다.