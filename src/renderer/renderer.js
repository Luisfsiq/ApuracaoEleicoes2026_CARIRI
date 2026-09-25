const formatNumber = new Intl.NumberFormat('pt-BR');
const formatDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

const state = {
  data: null,
  sections: [],
  edits: new Map(),
  storageKey: '',
  sectionPage: 0,
  sectionPageSize: 12,
  toastTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function sumVotes(section) {
  return Object.values(section.votes).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function storageKeyFor(data) {
  return `cariri-apuracao:${data.source.name}:${data.source.modifiedAt}`;
}

function loadSavedEdits() {
  state.edits = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(state.storageKey) || '[]');
    saved.forEach((edit) => state.edits.set(edit.id, edit));
  } catch {
    localStorage.removeItem(state.storageKey);
  }
}

function applyEdits() {
  state.sections = state.data.sections.map((section) => {
    const edit = state.edits.get(section.id);
    return edit ? { ...section, status: edit.status, votes: { ...section.votes, ...edit.votes } } : { ...section, votes: { ...section.votes } };
  });
}

function persistEdits() {
  localStorage.setItem(state.storageKey, JSON.stringify([...state.edits.values()]));
}

function showToast(message, type = 'success') {
  const toast = $('#toast');
  toast.textContent = message;
  toast.className = `toast show${type === 'error' ? ' error' : ''}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3400);
}

function municipalitySummary(name) {
  const sections = state.sections.filter((item) => item.municipality === name);
  const counted = sections.filter((item) => item.status === 'Apurada').length;
  return {
    sections,
    counted,
    pending: sections.length - counted,
    progress: sections.length ? counted / sections.length : 0,
  };
}

function raceTotals(sections = state.sections) {
  return state.data.offices.map((office) => {
    const candidates = state.data.candidates
      .filter((candidate) => candidate.officeId === office.id)
      .map((candidate) => ({
        ...candidate,
        votes: sections.reduce((sum, section) => sum + (Number(section.votes[candidate.id]) || 0), 0),
      }));
    const total = candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
    return { ...office, candidates, total };
  });
}

function sectionStatusMarkup(status) {
  const counted = status === 'Apurada';
  return `<span class="status-pill ${counted ? 'counted' : 'pending'}">${counted ? 'Apurada' : 'Pendente'}</span>`;
}

function renderDashboard() {
  const total = state.sections.length;
  const counted = state.sections.filter((section) => section.status === 'Apurada').length;
  const progress = total ? counted / total : 0;
  const locations = new Set(state.sections.map((section) => `${section.municipality}|${section.location}`)).size;
  $('#countedSections').textContent = formatNumber.format(counted);
  $('#totalSections').textContent = formatNumber.format(total);
  $('#pendingSections').textContent = formatNumber.format(total - counted);
  $('#progressPercent').textContent = `${Math.round(progress * 100)}%`;
  $('#progressRing').style.setProperty('--progress', `${progress * 360}deg`);
  $('#municipalityCount').textContent = formatNumber.format(state.data.municipalities.length);
  $('#locationCount').textContent = formatNumber.format(locations);
  $('#emptyNotice').hidden = counted !== 0 || state.sections.some((section) => sumVotes(section) > 0);

  const ranked = state.data.municipalities
    .map((municipality) => ({ ...municipality, ...municipalitySummary(municipality.name) }))
    .sort((a, b) => b.progress - a.progress || b.counted - a.counted || a.name.localeCompare(b.name, 'pt-BR'));
  const leader = ranked[0];
  if (!leader || leader.counted === 0) {
    $('#leadingMunicipality').textContent = '—';
    $('#leadingMunicipalityMeta').textContent = 'Nenhuma seção apurada';
  } else {
    $('#leadingMunicipality').textContent = leader.name;
    $('#leadingMunicipalityMeta').textContent = `${leader.counted} de ${leader.sections.length} seções • ${Math.round(leader.progress * 100)}%`;
  }

  $('#raceCards').innerHTML = raceTotals().map((race) => {
    const max = Math.max(...race.candidates.map((candidate) => candidate.votes));
    const content = race.total === 0
      ? `<div class="race-empty"><div><strong>Aguardando votos</strong><span>Os resultados aparecem após o primeiro lançamento.</span></div></div>`
      : race.candidates
        .sort((a, b) => b.votes - a.votes)
        .map((candidate) => {
          const share = candidate.votes / race.total;
          return `<div class="candidate-row ${candidate.votes === max ? 'leader' : ''}">
            <div class="candidate-name"><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.party || 'Sem partido informado')}</small></div>
            <div class="candidate-value"><strong>${formatNumber.format(candidate.votes)}</strong><span>${(share * 100).toFixed(1).replace('.', ',')}%</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${share * 100}%"></div></div>
          </div>`;
        }).join('');
    return `<article class="race-card">
      <div class="race-card-head"><h3>${escapeHtml(race.label)}</h3><span class="race-total">${formatNumber.format(race.total)} votos</span></div>
      ${content}
    </article>`;
  }).join('');

  $('#municipalityProgress').innerHTML = ranked.map((municipality) => `
    <div class="municipality-progress-item">
      <div class="municipality-progress-top"><strong>${escapeHtml(municipality.name)}</strong><span>${municipality.counted}/${municipality.sections.length}</span></div>
      <div class="thin-track"><i style="width:${municipality.progress * 100}%"></i></div>
    </div>
  `).join('');
}

function getRaceLeader(race) {
  if (!race.total) return { label: 'Aguardando votos', votes: 0 };
  const max = Math.max(...race.candidates.map((candidate) => candidate.votes));
  const leaders = race.candidates.filter((candidate) => candidate.votes === max);
  return {
    label: leaders.length > 1 ? 'Empate' : leaders[0].label,
    votes: max,
  };
}

function renderMunicipalities() {
  $('#municipalityCards').innerHTML = state.data.municipalities.map((municipality) => {
    const summary = municipalitySummary(municipality.name);
    const leaders = raceTotals(summary.sections).map((race) => ({ race, leader: getRaceLeader(race) }));
    return `<article class="municipality-card">
      <div class="municipality-card-head"><h2>${escapeHtml(municipality.name)}</h2><span class="zone-badge">ZONA ${escapeHtml(municipality.zone)}</span></div>
      <div class="municipality-metrics">
        <div><strong>${formatNumber.format(municipality.locations)}</strong><span>locais</span></div>
        <div><strong>${formatNumber.format(municipality.sections)}</strong><span>seções</span></div>
        <div><strong>${formatNumber.format(summary.counted)}</strong><span>apuradas</span></div>
      </div>
      <div class="progress-label"><span>Progresso</span><b>${Math.round(summary.progress * 100)}%</b></div>
      <div class="thin-track"><i style="width:${summary.progress * 100}%"></i></div>
      <div class="municipality-leaders">
        <span>Líderes no município</span>
        ${leaders.map(({ race, leader }) => `<div class="leader-line"><b>${escapeHtml(race.label)}: ${escapeHtml(leader.label)}</b><em>${formatNumber.format(leader.votes)}</em></div>`).join('')}
      </div>
      <button class="button" data-filter-municipality="${escapeHtml(municipality.name)}">Ver seções →</button>
    </article>`;
  }).join('');
}

function filteredSections() {
  const query = normalizeSearch($('#sectionSearch').value);
  const municipality = $('#sectionMunicipalityFilter').value;
  const status = $('#sectionStatusFilter').value;
  return state.sections.filter((section) => {
    const haystack = normalizeSearch(`${section.municipality} ${section.location} ${section.zone} ${section.section}`);
    return (!query || haystack.includes(query))
      && (!municipality || section.municipality === municipality)
      && (!status || section.status === status);
  });
}

function renderSections() {
  const sections = filteredSections();
  const pageCount = Math.max(1, Math.ceil(sections.length / state.sectionPageSize));
  state.sectionPage = Math.min(state.sectionPage, pageCount - 1);
  const start = state.sectionPage * state.sectionPageSize;
  const visible = sections.slice(start, start + state.sectionPageSize);
  $('#sectionResultCount').textContent = formatNumber.format(sections.length);
  $('#sectionsTableBody').innerHTML = visible.map((section) => `
    <tr>
      <td><strong>${escapeHtml(section.municipality)}</strong></td>
      <td>${escapeHtml(section.zone)}</td>
      <td class="location-cell" title="${escapeHtml(section.location)}">${escapeHtml(section.location)}</td>
      <td>${escapeHtml(section.section)}</td>
      <td>${sectionStatusMarkup(section.status)}</td>
      <td>${formatNumber.format(sumVotes(section))}</td>
      <td><button class="row-action" data-edit-section="${escapeHtml(section.id)}">Editar</button></td>
    </tr>
  `).join('');
  $('#sectionsEmpty').hidden = sections.length > 0;
  $('#paginationInfo').textContent = sections.length
    ? `Mostrando ${start + 1}–${Math.min(start + state.sectionPageSize, sections.length)} de ${sections.length}`
    : 'Nenhum resultado';
  $('#previousPage').disabled = state.sectionPage === 0;
  $('#nextPage').disabled = state.sectionPage >= pageCount - 1;
}

function renderFilterOptions() {
  const options = `<option value="">Todos os municípios</option>${state.data.municipalities
    .map((municipality) => `<option value="${escapeHtml(municipality.name)}">${escapeHtml(municipality.name)}</option>`).join('')}`;
  $('#sectionMunicipalityFilter').innerHTML = options;
  $('#entryMunicipality').innerHTML = state.data.municipalities
    .map((municipality) => `<option value="${escapeHtml(municipality.name)}">${escapeHtml(municipality.name)}</option>`).join('');
}

function refreshEntryLocations(preferredLocation, preferredSection) {
  const municipality = $('#entryMunicipality').value;
  const locations = [...new Set(state.sections.filter((item) => item.municipality === municipality).map((item) => item.location))];
  $('#entryLocation').innerHTML = locations.map((location) => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('');
  if (preferredLocation && locations.includes(preferredLocation)) $('#entryLocation').value = preferredLocation;
  refreshEntrySections(preferredSection);
}

function refreshEntrySections(preferredSection) {
  const municipality = $('#entryMunicipality').value;
  const location = $('#entryLocation').value;
  const sections = state.sections.filter((item) => item.municipality === municipality && item.location === location);
  $('#entrySection').innerHTML = sections.map((section) => `<option value="${escapeHtml(section.id)}">Seção ${escapeHtml(section.section)}</option>`).join('');
  if (preferredSection && sections.some((section) => section.id === preferredSection)) $('#entrySection').value = preferredSection;
  renderEntryForm();
}

function renderEntryForm() {
  const section = state.sections.find((item) => item.id === $('#entrySection').value);
  if (!section) return;
  $('#entryStatus').value = section.status;
  $('#selectedSectionMeta').innerHTML = `<strong>${escapeHtml(section.municipality)} • Seção ${escapeHtml(section.section)}</strong><br>Zona ${escapeHtml(section.zone)}<br>${escapeHtml(section.location)}<br>${formatNumber.format(section.registeredAtLocation)} eleitores no local (referência)`;
  $('#candidateInputs').innerHTML = state.data.offices.map((office) => {
    const candidates = state.data.candidates.filter((candidate) => candidate.officeId === office.id);
    return `<section class="candidate-group">
      <h3>${escapeHtml(office.label)}</h3>
      ${candidates.map((candidate) => `<div class="vote-field">
        <label for="vote-${escapeHtml(candidate.id)}"><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.party || 'Partido não informado')}</small></label>
        <input id="vote-${escapeHtml(candidate.id)}" data-candidate-id="${escapeHtml(candidate.id)}" type="number" min="0" step="1" inputmode="numeric" value="${Number(section.votes[candidate.id]) || 0}" />
      </div>`).join('')}
    </section>`;
  }).join('');
  updateEntryTotal();
}

function updateEntryTotal() {
  const total = $$('[data-candidate-id]').reduce((sum, input) => sum + Math.max(0, Math.trunc(Number(input.value) || 0)), 0);
  $('#entryTotal').textContent = formatNumber.format(total);
}

function openEntry(sectionId) {
  const section = state.sections.find((item) => item.id === sectionId);
  if (!section) return;
  navigate('entry');
  $('#entryMunicipality').value = section.municipality;
  refreshEntryLocations(section.location, section.id);
}

function saveEntry(event) {
  event.preventDefault();
  const section = state.sections.find((item) => item.id === $('#entrySection').value);
  if (!section) return;
  const votes = {};
  for (const input of $$('[data-candidate-id]')) {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      input.focus();
      showToast('Use somente números inteiros iguais ou maiores que zero.', 'error');
      return;
    }
    votes[input.dataset.candidateId] = value;
  }
  const edit = {
    id: section.id,
    sheetName: section.sheetName,
    rowNumber: section.rowNumber,
    status: $('#entryStatus').value,
    votes,
  };
  state.edits.set(section.id, edit);
  persistEdits();
  applyEdits();
  renderAll();
  $('#entryMunicipality').value = section.municipality;
  refreshEntryLocations(section.location, section.id);
  showToast(`Seção ${section.section} de ${section.municipality} salva.`);
}

function clearEntry() {
  $$('[data-candidate-id]').forEach((input) => { input.value = 0; });
  $('#entryStatus').value = 'Pendente';
  updateEntryTotal();
}

function renderAll() {
  renderDashboard();
  renderMunicipalities();
  renderSections();
}

function navigate(page) {
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
  $$('.page').forEach((item) => item.classList.toggle('active', item.dataset.pageContent === page));
  window.scrollTo(0, 0);
}

function initializeData(data) {
  state.data = data;
  state.storageKey = storageKeyFor(data);
  loadSavedEdits();
  applyEdits();
  state.sectionPage = 0;
  $('#sourceName').textContent = data.source.name;
  $('#sourceName').title = data.source.name;
  $('#sourceDate').textContent = formatDate.format(new Date(data.source.modifiedAt));
  renderFilterOptions();
  refreshEntryLocations();
  renderAll();
}

async function importWorkbook() {
  const button = $('#importButton');
  button.disabled = true;
  try {
    const data = await window.electionAPI.openWorkbook();
    if (data) {
      initializeData(data);
      navigate('dashboard');
      showToast(`Planilha ${data.source.name} importada.`);
    }
  } catch (error) {
    showToast(error.message || 'Não foi possível importar a planilha.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function exportWorkbook() {
  const button = $('#exportButton');
  button.disabled = true;
  try {
    const result = await window.electionAPI.exportWorkbook({
      edits: [...state.edits.values()],
      candidates: state.data.candidates,
    });
    if (result) showToast(`Cópia salva como ${result.name}.`);
  } catch (error) {
    showToast(error.message || 'Não foi possível exportar a planilha.', 'error');
  } finally {
    button.disabled = false;
  }
}

function bindEvents() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.page)));
  document.addEventListener('click', (event) => {
    const go = event.target.closest('[data-go]');
    if (go) navigate(go.dataset.go);

    const municipalityButton = event.target.closest('[data-filter-municipality]');
    if (municipalityButton) {
      navigate('sections');
      $('#sectionMunicipalityFilter').value = municipalityButton.dataset.filterMunicipality;
      state.sectionPage = 0;
      renderSections();
    }

    const editButton = event.target.closest('[data-edit-section]');
    if (editButton) openEntry(editButton.dataset.editSection);
  });
  $('#importButton').addEventListener('click', importWorkbook);
  $('#exportButton').addEventListener('click', exportWorkbook);
  $('#sectionSearch').addEventListener('input', () => { state.sectionPage = 0; renderSections(); });
  $('#sectionMunicipalityFilter').addEventListener('change', () => { state.sectionPage = 0; renderSections(); });
  $('#sectionStatusFilter').addEventListener('change', () => { state.sectionPage = 0; renderSections(); });
  $('#previousPage').addEventListener('click', () => { state.sectionPage -= 1; renderSections(); });
  $('#nextPage').addEventListener('click', () => { state.sectionPage += 1; renderSections(); });
  $('#entryMunicipality').addEventListener('change', () => refreshEntryLocations());
  $('#entryLocation').addEventListener('change', () => refreshEntrySections());
  $('#entrySection').addEventListener('change', renderEntryForm);
  $('#candidateInputs').addEventListener('input', updateEntryTotal);
  $('#entryForm').addEventListener('submit', saveEntry);
  $('#clearEntryButton').addEventListener('click', clearEntry);
}

async function boot() {
  bindEvents();
  try {
    const data = await window.electionAPI.loadDefault();
    initializeData(data);
    const requestedPage = new URLSearchParams(window.location.search).get('page');
    if (requestedPage && document.querySelector(`[data-page-content="${requestedPage}"]`)) navigate(requestedPage);
    $('#app').hidden = false;
    $('#loadingScreen').remove();
  } catch (error) {
    $('#loadingScreen').innerHTML = `<div><strong>Não foi possível abrir a base inicial.</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

boot();
