/**
 * P2P通信モジュール (PeerJS/WebRTC)
 * サーバー不要 - GitHub Pages等の静的ホスティングで動作
 *
 * 切断対策:
 *  - Heartbeat (15秒間隔) で接続死活監視
 *  - Peer.disconnected イベントで signaling server 再接続
 *  - DataConnection.close 時に通報者側自動再接続 (最大5回)
 */
const Connection = (() => {
  let peer = null;
  let conn = null;
  let role = null;
  let callbacks = {};
  let isConnected = false;

  // Heartbeat
  const HEARTBEAT_INTERVAL = 15000; // 15秒
  const HEARTBEAT_TIMEOUT = 45000;  // 3回分 応答なしでタイムアウト
  let heartbeatTimer = null;
  let lastPongTime = 0;
  let heartbeatCheckTimer = null;

  // 再接続
  let operatorPeerId = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;
  let reconnecting = false;

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
        // 既存接続があればクリーンアップ
        if (conn) {
          stopHeartbeat();
          conn.close();
        }
        conn = dataConn;
        setupDataConnection();
      });

      peer.on('disconnected', () => {
        // signaling server との接続が切れた → 再接続を試みる
        console.warn('PeerJS: signaling server disconnected, reconnecting...');
        if (peer && !peer.destroyed) {
          peer.reconnect();
        }
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (err.type === 'unavailable-id') {
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
   * @param {string} targetPeerId 指令台のPeer ID
   */
  function initAsCaller(targetPeerId, cb) {
    role = 'caller';
    callbacks = cb;
    operatorPeerId = targetPeerId;
    reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      peer = new Peer(null, {
        debug: 0,
      });

      peer.on('open', () => {
        connectToOperator();
        resolve();
      });

      peer.on('disconnected', () => {
        console.warn('PeerJS: signaling server disconnected, reconnecting...');
        if (peer && !peer.destroyed) {
          peer.reconnect();
        }
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (err.type === 'peer-unavailable') {
          // 指令台が見つからない - 再接続中なら自動リトライ
          if (reconnecting) {
            scheduleReconnect();
          } else {
            if (callbacks.onError) callbacks.onError(err);
          }
        } else {
          if (callbacks.onError) callbacks.onError(err);
        }
        if (!reconnecting) reject(err);
      });
    });
  }

  /**
   * 通報者側: 指令台への DataConnection を確立
   */
  function connectToOperator() {
    conn = peer.connect(operatorPeerId, { reliable: true });
    setupDataConnection();
  }

  function setupDataConnection() {
    conn.on('open', () => {
      isConnected = true;
      reconnectAttempts = 0;
      reconnecting = false;
      lastPongTime = Date.now();
      if (callbacks.onConnectionChange) callbacks.onConnectionChange(true);

      if (callbacks.onSystemMessage) {
        const who = role === 'operator' ? '通報者' : '指令台';
        callbacks.onSystemMessage(`${who}が接続しました`);
      }

      startHeartbeat();
    });

    conn.on('data', (data) => {
      handleIncoming(data);
    });

    conn.on('close', () => {
      handleDisconnect('close');
    });

    conn.on('error', (err) => {
      console.error('DataConnection error:', err);
      handleDisconnect('error');
    });
  }

  /**
   * 切断処理 & 通報者側自動再接続
   */
  function handleDisconnect(reason) {
    if (!isConnected && !reconnecting) return; // 重複呼び出し防止

    isConnected = false;
    stopHeartbeat();

    if (callbacks.onConnectionChange) callbacks.onConnectionChange(false);

    if (role === 'caller' && peer && !peer.destroyed && reconnectAttempts < MAX_RECONNECT) {
      // 通報者側: 自動再接続
      reconnecting = true;
      if (callbacks.onSystemMessage) {
        callbacks.onSystemMessage(`指令台との接続が切断されました。再接続を試みています... (${reconnectAttempts + 1}/${MAX_RECONNECT})`);
      }
      scheduleReconnect();
    } else {
      const who = role === 'operator' ? '通報者' : '指令台';
      if (callbacks.onSystemMessage) {
        callbacks.onSystemMessage(`${who}が切断されました`);
      }
    }
  }

  /**
   * 再接続のスケジュール（指数バックオフ）
   */
  function scheduleReconnect() {
    const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;

    setTimeout(() => {
      if (!peer || peer.destroyed) return;
      if (isConnected) return; // 既に再接続済み

      console.log(`Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT}...`);

      // Peer自体がdisconnectedなら再接続
      if (peer.disconnected) {
        peer.reconnect();
        // reconnect後に少し待ってからconnect
        setTimeout(() => {
          if (!isConnected) connectToOperator();
        }, 1000);
      } else {
        connectToOperator();
      }
    }, delay);
  }

  // ========== Heartbeat ==========
  function startHeartbeat() {
    stopHeartbeat();
    lastPongTime = Date.now();

    heartbeatTimer = setInterval(() => {
      if (conn && isConnected) {
        try {
          conn.send({ type: '_ping', ts: Date.now() });
        } catch (e) {
          // 送信失敗 → 切断扱い
          handleDisconnect('heartbeat-send-fail');
        }
      }
    }, HEARTBEAT_INTERVAL);

    heartbeatCheckTimer = setInterval(() => {
      if (isConnected && Date.now() - lastPongTime > HEARTBEAT_TIMEOUT) {
        console.warn('Heartbeat timeout - connection seems dead');
        if (conn) conn.close();
        handleDisconnect('heartbeat-timeout');
      }
    }, HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (heartbeatCheckTimer) { clearInterval(heartbeatCheckTimer); heartbeatCheckTimer = null; }
  }

  function handleIncoming(data) {
    // Heartbeat 処理
    if (data.type === '_ping') {
      if (conn && isConnected) {
        conn.send({ type: '_pong', ts: Date.now() });
      }
      return;
    }
    if (data.type === '_pong') {
      lastPongTime = Date.now();
      return;
    }

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
    stopHeartbeat();
    if (conn) conn.close();
    if (peer) peer.destroy();
    conn = null;
    peer = null;
    isConnected = false;
    reconnecting = false;
    reconnectAttempts = 0;
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
