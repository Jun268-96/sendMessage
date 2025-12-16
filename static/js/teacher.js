// Socket.IO 연결
const socket = io();

// 상태
let selectedStudents = new Set();
let connectedStudents = new Map();
let lastSentNames = [];
let lastSentAll = false;
let lastMessageId = null;
let allowStudentMessages = false;
let sentMessages = []; // 교사 → 학생 전체 목록
let studentMessages = []; // 학생 → 교사 전체 목록

// DOM
const connectionStatus = document.getElementById('connectionStatus');
const studentCount = document.getElementById('studentCount');
const studentList = document.getElementById('studentList');
const messageText = document.getElementById('messageText');
const sendToAllCheckbox = document.getElementById('sendToAll');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const recipientInfo = document.getElementById('recipientInfo');
const recipientTooltipBtn = document.getElementById('recipientTooltipBtn');
const messageHistoryDiv = document.getElementById('messageHistory');
const selectAllBtn = document.getElementById('selectAllBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const notificationToast = document.getElementById('notificationToast');
const toastMessage = document.getElementById('toastMessage');
const allowStudentMessagesToggle = document.getElementById('allowStudentMessages');
const studentMessageHistory = document.getElementById('studentMessageHistory');
const studentMessageStatus = document.getElementById('studentMessageStatus');
const loadStudentMessagesBtn = document.getElementById('loadStudentMessagesBtn');

// 모달
let modalEl = null;
let modalBody = null;
let modalTitle = null;

const toast = new bootstrap.Toast(notificationToast);

document.addEventListener('DOMContentLoaded', function () {
    initModal();
    initializeEventListeners();
    connectToServer();
});

function initModal() {
    // 동적으로 모달 추가 (없을 경우)
    if (!document.getElementById('logModal')) {
        const modalHtml = `
        <div class="modal fade" id="logModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" id="logModalTitle"></h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body" id="logModalBody"></div>
            </div>
          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    modalEl = new bootstrap.Modal(document.getElementById('logModal'));
    modalBody = document.getElementById('logModalBody');
    modalTitle = document.getElementById('logModalTitle');
}

function initializeEventListeners() {
    sendMessageBtn.addEventListener('click', sendMessage);
    messageText.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && e.ctrlKey) sendMessage();
    });

    sendToAllCheckbox.addEventListener('change', function () {
        updateRecipientInfo();
        if (this.checked) {
            selectedStudents.clear();
            updateStudentSelection();
        }
    });

    selectAllBtn.addEventListener('click', selectAllStudents);
    clearAllBtn.addEventListener('click', clearAllStudents);

    recipientTooltipBtn.addEventListener('mouseenter', showRecipientTooltip);
    recipientTooltipBtn.addEventListener('mouseleave', hideRecipientTooltip);
    recipientTooltipBtn.addEventListener('blur', hideRecipientTooltip);

    allowStudentMessagesToggle.addEventListener('change', function () {
        socket.emit('teacher_toggle_receive', { allow: this.checked });
    });

    loadStudentMessagesBtn.addEventListener('click', requestTeacherMessages);
}

function connectToServer() {
    const teacherCode = window.teacherCode;
    const teacherName = window.teacherName;
    if (!teacherCode) {
        alert('교사 인증이 필요합니다. 로그인 해주세요.');
        window.location.href = '/teacher/login';
        return;
    }
    socket.emit('teacher_join', {
        teacher_code: teacherCode,
        teacher_name: teacherName
    });
}

// 소켓 이벤트
socket.on('connect', function () {
    connectionStatus.textContent = '연결됨';
    connectionStatus.className = 'badge bg-success';
    showNotification('서버와 연결되었습니다', 'success');
});

socket.on('disconnect', function () {
    connectionStatus.textContent = '연결 끊김';
    connectionStatus.className = 'badge bg-danger';
    showNotification('서버 연결이 끊어졌습니다', 'danger');
});

socket.on('student_list_update', function (students) {
    updateStudentList(students);
});

socket.on('student_connected', function (student) {
    // 동일 이름으로 이전에 남아있던 카드/소켓 정보를 제거해 중복 표시를 막음
    removeStudentByName(student.student_name);
    connectedStudents.set(student.socket_id, student);
    addStudentToList(student);
    updateStudentCount();
    showNotification(`${student.student_name} 학생이 연결되었습니다`, 'info');
});

socket.on('student_disconnected', function (student) {
    connectedStudents.delete(student.socket_id);
    removeStudentFromList(student.socket_id);
    selectedStudents.delete(student.socket_id);
    updateStudentCount();
    updateRecipientInfo();
    showNotification(`${student.student_name} 학생의 연결이 해제되었습니다`, 'warning');
});

socket.on('kick_result', function (data) {
    if (data.status === 'success') {
        showNotification(`${data.student_name || '학생'}을 내보냈습니다`, 'success');
    } else {
        showNotification(data.message || '내보내기에 실패했습니다', 'warning');
    }
});

socket.on('receive_status', function (data) {
    allowStudentMessages = !!data.allow;
    allowStudentMessagesToggle.checked = allowStudentMessages;
    studentMessageStatus.textContent = allowStudentMessages ? '수신 중' : '수신 불가';
    studentMessageStatus.className = allowStudentMessages ? 'badge bg-success text-white' : 'badge bg-dark text-white';

    // 페이지 로드 시 메시지 히스토리 자동 조회
    requestTeacherMessages();
    requestSentMessages();
});

socket.on('new_message_from_student', function (data) {
    studentMessages.unshift(data);
    renderStudentPreview();
    showNotification(`학생 메시지 도착: ${data.student_name}`, 'info');
});

socket.on('teacher_messages', function (payload) {
    studentMessages = payload.messages || [];
    renderStudentPreview();
});

socket.on('sent_messages', function (payload) {
    // 서버에서 받아온 데이터를 sentMessages 형식으로 변환
    const msgs = payload.messages || [];
    sentMessages = msgs.map(msg => ({
        id: msg.id,
        label: msg.recipient || '전체 학생',
        recipients: msg.recipient ? msg.recipient.split(',') : [],
        isAll: msg.recipient === 'all',
        message: msg.message,
        timestamp: msg.timestamp
    }));
    renderSentPreview();
});

socket.on('delete_result_teacher', function (data) {
    if (data.status === 'success') {
        showNotification('메시지가 삭제되었습니다', 'success');
        sentMessages = sentMessages.filter(m => String(m.id) !== String(data.message_id));
        renderSentPreview();
    } else {
        showNotification(data.message || '메시지 삭제에 실패했습니다', 'warning');
    }
});

socket.on('message_sent', function (data) {
    if (data.status === 'success') {
        const message = messageText.value;
        const recipientNames = lastSentNames.length ? lastSentNames : buildSelectedNames();
        lastMessageId = data.message_id || null;
        // 히스토리 배열 관리
        const entry = {
            id: lastMessageId,
            label: formatRecipientLabel(recipientNames, lastSentAll),
            recipients: recipientNames,
            isAll: lastSentAll,
            message: message,
            timestamp: new Date().toLocaleString('ko-KR')
        };
        sentMessages.unshift(entry);
        if (sentMessages.length > 200) sentMessages = sentMessages.slice(0, 200);
        renderSentPreview();
        messageText.value = '';
        showNotification('메시지가 성공적으로 전송되었습니다', 'success');
    }
});

// 학생 목록
function updateStudentList(students) {
    connectedStudents.clear();
    students.forEach(student => connectedStudents.set(student.socket_id, student));
    if (students.length === 0) {
        studentList.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="fas fa-user-friends fa-2x mb-2"></i>
                <p>아직 연결된 학생이 없습니다</p>
            </div>
        `;
    } else {
        studentList.innerHTML = '';
        // 한글 가나다순 정렬
        const sortedStudents = [...students].sort((a, b) =>
            a.student_name.localeCompare(b.student_name, 'ko-KR')
        );
        sortedStudents.forEach(addStudentToList);
    }
    updateStudentCount();
}

function addStudentToList(student) {
    const placeholder = studentList.querySelector('.text-center');
    if (placeholder) {
        placeholder.remove();
    }
    const isOnline = student.is_online !== false;
    const card = document.createElement('div');
    card.className = 'card student-card mb-2';
    card.dataset.socketId = student.socket_id;
    card.dataset.studentName = student.student_name;
    const statusIcon = isOnline ? 'fa-circle status-online' : 'fa-circle status-offline';
    const statusText = isOnline ? '온라인' : '오프라인';
    const statusClass = isOnline ? 'text-success' : 'text-muted';
    card.innerHTML = `
        <div class="card-body p-2">
            <div class="d-flex justify-content-between align-items-center">
                <div><strong>${student.student_name}</strong></div>
                <div class="d-flex align-items-center gap-2">
                    <i class="fas ${statusIcon}"></i>
                    <small class="${statusClass}">${statusText}</small>
                    ${isOnline ? `<button class="btn btn-sm btn-outline-danger kick-btn"><i class="fas fa-user-slash"></i></button>` : ''}
                </div>
            </div>
        </div>
    `;
    card.addEventListener('click', () => { if (isOnline) toggleStudentSelection(student.socket_id, card); });
    if (isOnline) {
        const kickBtn = card.querySelector('.kick-btn');
        kickBtn.addEventListener('click', (e) => { e.stopPropagation(); kickStudent(student.socket_id, student.student_name); });
    } else {
        card.style.opacity = '0.6'; card.style.cursor = 'not-allowed';
    }
    studentList.appendChild(card);
}

// 동일 이름의 학생이 이전 소켓으로 남아 있으면 제거 (재접속 시 중복 카드 방지)
function removeStudentByName(studentName) {
    for (const [sid, info] of connectedStudents.entries()) {
        if (info && info.student_name === studentName) {
            connectedStudents.delete(sid);
        }
    }
    const selector = `[data-student-name="${CSS.escape(studentName)}"]`;
    let card = document.querySelector(selector);
    while (card) {
        card.remove();
        card = document.querySelector(selector);
    }
}

function removeStudentFromList(socketId) {
    const card = document.querySelector(`[data-socket-id="${socketId}"]`);
    if (card) card.remove();
    if (connectedStudents.size === 0) {
        studentList.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="fas fa-user-friends fa-2x mb-2"></i>
                <p>아직 연결된 학생이 없습니다</p>
            </div>
        `;
    }
}

// 선택/토글
function toggleStudentSelection(socketId, cardElement) {
    if (sendToAllCheckbox.checked) sendToAllCheckbox.checked = false;
    if (selectedStudents.has(socketId)) {
        selectedStudents.delete(socketId);
        cardElement.classList.remove('selected');
    } else {
        selectedStudents.add(socketId);
        cardElement.classList.add('selected');
    }
    updateRecipientInfo();
}
function selectAllStudents() {
    sendToAllCheckbox.checked = false;
    selectedStudents.clear();
    connectedStudents.forEach((student, socketId) => {
        if (student.is_online !== false) selectedStudents.add(socketId);
    });
    updateStudentSelection();
    updateRecipientInfo();
}
function clearAllStudents() {
    sendToAllCheckbox.checked = false;
    selectedStudents.clear();
    updateStudentSelection();
    updateRecipientInfo();
}
function updateStudentSelection() {
    document.querySelectorAll('.student-card').forEach(card => {
        card.classList.toggle('selected', selectedStudents.has(card.dataset.socketId));
    });
}

// 수신자 표시
function updateRecipientInfo() {
    hideRecipientTooltip();
    if (sendToAllCheckbox.checked) {
        recipientInfo.textContent = `전체 학생 (${connectedStudents.size}명)에게 전송`;
        recipientInfo.className = 'text-success';
        recipientTooltipBtn.style.display = 'none';
    } else if (selectedStudents.size > 0) {
        const selectedArray = Array.from(selectedStudents).map(id => connectedStudents.get(id)).filter(Boolean);
        const first = selectedArray[0]?.student_name || '선택된 학생';
        const others = selectedArray.length - 1;
        if (others > 0) {
            recipientInfo.textContent = `${first} 외 ${others}명`;
            recipientTooltipBtn.style.display = 'inline-flex';
        } else {
            recipientInfo.textContent = first;
            recipientTooltipBtn.style.display = 'none';
        }
        recipientInfo.className = 'text-info';
    } else {
        recipientInfo.textContent = '수신자를 선택해주세요';
        recipientInfo.className = 'text-muted';
        recipientTooltipBtn.style.display = 'none';
    }
}
function showRecipientTooltip() {
    const arr = Array.from(selectedStudents).map(id => connectedStudents.get(id)).filter(Boolean);
    if (arr.length <= 1) return;
    showTooltip(recipientTooltipBtn, arr.map(s => s.student_name), 'recipientTooltip');
}
function hideRecipientTooltip() { hideTooltip('recipientTooltip'); }

// 학생 수
function updateStudentCount() { studentCount.textContent = connectedStudents.size; }

// 전송 (교사→학생)
function sendMessage() {
    const message = messageText.value.trim();
    if (!message) { showNotification('메시지를 입력해주세요', 'warning'); return; }
    let recipients = [];
    const recipientNames = [];
    if (sendToAllCheckbox.checked) {
        recipients = ['all'];
        connectedStudents.forEach((student) => recipientNames.push(student.student_name));
    } else if (selectedStudents.size > 0) {
        recipients = Array.from(selectedStudents);
        recipients.forEach((sid) => {
            const info = connectedStudents.get(sid);
            if (info) recipientNames.push(info.student_name);
        });
    } else {
        showNotification('수신자를 선택해주세요', 'warning');
        return;
    }
    lastSentNames = recipientNames.slice();
    lastSentAll = sendToAllCheckbox.checked;
    socket.emit('send_message', {
        sender_type: 'teacher',
        teacher_code: window.teacherCode,
        message: message,
        recipients: recipients
    });
}

// 학생 강퇴
function kickStudent(socketId, studentName) {
    if (!socketId) return;
    const ok = confirm(`${studentName || '학생'}을 내보낼까요?`);
    if (!ok) return;
    socket.emit('kick_student', { student_socket_id: socketId });
}

// 유틸
function formatRecipientLabel(names = [], isAll = false) {
    if (isAll) return names.length > 0 ? `${names[0]} 외 ${Math.max(names.length - 1, 0)}명` : '전체 학생';
    if (!names || names.length === 0) return '수신자 없음';
    if (names.length === 1) return names[0];
    return `${names[0]} 외 ${names.length - 1}명`;
}

function showTooltip(target, names, tooltipId) {
    hideTooltip(tooltipId);
    if (!names || names.length === 0) return;
    const tooltip = document.createElement('div');
    tooltip.id = tooltipId;
    tooltip.className = 'recipient-tooltip shadow-sm';
    tooltip.style.position = 'absolute';
    tooltip.style.top = `${target.getBoundingClientRect().bottom + window.scrollY + 6}px`;
    tooltip.style.left = `${target.getBoundingClientRect().left + window.scrollX}px`;
    tooltip.style.background = '#fff';
    tooltip.style.border = '1px solid rgba(0,0,0,0.1)';
    tooltip.style.borderRadius = '6px';
    tooltip.style.padding = '8px 12px';
    tooltip.style.zIndex = 2000;
    tooltip.style.maxWidth = '240px';
    tooltip.style.maxHeight = '200px';
    tooltip.style.overflowY = 'auto';
    tooltip.innerHTML = names.map(n => `<div class="small mb-1">${n}</div>`).join('');
    document.body.appendChild(tooltip);
}
function hideTooltip(tooltipId) {
    const existing = document.getElementById(tooltipId);
    if (existing) existing.remove();
}

// 교사 전송 기록: 프리뷰 3개 + 더보기 모달
function renderSentPreview() {
    const preview = sentMessages.slice(0, 3);
    if (preview.length === 0) {
        messageHistoryDiv.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="fas fa-envelope fa-2x mb-2"></i>
                <p>아직 전송한 메시지가 없습니다</p>
            </div>
        `;
    } else {
        messageHistoryDiv.innerHTML = '';
        preview.forEach(msg => {
            const item = document.createElement('div');
            item.className = 'message-item';
            item.innerHTML = `
                <div class="d-flex justify-content-between mb-2">
                    <strong>수신자: ${escapeHtml(msg.label)}</strong>
                    <div class="d-flex align-items-center gap-2">
                        <small class="text-muted">${escapeHtml(msg.timestamp)}</small>
                        <button class="btn btn-sm btn-outline-danger delete-sent-btn" data-id="${msg.id}" title="삭제">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
                <div style="word-break: break-word; line-height: 1.5;">${convertUrlsToLinks(escapeHtml(msg.message))}</div>
            `;
            messageHistoryDiv.appendChild(item);
        });
        // 삭제 버튼 이벤트 바인딩
        messageHistoryDiv.querySelectorAll('.delete-sent-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteMessage(btn.dataset.id);
            });
        });
    }
    // 더보기 버튼
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-primary btn-sm mt-2';
    btn.textContent = '더보기';
    btn.addEventListener('click', () => openModal('전송 기록', sentMessages, true));
    messageHistoryDiv.appendChild(btn);
}

// 학생 → 교사: 프리뷰 3개 + 모달
function renderStudentPreview() {
    const preview = studentMessages.slice(0, 3);
    if (preview.length === 0) {
        studentMessageHistory.innerHTML = `
            <div class="text-center text-muted p-3">
                <i class="fas fa-comment-dots fa-2x mb-2"></i>
                <p>아직 받은 학생 메시지가 없습니다</p>
            </div>
        `;
    } else {
        studentMessageHistory.innerHTML = '';
        preview.forEach(prependStudentMessage);
    }
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline-primary btn-sm mt-2';
    btn.textContent = '더보기';
    btn.addEventListener('click', () => openModal('학생 메시지', studentMessages, false));
    studentMessageHistory.appendChild(btn);
}

// 학생 메시지 전체 조회 요청
function requestTeacherMessages() {
    socket.emit('get_teacher_messages', {});
}

// 교사가 보낸 메시지 전체 조회 요청
function requestSentMessages() {
    socket.emit('get_sent_messages', {});
}

// 학생 메시지 카드를 추가하는 헬퍼
function prependStudentMessage(msg) {
    const container = studentMessageHistory;
    const item = document.createElement('div');
    item.className = 'message-item mb-2';
    const safeMsg = escapeHtml(msg.message || '');
    item.innerHTML = `
        <div class="d-flex justify-content-between mb-2">
            <strong>${escapeHtml(msg.student_name || '학생')}</strong>
            <small class="text-muted">${escapeHtml(msg.timestamp || '')}</small>
        </div>
        <div style="word-break: break-word; line-height: 1.5;">${convertUrlsToLinks(safeMsg)}</div>
    `;
    container.appendChild(item);
}

function openModal(title, items, isSent) {
    modalTitle.textContent = title;
    if (!items || items.length === 0) {
        modalBody.innerHTML = '<p class="text-muted">기록이 없습니다.</p>';
    } else {
        modalBody.innerHTML = items.map(msg => {
            const senderLabel = isSent ? `수신자: ${escapeHtml(msg.label || '')}` : `${escapeHtml(msg.student_name || '학생')}`;
            const ts = escapeHtml(msg.timestamp || '');
            const body = escapeHtml(msg.message || '');
            const deleteBtn = isSent ? `<button class="btn btn-sm btn-outline-danger delete-sent-btn ms-2" data-id="${msg.id}" title="삭제"><i class="fas fa-trash-alt"></i></button>` : '';
            return `
                <div class="message-item mb-2">
                    <div class="d-flex justify-content-between mb-2">
                        <strong>${senderLabel}</strong>
                        <div class="d-flex align-items-center gap-2">
                            <small class="text-muted">${ts}</small>
                            ${deleteBtn}
                        </div>
                    </div>
                    <div style="word-break: break-word; line-height: 1.5;">${convertUrlsToLinks(body)}</div>
                </div>`;
        }).join('');
        // 삭제 버튼 이벤트 바인딩
        if (isSent) {
            modalBody.querySelectorAll('.delete-sent-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    confirmDeleteMessage(btn.dataset.id);
                });
            });
        }
    }
    modalEl.show();
}

// 메시지 저장/알림
function convertUrlsToLinks(text) {
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    return text.replace(urlPattern, function (url) {
        let href = url;
        if (url.startsWith('www.')) href = 'http://' + url;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary text-decoration-underline">${url}</a>`;
    });
}
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function showNotification(message, type = 'info') {
    const bgClass = { 'success': 'bg-success', 'info': 'bg-info', 'warning': 'bg-warning', 'danger': 'bg-danger' };
    toastMessage.textContent = message;
    notificationToast.className = `toast ${bgClass[type] || 'bg-info'} text-white`;
    toast.show();
}

// 삭제 확인 모달
let pendingDeleteMessageId = null;

function confirmDeleteMessage(messageId) {
    pendingDeleteMessageId = messageId;
    // 확인 모달 생성
    let confirmModal = document.getElementById('confirmDeleteModal');
    if (!confirmModal) {
        confirmModal = document.createElement('div');
        confirmModal.id = 'confirmDeleteModal';
        confirmModal.className = 'modal fade';
        confirmModal.tabIndex = -1;
        confirmModal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-danger text-white">
                        <h5 class="modal-title"><i class="fas fa-exclamation-triangle me-2"></i>메시지 삭제</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>이 메시지를 정말 삭제하시겠습니까?</p>
                        <p class="text-muted small mb-0">삭제된 메시지는 학생에게도 더 이상 표시되지 않으며, 복구할 수 없습니다.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">취소</button>
                        <button type="button" class="btn btn-danger" id="confirmDeleteBtn">삭제</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(confirmModal);
        document.getElementById('confirmDeleteBtn').addEventListener('click', executeDeleteMessage);
    }
    const bsModal = new bootstrap.Modal(confirmModal);
    bsModal.show();
}

function executeDeleteMessage() {
    if (pendingDeleteMessageId) {
        socket.emit('delete_message_teacher', { message_id: pendingDeleteMessageId });
        pendingDeleteMessageId = null;
    }
    const confirmModal = bootstrap.Modal.getInstance(document.getElementById('confirmDeleteModal'));
    if (confirmModal) confirmModal.hide();
}
