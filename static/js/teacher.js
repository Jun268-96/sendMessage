// Socket.IO 연결
const socket = io();

// 전역 변수
let selectedStudents = new Set();
let connectedStudents = new Map();
let messageHistory = [];

// DOM 요소들
const connectionStatus = document.getElementById('connectionStatus');
const studentCount = document.getElementById('studentCount');
const studentList = document.getElementById('studentList');
const messageText = document.getElementById('messageText');
const sendToAllCheckbox = document.getElementById('sendToAll');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const recipientInfo = document.getElementById('recipientInfo');
const messageHistoryDiv = document.getElementById('messageHistory');
const selectAllBtn = document.getElementById('selectAllBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const notificationToast = document.getElementById('notificationToast');
const toastMessage = document.getElementById('toastMessage');

// Bootstrap Toast 인스턴스
const toast = new bootstrap.Toast(notificationToast);

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    connectToServer();
});

// 이벤트 리스너 초기화
function initializeEventListeners() {
    // 메시지 전송 버튼
    sendMessageBtn.addEventListener('click', sendMessage);
    
    // 엔터키로 메시지 전송
    messageText.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && e.ctrlKey) {
            sendMessage();
        }
    });
    
    // 전체 선택 체크박스
    sendToAllCheckbox.addEventListener('change', function() {
        updateRecipientInfo();
        if (this.checked) {
            // 전체 선택 시 개별 선택 해제
            selectedStudents.clear();
            updateStudentSelection();
        }
    });
    
    // 전체 선택/해제 버튼
    selectAllBtn.addEventListener('click', selectAllStudents);
    clearAllBtn.addEventListener('click', clearAllStudents);
}

// 서버 연결
function connectToServer() {
    // 다중 교사 시스템: 세션에서 교사 정보 가져오기
    const teacherCode = window.teacherCode; // 서버에서 전달받은 교사 코드
    const teacherName = window.teacherName; // 서버에서 전달받은 교사 이름
    
    if (!teacherCode) {
        alert('교사 인증이 필요합니다. 로그인 페이지로 이동합니다.');
        window.location.href = '/teacher/login';
        return;
    }
    
    // 교사로 서버에 연결
    socket.emit('teacher_join', {
        teacher_code: teacherCode,
        teacher_name: teacherName
    });
}

// Socket.IO 이벤트 핸들러들
socket.on('connect', function() {
    connectionStatus.textContent = '연결됨';
    connectionStatus.className = 'badge bg-success';
    showNotification('서버에 연결되었습니다', 'success');
});

socket.on('disconnect', function() {
    connectionStatus.textContent = '연결 끊김';
    connectionStatus.className = 'badge bg-danger';
    showNotification('서버 연결이 끊어졌습니다', 'danger');
});

// 학생 목록 업데이트
socket.on('student_list_update', function(students) {
    updateStudentList(students);
});

// 새 학생 연결
socket.on('student_connected', function(student) {
    // 기존 같은 학생의 다른 socket_id가 있는지 확인하고 제거
    let existingSocketId = null;
    connectedStudents.forEach((existingStudent, socketId) => {
        if (existingStudent.student_name === student.student_name && 
            existingStudent.class_number === student.class_number &&
            existingStudent.student_id === student.student_id &&
            socketId !== student.socket_id) {
            existingSocketId = socketId;
        }
    });
    
    // 기존 학생 제거
    if (existingSocketId) {
        connectedStudents.delete(existingSocketId);
        removeStudentFromList(existingSocketId);
        selectedStudents.delete(existingSocketId);
    }
    
    // 새로운 학생 추가
    connectedStudents.set(student.socket_id, student);
    addStudentToList(student);
    updateStudentCount();
    showNotification(`${student.student_name} (${student.class_number}) 학생이 연결되었습니다`, 'info');
});

// 학생 연결 해제
socket.on('student_disconnected', function(student) {
    connectedStudents.delete(student.socket_id);
    removeStudentFromList(student.socket_id);
    selectedStudents.delete(student.socket_id); // socket_id 기준으로 변경
    updateStudentCount();
    updateRecipientInfo();
    showNotification(`${student.student_name} (${student.class_number}) 학생의 연결이 해제되었습니다`, 'warning');
});

// 메시지 전송 완료
socket.on('message_sent', function(data) {
    if (data.status === 'success') {
        const message = messageText.value;
        addToMessageHistory(message);
        messageText.value = '';
        showNotification('메시지가 성공적으로 전송되었습니다', 'success');
    }
});

// 학생 목록 업데이트
function updateStudentList(students) {
    connectedStudents.clear();
    students.forEach(student => {
        connectedStudents.set(student.socket_id, student);
    });
    
    if (students.length === 0) {
        studentList.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="fas fa-user-friends fa-2x mb-2"></i>
                <p>아직 연결된 학생이 없습니다</p>
            </div>
        `;
    } else {
        studentList.innerHTML = '';
        students.forEach(student => {
            addStudentToList(student);
        });
    }
    
    updateStudentCount();
}

// 학생을 목록에 추가
function addStudentToList(student) {
    if (connectedStudents.size === 1 && studentList.innerHTML.includes('아직 연결된 학생이 없습니다')) {
        studentList.innerHTML = '';
    }
    
    const studentCard = document.createElement('div');
    studentCard.className = 'card student-card mb-2';
    studentCard.dataset.socketId = student.socket_id;
    studentCard.dataset.className = student.class_number;
    studentCard.dataset.studentName = student.student_name;
    
    // 온라인 상태 확인
    const isOnline = student.is_online !== false; // 기본값 true
    const statusIcon = isOnline ? 'fa-circle status-online' : 'fa-circle status-offline';
    const statusText = isOnline ? '온라인' : '오프라인';
    const statusClass = isOnline ? 'text-success' : 'text-muted';
    
    studentCard.innerHTML = `
        <div class="card-body p-2">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${student.student_name}</strong>
                    <br>
                    <small class="text-muted">${student.class_number}반${student.student_id ? ` - ${student.student_id}` : ''}</small>
                </div>
                <div>
                    <i class="fas ${statusIcon}"></i>
                    <small class="${statusClass}">${statusText}</small>
                </div>
            </div>
        </div>
    `;
    
    // 클릭 이벤트 추가 (socket_id 기준으로 변경)
    studentCard.addEventListener('click', function() {
        if (isOnline) {
            toggleStudentSelection(student.socket_id, this);
        }
    });
    
    // 오프라인 학생은 클릭 비활성화
    if (!isOnline) {
        studentCard.style.opacity = '0.6';
        studentCard.style.cursor = 'not-allowed';
    }
    
    studentList.appendChild(studentCard);
}

// 학생을 목록에서 제거
function removeStudentFromList(socketId) {
    const studentCard = document.querySelector(`[data-socket-id="${socketId}"]`);
    if (studentCard) {
        studentCard.remove();
    }
    
    if (connectedStudents.size === 0) {
        studentList.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="fas fa-user-friends fa-2x mb-2"></i>
                <p>아직 연결된 학생이 없습니다</p>
            </div>
        `;
    }
}

// 학생 선택 토글 (socket_id 기준으로 변경)
function toggleStudentSelection(socketId, cardElement) {
    if (sendToAllCheckbox.checked) {
        sendToAllCheckbox.checked = false;
    }
    
    if (selectedStudents.has(socketId)) {
        selectedStudents.delete(socketId);
        cardElement.classList.remove('selected');
    } else {
        selectedStudents.add(socketId);
        cardElement.classList.add('selected');
    }
    
    updateRecipientInfo();
}

// 전체 학생 선택
function selectAllStudents() {
    sendToAllCheckbox.checked = false;
    selectedStudents.clear();
    connectedStudents.forEach((student, socketId) => {
        if (student.is_online !== false) { // 온라인 학생만 선택
            selectedStudents.add(socketId);
        }
    });
    updateStudentSelection();
    updateRecipientInfo();
}

// 전체 선택 해제
function clearAllStudents() {
    sendToAllCheckbox.checked = false;
    selectedStudents.clear();
    updateStudentSelection();
    updateRecipientInfo();
}

// 학생 선택 상태 업데이트
function updateStudentSelection() {
    document.querySelectorAll('.student-card').forEach(card => {
        const socketId = card.dataset.socketId;
        if (selectedStudents.has(socketId)) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });
}

// 수신자 정보 업데이트
function updateRecipientInfo() {
    if (sendToAllCheckbox.checked) {
        recipientInfo.textContent = `전체 학생 (${connectedStudents.size}명)에게 전송`;
        recipientInfo.className = 'text-success';
    } else if (selectedStudents.size > 0) {
        recipientInfo.textContent = `선택된 ${selectedStudents.size}명의 학생에게 전송`;
        recipientInfo.className = 'text-info';
    } else {
        recipientInfo.textContent = '수신자를 선택해주세요';
        recipientInfo.className = 'text-muted';
    }
}

// 학생 수 업데이트
function updateStudentCount() {
    studentCount.textContent = connectedStudents.size;
}

// 메시지 전송
function sendMessage() {
    const message = messageText.value.trim();
    
    if (!message) {
        showNotification('메시지를 입력해주세요', 'warning');
        return;
    }
    
    let recipients = [];
    
    if (sendToAllCheckbox.checked) {
        recipients = ['all'];
    } else if (selectedStudents.size > 0) {
        recipients = Array.from(selectedStudents);
    } else {
        showNotification('수신자를 선택해주세요', 'warning');
        return;
    }
    
    // 다중 교사 시스템: 교사 코드 포함하여 메시지 전송
    socket.emit('send_message', {
        sender_type: 'teacher',
        teacher_code: window.teacherCode, // 교사 코드 추가
        message: message,
        recipients: recipients
    });
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

// 메시지 히스토리에 추가
function addToMessageHistory(message) {
    const timestamp = new Date().toLocaleString('ko-KR');
    let recipients = '';
    
    if (sendToAllCheckbox.checked) {
        recipients = `전체 학생 (${connectedStudents.size}명)`;
    } else {
        recipients = `선택된 ${selectedStudents.size}명`;
    }
    
    // 메시지 내용을 안전하게 처리하고 링크 변환
    const safeMessage = escapeHtml(message);
    const messageWithLinks = convertUrlsToLinks(safeMessage);
    
    const messageItem = document.createElement('div');
    messageItem.className = 'message-item';
    messageItem.innerHTML = `
        <div class="d-flex justify-content-between mb-2">
            <strong>수신자: ${escapeHtml(recipients)}</strong>
            <small class="text-muted">${escapeHtml(timestamp)}</small>
        </div>
        <div style="word-break: break-word; line-height: 1.5;">${messageWithLinks}</div>
    `;
    
    // 첫 번째 메시지인 경우 안내 메시지 제거
    if (messageHistoryDiv.innerHTML.includes('아직 전송한 메시지가 없습니다')) {
        messageHistoryDiv.innerHTML = '';
    }
    
    messageHistoryDiv.insertBefore(messageItem, messageHistoryDiv.firstChild);
    
    // 히스토리가 너무 많아지면 오래된 것 제거 (최대 20개)
    const messageItems = messageHistoryDiv.querySelectorAll('.message-item');
    if (messageItems.length > 20) {
        messageItems[messageItems.length - 1].remove();
    }
}

// 알림 표시
function showNotification(message, type = 'info') {
    const bgClass = {
        'success': 'bg-success',
        'info': 'bg-info',
        'warning': 'bg-warning',
        'danger': 'bg-danger'
    };
    
    toastMessage.textContent = message;
    notificationToast.className = `toast ${bgClass[type] || 'bg-info'} text-white`;
    
    toast.show();
} 