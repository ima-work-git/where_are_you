/**
 * P2P通信モジュール (PeerJS/WebRTC)
 * サーバー不要 - GitHub Pages等の静的ホスティングで動作
 */
const Connection = (() => {
  let peer = null;
  let conn = null;
  let role = null;
  let callbacks = {};
  let isConnected = false;

  /**
   * 指令台として初期化
   * @returns {Promise<string>} 生成されたPeer ID (= セッションID)
   */
  function initAsOperator(cb) {
    role = 'operator';
    callbacks = cb;

    return new Promise((resolve, reject) => {
      // 短いIDを生成（通話で伝えやすいように）
      const id = 'fd-' + Math.random().toString(36).slice(2, 8);

      peer = new Peer(id, {
        debug: 0,
      });

      peer.on('open', (peerId) => {
        resolve(peerId);
      });

      peer.on('connection', (dataConn) => {
        conn = dataConn;
        setupDataConnection();
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (err.type === 'unavailable-id') {
          // IDが被った場合はリトライ
          peer.destroy();
          initAsOperator(cb).then(resolve).catch(reject);
        } else {
          if (callbacks.onError) callbacks.onError(err);
        }
      });
    });
  }

  /**
   * 通報者として接続
   * @param {string} operatorPeerId 指令台のPeer ID
   */
  function initAsCaller(operatorPeerId, cb) {
    role = 'caller';
    callbacks = cb;

    return new Promise((resolve, reject) => {
      peer = new Peer(null, {
        debug: 0,
      });

      peer.on('open', () => {
        conn = peer.connect(operatorPeerId, { reliable: true });
        setupDataConnection();
        resolve();
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (callbacks.onError) callbacks.onError(err);
        reject(err);
      });
    });
  }

  function setupDataConnection() {
    conn.on('open', () => {
      isConnected = true;
      if (callbacks.onConnectionChange) callbacks.onConnectionChange(true);

      // 接続通知をチャットに表示
      if (callbacks.onSystemMessage) {
        const who = role === 'operator' ? '通報者' : '指令台';
        callbacks.onSystemMessage(`${who}が接続しました`);
      }
    });

    conn.on('data', (data) => {
      handleIncoming(data);
    });

    conn.on('close', () => {
      isConnected = false;
      if (callbacks.onConnectionChange) callbacks.onConnectionChange(false);
      if (callbacks.onSystemMessage) {
        const who = role === 'operator' ? '通報者' : '指令台';
        callbacks.onSystemMessage(`${who}が切断されました`);
      }
    });

    conn.on('error', (err) => {
      console.error('DataConnection error:', err);
    });
  }

  function handleIncoming(data) {
    switch (data.type) {
      case 'chat':
        if (callbacks.onChat) callbacks.onChat(data);
        break;
      case 'location':
        if (callbacks.onLocation) callbacks.onLocation(data);
        break;
    }
  }

  /**
   * チャットメッセージ送信
   */
  function sendChat(text) {
    if (!conn || !isConnected) return;
    const msg = {
      type: 'chat',
      role,
      sender: role === 'operator' ? '指令台' : '通報者',
      text: text.trim(),
      timestamp: Date.now(),
    };
    conn.send(msg);
    // 自分のUIにも表示
    if (callbacks.onChat) callbacks.onChat(msg);
  }

  /**
   * 位置情報送信
   */
  function sendLocation(lat, lng, accuracy) {
    if (!conn || !isConnected) return;
    const loc = {
      type: 'location',
      lat,
      lng,
      accuracy,
      timestamp: Date.now(),
    };
    conn.send(loc);
  }

  function destroy() {
    if (conn) conn.close();
    if (peer) peer.destroy();
    conn = null;
    peer = null;
    isConnected = false;
  }

  function getIsConnected() {
    return isConnected;
  }

  return {
    initAsOperator,
    initAsCaller,
    sendChat,
    sendLocation,
    destroy,
    getIsConnected,
  };
})();
