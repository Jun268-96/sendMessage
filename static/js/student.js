// Socket.IO 연결
const socket = io();

// 상태 변수
let studentInfo = {
    teacherCode: '',
    name: '',
    teacherName: '',
    connected: false
};
let messages = [];

// DOM 참조
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
const markAllReadBtn = document.getElementById('markAllReadBtn');
const clearMessagesBtn = document.getElementById('clearMessagesBtn');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const notificationSound = document.getElementById('notificationSound');

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadStoredData();
    setupPWA();
});

function initializeEventListeners() {
    connectBtn.addEventListener('click', connectToServer);
    disconnectBtn.addEventListener('click', disconnectFromServer);

    teacherCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            studentNameInput.focus();
        }
    });
    studentNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            connectToServer();
        }
    });

    teacherCodeInput.addEventListener('input', function () {
        this.value = this.value.replace(/[^0-9]/g, '');
    });

    markAllReadBtn.addEventListener('click', markAllMessagesRead);
    clearMessagesBtn.addEventListener('click', clearAllMessages);
    refreshHistoryBtn.addEventListener('click', requestMessageHistory);

    document.addEventListener('visibilitychange', () => {
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
        if (messages.length > 0) {
            displayMessages();
        }
    }
}

function setupPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/sw.js').catch((error) => {
            console.log('Service worker registration failed:', error);
        });
    }

    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// 서버 연결
function connectToServer() {
    const teacherCode = teacherCodeInput.value.trim();
    const name = studentNameInput.value.trim();

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
    if (!name) {
        showFloatingNotification('이름을 입력해주세요', 'warning');
        studentNameInput.focus();
        return;
    }

    studentInfo = {
        teacherCode,
        name,
        teacherName: '',
        connected: false
    };
    localStorage.setItem('studentInfo', JSON.stringify(studentInfo));

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

// Socket.IO 이벤트
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
        requestMessageHistory();
    }
});

socket.on('student_join_error', (data) => {
    showFloatingNotification(data.error || '연결에 실패했습니다', 'error');
});

socket.on('message_history', (data) => {
    if (data.messages && data.messages.length > 0) {
        data.messages.forEach((serverMessage) => {
            const mid = serverMessage.id || Date.now() + Math.random();
            const message = {
                id: mid,
                sender: serverMessage.sender,
                message: serverMessage.message,
                timestamp: serverMessage.timestamp,
                isRead: true,
                receivedAt: serverMessage.timestamp,
                isFromHistory: true
            };

            const exists = messages.some(
                (m) => m.message === message.message && m.timestamp === message.timestamp
            );

            if (!exists) {
                messages.push(message);
            }
        });

        messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        saveMessages();
        displayMessages();
        showFloatingNotification(`이전 메시지 ${data.messages.length}개를 불러왔습니다`, 'info');
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
    if (data.status !== 'success') {
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

// 화면 전환
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

function convertUrlsToLinks(text) {
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

    return text.replace(urlPattern, (url) => {
        let href = url;
        if (url.startsWith('www.')) {
            href = 'http://' + url;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary text-decoration-underline">${url}</a>`;
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
            <div class="d-flex align-items-start">
                <small class="text-muted me-2">${escapeHtml(message.timestamp)}</small>
                <button class="btn btn-sm btn-outline-danger delete-message-btn" title="이 메시지 삭제">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        <div class="message-content" style="word-break: break-word; line-height: 1.5;">${messageWithLinks}</div>
        <div class="text-end mt-2">
            <small class="text-muted">수신: ${escapeHtml(message.receivedAt)}</small>
        </div>
    `;

    messageElement.addEventListener('click', () => {
        if (!message.isRead) {
            markMessageRead(message.id);
        }
    });

    const deleteBtn = messageElement.querySelector('.delete-message-btn');
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMessage(message.id);
    });

    messageList.appendChild(messageElement);
}

function deleteMessage(messageId) {
    messages = messages.filter((m) => m.id !== messageId);
    saveMessages();
    displayMessages();
    showFloatingNotification('메시지를 삭제했습니다', 'info');

    socket.emit('delete_message', {
        teacher_code: studentInfo.teacherCode,
        student_name: studentInfo.name,
        message_id: messageId
    });
}

function markMessageRead(messageId) {
    const message = messages.find((m) => m.id === messageId);
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

function markVisibleMessagesRead() {
    let changed = false;
    messages.forEach((message) => {
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

function markAllMessagesRead() {
    let changed = false;
    messages.forEach((message) => {
        if (!message.isRead) {
            message.isRead = true;
            changed = true;
        }
    });

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

    if (unread > 0) {
        document.title = `(${unread}) 학생용 메시지`;
    } else {
        document.title = '학생용 메시지';
    }
}

function saveMessages() {
    localStorage.setItem('studentMessages', JSON.stringify(messages));
}

function showFloatingNotification(message, type = 'info') {
    const colors = {
        success: 'rgba(40, 167, 69, 0.95)',
        info: 'rgba(23, 162, 184, 0.95)',
        warning: 'rgba(255, 193, 7, 0.95)',
        error: 'rgba(220, 53, 69, 0.95)'
    };

    const notification = document.createElement('div');
    notification.className = 'floating-notification';
    notification.style.background = colors[type] || colors.info;
    notification.innerHTML = `<i class="fas fa-info-circle me-2"></i>${message}`;

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function showMessageNotification(message) {
    if (notificationSound) {
        notificationSound.play().catch(() => {});
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

        notification.onclick = function () {
            window.focus();
            notification.close();
        };

        setTimeout(() => {
            notification.close();
        }, 5000);
    }
}
