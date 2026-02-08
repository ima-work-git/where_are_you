const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// セッション管理
const sessions = new Map();

// 新しいセッションを作成
app.get('/api/session/create', (req, res) => {
  const sessionId = uuidv4().slice(0, 8);
  sessions.set(sessionId, {
    id: sessionId,
    createdAt: Date.now(),
    operator: null,
    caller: null,
    messages: [],
    callerLocation: null,
  });
  res.json({ sessionId });
});

// セッション情報取得
app.get('/api/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'セッションが見つかりません' });
  }
  res.json({
    id: session.id,
    createdAt: session.createdAt,
    messages: session.messages,
    callerLocation: session.callerLocation,
  });
});

// WebSocket接続処理
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session');
  const role = url.searchParams.get('role'); // 'operator' or 'caller'

  if (!sessionId || !sessions.has(sessionId)) {
    ws.close(4000, 'Invalid session');
    return;
  }

  const session = sessions.get(sessionId);
  session[role] = ws;

  ws.sessionId = sessionId;
  ws.role = role;

  // 接続通知
  broadcastToSession(sessionId, {
    type: 'system',
    message: role === 'operator' ? '指令台が接続しました' : '通報者が接続しました',
    timestamp: Date.now(),
  });

  // 既存メッセージと位置情報を送信
  ws.send(JSON.stringify({
    type: 'init',
    messages: session.messages,
    callerLocation: session.callerLocation,
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(sessionId, role, msg);
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    if (session[role] === ws) {
      session[role] = null;
    }
    broadcastToSession(sessionId, {
      type: 'system',
      message: role === 'operator' ? '指令台が切断しました' : '通報者が切断しました',
      timestamp: Date.now(),
    });
  });
});

function handleMessage(sessionId, role, msg) {
  const session = sessions.get(sessionId);
  if (!session) return;

  switch (msg.type) {
    case 'chat': {
      const chatMsg = {
        type: 'chat',
        role,
        sender: role === 'operator' ? '指令台' : '通報者',
        text: msg.text,
        timestamp: Date.now(),
      };
      session.messages.push(chatMsg);
      broadcastToSession(sessionId, chatMsg);
      break;
    }

    case 'location': {
      session.callerLocation = {
        lat: msg.lat,
        lng: msg.lng,
        accuracy: msg.accuracy,
        timestamp: Date.now(),
      };
      broadcastToSession(sessionId, {
        type: 'location',
        lat: msg.lat,
        lng: msg.lng,
        accuracy: msg.accuracy,
        timestamp: Date.now(),
      });
      break;
    }
  }
}

function broadcastToSession(sessionId, data) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const payload = JSON.stringify(data);
  for (const role of ['operator', 'caller']) {
    const ws = session[role];
    if (ws && ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

// 古いセッションを定期的にクリーンアップ（1時間以上前のセッション）
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 3600000) {
      sessions.delete(id);
    }
  }
}, 600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動: http://localhost:${PORT}`);
  console.log(`指令台: http://localhost:${PORT}/`);
});
