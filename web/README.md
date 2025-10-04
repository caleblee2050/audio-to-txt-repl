# 음성→텍스트 정리 및 문자 발송 웹앱

브라우저에서 음성을 연속 인식하여 텍스트로 누적 기록하고, 원하는 형식(공문/회의록/요약문/블로그 글/문자 안내문)에 맞게 Gemini로 문서를 생성한 뒤 Twilio로 문자(SMS) 발송까지 지원합니다.

## 주요 기능
- 아이콘/버튼 한 번으로 녹음 시작, 정지까지 연속 기록
- 긴 발화도 끊지 않고 누적(브라우저 SpeechRecognition, Chrome 권장)
- 5가지 문서 형식 선택(숨은 프롬프트 적용) 후 Gemini로 자동 작성
- 문서 수정/삭제/저장(브라우저 로컬 저장소)
- Twilio 연동으로 SMS 발송(서버 .env 설정 필요)

## 빠른 시작
1) 의존성 설치
```
npm i
```

2) 환경변수 설정
- `web/.env.example`를 복사하여 `web/.env`로 생성하고 값 입력:
```
GOOGLE_API_KEY=your_gemini_api_key
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_FROM=+821012345678
PORT=3001
```
- GOOGLE_API_KEY: Google AI Studio에서 발급한 Gemini API Key
- Twilio 항목: Twilio 콘솔에서 `Account SID`, `Auth Token`, 발신번호(`From`) 확인

3) 프론트/백엔드 동시 실행
```
npm run dev:all
```
- 프론트엔드: `http://localhost:5173/`
- 백엔드 API: `http://localhost:3001/` (헬스 체크: `/api/health`)

## 사용 방법
- 녹음 시작 ▶ 을 누르면 음성 인식이 시작되고 정지 ■ 를 누를 때까지 텍스트가 누적됩니다.
- 형식을 선택하고 “지침대로 문서 작성”을 누르면 숨은 프롬프트에 따라 Gemini가 문서를 생성합니다.
- 생성된 문서는 편집 가능하며, 저장 시 로컬 저장소에 보관됩니다. 저장 목록에서 불러오기/삭제가 가능합니다.
- 수신자 번호를 입력하고 “문자 발송”을 누르면 Twilio로 SMS를 전송합니다. UI 하단 메시지로 Twilio 설정 감지 여부를 확인하세요.

## 문제 해결
- 문서 작성 500 오류: 서버 `.env`에 `GOOGLE_API_KEY`가 설정되지 않은 경우입니다. 키 입력 후 서버 재시작.
- Twilio 비활성: `.env`에 Twilio 항목이 누락/오류입니다. 올바른 값으로 설정 후 재시작.
- 브라우저 음성 인식 미지원: Chrome 최신 버전 사용 권장. 일부 환경에서는 SpeechRecognition 지원이 제한될 수 있습니다.

## 폴더 구조(요약)
- `src/App.tsx`: 녹음 UI, 형식 선택, Gemini 작성, 저장/불러오기/삭제, SMS 발송
- `server/index.js`: `/api/compose`(Gemini), `/api/sms/send`(Twilio), `/api/health`
- `.env.example`: 환경변수 템플릿(복사해 `.env`를 만들고 값 입력)