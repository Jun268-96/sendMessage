from gevent import monkey
monkey.patch_all()

from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, disconnect
from werkzeug.security import generate_password_hash, check_password_hash
import os
import random
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import psycopg

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-fallback-key-change-in-production')

# gevent 모드 사용 (Render 배포용)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="gevent")

# In-memory connection tracking
teachers = {}
students = {}
teacher_settings = {}  # teacher_code -> allow_student_messages


def get_db():
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        raise RuntimeError('DATABASE_URL is not set. Please configure DATABASE_URL for Postgres.')
    # sslmode can be configured via DB_SSLMODE if needed (e.g., require on Render)
    sslmode = os.environ.get('DB_SSLMODE', 'prefer')
    return psycopg.connect(db_url, sslmode=sslmode)


def now_kst_str():
    """Return current time string in Asia/Seoul."""
    return datetime.now(timezone.utc).astimezone(ZoneInfo("Asia/Seoul")).strftime('%Y-%m-%d %H:%M:%S')


def student_key(teacher_code, student_name):
    return f"{teacher_code}::{student_name or ''}"


def get_teacher_allow_status(teacher_code):
    if teacher_code in teacher_settings:
        return teacher_settings[teacher_code]
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT allow_student_messages FROM teacher_settings WHERE teacher_code = %s', (teacher_code,))
    row = c.fetchone()
    if row is None:
        allow = False
        c.execute(
            '''INSERT INTO teacher_settings (teacher_code, allow_student_messages)
               VALUES (%s, %s)
               ON CONFLICT (teacher_code) DO NOTHING''',
            (teacher_code, allow)
        )
        conn.commit()
    else:
        allow = bool(row[0])
    conn.close()
    teacher_settings[teacher_code] = allow
    return allow


def set_teacher_allow_status(teacher_code, allow):
    teacher_settings[teacher_code] = bool(allow)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        '''INSERT INTO teacher_settings (teacher_code, allow_student_messages, updated_at)
           VALUES (%s, %s, CURRENT_TIMESTAMP)
           ON CONFLICT (teacher_code)
           DO UPDATE SET allow_student_messages = EXCLUDED.allow_student_messages,
                         updated_at = CURRENT_TIMESTAMP''',
        (teacher_code, bool(allow))
    )
    conn.commit()
    conn.close()


def generate_teacher_code():
    """Create a unique 6-digit teacher code."""
    while True:
        code = str(random.randint(100000, 999999))
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT teacher_code FROM teachers WHERE teacher_code = %s', (code,))
        exists = c.fetchone()
        conn.close()
        if not exists:
            return code


def init_db():
    conn = get_db()
    c = conn.cursor()

    # ⚠️ 기존 테이블 삭제 후 재생성 (비밀번호 컬럼 추가를 위해)
    # ⚠️ 주의: 배포 후 정상 작동 확인되면 아래 5줄을 다시 주석 처리해야 합니다!
    c.execute('DROP TABLE IF EXISTS teachers CASCADE')
    c.execute('DROP TABLE IF EXISTS students CASCADE')
    c.execute('DROP TABLE IF EXISTS messages CASCADE')
    c.execute('DROP TABLE IF EXISTS hidden_messages CASCADE')
    c.execute('DROP TABLE IF EXISTS teacher_settings CASCADE')

    c.execute(
        '''CREATE TABLE IF NOT EXISTS teachers
           (teacher_code TEXT PRIMARY KEY,
            teacher_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS classes
           (id SERIAL PRIMARY KEY,
            teacher_code TEXT NOT NULL,
            class_number TEXT NOT NULL,
            class_name TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(teacher_code, class_number))'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS students
           (id SERIAL PRIMARY KEY,
            teacher_code TEXT NOT NULL,
            class_number TEXT NOT NULL,
            student_name TEXT NOT NULL,
            student_id TEXT DEFAULT '',
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            socket_id TEXT DEFAULT '')'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS messages
           (id SERIAL PRIMARY KEY,
            teacher_code TEXT NOT NULL,
            class_number TEXT,
            sender_type TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            recipient_type TEXT,
            recipient_id TEXT,
            message TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_read BOOLEAN DEFAULT FALSE)'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS hidden_messages
           (id SERIAL PRIMARY KEY,
            message_id INTEGER NOT NULL,
            teacher_code TEXT NOT NULL,
            student_key TEXT NOT NULL,
            hidden_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, student_key))'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS teacher_settings
           (teacher_code TEXT PRIMARY KEY,
            allow_student_messages BOOLEAN DEFAULT FALSE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'''
    )

    c.execute(
        '''CREATE TABLE IF NOT EXISTS users
           (id TEXT PRIMARY KEY,
            user_type TEXT NOT NULL,
            name TEXT NOT NULL,
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
    password = request.form.get('password', '')
    password_confirm = request.form.get('password_confirm', '')

    if not teacher_name:
        return render_template('teacher_register.html', error='교사 이름을 입력해주세요.')
    
    if not password or len(password) < 4:
        return render_template('teacher_register.html', error='비밀번호는 4자 이상이어야 합니다.')
    
    if password != password_confirm:
        return render_template('teacher_register.html', error='비밀번호가 일치하지 않습니다.')

    teacher_code = generate_teacher_code()
    password_hash = generate_password_hash(password)
    
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            'INSERT INTO teachers (teacher_code, teacher_name, password_hash) VALUES (%s, %s, %s)',
            (teacher_code, teacher_name, password_hash)
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
    password = request.form.get('password', '')
    
    if not teacher_code:
        return render_template('teacher_login.html', error='교사 코드를 입력해주세요.')
    
    if not password:
        return render_template('teacher_login.html', error='비밀번호를 입력해주세요.')

    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT teacher_name, password_hash FROM teachers WHERE teacher_code = %s', (teacher_code,))
        teacher = c.fetchone()

        if teacher and check_password_hash(teacher[1], password):
            c.execute(
                'UPDATE teachers SET last_login = CURRENT_TIMESTAMP WHERE teacher_code = %s',
                (teacher_code,)
            )
            conn.commit()
            conn.close()

            session['teacher_code'] = teacher_code
            session['teacher_name'] = teacher[0]

            return render_template('teacher.html', teacher_code=teacher_code, teacher_name=teacher[0])
        else:
            conn.close()
            return render_template('teacher_login.html', error='교사 코드 또는 비밀번호가 올바르지 않습니다.')
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

    allow_messages = get_teacher_allow_status(teacher_code)

    teacher_room = f'teacher_{teacher_code}'
    join_room(teacher_room)

    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''SELECT class_number, student_name, student_id, socket_id, last_seen
               FROM students
               WHERE teacher_code = %s
               ORDER BY student_name''',
            (teacher_code,)
        )

        db_students = c.fetchall()

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
    finally:
        if conn:
            conn.close()

    emit('receive_status', {'allow': allow_messages})


@socketio.on('student_join')
def on_student_join(data):
    teacher_code = data.get('teacher_code')
    student_name = data.get('student_name')

    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT teacher_name FROM teachers WHERE teacher_code = %s', (teacher_code,))
        teacher = c.fetchone()

        if not teacher:
            emit('student_join_error', {'error': '유효하지 않은 교사 코드입니다.'})
            return

        teacher_name_db = teacher[0]
        class_number = ''
        student_id = ''

        c.execute(
            '''DELETE FROM students
               WHERE teacher_code = %s AND student_name = %s''',
            (teacher_code, student_name)
        )

        c.execute(
            '''INSERT INTO students
               (teacher_code, class_number, student_name, student_id, socket_id, last_seen)
               VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)''',
            (teacher_code, class_number, student_name, student_id, request.sid)
        )
        conn.commit()

        student_info = {
            'teacher_code': teacher_code,
            'class_number': class_number,
            'student_name': student_name,
            'student_id': student_id,
            'socket_id': request.sid,
            'teacher_name': teacher_name_db
        }

        students[request.sid] = student_info

        teacher_room = f'teacher_{teacher_code}'
        student_room = f'students_{teacher_code}'
        join_room(student_room)

        allow_messages = get_teacher_allow_status(teacher_code)

        emit('student_join_success', {
            'status': 'success',
            'student_info': student_info,
            'teacher_name': teacher_name_db,
            'allow_messages': allow_messages
        })

        socketio.emit('student_connected', student_info, room=teacher_room)
        print(f"학생 연결: {student_name} -> 교사 {teacher_name_db} ({teacher_code})")
    except Exception as e:
        print(f'학생 연결 오류: {e}')
        emit('student_join_error', {'error': '연결 중 오류가 발생했습니다.'})
    finally:
        if conn:
            conn.close()


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

    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''SELECT id, sender_type, sender_id, message, timestamp
               FROM messages
               WHERE teacher_code = %s
                 AND (recipient_id = 'all' OR recipient_id LIKE %s)
                 AND id NOT IN (
                    SELECT message_id FROM hidden_messages
                    WHERE teacher_code = %s AND student_key = %s
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

        emit('message_history', {'messages': messages})
    except Exception as e:
        print(f'메시지 조회 오류: {e}')
        emit('message_history', {'messages': []})
    finally:
        if conn:
            conn.close()


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
                        'timestamp': now_kst_str()
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
                            'timestamp': now_kst_str()
                        },
                        room=student_socket_id
                    )

        emit('message_sent', {'status': 'success', 'message_id': msg_id})
    elif sender_type == 'student' and teacher_code:
        if not get_teacher_allow_status(teacher_code):
            emit('student_message_error', {'message': '교사가 현재 메시지 수신을 허용하지 않습니다.'})
            return
        student_name = data.get('student_name') or '학생'
        try:
            conn = get_db()
            c = conn.cursor()
            c.execute(
                '''INSERT INTO messages (teacher_code, sender_type, sender_id, recipient_type, recipient_id, message)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   RETURNING id''',
                (teacher_code, 'student', student_name, 'teacher', teacher_code, message)
            )
            msg_id = c.fetchone()[0]

            c.execute(
                '''DELETE FROM messages
                   WHERE id IN (
                     SELECT id FROM messages
                     WHERE teacher_code = %s AND recipient_type = 'teacher'
                     ORDER BY id DESC
                     OFFSET 1000
                   )''',
                (teacher_code,)
            )
            conn.commit()
            conn.close()

            teacher_room = f'teacher_{teacher_code}'
            socketio.emit('new_message_from_student', {
                'id': msg_id,
                'student_name': student_name,
                'message': message,
                'timestamp': now_kst_str()
            }, room=teacher_room)

            emit('student_message_sent', {'status': 'success', 'message_id': msg_id})
        except Exception as e:
            print(f'학생 메시지 전송 오류: {e}')
            emit('student_message_error', {'message': '메시지 전송 중 오류가 발생했습니다.'})


def save_message_multi_teacher(teacher_code, sender_type, recipient_type, recipient_names, message):
    recipient_str = 'all' if recipient_names == ['all'] else ','.join(recipient_names)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        '''INSERT INTO messages (teacher_code, sender_type, sender_id, recipient_type, recipient_id, message)
           VALUES (%s, %s, %s, %s, %s, %s)
           RETURNING id''',
        (teacher_code, sender_type, teacher_code, recipient_type, recipient_str, message)
    )
    msg_id = c.fetchone()[0]
    conn.commit()
    conn.close()
    return msg_id


def save_message(sender_type, sender_id, recipient_type, recipient_ids, message):
    recipient_str = ','.join(recipient_ids) if isinstance(recipient_ids, list) else str(recipient_ids)
    conn = get_db()
    c = conn.cursor()
    c.execute(
        '''INSERT INTO messages (teacher_code, sender_type, sender_id, recipient_type, recipient_id, message)
           VALUES (%s, %s, %s, %s, %s, %s)''',
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

    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''INSERT INTO hidden_messages (message_id, teacher_code, student_key)
               VALUES (%s, %s, %s)
               ON CONFLICT (message_id, student_key) DO NOTHING''',
            (message_id, teacher_code, student_key(teacher_code, student_name))
        )
        conn.commit()
        emit('delete_result', {'status': 'success', 'message_id': message_id})
    except Exception as e:
        print(f'메시지 삭제 오류: {e}')
        emit('delete_result', {'status': 'error', 'message': '삭제 중 오류가 발생했습니다.'})
    finally:
        if conn:
            conn.close()


@socketio.on('delete_message_teacher')
def delete_message_teacher(data):
    teacher_info = teachers.get(request.sid)
    if not teacher_info:
        emit('delete_result_teacher', {'status': 'error', 'message': '교사 인증에 실패했습니다.'})
        return

    message_id = data.get('message_id')
    teacher_code = teacher_info.get('teacher_code')

    if not message_id:
        emit('delete_result_teacher', {'status': 'error', 'message': '메시지 ID가 없습니다.'})
        return

    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('SELECT teacher_code FROM messages WHERE id = %s', (message_id,))
        row = c.fetchone()
        if not row or row[0] != teacher_code:
            emit('delete_result_teacher', {'status': 'error', 'message': '삭제 권한이 없거나 메시지가 없습니다.'})
            return

        c.execute('DELETE FROM messages WHERE id = %s', (message_id,))
        c.execute('DELETE FROM hidden_messages WHERE message_id = %s', (message_id,))
        conn.commit()

        student_room = f'students_{teacher_code}'
        socketio.emit('message_deleted', {'message_id': message_id}, room=student_room)

        emit('delete_result_teacher', {'status': 'success', 'message_id': message_id})
    except Exception as e:
        print(f'교사용 메시지 삭제 오류: {e}')
        emit('delete_result_teacher', {'status': 'error', 'message': '삭제 중 오류가 발생했습니다.'})
    finally:
        if conn:
            conn.close()


@socketio.on('teacher_toggle_receive')
def teacher_toggle_receive(data):
    teacher_info = teachers.get(request.sid)
    teacher_code = None
    if teacher_info:
        teacher_code = teacher_info.get('teacher_code')
    else:
        # fallback: 클라이언트가 코드 전달했다면 활용
        teacher_code = data.get('teacher_code')
    if not teacher_code:
        emit('receive_status', {'allow': False})
        return

    allow = bool(data.get('allow'))
    set_teacher_allow_status(teacher_code, allow)
    emit('receive_status', {'allow': allow})
    student_room = f'students_{teacher_code}'
    socketio.emit('receive_status', {'allow': allow}, room=student_room)


@socketio.on('get_teacher_messages')
def get_teacher_messages(data):
    teacher_info = teachers.get(request.sid)
    if not teacher_info:
        emit('teacher_messages', {'messages': []})
        return
    teacher_code = teacher_info.get('teacher_code')
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''SELECT id, sender_id, message, timestamp
               FROM messages
               WHERE teacher_code = %s AND recipient_type = 'teacher'
               ORDER BY id DESC
               LIMIT 100''',
            (teacher_code,)
        )
        rows = c.fetchall()
        msgs = []
        for row in rows:
            msgs.append({
                'id': row[0],
                'student_name': row[1],
                'message': row[2],
                'timestamp': row[3]
            })
        emit('teacher_messages', {'messages': msgs})
    except Exception as e:
        print(f'교사 메시지 조회 오류: {e}')
        emit('teacher_messages', {'messages': []})
    finally:
        if conn:
            conn.close()


@socketio.on('get_sent_messages')
def get_sent_messages(data):
    """교사가 보낸 메시지 히스토리 조회"""
    teacher_info = teachers.get(request.sid)
    if not teacher_info:
        emit('sent_messages', {'messages': []})
        return
    teacher_code = teacher_info.get('teacher_code')
    conn = None
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            '''SELECT id, recipient_id, message, timestamp
               FROM messages
               WHERE teacher_code = %s AND sender_type = 'teacher'
               ORDER BY id DESC
               LIMIT 100''',
            (teacher_code,)
        )
        rows = c.fetchall()
        msgs = []
        for row in rows:
            msgs.append({
                'id': row[0],
                'recipient': row[1],
                'message': row[2],
                'timestamp': row[3]
            })
        emit('sent_messages', {'messages': msgs})
    except Exception as e:
        print(f'전송 메시지 조회 오류: {e}')
        emit('sent_messages', {'messages': []})
    finally:
        if conn:
            conn.close()


# 앱 시작 시 DB 초기화 (프로덕션/로컬 모두 실행)
init_db()

if __name__ == '__main__':
    print("서버 시작...")
    print("교사용 페이지: http://localhost:5000/teacher")
    print("학생용 페이지: http://localhost:5000/student")
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    socketio.run(app, debug=debug, host='0.0.0.0', port=port)
