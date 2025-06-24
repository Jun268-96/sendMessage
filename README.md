# 📚 교사-학생 메시지 전송 시스템

실시간으로 교사가 학생 태블릿에 메시지를 전송할 수 있는 웹 기반 PWA 시스템입니다.

## ✨ 주요 기능

### 🧑‍🏫 교사 기능
- **다중 교사 시스템**: 교사별 6자리 고유번호로 완전 분리된 시스템
- **실시간 메시지 전송**: Socket.IO 기반 즉시 메시지 전달
- **학생 관리**: 연결된 학생 목록 실시간 확인
- **개별/전체 선택**: 특정 학생 또는 전체 학생에게 메시지 전송
- **메시지 히스토리**: 전송한 메시지 이력 확인

### 👨‍🎓 학생 기능
- **PWA 지원**: 태블릿에 앱처럼 설치 가능
- **실시간 수신**: 교사 메시지 즉시 수신 및 알림
- **푸시 알림**: 브라우저 알림, 진동, 알림음 지원
- **메시지 히스토리**: 받은 메시지 이력 확인
- **하이퍼링크 지원**: URL 자동 변환 및 링크 열기

## 🛠 기술 스택

- **백엔드**: Python Flask + Socket.IO
- **프론트엔드**: HTML5/CSS3/JavaScript + Bootstrap
- **데이터베이스**: SQLite
- **실시간 통신**: WebSocket
- **PWA**: Service Worker + Manifest

## 📋 설치 및 실행

### 1. 저장소 클론
```bash
git clone https://github.com/your-username/teacher-student-message.git
cd teacher-student-message
```

### 2. 가상환경 생성 및 활성화
```bash
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate
```

### 3. 의존성 설치
```bash
pip install -r requirements.txt
```

### 4. 서버 실행
```bash
python main.py
```

### 5. 브라우저에서 접속
- **교사 등록**: http://localhost:5000/teacher/register
- **교사 로그인**: http://localhost:5000/teacher/login
- **학생 페이지**: http://localhost:5000/student

## 🚀 배포

### Replit 배포
1. Replit.com에 계정 생성
2. "Import from GitHub" 선택
3. 이 저장소 URL 입력
4. 자동 배포 완료

### 다른 플랫폼 배포
- **Railway**: GitHub 연동 자동 배포
- **Render**: GitHub 연동 자동 배포
- **로컬 네트워크**: `python main.py`로 교실 내 서버 운영

## 📱 사용 방법

### 교사 사용법
1. **교사 등록**: 이름 입력 후 6자리 코드 발급받기
2. **교사 로그인**: 6자리 코드로 로그인
3. **학생 연결 확인**: 대시보드에서 연결된 학생 목록 확인
4. **메시지 전송**: 개별 또는 전체 학생 선택 후 메시지 작성

### 학생 사용법
1. **페이지 접속**: 학생용 페이지 접속
2. **교사 정보 입력**: 교사 코드(6자리) + 반 번호 + 이름 입력
3. **PWA 설치**: "홈 화면에 추가"로 앱 설치
4. **알림 권한**: 푸시 알림 허용
5. **메시지 수신**: 실시간 메시지 및 알림 받기

## 🔔 알림 기능

- **브라우저 푸시 알림**: 메시지 수신 시 팝업 알림
- **진동 알림**: 모바일 기기에서 진동
- **알림음**: 메시지 수신음 재생
- **백그라운드 알림**: 앱이 백그라운드에 있어도 알림 수신

## 🏗 프로젝트 구조

```
teacher-student-message/
├── main.py                 # 메인 서버 파일
├── app.py                  # 개발용 서버 파일
├── requirements.txt        # Python 패키지 의존성
├── messages.db            # SQLite 데이터베이스 (자동 생성)
├── templates/             # HTML 템플릿
│   ├── teacher.html       # 교사 대시보드
│   ├── teacher_register.html  # 교사 등록
│   ├── teacher_login.html     # 교사 로그인
│   ├── teacher_code.html      # 교사 코드 발급
│   └── student.html           # 학생 페이지
├── static/                # 정적 파일
│   ├── js/
│   │   ├── teacher.js     # 교사용 JavaScript
│   │   └── student.js     # 학생용 JavaScript
│   ├── manifest.json      # PWA 매니페스트
│   └── sw.js             # 서비스 워커
└── README.md             # 프로젝트 설명서
```

## 🔒 보안 기능

- **교사별 완전 분리**: 교사 코드 기반 데이터 격리
- **세션 관리**: Flask 세션 기반 인증
- **XSS 방지**: HTML 이스케이프 처리
- **SQL 인젝션 방지**: 파라미터화된 쿼리 사용

## 🐛 문제 해결

### 포트 충돌 오류
```bash
# 다른 포트로 실행
python main.py --port 8000
```

### 데이터베이스 초기화
```python
# Python 콘솔에서 실행
from main import init_db
init_db()
```

### 캐시 문제
- 브라우저 강력 새로고침: Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)

## 📄 라이선스

MIT License

## 🤝 기여하기

1. Fork 프로젝트
2. Feature 브랜치 생성 (`git checkout -b feature/AmazingFeature`)
3. 변경사항 커밋 (`git commit -m 'Add some AmazingFeature'`)
4. 브랜치에 Push (`git push origin feature/AmazingFeature`)
5. Pull Request 생성

## 📞 지원

문제가 있거나 제안사항이 있으시면 [Issues](https://github.com/your-username/teacher-student-message/issues)에 등록해주세요.

---

Made with ❤️ for Education 