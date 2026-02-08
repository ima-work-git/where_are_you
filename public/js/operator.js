/**
 * 指令台 (Operator) コントローラー
 * セッション管理、地図表示、チャットの統合
 */
document.addEventListener('DOMContentLoaded', () => {
  const sessionSetup = document.getElementById('session-setup');
  const mainContent = document.getElementById('main-content');
  const btnCreateSession = document.getElementById('btn-create-session');
  const btnJoinSession = document.getElementById('btn-join-session');
  const btnNewSession = document.getElementById('btn-new-session');
  const inputSessionId = document.getElementById('input-session-id');
  const displaySessionId = document.getElementById('display-session-id');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const connectionStatus = document.getElementById('connection-status');
  const callerStatusEl = document.getElementById('caller-status');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const locationInfo = document.getElementById('location-info');

  let currentSessionId = null;

  // セッション作成
  btnCreateSession.addEventListener('click', createSession);
  btnNewSession.addEventListener('click', createSession);

  // セッション参加
  btnJoinSession.addEventListener('click', () => {
    const sid = inputSessionId.value.trim();
    if (sid) joinSession(sid);
  });

  inputSessionId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const sid = inputSessionId.value.trim();
      if (sid) joinSession(sid);
    }
  });

  // チャット送信
  btnSend.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 通報者リンクコピー
  btnCopyLink.addEventListener('click', () => {
    const callerUrl = `${location.origin}/caller.html?session=${currentSessionId}`;
    navigator.clipboard.writeText(callerUrl).then(() => {
      const original = btnCopyLink.textContent;
      btnCopyLink.textContent = 'コピーしました!';
      setTimeout(() => {
        btnCopyLink.textContent = original;
      }, 2000);
    });
  });

  async function createSession() {
    try {
      const res = await fetch('/api/session/create');
      const data = await res.json();
      joinSession(data.sessionId);
    } catch (e) {
      alert('セッション作成に失敗しました');
    }
  }

  function joinSession(sid) {
    currentSessionId = sid;
    displaySessionId.textContent = sid;

    // UIを切り替え
    sessionSetup.classList.add('hidden');
    mainContent.classList.remove('hidden');

    // 地図を初期化
    setTimeout(() => {
      MapModule.init('map');
      MapModule.invalidateSize();
    }, 100);

    // WebSocket接続
    ChatModule.connect(sid, 'operator', {
      onLocationUpdate: handleLocationUpdate,
      onConnectionChange: handleConnectionChange,
      onCallerStatusChange: handleCallerStatus,
    });
  }

  function handleLocationUpdate(loc) {
    MapModule.updateCallerLocation(loc.lat, loc.lng, loc.accuracy);

    // 位置情報パネルを更新
    locationInfo.classList.remove('hidden');
    document.getElementById('info-lat').textContent = loc.lat.toFixed(6);
    document.getElementById('info-lng').textContent = loc.lng.toFixed(6);
    document.getElementById('info-accuracy').textContent = `±${Math.round(loc.accuracy)}m`;
    document.getElementById('info-time').textContent =
      new Date(loc.timestamp).toLocaleTimeString('ja-JP');
  }

  function handleConnectionChange(connected) {
    connectionStatus.textContent = connected ? '接続中' : '未接続';
    connectionStatus.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
  }

  function handleCallerStatus(connected) {
    callerStatusEl.innerHTML = connected
      ? '<span class="dot green"></span> 通報者接続中'
      : '<span class="dot red"></span> 通報者未接続';
  }

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    ChatModule.sendChat(text);
    chatInput.value = '';
    chatInput.focus();
  }
});
