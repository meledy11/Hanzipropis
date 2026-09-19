// trainer.js — тренажёр каллиграфии с интервальным повторением
// Использует: HSK_DATA, speakChinese(), HanziWriter

(function() {
  'use strict';

  const STORAGE_KEY = 'hanzi_trainer_progress_v1';
  const REVIEW_INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60]; // дни

  // ============ ПРОГРЕСС ============
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
          level: 0,           // текущий уровень интервала
          successes: 0,       // успешных повторений подряд
          attempts: 0,        // всего попыток
          mistakes: 0,        // всего ошибок
          lastReview: 0,
          nextReview: 0,
          mastered: false
        };
      }
      return this.data[char];
    },

    recordSuccess(char, accuracy) {
      const p = this.get(char);
      p.attempts++;
      p.successes++;
      p.lastReview = Date.now();
      if (accuracy >= 90) {
        p.level = Math.min(p.level + 1, REVIEW_INTERVALS.length - 1);
      }
      const days = REVIEW_INTERVALS[p.level];
      p.nextReview = Date.now() + days * 24 * 60 * 60 * 1000;
      if (p.level >= REVIEW_INTERVALS.length - 1 && p.successes >= 3) {
        p.mastered = true;
      }
      this.save();
    },

    recordMistake(char, mistakeCount) {
      const p = this.get(char);
      p.attempts++;
      p.mistakes += mistakeCount;
      p.successes = 0;
      p.level = Math.max(0, p.level - 1);
      p.lastReview = Date.now();
      p.nextReview = Date.now() + 24 * 60 * 60 * 1000; // завтра
      p.mastered = false;
      this.save();
    },

    getStats() {
      const chars = Object.keys(this.data);
      const mastered = chars.filter(c => this.data[c].mastered).length;
      const now = Date.now();
      const dueCount = chars.filter(c => this.data[c].attempts > 0 && this.data[c].nextReview <= now).length;
      let totalAttempts = 0, totalMistakes = 0;
      chars.forEach(c => {
        totalAttempts += this.data[c].attempts;
        totalMistakes += this.data[c].mistakes;
      });
      const accuracy = totalAttempts === 0 ? 0 : Math.round((1 - totalMistakes / (totalAttempts * 5)) * 100);
      return {
        total: chars.length,
        mastered,
        dueCount,
        accuracy: Math.max(0, Math.min(100, accuracy)),
        streak: this.getStreak()
      };
    },

    getStreak() {
      // Считаем дни подряд с активностью
      const days = new Set();
      Object.values(this.data).forEach(p => {
        if (p.lastReview) {
          const d = new Date(p.lastReview);
          days.add(d.toISOString().slice(0, 10));
        }
      });
      const sorted = [...days].sort().reverse();
      if (sorted.length === 0) return 0;
      let streak = 1;
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (sorted[0] !== today && sorted[0] !== yesterday) return 0;
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(sorted[i - 1]);
        const cur = new Date(sorted[i]);
        const diff = (prev - cur) / 86400000;
        if (diff <= 1.5) streak++;
        else break;
      }
      return streak;
    },

    getDueForReview() {
      const now = Date.now();
      const due = [];
      for (const key in HSK_DATA) {
        const words = HSK_DATA[key] || [];
        words.forEach(word => {
          [...word].forEach(char => {
            if (/\p{Script=Han}/u.test(char)) {
              const p = this.get(char);
              if (p.attempts > 0 && p.nextReview <= now && !p.mastered) {
                if (!due.find(d => d.char === char)) {
                  due.push({ char, pinyin: getPinyin(char) });
                }
              }
            }
          });
        });
      }
      return due;
    },

    getWeakSpots() {
      const weak = [];
      for (const key in HSK_DATA) {
        const words = HSK_DATA[key] || [];
        words.forEach(word => {
          [...word].forEach(char => {
            if (/\p{Script=Han}/u.test(char)) {
              const p = this.get(char);
              if (p.attempts >= 2 && p.mistakes > 0 && !p.mastered) {
                if (!weak.find(d => d.char === char)) {
                  weak.push({ char, pinyin: getPinyin(char), mistakes: p.mistakes });
                }
              }
            }
          });
        });
      }
      return weak.sort((a, b) => b.mistakes - a.mistakes);
    }
  };

  // ============ ВСПОМОГАТЕЛЬНЫЕ ============
  function getPinyin(char) {
    try {
      if (window.pinyinPro?.pinyin) {
        return window.pinyinPro.pinyin(char, { toneType: 'symbol' });
      }
    } catch (e) {}
    return '';
  }

  function getMeaning(char) {
    // Ищем перевод в HSK_DATA
    for (const level in HSK_DATA) {
      const words = HSK_DATA[level] || [];
      for (const word of words) {
        if (word.includes(char)) {
          // Можно расширить: словарь переводов
          return '';
        }
      }
    }
    return '';
  }

  // ============ СОСТОЯНИЕ ============
  let currentItems = [];
  let currentIndex = 0;
  let score = 0;
  let combo = 0;
  let currentStrokesTotal = 0;
  let currentStrokesCorrect = 0;
  let hwWriter = null;
  let isShowingHint = false;

  // ============ DOM ============
  const container = document.getElementById('trainerContainer');
  if (!container) return;

  const charDisplay = container.querySelector('#trCharDisplay');
  const pinyinDisplay = container.querySelector('#trPinyinDisplay');
  const meaningDisplay = container.querySelector('#trMeaningDisplay');
  const charStatus = container.querySelector('#trCharStatus');
  const hwContainer = container.querySelector('#trHwContainer');
  const progressFill = container.querySelector('#trProgressFill');
  const scoreDisplay = container.querySelector('#trScore');
  const accuracyDisplay = container.querySelector('#trAccuracy');
  const comboBadge = container.querySelector('#trCombo');
  const instructionText = container.querySelector('#trInstruction');
  const heroStreak = container.querySelector('#trStreak');
  const heroCategory = container.querySelector('#trCategory');

  // ============ ЛОГИКА ============
  function loadCharacter(index) {
    if (currentItems.length === 0) return;
    const data = currentItems[index];
    charDisplay.textContent = data.char;
    pinyinDisplay.textContent = data.pinyin || getPinyin(data.char);
    meaningDisplay.textContent = data.meaning || '';
    currentStrokesCorrect = 0;
    isShowingHint = false;
    updateProgress(0);
    updateCharStatus();
    instructionText.textContent = '✍️ Обведите иероглиф по порядку черт';
    instructionText.style.color = '#6b7280';

    hwContainer.innerHTML = '';
    const size = Math.min(hwContainer.clientWidth, hwContainer.clientHeight) || 300;

    hwWriter = HanziWriter.create(hwContainer, data.char, {
      width: size,
      height: size,
      padding: 15,
      showOutline: true,
      strokeAnimationSpeed: 1.2,
      delayBetweenStrokes: 500,
      drawingWidth: Math.max(15, size * 0.06),
      showCharacter: false,
      highlightColor: '#d92d20',
      outlineColor: '#d9e0ea',
      drawingColor: '#1a1f2b',
      showHintAfterMisses: 1,
      highlightOnComplete: true
    });

    hwWriter.getCharacterData().then(function(charData) {
      currentStrokesTotal = charData.strokes.length;
      updateProgress(0);
    });

    hwWriter.quiz({
      onCorrectStroke: function(strokeData) {
        if (isShowingHint) return;
        currentStrokesCorrect = strokeData.strokeNum;
        combo++;
        score += 10 * combo;
        updateUI();
        updateProgress((currentStrokesCorrect / currentStrokesTotal) * 100);
      },
      onMistake: function() {
        if (isShowingHint) return;
        combo = 0;
        updateUI();
        instructionText.textContent = '⚠️ Ошибка! Смотрите на подсказку';
        instructionText.style.color = '#d92d20';
      },
      onComplete: function(summaryData) {
        if (isShowingHint) return;
        score += 100;
        const accuracy = summaryData.totalMistakes === 0 ? 100 :
          Math.max(0, Math.round((1 - summaryData.totalMistakes / currentStrokesTotal) * 100));

        if (summaryData.totalMistakes === 0) {
          Progress.recordSuccess(data.char, accuracy);
        } else {
          Progress.recordMistake(data.char, summaryData.totalMistakes);
        }

        updateCharStatus();
        updateStats();
        instructionText.textContent = '🎉 Отлично! Загрузка следующего...';
        instructionText.style.color = '#2563eb';
        setTimeout(() => nextCharacter(), 2000);
      }
    });
  }

  function updateProgress(percent) {
    progressFill.style.width = `${Math.min(percent, 100)}%`;
  }

  function updateUI() {
    if (scoreDisplay) scoreDisplay.textContent = score;
    if (comboBadge) comboBadge.textContent = combo >= 2 ? `🔥 x${combo}` : '';
  }

  function updateCharStatus() {
    if (currentItems.length === 0) return;
    const data = currentItems[currentIndex];
    const p = Progress.get(data.char);
    charStatus.classList.remove('new', 'learning', 'due', 'mastered');
    if (p.mastered) {
      charStatus.classList.add('mastered');
      charStatus.textContent = '✓ ВЫУЧЕН';
    } else if (p.attempts > 0 && p.nextReview <= Date.now()) {
      charStatus.classList.add('due');
      charStatus.textContent = '🔄 ПОВТОРИТЬ';
    } else if (p.attempts > 0) {
      charStatus.classList.add('learning');
      charStatus.textContent = '📖 ИЗУЧАЕМ';
    } else {
      charStatus.classList.add('new');
      charStatus.textContent = '✨ НОВЫЙ';
    }
  }

  function updateStats() {
    const stats = Progress.getStats();
    if (heroStreak) heroStreak.textContent = `🔥 ${stats.streak} дней`;
    if (accuracyDisplay) accuracyDisplay.textContent = `${stats.accuracy}%`;
  }

  function nextCharacter() {
    currentIndex = (currentIndex + 1) % currentItems.length;
    loadCharacter(currentIndex);
  }

  function showHint() {
    if (!hwWriter || isShowingHint) return;
    isShowingHint = true;
    const data = currentItems[currentIndex];
    speakChinese(data.char);
    instructionText.textContent = '👀 Смотрите анимацию...';
    hwWriter.animateCharacter({
      onComplete: function() {
        setTimeout(() => {
          isShowingHint = false;
          loadCharacter(currentIndex);
        }, 800);
      }
    });
  }

  // ============ ИНИЦИАЛИЗАЦИЯ ТРЕНАЖЁРА ============
  function loadCategory(categoryKey) {
    const cat = HSK_DATA[categoryKey] || [];
    // Собираем все уникальные иероглифы из слов категории
    const chars = new Set();
    cat.forEach(word => {
      [...word].forEach(ch => {
        if (/\p{Script=Han}/u.test(ch)) chars.add(ch);
      });
    });
    currentItems = [...chars].map(char => ({
      char,
      pinyin: getPinyin(char),
      meaning: ''
    }));
    // Перемешиваем
    currentItems.sort(() => Math.random() - 0.5);
    currentIndex = 0;
    if (currentItems.length > 0) loadCharacter(0);
  }

  // ============ ЭКСПОРТ ============
  window.Trainer = {
    start(categoryKey = '1') {
      Progress.load();
      loadCategory(categoryKey);
      updateStats();
    },
    next: nextCharacter,
    hint: showHint,
    getProgress: () => Progress
  };

  Progress.load();
})();
