/**
 * 指令台 (Operator) コントローラー
 * POI自動検索機能付き
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
  const btnClearPoi = document.getElementById('btn-clear-poi');

  let callerLocation = null;

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

  // POIマーカークリア
  btnClearPoi.addEventListener('click', () => {
    MapModule.clearPOIResults();
    appendSystemMessage('POIマーカーをクリアしました');
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
    callerLocation = loc;
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

    // チャットメッセージを自動解析してPOI検索
    analyzeChatForPOI(msg.text);
  }

  async function analyzeChatForPOI(text) {
    if (!callerLocation) return;

    const result = await POISearch.analyzeMessage(text, callerLocation);
    if (!result) return;

    const r = Math.round(result.radius);
    appendSystemMessage(
      `[自動検索] "${result.keywords.join(', ')}" を半径${r}m (精度${Math.round(callerLocation.accuracy)}m×5) で検索中...`
    );

    MapModule.showSearchRadius(callerLocation.lat, callerLocation.lng, result.radius);

    if (result.results.length === 0) {
      appendSystemMessage('[自動検索] 該当する施設が見つかりませんでした');
      return;
    }

    // 複数キーワード + 交差あり → 交差地点をハイライト、それ以外はdimmed
    if (result.isMultiKeyword && result.intersections) {
      // 交差に含まれるPOIのIDセット
      const intersectIds = new Set();
      for (const cluster of result.intersections) {
        for (const poi of cluster.all) {
          intersectIds.add(poi.id);
        }
      }

      // 交差外のPOIをグレーで表示
      const dimmedPois = result.results.filter(p => !intersectIds.has(p.id));
      if (dimmedPois.length > 0) {
        MapModule.showPOIResults(dimmedPois, { dimmed: true });
      }

      // 交差内のPOIをカラーで表示
      const highlightPois = result.results.filter(p => intersectIds.has(p.id));
      const count = MapModule.showPOIResults(highlightPois);

      // 交差クラスターの中心にハイライト円
      for (const cluster of result.intersections) {
        const avgLat = cluster.all.reduce((s, p) => s + p.lat, 0) / cluster.all.length;
        const avgLng = cluster.all.reduce((s, p) => s + p.lng, 0) / cluster.all.length;
        MapModule.showIntersectionCluster(avgLat, avgLng, result.radius);
      }

      appendSystemMessage(
        `[絞り込み] ${result.keywords.join(' & ')} が近接する地点: ${result.intersections.length}箇所 (${count}件ハイライト)`
      );
    } else if (result.isMultiKeyword && !result.intersections) {
      // 複数キーワードだが交差なし → 全部表示
      const count = MapModule.showPOIResults(result.results);
      appendSystemMessage(
        `[自動検索] ${count}件表示 (${result.keywords.join(' & ')} が近接する地点は見つかりませんでした)`
      );
    } else {
      // 単一キーワード → 全部表示
      const count = MapModule.showPOIResults(result.results);
      appendSystemMessage(`[自動検索] ${count}件の候補をマーカー表示しました`);
    }
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
