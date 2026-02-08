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
  const chatMessages = document.getElementById('chat-messages');

  let gpsWatchId = null;

  // URLからセッションIDを取得
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session');

  if (!sessionId) return;

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

  async function joinSession(peerId) {
    sessionSetup.classList.add('hidden');
    mainContent.classList.remove('hidden');

    setTimeout(() => {
      MapModule.init('map');
      MapModule.invalidateSize();
    }, 100);

    try {
      await Connection.initAsCaller(peerId, {
        onConnectionChange: handleConnectionChange,
        onChat: appendChatMessage,
        onLocation: handleLocationUpdate,
        onSystemMessage: appendSystemMessage,
        onError: (err) => {
          if (err.type === 'peer-unavailable') {
            appendSystemMessage('指令台が見つかりません。リンクを確認してください。');
          } else {
            appendSystemMessage('接続エラー: ' + err.type);
          }
        },
      });

      startGpsWatch();
    } catch (e) {
      appendSystemMessage('接続に失敗しました。ページを再読み込みしてください。');
    }
  }

  function startGpsWatch() {
    if (!navigator.geolocation) {
      updateGpsStatus('error', 'お使いのブラウザはGPSに対応していません');
      return;
    }

    updateGpsStatus('pending', 'GPS取得中...');

    gpsWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        updateGpsStatus('active', `GPS取得済み (精度: ±${Math.round(accuracy)}m)`);

        // 指令台に位置情報を送信
        Connection.sendLocation(latitude, longitude, accuracy);

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
      default:
        dot.className = 'dot yellow';
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
    Connection.sendChat(text);
    chatInput.value = '';
    chatInput.focus();
  }

  function appendChatMessage(msg) {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.role}`;
    const time = new Date(msg.timestamp).toLocaleTimeString('ja-JP');
    div.innerHTML = `
      <div class="msg-header">${escapeHtml(msg.sender)}</div>
      <div class="msg-body">${escapeHtml(msg.text)}</div>
      <div class="msg-time">${time}</div>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
});
