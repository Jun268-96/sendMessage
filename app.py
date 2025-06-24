from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import sqlite3
import json
from datetime import datetime
import os

# Flask 앱 초기화
app = Flask(__name__)
app.config['SECRET_KEY'] = 'teacher_student_message_system'

# Socket.IO 초기화
socketio = SocketIO(app, cors_allowed_origins="*")

# 연결된 클라이언트 저장
connected_clients = {}
teachers = {}
students = {}

# 6자리 교사 코드 생성 함수
def generate_teacher_code():
    """중복되지 않는 6자리 교사 코드 생성"""
    import random
    import string
    
    while True:
        # 6자리 숫자 코드 생성 (100000 ~ 999999)
        code = str(random.randint(100000, 999999))
        
        # 중복 체크
        conn = sqlite3.connect('messages.db')
        c = conn.cursor()
        c.execute('SELECT teacher_code FROM teachers WHERE teacher_code = ?', (code,))
        exists = c.fetchone()
        conn.close()
        
        if not exists:
            return code

# 데이터베이스 초기화
def init_db():
    conn = sqlite3.connect('messages.db')
    c = conn.cursor()
    
    # 교사 테이블 생성
    c.execute('''CREATE TABLE IF NOT EXISTS teachers
                 (teacher_code TEXT PRIMARY KEY,
                  teacher_name TEXT NOT NULL,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  last_login DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    
    # 클래스 테이블 생성
    c.execute('''CREATE TABLE IF NOT EXISTS classes
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  teacher_code TEXT NOT NULL,
                  class_number TEXT NOT NULL,
                  class_name TEXT DEFAULT '',
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (teacher_code) REFERENCES teachers(teacher_code),
                  UNIQUE(teacher_code, class_number))''')
    
    # 학생 테이블 생성
    c.execute('''CREATE TABLE IF NOT EXISTS students
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  teacher_code TEXT NOT NULL,
                  class_number TEXT NOT NULL,
                  student_name TEXT NOT NULL,
                  student_id TEXT DEFAULT '',
                  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                  socket_id TEXT DEFAULT '',
                  FOREIGN KEY (teacher_code) REFERENCES teachers(teacher_code))''')
    
    # 메시지 테이블 수정 (teacher_code 추가)
    c.execute('''CREATE TABLE IF NOT EXISTS messages
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  teacher_code TEXT NOT NULL,
                  class_number TEXT,
                  sender_type TEXT NOT NULL,
                  sender_id TEXT NOT NULL,
                  recipient_type TEXT,
                  recipient_id TEXT,
                  message TEXT NOT NULL,
                  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                  is_read BOOLEAN DEFAULT FALSE,
                  FOREIGN KEY (teacher_code) REFERENCES teachers(teacher_code))''')
    
    # 기존 users 테이블 (호환성 유지)
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id TEXT PRIMARY KEY,
                  user_type TEXT NOT NULL,
                  name TEXT NOT NULL,
                  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                  is_online BOOLEAN DEFAULT FALSE)''')
    
    conn.commit()
    conn.close()

# 기본 라우팅
@app.route('/')
def index():
    return '''
    <h1>교사-학생 메시지 전송 시스템</h1>
    <p><a href="/teacher/register">교사 등록</a></p>
    <p><a href="/teacher/login">교사 로그인</a></p>
    <p><a href="/student">학생용 페이지</a></p>
    '''

# 교사 등록 페이지
@app.route('/teacher/register')
def teacher_register():
    return render_template('teacher_register.html')

# 교사 등록 처리
@app.route('/teacher/register', methods=['POST'])
def teacher_register_post():
    teacher_name = request.form.get('teacher_name', '').strip()
    
    if not teacher_name:
        return render_template('teacher_register.html', error='교사 이름을 입력해주세요.')
    
    # 6자리 코드 생성
    teacher_code = generate_teacher_code()
    
    try:
        # 데이터베이스에 교사 등록
        conn = sqlite3.connect('messages.db')
        c = conn.cursor()
        c.execute('INSERT INTO teachers (teacher_code, teacher_name) VALUES (?, ?)', 
                  (teacher_code, teacher_name))
        conn.commit()
        conn.close()
        
        return render_template('teacher_code.html', 
                             teacher_name=teacher_name, 
                             teacher_code=teacher_code)
    
    except Exception as e:
        return render_template('teacher_register.html', error=f'등록 중 오류가 발생했습니다: {str(e)}')

# 교사 로그인 페이지
@app.route('/teacher/login')
def teacher_login():
    return render_template('teacher_login.html')

# 교사 로그인 처리
@app.route('/teacher/login', methods=['POST'])
def teacher_login_post():
    teacher_code = request.form.get('teacher_code', '').strip()
    
    if not teacher_code:
        return render_template('teacher_login.html', error='교사 코드를 입력해주세요.')
    
    try:
        # 교사 코드 확인
        conn = sqlite3.connect('messages.db')
        c = conn.cursor()
        c.execute('SELECT teacher_name FROM teachers WHERE teacher_code = ?', (teacher_code,))
        teacher = c.fetchone()
        
        if teacher:
            # 로그인 시간 업데이트
            c.execute('UPDATE teachers SET last_login = CURRENT_TIMESTAMP WHERE teacher_code = ?', 
                      (teacher_code,))
            conn.commit()
            conn.close()
            
            # 교사 대시보드로 리다이렉트 (세션에 코드 저장)
            from flask import session
            session['teacher_code'] = teacher_code
            session['teacher_name'] = teacher[0]
            
            return render_template('teacher.html', 
                                 teacher_code=teacher_code, 
                                 teacher_name=teacher[0])
        else:
            conn.close()
            return render_template('teacher_login.html', error='올바르지 않은 교사 코드입니다.')
    
    except Exception as e:
        return render_template('teacher_login.html', error=f'로그인 중 오류가 발생했습니다: {str(e)}')

# 기존 교사 페이지 (세션 체크 추가)
@app.route('/teacher')
def teacher():
    from flask import session
    teacher_code = session.get('teacher_code')
    teacher_name = session.get('teacher_name')
    
    if not teacher_code:
        return '''
        <h2>교사 로그인이 필요합니다</h2>
        <p><a href="/teacher/login">교사 로그인</a></p>
        <p><a href="/teacher/register">교사 등록</a></p>
        '''
    
    return render_template('teacher.html', 
                         teacher_code=teacher_code, 
                         teacher_name=teacher_name)

@app.route('/student')
def student():
    return render_template('student.html')

# Socket.IO 이벤트 핸들러
@socketio.on('connect')
def on_connect():
    print(f'클라이언트 연결됨: {request.sid}')

@socketio.on('disconnect')
def on_disconnect():
    print(f'클라이언트 연결 해제됨: {request.sid}')
    
    # 연결 해제된 클라이언트 정리
    if request.sid in teachers:
        del teachers[request.sid]
    elif request.sid in students:
        student_info = students[request.sid]
        teacher_code = student_info.get('teacher_code')
        
        # 메모리에서 삭제
        del students[request.sid]
        
        # 해당 교사에게만 학생 연결 해제 알림 (다중 교사 시스템)
        if teacher_code:
            teacher_room = f'teacher_{teacher_code}'
            socketio.emit('student_disconnected', student_info, room=teacher_room)
            print(f'학생 연결 해제됨: {student_info.get("student_name")} ({student_info.get("class_number")}) -> 교사 {teacher_code}')

@socketio.on('teacher_join')
def on_teacher_join(data):
    teacher_code = data.get('teacher_code')
    teacher_name = data.get('teacher_name', '교사')
    
    # 교사 정보 저장
    teachers[request.sid] = {
        'teacher_code': teacher_code,
        'teacher_name': teacher_name,
        'socket_id': request.sid
    }
    
    # 해당 교사의 룸에 참가
    teacher_room = f'teacher_{teacher_code}'
    join_room(teacher_room)
    
    # 해당 교사의 학생 목록만 조회하여 전송
    try:
        conn = sqlite3.connect('messages.db')
        c = conn.cursor()
        c.execute('''SELECT class_number, student_name, student_id, socket_id, last_seen
                     FROM students 
                     WHERE teacher_code = ? 
                     ORDER BY class_number, student_name''', (teacher_code,))
        
        db_students = c.fetchall()
        conn.close()
        
        # 현재 연결된 학생들과 매칭
        student_list = []
        for db_student in db_students:
            class_number, student_name, student_id, socket_id, last_seen = db_student
            
            # 현재 연결되어 있는지 확인
            is_online = socket_id in students
            
            student_list.append({
                'class_number': class_number,
                'student_name': student_name,
                'student_id': student_id or '',
                'socket_id': socket_id,
                'last_seen': last_seen,
                'is_online': is_online,
                'display_name': f"{student_name} ({class_number})" + (f" - {student_id}" if student_id else "")
            })
        
        emit('student_list_update', student_list)
        print(f'교사 연결됨: {teacher_name} ({teacher_code}) - 학생 {len(student_list)}명')
        
    except Exception as e:
        print(f'교사 연결 오류: {e}')
        emit('student_list_update', [])

@socketio.on('student_join')
def on_student_join(data):
    teacher_code = data.get('teacher_code')
    class_number = data.get('class_number')
    student_name = data.get('student_name')
    student_id = data.get('student_id', '')
    
    # 교사 코드 검증
    try:
        conn = sqlite3.connect('messages.db')
        c = conn.cursor()
        c.execute('SELECT teacher_name FROM teachers WHERE teacher_code = ?', (teacher_code,))
        teacher = c.fetchone()
        
        if not teacher:
            conn.close()
            emit('student_join_error', {'error': '올바르지 않은 교사 코드입니다.'})
            return
        
        teacher_name = teacher[0]
        
        # 기존 동일한 학생의 레코드 삭제 (중복 방지)
        c.execute('''DELETE FROM students 
                     WHERE teacher_code = ? AND class_number = ? AND student_name = ? AND student_id = ?''',
                  (teacher_code, class_number, student_name, student_id))
        
        # 새로운 학생 정보를 데이터베이스에 저장
        c.execute('''INSERT INTO students 
                     (teacher_code, class_number, student_name, student_id, socket_id, last_seen)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
                  (teacher_code, class_number, student_name, student_id, request.sid))
        conn.commit()
        conn.close()
        
        # 학생 정보 구성
        student_info = {
            'teacher_code': teacher_code,
            'class_number': class_number,
            'student_name': student_name,
            'student_id': student_id,
            'socket_id': request.sid,
            'teacher_name': teacher_name
        }
        
        # 메모리에 저장
        students[request.sid] = student_info
        
        # 해당 교사의 룸에 참가 (교사 코드별 분리)
        teacher_room = f'teacher_{teacher_code}'
        student_room = f'students_{teacher_code}'
        join_room(student_room)
        
        # 학생에게 연결 성공 응답 전송
        emit('student_join_success', {
            'status': 'success',
            'student_info': student_info,
            'teacher_name': teacher_name
        })
        
        # 해당 교사에게만 새 학생 연결 알림
        socketio.emit('student_connected', student_info, room=teacher_room)
        print(f'학생 연결됨: {student_name} ({class_number}) -> 교사 {teacher_name} ({teacher_code})')
        
    except Exception as e:
        print(f'학생 연결 오류: {e}')
        emit('student_join_error', {'error': '연결 중 오류가 발생했습니다.'})

@socketio.on('get_message_history')
def on_get_message_history(data):
    """학생이 메시지 히스토리를 요청할 때"""
    student_id = data.get('student_id')
    
    try:
        conn = sqlite3.connect('messages.db')
        c = conn.cursor()
        
        # 해당 학생에게 전송된 메시지들 조회 (전체 전송 + 개별 전송)
        c.execute('''SELECT sender_type, sender_id, message, timestamp 
                     FROM messages 
                     WHERE recipient_id LIKE ? OR recipient_id = 'all'
                     ORDER BY timestamp DESC 
                     LIMIT 50''', (f'%{student_id}%',))
        
        messages = []
        for row in c.fetchall():
            messages.append({
                'sender': '교사' if row[0] == 'teacher' else row[1],
                'message': row[2],
                'timestamp': row[3]
            })
        
        conn.close()
        
        # 학생에게 메시지 히스토리 전송
        emit('message_history', {'messages': messages})
        
    except Exception as e:
        print(f'메시지 히스토리 조회 오류: {e}')
        emit('message_history', {'messages': []})

@socketio.on('send_message')
def on_send_message(data):
    sender_type = data.get('sender_type')
    message = data.get('message')
    recipients = data.get('recipients', [])
    teacher_code = data.get('teacher_code')  # 다중 교사 시스템용
    
    if sender_type == 'teacher' and teacher_code:
        # 교사가 메시지 전송
        student_room = f'students_{teacher_code}'
        
        if 'all' in recipients:
            # 해당 교사의 모든 학생에게 전송
            socketio.emit('receive_message', {
                'message': message,
                'sender': '교사',
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }, room=student_room)
        else:
            # 특정 학생들에게 전송
            for student_socket_id in recipients:
                # socket_id로 직접 전송
                if student_socket_id in students:
                    socketio.emit('receive_message', {
                        'message': message,
                        'sender': '교사',
                        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    }, room=student_socket_id)
        
        # 메시지 데이터베이스에 저장 (다중 교사 시스템용)
        save_message_multi_teacher(teacher_code, 'teacher', 'student', recipients, message)
        
        # 교사에게 전송 완료 알림
        emit('message_sent', {'status': 'success'})

def save_message_multi_teacher(teacher_code, sender_type, recipient_type, recipient_ids, message):
    """다중 교사 시스템용 메시지 저장"""
    conn = sqlite3.connect('messages.db')
    c = conn.cursor()
    
    recipient_str = ','.join(recipient_ids) if isinstance(recipient_ids, list) else str(recipient_ids)
    
    c.execute('''INSERT INTO messages (teacher_code, sender_type, sender_id, recipient_type, recipient_id, message)
                 VALUES (?, ?, ?, ?, ?, ?)''',
              (teacher_code, sender_type, teacher_code, recipient_type, recipient_str, message))
    
    conn.commit()
    conn.close()

def save_message(sender_type, sender_id, recipient_type, recipient_ids, message):
    """기존 호환성을 위한 메시지 저장 (deprecated)"""
    conn = sqlite3.connect('messages.db')
    c = conn.cursor()
    
    recipient_str = ','.join(recipient_ids) if isinstance(recipient_ids, list) else str(recipient_ids)
    
    # 기본 teacher_code로 저장 (호환성)
    c.execute('''INSERT INTO messages (teacher_code, sender_type, sender_id, recipient_type, recipient_id, message)
                 VALUES (?, ?, ?, ?, ?, ?)''',
              ('000000', sender_type, sender_id, recipient_type, recipient_str, message))
    
    conn.commit()
    conn.close()

if __name__ == '__main__':
    # 데이터베이스 초기화
    init_db()
    
    # 서버 실행
    print("서버 시작 중...")
    print("교사용 페이지: http://localhost:5000/teacher")
    print("학생용 페이지: http://localhost:5000/student")
    
    socketio.run(app, debug=True, host='0.0.0.0', port=5000) 