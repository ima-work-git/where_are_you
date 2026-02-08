/**
 * 指令台 (Operator) コントローラー
 */
document.addEventListener('DOMContentLoaded', () => {
  const sessionSetup = document.getElementById('session-setup');
  const mainContent = document.getElementById('main-content');
  const btnCreateSession = document.getElementById('btn-create-session');
  const displaySessionId = document.getElementById('display-session-id');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const connectionStatus = document.getElementById('connection-status');
  const callerStatusEl = document.getElementById('caller-status');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const locationInfo = document.getElementById('location-info');
  const chatMessages = document.getElementById('chat-messages');

  // セッション作成
  btnCreateSession.addEventListener('click', createSession);
  document.getElementById('btn-new-session').addEventListener('click', () => {
    Connection.destroy();
    location.reload();
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
    const peerId = displaySessionId.textContent;
    const callerUrl = `${location.origin}${location.pathname.replace('index.html', '')}caller.html?session=${peerId}`;
    navigator.clipboard.writeText(callerUrl).then(() => {
      const orig = btnCopyLink.textContent;
      btnCopyLink.textContent = 'コピーしました!';
      setTimeout(() => { btnCopyLink.textContent = orig; }, 2000);
    });
  });

  async function createSession() {
    btnCreateSession.disabled = true;
    btnCreateSession.textContent = '接続準備中...';

    try {
      const peerId = await Connection.initAsOperator({
        onConnectionChange: handleConnectionChange,
        onChat: appendChatMessage,
        onLocation: handleLocationUpdate,
        onSystemMessage: appendSystemMessage,
        onError: (err) => {
          appendSystemMessage('接続エラー: ' + err.type);
        },
      });

      displaySessionId.textContent = peerId;

      // UIを切り替え
      sessionSetup.classList.add('hidden');
      mainContent.classList.remove('hidden');

      setTimeout(() => {
        MapModule.init('map');
        MapModule.invalidateSize();
      }, 100);

      appendSystemMessage('セッション作成完了。通報者の接続を待っています...');
    } catch (e) {
      btnCreateSession.disabled = false;
      btnCreateSession.textContent = '新規セッション作成';
      alert('セッション作成に失敗しました。ページを再読み込みしてください。');
    }
  }

  function handleLocationUpdate(loc) {
    MapModule.updateCallerLocation(loc.lat, loc.lng, loc.accuracy);

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
    callerStatusEl.innerHTML = connected
      ? '<span class="dot green"></span> 通報者接続中'
      : '<span class="dot red"></span> 通報者未接続';
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
