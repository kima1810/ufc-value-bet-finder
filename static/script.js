let currentData = null;

async function loadEvent(force = false) {
  showLoading();
  try {
    const url = force ? '/api/refresh' : '/api/event';
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to load event');
    currentData = data;
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

function render(data) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.add('hidden');
  document.getElementById('content').classList.remove('hidden');
  document.getElementById('refreshBtn').textContent = '↻ Refresh';

  renderEventHeader(data);
  renderFights(data.fights || []);
}

function renderEventHeader(data) {
  const el = document.getElementById('eventHeader');
  el.innerHTML = `
    <div>
      <div class="event-name">${esc(data.name)}</div>
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
    <span class="event-badge">Upcoming</span>
  `;
}

function renderFights(fights) {
  const container = document.getElementById('fights');
  if (!fights.length) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:40px 0;text-align:center">No fights found for this event.</p>';
    return;
  }
  container.innerHTML = '<div class="fights-grid">' + fights.map((f, i) => fightCard(f, i, fights.length)).join('') + '</div>';
}

function fightCard(fight, index, total) {
  const f1 = fight.fighter1;
  const f2 = fight.fighter2;
  const isMain = index === 0;
  const hasValue = !!fight.value_fighter;

  return `
    <div class="fight-card ${hasValue ? 'has-value' : ''} ${isMain ? 'main-event' : ''}">
      <div class="fight-card-header">
        <span class="weight-class">${esc(fight.weight_class || 'Catchweight')}</span>
        ${isMain ? '<span class="main-event-tag">Main Event</span>' : `<span class="fight-num">Fight ${total - index}</span>`}
      </div>

      <div class="matchup">
        ${fighterBlock(f1, 'f1')}
        <div class="vs-divider">VS</div>
        ${fighterBlock(f2, 'f2')}
      </div>

      ${probBar(f1, f2)}
      ${statsSection(f1.stats, f2.stats)}
      ${valueBetSection(fight)}
    </div>
  `;
}

function fighterBlock(f, side) {
  const oddsHtml = f.odds != null ? oddsTag(f.odds) : '<span class="odds-value odds-none">N/A</span>';
  const align = side === 'f2' ? 'f2' : '';
  return `
    <div class="fighter-block ${align}">
      <div class="fighter-name">${esc(f.name || '—')}</div>
      <div class="fighter-record">${esc(f.stats && f.stats.record ? f.stats.record : '—')}</div>
      ${f.stats && f.stats.stance ? `<div class="fighter-stance">${esc(f.stats.stance)}</div>` : ''}
      <div class="fighter-odds-block">${oddsHtml}</div>
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

function valueBetSection(fight) {
  if (!fight.value_fighter || !fight.value_reasons || !fight.value_reasons.length) {
    return '';
  }

  const f1 = fight.fighter1;
  const f2 = fight.fighter2;
  const isF1 = fight.value_fighter === f1.name;
  const fighter = isF1 ? f1 : f2;

  const edgeHtml = fighter.edge != null && fight.has_odds
    ? `<span class="value-edge">+${fighter.edge}% edge</span>`
    : (!fight.has_odds ? '<span class="value-edge model-only-note">No odds data — model pick only</span>' : '');

  const reasons = fight.value_reasons.map(r => `<li>${esc(r)}</li>`).join('');

  return `
    <div class="value-section">
      <div class="value-header">
        <span class="value-badge">${fight.has_odds ? 'Value Bet' : 'Model Pick'}</span>
        <span class="value-fighter-name">${esc(fight.value_fighter)}</span>
        ${edgeHtml}
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

loadEvent();
