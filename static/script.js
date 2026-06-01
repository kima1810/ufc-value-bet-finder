let currentData = null;
let currentEventId = null;
let eventsIndex = [];

// ── Sidebar ──────────────────────────────────────────────────────────────────

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open')) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.remove('hidden');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.add('hidden');
}

async function loadEventsIndex() {
  try {
    const r = await fetch('/api/events');
    if (!r.ok) return;
    eventsIndex = await r.json();
    renderSidebar();
  } catch (e) {
    console.error('Failed to load events index', e);
  }
}

function renderSidebar() {
  const list = document.getElementById('sidebarList');
  if (!eventsIndex || !eventsIndex.length) {
    list.innerHTML = '<div class="sidebar-loading">No events found.</div>';
    return;
  }

  const upcoming = eventsIndex.filter(e => e.status === 'upcoming');
  const completed = eventsIndex.filter(e => e.status === 'completed');

  let html = '';
  if (upcoming.length) {
    html += '<div class="sidebar-section-label">Upcoming</div>';
    html += upcoming.map(sidebarItem).join('');
  }
  if (completed.length) {
    html += '<div class="sidebar-section-label">Completed</div>';
    html += completed.map(sidebarItem).join('');
  }
  list.innerHTML = html;
}

function sidebarItem(ev) {
  const active = ev.id === currentEventId ? 'active' : '';
  let badges = '';
  if (ev.is_next) badges += '<span class="badge-next">Next</span>';
  if (ev.is_most_recent) badges += '<span class="badge-recent">Most Recent</span>';
  return `
    <div class="sidebar-event ${active}" onclick="selectEvent('${esc(ev.id)}')">
      <div class="sidebar-event-name">${esc(ev.name)}</div>
      <div class="sidebar-event-meta">${esc(ev.date)}${ev.location ? ' · ' + esc(ev.location) : ''}</div>
      ${badges ? `<div class="sidebar-badges">${badges}</div>` : ''}
    </div>
  `;
}

async function selectEvent(eventId) {
  closeSidebar();
  currentEventId = eventId;
  renderSidebar();
  showLoading();
  try {
    const r = await fetch(`/api/event/${eventId}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to load event');
    currentData = data;
    render(data);
  } catch (e) {
    showError(e.message);
  }
}

// ── Loading / Error / Refresh ─────────────────────────────────────────────────

async function loadNextEvent() {
  showLoading();
  try {
    const r = await fetch('/api/event');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to load event');
    currentData = data;
    currentEventId = data.id;
    renderSidebar();
    render(data);
  } catch (e) {
    showError(e.message);
  }
}

async function refreshEvent() {
  if (!currentEventId) { loadNextEvent(); return; }
  showLoading();
  try {
    const [evR, evtR] = await Promise.all([
      fetch('/api/events'),
      fetch(`/api/event/${currentEventId}/refresh`),
    ]);
    if (evR.ok) { eventsIndex = await evR.json(); }
    const data = await evtR.json();
    if (!evtR.ok) throw new Error(data.error || 'Failed to refresh');
    currentData = data;
    renderSidebar();
    render(data);
  } catch (e) {
    showError(e.message);
  }
}

function showLoading() {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('content').classList.add('hidden');
  document.getElementById('refreshBtn').textContent = '↻ Loading…';
}

function showError(msg) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('refreshBtn').textContent = '↻ Refresh';
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(data) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  document.getElementById('refreshBtn').textContent = '↻ Refresh';

  const isCompleted = data.status === 'completed';
  renderEventHeader(data, isCompleted);
  renderFights(data.fights || [], isCompleted);
}

function renderEventHeader(data, isCompleted) {
  const el = document.getElementById('eventHeader');

  const badge = isCompleted
    ? '<span class="event-badge badge-past">Completed</span>'
    : '<span class="event-badge">Upcoming</span>';

  let recordHtml = '';
  if (isCompleted && data.model_record) {
    const { correct, incorrect } = data.model_record;
    const total = correct + incorrect;
    const pct = total ? Math.round(correct / total * 100) : null;
    recordHtml = `
      <div class="model-record">
        <span class="record-label">Model picks</span>
        <span class="record-correct">✓ ${correct} correct</span>
        <span class="record-incorrect">✗ ${incorrect} incorrect</span>
        ${pct !== null ? `<span class="record-pct">${pct}% accuracy</span>` : ''}
      </div>
    `;
  }

  el.innerHTML = `
    <div>
      <div class="event-name">${esc(data.name)}</div>
      ${recordHtml}
    </div>
    <div class="event-meta">
      <div class="event-meta-item">
        <span class="event-meta-label">Date</span>
        <span class="event-meta-value">${esc(data.date)}</span>
      </div>
      <div class="event-meta-item">
        <span class="event-meta-label">Location</span>
        <span class="event-meta-value">${esc(data.location)}</span>
      </div>
      <div class="event-meta-item">
        <span class="event-meta-label">Fights</span>
        <span class="event-meta-value">${(data.fights || []).length}</span>
      </div>
    </div>
    ${badge}
  `;
}

function renderFights(fights, isCompleted) {
  const container = document.getElementById('fights');
  if (!fights.length) {
    const msg = isCompleted
      ? 'No fight data recorded for this event.'
      : 'No fights confirmed for this event yet.<br>Check back closer to fight week.';
    container.innerHTML = `
      <div class="event-empty">
        <div class="event-empty-icon">🥊</div>
        ${msg}
      </div>
    `;
    return;
  }

  // Check if any fight has odds
  const anyOdds = fights.some(f => f.has_odds);
  let noOddsNote = '';
  if (!isCompleted && fights.length && !anyOdds) {
    noOddsNote = `
      <div class="event-empty" style="padding:20px 0 0">
        No odds available yet — showing model picks only.
      </div>
    `;
  }

  container.innerHTML = noOddsNote + '<div class="fights-grid">'
    + fights.map((f, i) => fightCard(f, i, fights.length, isCompleted)).join('')
    + '</div>';
}

// ── Fight card ────────────────────────────────────────────────────────────────

function fightCard(fight, index, total, isCompleted) {
  const f1 = fight.fighter1;
  const f2 = fight.fighter2;
  const isMain = index === 0;
  const hasValue = !!fight.value_fighter;

  const resultKnown = isCompleted && fight.winner != null;
  const f1Won = resultKnown && fight.winner === f1.name;
  const f2Won = resultKnown && fight.winner === f2.name;

  return `
    <div class="fight-card ${hasValue ? 'has-value' : ''} ${isMain ? 'main-event' : ''}">
      <div class="fight-card-header">
        <span class="weight-class">${esc(fight.weight_class || 'Catchweight')}</span>
        ${isMain
          ? '<span class="main-event-tag">Main Event</span>'
          : `<span class="fight-num">Fight ${total - index}</span>`}
      </div>
      <div class="matchup">
        ${fighterBlock(f1, 'f1', f1Won, resultKnown && !f1Won)}
        <div class="vs-divider">VS</div>
        ${fighterBlock(f2, 'f2', f2Won, resultKnown && !f2Won)}
      </div>
      ${probBar(f1, f2)}
      ${statsSection(f1.stats, f2.stats)}
      ${valueBetSection(fight, isCompleted)}
    </div>
  `;
}

function fighterBlock(f, side, won, lost) {
  const oddsHtml = f.odds != null
    ? oddsTag(f.odds)
    : '<span class="odds-value odds-none">N/A</span>';
  const align = side === 'f2' ? 'f2' : '';
  const resultCls = won ? 'fighter-won' : lost ? 'fighter-lost' : '';
  let mark = '';
  if (won) mark = '<div class="winner-mark">✓ Winner</div>';
  else if (lost) mark = '<div class="loser-mark">✗</div>';

  return `
    <div class="fighter-block ${align} ${resultCls}">
      <div class="fighter-name">${esc(f.name || '—')}</div>
      <div class="fighter-record">${esc(f.stats && f.stats.record ? f.stats.record : '—')}</div>
      ${f.stats && f.stats.stance ? `<div class="fighter-stance">${esc(f.stats.stance)}</div>` : ''}
      <div class="fighter-odds-block">${oddsHtml}</div>
      ${mark}
    </div>
  `;
}

function oddsTag(american) {
  const cls = american < 0 ? 'odds-fav' : 'odds-dog';
  const display = american > 0 ? `+${american}` : `${american}`;
  return `<span class="odds-value ${cls}">${display}</span>`;
}

function probBar(f1, f2) {
  const p1 = f1.model_prob || 50;
  const p2 = f2.model_prob || 50;
  return `
    <div class="prob-section">
      <div class="prob-label">Model Win Probability</div>
      <div class="prob-bar-wrap">
        <span class="prob-num f1">${p1}%</span>
        <div class="prob-bar">
          <div class="prob-bar-f1" style="width:${p1}%"></div>
          <div class="prob-bar-f2"></div>
        </div>
        <span class="prob-num f2">${p2}%</span>
      </div>
    </div>
  `;
}

function statsSection(s1, s2) {
  s1 = s1 || {};
  s2 = s2 || {};

  const stats = [
    { label: 'SLpM', k: 'slpm', fmt: v => v.toFixed(2), lower: false },
    { label: 'Str Acc', k: 'str_acc', fmt: v => (v * 100).toFixed(0) + '%', lower: false },
    { label: 'SApM', k: 'sapm', fmt: v => v.toFixed(2), lower: true },
    { label: 'Str Def', k: 'str_def', fmt: v => (v * 100).toFixed(0) + '%', lower: false },
    { label: 'TD Avg', k: 'td_avg', fmt: v => v.toFixed(2), lower: false },
    { label: 'TD Def', k: 'td_def', fmt: v => (v * 100).toFixed(0) + '%', lower: false },
  ];

  const id = 'stats_' + Math.random().toString(36).slice(2, 7);
  const rows = stats.map(st => {
    const v1 = s1[st.k] || 0;
    const v2 = s2[st.k] || 0;
    if (v1 === 0 && v2 === 0) return '';

    const f1better = st.lower ? v1 < v2 : v1 > v2;
    const max = Math.max(v1, v2, 0.001);
    const w1 = Math.round((v1 / max) * 100);
    const w2 = Math.round((v2 / max) * 100);

    return `
      <div class="stat-row">
        <div class="stat-side left">
          <span class="stat-num left ${f1better ? 'better' : 'worse'}">${st.fmt(v1)}</span>
          <div class="stat-bar-track">
            <div class="stat-bar-fill" style="width:${w1}%;float:right"></div>
          </div>
        </div>
        <div class="stat-label">${st.label}</div>
        <div class="stat-side right">
          <div class="stat-bar-track">
            <div class="stat-bar-fill" style="width:${w2}%"></div>
          </div>
          <span class="stat-num right ${!f1better ? 'better' : 'worse'}">${st.fmt(v2)}</span>
        </div>
      </div>
    `;
  }).filter(Boolean).join('');

  if (!rows) return '';

  return `
    <div class="stats-section">
      <div class="stats-toggle" onclick="toggleStats('${id}')">
        <span id="toggle_${id}">▸</span> Fighter Stats
      </div>
      <div class="stats-grid hidden" id="${id}">${rows}</div>
    </div>
  `;
}

function toggleStats(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById('toggle_' + id);
  if (el.classList.contains('hidden')) {
    el.classList.remove('hidden');
    arrow.textContent = '▾';
  } else {
    el.classList.add('hidden');
    arrow.textContent = '▸';
  }
}

function valueBetSection(fight, isCompleted) {
  if (!fight.value_fighter || !fight.value_reasons || !fight.value_reasons.length) {
    return '';
  }

  const f1 = fight.fighter1;
  const f2 = fight.fighter2;
  const isF1 = fight.value_fighter === f1.name;
  const fighter = isF1 ? f1 : f2;

  const edgeHtml = fighter.edge != null && fight.has_odds
    ? `<span class="value-edge">+${fighter.edge}% edge</span>`
    : (!fight.has_odds ? '<span class="value-edge model-only-note">No odds — model pick only</span>' : '');

  let outcomeHtml = '';
  if (isCompleted && fight.winner) {
    if (fight.winner === fight.value_fighter) {
      outcomeHtml = '<span class="pick-correct">✓ Correct</span>';
    } else {
      outcomeHtml = '<span class="pick-incorrect">✗ Incorrect</span>';
    }
  }

  const reasons = fight.value_reasons.map(r => `<li>${esc(r)}</li>`).join('');

  return `
    <div class="value-section">
      <div class="value-header">
        <span class="value-badge">${fight.has_odds ? 'Value Bet' : 'Model Pick'}</span>
        <span class="value-fighter-name">${esc(fight.value_fighter)}</span>
        ${edgeHtml}
        ${outcomeHtml}
      </div>
      <ul class="value-reasons">${reasons}</ul>
    </div>
  `;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Load sidebar events list in the background — fast (just list pages, no fighter stats)
  loadEventsIndex();
  // Load next upcoming event (default view)
  await loadNextEvent();
}

init();
