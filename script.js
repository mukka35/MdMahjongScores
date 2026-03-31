const STORAGE_KEY = 'mahjongTitles';
const CLOUD_SYNC_INTERVAL_MS = 15000;

let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudPullInFlight = false;

const defaultRules = {
  aka: false,
  tsumoHo: false,
  tobi: true,
  umaSecond: 10000,
  umaTop: 20000,
  okaReturn: 30000
};

const state = {
  mode: 'home',
  playerCount: 4,
  players: [],
  round: { wind: '東', number: 1 },
  honba: 0,
  kyoutaku: 0,
  reachPool: 0,
  title: '',
  currentTitleId: null,
  rules: { ...defaultRules },
  agariFlow: {
    type: null,
    winnerIndex: null,
    loserIndex: null,
    han: null,
    fu: null
  },
  ryukyokuTenpai: [],
  matchResult: null,
  seatDraftOrder: [],
  seatSwapSelection: null,
  seatWindOffset: 0,
  seatBottomSeatIndex: 0,
  displayBottomIndex: 0
};

const screens = {
  home: document.getElementById('homeScreen'),
  setup: document.getElementById('setupScreen'),
  titleList: document.getElementById('titleListScreen'),
  game: document.getElementById('gameScreen'),
  result: document.getElementById('resultScreen')
};

function showScreen(name) {
  Object.values(screens).forEach(element => element.classList.remove('active'));
  screens[name].classList.add('active');
  state.mode = name;
  document.body.style.overflow = name === 'game' ? 'hidden' : '';
}

function getCloudConfig() {
  const config = window.CLOUD_CONFIG || {};
  return {
    enabled: Boolean(config.enabled && config.supabaseUrl && config.supabaseAnonKey),
    supabaseUrl: (config.supabaseUrl || '').replace(/\/$/, ''),
    supabaseAnonKey: config.supabaseAnonKey || '',
    storageId: config.storageId || 'main'
  };
}

function getCloudHeaders() {
  const config = getCloudConfig();
  return {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`,
    'Content-Type': 'application/json'
  };
}

async function cloudFetchTitleStore() {
  const config = getCloudConfig();
  if (!config.enabled) return null;

  const endpoint = `${config.supabaseUrl}/rest/v1/app_state?id=eq.${encodeURIComponent(config.storageId)}&select=payload,updated_at&limit=1`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: getCloudHeaders()
  });

  if (!response.ok) {
    throw new Error(`Cloud fetch failed: ${response.status}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const payload = rows[0].payload;
  return Array.isArray(payload) ? payload : null;
}

async function cloudSaveTitleStore(titles) {
  const config = getCloudConfig();
  if (!config.enabled) return;

  const endpoint = `${config.supabaseUrl}/rest/v1/app_state`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...getCloudHeaders(),
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify([
      {
        id: config.storageId,
        payload: titles,
        updated_at: new Date().toISOString()
      }
    ])
  });

  if (!response.ok) {
    throw new Error(`Cloud save failed: ${response.status}`);
  }
}

function loadTitleStore() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function saveTitleStore(titles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(titles));
  queueCloudSave(titles);
}

function queueCloudSave(titles) {
  if (cloudSyncInFlight) return;
  cloudSyncInFlight = true;
  cloudSaveTitleStore(titles)
    .catch(error => {
      console.warn('Cloud sync failed; local data is still saved.', error);
    })
    .finally(() => {
      cloudSyncInFlight = false;
    });
}

async function hydrateFromCloud() {
  const config = getCloudConfig();
  if (!config.enabled) return;

  try {
    const cloudTitles = await cloudFetchTitleStore();
    if (!cloudTitles) return;
    saveTitleStore(cloudTitles);
    if (state.mode === 'titleList') {
      renderTitleList();
    }
  } catch (error) {
    console.warn('Cloud pull failed; using local cache.', error);
  }
}

function startCloudPolling() {
  const config = getCloudConfig();
  if (!config.enabled) return;
  if (cloudSyncTimer) clearInterval(cloudSyncTimer);

  cloudSyncTimer = setInterval(async () => {
    if (cloudPullInFlight || cloudSyncInFlight) return;
    cloudPullInFlight = true;
    try {
      const cloudTitles = await cloudFetchTitleStore();
      if (cloudTitles) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudTitles));
        if (state.mode === 'titleList') {
          renderTitleList();
        }
      }
    } catch (error) {
      console.warn('Cloud polling failed; continuing with local cache.', error);
    } finally {
      cloudPullInFlight = false;
    }
  }, CLOUD_SYNC_INTERVAL_MS);
}

function generateTitleId() {
  return `title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getTitleRecord(titleId) {
  return loadTitleStore().find(title => title.id === titleId) || null;
}

function upsertTitleRecord(record) {
  const titles = loadTitleStore();
  const index = titles.findIndex(title => title.id === record.id);
  if (index >= 0) {
    titles[index] = record;
  } else {
    titles.push(record);
  }

  titles.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  saveTitleStore(titles);
}

function createTitleRecord({ title, playerCount, playerNames, rules }) {
  const now = new Date().toISOString();
  return {
    id: generateTitleId(),
    title,
    playerCount,
    playerNames,
    displayBottomIndex: 0,
    rules,
    createdAt: now,
    updatedAt: now,
    sessions: []
  };
}

function formatDateTime(isoText) {
  const date = new Date(isoText);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function setPlayerNameInputs(playerNames = []) {
  const container = document.getElementById('playerNamesContainer');
  container.innerHTML = '';
  const count = Number(document.getElementById('playerCount').value);

  for (let i = 0; i < count; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `P${i + 1} 名前`;
    input.id = `playerName${i}`;
    input.style.margin = '2px';
    input.style.width = '150px';
    input.value = playerNames[i] || '';
    container.appendChild(input);
  }
}

function resetSetupForm() {
  document.getElementById('matchTitle').value = '';
  document.getElementById('playerCount').value = '4';
  document.getElementById('ruleAka').checked = defaultRules.aka;
  document.getElementById('ruleTsumoHo').checked = defaultRules.tsumoHo;
  document.getElementById('ruleTobi').checked = defaultRules.tobi;
  document.getElementById('ruleUmaSecond').value = String(defaultRules.umaSecond);
  document.getElementById('ruleUmaTop').value = String(defaultRules.umaTop);
  document.getElementById('ruleOka').value = String(defaultRules.okaReturn);
  setPlayerNameInputs();
}

function parseRuleNumber(inputId, fallback) {
  const value = Number(document.getElementById(inputId).value);
  if (Number.isNaN(value) || value < 0) return fallback;
  return value;
}

function openNewTitleSetup() {
  resetSetupForm();
  showScreen('setup');
}

function openTitleList() {
  renderTitleList();
  showScreen('titleList');
}

function renderTitleList() {
  const container = document.getElementById('titleList');
  const titles = loadTitleStore();
  container.innerHTML = '';

  if (titles.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'title-card';
    empty.textContent = 'まだタイトルがありません。';
    container.appendChild(empty);
    return;
  }

  titles.forEach(title => {
    const button = document.createElement('button');
    button.className = 'btn title-name-btn';
    button.textContent = title.title;
    button.onclick = () => openLatestResultForTitle(title.id);
    container.appendChild(button);
  });
}

function openLatestResultForTitle(titleId) {
  const titleRecord = getTitleRecord(titleId);
  if (!titleRecord) {
    alert('タイトルが見つかりません。');
    openTitleList();
    return;
  }

  state.currentTitleId = titleRecord.id;
  state.title = titleRecord.title;
  state.playerCount = titleRecord.playerCount;
  state.rules = { ...defaultRules, ...titleRecord.rules };

  if (!titleRecord.sessions || titleRecord.sessions.length === 0) {
    startMatchFromTitle(titleId);
    return;
  }

  const latestSession = [...titleRecord.sessions].sort((left, right) => new Date(right.endedAt) - new Date(left.endedAt))[0];
  state.matchResult = latestSession;
  renderResultScreen();
  showScreen('result');
}

function initializeMatchFromTitle(record) {
  state.currentTitleId = record.id;
  state.title = record.title;
  state.playerCount = record.playerCount;
  state.rules = { ...defaultRules, ...record.rules };
  state.players = record.playerNames.map((name, index) => ({
    name,
    score: 25000,
    reach: false,
    reachSticks: 0,
    isDealer: index === 0
  }));
  state.displayBottomIndex = Number.isInteger(record.displayBottomIndex) ? record.displayBottomIndex : 0;
  state.round = { wind: '東', number: 1 };
  state.honba = 0;
  state.kyoutaku = 0;
  state.reachPool = 0;
  state.ryukyokuTenpai = [];
  state.matchResult = null;
  resetAgariFlow();
}

function startMatchFromTitle(titleId) {
  const record = getTitleRecord(titleId);
  if (!record) {
    alert('タイトルが見つかりません。');
    openTitleList();
    return;
  }

  initializeMatchFromTitle(record);
  refreshStatus();
  showScreen('game');
}

function beginNewTitleMatch() {
  const title = document.getElementById('matchTitle').value.trim();
  if (!title) {
    alert('タイトルを入力してください。');
    return;
  }

  const playerCount = Number(document.getElementById('playerCount').value);
  const playerNames = [];
  for (let i = 0; i < playerCount; i++) {
    const input = document.getElementById(`playerName${i}`);
    playerNames.push((input && input.value.trim()) || `P${i + 1}`);
  }

  const record = createTitleRecord({
    title,
    playerCount,
    playerNames,
    rules: {
      aka: document.getElementById('ruleAka').checked,
      tsumoHo: document.getElementById('ruleTsumoHo').checked,
      tobi: document.getElementById('ruleTobi').checked,
      umaSecond: parseRuleNumber('ruleUmaSecond', defaultRules.umaSecond),
      umaTop: parseRuleNumber('ruleUmaTop', defaultRules.umaTop),
      okaReturn: parseRuleNumber('ruleOka', defaultRules.okaReturn)
    }
  });

  upsertTitleRecord(record);
  startMatchFromTitle(record.id);
}

function roundLabel() {
  return `${state.round.wind}${state.round.number}局`;
}

function getSeatWinds() {
  const windOrder = ['東', '南', '西', '北'];
  const dealerIndex = state.players.findIndex(player => player.isDealer);

  if (dealerIndex < 0) {
    return [...windOrder];
  }

  return windOrder.map((_, playerIndex) => {
    const windIndex = (playerIndex - dealerIndex + windOrder.length) % windOrder.length;
    return windOrder[windIndex];
  });
}

function renderPlayers() {
  const ids = ['playerBottom', 'playerRight', 'playerTop', 'playerLeft'];
  const posClasses = ['reach-bottom', 'reach-top', 'reach-right', 'reach-left'];
  const winds = getSeatWinds();
  const playerCount = state.players.length;
  const safeBottomIndex = playerCount > 0 ? ((state.displayBottomIndex % playerCount) + playerCount) % playerCount : 0;
  const displayOrder = Array.from({ length: playerCount }, (_, idx) => (safeBottomIndex + idx) % playerCount);

  for (let i = 0; i < 4; i++) {
    const cardEl = document.getElementById(ids[i]);
    if (!cardEl) continue;

    const playerIndex = displayOrder[i];
    if (playerIndex === undefined) {
      cardEl.classList.remove('reach-top', 'reach-bottom', 'reach-left', 'reach-right', 'is-dealer');
      cardEl.classList.add(posClasses[i]);
      cardEl.innerHTML = '';
      cardEl.onclick = null;
      cardEl.style.cursor = 'default';
      continue;
    }

    const player = state.players[playerIndex] || {
      name: `P${i + 1}`,
      score: 0,
      isDealer: false,
      reach: false,
      reachSticks: 0
    };

    cardEl.classList.remove('reach-top', 'reach-bottom', 'reach-left', 'reach-right', 'is-dealer');
    cardEl.classList.add(posClasses[i]);
    if (player.isDealer) {
      cardEl.classList.add('is-dealer');
    }

    let sticks = '';
    for (let j = 0; j < player.reachSticks; j++) {
      sticks += '<div class="reach-stick"></div>';
    }

    cardEl.innerHTML = `
      <div class="wind-marker ${player.isDealer ? 'dealer' : ''}"><span class="wind-text">${winds[playerIndex]}</span></div>
      <div class="name">${player.name}</div>
      <div class="score">${player.score}</div>
      <div class="flags">${sticks}</div>
      <button class="reach-btn ${player.reach ? 'active' : ''}" onclick="event.stopPropagation(); toggleReach(${playerIndex})">立直</button>
    `;

    cardEl.style.cursor = 'pointer';
    cardEl.onclick = () => startAgariFlow(playerIndex);
  }
}

function refreshStatus() {
  document.getElementById('currentTitle').textContent = `対局: ${state.title}`;
  document.getElementById('roundLabel').textContent = roundLabel();
  document.getElementById('honbaLabel').textContent = `本場${state.honba}`;
  document.getElementById('kyoutakuLabel').textContent = `供託${state.kyoutaku}本`;
  document.getElementById('reachPoolLabel').textContent = `立直棒${state.reachPool / 1000}本`;
  renderPlayers();
}

function nextSeatDealer() {
  const currentDealer = state.players.findIndex(player => player.isDealer);
  if (currentDealer >= 0) {
    state.players[currentDealer].isDealer = false;
    state.players[(currentDealer + 1) % state.players.length].isDealer = true;
  }
}

function nextRound() {
  if (state.round.wind === '東') {
    if (state.round.number < 4) {
      state.round.number += 1;
    } else {
      state.round.wind = '南';
      state.round.number = 1;
    }
    return;
  }

  if (state.round.number < 4) {
    state.round.number += 1;
  } else {
    state.round.wind = '終';
    state.round.number = 0;
  }
}

function closeModals() {
  document.getElementById('agariTypeModal').classList.add('hidden');
  document.getElementById('ronPlayerModal').classList.add('hidden');
  document.getElementById('hanModal').classList.add('hidden');
  document.getElementById('fuModal').classList.add('hidden');
  document.getElementById('tenpaiModal').classList.add('hidden');
  document.getElementById('seatConfirmModal').classList.add('hidden');
}

function getSeatWindLabels(count) {
  return ['東', '南', '西', '北'].slice(0, count);
}

function openSeatConfirmModal() {
  const titleRecord = getTitleRecord(state.currentTitleId);
  if (!titleRecord) {
    startMatchFromTitle(state.currentTitleId);
    return;
  }

  state.seatDraftOrder = [...titleRecord.playerNames];
  state.seatSwapSelection = null;
  state.seatWindOffset = 0;
  state.seatBottomSeatIndex = Number.isInteger(titleRecord.displayBottomIndex) ? titleRecord.displayBottomIndex : 0;
  renderSeatConfirmList();
  document.getElementById('seatConfirmModal').classList.remove('hidden');
}

function closeSeatConfirmModal() {
  state.seatDraftOrder = [];
  state.seatSwapSelection = null;
  state.seatWindOffset = 0;
  state.seatBottomSeatIndex = 0;
  document.getElementById('seatConfirmModal').classList.add('hidden');
}

function getSeatWindByRowIndex(rowIndex) {
  const windLabels = getSeatWindLabels(state.seatDraftOrder.length);
  const normalized = (rowIndex - state.seatWindOffset + windLabels.length) % windLabels.length;
  return windLabels[normalized];
}

function renderSeatConfirmList() {
  const container = document.getElementById('seatConfirmList');
  container.innerHTML = '';

  const headerRow = document.createElement('div');
  headerRow.className = 'seat-confirm-header-row';
  const seatSettingLabel = document.createElement('span');
  seatSettingLabel.className = 'seat-confirm-header-main';
  seatSettingLabel.textContent = '席順設定';
  const userLabel = document.createElement('span');
  userLabel.className = 'seat-confirm-header-user';
  userLabel.textContent = 'ユーザー';
  headerRow.appendChild(seatSettingLabel);
  headerRow.appendChild(userLabel);
  container.appendChild(headerRow);

  state.seatDraftOrder.forEach((playerName, seatIndex) => {
    const row = document.createElement('div');
    row.className = 'seat-confirm-row';
    const windText = getSeatWindByRowIndex(seatIndex);

    const windButton = document.createElement('button');
    windButton.className = 'modal-btn seat-wind-btn';
    if (windText === '東') {
      windButton.classList.add('east');
    }
    windButton.textContent = windText;
    windButton.onclick = () => rotateSeatToEast(seatIndex);

    const playerButton = document.createElement('button');
    playerButton.className = 'modal-btn seat-player-btn';
    if (state.seatSwapSelection === seatIndex) {
      playerButton.classList.add('active');
    }
    playerButton.textContent = playerName;
    playerButton.onclick = () => selectSeatForSwap(seatIndex);

    const userCheckWrap = document.createElement('label');
    userCheckWrap.className = 'seat-user-check';
    const userCheck = document.createElement('input');
    userCheck.type = 'checkbox';
    userCheck.checked = state.seatBottomSeatIndex === seatIndex;
    userCheck.onchange = () => selectBottomSeat(seatIndex);
    userCheckWrap.appendChild(userCheck);

    row.appendChild(windButton);
    row.appendChild(playerButton);
    row.appendChild(userCheckWrap);
    container.appendChild(row);
  });
}

function clearSeatButtonFocus() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

function rotateSeatToEast(seatIndex) {
  state.seatWindOffset = seatIndex;
  state.seatSwapSelection = null;
  renderSeatConfirmList();
}

function selectSeatForSwap(seatIndex) {
  if (state.seatSwapSelection === null) {
    state.seatSwapSelection = seatIndex;
    renderSeatConfirmList();
    clearSeatButtonFocus();
    return;
  }

  if (state.seatSwapSelection === seatIndex) {
    state.seatSwapSelection = null;
    renderSeatConfirmList();
    clearSeatButtonFocus();
    return;
  }

  const first = state.seatSwapSelection;
  const second = seatIndex;
  const temp = state.seatDraftOrder[first];
  state.seatDraftOrder[first] = state.seatDraftOrder[second];
  state.seatDraftOrder[second] = temp;

  if (state.seatBottomSeatIndex === first) {
    state.seatBottomSeatIndex = second;
  } else if (state.seatBottomSeatIndex === second) {
    state.seatBottomSeatIndex = first;
  }

  state.seatSwapSelection = null;
  renderSeatConfirmList();
  clearSeatButtonFocus();
}

function selectBottomSeat(seatIndex) {
  state.seatBottomSeatIndex = seatIndex;
  renderSeatConfirmList();
  clearSeatButtonFocus();
}

function applySeatConfirmAndStart() {
  const titleRecord = getTitleRecord(state.currentTitleId);
  if (!titleRecord || state.seatDraftOrder.length === 0) {
    closeSeatConfirmModal();
    startMatchFromTitle(state.currentTitleId);
    return;
  }

  const windOrder = getSeatWindLabels(state.seatDraftOrder.length);
  const playerNamesByWind = windOrder.map(wind => {
    const rowIndex = state.seatDraftOrder.findIndex((_, index) => getSeatWindByRowIndex(index) === wind);
    return state.seatDraftOrder[rowIndex];
  });
  const bottomPlayerName = state.seatDraftOrder[state.seatBottomSeatIndex];
  const displayBottomIndex = playerNamesByWind.findIndex(name => name === bottomPlayerName);

  titleRecord.playerNames = playerNamesByWind;
  titleRecord.displayBottomIndex = displayBottomIndex >= 0 ? displayBottomIndex : 0;
  titleRecord.updatedAt = new Date().toISOString();
  upsertTitleRecord(titleRecord);
  closeSeatConfirmModal();
  startMatchFromTitle(state.currentTitleId);
}

function resetAgariFlow() {
  state.agariFlow = { type: null, winnerIndex: null, loserIndex: null, han: null, fu: null };
}

function cancelAgariFlow() {
  closeModals();
  resetAgariFlow();
}

function backFromAgariType() {
  cancelAgariFlow();
}

function handleAgariTypeOverlayClick(event) {
  if (event.target === event.currentTarget) {
    cancelAgariFlow();
  }
}

function handleRonPlayerOverlayClick(event) {
  if (event.target === event.currentTarget) {
    cancelAgariFlow();
  }
}

function handleHanOverlayClick(event) {
  if (event.target === event.currentTarget) {
    cancelAgariFlow();
  }
}

function handleFuOverlayClick(event) {
  if (event.target === event.currentTarget) {
    cancelAgariFlow();
  }
}

function backFromRonPlayerModal() {
  document.getElementById('ronPlayerModal').classList.add('hidden');
  document.getElementById('agariTypeModal').classList.remove('hidden');
  state.agariFlow.loserIndex = null;
}

function backFromHanModal() {
  document.getElementById('hanModal').classList.add('hidden');
  state.agariFlow.han = null;
  if (state.agariFlow.type === 'ron') {
    document.getElementById('ronPlayerModal').classList.remove('hidden');
    return;
  }
  document.getElementById('agariTypeModal').classList.remove('hidden');
}

function backFromFuModal() {
  document.getElementById('fuModal').classList.add('hidden');
  state.agariFlow.fu = null;
  document.getElementById('hanModal').classList.remove('hidden');
}

function startAgariFlow(playerIndex) {
  state.agariFlow.winnerIndex = playerIndex;
  document.getElementById('agariTypeModal').classList.remove('hidden');
}

function selectAgariType(type) {
  state.agariFlow.type = type;
  if (type === 'tsumo') {
    showHanModal();
  } else {
    showRonPlayerModal();
  }
}

function showRonPlayerModal() {
  const container = document.getElementById('ronPlayerButtons');
  container.innerHTML = '';

  state.players.forEach((_, index) => {
    if (index === state.agariFlow.winnerIndex) return;
    const button = document.createElement('button');
    button.className = 'modal-btn';
    button.textContent = state.players[index].name;
    button.onclick = () => selectRonPlayer(index);
    container.appendChild(button);
  });

  document.getElementById('agariTypeModal').classList.add('hidden');
  document.getElementById('ronPlayerModal').classList.remove('hidden');
}

function selectRonPlayer(playerIndex) {
  state.agariFlow.loserIndex = playerIndex;
  showHanModal();
}

function showHanModal() {
  const container = document.getElementById('hanButtons');
  container.innerHTML = '';

  const hanList = ['1翻', '2翻', '3翻', '4翻', '満貫', '跳満', '倍満', '役満'];
  const hanValues = [1, 2, 3, 4, 5, 6, 8, 13];

  hanList.forEach((label, index) => {
    const button = document.createElement('button');
    button.className = 'modal-btn';
    button.textContent = label;
    button.onclick = () => selectHan(hanValues[index]);
    container.appendChild(button);
  });

  document.getElementById('agariTypeModal').classList.add('hidden');
  document.getElementById('ronPlayerModal').classList.add('hidden');
  document.getElementById('hanModal').classList.remove('hidden');
}

function selectHan(han) {
  state.agariFlow.han = han;
  if (han >= 5) {
    finalizeAgari();
    return;
  }
  showFuModal();
}

function showFuModal() {
  const container = document.getElementById('fuButtons');
  container.innerHTML = '';
  const winner = state.players[state.agariFlow.winnerIndex];
  const fuList = MahjongCalc.getAvailableFuOptions({
    han: state.agariFlow.han,
    type: state.agariFlow.type,
    isDealer: winner ? winner.isDealer : false
  });

  fuList.forEach(fu => {
    const button = document.createElement('button');
    button.className = 'modal-btn';
    button.textContent = `${fu}符`;
    button.onclick = () => selectFu(fu);
    container.appendChild(button);
  });

  document.getElementById('hanModal').classList.add('hidden');
  document.getElementById('fuModal').classList.remove('hidden');
}

function selectFu(fu) {
  state.agariFlow.fu = fu;
  finalizeAgari();
}

function finalizeAgari() {
  closeModals();
  applyAgari();
  resetAgariFlow();
}

function startRyukyoku() {
  state.ryukyokuTenpai = [];
  renderTenpaiSelection();
  document.getElementById('tenpaiModal').classList.remove('hidden');
}

function renderTenpaiSelection() {
  const container = document.getElementById('tenpaiPlayerButtons');
  container.innerHTML = '';

  state.players.forEach((player, index) => {
    const button = document.createElement('button');
    button.className = 'modal-btn';
    if (state.ryukyokuTenpai.includes(index)) {
      button.classList.add('active');
    }
    button.textContent = player.name;
    button.onclick = () => toggleTenpaiPlayer(index);
    container.appendChild(button);
  });
}

function toggleTenpaiPlayer(index) {
  if (state.ryukyokuTenpai.includes(index)) {
    state.ryukyokuTenpai = state.ryukyokuTenpai.filter(playerIndex => playerIndex !== index);
  } else {
    state.ryukyokuTenpai = [...state.ryukyokuTenpai, index].sort((left, right) => left - right);
  }
  renderTenpaiSelection();
}

function applyRyukyokuNotenPenalty() {
  const tenpaiCount = state.ryukyokuTenpai.length;
  const notenPlayers = state.players
    .map((player, index) => ({ player, index }))
    .filter(({ index }) => !state.ryukyokuTenpai.includes(index));

  if (tenpaiCount === 0 || tenpaiCount === state.players.length) {
    return;
  }

  const totalPenalty = 3000;
  const rewardPerTenpai = totalPenalty / tenpaiCount;
  const penaltyPerNoten = totalPenalty / notenPlayers.length;

  state.players.forEach((player, index) => {
    if (state.ryukyokuTenpai.includes(index)) {
      player.score += rewardPerTenpai;
    } else {
      player.score -= penaltyPerNoten;
    }
  });
}

function settleRyukyokuReach() {
  const currentHandReachSticks = state.players.reduce((total, player) => total + player.reachSticks, 0);
  if (currentHandReachSticks > 0) {
    state.kyoutaku += currentHandReachSticks;
  }

  state.players.forEach(player => {
    player.reach = false;
    player.reachSticks = 0;
  });
}

function confirmRyukyoku() {
  closeModals();
  applyRyukyokuNotenPenalty();
  settleRyukyokuReach();
  state.honba += 1;

  const dealerIndex = state.players.findIndex(player => player.isDealer);
  const dealerIsTenpai = state.ryukyokuTenpai.includes(dealerIndex);
  if (!dealerIsTenpai) {
    nextSeatDealer();
    nextRound();
  }

  state.ryukyokuTenpai = [];
  if (!handleMatchCompletion()) {
    refreshStatus();
  }
}

function cancelRyukyoku() {
  state.ryukyokuTenpai = [];
  document.getElementById('tenpaiModal').classList.add('hidden');
}

function toggleReach(index) {
  const player = state.players[index];
  if (!player) return;

  if (player.reach) {
    player.reach = false;
    player.score += 1000;
    player.reachSticks = Math.max(0, player.reachSticks - 1);
    state.reachPool = Math.max(0, state.reachPool - 1000);
  } else if (player.score >= 1000) {
    player.reach = true;
    player.score -= 1000;
    player.reachSticks += 1;
    state.reachPool += 1000;
  } else {
    alert('スコアが不足しています。立直できません。');
    return;
  }

  if (!handleMatchCompletion()) {
    refreshStatus();
  }
}

function collectReachPool(winner) {
  if (state.reachPool > 0) {
    winner.score += state.reachPool;
    state.reachPool = 0;
  }

  state.kyoutaku = 0;
  state.players.forEach(player => {
    player.reach = false;
    player.reachSticks = 0;
  });
}

function advanceAfterWin(winnerIsDealer) {
  if (winnerIsDealer) {
    state.honba += 1;
    return;
  }

  state.honba = 0;
  nextSeatDealer();
  nextRound();
}

function applyScoreByAgari({ type, winnerIndex, loserIndex, han, fu }) {
  const winner = state.players[winnerIndex];
  if (!winner) return false;

  const scoreResult = MahjongCalc.getAgariScore({
    han,
    fu,
    type,
    isDealer: winner.isDealer,
    honba: state.honba,
    playerCount: state.players.length
  });
  if (!scoreResult) return false;

  collectReachPool(winner);

  if (type === 'ron') {
    if (loserIndex === null || loserIndex === undefined) return false;
    const loser = state.players[loserIndex];
    if (!loser) return false;
    winner.score += scoreResult.ron;
    loser.score -= scoreResult.ron;
  } else {
    state.players.forEach((player, index) => {
      if (index === winnerIndex) return;
      if (player.isDealer) {
        player.score -= scoreResult.dealerPay;
      } else {
        player.score -= scoreResult.nonDealerPay;
      }
    });
    winner.score += scoreResult.total;
  }

  advanceAfterWin(winner.isDealer);
  return true;
}

function applyAgari() {
  const { type, winnerIndex, loserIndex, han, fu } = state.agariFlow;
  if (!type || winnerIndex === null || !han) return;

  if (!applyScoreByAgari({ type, winnerIndex, loserIndex, han, fu })) {
    alert('この組み合わせは選択できません。');
    return;
  }

  if (!handleMatchCompletion()) {
    refreshStatus();
  }
}

function getMatchEndReason() {
  if (state.rules.tobi && state.players.some(player => player.score <= 0)) {
    return '飛び';
  }
  if (state.round.wind === '終') {
    return '南4局終了';
  }
  return null;
}

function saveCompletedMatch(endReason) {
  const titleRecord = getTitleRecord(state.currentTitleId);
  if (!titleRecord) return null;

  const matchResult = {
    id: `session-${Date.now()}`,
    endedAt: new Date().toISOString(),
    endReason,
    rules: { ...state.rules },
    players: state.players.map((player, index) => ({
      seat: index,
      name: player.name,
      score: player.score
    }))
  };

  titleRecord.sessions.push(matchResult);
  titleRecord.updatedAt = matchResult.endedAt;
  upsertTitleRecord(titleRecord);
  return matchResult;
}

function renderResultScreen() {
  const summary = document.getElementById('resultSummary');
  const table = document.getElementById('resultTable');
  const historyList = document.getElementById('resultHistoryList');
  if (!state.matchResult) {
    summary.innerHTML = '';
    table.innerHTML = '';
    historyList.innerHTML = '';
    return;
  }

  const titleRecord = getTitleRecord(state.currentTitleId);
  const settlementRows = calculateUmaOkaResult(state.matchResult.players, state.matchResult.rules, state.playerCount);
  let matchNumber = 1;
  if (titleRecord) {
    const sortedSessions = [...titleRecord.sessions].sort((left, right) => new Date(left.endedAt) - new Date(right.endedAt));
    const matchIndex = sortedSessions.findIndex(session => session.id === state.matchResult.id);
    if (matchIndex >= 0) {
      matchNumber = matchIndex + 1;
    }
  }

  summary.innerHTML = `
    <div class="result-card">
      <div class="result-title">${state.title}</div>
      <div class="result-meta">${matchNumber}試合目</div>
    </div>
  `;

  table.innerHTML = `
    <div class="result-card">
      ${settlementRows.map(row => `
        <div class="result-row result-current-row">
          <span>${row.rank}位</span>
          <span>${row.name}</span>
          <span class="result-current-point">${formatSignedPoint(row.finalPoints)}</span>
        </div>
      `).join('')}
    </div>
  `;

  if (!titleRecord) {
    historyList.innerHTML = '<div class="result-card">タイトル情報が見つかりません。</div>';
    return;
  }

  const sessions = [...titleRecord.sessions].sort((left, right) => new Date(left.endedAt) - new Date(right.endedAt));
  const headerCells = titleRecord.playerNames
    .map((name, index) => `<th>P${index + 1}</th>`)
    .join('');

  const bodyRows = sessions.map((session, index) => {
    const pointsBySeat = calculateSeatPoints(
      session.players,
      session.rules || titleRecord.rules,
      titleRecord.playerCount
    );
    const pointCells = pointsBySeat
      .map(point => `<td>${formatSignedPoint(point)}</td>`)
      .join('');
    return `<tr><th>${index + 1}試合目</th>${pointCells}</tr>`;
  }).join('');

  const totalBySeat = Array(titleRecord.playerCount).fill(0);
  sessions.forEach(session => {
    const pointsBySeat = calculateSeatPoints(
      session.players,
      session.rules || titleRecord.rules,
      titleRecord.playerCount
    );
    pointsBySeat.forEach((point, seatIndex) => {
      totalBySeat[seatIndex] += point;
    });
  });
  const totalCells = totalBySeat.map(point => `<td>${formatSignedPoint(point)}</td>`).join('');

  historyList.innerHTML = `
    <table class="result-history-table">
      <thead>
        <tr><th>試合</th>${headerCells}</tr>
      </thead>
      <tbody>
        ${bodyRows}
        <tr class="result-total-row"><th>合計</th>${totalCells}</tr>
      </tbody>
    </table>
  `;
}

function calculateSeatPoints(players, rules, playerCount) {
  const sortedRows = calculateUmaOkaResult(players, rules, playerCount);
  const pointsBySeat = Array(playerCount).fill(0);
  sortedRows.forEach(row => {
    pointsBySeat[row.seat] = row.finalPoints;
  });
  return pointsBySeat;
}

function formatSignedPoint(value) {
  return value >= 0 ? `+${value}` : String(value);
}

function calculateUmaOkaResult(players, rules, playerCount) {
  const sorted = [...players]
    .map(player => ({ ...player }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.seat - right.seat;
    });

  const startScore = 25000;
  const umaArray = [
    Math.floor(rules.umaTop / 1000),
    Math.floor(rules.umaSecond / 1000),
    -Math.floor(rules.umaSecond / 1000),
    -Math.floor(rules.umaTop / 1000)
  ];

  const results = sorted.map((player, index) => {
    const rank = index + 1;
    const roundedScore = rank === 1 ? player.score : Math.ceil(player.score / 1000) * 1000;
    const basePoints = Math.floor((roundedScore - rules.okaReturn) / 1000);
    const umaPoints = umaArray[index] || 0;
    return {
      seat: player.seat,
      rank,
      name: player.name,
      rawScore: player.score,
      roundedScore,
      finalPoints: basePoints + umaPoints
    };
  });

  const topIndex = results.findIndex(row => row.rank === 1);
  if (topIndex >= 0) {
    const othersTotal = results
      .filter((_, index) => index !== topIndex)
      .reduce((sum, row) => sum + row.finalPoints, 0);
    results[topIndex].finalPoints = -othersTotal;
  }

  return results;
}

function finishMatch(endReason) {
  closeModals();
  resetAgariFlow();
  state.matchResult = saveCompletedMatch(endReason);
  renderResultScreen();
  showScreen('result');
}

function handleMatchCompletion() {
  const endReason = getMatchEndReason();
  if (!endReason) {
    return false;
  }

  finishMatch(endReason);
  return true;
}

function restartCurrentTitleMatch() {
  if (!state.currentTitleId) {
    openTitleList();
    return;
  }
  openSeatConfirmModal();
}

function init() {
  setPlayerNameInputs();
  document.getElementById('startMatchBtn').addEventListener('click', openTitleList);
  document.getElementById('titleListBtn').addEventListener('click', openTitleList);
  document.getElementById('createTitleBtn').addEventListener('click', openNewTitleSetup);
  document.getElementById('backToHomeBtn').addEventListener('click', () => showScreen('home'));
  document.getElementById('playerCount').addEventListener('change', () => setPlayerNameInputs());
  document.getElementById('beginBattleBtn').addEventListener('click', beginNewTitleMatch);
  document.getElementById('cancelSetupBtn').addEventListener('click', openTitleList);
  document.getElementById('resultToTitlesBtn').addEventListener('click', openTitleList);
  document.getElementById('restartMatchBtn').addEventListener('click', restartCurrentTitleMatch);
  document.getElementById('seatConfirmApplyBtn').addEventListener('click', applySeatConfirmAndStart);
  document.getElementById('seatConfirmCancelBtn').addEventListener('click', closeSeatConfirmModal);
  refreshStatus();
  hydrateFromCloud();
  startCloudPolling();
}

window.addEventListener('DOMContentLoaded', init);