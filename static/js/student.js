// Socket.IO 연결
const socket = io();

// 전역 변수
let studentInfo = {
    id: '',
    name: '',
    connected: false
};
let messages = [];
let unreadCount = 0;

// DOM 요소들
const connectionStatus = document.getElementById('connectionStatus');
const loginScreen = document.getElementById('loginScreen');
const messageScreen = document.getElementById('messageScreen');
const teacherCodeInput = document.getElementById('teacherCode');
const classNumberInput = document.getElementById('classNumber');
const studentNameInput = document.getElementById('studentName');
const studentIdInput = document.getElementById('studentId');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const displayName = document.getElementById('displayName');
const displayId = document.getElementById('displayId');
const messageList = document.getElementById('messageList');
const messageCount = document.getElementById('messageCount');
const markAllReadBtn = document.getElementById('markAllReadBtn');
const clearMessagesBtn = document.getElementById('clearMessagesBtn');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const notificationSound = document.getElementById('notificationSound');

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    loadStoredData();
    setupPWA();
});

// 이벤트 리스너 초기화
function initializeEventListeners() {
    // 연결 버튼
    connectBtn.addEventListener('click', connectToServer);
    
    // 연결 해제 버튼
    disconnectBtn.addEventListener('click', disconnectFromServer);
    
    // 엔터키로 연결 및 필드 이동
    teacherCodeInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            classNumberInput.focus();
        }
    });
    
    classNumberInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            studentNameInput.focus();
        }
    });
    
    studentNameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            studentIdInput.focus();
        }
    });
    
    studentIdInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            connectToServer();
        }
    });
    
    // 교사 코드는 숫자만 입력 허용
    teacherCodeInput.addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '');
    });
    
    // 메시지 관리 버튼들
    markAllReadBtn.addEventListener('click', markAllMessagesRead);
    clearMessagesBtn.addEventListener('click', clearAllMessages);
    refreshHistoryBtn.addEventListener('click', requestMessageHistory);
    
    // 페이지 가시성 변경 감지 (백그라운드/포그라운드)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && studentInfo.connected) {
            // 페이지가 다시 보일 때 읽지 않은 메시지들을 읽음 처리
            setTimeout(markVisibleMessagesRead, 1000);
        }
    });
}

// 저장된 데이터 로드
function loadStoredData() {
    const stored = localStorage.getItem('studentInfo');
    if (stored) {
        const data = JSON.parse(stored);
        teacherCodeInput.value = data.teacherCode || '';
        classNumberInput.value = data.classNumber || '';
        studentNameInput.value = data.name || '';
        studentIdInput.value = data.id || '';
    }
    
    const storedMessages = localStorage.getItem('studentMessages');
    if (storedMessages) {
        messages = JSON.parse(storedMessages);
        if (messages.length > 0 && studentInfo.connected) {
            displayMessages();
        }
    }
}

// PWA 설정
function setupPWA() {
    // 서비스 워커 등록
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js')
            .then(function(registration) {
                console.log('서비스 워커 등록 성공:', registration);
            })
            .catch(function(error) {
                console.log('서비스 워커 등록 실패:', error);
            });
    }
    
    // 푸시 알림 권한 요청
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// 서버 연결
function connectToServer() {
    const teacherCode = teacherCodeInput.value.trim();
    const classNumber = classNumberInput.value.trim();
    const name = studentNameInput.value.trim();
    const id = studentIdInput.value.trim() || ''; // 선택사항
    
    // 필수 필드 검증
    if (!teacherCode) {
        showFloatingNotification('교사 코드를 입력해주세요', 'warning');
        teacherCodeInput.focus();
        return;
    }
    
    if (teacherCode.length !== 6 || !/^\d{6}$/.test(teacherCode)) {
        showFloatingNotification('교사 코드는 6자리 숫자여야 합니다', 'warning');
        teacherCodeInput.focus();
        return;
    }
    
    if (!classNumber) {
        showFloatingNotification('반 번호를 입력해주세요', 'warning');
        classNumberInput.focus();
        return;
    }
    
    if (!name) {
        showFloatingNotification('이름을 입력해주세요', 'warning');
        studentNameInput.focus();
        return;
    }
    
    studentInfo = {
        teacherCode: teacherCode,
        classNumber: classNumber,
        id: id,
        name: name,
        connected: false
    };
    
    // 로컬 스토리지에 저장
    localStorage.setItem('studentInfo', JSON.stringify(studentInfo));
    
    // 서버에 연결 (다중 교사 시스템용)
    socket.emit('student_join', {
        teacher_code: teacherCode,
        class_number: classNumber,
        student_name: name,
        student_id: id
    });
}

// 서버 연결 해제
function disconnectFromServer() {
    if (studentInfo.connected) {
        socket.disconnect();
        studentInfo.connected = false;
        showLoginScreen();
        showFloatingNotification('연결이 해제되었습니다', 'info');
    }
}

// Socket.IO 이벤트 핸들러들
socket.on('connect', function() {
    connectionStatus.textContent = '연결됨';
    connectionStatus.className = 'badge bg-success fs-6';
});

// 학생 연결 성공 응답
socket.on('student_join_success', function(data) {
    if (data.status === 'success') {
        studentInfo.connected = true;
        studentInfo.teacherName = data.teacher_name;
        showMessageScreen();
        showFloatingNotification(`${data.teacher_name} 선생님과 연결되었습니다`, 'success');
        
        // 연결 성공 후 메시지 히스토리 요청
        requestMessageHistory();
    }
});

// 학생 연결 오류 응답
socket.on('student_join_error', function(data) {
    showFloatingNotification(data.error || '연결에 실패했습니다', 'error');
});

// 메시지 히스토리 수신
socket.on('message_history', function(data) {
    if (data.messages && data.messages.length > 0) {
        // 서버에서 받은 메시지들을 로컬 메시지 배열에 추가
        data.messages.forEach(serverMessage => {
            const message = {
                id: Date.now() + Math.random(),
                sender: serverMessage.sender,
                message: serverMessage.message,
                timestamp: serverMessage.timestamp,
                isRead: true, // 이전 메시지들은 읽음 처리
                receivedAt: serverMessage.timestamp,
                isFromHistory: true // 히스토리에서 온 메시지 표시
            };
            
            // 중복 체크 (같은 내용과 시간의 메시지가 이미 있는지)
            const exists = messages.some(m => 
                m.message === message.message && 
                m.timestamp === message.timestamp
            );
            
            if (!exists) {
                messages.push(message);
            }
        });
        
        // 시간순으로 정렬 (최신 메시지가 위에)
        messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        saveMessages();
        displayMessages();
        showFloatingNotification(`이전 메시지 ${data.messages.length}개를 불러왔습니다`, 'info');
    }
});

socket.on('disconnect', function() {
    connectionStatus.textContent = '연결 끊김';
    connectionStatus.className = 'badge bg-danger fs-6';
    studentInfo.connected = false;
    
    if (messageScreen.style.display !== 'none') {
        showFloatingNotification('서버 연결이 끊어졌습니다', 'error');
    }
});

// 메시지 수신
socket.on('receive_message', function(data) {
    const message = {
        id: Date.now() + Math.random(),
        sender: data.sender,
        message: data.message,
        timestamp: data.timestamp,
        isRead: false,
        receivedAt: new Date().toLocaleString('ko-KR')
    };
    
    messages.unshift(message); // 최신 메시지를 맨 위에
    saveMessages();
    displayMessages();
    
    // 알림 표시
    showMessageNotification(message);
    
    // 페이지가 보이지 않을 때만 브라우저 알림
    if (document.hidden) {
        showBrowserNotification(message);
    } else {
        // 페이지가 보일 때는 잠시 후 자동으로 읽음 처리
        setTimeout(() => markMessageRead(message.id), 2000);
    }
});

// 화면 전환 함수들
function showLoginScreen() {
    loginScreen.style.display = 'block';
    messageScreen.style.display = 'none';
}

function showMessageScreen() {
    loginScreen.style.display = 'none';
    messageScreen.style.display = 'block';
    
    displayName.textContent = `안녕하세요, ${studentInfo.name}님!`;
    displayId.textContent = `${studentInfo.classNumber} | 교사: ${studentInfo.teacherName || '연결됨'}`;
    
    displayMessages();
}

// 메시지 표시
function displayMessages() {
    if (messages.length === 0) {
        messageList.innerHTML = `
            <div class="no-messages">
                <i class="fas fa-inbox fa-3x mb-3"></i>
                <p>아직 받은 메시지가 없습니다</p>
                <small class="text-muted">교사가 메시지를 보내면 여기에 표시됩니다</small>
            </div>
        `;
    } else {
        messageList.innerHTML = '';
        messages.forEach(message => {
            addMessageToList(message);
        });
    }
    
    updateMessageCount();
}

// 메시지 히스토리 요청
function requestMessageHistory() {
    if (studentInfo.connected && studentInfo.id) {
        socket.emit('get_message_history', {
            student_id: studentInfo.id
        });
    }
}

// URL을 링크로 변환하는 함수
function convertUrlsToLinks(text) {
    // URL 패턴 정규식 (http, https, www로 시작하는 URL 감지)
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    
    return text.replace(urlPattern, function(url) {
        let href = url;
        // www로 시작하는 경우 http:// 추가
        if (url.startsWith('www.')) {
            href = 'http://' + url;
        }
        
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary text-decoration-underline">${url}</a>`;
    });
}

// 텍스트를 안전하게 HTML로 변환 (XSS 방지)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 메시지를 목록에 추가
function addMessageToList(message) {
    const messageElement = document.createElement('div');
    messageElement.className = `message-item ${message.isRead ? 'read' : 'new'}`;
    messageElement.dataset.messageId = message.id;
    
    // 메시지 내용을 안전하게 처리하고 링크 변환
    const safeMessage = escapeHtml(message.message);
    const messageWithLinks = convertUrlsToLinks(safeMessage);
    
    messageElement.innerHTML = `
        <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="d-flex align-items-center">
                <i class="fas fa-user-tie text-primary me-2"></i>
                <strong>${escapeHtml(message.sender)}</strong>
                ${!message.isRead ? '<span class="badge bg-success ms-2">새 메시지</span>' : ''}
                ${message.isFromHistory ? '<span class="badge bg-secondary ms-2">이전 메시지</span>' : ''}
            </div>
            <small class="text-muted">${escapeHtml(message.timestamp)}</small>
        </div>
        <div class="message-content" style="word-break: break-word; line-height: 1.5;">${messageWithLinks}</div>
        <div class="text-end mt-2">
            <small class="text-muted">수신: ${escapeHtml(message.receivedAt)}</small>
        </div>
    `;
    
    // 클릭시 읽음 처리
    messageElement.addEventListener('click', function() {
        if (!message.isRead) {
            markMessageRead(message.id);
        }
    });
    
    messageList.appendChild(messageElement);
}

// 메시지 읽음 처리
function markMessageRead(messageId) {
    const message = messages.find(m => m.id === messageId);
    if (message && !message.isRead) {
        message.isRead = true;
        saveMessages();
        
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.className = 'message-item read';
            const badge = messageElement.querySelector('.badge');
            if (badge) {
                badge.remove();
            }
        }
        
        updateMessageCount();
    }
}

// 보이는 메시지들 읽음 처리
function markVisibleMessagesRead() {
    let changed = false;
    messages.forEach(message => {
        if (!message.isRead) {
            message.isRead = true;
            changed = true;
        }
    });
    
    if (changed) {
        saveMessages();
        displayMessages();
    }
}

// 모든 메시지 읽음 처리
function markAllMessagesRead() {
    let changed = false;
    messages.forEach(message => {
        if (!message.isRead) {
            message.isRead = true;
            changed = true;
        }
    });
    
    if (changed) {
        saveMessages();
        displayMessages();
        showFloatingNotification('모든 메시지를 읽음 처리했습니다', 'success');
    }
}

// 모든 메시지 삭제
function clearAllMessages() {
    if (messages.length === 0) {
        showFloatingNotification('삭제할 메시지가 없습니다', 'info');
        return;
    }
    
    if (confirm('모든 메시지를 삭제하시겠습니까?')) {
        messages = [];
        saveMessages();
        displayMessages();
        showFloatingNotification('모든 메시지가 삭제되었습니다', 'success');
    }
}

// 메시지 수 업데이트
function updateMessageCount() {
    const total = messages.length;
    const unread = messages.filter(m => !m.isRead).length;
    
    messageCount.textContent = total;
    
    // 타이틀에 읽지 않은 메시지 수 표시
    if (unread > 0) {
        document.title = `(${unread}) 학생용 메시지 수신`;
    } else {
        document.title = '학생용 메시지 수신';
    }
}

// 메시지 저장
function saveMessages() {
    localStorage.setItem('studentMessages', JSON.stringify(messages));
}

// 플로팅 알림 표시
function showFloatingNotification(message, type = 'info') {
    const colors = {
        'success': 'rgba(40, 167, 69, 0.95)',
        'info': 'rgba(23, 162, 184, 0.95)',
        'warning': 'rgba(255, 193, 7, 0.95)',
        'error': 'rgba(220, 53, 69, 0.95)'
    };
    
    const notification = document.createElement('div');
    notification.className = 'floating-notification';
    notification.style.background = colors[type] || colors.info;
    notification.innerHTML = `<i class="fas fa-info-circle me-2"></i>${message}`;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// 메시지 알림 표시
function showMessageNotification(message) {
    // 알림음 재생
    if (notificationSound) {
        notificationSound.play().catch(e => {
            console.log('알림음 재생 실패:', e);
        });
    }
    
    // 플로팅 알림
    showFloatingNotification(`${message.sender}: ${message.message.substring(0, 50)}...`, 'success');
}

// 브라우저 알림 표시
function showBrowserNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(`새 메시지 - ${message.sender}`, {
            body: message.message,
            icon: '/static/images/icon-192x192.png',
            badge: '/static/images/icon-192x192.png',
            tag: 'student-message',
            requireInteraction: false
        });
        
        // 클릭시 창 포커스
        notification.onclick = function() {
            window.focus();
            notification.close();
        };
        
        // 5초 후 자동 닫기
        setTimeout(() => {
            notification.close();
        }, 5000);
    }
} 