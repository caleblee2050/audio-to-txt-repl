# 음성→텍스트 정리 웹앱 (Google STT 적응 + 퍼지 교정)

브라우저에서 음성을 연속 인식하여 텍스트로 누적 기록하고, 원하는 형식(공문/회의록/요약문/블로그 글/문자 안내문)에 맞게 Gemini로 문서를 생성합니다. 추가로 Google Speech-to-Text API의 Speech Adaptation(힌트)로 최초 인식률을 높이고, 퍼지 매칭(Fuzzy Matching)으로 이름/고유명사 교정을 후처리합니다.

## 주요 기능
- 아이콘/버튼 한 번으로 녹음 시작, 정지까지 연속 기록
- 긴 발화도 끊지 않고 누적(브라우저 SpeechRecognition, Chrome 권장)
- 5가지 문서 형식 선택(숨은 프롬프트 적용) 후 Gemini로 자동 작성
- 문서 수정/삭제/저장(브라우저 로컬 저장소)
- Google STT Speech Adaptation으로 이름/고유명사 인식 강화
- 퍼지 매칭으로 남은 오류(이름)를 자동 교정

## 빠른 시작
1) 의존성 설치
```
npm i
```

2) 환경변수 설정
- `web/.env.example`를 복사하여 `web/.env`로 생성하고 값 입력:
```
GOOGLE_API_KEY=your_gemini_api_key
PORT=3001
```
- GOOGLE_API_KEY: Google AI Studio에서 발급한 Gemini API Key
  (서버에서 Gemini 요약에만 사용합니다)

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
- STT(적응) 섹션에서 GCS 오디오 URI와 이름/고유명사 목록을 입력하여 서버의 `/api/stt/recognize`로 변환을 요청할 수 있습니다.
- STT 결과를 받은 뒤, 퍼지 교정을 눌러 `/api/text/correct-names`로 후처리하여 이름 인식 오류를 자동 보정합니다.

## 문제 해결
- 문서 작성 500 오류: 서버 `.env`에 `GOOGLE_API_KEY`가 설정되지 않은 경우입니다. 키 입력 후 서버 재시작.
- STT 변환 오류: GCS URI가 올바른지, 오디오 인코딩/샘플레이트가 설정과 일치하는지 확인하세요.
- 브라우저 음성 인식 미지원: Chrome 최신 버전 사용 권장. 일부 환경에서는 SpeechRecognition 지원이 제한될 수 있습니다.

## 폴더 구조(요약)
- `src/App.tsx`: 녹음 UI, 형식 선택, Gemini 작성, 저장/불러오기/삭제, STT(적응) + 퍼지 교정 UI
- `server/index.js`: `/api/compose`(Gemini), `/api/stt/recognize`(Google STT 적응), `/api/text/correct-names`(퍼지 교정), `/api/health`
- `.env.example`: 환경변수 템플릿(복사해 `.env`를 만들고 값 입력)