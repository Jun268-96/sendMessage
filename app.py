from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, disconnect
import sqlite3
import random
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = 'teacher_student_message_system'

socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory connection tracking
teachers = {}
students = {}


def get_db():
    return sqlite3.connect('messages.db')


def student_key(teacher_code, student_name):
    return f"{teacher_code}::{student_name or ''}"


def generate_teacher_code():
    """Create a unique 6-digit teacher code."""
    while True:
        code = str(random.randint(100000, 999999))
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT teacher_code FROM teachers WHERE teacher_code = ?', (code,))
        exists = c.fetchone()
        conn.close()
        if not exists:
            return code


def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute(
        '''CREATE TABLE IF NOT EXISTS teachers
           (teacher_code TEXT PRIMARY KEY,
            teacher_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME DEFAULT CURRENT_TIMESTAMP)'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS classes
           (id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_code TEXT NOT NULL,
            class_number TEXT NOT NULL,
            class_name TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (teacher_code) REFERENCES teachers(teacher_code),
            UNIQUE(teacher_code, class_number))'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS students
           (id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_code TEXT NOT NULL,
            class_number TEXT NOT NULL,
            student_name TEXT NOT NULL,
            student_id TEXT DEFAULT '',
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            socket_id TEXT DEFAULT '',
            FOREIGN KEY (teacher_code) REFERENCES teachers(teacher_code))'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS messages
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
            FOREIGN KEY (teacher_code) REFERENCES teachers(teacher_code))'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS hidden_messages
           (id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            teacher_code TEXT NOT NULL,
            student_key TEXT NOT NULL,
            hidden_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, student_key))'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS users
           (id TEXT PRIMARY KEY,
            user_type TEXT NOT NULL,
            name TEXT NOT NULL,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_online BOOLEAN DEFAULT FALSE)'''
    )

    conn.commit()
    conn.close()


@app.route('/')
def index():
    return '''
    <h1>교사-학생 메시지 알림 시스템</h1>
    <p><a href="/teacher/register">교사 등록</a></p>
    <p><a href="/teacher/login">교사 로그인</a></p>
    <p><a href="/student">학생 페이지</a></p>
    '''


@app.route('/teacher/register')
def teacher_register():
    return render_template('teacher_register.html')


@app.route('/teacher/register', methods=['POST'])
def teacher_register_post():
    teacher_name = request.form.get('teacher_name', '').strip()
    if not teacher_name:
        return render_template('teacher_register.html', error='교사 이름을 입력해주세요.')

    teacher_code = generate_teacher_code()
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            'INSERT INTO teachers (teacher_code, teacher_name) VALUES (?, ?)',
            (teacher_code, teacher_name)
        )
        conn.commit()
        conn.close()
        return render_template(
            'teacher_code.html',
            teacher_name=teacher_name,
            teacher_code=teacher_code
        )
    except Exception as e:
        return render_template('teacher_register.html', error=f'등록 실패: {str(e)}')


@app.route('/teacher/login')
def teacher_login():
    return render_template('teacher_login.html')


@app.route('/teacher/login', methods=['POST'])
def teacher_login_post():
    teacher_code = request.form.get('teacher_code', '').strip()
    if not teacher_code:
        return render_template('teacher_login.html', error='교사 코드를 입력해주세요.')

    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT teacher_name FROM teachers WHERE teacher_code = ?', (teacher_code,))
        teacher = c.fetchone()

        if teacher:
            c.execute(
                'UPDATE teachers SET last_login = CURRENT_TIMESTAMP WHERE teacher_code = ?',
                (teacher_code,)
            )
            conn.commit()
            conn.close()

            session['teacher_code'] = teacher_code
            session['teacher_name'] = teacher[0]

            return render_template('teacher.html', teacher_code=teacher_code, teacher_name=teacher[0])
        else:
            conn.close()
            return render_template('teacher_login.html', error='교사 코드를 확인해주세요.')
    except Exception as e:
        return render_template('teacher_login.html', error=f'로그인 실패: {str(e)}')


@app.route('/teacher')
def teacher():
    teacher_code = session.get('teacher_code')
    teacher_name = session.get('teacher_name')

    if not teacher_code:
        return '''
        <h2>교사 로그인이 필요합니다.</h2>
        <p><a href="/teacher/login">교사 로그인</a></p>
        <p><a href="/teacher/register">교사 등록</a></p>
        '''

    return render_template('teacher.html', teacher_code=teacher_code, teacher_name=teacher_name)


@app.route('/student')
def student():
    return render_template('student.html')


@socketio.on('connect')
def on_connect():
    print(f'클라이언트 연결: {request.sid}')


@socketio.on('disconnect')
def on_disconnect():
    print(f'클라이언트 연결 해제: {request.sid}')

    if request.sid in teachers:
        del teachers[request.sid]
    elif request.sid in students:
        student_info = students[request.sid]
        teacher_code = student_info.get('teacher_code')
        del students[request.sid]

        if teacher_code:
            teacher_room = f'teacher_{teacher_code}'
            socketio.emit('student_disconnected', student_info, room=teacher_room)
            print(f"학생 연결 해제: {student_info.get('student_name')} -> 교사 {teacher_code}")


@socketio.on('teacher_join')
def on_teacher_join(data):
    teacher_code = data.get('teacher_code')
    teacher_name = data.get('teacher_name', '교사')

    teachers[request.sid] = {
        'teacher_code': teacher_code,
        'teacher_name': teacher_name,
        'socket_id': request.sid
    }

    teacher_room = f'teacher_{teacher_code}'
    join_room(teacher_room)

    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''SELECT class_number, student_name, student_id, socket_id, last_seen
               FROM students
               WHERE teacher_code = ?
               ORDER BY student_name''',
            (teacher_code,)
        )

        db_students = c.fetchall()
        conn.close()

        student_list = []
        for db_student in db_students:
            class_number, student_name, student_id, socket_id, last_seen = db_student
            is_online = socket_id in students
            student_list.append({
                'class_number': class_number,
                'student_name': student_name,
                'student_id': student_id or '',
                'socket_id': socket_id,
                'last_seen': last_seen,
                'is_online': is_online,
                'display_name': student_name
            })

        emit('student_list_update', student_list)
        print(f'교사 연결: {teacher_name} ({teacher_code}) - 학생 {len(student_list)}명')
    except Exception as e:
        print(f'교사 연결 오류: {e}')
        emit('student_list_update', [])


@socketio.on('student_join')
def on_student_join(data):
    teacher_code = data.get('teacher_code')
    student_name = data.get('student_name')

    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT teacher_name FROM teachers WHERE teacher_code = ?', (teacher_code,))
        teacher = c.fetchone()

        if not teacher:
            conn.close()
            emit('student_join_error', {'error': '유효하지 않은 교사 코드입니다.'})
            return

        teacher_name = teacher[0]
        class_number = ''
        student_id = ''

        c.execute(
            '''DELETE FROM students
               WHERE teacher_code = ? AND student_name = ?''',
            (teacher_code, student_name)
        )

        c.execute(
            '''INSERT INTO students
               (teacher_code, class_number, student_name, student_id, socket_id, last_seen)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
            (teacher_code, class_number, student_name, student_id, request.sid)
        )
        conn.commit()
        conn.close()

        student_info = {
            'teacher_code': teacher_code,
            'class_number': class_number,
            'student_name': student_name,
            'student_id': student_id,
            'socket_id': request.sid,
            'teacher_name': teacher_name
        }

        students[request.sid] = student_info

        teacher_room = f'teacher_{teacher_code}'
        student_room = f'students_{teacher_code}'
        join_room(student_room)

        emit('student_join_success', {
            'status': 'success',
            'student_info': student_info,
            'teacher_name': teacher_name
        })

        socketio.emit('student_connected', student_info, room=teacher_room)
        print(f"학생 연결: {student_name} -> 교사 {teacher_name} ({teacher_code})")
    except Exception as e:
        print(f'학생 연결 오류: {e}')
        emit('student_join_error', {'error': '연결 중 오류가 발생했습니다.'})


@socketio.on('kick_student')
def on_kick_student(data):
    teacher_info = teachers.get(request.sid)
    if not teacher_info:
        emit('kick_result', {'status': 'error', 'message': '교사 인증에 실패했습니다.'})
        return

    student_sid = data.get('student_socket_id')
    if not student_sid or student_sid not in students:
        emit('kick_result', {'status': 'error', 'message': '해당 학생을 찾을 수 없습니다.'})
        return

    student_info = students.get(student_sid)
    if student_info.get('teacher_code') != teacher_info.get('teacher_code'):
        emit('kick_result', {'status': 'error', 'message': '해당 학생을 내보낼 권한이 없습니다.'})
        return

    socketio.emit('kicked', {'reason': 'teacher_kick'}, room=student_sid)
    disconnect(student_sid)
    emit('kick_result', {'status': 'success', 'student_name': student_info.get('student_name', '')})


@socketio.on('get_message_history')
def on_get_message_history(data):
    student_name = data.get('student_name')
    teacher_code = data.get('teacher_code')
    skey = student_key(teacher_code, student_name)

    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''SELECT id, sender_type, sender_id, message, timestamp
               FROM messages
               WHERE teacher_code = ?
                 AND (recipient_id = 'all' OR recipient_id LIKE ?)
                 AND id NOT IN (
                    SELECT message_id FROM hidden_messages
                    WHERE teacher_code = ? AND student_key = ?
                 )
               ORDER BY timestamp DESC
               LIMIT 50''',
            (teacher_code, f'%{student_name}%', teacher_code, skey)
        )

        messages = []
        for row in c.fetchall():
            messages.append({
                'id': row[0],
                'sender': '교사' if row[1] == 'teacher' else row[2],
                'message': row[3],
                'timestamp': row[4]
            })

        conn.close()
        emit('message_history', {'messages': messages})
    except Exception as e:
        print(f'메시지 조회 오류: {e}')
        emit('message_history', {'messages': []})


@socketio.on('send_message')
def on_send_message(data):
    sender_type = data.get('sender_type')
    message = data.get('message')
    recipients = data.get('recipients', [])
    teacher_code = data.get('teacher_code')

    if sender_type == 'teacher' and teacher_code:
        student_room = f'students_{teacher_code}'
        recipient_names = []

        if 'all' in recipients:
            recipient_names = [info.get('student_name', '') for info in students.values() if info.get('teacher_code') == teacher_code]
            msg_id = save_message_multi_teacher(teacher_code, 'teacher', 'student', recipient_names or ['all'], message)
            socketio.emit(
                'receive_message',
                {
                    'message_id': msg_id,
                    'message': message,
                    'sender': '교사',
                    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                },
                room=student_room
            )
        else:
            for student_socket_id in recipients:
                info = students.get(student_socket_id)
                if info:
                    recipient_names.append(info.get('student_name', ''))
            msg_id = save_message_multi_teacher(teacher_code, 'teacher', 'student', recipient_names, message)
            for student_socket_id in recipients:
                socketio.emit(
                    'receive_message',
                    {
                        'message_id': msg_id,
                        'message': message,
                        'sender': '교사',
                        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    },
                    room=student_socket_id
                )

        emit('message_sent', {'status': 'success', 'message_id': msg_id})


def save_message_multi_teacher(teacher_code, sender_type, recipient_type, recipient_names, message):
    recipient_str = 'all' if recipient_names == ['all'] else ','.join(recipient_names)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        '''INSERT INTO messages (teacher_code, sender_type, sender_id, recipient_type, recipient_id, message)
           VALUES (?, ?, ?, ?, ?, ?)''',
        (teacher_code, sender_type, teacher_code, recipient_type, recipient_str, message)
    )
    msg_id = c.lastrowid
    conn.commit()
    conn.close()
    return msg_id


def save_message(sender_type, sender_id, recipient_type, recipient_ids, message):
    recipient_str = ','.join(recipient_ids) if isinstance(recipient_ids, list) else str(recipient_ids)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        '''INSERT INTO messages (teacher_code, sender_type, sender_id, recipient_type, recipient_id, message)
           VALUES (?, ?, ?, ?, ?, ?)''',
        ('000000', sender_type, sender_id, recipient_type, recipient_str, message)
    )
    conn.commit()
    conn.close()


@socketio.on('delete_message')
def delete_message(data):
    teacher_code = data.get('teacher_code')
    student_name = data.get('student_name')
    message_id = data.get('message_id')

    if not (teacher_code and student_name and message_id):
        emit('delete_result', {'status': 'error', 'message': '필수 값이 누락되었습니다.'})
        return

    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''INSERT OR IGNORE INTO hidden_messages (message_id, teacher_code, student_key)
               VALUES (?, ?, ?)''',
            (message_id, teacher_code, student_key(teacher_code, student_name))
        )
        conn.commit()
        conn.close()
        emit('delete_result', {'status': 'success', 'message_id': message_id})
    except Exception as e:
        print(f'메시지 삭제 오류: {e}')
        emit('delete_result', {'status': 'error', 'message': '삭제 중 오류가 발생했습니다.'})


if __name__ == '__main__':
    init_db()
    print("서버 시작...")
    print("교사용 페이지: http://localhost:5000/teacher")
    print("학생용 페이지: http://localhost:5000/student")
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
