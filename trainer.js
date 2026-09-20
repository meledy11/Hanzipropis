/* trainer.js — Тренажёр каллиграфии + Карточки + Избранное
   Зависимости: dictionary-data.js (window.HSK_DICT), pinyinPro, HanziWriter
*/
(function () {
  'use strict';

  const STORAGE_KEY = 'hanzi_trainer_progress_v1';
  const FAV_KEY = 'hanzi_trainer_favorites_v1';
  const REVIEW_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120];
  const AUTOPLAY_PLAYLIST_SIZE = 50;

  // ============================================================
  // ОЗВУЧКА
  // ============================================================
  const AUDIO_DIRS = ['Audio/hsk1/','Audio/hsk2/','Audio/hsk3/','Audio/hsk4/','Audio/hsk5/','Audio/hsk6/','Audio/'];
  const AUDIO_PREFIX = 'cmn-';
  const audioCache = new Map();
  let currentPlayingAudio = null;
  let speechToken = 0;

  function stopCurrentAudio() {
    speechToken++;
    if (currentPlayingAudio) {
      try { currentPlayingAudio.pause(); currentPlayingAudio.currentTime = 0; } catch (e) {}
      currentPlayingAudio = null;
    }
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (e) {} }
  }

  let zhVoice = null;
  function pickZhVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices() || [];
    zhVoice = voices.find(v => /zh[-_]?CN/i.test(v.lang))
           || voices.find(v => v.lang && v.lang.startsWith('zh')) || null;
  }
  if ('speechSynthesis' in window) {
    pickZhVoice();
    speechSynthesis.onvoiceschanged = pickZhVoice;
  }

  function speakWithBrowser(text) {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 0.85; u.pitch = 1; u.volume = 1;
    if (zhVoice) u.voice = zhVoice;
    speechSynthesis.speak(u);
  }

  function preloadAudio(text) {
    return new Promise((resolve) => {
      const cached = audioCache.get(text);
      if (cached && cached.ready === true) { resolve(true); return; }
      if (cached && cached.ready === false) { resolve(false); return; }
      tryNextDir(text, 0, resolve);
    });
  }

  function tryNextDir(text, dirIndex, resolve) {
    if (dirIndex >= AUDIO_DIRS.length) {
      audioCache.set(text, { ready: false, audio: null });
      resolve(false); return;
    }
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = AUDIO_DIRS[dirIndex] + AUDIO_PREFIX + text + '.mp3';
    let resolved = false;
    const onError = () => { if (resolved) return; resolved = true; tryNextDir(text, dirIndex + 1, resolve); };
    const onCanPlay = () => { if (resolved) return; resolved = true; audioCache.set(text, { ready: true, audio }); resolve(true); };
    audio.addEventListener('error', onError, { once: true });
    audio.addEventListener('canplaythrough', onCanPlay, { once: true });
    audio.addEventListener('loadeddata', onCanPlay, { once: true });
    setTimeout(() => { if (!resolved) { if (audio.readyState >= 2) onCanPlay(); else onError(); } }, 3000);
    try { audio.load(); } catch (e) { onError(); }
  }

  function playAndWait(audio, fallbackText, myToken) {
    return new Promise((resolve) => {
      if (myToken !== speechToken) { resolve(false); return; }
      if (currentPlayingAudio && currentPlayingAudio !== audio) {
        try { currentPlayingAudio.pause(); } catch (e) {}
      }
      currentPlayingAudio = audio;
      try {
        audio.currentTime = 0; audio.volume = 1;
        const onEnd = () => {
          audio.removeEventListener('ended', onEnd);
          audio.removeEventListener('error', onErr);
          if (currentPlayingAudio === audio) currentPlayingAudio = null;
          resolve(true);
        };
        const onErr = () => {
          audio.removeEventListener('ended', onEnd);
          audio.removeEventListener('error', onErr);
          if (currentPlayingAudio === audio) currentPlayingAudio = null;
          if (myToken !== speechToken) { resolve(false); return; }
          speakWithBrowser(fallbackText);
          setTimeout(() => resolve(true), 1000);
        };
        audio.addEventListener('ended', onEnd, { once: true });
        audio.addEventListener('error', onErr, { once: true });
        const p = audio.play();
        if (p && p.catch) {
          p.catch(() => {
            audio.removeEventListener('ended', onEnd);
            audio.removeEventListener('error', onErr);
            if (currentPlayingAudio === audio) currentPlayingAudio = null;
            if (myToken !== speechToken) { resolve(false); return; }
            speakWithBrowser(fallbackText);
            setTimeout(() => resolve(true), 1000);
          });
        }
      } catch (e) {
        if (currentPlayingAudio === audio) currentPlayingAudio = null;
        if (myToken !== speechToken) { resolve(false); return; }
        speakWithBrowser(fallbackText);
        setTimeout(() => resolve(true), 1000);
      }
    });
  }

  async function speakWord(word) {
    if (!word) return;
    stopCurrentAudio();
    const myToken = speechToken;
    const ok = await preloadAudio(word);
    if (myToken !== speechToken) return;
    if (!ok) { speakWithBrowser(word); return; }
    const c = audioCache.get(word);
    if (c && c.ready && c.audio) await playAndWait(c.audio, word, myToken);
    else if (myToken === speechToken) speakWithBrowser(word);
  }

  async function speakChar(char) {
    if (!char) return;
    stopCurrentAudio();
    const myToken = speechToken;
    const ok = await preloadAudio(char);
    if (myToken !== speechToken) return;
    if (!ok) {
      speakWithBrowser(char);
      await new Promise(r => setTimeout(r, 900));
      return;
    }
    const c = audioCache.get(char);
    if (c && c.ready && c.audio) await playAndWait(c.audio, char, myToken);
    else if (myToken === speechToken) {
      speakWithBrowser(char);
      await new Promise(r => setTimeout(r, 900));
    }
  }

  function speakChinese(text) {
    if (!text) return;
    if (/^\p{Script=Han}$/u.test(text)) speakChar(text);
    else speakWord(text);
  }

  window.speakChinese = speakChinese;
  window.speakWord = speakWord;
  window.speakChar = speakChar;
  window.preloadAudio = preloadAudio;
  window.stopCurrentAudio = stopCurrentAudio;

  // ============================================================
  // ДОСТУП К БАЗЕ
  // ============================================================
  function getDict() { return window.HSK_DICT || {}; }
  function getLevel(level) {
    return getDict()['hsk' + level] || { words: [], pinyin: {}, ru: {}, emoji: {}, example: {} };
  }
  function getLevels() { return [1, 2, 3, 4, 5, 6].filter(l => getDict()['hsk' + l]); }

  function findWordInfo(word) {
    for (const lvl of getLevels()) {
      const d = getLevel(lvl);
      if (d.words && d.words.includes(word)) {
        return {
          pinyin: d.pinyin[word] || '',
          meaning: d.ru[word] || '',
          emoji: d.emoji[word] || '',
          example: d.example[word] || '',
          level: lvl
        };
      }
    }
    return null;
  }

  function getCharMeaning(char) {
    const direct = findWordInfo(char);
    if (direct && direct.meaning) return direct.meaning;
    // Проверяем список иероглифов HSK 6
    const d6c = getDict()['hsk6_chars'];
    if (d6c && d6c.ru && d6c.ru[char]) return d6c.ru[char];
    for (const lvl of getLevels()) {
      const d = getLevel(lvl);
      for (const w of d.words) {
        if (w.includes(char) && d.ru[w]) return d.ru[w];
      }
    }
    return '';
  }

  function getPinyin(char) {
    const direct = findWordInfo(char);
    if (direct && direct.pinyin) return direct.pinyin;
    const d6c = getDict()['hsk6_chars'];
    if (d6c && d6c.pinyin && d6c.pinyin[char]) return d6c.pinyin[char];
    try {
      if (window.pinyinPro && window.pinyinPro.pinyin) {
        return window.pinyinPro.pinyin(char, { toneType: 'symbol' });
      }
    } catch (e) {}
    return '';
  }

  // ============================================================
  // ПРОГРЕСС
  // ============================================================
  const Progress = {
    data: {},
    load() { try { const raw = localStorage.getItem(STORAGE_KEY); this.data = raw ? JSON.parse(raw) : {}; } catch (e) { this.data = {}; } },
    save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) {} },
    get(char) {
      if (!this.data[char]) {
        this.data[char] = { level: 0, successes: 0, attempts: 0, mistakes: 0, lastReview: 0, nextReview: 0, mastered: false };
      }
      return this.data[char];
    },
    recordSuccess(char, accuracy) {
      const p = this.get(char);
      p.attempts++; p.successes++; p.lastReview = Date.now();
      if (accuracy >= 90) p.level = Math.min(p.level + 1, REVIEW_INTERVALS.length - 1);
      p.nextReview = Date.now() + REVIEW_INTERVALS[p.level] * 86400000;
      if (p.level >= REVIEW_INTERVALS.length - 1 && p.successes >= 3) p.mastered = true;
      this.save();
    },
    recordMistake(char, mistakeCount) {
      const p = this.get(char);
      p.attempts++; p.mistakes += mistakeCount; p.successes = 0;
      p.level = Math.max(0, p.level - 1); p.lastReview = Date.now();
      p.nextReview = Date.now() + 86400000; p.mastered = false;
      this.save();
    },
    getStats() {
      const chars = Object.keys(this.data);
      const mastered = chars.filter(c => this.data[c].mastered).length;
      const now = Date.now();
      const dueCount = chars.filter(c => this.data[c].attempts > 0 && this.data[c].nextReview <= now && !this.data[c].mastered).length;
      let totalAttempts = 0, totalMistakes = 0;
      chars.forEach(c => { totalAttempts += this.data[c].attempts; totalMistakes += this.data[c].mistakes; });
      const accuracy = totalAttempts === 0 ? 0 : Math.max(0, Math.min(100, Math.round((1 - totalMistakes / (totalAttempts * 5)) * 100)));
      return { total: chars.length, mastered, dueCount, accuracy, streak: this.getStreak() };
    },
    getStreak() {
      const days = new Set();
      Object.values(this.data).forEach(p => { if (p.lastReview) days.add(new Date(p.lastReview).toISOString().slice(0, 10)); });
      const sorted = [...days].sort().reverse();
      if (sorted.length === 0) return 0;
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (sorted[0] !== today && sorted[0] !== yesterday) return 0;
      let streak = 1;
      for (let i = 1; i < sorted.length; i++) {
        const diff = (new Date(sorted[i - 1]) - new Date(sorted[i])) / 86400000;
        if (diff <= 1.5) streak++; else break;
      }
      return streak;
    },
    getDueForReview() {
      const now = Date.now();
      const due = []; const seen = new Set();
      for (const lvl of getLevels()) {
        getLevel(lvl).words.forEach(word => {
          [...word].forEach(char => {
            if (!/\p{Script=Han}/u.test(char) || seen.has(char)) return;
            const p = this.get(char);
            if (p.attempts > 0 && p.nextReview <= now && !p.mastered) {
              seen.add(char);
              due.push({ char, pinyin: getPinyin(char), meaning: getCharMeaning(char) });
            }
          });
        });
      }
      return due;
    },
    getWeakSpots() {
      const weak = []; const seen = new Set();
      for (const lvl of getLevels()) {
        getLevel(lvl).words.forEach(word => {
          [...word].forEach(char => {
            if (!/\p{Script=Han}/u.test(char) || seen.has(char)) return;
            const p = this.get(char);
            if (p.attempts >= 2 && p.mistakes > 0 && !p.mastered) {
              seen.add(char);
              weak.push({ char, pinyin: getPinyin(char), meaning: getCharMeaning(char), mistakes: p.mistakes });
            }
          });
        });
      }
      return weak.sort((a, b) => b.mistakes - a.mistakes);
    }
  };

  // ============================================================
  // ИЗБРАННОЕ
  // ============================================================
  const Favorites = {
    set: new Set(),
    load() { try { const raw = localStorage.getItem(FAV_KEY); this.set = new Set(raw ? JSON.parse(raw) : []); } catch (e) { this.set = new Set(); } },
    save() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...this.set])); } catch (e) {} },
    has(char) { return this.set.has(char); },
    toggle(char) {
      if (this.set.has(char)) this.set.delete(char);
      else this.set.add(char);
      this.save();
      return this.set.has(char);
    }
  };

  // ============================================================
  // УТИЛИТЫ
  // ============================================================
  function getExamples(char) {
    const examples = []; const seen = new Set();
    for (const lvl of getLevels()) {
      const d = getLevel(lvl);
      d.words.forEach(word => {
        if (word.includes(char) && !seen.has(word) && examples.length < 30) {
          seen.add(word);
          examples.push({
            word,
            pinyin: d.pinyin[word] || '',
            meaning: d.ru[word] || '',
            emoji: d.emoji[word] || '',
            example: d.example[word] || ''
          });
        }
      });
    }
    return examples.sort((a, b) => a.word.length - b.word.length);
  }

  function getCategoryChars(levelKey) {
    if (levelKey === 'chars') {
      const d = getDict()['hsk6_chars'];
      return d && d.words ? [...d.words] : [];
    }
    const lvl = parseInt(levelKey, 10);
    const d = getLevel(lvl);
    const chars = new Set();
    d.words.forEach(word => { [...word].forEach(ch => { if (/\p{Script=Han}/u.test(ch)) chars.add(ch); }); });
    return [...chars];
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ============================================================
  // СОСТОЯНИЕ
  // ============================================================
  let currentItems = [];
  let currentIndex = 0;
  let currentMode = '1';
  let score = 0;
  let combo = 0;
  let currentStrokesTotal = 0;
  let currentStrokesCorrect = 0;
  let hwWriter = null;
  let isShowingHint = false;
  let dom = {};

  let markerCtx = null;
  let isDrawing = false;
  let markerActive = false;
  let lastX = 0, lastY = 0;

  let autoplayActive = false;
  let autoplayCancelToken = 0;
  let autoplayDelayTimer = null;

  // Карточки
  let cardsLevel = '1';
  let cardsQuery = '';

  function cacheDom() {
    dom = {
      char: document.getElementById('charDisplay'),
      pinyin: document.getElementById('pinyinDisplay'),
      meaning: document.getElementById('meaningDisplay'),
      status: document.getElementById('charStatus'),
      canvasWrap: document.getElementById('canvasWrap'),
      hw: document.getElementById('hw-container'),
      markerCanvas: document.getElementById('marker-canvas'),
      markerToggle: document.getElementById('markerToggle'),
      clearMarkerBtn: document.getElementById('clearMarkerBtn'),
      autoplayBtn: document.getElementById('autoplayBtn'),
      autoplayIndicator: document.getElementById('autoplayIndicator'),
      autoplayProgress: document.getElementById('autoplayProgress'),
      progress: document.getElementById('progressFill'),
      score: document.getElementById('scoreDisplay'),
      accuracy: document.getElementById('accuracyDisplay'),
      combo: document.getElementById('comboDisplay'),
      instruction: document.getElementById('instructionText'),
      streak: document.getElementById('streakDisplay'),
      category: document.getElementById('categoryDisplay'),
      hintBtn: document.getElementById('hintBtn'),
      nextBtn: document.getElementById('nextBtn'),
      examplesBtn: document.getElementById('examplesBtn'),
      floating: document.getElementById('floatingText'),
      miniStats: document.getElementById('miniStats'),
      examplesModal: document.getElementById('examplesModal'),
      examplesChar: document.getElementById('examplesChar'),
      examplesPinyin: document.getElementById('examplesPinyin'),
      examplesMeaning: document.getElementById('examplesMeaning'),
      examplesList: document.getElementById('examplesList'),
      examplesClose: document.getElementById('examplesClose'),
      viewTrainer: document.getElementById('viewTrainer'),
      viewCards: document.getElementById('viewCards'),
      tabTrainer: document.getElementById('tabTrainer'),
      tabCards: document.getElementById('tabCards'),
      cardsSearchBox: document.getElementById('cardsSearchBox'),
      cardsSearchInput: document.getElementById('cardsSearchInput'),
      cardsSearchClear: document.getElementById('cardsSearchClear'),
      levelTabs: document.getElementById('levelTabs'),
      cardsGrid: document.getElementById('cardsGrid'),
      cardsInfo: document.getElementById('cardsInfo'),
      ccModal: document.getElementById('charCardModal'),
      ccChar: document.getElementById('ccChar'),
      ccPinyin: document.getElementById('ccPinyin'),
      ccMeaning: document.getElementById('ccMeaning'),
      ccFavBtn: document.getElementById('ccFavBtn'),
      ccSpeakBtn: document.getElementById('ccSpeakBtn'),
      ccTrainBtn: document.getElementById('ccTrainBtn'),
      ccWords: document.getElementById('ccWords'),
      ccWordsTitle: document.getElementById('ccWordsTitle'),
      ccClose: document.getElementById('ccClose')
    };
  }

  // ============================================================
  // МАРКЕР
  // ============================================================
  const MARKER_COLOR = '#dc2626';
  const MARKER_WIDTH = 14;
  const MARKER_OUTLINE_COLOR = 'rgba(255,255,255,0.95)';
  const MARKER_OUTLINE_WIDTH = 20;

  function initMarkerCanvas() {
    if (!dom.markerCanvas) return;
    resizeMarkerCanvas();
    markerCtx = dom.markerCanvas.getContext('2d');
    const canvas = dom.markerCanvas;

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      let clientX, clientY;
      if (e.touches && e.touches[0]) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
      else if (e.changedTouches && e.changedTouches[0]) { clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY; }
      else { clientX = e.clientX; clientY = e.clientY; }
      return { x: (clientX - rect.left) * (canvas.width / rect.width), y: (clientY - rect.top) * (canvas.height / rect.height) };
    }
    function drawSegment(x1, y1, x2, y2) {
      markerCtx.strokeStyle = MARKER_OUTLINE_COLOR;
      markerCtx.lineWidth = MARKER_OUTLINE_WIDTH;
      markerCtx.lineCap = 'round'; markerCtx.lineJoin = 'round';
      markerCtx.beginPath(); markerCtx.moveTo(x1, y1); markerCtx.lineTo(x2, y2); markerCtx.stroke();
      markerCtx.strokeStyle = MARKER_COLOR;
      markerCtx.lineWidth = MARKER_WIDTH;
      markerCtx.beginPath(); markerCtx.moveTo(x1, y1); markerCtx.lineTo(x2, y2); markerCtx.stroke();
    }
    function startDraw(e) {
      if (!markerActive) return; e.preventDefault(); isDrawing = true;
      const pos = getPos(e); lastX = pos.x; lastY = pos.y;
      drawSegment(pos.x, pos.y, pos.x + 0.1, pos.y + 0.1);
    }
    function moveDraw(e) {
      if (!markerActive || !isDrawing) return; e.preventDefault();
      const pos = getPos(e); drawSegment(lastX, lastY, pos.x, pos.y);
      lastX = pos.x; lastY = pos.y;
    }
    function endDraw() { if (!markerActive) return; isDrawing = false; }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw);
    canvas.addEventListener('touchcancel', endDraw);
  }

  function resizeMarkerCanvas() {
    if (!dom.markerCanvas) return;
    const rect = dom.markerCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dom.markerCanvas.width = Math.max(1, rect.width * dpr);
    dom.markerCanvas.height = Math.max(1, rect.height * dpr);
    if (markerCtx) { markerCtx.setTransform(dpr, 0, 0, dpr, 0, 0); markerCtx.lineCap = 'round'; markerCtx.lineJoin = 'round'; }
  }

  function clearMarker() {
    if (!markerCtx || !dom.markerCanvas) return;
    markerCtx.save(); markerCtx.setTransform(1, 0, 0, 1, 0, 0);
    markerCtx.clearRect(0, 0, dom.markerCanvas.width, dom.markerCanvas.height);
    markerCtx.restore();
  }

  function toggleMarker() {
    markerActive = !markerActive;
    if (dom.markerCanvas) dom.markerCanvas.classList.toggle('active', markerActive);
    if (dom.markerToggle) {
      dom.markerToggle.classList.toggle('active', markerActive);
      dom.markerToggle.innerHTML = markerActive ? '🖊️ Маркер ВКЛ' : '🖊️ Маркер';
    }
    if (dom.instruction) {
      if (markerActive) { dom.instruction.textContent = '🖊️ Маркер включён — рисуйте поверх иероглифа'; dom.instruction.style.color = '#92400e'; }
      else { dom.instruction.textContent = '✍️ Обведите иероглиф по порядку черт'; dom.instruction.style.color = '#6b7280'; }
    }
  }

  // ============================================================
  // UI (тренажёр)
  // ============================================================
  function updateProgress(percent) { if (dom.progress) dom.progress.style.width = Math.min(percent, 100) + '%'; }
  function updateUI() {
    if (dom.score) dom.score.textContent = score;
    if (dom.combo) dom.combo.textContent = combo >= 2 ? '🔥 x' + combo : '';
  }
  function updateCharStatus() {
    if (currentItems.length === 0 || !dom.status) return;
    const data = currentItems[currentIndex];
    const p = Progress.get(data.char);
    dom.status.classList.remove('new', 'learning', 'due', 'mastered');
    if (p.mastered) { dom.status.classList.add('mastered'); dom.status.textContent = '✓ ВЫУЧЕН'; }
    else if (p.attempts > 0 && p.nextReview <= Date.now()) { dom.status.classList.add('due'); dom.status.textContent = '🔄 ПОВТОРИТЬ'; }
    else if (p.attempts > 0) { dom.status.classList.add('learning'); dom.status.textContent = '📖 ИЗУЧАЕМ'; }
    else { dom.status.classList.add('new'); dom.status.textContent = '✨ НОВЫЙ'; }
  }
  function updateStats() {
    const stats = Progress.getStats();
    if (dom.streak) dom.streak.textContent = '🔥 ' + stats.streak + ' дней';
    if (dom.accuracy) dom.accuracy.textContent = stats.accuracy + '%';
    if (dom.miniStats) dom.miniStats.textContent = '🎯 ' + stats.accuracy + '%';
  }
  function showFloating(text) {
    if (!dom.floating) return;
    dom.floating.textContent = text;
    dom.floating.classList.remove('show');
    void dom.floating.offsetWidth;
    dom.floating.classList.add('show');
  }
  function shake() {
    if (!dom.canvasWrap) return;
    dom.canvasWrap.classList.add('shake');
    setTimeout(() => dom.canvasWrap.classList.remove('shake'), 400);
  }

  // ============================================================
  // ЗАГРУЗКА ИЕРОГЛИФА (тренажёр)
  // ============================================================
  function loadCharacter(index, opts) {
    opts = opts || {};
    if (currentItems.length === 0 || !dom.hw) return;
    const data = currentItems[index];
    dom.char.textContent = data.char;
    dom.pinyin.textContent = data.pinyin || getPinyin(data.char);
    dom.meaning.textContent = data.meaning || getCharMeaning(data.char);
    currentStrokesCorrect = 0;
    isShowingHint = false;
    updateProgress(0);
    updateCharStatus();
    clearMarker();

    if (data.char) preloadAudio(data.char);

    if (!opts.silent && dom.instruction) {
      dom.instruction.textContent = markerActive
        ? '🖊️ Маркер включён — рисуйте поверх иероглифа'
        : '✍️ Обведите иероглиф по порядку черт';
      dom.instruction.style.color = markerActive ? '#92400e' : '#6b7280';
    }

    dom.hw.innerHTML = '';
    const size = Math.min(dom.hw.clientWidth, dom.hw.clientHeight) || 300;

    hwWriter = HanziWriter.create(dom.hw, data.char, {
      width: size, height: size, padding: 15,
      showOutline: true, strokeAnimationSpeed: 1.2, delayBetweenStrokes: 500,
      drawingWidth: Math.max(15, size * 0.06),
      showCharacter: false,
      highlightColor: '#d92d20', outlineColor: '#d9e0ea', drawingColor: '#1a1f2b',
      showHintAfterMisses: 1, highlightOnComplete: true
    });

    hwWriter.getCharacterData().then(function (charData) {
      currentStrokesTotal = charData.strokes.length;
      updateProgress(0);
    });

    hwWriter.quiz({
      onCorrectStroke: function (strokeData) {
        if (isShowingHint) return;
        currentStrokesCorrect = strokeData.strokeNum;
        combo++;
        score += 10 * combo;
        updateUI();
        updateProgress((currentStrokesCorrect / currentStrokesTotal) * 100);
        if (combo >= 3) showFloating('🔥 x' + combo);
      },
      onMistake: function () {
        if (isShowingHint) return;
        combo = 0;
        updateUI();
        shake();
        if (dom.instruction) { dom.instruction.textContent = '⚠️ Ошибка! Смотрите на подсказку'; dom.instruction.style.color = '#d92d20'; }
      },
      onComplete: function (summaryData) {
        if (isShowingHint) return;
        if (autoplayActive) return;
        score += 100;
        const accuracy = summaryData.totalMistakes === 0 ? 100 :
          Math.max(0, Math.round((1 - summaryData.totalMistakes / currentStrokesTotal) * 100));
        if (summaryData.totalMistakes === 0) Progress.recordSuccess(data.char, accuracy);
        else Progress.recordMistake(data.char, summaryData.totalMistakes);
        updateCharStatus();
        updateStats();
        if (dom.instruction) {
          dom.instruction.textContent = accuracy === 100 ?
            '💯 Идеально! Загрузка следующего...' : '✅ Готово! (' + accuracy + '%)';
          dom.instruction.style.color = '#16835f';
        }
        showFloating(accuracy === 100 ? '💯 Идеально!' : '✅ Готово!');
        setTimeout(function () { nextCharacter(); }, 2000);
      }
    });
  }

  function nextCharacter() {
    if (currentItems.length === 0) return;
    currentIndex = (currentIndex + 1) % currentItems.length;
    loadCharacter(currentIndex);
  }

  // ============================================================
  // ПОДСКАЗКА
  // ============================================================
  async function showHint() {
    if (!hwWriter || isShowingHint) return;
    if (currentItems.length === 0) return;
    isShowingHint = true;
    const char = currentItems[currentIndex].char;
    if (dom.instruction) dom.instruction.textContent = '👀 Загрузка озвучки...';
    await preloadAudio(char);
    if (dom.instruction) {
      dom.instruction.textContent = '👀 Смотрите анимацию и слушайте...';
      dom.instruction.style.color = '#8a4a2a';
    }
    const speech = speakChar(char);
    const anim = new Promise((resolve) => { hwWriter.animateCharacter({ onComplete: () => resolve() }); });
    await Promise.all([speech, anim]);
    setTimeout(function () { isShowingHint = false; loadCharacter(currentIndex); }, 400);
  }

  // ============================================================
  // АВТОПЛЕЙ
  // ============================================================
  async function buildPlaylist(token, fromIndex) {
    const playlist = [];
    const total = Math.min(AUTOPLAY_PLAYLIST_SIZE, currentItems.length);
    for (let i = 0; i < total; i++) {
      if (!autoplayActive || token !== autoplayCancelToken) return null;
      const idx = (fromIndex + i) % currentItems.length;
      const ch = currentItems[idx].char;
      if (dom.autoplayProgress) dom.autoplayProgress.textContent = 'Загрузка ' + (i + 1) + ' / ' + total;
      const ok = await preloadAudio(ch);
      let audio = null;
      if (ok) { const c = audioCache.get(ch); if (c && c.ready && c.audio) audio = c.audio; }
      playlist.push({
        char: ch, index: idx,
        pinyin: currentItems[idx].pinyin,
        meaning: currentItems[idx].meaning,
        audio, hasMp3: !!audio
      });
    }
    return playlist;
  }

  function prefetchNextPlaylist(token, nextStartIndex) {
    const total = Math.min(AUTOPLAY_PLAYLIST_SIZE, currentItems.length);
    for (let i = 0; i < total; i++) {
      if (!autoplayActive || token !== autoplayCancelToken) return;
      const idx = (nextStartIndex + i) % currentItems.length;
      const ch = currentItems[idx].char;
      if (ch) preloadAudio(ch).catch(() => {});
    }
  }

  async function startAutoplay() {
    if (autoplayActive) { stopAutoplay(); return; }
    if (currentItems.length === 0) return;
    autoplayActive = true;
    autoplayCancelToken++;
    const myToken = autoplayCancelToken;
    if (dom.autoplayBtn) { dom.autoplayBtn.classList.add('active'); dom.autoplayBtn.innerHTML = '⏸️ Стоп'; }
    if (dom.autoplayIndicator) dom.autoplayIndicator.classList.add('active');
    if (dom.instruction) { dom.instruction.textContent = '⏳ Подготовка плейлиста...'; dom.instruction.style.color = '#2563eb'; }
    const firstPlaylist = await buildPlaylist(myToken, currentIndex);
    if (!firstPlaylist || !autoplayActive || myToken !== autoplayCancelToken) return;
    if (firstPlaylist[0] && firstPlaylist[0].audio) {
      try {
        firstPlaylist[0].audio.currentTime = 0;
        const p = firstPlaylist[0].audio.play();
        if (p && p.catch) p.catch(() => {});
        setTimeout(() => { try { firstPlaylist[0].audio.pause(); } catch (e) {} }, 200);
      } catch (e) {}
    }
    autoplayRunAll(myToken, firstPlaylist, currentIndex);
  }

  async function autoplayRunAll(token, firstPlaylist, firstStartIndex) {
    let playlist = firstPlaylist;
    let startIndex = firstStartIndex;
    let roundPassed = 0;
    while (autoplayActive && token === autoplayCancelToken) {
      if (!playlist || playlist.length === 0) break;
      const nextStartIndex = (startIndex + playlist.length) % currentItems.length;
      prefetchNextPlaylist(token, nextStartIndex);
      await autoplayLoopFromPlaylist(token, playlist);
      if (!autoplayActive || token !== autoplayCancelToken) return;
      roundPassed += playlist.length;
      if (roundPassed >= currentItems.length) {
        autoplayActive = false;
        if (dom.autoplayBtn) { dom.autoplayBtn.classList.remove('active'); dom.autoplayBtn.innerHTML = '▶️ Авто'; }
        if (dom.autoplayIndicator) dom.autoplayIndicator.classList.remove('active');
        showFloating('🎉 Всё озвучено!');
        if (dom.instruction) { dom.instruction.textContent = '🎉 Автоплей завершён — все ' + currentItems.length + ' знаков'; dom.instruction.style.color = '#16835f'; }
        loadCharacter(currentIndex, { silent: true });
        return;
      }
      await new Promise(r => { autoplayDelayTimer = setTimeout(r, 300); });
      if (!autoplayActive || token !== autoplayCancelToken) return;
      const nextPlaylist = await buildPlaylist(token, nextStartIndex);
      if (!nextPlaylist) return;
      playlist = nextPlaylist;
      startIndex = nextStartIndex;
    }
  }

  function stopAutoplay() {
    stopCurrentAudio();
    autoplayActive = false;
    autoplayCancelToken++;
    if (autoplayDelayTimer) { clearTimeout(autoplayDelayTimer); autoplayDelayTimer = null; }
    if (dom.autoplayBtn) { dom.autoplayBtn.classList.remove('active'); dom.autoplayBtn.innerHTML = '▶️ Авто'; }
    if (dom.autoplayIndicator) dom.autoplayIndicator.classList.remove('active');
    if (hwWriter && currentItems.length > 0) {
      try { hwWriter.cancelQuiz(); } catch (e) {}
      loadCharacter(currentIndex, { silent: true });
    }
  }

  async function autoplayLoopFromPlaylist(token, playlist) {
    for (let plIndex = 0; plIndex < playlist.length; plIndex++) {
      if (!autoplayActive || token !== autoplayCancelToken) return;
      const item = playlist[plIndex];
      const data = { char: item.char, pinyin: item.pinyin, meaning: item.meaning };
      if (dom.autoplayProgress) dom.autoplayProgress.textContent = (plIndex + 1) + ' / ' + playlist.length;
      dom.char.textContent = data.char;
      dom.pinyin.textContent = data.pinyin || getPinyin(data.char);
      dom.meaning.textContent = data.meaning || getCharMeaning(data.char);
      updateCharStatus();
      clearMarker();
      dom.hw.innerHTML = '';
      const size = Math.min(dom.hw.clientWidth, dom.hw.clientHeight) || 300;
      try {
        hwWriter = HanziWriter.create(dom.hw, data.char, {
          width: size, height: size, padding: 15,
          showOutline: true, strokeAnimationSpeed: 0.7, delayBetweenStrokes: 500,
          drawingWidth: Math.max(15, size * 0.06),
          showCharacter: false,
          highlightColor: '#d92d20', outlineColor: '#d9e0ea', drawingColor: '#1a1f2b'
        });
      } catch (e) { console.warn('Autoplay writer', e); return; }
      if (dom.instruction) { dom.instruction.textContent = '▶️ Автоплей (' + (plIndex + 1) + '/' + playlist.length + ')'; dom.instruction.style.color = '#2563eb'; }
      await new Promise(r => { autoplayDelayTimer = setTimeout(r, 400); });
      if (!autoplayActive || token !== autoplayCancelToken) return;
      const speech = (async () => {
        if (item.hasMp3 && item.audio) {
          try {
            item.audio.currentTime = 0; item.audio.volume = 1;
            await new Promise((resolve) => {
              const onEnd = () => { item.audio.removeEventListener('ended', onEnd); item.audio.removeEventListener('error', onErr); resolve(); };
              const onErr = () => { item.audio.removeEventListener('ended', onEnd); item.audio.removeEventListener('error', onErr); speakWithBrowser(item.char); setTimeout(resolve, 900); };
              item.audio.addEventListener('ended', onEnd, { once: true });
              item.audio.addEventListener('error', onErr, { once: true });
              const p = item.audio.play();
              if (p && p.catch) { p.catch(() => { item.audio.removeEventListener('ended', onEnd); item.audio.removeEventListener('error', onErr); speakWithBrowser(item.char); setTimeout(resolve, 900); }); }
            });
          } catch (e) { speakWithBrowser(item.char); await new Promise(r => setTimeout(r, 900)); }
        } else {
          speakWithBrowser(item.char);
          await new Promise(r => setTimeout(r, 900));
        }
      })();
      const anim = new Promise((resolve) => { hwWriter.animateCharacter({ onComplete: () => resolve() }); });
      await Promise.all([speech, anim]);
      if (!autoplayActive || token !== autoplayCancelToken) return;
      await new Promise(r => { autoplayDelayTimer = setTimeout(r, 800); });
      if (!autoplayActive || token !== autoplayCancelToken) return;
    }
  }

  // ============================================================
  // ПРИМЕРЫ (модалка)
  // ============================================================
  function showExamples() {
    if (currentItems.length === 0) return;
    const data = currentItems[currentIndex];
    const p = Progress.get(data.char);
    if (dom.examplesChar) dom.examplesChar.textContent = data.char;
    if (dom.examplesPinyin) dom.examplesPinyin.textContent = data.pinyin || getPinyin(data.char);
    if (dom.examplesMeaning) dom.examplesMeaning.textContent = data.meaning || getCharMeaning(data.char);
    if (dom.examplesList) {
      dom.examplesList.innerHTML = '';
      const stars = Math.min(5, Math.floor(p.level / 2));
      let starsHtml = '';
      for (let i = 1; i <= 5; i++) starsHtml += i <= stars ? '<span style="color:#d4a840;">★</span>' : '<span style="color:#d9e0ea;">☆</span>';
      const block = document.createElement('div');
      block.className = 'progress-block';
      block.innerHTML = '<div class="progress-stars">' + starsHtml + '</div>' +
        '<div class="progress-info">' + (p.mastered ? '🎉 Выучен!' : 'Попыток: ' + p.attempts + ' · Ошибок: ' + p.mistakes) + '</div>';
      dom.examplesList.appendChild(block);
      const examples = getExamples(data.char);
      if (examples.length > 0) {
        const header = document.createElement('div');
        header.style.cssText = 'font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;margin:8px 0 4px;';
        header.textContent = '📖 Слова с этим иероглифом (' + examples.length + '):';
        dom.examplesList.appendChild(header);
        examples.forEach(ex => {
          const item = document.createElement('div');
          item.className = 'example-item';
          item.innerHTML =
            '<div class="example-word">' + (ex.emoji ? ex.emoji + ' ' : '') + ex.word + '</div>' +
            '<div class="example-info">' +
              '<div class="example-pinyin">' + (ex.pinyin || '') + '</div>' +
              (ex.meaning ? '<div class="example-meaning">' + ex.meaning + '</div>' : '') +
            '</div>' +
            '<div style="font-size:20px;opacity:0.5;">🔊</div>';
          item.addEventListener('click', function () { speakWord(ex.word); });
          dom.examplesList.appendChild(item);
          if (ex.example) {
            const exLine = document.createElement('div');
            exLine.className = 'example-sentence';
            exLine.textContent = ex.example;
            dom.examplesList.appendChild(exLine);
          }
        });
      } else {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center;padding:20px;color:#6b7280;font-size:13px;';
        empty.textContent = 'Нет примеров слов';
        dom.examplesList.appendChild(empty);
      }
    }
    if (dom.examplesModal) dom.examplesModal.classList.add('show');
  }

  // ============================================================
  // РЕЖИМЫ ТРЕНАЖЁРА
  // ============================================================
  function loadCategory(level) {
    stopAutoplay();
    const chars = getCategoryChars(level);
    if (chars.length === 0) {
      currentItems = [];
      if (dom.instruction) dom.instruction.textContent = '⚠️ HSK ' + level + ': нет данных в базе';
      return;
    }
    currentItems = shuffle(chars).map(char => ({ char, pinyin: getPinyin(char), meaning: getCharMeaning(char) }));
    currentIndex = 0;
    score = 0; combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = 'HSK ' + level + ' · ' + chars.length + ' знаков';
    loadCharacter(0);
    updateStats();
  }

  function loadCharsCategory() {
    stopAutoplay();
    const chars = getCategoryChars('chars');
    if (chars.length === 0) {
      currentItems = [];
      if (dom.instruction) dom.instruction.textContent = '⚠️ Иероглифы HSK 6 не загружены';
      return;
    }
    currentItems = shuffle(chars).map(char => ({ char, pinyin: getPinyin(char), meaning: getCharMeaning(char) }));
    currentIndex = 0;
    score = 0; combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = '字 · ' + chars.length + ' иероглифов';
    loadCharacter(0);
    updateStats();
  }

  function startDueReview() {
    stopAutoplay();
    const due = Progress.getDueForReview();
    if (due.length === 0) {
      showFloating('🎉 Всё повторено!');
      if (dom.instruction) { dom.instruction.textContent = '🎉 Нет иероглифов для повторения'; dom.instruction.style.color = '#16835f'; }
      return false;
    }
    currentItems = due;
    currentIndex = 0; score = 0; combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = '🔄 Повторение · ' + due.length;
    loadCharacter(0);
    updateStats();
    return true;
  }

  function startWeakSpots() {
    stopAutoplay();
    const weak = Progress.getWeakSpots();
    if (weak.length === 0) {
      showFloating('✨ Нет слабых мест!');
      if (dom.instruction) { dom.instruction.textContent = '✨ Слабых мест пока нет'; dom.instruction.style.color = '#16835f'; }
      return false;
    }
    currentItems = weak;
    currentIndex = 0; score = 0; combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = '🎯 Слабые места · ' + weak.length;
    loadCharacter(0);
    updateStats();
    return true;
  }

  function trainSingleChar(char) {
    stopAutoplay();
    const pinyin = getPinyin(char);
    const meaning = getCharMeaning(char);
    currentItems = [{ char, pinyin, meaning }];
    currentIndex = 0; score = 0; combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = '🎯 Тренировка: ' + char;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    loadCharacter(0);
    updateStats();
  }

  function setActiveMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function switchMode(mode) {
    setActiveMode(mode);
    if (mode === 'due') startDueReview();
    else if (mode === 'weak') startWeakSpots();
    else if (mode === 'chars') loadCharsCategory();
    else {
      const lvl = parseInt(mode, 10);
      if (lvl >= 1 && lvl <= 6) loadCategory(lvl);
    }
  }

  // ============================================================
  // ВКЛАДКИ
  // ============================================================
  function showView(view) {
    if (view === 'trainer') {
      dom.viewTrainer.classList.remove('hidden');
      dom.viewCards.classList.add('hidden');
      dom.tabTrainer.classList.add('active');
      dom.tabCards.classList.remove('active');
    } else {
      dom.viewTrainer.classList.add('hidden');
      dom.viewCards.classList.remove('hidden');
      dom.tabTrainer.classList.remove('active');
      dom.tabCards.classList.add('active');
      renderCards();
    }
  }

  // ============================================================
  // КАРТОЧКИ
  // ============================================================
  function getCharsForLevel(levelKey) {
    if (levelKey === 'fav') return [...Favorites.set];
    if (levelKey === 'chars') return getCategoryChars('chars');
    const lvl = parseInt(levelKey, 10);
    if (!lvl) return [];
    return getCategoryChars(lvl);
  }

  function normalizeQuery(q) {
    return String(q || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s，。；、！？：:“”"'‘’（）()【】\[\]…·/|+—–-]/g, '');
  }

  function renderCards() {
    if (!dom.cardsGrid) return;
    let chars = getCharsForLevel(cardsLevel);

    const q = cardsQuery.trim();
    if (q) {
      const nq = normalizeQuery(q);
      const raw = q;
      const isCJK = /[\u3400-\u9fff]/.test(raw);
      chars = chars.filter(ch => {
        if (isCJK && ch.includes(raw)) return true;
        const py = getPinyin(ch);
        if (py && normalizeQuery(py).includes(nq)) return true;
        const meaning = getCharMeaning(ch);
        if (meaning && normalizeQuery(meaning).includes(nq)) return true;
        return false;
      });
    }

    dom.cardsGrid.innerHTML = '';

    if (chars.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cards-empty';
      empty.textContent = cardsLevel === 'fav'
        ? '⭐ В избранном пока ничего нет'
        : 'Ничего не найдено';
      dom.cardsGrid.appendChild(empty);
      if (dom.cardsInfo) dom.cardsInfo.textContent = '';
      return;
    }

    const frag = document.createDocumentFragment();
    chars.forEach(ch => {
      const tile = document.createElement('div');
      tile.className = 'card-tile';
      const fav = Favorites.has(ch);
      if (fav) tile.classList.add('favorite');
      tile.innerHTML =
        '<span class="tile-fav' + (fav ? ' active' : '') + '">' + (fav ? '⭐' : '☆') + '</span>' +
        '<span class="tile-char">' + ch + '</span>';
      tile.addEventListener('click', (e) => {
        if (e.target.classList.contains('tile-fav')) {
          e.stopPropagation();
          Favorites.toggle(ch);
          renderCards();
          return;
        }
        openCharCard(ch);
      });
      frag.appendChild(tile);
    });
    dom.cardsGrid.appendChild(frag);

    if (dom.cardsInfo) {
      let info = chars.length + ' иероглифов';
      if (cardsLevel === 'fav') info += ' в избранном';
      else if (cardsLevel === 'chars') info += ' · HSK 6 · иероглифы';
      else info += ' · HSK ' + cardsLevel;
      if (q) info += ' · фильтр: "' + q + '"';
      dom.cardsInfo.textContent = info;
    }
  }

  // ============================================================
  // МОДАЛКА КАРТОЧКИ ИЕРОГЛИФА
  // ============================================================
  function openCharCard(char) {
    if (!dom.ccModal) return;
    dom.ccChar.textContent = char;
    dom.ccPinyin.textContent = getPinyin(char);
    dom.ccMeaning.textContent = getCharMeaning(char);

    const fav = Favorites.has(char);
    dom.ccFavBtn.textContent = fav ? '⭐' : '☆';
    dom.ccFavBtn.classList.toggle('active', fav);
    dom.ccFavBtn.dataset.char = char;

    dom.ccSpeakBtn.dataset.char = char;
    dom.ccTrainBtn.dataset.char = char;

    const words = getExamples(char);
    dom.ccWords.innerHTML = '';
    dom.ccWordsTitle.textContent = '📖 Слова с этим иероглифом (' + words.length + '):';

    if (words.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:20px;color:#8fa3bb;font-size:13px;';
      empty.textContent = 'Нет слов с этим иероглифом в базе';
      dom.ccWords.appendChild(empty);
    } else {
      words.forEach(ex => {
        const item = document.createElement('div');
        item.className = 'cc-word';
        item.innerHTML =
          '<div class="cc-word-char">' + ex.word + '</div>' +
          '<div class="cc-word-info">' +
            '<div class="cc-word-pinyin">' + (ex.pinyin || '') + '</div>' +
            (ex.meaning ? '<div class="cc-word-meaning">' + ex.meaning + '</div>' : '') +
          '</div>' +
          '<div class="cc-word-speak">🔊</div>';
        item.addEventListener('click', function () {
          speakWord(ex.word);
          item.style.background = '#e6f4ef';
          setTimeout(() => { item.style.background = ''; }, 300);
        });
        dom.ccWords.appendChild(item);
      });
    }

    dom.ccModal.classList.add('show');
  }

  function closeCharCard() {
    if (dom.ccModal) dom.ccModal.classList.remove('show');
  }

  // ============================================================
  // INIT
  // ============================================================
  let initialized = false;

  function init() {
    if (initialized) return;
    cacheDom();
    if (!dom.hw) return;
    Progress.load();
    Favorites.load();

    if (dom.hintBtn) dom.hintBtn.addEventListener('click', () => { if (autoplayActive) stopAutoplay(); showHint(); });
    if (dom.nextBtn) dom.nextBtn.addEventListener('click', () => { if (autoplayActive) stopAutoplay(); nextCharacter(); });
    if (dom.examplesBtn) dom.examplesBtn.addEventListener('click', showExamples);
    if (dom.clearMarkerBtn) dom.clearMarkerBtn.addEventListener('click', () => { clearMarker(); showFloating('🧹 Очищено'); });
    if (dom.markerToggle) dom.markerToggle.addEventListener('click', toggleMarker);
    if (dom.autoplayBtn) dom.autoplayBtn.addEventListener('click', startAutoplay);

    if (dom.char) dom.char.addEventListener('click', () => {
      if (currentItems.length > 0) speakChar(currentItems[currentIndex].char);
    });

    if (dom.examplesClose) dom.examplesClose.addEventListener('click', () => dom.examplesModal.classList.remove('show'));
    if (dom.examplesModal) dom.examplesModal.addEventListener('click', (e) => {
      if (e.target === dom.examplesModal) dom.examplesModal.classList.remove('show');
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
    });

    if (dom.tabTrainer) dom.tabTrainer.addEventListener('click', () => showView('trainer'));
    if (dom.tabCards) dom.tabCards.addEventListener('click', () => showView('cards'));

    if (dom.cardsSearchInput) {
      let t = 0;
      dom.cardsSearchInput.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          cardsQuery = dom.cardsSearchInput.value;
          dom.cardsSearchBox.classList.toggle('has-value', !!cardsQuery.trim());
          renderCards();
        }, 180);
      });
    }
    if (dom.cardsSearchClear) {
      dom.cardsSearchClear.addEventListener('click', () => {
        dom.cardsSearchInput.value = '';
        cardsQuery = '';
        dom.cardsSearchBox.classList.remove('has-value');
        renderCards();
        dom.cardsSearchInput.focus();
      });
    }

    if (dom.levelTabs) {
      dom.levelTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-level]');
        if (!btn) return;
        dom.levelTabs.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        cardsLevel = btn.dataset.level;
        renderCards();
      });
    }

    if (dom.ccClose) dom.ccClose.addEventListener('click', closeCharCard);
    if (dom.ccModal) dom.ccModal.addEventListener('click', (e) => { if (e.target === dom.ccModal) closeCharCard(); });
    if (dom.ccChar) dom.ccChar.addEventListener('click', () => { const ch = dom.ccChar.textContent; if (ch) speakChar(ch); });
    if (dom.ccSpeakBtn) dom.ccSpeakBtn.addEventListener('click', (e) => { const ch = e.currentTarget.dataset.char; if (ch) speakChar(ch); });
    if (dom.ccFavBtn) dom.ccFavBtn.addEventListener('click', (e) => {
      const ch = e.currentTarget.dataset.char;
      if (!ch) return;
      Favorites.toggle(ch);
      const isFav = Favorites.has(ch);
      e.currentTarget.textContent = isFav ? '⭐' : '☆';
      e.currentTarget.classList.toggle('active', isFav);
      renderCards();
    });
    if (dom.ccTrainBtn) dom.ccTrainBtn.addEventListener('click', (e) => {
      const ch = e.currentTarget.dataset.char;
      if (!ch) return;
      closeCharCard();
      showView('trainer');
      trainSingleChar(ch);
    });

    initMarkerCanvas();

    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        resizeMarkerCanvas();
        if (hwWriter && !isShowingHint && !autoplayActive && currentItems.length > 0) {
          loadCharacter(currentIndex, { silent: true });
        }
      }, 250);
    });

    const updateOnline = () => document.body.classList.toggle('offline', !navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
    }

    switchMode('1');
    setInterval(updateStats, 60000);

    window.addEventListener('beforeunload', () => { autoplayActive = false; autoplayCancelToken++; });

    initialized = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();