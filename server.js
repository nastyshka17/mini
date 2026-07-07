const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_FILE = path.join(__dirname, 'data.json');

let data = {
  users: [],
  chats: [],
  messages: []
};

const MAX_USERS = 5; // ограничение на количество пользователей

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('📂 Данные загружены');
    } else {
      console.log('📄 Новый файл data.json');
      saveData();
    }
  } catch (e) {
    console.error('Ошибка загрузки:', e);
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getNextId(arr) {
  return arr.length ? Math.max(...arr.map(i => i.id)) + 1 : 1;
}

function findUserByLogin(login) {
  return data.users.find(u => u.login === login);
}
function findUserById(id) {
  return data.users.find(u => u.id === id);
}
function findChatById(id) {
  return data.chats.find(c => c.id === id);
}
function getPersonalChat(id1, id2) {
  return data.chats.find(c =>
    c.type === 'personal' &&
    c.participants.includes(id1) &&
    c.participants.includes(id2)
  );
}
function getOrCreatePersonalChat(id1, id2) {
  let chat = getPersonalChat(id1, id2);
  if (chat) return chat.id;
  const newChat = {
    id: getNextId(data.chats),
    type: 'personal',
    participants: [id1, id2]
  };
  data.chats.push(newChat);
  saveData();
  return newChat.id;
}

function deleteUserAccount(userId) {
  data.users = data.users.filter(u => u.id !== userId);
  const chatIds = data.chats.filter(c => c.participants.includes(userId)).map(c => c.id);
  data.chats = data.chats.filter(c => !c.participants.includes(userId));
  data.messages = data.messages.filter(m => !chatIds.includes(m.chat_id));
  saveData();
}

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  let ct = 'text/html';
  if (ext === '.css') ct = 'text/css';
  else if (ext === '.js') ct = 'application/javascript';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': ct });
    res.end(content);
  });
});

const wss = new WebSocket.Server({ server });
const clients = new Map();

function sendChatList(ws) {
  const info = clients.get(ws);
  if (!info) return;
  const userId = info.userId;
  const userChats = data.chats.filter(c => c.participants.includes(userId));
  const list = userChats.map(c => {
    let name = 'Чат';
    let avatar = null;
    if (c.type === 'personal') {
      const otherId = c.participants.find(id => id !== userId);
      const u = findUserById(otherId);
      if (u) {
        name = u.display_name || u.login;
        avatar = u.avatar || null;
      }
    }
    return { id: c.id, name, avatar };
  });
  ws.send(JSON.stringify({ type: 'chatList', chats: list }));
}

function sendUserList(ws) {
  const info = clients.get(ws);
  if (!info) return;
  const list = data.users
    .filter(u => u.id !== info.userId)
    .map(u => ({
      id: u.id,
      login: u.login,
      display_name: u.display_name,
      status: u.status || 'offline',
      avatar: u.avatar || null
    }));
  ws.send(JSON.stringify({ type: 'userList', users: list }));
}

function broadcastStatus(userId, status) {
  const payload = JSON.stringify({ type: 'userStatus', userId, status });
  for (const [client] of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function handleMessage(ws, raw) {
  try {
    const msg = JSON.parse(raw);
    console.log('📩 Получено:', msg.type);
    const info = clients.get(ws);
    const userId = info ? info.userId : null;

    switch (msg.type) {
      case 'auth': {
        const { login, password, action } = msg;
        if (action === 'register') {
          // Проверка лимита пользователей
          if (data.users.length >= MAX_USERS) {
            ws.send(JSON.stringify({ type: 'authResult', success: false, message: `Достигнут лимит пользователей (макс. ${MAX_USERS})` }));
            return;
          }
          if (findUserByLogin(login)) {
            ws.send(JSON.stringify({ type: 'authResult', success: false, message: 'Логин занят' }));
            return;
          }
          bcrypt.hash(password, 10, (err, hash) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'authResult', success: false, message: 'Ошибка хеширования' }));
              return;
            }
            const user = {
              id: getNextId(data.users),
              login,
              password_hash: hash,
              display_name: login,
              status: 'online',
              avatar: null
            };
            data.users.push(user);
            saveData();
            clients.set(ws, { userId: user.id, userName: user.display_name });
            ws.send(JSON.stringify({ type: 'authResult', success: true, userId: user.id, displayName: user.display_name, avatar: user.avatar }));
            sendChatList(ws);
            sendUserList(ws);
            broadcastStatus(user.id, 'online');
          });
        } else if (action === 'login') {
          const user = findUserByLogin(login);
          if (!user) {
            ws.send(JSON.stringify({ type: 'authResult', success: false, message: 'Неверный логин или пароль' }));
            return;
          }
          bcrypt.compare(password, user.password_hash, (err, ok) => {
            if (err || !ok) {
              ws.send(JSON.stringify({ type: 'authResult', success: false, message: 'Неверный логин или пароль' }));
              return;
            }
            clients.set(ws, { userId: user.id, userName: user.display_name });
            user.status = 'online';
            saveData();
            ws.send(JSON.stringify({ type: 'authResult', success: true, userId: user.id, displayName: user.display_name, avatar: user.avatar }));
            sendChatList(ws);
            sendUserList(ws);
            broadcastStatus(user.id, 'online');
          });
        }
        break;
      }

      case 'restore': {
        const { userId } = msg;
        if (!userId) {
          ws.send(JSON.stringify({ type: 'authResult', success: false, message: 'Не указан ID' }));
          return;
        }
        const user = findUserById(userId);
        if (!user) {
          ws.send(JSON.stringify({ type: 'authResult', success: false, message: 'Пользователь не найден' }));
          return;
        }
        for (const [existingWs, info] of clients) {
          if (info.userId === userId && existingWs !== ws) {
            existingWs.close();
            clients.delete(existingWs);
          }
        }
        clients.set(ws, { userId: user.id, userName: user.display_name });
        user.status = 'online';
        saveData();
        ws.send(JSON.stringify({ type: 'authResult', success: true, userId: user.id, displayName: user.display_name, avatar: user.avatar }));
        sendChatList(ws);
        sendUserList(ws);
        broadcastStatus(user.id, 'online');
        break;
      }

      case 'sendMessage': {
        const { chatId, text } = msg;
        if (!chatId || !userId || !text) return;
        const chat = findChatById(chatId);
        if (!chat || !chat.participants.includes(userId)) return;
        const newMsg = {
          id: getNextId(data.messages),
          chat_id: chatId,
          sender_id: userId,
          text,
          timestamp: Date.now()
        };
        data.messages.push(newMsg);
        saveData();
        const sender = findUserById(userId);
        const payload = JSON.stringify({
          type: 'newMessage',
          chatId,
          message: {
            id: newMsg.id,
            sender_id: userId,
            text: newMsg.text,
            timestamp: newMsg.timestamp,
            senderName: sender.display_name || sender.login,
            senderAvatar: sender.avatar || null
          }
        });
        for (const [client, info2] of clients) {
          if (chat.participants.includes(info2.userId) && client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        }
        break;
      }

      case 'deleteMessage': {
        const { messageId, chatId } = msg;
        if (!messageId || !chatId || !userId) return;
        const chat = findChatById(chatId);
        if (!chat || !chat.participants.includes(userId)) return;
        const msgIndex = data.messages.findIndex(m => m.id === messageId && m.chat_id === chatId);
        if (msgIndex === -1) return;
        const msg = data.messages[msgIndex];
        if (msg.sender_id !== userId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Нельзя удалить чужое сообщение' }));
          return;
        }
        data.messages.splice(msgIndex, 1);
        saveData();
        const payload = JSON.stringify({ type: 'messageDeleted', chatId, messageId });
        for (const [client, info2] of clients) {
          if (chat.participants.includes(info2.userId) && client.readyState === WebSocket.OPEN) {
            client.send(payload);
          }
        }
        break;
      }

      case 'getChats':
        sendChatList(ws);
        break;

      case 'getMessages': {
        const { chatId } = msg;
        const chat = findChatById(chatId);
        if (!chat || !chat.participants.includes(userId)) return;
        const msgs = data.messages
          .filter(m => m.chat_id === chatId)
          .map(m => {
            const s = findUserById(m.sender_id);
            return {
              ...m,
              senderName: s ? s.display_name || s.login : 'Неизвестный',
              senderAvatar: s ? s.avatar || null : null
            };
          })
          .sort((a, b) => a.timestamp - b.timestamp);
        ws.send(JSON.stringify({ type: 'messagesHistory', chatId, messages: msgs }));
        break;
      }

      case 'updateProfile': {
        const { displayName, avatar } = msg;
        const user = findUserById(userId);
        if (!user) return;
        if (displayName) user.display_name = displayName;
        if (avatar !== undefined) user.avatar = avatar;
        saveData();
        if (displayName) {
          const info = clients.get(ws);
          if (info) info.userName = displayName;
        }
        ws.send(JSON.stringify({ type: 'profileUpdated', success: true, avatar: user.avatar }));
        sendChatList(ws);
        sendUserList(ws);
        break;
      }

      case 'deleteAccount': {
        if (!userId) return;
        deleteUserAccount(userId);
        ws.send(JSON.stringify({ type: 'accountDeleted', success: true }));
        ws.close();
        break;
      }

      case 'createChatByLogin': {
        const { login } = msg;
        if (!login) return;
        const other = findUserByLogin(login);
        if (!other) {
          ws.send(JSON.stringify({ type: 'error', message: 'Пользователь не найден' }));
          return;
        }
        if (other.id === userId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Нельзя создать чат с собой' }));
          return;
        }
        const chatId = getOrCreatePersonalChat(userId, other.id);
        ws.send(JSON.stringify({ type: 'chatCreated', chatId }));
        sendChatList(ws);
        break;
      }

      case 'getUsers':
        sendUserList(ws);
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Неизвестный запрос' }));
        console.warn('Неизвестный тип:', msg.type);
    }
  } catch (e) {
    console.error('Ошибка в handleMessage:', e);
    ws.send(JSON.stringify({ type: 'error', message: 'Внутренняя ошибка' }));
  }
}

wss.on('connection', (ws) => {
  console.log('🔗 Подключение');
  ws.on('message', (msg) => handleMessage(ws, msg));
  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      const user = findUserById(info.userId);
      if (user) {
        user.status = 'offline';
        saveData();
        broadcastStatus(info.userId, 'offline');
      }
      console.log(`❌ ${info.userName} отключился`);
    }
    clients.delete(ws);
  });
});

loadData();
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер Mini на http://localhost:${PORT}`);
  console.log(`💾 Данные в ${DATA_FILE}`);
  console.log(`👥 Максимум пользователей: ${MAX_USERS}`);
});