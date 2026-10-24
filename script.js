/* ============================================================
   摆烂电量表 · 逻辑部分（五毛钱特效版）
   预算有限，逻辑从简。作者：三毛钱外包团队（已跑路）
   ============================================================ */
(function () {
  'use strict';

  // 防御：即使脚本被重复加载，也只运行一份，避免监听器重复绑定
  if (window.__bailanBooted) return;
  window.__bailanBooted = true;

  var MAX = 100;
  var KEY = 'bailan-battery-v6';

  var defaultState = {
    battery: MAX,
    slackCount: 0,
    slackSeconds: 0,
    workSuccess: 0,
    achievements: [],
    soundOn: false
  };

  // 演示用：访问 ?reset=1 可清空本机记录，回到 100%
  try {
    if (new URLSearchParams(location.search).has('reset')) {
      localStorage.removeItem(KEY);
    }
  } catch (e) { /* 忽略 */ }

  var state = loadState();
  var ended = false;
  var lastSlack = 0;
  var workLock = false;
  var saveTimer = null;
  var tickCount = 0;

  /* ---------------- 持久化 ---------------- */
  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return clone(defaultState);
      var p = JSON.parse(raw) || {};
      var battery = typeof p.battery === 'number' ? p.battery : MAX;
      return {
        battery: Math.min(MAX, Math.max(0, battery)),
        slackCount: Number(p.slackCount) || 0,
        slackSeconds: Number(p.slackSeconds) || 0,
        workSuccess: Number(p.workSuccess) || 0,
        achievements: Array.isArray(p.achievements) ? p.achievements : [],
        soundOn: p.soundOn === true
      };
    } catch (e) {
      return clone(defaultState);
    }
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 无所谓 */ }
    }, 120);
  }

  /* ---------------- 文案库 ---------------- */
  var TAUNTS = [
    '你刚刚摆烂的样子，连老板都替你尴尬',
    '检测到摆烂行为，已自动上报（并没有）',
    '摆烂一时爽，一直摆烂一直爽',
    '你的电量正在被快乐吞噬',
    '别摆了，再摆就成精了',
    '系统提示：本次摆烂已计入年度考核（骗你的）',
    '检测到你的精神状态：加载中…',
    '五毛钱特效为你闪烁了一下，请查收',
    '这个按钮按得越多，你越像个人才',
    '已经很努力地摆烂了，值得表扬',
    '电量 -1，快乐 +10086',
    '你的躺平姿势已被收录进教科书',
    '别慌，人生本来就是一场大型摆烂',
    '刚才那一下，很有灵魂'
  ];

  var WORK_FAIL = [
    '假装努力被识破，电量 -3%',
    '你打开文档的样子，被系统判定为摆拍',
    '努力失败，但演技进步了',
    '老板路过，你只来得及关掉视频'
  ];

  var ENDING_QUOTES = [
    '人生不必太用力，躺着也能看云。',
    '电量可以归零，心态不能。',
    '你已经很努力地摆烂了，请继续保持。',
    '真正的自由，是从关掉闹钟开始的。'
  ];

  /* ---------------- 成就定义 ---------------- */
  var ACHIEVEMENTS = [
    { id: 'first', icon: '🛌', name: '初次摆烂', desc: '第一次按下「开始摆烂」', check: function (s) { return s.slackCount >= 1; } },
    { id: 'five', icon: '😴', name: '摆烂熟练工', desc: '累计摆烂 5 次', check: function (s) { return s.slackCount >= 5; } },
    { id: 'ten', icon: '🦥', name: '摆烂大师', desc: '累计摆烂 10 次', check: function (s) { return s.slackCount >= 10; } },
    { id: 'half', icon: '🔋', name: '半电人生', desc: '电量降到 50% 以下', check: function (s) { return s.battery <= 50; } },
    { id: 'low', icon: '⚠️', name: '低电量警告', desc: '电量降到 20% 以下', check: function (s) { return s.battery <= 20; } },
    { id: 'zero', icon: '💀', name: '彻底躺平', desc: '把电量摆到 0%', check: function (s) { return s.battery <= 0; } },
    { id: 'actor', icon: '🎭', name: '影帝级表演', desc: '假装努力成功 3 次', check: function (s) { return s.workSuccess >= 3; } },
    { id: 'time', icon: '⏱️', name: '时间管理大师', desc: '累计摆烂 60 秒', check: function (s) { return s.slackSeconds >= 60; } }
  ];

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var batteryEl = $('battery');
  var fill = $('fill');
  var percentEl = $('percent');
  var statusEl = $('status');
  var slackCountEl = $('slackCount');
  var slackTimeEl = $('slackTime');
  var levelEl = $('level');
  var achProgress = $('achProgress');
  var achList = $('achList');
  var slackBtn = $('slackBtn');
  var workBtn = $('workBtn');
  var lieBtn = $('lieBtn');
  var soundBtn = $('soundBtn');
  var toastLayer = $('toastLayer');
  var ending = $('ending');
  var endingStats = $('endingStats');
  var endingQuote = $('endingQuote');
  var restartBtn = $('restartBtn');

  /* ---------------- 工具函数 ---------------- */
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function fmtTime(sec) {
    sec = Math.floor(sec);
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60);
    return m + ' 分 ' + (sec % 60) + ' 秒';
  }

  function getLevel(n) {
    if (n <= 0) return 'Lv.0 纯路人';
    if (n < 3) return 'Lv.1 摸鱼学徒';
    if (n < 6) return 'Lv.2 摆烂练习生';
    if (n < 10) return 'Lv.3 摆烂熟练工';
    if (n < 15) return 'Lv.4 摆烂大师';
    return 'Lv.5 摆烂之神';
  }

  function getStatus(b) {
    if (b >= 80) return '电量满格，今天也是元气满满的摆烂人。';
    if (b >= 60) return '状态还行，还能再摆一会儿。';
    if (b >= 40) return '开始有点累了，摆烂进入中盘。';
    if (b >= 20) return '低电量警告：建议立即躺下。';
    if (b > 0) return '只剩最后一口气，还在坚持摆烂。';
    return '电量耗尽，人生进入省电模式。';
  }

  /* ---------------- 音效（手工合成，成本 0 元） ---------------- */
  var audioCtx = null;
  function beep(freq, dur, type, vol) {
    if (!state.soundOn) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq || 440;
      g.gain.value = vol || 0.02;
      o.connect(g);
      g.connect(audioCtx.destination);
      var t = audioCtx.currentTime;
      o.start(t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      o.stop(t + (dur || 0.08));
    } catch (e) { /* 音效坏了也不影响摆烂 */ }
  }

  /* ---------------- 提示条 ---------------- */
  var toastLimit = 3;
  function toast(text, emoji) {
    if (toastLayer.children.length >= toastLimit) return;
    var el = document.createElement('div');
    el.className = 'toast';
    var icon = document.createElement('span');
    icon.className = 'toast__emoji';
    icon.textContent = emoji || '💤';
    var txt = document.createElement('span');
    txt.textContent = text;
    el.appendChild(icon);
    el.appendChild(txt);
    toastLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  /* ---------------- 五毛特效：点击冒 emoji ---------------- */
  var POP_EMOJI = ['💸', '✨', '💤', '🪙', '⭐'];
  function spawnEmoji(target, count) {
    if (!target) return;
    var rect = target.getBoundingClientRect();
    for (var i = 0; i < count; i++) {
      var el = document.createElement('span');
      el.className = 'emoji-pop';
      el.textContent = POP_EMOJI[Math.floor(Math.random() * POP_EMOJI.length)];
      el.style.left = (rect.left + rect.width / 2 + (Math.random() * 70 - 35)) + 'px';
      el.style.top = (rect.top + 10) + 'px';
      el.style.setProperty('--dx', (Math.random() * 90 - 45) + 'px');
      el.style.setProperty('--rot', (Math.random() * 80 - 40) + 'deg');
      document.body.appendChild(el);
      (function (node) {
        setTimeout(function () { node.remove(); }, 1050);
      })(el);
    }
  }

  /* ---------------- 渲染 ---------------- */
  function renderBattery() {
    var pct = clamp(state.battery, 0, MAX);
    fill.style.width = pct + '%';
    percentEl.textContent = Math.round(pct) + '%';
    batteryEl.classList.toggle('is-mid', pct <= 55 && pct > 25);
    batteryEl.classList.toggle('is-low', pct <= 25);
    statusEl.textContent = getStatus(pct);
  }

  function renderStats() {
    slackCountEl.textContent = state.slackCount;
    slackTimeEl.textContent = fmtTime(state.slackSeconds);
    levelEl.textContent = getLevel(state.slackCount);
  }

  function renderAchievements() {
    var html = '';
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var a = ACHIEVEMENTS[i];
      var on = state.achievements.indexOf(a.id) !== -1;
      html += '<li class="ach' + (on ? ' is-on' : '') + '">'
        + '<span class="ach__icon">' + (on ? a.icon : '🔒') + '</span>'
        + '<div><b class="ach__name">' + a.name + '</b>'
        + '<small class="ach__desc">' + a.desc + '</small></div>'
        + '</li>';
    }
    achList.innerHTML = html;
    achProgress.textContent = state.achievements.length + ' / ' + ACHIEVEMENTS.length;
  }

  function renderSound() {
    soundBtn.textContent = state.soundOn ? '🔊' : '🔇';
    soundBtn.title = state.soundOn ? '音效：开' : '音效：关';
  }

  function renderAll() {
    renderBattery();
    renderStats();
    renderAchievements();
    renderSound();
  }

  /* ---------------- 成就检查 ---------------- */
  function checkAchievements() {
    var fresh = [];
    for (var i = 0; i < ACHIEVEMENTS.length; i++) {
      var a = ACHIEVEMENTS[i];
      if (state.achievements.indexOf(a.id) === -1 && a.check(state)) {
        state.achievements.push(a.id);
        fresh.push(a);
      }
    }
    if (fresh.length) {
      fresh.forEach(function (a) {
        toast('解锁成就：' + a.name, '🏆');
      });
      renderAchievements();
      beep(660, 0.1, 'triangle', 0.03);
      setTimeout(function () { beep(880, 0.14, 'triangle', 0.03); }, 110);
      save();
    }
  }

  /* ---------------- 行为：摆烂 ---------------- */
  function doSlack() {
    if (ended) return;
    var now = Date.now();
    if (now - lastSlack < 200) return;
    lastSlack = now;

    var cost = 5 + Math.floor(Math.random() * 6); // 5 ~ 10
    state.battery = Math.max(0, state.battery - cost);
    state.slackCount += 1;

    toast(pick(TAUNTS), pick(['💤', '🛌', '😴', '🦥']));
    beep(200 + Math.random() * 160, 0.07, 'square', 0.025);
    spawnEmoji(document.getElementById('slackBtn'), 4);

    renderAll();
    checkAchievements();
    save();

    if (state.battery <= 0) showEnding();
  }

  /* ---------------- 行为：假装努力 ---------------- */
  function doWork() {
    if (ended || workLock) return;
    workLock = true;
    workBtn.disabled = true;

    var success = Math.random() < 0.65;
    if (success) {
      state.workSuccess += 1;
      state.battery = Math.min(MAX, state.battery + 5);
      toast('老板远远看了你一眼，电量 +5%（疑似幻觉）', '💼');
      beep(520, 0.07, 'triangle', 0.025);
      spawnEmoji(document.getElementById('workBtn'), 2);
    } else {
      state.battery = Math.max(0, state.battery - 3);
      toast(pick(WORK_FAIL), '🤡');
      beep(150, 0.12, 'sawtooth', 0.025);
    }

    renderAll();
    checkAchievements();
    save();

    if (state.battery <= 0) showEnding();

    setTimeout(function () {
      workLock = false;
      workBtn.disabled = false;
    }, 900);
  }

  /* ---------------- 行为：彻底躺平 ---------------- */
  function doLie() {
    if (ended) return;
    toast('你说躺就躺，我敬你是条汉子', '🫡');
    beep(300, 0.1, 'square', 0.03);
    spawnEmoji(document.getElementById('lieBtn'), 6);

    setTimeout(function () {
      state.battery = 0;
      renderAll();
      checkAchievements();
      save();
      showEnding();
    }, 380);
  }

  /* ---------------- 结局 ---------------- */
  function showEnding() {
    if (ended) return;
    ended = true;
    state.battery = 0;

    endingStats.innerHTML = '本次共摆烂 <b>' + state.slackCount + '</b> 次 · 累计摆烂 <b>'
      + fmtTime(state.slackSeconds) + '</b> · 解锁成就 <b>' + state.achievements.length + '</b> / '
      + ACHIEVEMENTS.length + ' 个';
    endingQuote.textContent = '“' + pick(ENDING_QUOTES) + '”';

    ending.classList.add('is-on');
    ending.setAttribute('aria-hidden', 'false');

    beep(130, 0.35, 'sawtooth', 0.04);
    setTimeout(function () { beep(80, 0.5, 'square', 0.04); }, 180);

    renderAll();
    save();
  }

  function restart() {
    ended = false;
    state.battery = MAX;
    ending.classList.remove('is-on');
    ending.setAttribute('aria-hidden', 'true');
    renderAll();
    toast('假装充满电，请继续消耗', '🔋');
    beep(700, 0.08, 'triangle', 0.03);
    setTimeout(function () { beep(950, 0.1, 'triangle', 0.03); }, 90);
    save();
  }

  /* ---------------- 自动掉电 ---------------- */
  setInterval(function () {
    if (ended || document.hidden) return;
    if (state.battery <= 0) return;
    state.battery = Math.max(0, state.battery - 0.25);
    renderBattery();
    checkAchievements();
    save();
    if (state.battery <= 0) showEnding();
  }, 4000);

  /* ---------------- 摆烂计时器 ---------------- */
  setInterval(function () {
    if (ended || document.hidden) return;
    if (state.slackCount <= 0) return;
    state.slackSeconds += 1;
    tickCount++;
    slackTimeEl.textContent = fmtTime(state.slackSeconds);
    if (tickCount % 5 === 0) {
      checkAchievements();
      save();
    }
  }, 1000);

  /* ---------------- 绑定事件 ---------------- */
  slackBtn.addEventListener('click', doSlack);
  workBtn.addEventListener('click', doWork);
  lieBtn.addEventListener('click', doLie);
  restartBtn.addEventListener('click', restart);

  soundBtn.addEventListener('click', function () {
    state.soundOn = !state.soundOn;
    renderSound();
    save();
    if (state.soundOn) beep(600, 0.07, 'square', 0.03);
  });

  /* ---------------- 启动 ---------------- */
  renderAll();
  checkAchievements();

  if (state.battery <= 0) {
    showEnding();
  }

  // 首次进入的小彩蛋：五毛特效加载失败
  try {
    if (!sessionStorage.getItem('bailan-greeted-v2')) {
      sessionStorage.setItem('bailan-greeted-v2', '1');
      setTimeout(function () {
        toast('高级特效加载失败，已自动降级为五毛钱特效', '⚠️');
      }, 700);
    }
  } catch (e) { /* 无所谓 */ }
})();
