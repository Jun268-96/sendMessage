// 서비스 워커 버전
const CACHE_NAME = 'student-message-v1';
const urlsToCache = [
  '/student',
  '/static/css/',
  '/static/js/student.js',
  '/static/manifest.json',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.0.1/socket.io.js'
];

// 설치 이벤트
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('캐시 열기');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.log('캐시 설치 오류:', error);
      })
  );
});

// 활성화 이벤트
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('오래된 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 패치 이벤트 (네트워크 요청 처리)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 캐시에서 찾으면 반환
        if (response) {
          return response;
        }
        
        // 네트워크에서 가져오기
        return fetch(event.request)
          .then(response => {
            // 유효하지 않은 응답이면 그대로 반환
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // 응답을 복제하여 캐시에 저장
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return response;
          })
          .catch(() => {
            // 네트워크 실패 시 오프라인 페이지 또는 기본 응답
            if (event.request.destination === 'document') {
              return caches.match('/student');
            }
          });
      })
  );
});

// 푸시 알림 처리
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.message,
      icon: '/static/images/icon-192x192.png',
      badge: '/static/images/icon-192x192.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: 1
      },
      actions: [
        {
          action: 'explore',
          title: '확인',
          icon: '/static/images/checkmark.png'
        },
        {
          action: 'close',
          title: '닫기',
          icon: '/static/images/xmark.png'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || '새 메시지', options)
    );
  }
});

// 알림 클릭 처리
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'explore') {
    // 앱 열기
    event.waitUntil(
      clients.openWindow('/student')
    );
  }
});

// 백그라운드 동기화 (온라인 복귀 시)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // 백그라운드에서 할 작업 (예: 메시지 동기화)
      console.log('백그라운드 동기화 수행')
    );
  }
});

// 메시지 처리 (메인 스레드와 통신)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
}); 