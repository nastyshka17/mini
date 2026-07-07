// ---------- ГЛОБАЛЬНЫЕ ----------
let socket = null;
let currentUser = null;
let currentChatId = null;
let chats = [];
let allUsers = [];
let isConnected = false;
let pendingMessages = [];
let isRestoring = false;
let notificationPermission = false;

// DOM
const authScreen = document.getElementById('authScreen');
const chatsScreen = document.getElementById('chatsScreen');
const chatScreen = document.getElementById('chatScreen');
const profileScreen = document.getElementById('profileScreen');
const usersModal = document.getElementById('usersModal');

const loginInput = document.getElementById('loginInput');
const passwordInput = document.getElementById('passwordInput');
const authActionBtn = document.getElementById('authActionBtn');
const authError = document.getElementById('authError');

const chatListEl = document.getElementById('chatList');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatTitle = document.getElementById('chatTitle');
const backBtn = document.getElementById('backBtn');
const logoutBtn = document.getElementById('logoutBtn');
const profileBtn = document.getElementById('profileBtn');
const usersBtn = document.getElementById('usersBtn');
const themeToggle = document.getElementById('themeToggle');

const profileLogin = document.getElementById('profileLogin');
const profileAvatar = document.getElementById('profileAvatar');
const avatarInput = document.getElementById('avatarInput');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const profileBackBtn = document.getElementById('profileBackBtn');
const profileError = document.getElementById('profileError');

const usersListEl = document.getElementById('usersList');
const closeUsersBtn = document.getElementById('closeUsersBtn');

// ---------- ТАБЫ ----------
let currentAuthTab = 'login';
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentAuthTab = tab.dataset.tab;
    authActionBtn.textContent = currentAuthTab === 'login' ? 'Войти' : 'Зарегистрироваться';
    authError.textContent = '';
  });
});
authActionBtn.textContent = 'Войти';

// ---------- ПОКАЗ ЭКРАНОВ ----------
function showScreen(id) {
  [authScreen, chatsScreen, chatScreen, profileScreen].forEach(el => {
    el.classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
}

// ---------- МОДАЛКА ПОЛЬЗОВАТЕЛЕЙ ----------
function openUsersModal() {
  usersModal.classList.remove('hidden');
  renderUsersList();
}
function closeUsersModal() {
  usersModal.classList.add('hidden');
}
usersBtn.addEventListener('click', openUsersModal);
closeUsersBtn.addEventListener('click', closeUsersModal);
usersModal.addEventListener('click', (e) => {
  if (e.target === usersModal) closeUsersModal();
});

function renderUsersList() {
  usersListEl.innerHTML = '';
  if (!allUsers.length) {
    usersListEl.innerHTML = '<div class="empty-state">Нет других пользователей</div>';
    return;
  }
  allUsers.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item';
    const statusClass = u.status === 'online' ? 'online' : 'offline';
    const avatarSrc = u.avatar || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23f8bbd0"/%3E%3Ctext x="50" y="58" font-size="40" text-anchor="middle" fill="%23ffffff"%3E🌸%3C/text%3E%3C/svg%3E';
    div.innerHTML = `
      <img class="user-avatar" src="${avatarSrc}" alt="avatar" />
      <span class="user-name">${u.display_name || u.login}</span>
      <span class="user-status ${statusClass}"></span>
    `;
    div.addEventListener('click', () => {
      sendToServer({ type: 'createChatByLogin', login: u.login });
      closeUsersModal();
    });
    usersListEl.appendChild(div);
  });
}

// ---------- ТЕМА ----------
function toggleTheme() {
  document.body.classList.toggle('dark-theme');
  const isDark = document.body.classList.contains('dark-theme');
  themeToggle.textContent = isDark ? '☀️' : '🌙';
  localStorage.setItem('mini-theme', isDark ? 'dark' : 'light');
}
function loadTheme() {
  const saved = localStorage.getItem('mini-theme');
  if (saved === 'dark') {
    document.body.classList.add('dark-theme');
    themeToggle.textContent = '☀️';
  } else {
    document.body.classList.remove('dark-theme');
    themeToggle.textContent = '🌙';
  }
}
themeToggle.addEventListener('click', toggleTheme);
loadTheme();

// ---------- УВЕДОМЛЕНИЯ ----------
function requestNotificationPermission() {
  if ('Notification' in window) {
    Notification.requestPermission().then(perm => {
      notificationPermission = perm === 'granted';
    });
  }
}
requestNotificationPermission();

function playNotificationSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) { /* тихо */ }
}

function showNotification(title, body) {
  if (notificationPermission && 'Notification' in window) {
    new Notification(title, { body, icon: '🌸' });
  }
}

// ---------- WEBSOCKET ----------
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}`);

  socket.onopen = () => {
    isConnected = true;
    console.log('✅ WS открыт');
    const savedUserId = localStorage.getItem('mini-userId');
    if (savedUserId && !currentUser && !isRestoring) {
      isRestoring = true;
      sendToServer({ type: 'restore', userId: parseInt(savedUserId) });
    }
    if (pendingMessages.length) {
      pendingMessages.forEach(m => socket.send(JSON.stringify(m)));
      pendingMessages = [];
    }
  };

  socket.onclose = () => {
    isConnected = false;
    console.log('❌ WS закрыт, переподключение...');
    setTimeout(connectWS, 3000);
  };

  socket.onerror = (err) => console.error('⚠️ WS ошибка:', err);

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      console.log('📨 Получено от сервера:', data.type);
      handleServerMsg(data);
    } catch (err) {
      console.error('Ошибка парсинга:', err);
    }
  };
}

// ---------- ОТПРАВКА ----------
function sendToServer(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  } else {
    console.warn('Сокет не открыт, в очередь');
    pendingMessages.push(data);
  }
}

// ---------- ОБРАБОТКА СЕРВЕРА ----------
function handleServerMsg(data) {
  switch (data.type) {
    case 'authResult':
      if (data.success) {
        currentUser = { id: data.userId, displayName: data.displayName, avatar: data.avatar || null };
        localStorage.setItem('mini-userId', data.userId);
        localStorage.setItem('mini-displayName', data.displayName);
        isRestoring = false;
        showScreen('chatsScreen');
        sendToServer({ type: 'getChats' });
        sendToServer({ type: 'getUsers' });
        updateProfileUI();
      } else {
        authError.textContent = data.message;
        localStorage.removeItem('mini-userId');
        localStorage.removeItem('mini-displayName');
        currentUser = null;
        isRestoring = false;
        showScreen('authScreen');
      }
      break;

    case 'chatList':
      chats = data.chats;
      renderChats();
      break;

    case 'userList':
      allUsers = data.users;
      if (!usersModal.classList.contains('hidden')) renderUsersList();
      break;

    case 'newMessage': {
      const isCurrentChat = currentChatId === data.chatId;
      const isFocused = document.hasFocus();
      if (!isCurrentChat || !isFocused) {
        playNotificationSound();
        const sender = data.message.senderName || 'Кто-то';
        const preview = data.message.text || 'Сообщение';
        showNotification(`💬 ${sender}`, preview);
      }
      if (isCurrentChat) {
        addMessageDOM(data.message);
      }
      break;
    }

    case 'messagesHistory':
      if (currentChatId === data.chatId) {
        renderMessages(data.messages);
      }
      break;

    case 'messageDeleted': {
      if (currentChatId === data.chatId) {
        const msgEl = messagesContainer.querySelector(`[data-message-id="${data.messageId}"]`);
        if (msgEl) {
          msgEl.classList.add('removing');
          setTimeout(() => msgEl.remove(), 300);
        }
      }
      break;
    }

    case 'chatCreated':
      sendToServer({ type: 'getChats' });
      break;

    case 'profileUpdated':
      if (data.avatar !== undefined && currentUser) {
        currentUser.avatar = data.avatar;
        updateProfileUI();
      }
      showScreen('chatsScreen');
      sendToServer({ type: 'getChats' });
      sendToServer({ type: 'getUsers' });
      break;

    case 'accountDeleted':
      alert('Аккаунт удалён');
      localStorage.removeItem('mini-userId');
      localStorage.removeItem('mini-displayName');
      if (socket) socket.close();
      currentUser = null;
      currentChatId = null;
      chats = [];
      showScreen('authScreen');
      setTimeout(connectWS, 100);
      break;

    case 'userStatus':
      const user = allUsers.find(u => u.id === data.userId);
      if (user) user.status = data.status;
      if (!usersModal.classList.contains('hidden')) renderUsersList();
      renderChats();
      break;

    case 'error':
      alert('❌ ' + data.message);
      break;

    default:
      console.log('Неизвестный тип от сервера:', data.type);
  }
}

// ---------- РЕНДЕР ЧАТОВ ----------
function renderChats() {
  chatListEl.innerHTML = '';
  if (!chats.length) {
    chatListEl.innerHTML = '<div class="empty-state">Нет чатов. Начните диалог!</div>';
    return;
  }
  chats.forEach(c => {
    const otherUser = allUsers.find(u => c.name === u.display_name || c.name === u.login);
    const statusClass = otherUser && otherUser.status === 'online' ? 'online' : 'offline';
    const avatarSrc = (otherUser && otherUser.avatar) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23f8bbd0"/%3E%3Ctext x="50" y="58" font-size="40" text-anchor="middle" fill="%23ffffff"%3E🌸%3C/text%3E%3C/svg%3E';
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.innerHTML = `
      <img class="chat-avatar" src="${avatarSrc}" alt="avatar" />
      <span class="chat-info">
        <span class="chat-name">${c.name}</span>
      </span>
      <span class="chat-status ${statusClass}"></span>
    `;
    div.addEventListener('click', () => openChat(c.id, c.name));
    chatListEl.appendChild(div);
  });
}

// ---------- ОТКРЫТЬ ЧАТ ----------
function openChat(id, name) {
  currentChatId = id;
  chatTitle.textContent = name || 'Чат';
  showScreen('chatScreen');
  sendToServer({ type: 'getMessages', chatId: id });
}

// ---------- СООБЩЕНИЯ ----------
function renderMessages(msgs) {
  messagesContainer.innerHTML = '';
  if (!msgs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Нет сообщений. Напишите первыми!';
    messagesContainer.appendChild(empty);
    return;
  }
  msgs.forEach(m => addMessageDOM(m));
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addMessageDOM(msg) {
  const isSelf = msg.sender_id === currentUser.id;
  const div = document.createElement('div');
  div.className = `message ${isSelf ? 'self' : 'other'}`;
  div.dataset.messageId = msg.id;

  const avatarSrc = msg.senderAvatar || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23f8bbd0"/%3E%3Ctext x="50" y="58" font-size="40" text-anchor="middle" fill="%23ffffff"%3E🌸%3C/text%3E%3C/svg%3E';
  const avatarImg = document.createElement('img');
  avatarImg.className = 'message-avatar';
  avatarImg.src = avatarSrc;
  avatarImg.alt = 'avatar';
  div.appendChild(avatarImg);

  const content = document.createElement('div');
  content.className = 'message-content';

  if (!isSelf) {
    const name = document.createElement('span');
    name.className = 'sender';
    name.textContent = msg.senderName || 'Неизвестный';
    content.appendChild(name);
  }

  if (msg.text) {
    const text = document.createElement('span');
    text.textContent = msg.text;
    content.appendChild(text);
  }

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  content.appendChild(time);

  div.appendChild(content);

  if (isSelf) {
    const deleteHint = document.createElement('span');
    deleteHint.className = 'delete-hint';
    deleteHint.textContent = '✕';
    deleteHint.title = 'Удалить сообщение';
    div.appendChild(deleteHint);
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Удалить это сообщение?')) {
        sendToServer({ type: 'deleteMessage', messageId: msg.id, chatId: currentChatId });
      }
    });
  }

  const empty = messagesContainer.querySelector('.empty-state');
  if (empty) empty.remove();
  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ---------- ОТПРАВКА СООБЩЕНИЯ ----------
function sendMessage(text) {
  if (!currentChatId || !text) return;
  sendToServer({ type: 'sendMessage', chatId: currentChatId, text });
}

sendBtn.addEventListener('click', () => {
  const text = messageInput.value.trim();
  if (text) {
    sendMessage(text);
    messageInput.value = '';
  }
});
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// ---------- АВТОРИЗАЦИЯ ----------
function auth() {
  const login = loginInput.value.trim();
  const pass = passwordInput.value.trim();
  if (!login || !pass) { authError.textContent = 'Заполните все поля'; return; }
  const action = currentAuthTab;
  sendToServer({ type: 'auth', action, login, password: pass });
}
authActionBtn.addEventListener('click', auth);
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') auth(); });

// ---------- НАЗАД ----------
backBtn.addEventListener('click', () => {
  currentChatId = null;
  showScreen('chatsScreen');
  sendToServer({ type: 'getChats' });
});

// ---------- ВЫХОД ----------
logoutBtn.addEventListener('click', () => {
  if (socket) socket.close();
  localStorage.removeItem('mini-userId');
  localStorage.removeItem('mini-displayName');
  currentUser = null;
  currentChatId = null;
  chats = [];
  isRestoring = false;
  showScreen('authScreen');
  setTimeout(connectWS, 100);
});

// ---------- ПРОФИЛЬ ----------
function updateProfileUI() {
  if (currentUser) {
    profileLogin.value = currentUser.displayName;
    const avatarSrc = currentUser.avatar || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23f8bbd0"/%3E%3Ctext x="50" y="58" font-size="40" text-anchor="middle" fill="%23ffffff"%3E🌸%3C/text%3E%3C/svg%3E';
    profileAvatar.src = avatarSrc;
  }
}

profileBtn.addEventListener('click', () => {
  updateProfileUI();
  showScreen('profileScreen');
});

avatarInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    // Отправляем на сервер
    sendToServer({ type: 'updateProfile', avatar: dataUrl });
    avatarInput.value = '';
  };
  reader.onerror = () => {
    alert('Не удалось загрузить аватар');
    avatarInput.value = '';
  };
  reader.readAsDataURL(file);
});

deleteAccountBtn.addEventListener('click', () => {
  if (confirm('Вы уверены, что хотите удалить аккаунт? Это действие необратимо!')) {
    sendToServer({ type: 'deleteAccount' });
  }
});

profileBackBtn.addEventListener('click', () => showScreen('chatsScreen'));

// ---------- СТАРТ ----------
connectWS();
const savedUserId = localStorage.getItem('mini-userId');
if (savedUserId) {
  showScreen('chatsScreen');
} else {
  showScreen('authScreen');
}