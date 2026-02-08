/**
 * P2P通信モジュール (PeerJS/WebRTC)
 * サーバー不要 - GitHub Pages等の静的ホスティングで動作
 *
 * 切断対策:
 *  - DataConnection open タイムアウト (10秒)
 *  - Heartbeat (15秒間隔) で接続死活監視
 *  - Peer.disconnected イベントで signaling server 再接続
 *  - DataConnection.close 時に通報者側自動再接続 (最大10回)
 *  - visibilitychange でバックグラウンド復帰時に再接続
 *  - 複数 STUN サーバーで NAT 越え改善
 */
const Connection = (() => {
  let peer = null;
  let conn = null;
  let role = null;
  let callbacks = {};
  let isConnected = false;

  // ICE サーバー設定 (NAT越え改善)
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.services.mozilla.com' },
  ];

  // Heartbeat
  const HEARTBEAT_INTERVAL = 15000;
  const HEARTBEAT_TIMEOUT = 45000;
  let heartbeatTimer = null;
  let lastPongTime = 0;
  let heartbeatCheckTimer = null;

  // 接続タイムアウト
  const CONNECT_TIMEOUT = 10000; // 10秒
  let connectTimeoutTimer = null;

  // 再接続
  let operatorPeerId = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 10;
  let reconnecting = false;

  /**
   * 指令台として初期化
   */
  function initAsOperator(cb) {
    role = 'operator';
    callbacks = cb;

    return new Promise((resolve, reject) => {
      const id = 'fd-' + Math.random().toString(36).slice(2, 8);

      peer = new Peer(id, {
        debug: 1,
        config: { iceServers: ICE_SERVERS },
      });

      peer.on('open', (peerId) => {
        console.log('Operator peer open:', peerId);
        resolve(peerId);
      });

      peer.on('connection', (dataConn) => {
        console.log('Incoming connection from caller');
        if (conn) {
          stopHeartbeat();
          try { conn.close(); } catch (e) {}
        }
        conn = dataConn;
        setupDataConnection();
      });

      peer.on('disconnected', () => {
        console.warn('Operator: signaling server disconnected');
        if (callbacks.onSystemMessage) {
          callbacks.onSystemMessage('シグナリングサーバーと再接続中...');
        }
        reconnectPeer();
      });

      peer.on('error', (err) => {
        console.error('Operator PeerJS error:', err.type, err);
        if (err.type === 'unavailable-id') {
          peer.destroy();
          initAsOperator(cb).then(resolve).catch(reject);
        } else {
          if (callbacks.onError) callbacks.onError(err);
        }
      });

      // バックグラウンド復帰
      setupVisibilityHandler();
    });
  }

  /**
   * 通報者として接続
   */
  function initAsCaller(targetPeerId, cb) {
    role = 'caller';
    callbacks = cb;
    operatorPeerId = targetPeerId;
    reconnectAttempts = 0;

    return createCallerPeer();
  }

  /**
   * 通報者: Peer オブジェクトを作成して指令台に接続
   */
  function createCallerPeer() {
    return new Promise((resolve, reject) => {
      // 既存のpeerがあればクリーンアップ
      if (peer) {
        try { peer.destroy(); } catch (e) {}
        peer = null;
      }

      peer = new Peer(null, {
        debug: 1,
        config: { iceServers: ICE_SERVERS },
      });

      let resolved = false;

      peer.on('open', () => {
        console.log('Caller peer open, connecting to:', operatorPeerId);
        connectToOperator();
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });

      peer.on('disconnected', () => {
        console.warn('Caller: signaling server disconnected');
        reconnectPeer();
      });

      peer.on('error', (err) => {
        console.error('Caller PeerJS error:', err.type, err);

        if (err.type === 'peer-unavailable') {
          // 指令台が見つからない
          if (reconnecting || reconnectAttempts > 0) {
            // 再接続中 → リトライ
            scheduleReconnect();
          } else {
            if (callbacks.onError) callbacks.onError(err);
          }
        } else if (err.type === 'network' || err.type === 'server-error' ||
                   err.type === 'socket-error' || err.type === 'socket-closed') {
          // ネットワーク系エラー → 再接続
          triggerReconnect('peer-error: ' + err.type);
        } else {
          if (callbacks.onError) callbacks.onError(err);
        }

        if (!resolved) {
          resolved = true;
          // 初回接続時のエラーでもresolveして画面遷移は許可、
          // 接続自体は再接続で回復を試みる
          if (err.type === 'peer-unavailable') {
            reject(err);
          } else {
            resolve(); // 画面は表示してバックグラウンドで再接続
            triggerReconnect('initial-error: ' + err.type);
          }
        }
      });

      // Peer自体のopenタイムアウト
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error('Peer open timeout');
          resolve(); // 画面は表示
          triggerReconnect('peer-open-timeout');
        }
      }, CONNECT_TIMEOUT);

      setupVisibilityHandler();
    });
  }

  /**
   * 通報者側: 指令台への DataConnection を確立
   */
  function connectToOperator() {
    clearConnectTimeout();

    if (!peer || peer.destroyed || peer.disconnected) {
      console.warn('Peer not ready, scheduling reconnect');
      triggerReconnect('peer-not-ready');
      return;
    }

    try {
      conn = peer.connect(operatorPeerId, { reliable: true });
    } catch (e) {
      console.error('peer.connect() failed:', e);
      triggerReconnect('connect-exception');
      return;
    }

    // DataConnection open タイムアウト
    connectTimeoutTimer = setTimeout(() => {
      if (!isConnected) {
        console.warn('DataConnection open timeout');
        try { if (conn) conn.close(); } catch (e) {}
        triggerReconnect('data-connection-timeout');
      }
    }, CONNECT_TIMEOUT);

    setupDataConnection();
  }

  function clearConnectTimeout() {
    if (connectTimeoutTimer) {
      clearTimeout(connectTimeoutTimer);
      connectTimeoutTimer = null;
    }
  }

  function setupDataConnection() {
    conn.on('open', () => {
      console.log('DataConnection opened');
      clearConnectTimeout();
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
      console.log('DataConnection closed');
      handleDisconnect('close');
    });

    conn.on('error', (err) => {
      console.error('DataConnection error:', err);
      handleDisconnect('dc-error');
    });
  }

  /**
   * 再接続をトリガー（isConnectedがfalseでも動作する版）
   */
  function triggerReconnect(reason) {
    if (role !== 'caller') return;
    if (reconnecting && reconnectAttempts > 0) return; // 既にスケジュール済み

    console.log('triggerReconnect:', reason);
    isConnected = false;
    stopHeartbeat();
    clearConnectTimeout();
    reconnecting = true;

    if (callbacks.onConnectionChange) callbacks.onConnectionChange(false);

    if (reconnectAttempts < MAX_RECONNECT) {
      if (callbacks.onSystemMessage) {
        callbacks.onSystemMessage(`接続エラー (${reason})。再接続中... (${reconnectAttempts + 1}/${MAX_RECONNECT})`);
      }
      scheduleReconnect();
    } else {
      if (callbacks.onSystemMessage) {
        callbacks.onSystemMessage('再接続に失敗しました。ページを再読み込みしてください。');
      }
    }
  }

  /**
   * 切断処理 & 通報者側自動再接続
   */
  function handleDisconnect(reason) {
    const wasConnected = isConnected;
    isConnected = false;
    stopHeartbeat();
    clearConnectTimeout();

    if (wasConnected) {
      if (callbacks.onConnectionChange) callbacks.onConnectionChange(false);
    }

    if (role === 'caller' && peer && !peer.destroyed && reconnectAttempts < MAX_RECONNECT) {
      reconnecting = true;
      if (callbacks.onSystemMessage) {
        callbacks.onSystemMessage(`接続が切断されました。再接続中... (${reconnectAttempts + 1}/${MAX_RECONNECT})`);
      }
      scheduleReconnect();
    } else if (role === 'operator') {
      if (callbacks.onSystemMessage) {
        callbacks.onSystemMessage('通報者が切断されました');
      }
    } else if (reconnectAttempts >= MAX_RECONNECT) {
      if (callbacks.onSystemMessage) {
        callbacks.onSystemMessage('再接続に失敗しました。ページを再読み込みしてください。');
      }
    }
  }

  /**
   * Peer の signaling server 再接続
   */
  function reconnectPeer() {
    if (!peer || peer.destroyed) return;
    try {
      peer.reconnect();
    } catch (e) {
      console.error('peer.reconnect() failed:', e);
    }
  }

  /**
   * 再接続スケジュール（指数バックオフ、最大15秒）
   */
  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 15000);
    reconnectAttempts++;

    console.log(`Reconnect scheduled in ${Math.round(delay)}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);

    setTimeout(() => {
      if (isConnected) return;

      if (!peer || peer.destroyed) {
        // Peer自体が壊れた → 新しく作り直す
        console.log('Peer destroyed, creating new peer...');
        createCallerPeer().catch(e => {
          console.error('createCallerPeer failed:', e);
          if (reconnectAttempts < MAX_RECONNECT) {
            scheduleReconnect();
          }
        });
        return;
      }

      if (peer.disconnected) {
        // signaling server に再接続
        console.log('Peer disconnected, reconnecting to signaling...');
        reconnectPeer();
        setTimeout(() => {
          if (!isConnected && peer && !peer.destroyed && !peer.disconnected) {
            connectToOperator();
          } else if (!isConnected && reconnectAttempts < MAX_RECONNECT) {
            scheduleReconnect();
          }
        }, 2000);
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
          handleDisconnect('heartbeat-send-fail');
        }
      }
    }, HEARTBEAT_INTERVAL);

    heartbeatCheckTimer = setInterval(() => {
      if (isConnected && Date.now() - lastPongTime > HEARTBEAT_TIMEOUT) {
        console.warn('Heartbeat timeout');
        try { if (conn) conn.close(); } catch (e) {}
        handleDisconnect('heartbeat-timeout');
      }
    }, HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (heartbeatCheckTimer) { clearInterval(heartbeatCheckTimer); heartbeatCheckTimer = null; }
  }

  // ========== バックグラウンド復帰 ==========
  let visibilityHandlerSet = false;

  function setupVisibilityHandler() {
    if (visibilityHandlerSet) return;
    visibilityHandlerSet = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('Page became visible, checking connection...');

        // signaling server 再接続
        if (peer && !peer.destroyed && peer.disconnected) {
          console.log('Reconnecting to signaling server...');
          reconnectPeer();
        }

        // DataConnection が切れていたら再接続
        if (!isConnected && role === 'caller' && !reconnecting) {
          console.log('Connection lost while in background, reconnecting...');
          reconnectAttempts = 0; // バックグラウンド復帰はカウントリセット
          triggerReconnect('visibility-resume');
        }
      }
    });
  }

  // ========== メッセージ処理 ==========
  function handleIncoming(data) {
    if (data.type === '_ping') {
      if (conn && isConnected) {
        try { conn.send({ type: '_pong', ts: Date.now() }); } catch (e) {}
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

  function sendLocation(lat, lng, accuracy) {
    if (!conn || !isConnected) return;
    conn.send({
      type: 'location',
      lat, lng, accuracy,
      timestamp: Date.now(),
    });
  }

  function destroy() {
    stopHeartbeat();
    clearConnectTimeout();
    try { if (conn) conn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
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
