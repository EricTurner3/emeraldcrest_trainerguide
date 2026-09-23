import { CONFIG } from './config.js';

const $ = (sel) => document.querySelector(sel);
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABELS = ['HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE'];
const TYPE_COLORS = {
  normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C', grass: '#7AC74C', ice: '#96D9D6',
  fighting: '#C22E28', poison: '#A33EA1', ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
  rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC', dark: '#705746', steel: '#B7B7CE', fairy: '#D685AD', stellar: '#44685E'
};
const DEFAULTS = { levels: ['20', '20', '20', '', '', ''], badges: '0', difficulty: '2', bugfix: true, gym: false, post: false,
                   saved: '', iv: '', ev: '', pick: 'likely', cls: 'ALL', trainer: '' };

let backend, trainers = [], seq = 0, timer = null;
let currentView = 'calc';

// The calculator engine wants a flat dex.json-shaped array: [{name, type1, type2, base:{hp,atk,def,spa,spd,spe}}, ...].
// pokemon.json stores stats as a per-gen timeline instead (see statAt() below), so this
// resolves one gen's worth of stats and reshapes each entry into that flat form.
const CALC_STATS_GEN = 9; // which gen's stat revisions the trainer calculator itself uses
function buildDexArray(pokedexArr, gen) {
  return pokedexArr.map((m) => {
    const s = dexRowStats(m, gen);
    const t = displayTypes(m.types);
    return { name: m.name, type1: t[0] || '', type2: t[1] || '', base: { hp: s.hp, atk: s.atk, def: s.def, spa: s.spa, spd: s.spd, spe: s.spe } };
  });
}

// ---------------------------------------------------------------- backend (local engine or remote API)
async function loadBackend() {
  // Everything runs in the browser: the game logic is engine.mjs, the data is the JSON files in /data,
  // plus pokemon.json (species/types/abilities/items/stats) which now also supplies the calculator's dex.
  const get = (f) => fetch('data/' + f + '.json').then((r) => { if (!r.ok) throw new Error('Could not load data/' + f + '.json'); return r.json(); });
  const [engine, trainers, parties, evo, learn, pokedexArr, overrides, moves] = await Promise.all([
    import('./engine_obs.mjs'), get('trainers'), get('parties'), get('evolutions'), get('learnsets'), loadDex(), get('speciesmap'),
    get('moves').catch(() => ({}))                       // optional: moves.json  {\"MOVE_POUND\": {\"type\": \"TYPE_NORMAL\"}, ...}
  ]);
  const dex = buildDexArray(pokedexArr, CALC_STATS_GEN);
  const data = { trainers, parties, evo, learn, dex, overrides };
  // move display name ("Will-O-Wisp") and MOVE_WILL_O_WISP both normalise to "willowisp"
  moveTypes = {};
  Object.entries(moves).forEach(([k, v]) => { if (v && v.type) moveTypes[slugKey(k.replace(/^MOVE_/, ''))] = typeLabel(v.type); });
  return {
    trainers: async () => engine.listTrainers(data),
    calc: async (input) => {
      const res = engine.calculate(data, input);
      if (res.ok) {                                     // trainers.json "items": ["ITEM_FULL_RESTORE", ..., "ITEM_NONE"]
        const t = data.trainers.find((x) => x.id === input.trainerId);
        res.trainer.items = ((t && t.items) || []).filter((i) => i && i !== 'ITEM_NONE').map(prettyItem);
      }
      return res;
    }
  };
}

let moveTypes = {};
const slugKey = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function typeLabel(t) { return String(t).replace(/^TYPE_/, '').split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' '); }
function prettyItem(c) {
  const fix = { ITEM_POKE_BALL: 'Poké Ball' };
  return fix[c] || c.replace(/^ITEM_/, '').split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

// ---- item sprites:  <ITEM_SPRITE_BASE>[berry/]<lower-case-hyphenated-name><ITEM_SPRITE_EXT> ----
function itemSpriteUrl(name) {
  if (!name || name === '-') return null;
  const slug = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  if (!slug) return null;
  const base = CONFIG.ITEM_SPRITE_BASE !== undefined ? CONFIG.ITEM_SPRITE_BASE : 'sprites/item/';
  var sprite_url= base + (slug.endsWith('-berry') ? 'berry/' : '') + (slug.endsWith('-berry') ? slug.replace(/-berry$/, '') : slug) + (CONFIG.ITEM_SPRITE_EXT || '.png');
  //console.log('itemSpriteUrl', name, slug, sprite_url);
  return sprite_url;
}
function itemIcon(name) {
  const url = itemSpriteUrl(name);
  if (!url) return null;
  const img = el('img', 'ico'); img.src = url; img.alt = ''; img.loading = 'lazy';
  img.addEventListener('error', () => img.remove());     // missing sprite -> just the text
  return img;
}
function itemRow(name, rarity, skipIcon=false) {
  const row = el('div', 'irow');
  if(rarity) row.appendChild(el('span', 'nm', rarity));
  row.appendChild(el('span', 'nm', name || '-'));
  if (!skipIcon) {
    const ico = itemIcon(name); if (ico) row.appendChild(ico);
  }
  return row;
}
function moveRow(name) {
  const row = el('div', 'irow');
  row.appendChild(el('span', 'nm', name || '-'));
  const t = name && moveTypes[slugKey(name)];
  if (t) row.appendChild(typeChip(t, true));
  return row;
}

// ---------------------------------------------------------------- state <-> form <-> URL
function buildForm() {
  const box = $('#levels');
  for (let i = 0; i < 6; i++) {
    const inp = el('input'); inp.type = 'number'; inp.min = '1'; inp.max = '100'; inp.id = 'lv' + i;
    inp.setAttribute('aria-label', 'Party slot ' + (i + 1) + ' level'); inp.placeholder = String(i + 1);
    box.appendChild(inp);
  }
  const b = $('#badges');
  for (let i = 0; i <= 8; i++) { const o = el('option', '', String(i)); o.value = String(i); b.appendChild(o); }
}

function readState() {
  return {
    levels: [0, 1, 2, 3, 4, 5].map((i) => $('#lv' + i).value.trim()),
    badges: $('#badges').value, difficulty: $('#difficulty').value,
    bugfix: $('#bugfix').checked, gym: $('#gym').checked, post: $('#post').checked,
    saved: $('#saved').value.trim(), iv: $('#iv').value.trim(), ev: $('#ev').value.trim(),
    pick: $('#pick').value, cls: $('#cls').value, trainer: $('#trainer').value
  };
}
function writeState(s) {
  s.levels.forEach((v, i) => { $('#lv' + i).value = v; });
  $('#badges').value = s.badges; $('#difficulty').value = s.difficulty;
  $('#bugfix').checked = s.bugfix; $('#gym').checked = s.gym; $('#post').checked = s.post;
  $('#saved').value = s.saved; $('#iv').value = s.iv; $('#ev').value = s.ev; $('#pick').value = s.pick;
}
function stateFromURL() {
  const q = new URLSearchParams(location.search), s = JSON.parse(JSON.stringify(DEFAULTS));
  if (q.has('l')) { const a = q.get('l').split(','); s.levels = [0, 1, 2, 3, 4, 5].map((i) => (a[i] || '').replace(/\D/g, '')); }
  const map = { b: 'badges', d: 'difficulty', s: 'saved', iv: 'iv', ev: 'ev', p: 'pick', k: 'cls', t: 'trainer' };
  for (const [k, f] of Object.entries(map)) if (q.has(k)) s[f] = q.get(k);
  for (const [k, f] of [['f', 'bugfix'], ['g', 'gym'], ['c', 'post']]) if (q.has(k)) s[f] = q.get(k) === '1';
  return s;
}
function stateToURL(s) {
  const q = new URLSearchParams();
  q.set('l', s.levels.join(',')); q.set('b', s.badges); q.set('d', s.difficulty);
  q.set('f', s.bugfix ? '1' : '0'); q.set('g', s.gym ? '1' : '0'); q.set('c', s.post ? '1' : '0');
  if (s.saved) q.set('s', s.saved); if (s.iv) q.set('iv', s.iv); if (s.ev) q.set('ev', s.ev);
  if (s.pick !== 'likely') q.set('p', s.pick);
  q.set('k', s.cls); q.set('t', s.trainer);
  return q;
}

// ---- tab <-> URL: ?tab=calc|dex|items. Only the active tab's own params are kept in the URL -
// the calc tab gets its full form state, dex/items just keep a search term (?q=) if one is set. ----
function tabFromURL() {
  const t = new URLSearchParams(location.search).get('tab');
  return (t === 'dex' || t === 'items') ? t : 'calc';
}
function searchFromURL() {
  return new URLSearchParams(location.search).get('q') || '';
}
function buildViewURL(view) {
  const q = view === 'calc' ? stateToURL(readState()) : new URLSearchParams();
  if (view !== 'calc') {
    const input = view === 'dex' ? $('#dexSearch') : $('#itemSearch');
    const val = input ? input.value.trim() : '';
    if (val) q.set('q', val);
  }
  q.set('tab', view);
  return q;
}
function syncURL(view) {
  try { history.replaceState(null, '', location.pathname + '?' + buildViewURL(view).toString()); } catch (e) { /* ignore (e.g. sandboxed frames) */ }
}

function fillClassSelect(current) {
  const sel = $('#cls'); sel.innerHTML = '';
  const seen = ['ALL'];
  // sorted by class name
  var trainers_sorted = trainers.slice().sort((a, b) => a.classLabel.localeCompare(b.classLabel));
  trainers_sorted.forEach((t) => { if (!seen.includes(t.cls)) seen.push(t.cls); });
  seen.forEach((c) => {
    const label = c === 'ALL' ? 'ALL' : (trainers_sorted.find((t) => t.cls === c).classLabel || c);
    const o = el('option', '', label); o.value = c; sel.appendChild(o);
  });
  sel.value = seen.includes(current) ? current : 'ALL';
}
function fillTrainerSelect(cls, current) {
  const sel = $('#trainer'); sel.innerHTML = '';
  var trainers_sorted = trainers.slice().sort((a, b) => a.name.localeCompare(b.name));
  const list = trainers_sorted.filter((t) => cls === 'ALL' || t.cls === cls);
  list.forEach((t) => { const o = el('option', '', t.id); o.value = t.id; sel.appendChild(o); });
  sel.value = list.some((t) => t.id === current) ? current : (list[0] ? list[0].id : '');
}
function stepTrainer(dir) {
  const sel = $('#trainer'), n = sel.options.length;
  if (!n) return;
  sel.selectedIndex = (sel.selectedIndex + dir + n) % n;
  schedule();
}

// ---------------------------------------------------------------- rendering
function typeChip(name, small) {
  const c = el('span', 'chip' + (small ? ' sm' : ''), name);
  c.style.background = TYPE_COLORS[name.toLowerCase()] || '#777';
  return c;
}
// A mono-type Pokémon is stored internally as e.g. ["Normal", "Normal"] -
// collapse that down to a single chip wherever types are shown.
function displayTypes(types) {
  if (!types || !types.length) return [];
  return (types.length > 1 && types[0] === types[1]) ? [types[0]] : types;
}
function barColor(v) { return v <= 29 ? '#f34444' : v <= 59 ? '#ff7f0f' : v <= 89 ? '#ffdd57' : v <= 119 ? '#a0e515' : v <= 149 ? '#23cd5e' : '#00c2b8'; }

// Sprite background: the Pokémon's first type colour, blended into the card's taupe so it stays dull enough
// for the sprite to stand out.  TYPE_TINT = how much of the type colour to keep (0 = plain taupe, 1 = full colour).
const TYPE_TINT = 0.65, BASE_BG = '#a8927f';
function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}

function spriteBox(name, species, type) {
  const box = el('div', 'sprite');
  const tc = type && TYPE_COLORS[String(type).toLowerCase()];
  if (tc) box.style.background = mixHex(tc, BASE_BG, TYPE_TINT);

  // empty box if no name, or if the name is literally "null" (some trainers.json entries have that)
  if (name == null || name == "null") return box;
  // properly format name
  var name = String(name).normalize('NFD').replace(' ', '_');
  // handle region forms by only grabbing first letter
  name = name.replace(/(Alolan|Galarian|Hisuian|Paldean)/, (match) => match[0]);
  //console.log(name);
  let url = null;
  try { url = CONFIG.SPRITE_URL && name ? CONFIG.SPRITE_URL(name) : null; } catch (e) { url = null; }
  if (url) {
    const img = el('img'); img.src = url; img.alt = name; img.loading = 'lazy'; img.width = 150;
    img.addEventListener('error', () => { img.remove(); box.appendChild(placeholder(name)); });
    box.appendChild(img);
  } else if (name) box.appendChild(placeholder(name));
  return box;
}
function placeholder(name) { return el('span', 'ph', name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()); }

function monCard(slot) {
  const card = el('div', 'mon' + (slot ? '' : ' empty'));
  card.appendChild(spriteBox(slot && slot.name, slot && slot.species, slot && slot.types && slot.types[0]));

  const head = el('div', 'head');
  head.appendChild(el('div', 'mname', slot ? slot.name : ''));
  const lv = el('div', 'mlevel', slot ? String(slot.level) : '');
  if (slot && slot.levels !== String(slot.level)) lv.appendChild(el('small', '', 'Lv ' + slot.levels));
  head.appendChild(lv);
  const types = el('div', 'types');
  if (slot) displayTypes(slot.types).forEach((t) => types.appendChild(typeChip(t)));
  head.appendChild(types);
  card.appendChild(head);

  const info = el('div', 'info');
  info.appendChild(el('div', '', slot ? slot.nature : ''));
  info.appendChild(el('div', '', slot ? slot.ability : ''));
  info.appendChild(slot ? itemRow(slot.item || '-') : el('div', 'item', ''));
  card.appendChild(info);

  const moves = el('div', 'moves');
  for (let i = 0; i < 4; i++) moves.appendChild(slot ? moveRow(slot.moves[i] || '-') : el('div', '', ''));
  card.appendChild(moves);

  const stats = el('div', 'stats');
  const sh = el('div', 'sh'); sh.appendChild(el('span', '', 'Base stats')); sh.appendChild(el('span', '', 'EVs')); stats.appendChild(sh);
  STAT_KEYS.forEach((k, i) => {
    const row = el('div', 'sr');
    row.appendChild(el('span', '', STAT_LABELS[i]));
    const base = slot && slot.base ? slot.base[k] : null;
    row.appendChild(el('span', '', base === null || base === undefined ? '' : String(base)));
    const bar = el('div', 'bar');
    if (base) { const fill = el('i'); fill.style.width = Math.min(100, Math.round(base / 200 * 100)) + '%'; fill.style.background = barColor(base); bar.appendChild(fill); }
    row.appendChild(bar);
    row.appendChild(el('div', 'ev', slot ? String(slot.ev[k]) : ''));
    stats.appendChild(row);
  });
  const sp = el('div', 'speed'); sp.appendChild(el('span', '', 'Speed stat:')); sp.appendChild(el('b', '', slot && slot.stats ? String(slot.stats.spe) : ''));
  stats.appendChild(sp);
  card.appendChild(stats);

  if (slot) {
    const extra = [];
    if (slot.outcomes.length > 1) extra.push('outcomes');
    if (slot.notes.length || slot.stats || slot.dex !== 'exact') extra.push('info');
    if (extra.length) {
      const d = el('details', 'alts');
      d.appendChild(el('summary', '', slot.outcomes.length > 1 ? 'Other possible builds (' + (slot.outcomes.length - 1) + ')' : 'Stats & notes'));
      if (slot.stats) d.appendChild(el('div', 'alt', 'Lv ' + slot.level + ' stats: ' + STAT_LABELS.map((l, i) => l + ' ' + slot.stats[STAT_KEYS[i]]).join(' · ') + '  (IV ' + slot.iv + ')'));
      if (slot.outcomes.length > 1) {
        slot.outcomes.forEach((o) => {
          const a = el('div', 'alt' + (o.shown ? ' shown' : ''));
          a.appendChild(document.createTextNode((o.shown ? '► ' : '• ') + pct(o.chance) + '  ' + o.name + '  Lv ' + o.levels + (o.notes.length ? ' (' + o.notes.join('; ') + ')' : '')));
          a.appendChild(el('div', 'm', o.moves.filter(Boolean).join(', ') || '-'));
          d.appendChild(a);
        });
      } else if (slot.notes.length) d.appendChild(el('div', 'alt', slot.notes.join('; ')));
      if (slot.dex !== 'exact') d.appendChild(el('div', 'alt', slot.dex === 'none' ? 'Not found in the Dex data.' : 'Form not in the Dex data – base species stats shown.'));
      card.appendChild(d);
    }
  }
  return card;
}
function pct(p) { return p >= 0.9995 ? '100%' : (Math.round(p * 1000) / 10) + '%'; }

function draw(res) {
  //console.log(res);
  const frame = $('#frame'); frame.innerHTML = '';
  const row = el('div', 'row');

  const tr = el('div', 'trainer');
  tr.appendChild(spriteBox(res.trainer.pic, null));
  const plate = el('div', 'plate');
  plate.appendChild(el('div', 'cls', res.trainer.classLabel));
  plate.appendChild(el('div', 'tname', res.trainer.shortName));
  tr.appendChild(plate);
  if (res.trainer.items && res.trainer.items.length) {
    const box = el('div', 'titems');
    box.appendChild(el('div', 'th', 'TRAINER ITEMS'));
    const list = el('div', 'tl');
    res.trainer.items.forEach((name) => list.appendChild(itemRow(name)));
    box.appendChild(list);
    tr.appendChild(box);
  }
  row.appendChild(tr);

  for (let i = 0; i < 6; i++) row.appendChild(monCard(res.slots[i] || null));
  frame.appendChild(row);
  frame.hidden = false;

  const det = $('#details'); det.innerHTML = '';
  const add = (cls, text) => { const b = el('div', 'box ' + cls, text); det.appendChild(b); };
  const bits = [res.trainer.name];
  if (res.party) bits.push((res.party.hard ? 'Hard party' : 'Normal party') + ' – ' + res.party.monsCount + ' of ' + res.party.partySize + ' mons');
  if (res.window) bits.push('Level window ' + res.window.min + '–' + res.window.max + ' (' + res.window.kind + ')');
  bits.push('Party average used: ' + res.avgUsed);
  add('info', bits.join('  •  '));
  if (res.quirk) add('info', res.quirk);
  res.warnings.forEach((w) => add('warn', '⚠ ' + w));
  if (res.trainer.note) add('info', res.trainer.note);
  if (res.cut.length) add('info', 'Not in this fight (cut by party size): ' + res.cut.join(', '));
  if (res.missing.length) add('warn', '⚠ Not matched exactly in the Dex data: ' + res.missing.join(', '));
  det.hidden = false;
  $('#error').hidden = true;
  $('#avg').textContent = String(res.inputs.playerAvg);
}
function showError(msg) {
  const e = $('#error'); e.textContent = msg; e.hidden = false;
  $('#frame').hidden = true; $('#details').hidden = true;
}

async function render() {
  const s = readState();
  if (currentView === 'calc') syncURL('calc');
  const levels = s.levels.filter((x) => x !== '').map(Number);
  const avg = levels.length ? Math.floor(levels.reduce((a, b) => a + b, 0) / levels.length) : '–';
  $('#avg').textContent = String(avg);
  const mine = ++seq;
  let res;
  try {
    res = await backend.calc({
      levels, badges: Number(s.badges), difficulty: Number(s.difficulty), bugfixFlagSet: s.bugfix, gymChallenge: s.gym, postChampion: s.post,
      savedAvg: s.saved, ivOverride: s.iv, evOverride: s.ev, trainerId: s.trainer, pick: s.pick
    });
  } catch (e) { if (mine === seq) showError('Could not reach the calculator.'); return; }
  if (mine !== seq) return;                       // a newer request is in flight
  if (!res.ok) showError(res.error); else draw(res);
}
function schedule() { clearTimeout(timer); timer = setTimeout(render, 120); }

// ---------------------------------------------------------------- Dex tab (data/pokemon.json)
const DEX_GENS = [3, 4, 5, 6, 7, 8, 9];
const DEX_COLS = [
  { key: 'dexNum', label: '#', cls: 'num' },
  { key: 'sprite', label: '', sortable: false },
  { key: 'name', label: 'Name' },
  { key: 'types', label: 'Type' },
  { key: 'abilities', label: 'Abilities' },
  { key: 'items', label: 'Held Items' },
  { key: 'hp', label: 'HP', cls: 'num' },
  { key: 'atk', label: 'Atk', cls: 'num' },
  { key: 'def', label: 'Def', cls: 'num' },
  { key: 'spa', label: 'SpA', cls: 'num' },
  { key: 'spd', label: 'SpD', cls: 'num' },
  { key: 'spe', label: 'Spe', cls: 'num' },
  { key: 'bst', label: 'BST', cls: 'num' },
];
let pokedex = null, pokedexPromise = null;
let dexSort = { key: 'dexNum', dir: 1 };

function loadDex() {
  if (!pokedexPromise) {
    pokedexPromise = fetch('data/pokemon.json')
      .then((r) => { if (!r.ok) throw new Error('Could not load data/pokemon.json'); return r.json(); })
      .then((json) => { pokedex = Object.values(json); return pokedex; });
  }
  return pokedexPromise;
}

// Each base stat is stored as a sparse {gen: value} timeline, e.g. {"3": 30, "6": 40}.
// Resolve the value in effect at a given gen: the entry at the highest key <= gen.
function statAt(timeline, gen) {
  let val = null, bestGen = -1;
  for (const g in timeline) {
    const gi = Number(g);
    if (gi <= gen && gi > bestGen) { bestGen = gi; val = timeline[g]; }
  }
  if (val === null) { for (const g in timeline) { val = timeline[g]; break; } } // fall back to earliest known value
  return val;
}

function dexRowStats(mon, gen) {
  const s = mon.baseStatsByGen || {};
  const hp = statAt(s.hp, gen), atk = statAt(s.attack, gen), def = statAt(s.defense, gen),
        spa = statAt(s.spAttack, gen), spd = statAt(s.spDefense, gen), spe = statAt(s.speed, gen);
  return { hp, atk, def, spa, spd, spe, bst: [hp, atk, def, spa, spd, spe].reduce((a, b) => a + (b || 0), 0) };
}

function abilitiesCell(mon) {
  const cell = el('div');
  const a = mon.abilities || {};
  const parts = [a.primary, a.secondary].filter(Boolean);
  if (parts.length) cell.appendChild(document.createTextNode(parts.join(' / ')));
  if (a.hidden) {
    if (parts.length) cell.appendChild(el('br'));
    const h = el('span', 'hidden-ab', a.hidden + ' (Hidden)');
    cell.appendChild(h);
  }
  if (!parts.length && !a.hidden) cell.appendChild(document.createTextNode('-'));
  return cell;
}
function itemsCell(mon) {
  const cell = el('div');
  if (mon.itemCommon) cell.appendChild(itemRow(mon.itemCommon, 'Common'));
  if (mon.itemRare) cell.appendChild(itemRow(mon.itemRare, 'Rare'));
  if (!mon.itemCommon && !mon.itemRare) cell.appendChild(itemRow(mon.itemRare, '', true));
  return cell;
}

function dexMatches(mon, q) {
  if (!q) return true;
  const a = mon.abilities || {};
  const hay = [mon.name, ...(mon.types || []), a.primary, a.secondary, a.hidden, mon.itemCommon, mon.itemRare]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function renderDexTable() {
  if (!pokedex) return;
  //console.log(pokedex);
  const gen = Number($('#dexGen').value);
  const q = $('#dexSearch').value.trim().toLowerCase();

  const atGen = pokedex.filter((m) => m.introducedGen == null || m.introducedGen <= gen);
  const rows = atGen.filter((m) => dexMatches(m, q)).map((m) => ({ mon: m, stats: dexRowStats(m, gen) }));
  const key = dexSort.key;
  rows.sort((a, b) => {
    let av, bv;
    if (key === 'name') { av = a.mon.name; bv = b.mon.name; }
    else if (key === 'types') { av = displayTypes(a.mon.types).join(','); bv = displayTypes(b.mon.types).join(','); }
    else if (key === 'abilities') { av = a.mon.abilities.primary || ''; bv = b.mon.abilities.primary || ''; }
    else if (key === 'items') { av = a.mon.itemRare || a.mon.itemCommon || ''; bv = b.mon.itemRare || b.mon.itemCommon || ''; }
    else if (key === 'dexNum') { av = a.mon.dexNum; bv = b.mon.dexNum; }
    else { av = a.stats[key]; bv = b.stats[key]; }
    if (av < bv) return -1 * dexSort.dir; if (av > bv) return 1 * dexSort.dir; return 0;
  });

  const tbody = $('#dexTable tbody'); tbody.innerHTML = '';
  rows.forEach(({ mon, stats }) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'num', String(mon.dexNum)));
    const spriteTd = el('td', 'dex-sprite');
    spriteTd.appendChild(spriteBox(mon.name, mon.species, displayTypes(mon.types)[0]));
    tr.appendChild(spriteTd);
    tr.appendChild(el('td', 'dex-name', mon.name));
    const typesTd = el('td'); const typesWrap = el('div', 'dex-types');
    displayTypes(mon.types).forEach((t) => typesWrap.appendChild(typeChip(t, true)));
    typesTd.appendChild(typesWrap); tr.appendChild(typesTd);
    const abTd = el('td', 'dex-abilities'); abTd.appendChild(abilitiesCell(mon)); tr.appendChild(abTd);
    const itTd = el('td', 'dex-items'); itTd.appendChild(itemsCell(mon)); tr.appendChild(itTd);
    ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst'].forEach((k) => tr.appendChild(el('td', 'num', stats[k] === null ? '-' : String(stats[k]))));
    tbody.appendChild(tr);
  });

  $('#dexEmpty').hidden = rows.length !== 0;
  $('#dexCount').textContent = rows.length + ' of ' + atGen.length + ' Pokémon';
}

function buildDexTableHead() {
  const thead = $('#dexTable thead'); thead.innerHTML = '';
  const tr = el('tr');
  DEX_COLS.forEach((c) => {
    const th = el('th', null, c.label);
    if (c.cls) th.classList.add(c.cls);
    if (c.sortable === false) { tr.appendChild(th); return; }
    th.addEventListener('click', () => {
      if (dexSort.key === c.key) dexSort.dir *= -1; else dexSort = { key: c.key, dir: 1 };
      thead.querySelectorAll('th').forEach((h) => h.classList.remove('sorted', 'asc'));
      th.classList.add('sorted'); if (dexSort.dir === 1) th.classList.add('asc');
      renderDexTable();
    });
    tr.appendChild(th);
  });
  thead.appendChild(tr);
}

async function initDexTab() {
  const genSel = $('#dexGen');
  if (!genSel.options.length) {
    DEX_GENS.forEach((g) => { const o = el('option', '', 'Gen ' + g + (g === DEX_GENS[DEX_GENS.length - 1] ? ' (latest)' : '')); o.value = String(g); genSel.appendChild(o); });
    genSel.value = String(DEX_GENS[DEX_GENS.length - 1]);
    buildDexTableHead();
    $('#dexSearch').addEventListener('input', () => { renderDexTable(); syncURL('dex'); });
    genSel.addEventListener('change', renderDexTable);
  }
  $('#dexCount').textContent = 'Loading…';
  try { await loadDex(); renderDexTable(); }
  catch (e) { $('#dexCount').textContent = 'Could not load the Dex data.'; }
}

// ---------------------------------------------------------------- Items tab (data/items.json)
// items.json shape: { "ITEM_GREAT_BALL": ["Verdanturf Town Mart", "Route 118 - Hidden", "Route 119 - Pokeball"], ... }
let itemsData = null, itemsPromise = null;

function loadItems() {
  if (!itemsPromise) {
    itemsPromise = fetch('data/items.json')
      .then((r) => { if (!r.ok) throw new Error('Could not load data/items.json'); return r.json(); })
      .then((json) => { itemsData = json; return itemsData; });
  }
  return itemsPromise;
}

// A location like "Route118 - Hidden" or "Route110 - Trick House Puzzle8 - Pokeball" carries its kind as a
// " - Hidden" / " - Pokeball" suffix (see merge_item_sources.py); anything without that suffix is a store/mart
// listing (see build_item_locations.py). Split the suffix off so it can drive the pill's color instead of just
// sitting in the text.
function locationKind(loc) {
  const m = String(loc).match(/^(.*)\s-\s(Hidden|Pokeball)$/i);
  return m ? { text: m[1], kind: m[2].toLowerCase(), label: m[2] } : { text: loc, kind: 'store', label: 'Store' };
}
function locationPill(loc) {
  const { text, kind, label } = locationKind(loc);
  const pill = el('span', 'pill pill-' + kind);
  pill.appendChild(document.createTextNode(text));
  pill.appendChild(el('b', '', label));
  return pill;
}

function itemMatches(name, locs, q) {
  if (!q) return true;
  if (name.toLowerCase().includes(q)) return true;
  return locs.some((l) => l.toLowerCase().includes(q));
}

function renderItemsTable() {
  if (!itemsData) return;
  const q = $('#itemSearch').value.trim().toLowerCase();
  const all = Object.entries(itemsData).map(([code, locs]) => ({ code, name: prettyItem(code), locs: locs || [] }));
  const rows = all.filter((r) => itemMatches(r.name, r.locs, q)).sort((a, b) => a.name.localeCompare(b.name));

  const tbody = $('#itemsTable tbody'); tbody.innerHTML = '';
  rows.forEach((r) => {
    const tr = el('tr');
    const spriteTd = el('td', 'item-sprite');
    const ico = itemIcon(r.name);
    spriteTd.appendChild(ico || el('span', 'ph-item'));
    tr.appendChild(spriteTd);
    tr.appendChild(el('td', 'item-name', r.name));
    const locTd = el('td', 'item-locs');
    if (r.locs.length) r.locs.forEach((loc) => locTd.appendChild(locationPill(loc)));
    else locTd.appendChild(document.createTextNode('-'));
    tr.appendChild(locTd);
    tbody.appendChild(tr);
  });

  $('#itemsEmpty').hidden = rows.length !== 0;
  $('#itemsCount').textContent = rows.length + ' of ' + all.length + ' items';
}

async function initItemsTab() {
  if (!$('#itemSearch').dataset.bound) {
    $('#itemSearch').dataset.bound = '1';
    $('#itemSearch').addEventListener('input', () => { renderItemsTable(); syncURL('items'); });
  }
  $('#itemsCount').textContent = 'Loading…';
  try { await loadItems(); renderItemsTable(); }
  catch (e) { $('#itemsCount').textContent = 'Could not load the item data.'; }
}

// Two layers here on purpose: applyView() only touches the DOM (safe to call before the form/backend
// are ready), while showView() also syncs the URL - only safe once the form actually reflects real
// state, so it's used for user-triggered tab switches, not the very first view on page load (see
// initTabs(), which must not stomp the incoming URL - e.g. a shared calc link, or ?q= - before it's
// even been read).
function applyView(view) {
  currentView = view;
  $('#view-calc').hidden = view !== 'calc';
  $('#view-dex').hidden = view !== 'dex';
  $('#view-items').hidden = view !== 'items';
  $('#tab-calc').setAttribute('aria-selected', String(view === 'calc'));
  $('#tab-dex').setAttribute('aria-selected', String(view === 'dex'));
  $('#tab-items').setAttribute('aria-selected', String(view === 'items'));
  if (view === 'dex') initDexTab();
  if (view === 'items') initItemsTab();
}
function showView(view) {
  applyView(view);
  syncURL(view);
}
function initTabs() {
  $('#tab-calc').addEventListener('click', () => showView('calc'));
  $('#tab-dex').addEventListener('click', () => showView('dex'));
  $('#tab-items').addEventListener('click', () => showView('items'));
  const view = tabFromURL(), q = searchFromURL();
  if (view === 'dex') $('#dexSearch').value = q;
  if (view === 'items') $('#itemSearch').value = q;
  applyView(view); // no syncURL here - leave the incoming URL alone until render() (calc) or a real edit (dex/items) updates it
}

// ---------------------------------------------------------------- start-up
export async function init() {
  initTabs();
  buildForm();
  const s = stateFromURL();
  backend = await loadBackend();
  trainers = await backend.trainers();
  writeState(s);
  fillClassSelect(s.cls);
  fillTrainerSelect($('#cls').value, s.trainer);

  $('#form').addEventListener('input', schedule);
  $('#form').addEventListener('submit', (e) => e.preventDefault());
  $('#cls').addEventListener('change', () => { fillTrainerSelect($('#cls').value, ''); schedule(); });
  $('#prev').addEventListener('click', () => stepTrainer(-1));
  $('#next').addEventListener('click', () => stepTrainer(1));
  $('#copy').addEventListener('click', async () => {
    const b = $('#copy');
    try { await navigator.clipboard.writeText(location.href); b.textContent = 'Copied!'; }
    catch (e) { window.prompt('Copy this link:', location.href); }
    setTimeout(() => { b.textContent = 'Copy link'; }, 1500);
  });
  await render();
}

if (typeof window !== 'undefined' && !window.__BOSSCALC_TEST__) {
  init().catch((e) => { showError('Failed to start: ' + e.message); });
}