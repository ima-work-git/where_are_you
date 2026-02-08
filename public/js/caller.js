/**
 * 通報者 (Caller) コントローラー
 * GPS位置情報の取得・送信、チャットの管理
 */
document.addEventListener('DOMContentLoaded', () => {
  const sessionSetup = document.getElementById('session-setup');
  const mainContent = document.getElementById('main-content');
  const connectionStatus = document.getElementById('connection-status');
  const gpsStatusBar = document.getElementById('gps-status-bar');
  const gpsStatusText = document.getElementById('gps-status-text');
  const btnRefreshGps = document.getElementById('btn-refresh-gps');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');

  let gpsWatchId = null;

  // URLからセッションIDを取得
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session');

  if (!sessionId) {
    // セッションIDがない場合は案内を表示
    return;
  }

  // セッションが存在するか確認して参加
  joinSession(sessionId);

  // チャット送信
  btnSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // GPS再取得
  btnRefreshGps.addEventListener('click', () => {
    stopGpsWatch();
    startGpsWatch();
  });

  function joinSession(sid) {
    sessionSetup.classList.add('hidden');
    mainContent.classList.remove('hidden');

    // 地図を初期化
    setTimeout(() => {
      MapModule.init('map');
      MapModule.invalidateSize();
    }, 100);

    // WebSocket接続
    ChatModule.connect(sid, 'caller', {
      onLocationUpdate: handleLocationUpdate,
      onConnectionChange: handleConnectionChange,
    });

    // GPS監視を開始
    startGpsWatch();
  }

  function startGpsWatch() {
    if (!navigator.geolocation) {
      updateGpsStatus('error', 'お使いのブラウザはGPSに対応していません');
      return;
    }

    updateGpsStatus('pending', 'GPS取得中...');

    // 高精度のGPS取得
    gpsWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;

        updateGpsStatus('active', `GPS取得済み (精度: ±${Math.round(accuracy)}m)`);

        // サーバーに位置情報を送信
        ChatModule.sendLocation(latitude, longitude, accuracy);

        // 自分の地図にも表示
        MapModule.updateCallerLocation(latitude, longitude, accuracy);
      },
      (error) => {
        let message = 'GPS取得に失敗しました';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            message = '位置情報の許可が必要です。ブラウザの設定を確認してください。';
            break;
          case error.POSITION_UNAVAILABLE:
            message = '位置情報を取得できません。GPS信号を確認してください。';
            break;
          case error.TIMEOUT:
            message = 'GPS取得がタイムアウトしました。再試行してください。';
            break;
        }
        updateGpsStatus('error', message);
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 5000,
      }
    );
  }

  function stopGpsWatch() {
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }

  function updateGpsStatus(status, text) {
    gpsStatusText.textContent = text;
    gpsStatusBar.className = 'gps-status-bar';

    const dot = gpsStatusBar.querySelector('.dot');

    switch (status) {
      case 'active':
        gpsStatusBar.classList.add('active');
        dot.className = 'dot green';
        break;
      case 'error':
        gpsStatusBar.classList.add('error');
        dot.className = 'dot red';
        break;
      case 'pending':
        dot.className = 'dot yellow';
        break;
    }
  }

  function handleLocationUpdate(loc) {
    MapModule.updateCallerLocation(loc.lat, loc.lng, loc.accuracy);
  }

  function handleConnectionChange(connected) {
    connectionStatus.textContent = connected ? '接続中' : '未接続';
    connectionStatus.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
  }

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    ChatModule.sendChat(text);
    chatInput.value = '';
    chatInput.focus();
  }
});
