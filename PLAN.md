# 프로젝트 계획 및 진행 상황

작성일: 2025-10-07

## 현재 단계: 도메인/DNS 설정
- 상태: 완료
- 내용:
  - Gabia에서 `aittx` CNAME을 `ghs.googlehosted.com`으로 수정 완료.
  - 공용 DNS(`dns.google`) 조회 결과 변경 사항이 정상 반영됨.
  - Cloud Run 도메인 매핑은 인증서 발급 대기 상태(시스템이 1시간 간격으로 재시도).

## 다음 단계
- 15–60분 후 Cloud Run 도메인 매핑 상태 재확인.
- 목표: `Ready True`로 변경 확인 및 `https://aittx.nolmong.co.kr` 정상 접속.

## 체크리스트
- [x] Gabia CNAME 수정 (aittx → ghs.googlehosted.com)
- [x] 공용 DNS 확인
- [ ] Cloud Run 인증서 발급 확인
- [ ] 최종 접속 테스트(HTTPS)

## 참고 명령
```
gcloud beta run domain-mappings describe \
  --region asia-northeast1 \
  --domain aittx.nolmong.co.kr \
  --format='table(status.conditions.type,status.conditions.status,status.conditions.reason,status.conditions.message,status.resourceRecords)'
```