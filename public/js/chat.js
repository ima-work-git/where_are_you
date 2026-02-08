/**
 * チャットモジュール
 * WebSocket経由のリアルタイムチャットを管理
 * 自然言語（文字起こし）の入力を想定
 */
const ChatModule = (() => {
  let ws = null;
  let role = null;
  let onLocationUpdate = null;
  let onConnectionChange = null;
  let onCallerStatusChange = null;
  let reconnectTimer = null;
  let sessionId = null;

  function connect(sid, r, callbacks) {
    sessionId = sid;
    role = r;
    onLocationUpdate = callbacks.onLocationUpdate || null;
    onConnectionChange = callbacks.onConnectionChange || null;
    onCallerStatusChange = callbacks.onCallerStatusChange || null;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}?session=${sid}&role=${r}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (onConnectionChange) onConnectionChange(true);
      clearTimeout(reconnectTimer);
    };

    ws.onclose = () => {
      if (onConnectionChange) onConnectionChange(false);
      // 自動再接続
      reconnectTimer = setTimeout(() => {
        connect(sessionId, role, callbacks);
      }, 3000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error('メッセージ解析エラー:', e);
      }
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        // 既存メッセージを表示
        if (msg.messages) {
          msg.messages.forEach(m => appendMessage(m));
        }
        // 既存の位置情報を反映
        if (msg.callerLocation && onLocationUpdate) {
          onLocationUpdate(msg.callerLocation);
        }
        break;

      case 'chat':
        appendMessage(msg);
        break;

      case 'location':
        if (onLocationUpdate) {
          onLocationUpdate(msg);
        }
        break;

      case 'system':
        appendSystemMessage(msg.message);
        // 通報者の接続状態を更新
        if (onCallerStatusChange) {
          if (msg.message.includes('通報者が接続')) {
            onCallerStatusChange(true);
          } else if (msg.message.includes('通報者が切断')) {
            onCallerStatusChange(false);
          }
        }
        break;
    }
  }

  function sendChat(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!text.trim()) return;

    ws.send(JSON.stringify({
      type: 'chat',
      text: text.trim(),
    }));
  }

  function sendLocation(lat, lng, accuracy) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: 'location',
      lat,
      lng,
      accuracy,
    }));
  }

  function appendMessage(msg) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.role}`;

    const time = new Date(msg.timestamp).toLocaleTimeString('ja-JP');

    div.innerHTML = `
      <div class="msg-header">${escapeHtml(msg.sender)}</div>
      <div class="msg-body">${escapeHtml(msg.text)}</div>
      <div class="msg-time">${time}</div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function appendSystemMessage(text) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  return { connect, sendChat, sendLocation, disconnect };
})();
