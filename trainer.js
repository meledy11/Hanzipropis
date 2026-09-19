/* trainer.js — Тренажёр каллиграфии с маркером и автоплеем
   Зависимости: dictionary-data.js (window.HSK_DICT), pinyinPro, HanziWriter
   Озвучка: ОДНА на иероглиф, MP3 из Audio/ с гарантированной предзагрузкой.
*/
(function () {
  'use strict';

  const STORAGE_KEY = 'hanzi_trainer_progress_v1';
  const REVIEW_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120];

  // ============================================================
  // ОЗВУЧКА — MP3 + предзагрузка + ожидание окончания
  // ============================================================
  const AUDIO_DIR = 'Audio/';
  const AUDIO_PREFIX = 'cmn-';
  const audioCache = new Map(); // text → { ready, audio }

  let zhVoice = null;
  function pickZhVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices() || [];
    zhVoice = voices.find(v => /zh[-_]?CN/i.test(v.lang))
           || voices.find(v => v.lang && v.lang.startsWith('zh'))
           || null;
  }
  if ('speechSynthesis' in window) {
    pickZhVoice();
    speechSynthesis.onvoiceschanged = pickZhVoice;
  }

  function speakWithBrowser(text) {
    if (!('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); } catch (e) {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.85;
    u.pitch = 1;
    u.volume = 1;
    if (zhVoice) u.voice = zhVoice;
    speechSynthesis.speak(u);
  }

  function audioPathFor(text) {
    return AUDIO_DIR + AUDIO_PREFIX + text + '.mp3';
  }

  // Предзагрузка — резолвится ТОЛЬКО когда файл готов играть
  function preloadAudio(text) {
    return new Promise((resolve) => {
      const cached = audioCache.get(text);
      if (cached && cached.ready === true) { resolve(true); return; }
      if (cached && cached.ready === false) { resolve(false); return; }

      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = audioPathFor(text);

      let resolved = false;
      const done = (ok) => {
        if (resolved) return;
        resolved = true;
        audioCache.set(text, { ready: ok, audio: ok ? audio : null });
        resolve(ok);
      };

      audio.addEventListener('canplaythrough', () => done(true), { once: true });
      audio.addEventListener('loadeddata', () => done(true), { once: true });
      audio.addEventListener('error', () => done(false), { once: true });

      setTimeout(() => {
        if (!resolved) {
          if (audio.readyState >= 2) done(true);
          else done(false);
        }
      }, 4000);

      try { audio.load(); } catch (e) { done(false); }
    });
  }

  // Проиграть MP3 и дождаться окончания. Если MP3 нет — браузер.
  function speakAndWait(text) {
    return new Promise((resolve) => {
      if (!text) { resolve(); return; }

      const cached = audioCache.get(text);

      if (cached && cached.ready && cached.audio) {
        const audio = cached.audio;
        try {
          audio.currentTime = 0;
          const onEnd = () => {
            audio.removeEventListener('ended', onEnd);
            audio.removeEventListener('error', onErr);
            resolve();
          };
          const onErr = () => {
            audio.removeEventListener('ended', onEnd);
            audio.removeEventListener('error', onErr);
            speakWithBrowser(text);
            setTimeout(resolve, 1000);
          };
          audio.addEventListener('ended', onEnd, { once: true });
          audio.addEventListener('error', onErr, { once: true });

          const p = audio.play();
          if (p && p.catch) {
            p.catch(() => {
              audio.removeEventListener('ended', onEnd);
              audio.removeEventListener('error', onErr);
              speakWithBrowser(text);
              setTimeout(resolve, 1000);
            });
          }
        } catch (e) {
          speakWithBrowser(text);
          setTimeout(resolve, 1000);
        }
        return;
      }

      // MP3 нет — загружаем и пробуем снова
      preloadAudio(text).then((ok) => {
        if (ok) {
          speakAndWait(text).then(resolve);
        } else {
          speakWithBrowser(text);
          setTimeout(resolve, 1000);
        }
      });
    });
  }

  // "Fire and forget" — не ждём
  function speakChinese(text) {
    preloadAudio(text).then(() => speakAndWait(text));
  }

  window.speakChinese = speakChinese;
  window.speakAndWait = speakAndWait;
  window.preloadAudio = preloadAudio;

  // ============================================================
  // ДОСТУП К БАЗЕ
  // ============================================================
  function getDict() { return window.HSK_DICT || {}; }
  function getLevel(level) {
    return getDict()['hsk' + level] || { words: [], pinyin: {}, ru: {}, emoji: {}, example: {} };
  }
  function getLevels() { return [1, 2, 3, 4, 5].filter(l => getDict()['hsk' + l]); }

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
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this.data = raw ? JSON.parse(raw) : {};
      } catch (e) { this.data = {}; }
    },
    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (e) {}
    },
    get(char) {
      if (!this.data[char]) {
        this.data[char] = {
          level: 0, successes: 0, attempts: 0, mistakes: 0,
          lastReview: 0, nextReview: 0, mastered: false
        };
      }
      return this.data[char];
    },
    recordSuccess(char, accuracy) {
      const p = this.get(char);
      p.attempts++;
      p.successes++;
      p.lastReview = Date.now();
      if (accuracy >= 90) p.level = Math.min(p.level + 1, REVIEW_INTERVALS.length - 1);
      const days = REVIEW_INTERVALS[p.level];
      p.nextReview = Date.now() + days * 86400000;
      if (p.level >= REVIEW_INTERVALS.length - 1 && p.successes >= 3) p.mastered = true;
      this.save();
    },
    recordMistake(char, mistakeCount) {
      const p = this.get(char);
      p.attempts++;
      p.mistakes += mistakeCount;
      p.successes = 0;
      p.level = Math.max(0, p.level - 1);
      p.lastReview = Date.now();
      p.nextReview = Date.now() + 86400000;
      p.mastered = false;
      this.save();
    },
    getStats() {
      const chars = Object.keys(this.data);
      const mastered = chars.filter(c => this.data[c].mastered).length;
      const now = Date.now();
      const dueCount = chars.filter(c =>
        this.data[c].attempts > 0 && this.data[c].nextReview <= now && !this.data[c].mastered
      ).length;
      let totalAttempts = 0, totalMistakes = 0;
      chars.forEach(c => {
        totalAttempts += this.data[c].attempts;
        totalMistakes += this.data[c].mistakes;
      });
      const accuracy = totalAttempts === 0 ? 0 :
        Math.max(0, Math.min(100, Math.round((1 - totalMistakes / (totalAttempts * 5)) * 100)));
      return { total: chars.length, mastered, dueCount, accuracy, streak: this.getStreak() };
    },
    getStreak() {
      const days = new Set();
      Object.values(this.data).forEach(p => {
        if (p.lastReview) days.add(new Date(p.lastReview).toISOString().slice(0, 10));
      });
      const sorted = [...days].sort().reverse();
      if (sorted.length === 0) return 0;
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (sorted[0] !== today && sorted[0] !== yesterday) return 0;
      let streak = 1;
      for (let i = 1; i < sorted.length; i++) {
        const diff = (new Date(sorted[i - 1]) - new Date(sorted[i])) / 86400000;
        if (diff <= 1.5) streak++;
        else break;
      }
      return streak;
    },
    getDueForReview() {
      const now = Date.now();
      const due = [];
      const seen = new Set();
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
      const weak = [];
      const seen = new Set();
      for (const lvl of getLevels()) {
        getLevel(lvl).words.forEach(word => {
          [...word].forEach(char => {
            if (!/\p{Script=Han}/u.test(char) || seen.has(char)) return;
            const p = this.get(char);
            if (p.attempts >= 2 && p.mistakes > 0 && !p.mastered) {
              seen.add(char);
              weak.push({
                char,
                pinyin: getPinyin(char),
                meaning: getCharMeaning(char),
                mistakes: p.mistakes
              });
            }
          });
        });
      }
      return weak.sort((a, b) => b.mistakes - a.mistakes);
    }
  };

  // ============================================================
  // УТИЛИТЫ
  // ============================================================
  function getExamples(char) {
    const examples = [];
    const seen = new Set();
    for (const lvl of getLevels()) {
      const d = getLevel(lvl);
      d.words.forEach(word => {
        if (word.includes(char) && !seen.has(word) && examples.length < 20) {
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

  function getCategoryChars(level) {
    const d = getLevel(level);
    const chars = new Set();
    d.words.forEach(word => {
      [...word].forEach(ch => {
        if (/\p{Script=Han}/u.test(ch)) chars.add(ch);
      });
    });
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
      examplesClose: document.getElementById('examplesClose')
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
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height)
      };
    }

    function drawSegment(x1, y1, x2, y2) {
      markerCtx.strokeStyle = MARKER_OUTLINE_COLOR;
      markerCtx.lineWidth = MARKER_OUTLINE_WIDTH;
      markerCtx.lineCap = 'round';
      markerCtx.lineJoin = 'round';
      markerCtx.beginPath();
      markerCtx.moveTo(x1, y1);
      markerCtx.lineTo(x2, y2);
      markerCtx.stroke();

      markerCtx.strokeStyle = MARKER_COLOR;
      markerCtx.lineWidth = MARKER_WIDTH;
      markerCtx.beginPath();
      markerCtx.moveTo(x1, y1);
      markerCtx.lineTo(x2, y2);
      markerCtx.stroke();
    }

    function startDraw(e) {
      if (!markerActive) return;
      e.preventDefault();
      isDrawing = true;
      const pos = getPos(e);
      lastX = pos.x; lastY = pos.y;
      drawSegment(pos.x, pos.y, pos.x + 0.1, pos.y + 0.1);
    }

    function moveDraw(e) {
      if (!markerActive || !isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);
      drawSegment(lastX, lastY, pos.x, pos.y);
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
    if (markerCtx) {
      markerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      markerCtx.lineCap = 'round';
      markerCtx.lineJoin = 'round';
    }
  }

  function clearMarker() {
    if (!markerCtx || !dom.markerCanvas) return;
    markerCtx.save();
    markerCtx.setTransform(1, 0, 0, 1, 0, 0);
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
      if (markerActive) {
        dom.instruction.textContent = '🖊️ Маркер включён — рисуйте поверх иероглифа';
        dom.instruction.style.color = '#92400e';
      } else {
        dom.instruction.textContent = '✍️ Обведите иероглиф по порядку черт';
        dom.instruction.style.color = '#6b7280';
      }
    }
  }

  // ============================================================
  // UI
  // ============================================================
  function updateProgress(percent) {
    if (dom.progress) dom.progress.style.width = Math.min(percent, 100) + '%';
  }

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
  // ЗАГРУЗКА ИЕРОГЛИФА
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
        if (dom.instruction) {
          dom.instruction.textContent = '⚠️ Ошибка! Смотрите на подсказку';
          dom.instruction.style.color = '#d92d20';
        }
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
  // ПОДСКАЗКА — ОДНА озвучка
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

    // Озвучка + анимация параллельно
    const speech = speakAndWait(char);
    const anim = new Promise((resolve) => {
      hwWriter.animateCharacter({ onComplete: () => resolve() });
    });

    await Promise.all([speech, anim]);

    setTimeout(function () {
      isShowingHint = false;
      loadCharacter(currentIndex);
    }, 400);
  }

  // ============================================================
  // АВТОПЛЕЙ — ОДНА озвучка на иероглиф
  // ============================================================
  async function preloadUpcoming(startIndex) {
    const batch = 6;
    const promises = [];
    for (let i = 0; i < batch; i++) {
      const idx = (startIndex + i) % currentItems.length;
      const ch = currentItems[idx].char;
      if (ch) promises.push(preloadAudio(ch));
    }
    await Promise.all(promises);
  }

  async function startAutoplay() {
    if (autoplayActive) { stopAutoplay(); return; }
    if (currentItems.length === 0) return;

    autoplayActive = true;
    autoplayCancelToken++;
    const myToken = autoplayCancelToken;

    if (dom.autoplayBtn) {
      dom.autoplayBtn.classList.add('active');
      dom.autoplayBtn.innerHTML = '⏸️ Стоп';
    }
    if (dom.autoplayIndicator) {
      dom.autoplayIndicator.classList.add('active');
    }

    // Предзагрузка 6 иероглифов ДО старта
    if (dom.instruction) {
      dom.instruction.textContent = '⏳ Загрузка озвучки...';
      dom.instruction.style.color = '#2563eb';
    }
    await preloadUpcoming(currentIndex);

    if (!autoplayActive || myToken !== autoplayCancelToken) return;

    autoplayLoop(myToken);
  }

  function stopAutoplay() {
    autoplayActive = false;
    autoplayCancelToken++;
    if (autoplayDelayTimer) {
      clearTimeout(autoplayDelayTimer);
      autoplayDelayTimer = null;
    }
    if (dom.autoplayBtn) {
      dom.autoplayBtn.classList.remove('active');
      dom.autoplayBtn.innerHTML = '▶️ Авто';
    }
    if (dom.autoplayIndicator) dom.autoplayIndicator.classList.remove('active');
    if (hwWriter && currentItems.length > 0) {
      try { hwWriter.cancelQuiz(); } catch (e) {}
      loadCharacter(currentIndex, { silent: true });
    }
  }

  async function autoplayLoop(token) {
    while (autoplayActive && token === autoplayCancelToken) {
      const data = currentItems[currentIndex];

      if (dom.autoplayProgress) {
        dom.autoplayProgress.textContent = (currentIndex + 1) + ' / ' + currentItems.length;
      }

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
          showOutline: true, strokeAnimationSpeed: 0.8, delayBetweenStrokes: 400,
          drawingWidth: Math.max(15, size * 0.06),
          showCharacter: false,
          highlightColor: '#d92d20', outlineColor: '#d9e0ea', drawingColor: '#1a1f2b'
        });
      } catch (e) {
        console.warn('Autoplay: ошибка создания writer', e);
        break;
      }

      if (dom.instruction) {
        dom.instruction.textContent = '▶️ Автоплей (' + (currentIndex + 1) + '/' + currentItems.length + ')';
        dom.instruction.style.color = '#2563eb';
      }

      // Ждём MP3 ТЕКУЩЕГО
      await preloadAudio(data.char);
      if (!autoplayActive || token !== autoplayCancelToken) break;

      // ========== ОДНА ОЗВУЧКА + АНИМАЦИЯ ПАРАЛЛЕЛЬНО ==========
      const speech = speakAndWait(data.char);
      const anim = new Promise((resolve) => {
        hwWriter.animateCharacter({ onComplete: () => resolve() });
      });

      await Promise.all([speech, anim]);
      if (!autoplayActive || token !== autoplayCancelToken) break;

      // Пауза перед следующим
      await new Promise((resolve) => {
        autoplayDelayTimer = setTimeout(resolve, 800);
      });
      if (!autoplayActive || token !== autoplayCancelToken) break;

      currentIndex = (currentIndex + 1) % currentItems.length;

      // Фоновая предзагрузка
      preloadUpcoming(currentIndex);

      await new Promise((resolve) => {
        autoplayDelayTimer = setTimeout(resolve, 200);
      });
    }

    if (token === autoplayCancelToken && autoplayActive) {
      autoplayActive = false;
      if (dom.autoplayBtn) {
        dom.autoplayBtn.classList.remove('active');
        dom.autoplayBtn.innerHTML = '▶️ Авто';
      }
      if (dom.autoplayIndicator) dom.autoplayIndicator.classList.remove('active');
      showFloating('🎉 Круг завершён!');
      if (dom.instruction) {
        dom.instruction.textContent = '🎉 Автоплей завершён';
        dom.instruction.style.color = '#16835f';
      }
      loadCharacter(currentIndex, { silent: true });
    }
  }

  // ============================================================
  // ПРИМЕРЫ
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
      for (let i = 1; i <= 5; i++) {
        starsHtml += i <= stars
          ? '<span style="color:#d4a840;">★</span>'
          : '<span style="color:#d9e0ea;">☆</span>';
      }
      const block = document.createElement('div');
      block.className = 'progress-block';
      block.innerHTML =
        '<div class="progress-stars">' + starsHtml + '</div>' +
        '<div class="progress-info">' +
        (p.mastered ? '🎉 Выучен!' : 'Попыток: ' + p.attempts + ' · Ошибок: ' + p.mistakes) +
        '</div>';
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
          item.addEventListener('click', function () {
            preloadAudio(ex.word).then(() => speakAndWait(ex.word));
            item.style.background = '#e6f4ef';
            setTimeout(function () { item.style.background = ''; }, 300);
          });
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
  // РЕЖИМЫ
  // ============================================================
  function loadCategory(level) {
    stopAutoplay();
    const chars = getCategoryChars(level);
    if (chars.length === 0) {
      currentItems = [];
      if (dom.instruction) dom.instruction.textContent = '⚠️ HSK ' + level + ': нет данных в базе';
      return;
    }
    currentItems = shuffle(chars).map(char => ({
      char,
      pinyin: getPinyin(char),
      meaning: getCharMeaning(char)
    }));
    currentIndex = 0;
    score = 0;
    combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = 'HSK ' + level + ' · ' + chars.length + ' знаков';
    loadCharacter(0);
    updateStats();
    setTimeout(() => preloadUpcoming(0), 400);
  }

  function startDueReview() {
    stopAutoplay();
    const due = Progress.getDueForReview();
    if (due.length === 0) {
      showFloating('🎉 Всё повторено!');
      if (dom.instruction) {
        dom.instruction.textContent = '🎉 Нет иероглифов для повторения';
        dom.instruction.style.color = '#16835f';
      }
      return false;
    }
    currentItems = due;
    currentIndex = 0;
    score = 0; combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = '🔄 Повторение · ' + due.length;
    loadCharacter(0);
    updateStats();
    setTimeout(() => preloadUpcoming(0), 400);
    return true;
  }

  function startWeakSpots() {
    stopAutoplay();
    const weak = Progress.getWeakSpots();
    if (weak.length === 0) {
      showFloating('✨ Нет слабых мест!');
      if (dom.instruction) {
        dom.instruction.textContent = '✨ Слабых мест пока нет';
        dom.instruction.style.color = '#16835f';
      }
      return false;
    }
    currentItems = weak;
    currentIndex = 0;
    score = 0; combo = 0;
    updateUI();
    if (dom.category) dom.category.textContent = '🎯 Слабые места · ' + weak.length;
    loadCharacter(0);
    updateStats();
    setTimeout(() => preloadUpcoming(0), 400);
    return true;
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
    else {
      const lvl = parseInt(mode, 10);
      if (lvl >= 1 && lvl <= 5) loadCategory(lvl);
    }
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

    if (dom.hintBtn) dom.hintBtn.addEventListener('click', () => {
      if (autoplayActive) stopAutoplay();
      showHint();
    });
    if (dom.nextBtn) dom.nextBtn.addEventListener('click', () => {
      if (autoplayActive) stopAutoplay();
      nextCharacter();
    });
    if (dom.examplesBtn) dom.examplesBtn.addEventListener('click', showExamples);
    if (dom.clearMarkerBtn) dom.clearMarkerBtn.addEventListener('click', () => {
      clearMarker();
      showFloating('🧹 Очищено');
    });
    if (dom.markerToggle) dom.markerToggle.addEventListener('click', toggleMarker);
    if (dom.autoplayBtn) dom.autoplayBtn.addEventListener('click', startAutoplay);

    if (dom.char) dom.char.addEventListener('click', () => {
      if (currentItems.length > 0) {
        const ch = currentItems[currentIndex].char;
        preloadAudio(ch).then(() => speakAndWait(ch));
      }
    });

    if (dom.examplesClose) dom.examplesClose.addEventListener('click', () => {
      dom.examplesModal.classList.remove('show');
    });
    if (dom.examplesModal) dom.examplesModal.addEventListener('click', (e) => {
      if (e.target === dom.examplesModal) dom.examplesModal.classList.remove('show');
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => switchMode(btn.dataset.mode));
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

    window.addEventListener('beforeunload', () => {
      autoplayActive = false;
      autoplayCancelToken++;
    });

    initialized = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
