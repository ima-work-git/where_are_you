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
  const chatMessages = document.getElementById('chat-messages');
  const btnClearPoi = document.getElementById('btn-clear-poi');
  const rankingPanel = document.getElementById('ranking-panel');
  const rankingList = document.getElementById('ranking-list');

  let callerLocation = null;

  // === 試験モード ===
  const btnTestMode = document.getElementById('btn-test-mode');
  const testPanel = document.getElementById('test-mode-panel');
  const btnTestClose = document.getElementById('btn-test-close');
  const btnTestApply = document.getElementById('btn-test-apply');
  const testLatInput = document.getElementById('test-lat');
  const testLngInput = document.getElementById('test-lng');
  const testAccuracySlider = document.getElementById('test-accuracy');
  const testAccuracyVal = document.getElementById('test-accuracy-val');
  let testModeActive = false;
  let testClickHandler = null;

  btnTestMode.addEventListener('click', toggleTestMode);
  btnTestClose.addEventListener('click', () => toggleTestMode(false));

  // 試験モードで直接開始
  document.getElementById('btn-start-test').addEventListener('click', () => {
    sessionSetup.classList.add('hidden');
    mainContent.classList.remove('hidden');
    setTimeout(() => {
      MapModule.init('map');
      MapModule.invalidateSize();
      toggleTestMode();
      appendSystemMessage('[試験モード] P2P接続なしで動作中。地図をクリックして位置を設定してください。');
    }, 100);
  });

  testAccuracySlider.addEventListener('input', () => {
    testAccuracyVal.textContent = testAccuracySlider.value;
  });

  btnTestApply.addEventListener('click', applyTestLocation);

  function toggleTestMode(forceOff) {
    testModeActive = forceOff === false ? false : !testModeActive;
    testPanel.classList.toggle('hidden', !testModeActive);
    btnTestMode.classList.toggle('active', testModeActive);

    const m = MapModule.getMap();
    if (!m) return;

    if (testModeActive) {
      m.getContainer().style.cursor = 'crosshair';
      testClickHandler = (e) => {
        testLatInput.value = e.latlng.lat.toFixed(6);
        testLngInput.value = e.latlng.lng.toFixed(6);
        applyTestLocation();
      };
      m.on('click', testClickHandler);
      appendSystemMessage('[試験モード] 地図をクリックして通報者位置を設定できます');
    } else {
      m.getContainer().style.cursor = '';
      if (testClickHandler) {
        m.off('click', testClickHandler);
        testClickHandler = null;
      }
    }
  }

  function applyTestLocation() {
    const lat = parseFloat(testLatInput.value);
    const lng = parseFloat(testLngInput.value);
    const accuracy = parseInt(testAccuracySlider.value, 10);

    if (isNaN(lat) || isNaN(lng)) {
      appendSystemMessage('[試験モード] 緯度・経度を入力するか、地図をクリックしてください');
      return;
    }

    const loc = { lat, lng, accuracy, timestamp: Date.now() };
    handleLocationUpdate(loc);
    appendSystemMessage(`[試験モード] 位置設定: ${lat.toFixed(6)}, ${lng.toFixed(6)} / 誤差±${accuracy}m`);
  }

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
    MapModule.clearAddressMarker();
    clearRankingPanel();
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

    if (Connection.getIsConnected()) {
      // P2P接続あり → 相手にも送信（sendChat内でonChatコールバックも呼ばれる）
      Connection.sendChat(text);
    } else {
      // 試験モード or 未接続 → ローカルのみ表示＆POI解析
      const msg = {
        type: 'chat',
        role: 'operator',
        sender: '指令台',
        text,
        timestamp: Date.now(),
      };
      appendChatMessage(msg);
    }

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

    // 前回の検索結果をクリアしてから新しい結果を表示
    MapModule.clearPOIResults();
    clearRankingPanel();

    // --- 住所検出処理 ---
    if (result.addressQuery) {
      MapModule.clearAddressMarker();
      if (result.addressResult && result.addressResult.length > 0) {
        const candidates = result.addressResult;
        MapModule.showAddressCandidates(candidates);
        const top = candidates[0];

        if (candidates.length === 1) {
          appendSystemMessage(`[住所検出] "${top.address}" → 地図上に表示しました`);
        } else {
          appendSystemMessage(`[住所検出] "${top.address}" → ${candidates.length}件の候補を表示`);
        }

        // boundingbox があればその範囲にフィット、なければポイントにズーム
        if (top.boundingbox && top.boundingbox.length === 4) {
          const [south, north, west, east] = top.boundingbox;
          MapModule.getMap().fitBounds([[south, west], [north, east]], { padding: [40, 40], maxZoom: 18 });
        } else {
          MapModule.getMap().setView([top.lat, top.lng], 17);
        }

        // ランキングパネルに住所候補を表示
        updateAddressRanking(candidates);
      } else {
        appendSystemMessage(`[住所検出] "${result.addressQuery}" → 位置を特定できませんでした`);
      }
    }

    // --- POI検索結果処理（キーワードがある場合のみ）---
    if (result.keywords.length === 0) return;

    const r = Math.round(result.radius);
    appendSystemMessage(
      `[検索] "${result.keywords.join(', ')}" / 半径${r}m (精度${Math.round(callerLocation.accuracy)}m×5)`
    );

    MapModule.showSearchRadius(callerLocation.lat, callerLocation.lng, result.radius);

    if (result.results.length === 0) {
      appendSystemMessage('[検索] 該当する施設が見つかりませんでした');
      return;
    }

    // マーカー表示
    MapModule.showPOIResults(result.results);

    // 交差ハイライト（複数キーワード時）
    if (result.isMultiKeyword && result.intersections) {
      for (const cluster of result.intersections) {
        const avgLat = cluster.all.reduce((s, p) => s + p.lat, 0) / cluster.all.length;
        const avgLng = cluster.all.reduce((s, p) => s + p.lng, 0) / cluster.all.length;
        MapModule.showIntersectionCluster(avgLat, avgLng, result.radius);
      }
    }

    // スコアランキング表示（チャット＋地図パネル）
    const filtered = result.totalCount > result.results.length
      ? ` (全${result.totalCount}件中 上位${result.results.length}件)`
      : '';
    appendSystemMessage(`[ランキング]${filtered}`);
    for (let i = 0; i < result.results.length; i++) {
      const p = result.results[i];
      appendSystemMessage(
        `  #${i + 1}  ${p.totalScore}点 [距離${p.distanceScore}×40%+テキスト${p.textScore}×60%]  ${p.name}  (${p.distance}m)`
      );
    }

    updateRankingPanel(result.results);
  }

  function appendSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-msg system';
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // ========== 候補地点ランキングパネル ==========
  const RANK_COLORS = ['#e67e22', '#95a5a6', '#cd7f32', '#2980b9', '#2c3e50'];

  function updateRankingPanel(results) {
    // 住所候補のヘッダー・項目を保持して POI 部分だけ再構築
    const addressItems = rankingList.querySelectorAll('.ranking-address-header, .ranking-address-item');
    const hasAddress = addressItems.length > 0;

    // POI項目だけ除去（住所項目は残す）
    const toRemove = [];
    for (const child of rankingList.children) {
      if (!child.classList.contains('ranking-address-header') &&
          !child.classList.contains('ranking-address-item')) {
        toRemove.push(child);
      }
    }
    toRemove.forEach(el => el.remove());

    if (!results || results.length === 0) {
      if (!hasAddress) rankingPanel.classList.add('hidden');
      return;
    }

    // POIセクションヘッダー（住所候補もある場合）
    if (hasAddress) {
      const poiHeader = document.createElement('li');
      poiHeader.className = 'ranking-item';
      poiHeader.innerHTML = '<span style="font-size:11px;color:#2980b9;font-weight:700;width:100%">施設候補</span>';
      poiHeader.style.cursor = 'default';
      poiHeader.style.borderBottom = '2px solid #2980b9';
      poiHeader.style.padding = '4px 12px';
      rankingList.appendChild(poiHeader);
    }

    for (let i = 0; i < results.length; i++) {
      const p = results[i];
      const rank = i + 1;
      const color = RANK_COLORS[i] || RANK_COLORS[RANK_COLORS.length - 1];
      const li = document.createElement('li');
      li.className = 'ranking-item';
      li.innerHTML =
        `<span class="ranking-badge" style="background:${color}">${rank}</span>` +
        `<span class="ranking-name">${escapeHtml(p.name)}</span>` +
        `<span class="ranking-score">${p.totalScore}点</span>` +
        `<span class="ranking-dist">${p.distance}m</span>`;
      li.addEventListener('click', () => {
        MapModule.getMap().setView([p.lat, p.lng], 17);
      });
      rankingList.appendChild(li);
    }

    rankingPanel.classList.remove('hidden');
  }

  function clearRankingPanel() {
    rankingList.innerHTML = '';
    rankingPanel.classList.add('hidden');
  }

  /**
   * 住所候補をランキングパネルに表示（POI候補がない場合のみ独立表示）
   */
  function updateAddressRanking(candidates) {
    if (!candidates || candidates.length === 0) return;

    // 住所候補だけの場合はパネルをクリアして住所専用表示
    // POI候補と併用の場合は先頭に住所セクションを挿入
    const hasPoiItems = rankingList.children.length > 0;

    if (!hasPoiItems) {
      rankingList.innerHTML = '';
    }

    // 住所候補の区切りヘッダー
    const header = document.createElement('li');
    header.className = 'ranking-item ranking-address-header';
    header.innerHTML = '<span style="font-size:11px;color:#e91e63;font-weight:700;width:100%">住所候補</span>';
    header.style.cursor = 'default';
    header.style.borderBottom = '2px solid #e91e63';
    header.style.padding = '4px 12px';

    if (hasPoiItems) {
      rankingList.insertBefore(header, rankingList.firstChild);
    } else {
      rankingList.appendChild(header);
    }

    // 候補を逆順で挿入（先頭に入れるため）or 順に追加
    for (let i = candidates.length - 1; i >= 0; i--) {
      const c = candidates[i];
      const rank = i + 1;
      const li = document.createElement('li');
      li.className = 'ranking-item ranking-address-item';
      const shortName = c.displayName.split(',').slice(0, 3).join(', ');
      li.innerHTML =
        `<span class="ranking-badge" style="background:#e91e63">${rank}</span>` +
        `<span class="ranking-name">${escapeHtml(shortName)}</span>`;
      li.addEventListener('click', () => {
        if (c.boundingbox && c.boundingbox.length === 4) {
          const [south, north, west, east] = c.boundingbox;
          MapModule.getMap().fitBounds([[south, west], [north, east]], { padding: [40, 40], maxZoom: 18 });
        } else {
          MapModule.getMap().setView([c.lat, c.lng], 17);
        }
      });

      if (hasPoiItems) {
        // ヘッダーの直後に挿入
        rankingList.insertBefore(li, header.nextSibling);
      } else {
        rankingList.appendChild(li);
      }
    }

    rankingPanel.classList.remove('hidden');
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
});
