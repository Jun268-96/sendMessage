// Socket.IO 연결
const socket = io();

let studentInfo = { teacherCode: '', name: '', teacherName: '', connected: false };
let messages = [];
let allowStudentMessages = false;

// DOM
const connectionStatus = document.getElementById('connectionStatus');
const loginScreen = document.getElementById('loginScreen');
const messageScreen = document.getElementById('messageScreen');
const teacherCodeInput = document.getElementById('teacherCode');
const studentNameInput = document.getElementById('studentName');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const displayName = document.getElementById('displayName');
const displayId = document.getElementById('displayId');
const messageList = document.getElementById('messageList');
const messageCount = document.getElementById('messageCount');
const clearMessagesBtn = document.getElementById('clearMessagesBtn');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const notificationSound = document.getElementById('notificationSound');
const studentSendCard = document.getElementById('studentSendCard');
const studentMessageInput = document.getElementById('studentMessageInput');
const sendToTeacherBtn = document.getElementById('sendToTeacherBtn');
const sendStatus = document.getElementById('sendStatus');

document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadStoredData();
    setupPWA();
});

function initEvents() {
    connectBtn.addEventListener('click', connectToServer);
    disconnectBtn.addEventListener('click', disconnectFromServer);

    teacherCodeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') studentNameInput.focus(); });
    studentNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') connectToServer(); });
    teacherCodeInput.addEventListener('input', function () { this.value = this.value.replace(/[^0-9]/g, ''); });

    clearMessagesBtn.addEventListener('click', clearAllMessages);
    refreshHistoryBtn.addEventListener('click', requestMessageHistory);

    sendToTeacherBtn.addEventListener('click', sendMessageToTeacher);
    studentMessageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) sendMessageToTeacher();
    });

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && studentInfo.connected) {
            setTimeout(markVisibleMessagesRead, 500);
        }
    });
}

function loadStoredData() {
    const stored = localStorage.getItem('studentInfo');
    if (stored) {
        const data = JSON.parse(stored);
        teacherCodeInput.value = data.teacherCode || '';
        studentNameInput.value = data.name || '';
        studentInfo.teacherCode = data.teacherCode || '';
        studentInfo.name = data.name || '';
        studentInfo.teacherName = data.teacherName || '';
    }
    const storedMessages = localStorage.getItem('studentMessages');
    if (storedMessages) {
        messages = JSON.parse(storedMessages);
        if (messages.length > 0) displayMessages();
    }
}

function setupPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js').catch(() => { });
    }
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// 서버 연결
function connectToServer() {
    const teacherCode = teacherCodeInput.value.trim();
    const name = studentNameInput.value.trim();
    if (!teacherCode) { showFloatingNotification('교사 코드를 입력해주세요', 'warning'); teacherCodeInput.focus(); return; }
    if (teacherCode.length !== 6 || !/^\d{6}$/.test(teacherCode)) { showFloatingNotification('교사 코드는 6자리 숫자입니다', 'warning'); teacherCodeInput.focus(); return; }
    if (!name) { showFloatingNotification('이름을 입력해주세요', 'warning'); studentNameInput.focus(); return; }

    studentInfo = { teacherCode, name, teacherName: '', connected: false };
    localStorage.setItem('studentInfo', JSON.stringify(studentInfo));

    // 소켓이 끊겨있으면 다시 연결
    if (!socket.connected) {
        socket.connect();
    }

    socket.emit('student_join', {
        teacher_code: teacherCode,
        student_name: name
    });
}

function disconnectFromServer() {
    if (studentInfo.connected) {
        socket.disconnect();
        studentInfo.connected = false;
        showLoginScreen();
        showFloatingNotification('연결이 종료되었습니다', 'info');
    }
}

// 소켓 이벤트
socket.on('connect', () => {
    connectionStatus.textContent = '연결됨';
    connectionStatus.className = 'badge bg-success fs-6';
});

socket.on('student_join_success', (data) => {
    if (data.status === 'success') {
        studentInfo.connected = true;
        studentInfo.teacherName = data.teacher_name;
        studentInfo.teacherCode = data.student_info?.teacher_code || studentInfo.teacherCode;
        localStorage.setItem('studentInfo', JSON.stringify(studentInfo));

        showMessageScreen();
        showFloatingNotification(`${data.teacher_name} 선생님과 연결되었습니다`, 'success');
        updateSendToTeacherUI(data.allow_messages);
        requestMessageHistory();
    }
});

socket.on('student_join_error', (data) => {
    showFloatingNotification(data.error || '연결에 실패했습니다', 'error');
});

socket.on('receive_status', (data) => {
    updateSendToTeacherUI(!!data.allow);
});

socket.on('student_message_sent', (data) => {
    showFloatingNotification('교사에게 메시지를 보냈습니다', 'success');
    studentMessageInput.value = '';
});

socket.on('student_message_error', (data) => {
    showFloatingNotification(data.message || '메시지 전송에 실패했습니다', 'warning');
});

socket.on('message_history', (data) => {
    if (data.messages) {
        const fresh = data.messages.map((m) => ({
            id: m.id || Date.now() + Math.random(),
            sender: m.sender,
            message: m.message,
            timestamp: m.timestamp,
            isRead: true,
            receivedAt: m.timestamp,
            isFromHistory: true
        }));
        fresh.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        messages = fresh;
        saveMessages();
        displayMessages();
        if (fresh.length > 0) {
            showFloatingNotification(`메시지 ${fresh.length}개를 불러왔습니다`, 'info');
        }
    }
});

socket.on('disconnect', () => {
    connectionStatus.textContent = '연결 끊김';
    connectionStatus.className = 'badge bg-danger fs-6';
    studentInfo.connected = false;
    if (messageScreen.style.display !== 'none') {
        showFloatingNotification('서버와 연결이 끊어졌습니다', 'error');
    }
});

socket.on('kicked', () => {
    showFloatingNotification('교사에 의해 연결이 종료되었습니다', 'warning');
    disconnectFromServer();
});

socket.on('delete_result', (data) => {
    if (data.status === 'success') {
        showFloatingNotification('메시지를 숨겼습니다', 'info');
    } else {
        showFloatingNotification(data.message || '삭제에 실패했습니다', 'warning');
    }
});

socket.on('receive_message', (data) => {
    const mid = data.message_id || Date.now() + Math.random();
    const message = {
        id: mid,
        sender: data.sender,
        message: data.message,
        timestamp: data.timestamp,
        isRead: false,
        receivedAt: new Date().toLocaleString('ko-KR')
    };

    messages.unshift(message);
    saveMessages();
    displayMessages();
    showMessageNotification(message);

    if (document.hidden) {
        showBrowserNotification(message);
    } else {
        setTimeout(() => markMessageRead(message.id), 2000);
    }
});

socket.on('message_deleted', (data) => {
    const mid = data.message_id;
    if (!mid) return;
    const before = messages.length;
    messages = messages.filter((m) => String(m.id) !== String(mid));
    if (messages.length !== before) {
        saveMessages();
        displayMessages();
        showFloatingNotification('메시지가 삭제되었습니다', 'warning');
    }
});

// UI
function showLoginScreen() {
    loginScreen.style.display = 'block';
    messageScreen.style.display = 'none';
}

function showMessageScreen() {
    loginScreen.style.display = 'none';
    messageScreen.style.display = 'block';
    displayName.textContent = `반갑습니다, ${studentInfo.name}님`;
    const teacherLabel = studentInfo.teacherName || '교사';
    displayId.textContent = `교사: ${teacherLabel} (코드: ${studentInfo.teacherCode || '-'})`;
    displayMessages();
}

function updateSendToTeacherUI(allow) {
    allowStudentMessages = allow;
    if (allow) {
        studentSendCard.style.display = 'block';
        sendStatus.textContent = '가능';
        sendStatus.className = 'badge bg-success';
        sendToTeacherBtn.disabled = false;
        studentMessageInput.disabled = false;
    } else {
        studentSendCard.style.display = 'none';
        sendStatus.textContent = '불가';
        sendStatus.className = 'badge bg-secondary';
        sendToTeacherBtn.disabled = true;
        studentMessageInput.disabled = true;
    }
}

// 메시지 렌더링
function displayMessages() {
    if (messages.length === 0) {
        messageList.innerHTML = `
            <div class="no-messages">
                <i class="fas fa-inbox fa-3x mb-3"></i>
                <p>아직 받은 메시지가 없습니다</p>
                <small class="text-muted">교사가 메시지를 보내면 여기에 표시됩니다.</small>
            </div>
        `;
    } else {
        messageList.innerHTML = '';
        messages.forEach((message) => addMessageToList(message));
    }
    updateMessageCount();
}

function requestMessageHistory() {
    if (studentInfo.connected) {
        socket.emit('get_message_history', {
            teacher_code: studentInfo.teacherCode,
            student_name: studentInfo.name
        });
    }
}

function addMessageToList(message) {
    const messageElement = document.createElement('div');
    messageElement.className = `message-item ${message.isRead ? 'read' : 'new'}`;
    messageElement.dataset.messageId = message.id;

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
            <div class="d-flex align-items-center gap-2">
                <small class="text-muted">${escapeHtml(message.timestamp)}</small>
                <button class="btn btn-sm btn-outline-danger delete-msg-btn" title="이 메시지 숨기기">
                    <i class="fas fa-eye-slash"></i>
                </button>
            </div>
        </div>
        <div class="message-content" style="word-break: break-word; line-height: 1.5;">${messageWithLinks}</div>
        <div class="text-end mt-2">
            <small class="text-muted">수신: ${escapeHtml(message.receivedAt)}</small>
        </div>
    `;

    messageElement.addEventListener('click', function () {
        if (!message.isRead) markMessageRead(message.id);
    });

    const delBtn = messageElement.querySelector('.delete-msg-btn');
    if (delBtn) {
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideMessage(message.id);
        });
    }

    messageList.appendChild(messageElement);
}

// 상태 업데이트
function markMessageRead(messageId) {
    const msg = messages.find((m) => m.id === messageId);
    if (msg && !msg.isRead) {
        msg.isRead = true;
        saveMessages();
        const el = document.querySelector(`[data-message-id="${messageId}"]`);
        if (el) {
            el.className = 'message-item read';
            const badge = el.querySelector('.badge');
            if (badge) badge.remove();
        }
        updateMessageCount();
    }
}

function markVisibleMessagesRead() {
    let changed = false;
    messages.forEach((m) => { if (!m.isRead) { m.isRead = true; changed = true; } });
    if (changed) { saveMessages(); displayMessages(); }
}

function markAllMessagesRead() {
    let changed = false;
    messages.forEach((m) => { if (!m.isRead) { m.isRead = true; changed = true; } });
    if (changed) {
        saveMessages();
        displayMessages();
        showFloatingNotification('모든 메시지를 읽음으로 처리했습니다', 'success');
    }
}

function clearAllMessages() {
    if (messages.length === 0) {
        showFloatingNotification('지울 메시지가 없습니다', 'info');
        return;
    }
    if (confirm('모든 메시지를 지우시겠습니까?')) {
        messages = [];
        saveMessages();
        displayMessages();
        showFloatingNotification('모든 메시지가 삭제되었습니다', 'success');
    }
}

function updateMessageCount() {
    const total = messages.length;
    const unread = messages.filter((m) => !m.isRead).length;
    messageCount.textContent = total;
    document.title = unread > 0 ? `(${unread}) 학생용 메시지` : '학생용 메시지';
}

function saveMessages() { localStorage.setItem('studentMessages', JSON.stringify(messages)); }

// 학생 측 메시지 숨김 처리: 로컬에서 제거 후 서버에 hidden 기록 요청
function hideMessage(messageId) {
    const numericId = Number(messageId);
    if (!messageId || Number.isNaN(numericId)) {
        showFloatingNotification('메시지 ID가 없어 숨김만 처리했습니다', 'warning');
        return;
    }
    const before = messages.length;
    messages = messages.filter((m) => String(m.id) !== String(messageId));
    if (messages.length !== before) {
        saveMessages();
        displayMessages();
    }
    socket.emit('delete_message', {
        teacher_code: studentInfo.teacherCode,
        student_name: studentInfo.name,
        message_id: numericId
    });
}

// 교사에게 메시지 보내기
function sendMessageToTeacher() {
    if (!allowStudentMessages) {
        showFloatingNotification('교사가 수신을 허용하지 않았습니다', 'warning');
        return;
    }
    const msg = studentMessageInput.value.trim();
    if (!msg) { showFloatingNotification('메시지를 입력하세요', 'warning'); return; }

    socket.emit('send_message', {
        sender_type: 'student',
        teacher_code: studentInfo.teacherCode,
        student_name: studentInfo.name,
        message: msg,
        recipients: []
    });
}

// 알림/유틸
function showFloatingNotification(message, type = 'info') {
    const colors = { success: 'rgba(40, 167, 69, 0.95)', info: 'rgba(23, 162, 184, 0.95)', warning: 'rgba(255, 193, 7, 0.95)', error: 'rgba(220, 53, 69, 0.95)' };
    const notification = document.createElement('div');
    notification.className = 'floating-notification';
    notification.style.position = 'fixed';
    notification.style.top = '50%';
    notification.style.left = '50%';
    notification.style.transform = 'translate(-50%, -50%)';
    notification.style.background = colors[type] || colors.info;
    notification.style.color = '#fff';
    notification.style.padding = '16px 24px';
    notification.style.borderRadius = '10px';
    notification.style.zIndex = 9999;
    notification.innerHTML = `<i class="fas fa-info-circle me-2"></i>${message}`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function showMessageNotification(message) {
    if (notificationSound) {
        notificationSound.play().catch(() => { });
    }
    showFloatingNotification(`${message.sender}: ${message.message.substring(0, 50)}...`, 'success');
}

function showBrowserNotification(message) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(`새 메시지 - ${message.sender}`, {
            body: message.message,
            icon: '/static/images/icon-192x192.png',
            badge: '/static/images/icon-192x192.png',
            tag: 'student-message',
            requireInteraction: false
        });
        notification.onclick = function () { window.focus(); notification.close(); };
        setTimeout(() => notification.close(), 5000);
    }
}

// 공통 유틸 (교사쪽과 동일 로직 유지)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

function convertUrlsToLinks(text) {
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    return (text || '').replace(urlPattern, (url) => {
        const href = url.startsWith('www.') ? 'http://' + url : url;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary text-decoration-underline">${url}</a>`;
    });
}
