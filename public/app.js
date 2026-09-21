(function () {
  'use strict';

  var POLL_MS = 15000;
  var storedKey = null;
  var lastSeenId = null;
  var pollTimer = null;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* ignore - private mode etc. */ }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  var setupEl = document.getElementById('setup');
  var apiKeyInput = document.getElementById('apiKeyInput');
  var saveKeyBtn = document.getElementById('saveKeyBtn');
  var setupErr = document.getElementById('setupErr');
  var feedEl = document.getElementById('feed');
  var statusEl = document.getElementById('status');
  var statusText = document.getElementById('statusText');

  function showSetup(message) {
    setupEl.classList.remove('hidden');
    setupErr.textContent = message || '';
  }
  function hideSetup() {
    setupEl.classList.add('hidden');
  }

  function setStatus(live, text) {
    statusEl.classList.toggle('live', !!live);
    statusText.textContent = text;
  }

  function fmtNum(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toFixed(2);
  }

  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  function render(signals) {
    if (!signals || signals.length === 0) {
      feedEl.innerHTML = '<div class="empty">Waiting for the first signal…</div>';
      return;
    }
    var html = signals.map(function (s) {
      return (
        '<div class="card">' +
          '<div class="row1">' +
            '<span class="badge ' + s.direction + '">' + s.direction + '</span>' +
            '<span class="symbol">' + escapeHtml(s.symbol) + '</span>' +
            '<span class="time">' + fmtTime(s.receivedAt) + '</span>' +
          '</div>' +
          '<div class="levels">' +
            '<div><div class="k">Entry</div><div class="v">' + fmtNum(s.entry) + '</div></div>' +
            '<div><div class="k">Stop</div><div class="v">' + fmtNum(s.sl) + '</div></div>' +
            '<div><div class="k">Target</div><div class="v">' + fmtNum(s.tp) + '</div></div>' +
          '</div>' +
          (s.reason ? '<div class="reason">' + escapeHtml(s.reason) + '</div>' : '') +
        '</div>'
      );
    }).join('');
    feedEl.innerHTML = html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function notifyNewSignals(signals) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (lastSeenId === null) return; // first load - don't spam notifications for existing history
    var newOnes = [];
    for (var i = 0; i < signals.length; i++) {
      if (signals[i].id === lastSeenId) break;
      newOnes.push(signals[i]);
    }
    newOnes.reverse().forEach(function (s) {
      try {
        new Notification(s.direction + ' ' + s.symbol, {
          body: 'Entry ' + fmtNum(s.entry) + ' · SL ' + fmtNum(s.sl) + ' · TP ' + fmtNum(s.tp),
          icon: 'icon-192.png'
        });
      } catch (e) { /* ignore - some browsers restrict Notification while backgrounded */ }
    });
  }

  function poll() {
    if (!storedKey) return;
    fetch('/api/signals', { headers: { 'x-api-key': storedKey } })
      .then(function (res) {
        if (res.status === 401) throw new Error('unauthorized');
        if (!res.ok) throw new Error('server error ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setStatus(true, 'live');
        var signals = data.signals || [];
        notifyNewSignals(signals);
        if (signals.length > 0) lastSeenId = signals[0].id;
        render(signals);
      })
      .catch(function (err) {
        if (err.message === 'unauthorized') {
          safeRemove('apiKey');
          storedKey = null;
          stopPolling();
          showSetup('That key was rejected by the server. Enter the correct API key.');
          return;
        }
        setStatus(false, 'reconnecting…');
      });
  }

  function startPolling() {
    poll();
    stopPolling();
    pollTimer = setInterval(poll, POLL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  saveKeyBtn.addEventListener('click', function () {
    var val = apiKeyInput.value.trim();
    if (!val) {
      setupErr.textContent = 'Enter an API key.';
      return;
    }
    setupErr.textContent = '';
    storedKey = val;
    fetch('/api/signals', { headers: { 'x-api-key': storedKey } })
      .then(function (res) {
        if (res.status === 401) throw new Error('unauthorized');
        if (!res.ok) throw new Error('server error ' + res.status);
        return res.json();
      })
      .then(function () {
        safeSet('apiKey', storedKey);
        hideSetup();
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        startPolling();
      })
      .catch(function () {
        setupErr.textContent = 'Could not connect with that key. Check it and try again.';
      });
  });

  // Init
  storedKey = safeGet('apiKey');
  if (!storedKey) {
    showSetup();
  } else {
    startPolling();
  }
})();
