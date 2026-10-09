const API = new URLSearchParams(location.search).get('api') ?? 'http://localhost:8100';
const $ = (id) => document.getElementById(id);

// Offer categories (*G codes) by mode, for colors.
const MODES = {
  train: ['IC', 'ICE', 'IR', 'IRE', 'EC', 'EN', 'NJ', 'RE', 'R', 'RB', 'S', 'SN', 'TGV', 'TER', 'RJX', 'PE', 'EXT', 'ZUG'],
  bus: ['B', 'BN', 'BP', 'CAR', 'EV', 'EXB', 'RUB', 'TX'],
  tram: ['T'],
  metro: ['M'],
  boat: ['BAT', 'FAE'],
  cable: ['SL', 'GB', 'PB', 'FUN', 'CC', 'ASC'],
};
const modeOf = (transport) => Object.keys(MODES).find((m) => MODES[m].includes(transport)) ?? 'other';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (iso) => iso.slice(11, 16);
const minutes = (from, to) => Math.round((new Date(to) - new Date(from)) / 60000);
const duration = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)}`);
const ms = (t) => `${t < 10 ? t.toFixed(1) : Math.round(t)} ms`;
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** [date, time] in local time, as the form fields and the API take them. */
const fields = (d) => [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`];
/** [date, time] of the API time `iso` (local, without zone) shifted by `m` minutes. */
const shifted = (iso, m) => fields(new Date(new Date(iso).getTime() + m * 60000));

async function api(path) {
  const response = await fetch(API + path);
  if (response.status === 400) throw new Error('outside');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function show(message, error = false) {
  $('message').textContent = message;
  $('message').className = error ? 'error' : '';
}

const unreachable = () => show(`Cannot reach the routing server at ${API}. Start it in hrdf-routing-engine with: cargo run --release -- serve`, true);

// Stops chosen in the from/to fields: {id, name}, and how to close their suggestions.
const places = { from: null, to: null };
let closeSuggestions = [];

function autocomplete(input, next) {
  const list = input.nextElementSibling;
  let items = [];
  let active = -1;
  let timer;
  // Answers to older requests are ignored: they would reopen or overwrite the list.
  let request = 0;
  const close = () => {
    clearTimeout(timer);
    request++;
    list.replaceChildren();
  };
  const choose = (place) => {
    places[input.id] = place;
    input.value = place.name;
    close();
  };
  const render = () => list.replaceChildren(...items.map((place, i) => {
    const li = document.createElement('li');
    li.textContent = place.name;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === active);
    li.onmousedown = (event) => { event.preventDefault(); choose(place); };
    return li;
  }));
  input.addEventListener('input', () => {
    places[input.id] = null;
    close();
    const query = input.value.trim();
    const current = request;
    if (!query) return;
    timer = setTimeout(async () => {
      const found = await api(`/stops?q=${encodeURIComponent(query)}`).catch(() => []);
      if (current !== request) return;
      [items, active] = [found, -1];
      render();
    }, 120);
  });
  input.addEventListener('keydown', (event) => {
    if (!list.children.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[Math.max(active, 0)]);
      next();
    } else if (event.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('blur', close);
  return close;
}

/** The chosen stop of a field, or the best match for what was typed. */
async function place(input) {
  if (places[input.id]) return places[input.id];
  const [best] = input.value.trim() ? await api(`/stops?q=${encodeURIComponent(input.value)}`) : [];
  if (best) {
    places[input.id] = best;
    input.value = best.name;
  }
  return best;
}

let timetable;
// The stops and day of the results, and the connections shown, in time order.
let searched = null;
let shown = [];

async function search() {
  closeSuggestions.forEach((close) => close());
  let from, to;
  try {
    [from, to] = [await place($('from')), await place($('to'))];
  } catch {
    return unreachable();
  }
  if (!from || !to) return show('Choose a departure and an arrival stop.', true);
  const arrival = document.querySelector('input[name=mode]:checked').value === 'arrival';
  const query = { from: from.id, to: to.id, date: $('date').value, time: $('time').value, arrival };
  const data = await journeys(query, $('go'));
  if (!data) return;
  searched = { from, to, date: query.date };
  shown = data.connections;
  render(data);
  history.replaceState(null, '', `?${new URLSearchParams({ ...query, fromName: from.name, toName: to.name })}`);
}

/** Adds the connections before the first one, or after the last one. */
async function more(later) {
  if (!shown.length) return;
  const [date, time] = later ? shifted(shown.at(-1).departure, 1) : shifted(shown[0].arrival, -1);
  const query = { from: searched.from.id, to: searched.to.id, date, time, arrival: !later };
  const data = await journeys(query, $(later ? 'later' : 'earlier'));
  if (!data) return;
  const key = (c) => c.departure + c.arrival;
  const known = new Set(shown.map(key));
  const added = data.connections.filter((c) => !known.has(key(c)));
  shown = later ? shown.concat(added) : added.concat(shown);
  render(data, later ? 'later' : 'earlier');
}

/** The API answer, with its round trip time; `button` is disabled meanwhile. */
async function journeys(query, button) {
  show('Searching…');
  button.disabled = true;
  const started = performance.now();
  try {
    const data = await api(`/journeys?${new URLSearchParams(query)}`);
    data.round_trip_ms = performance.now() - started;
    show('');
    return data;
  } catch (error) {
    if (error.message !== 'outside') return unreachable();
    show(`No timetable for this date: it covers ${timetable.start_date} to ${timetable.end_date}.`, true);
  } finally {
    button.disabled = false;
  }
}

function render(data, added = null) {
  const day = new Date(`${searched.date}T00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  $('title').textContent = `${searched.from.name} → ${searched.to.name} · ${day}`;
  $('connections').replaceChildren(...shown.map(connection));
  $('results').hidden = false;
  if (!shown.length) show('No connection found.');
  const found = data.connections.length;
  const what = added ? `${plural(found, 'connection')} ${added}` : plural(found, 'connection');
  const each = data.connections.map((c) => ms(c.routing_ms)).join(', ');
  const prepared = data.prepare_ms >= 1 ? ` · preparing this date's network: ${ms(data.prepare_ms)} (once per date)` : '';
  $('timing').textContent = `Routing: ${ms(data.routing_ms)} for ${what}${found ? ` (${each})` : ''}${prepared} · request round trip: ${ms(data.round_trip_ms)}`;
}

/** The sections up to the last vehicle: like sbb.ch, a walk to the destination after it does not
 * count in the arrival time. */
const riding = (c) => c.sections.slice(0, c.sections.findLastIndex((s) => s.ride) + 1 || c.sections.length);
const arrival = (c) => riding(c).at(-1).arrival;

// Material Icons (Apache License 2.0).
const icon = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
const ICONS = {
  walk: icon('M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7'),
  change: icon('M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z'),
  seat: icon('M4 18v3h3v-3h10v3h3v-6H4zm15-8h3v3h-3zM2 10h3v3H2zm15 3H7V5c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v8z'),
};

/** Trains keep their code ("IC 8", "S 3"), other modes get their English name ("Bus 6"). */
function chip(ride) {
  const mode = modeOf(ride.transport);
  const name = mode === 'train' ? ride.transport : ride.category;
  return `<span class="chip ${mode}" title="${escape(ride.category)}">${escape(name)} ${escape(ride.line)}</span>`;
}

const platform = (name) => (name ? `<span class="platform">Pl. ${escape(name)}</span>` : '');

/** A step between rides: icon, what to do, and how long. */
const step = (name, text, time = '') =>
  `<div class="step"><span class="icon">${ICONS[name]}</span><span>${text}</span><span class="step-time">${time}</span></div>`;

function connection(c) {
  const li = document.createElement('li');
  li.className = 'connection card';
  const rides = c.sections.filter((s) => s.ride).map((s) => s.ride);
  // One badge per vehicle (a ride that continues the previous one is the same vehicle), and
  // where the first vehicle goes.
  const vehicles = rides.filter((r) => !r.continues);
  let direction = rides[0]?.direction;
  for (const r of rides.slice(1)) {
    if (!r.continues) break;
    direction = r.direction;
  }
  // Connections on another day than the one searched, after earlier or later ones were added.
  const day = c.departure.slice(0, 10) === searched.date
    ? ''
    : `<span class="day">${new Date(c.departure).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
  li.innerHTML = `<button type="button" aria-expanded="false">
    <span class="summary">
      <span class="time">${hhmm(c.departure)}</span><span class="dash"></span><span class="time">${hhmm(arrival(c))}</span>
      <span class="duration">${duration(minutes(c.departure, arrival(c)))}<small>${c.changes ? plural(c.changes, 'change') : 'Direct'}</small></span>
    </span>
    <span class="meta">${day}${vehicles.map(chip).join(' ')}${direction ? `<span>Direction ${escape(direction)}</span>` : ''}${platform(rides[0]?.stops[0].platform)}</span>
    <span class="bar">${bar(c)}</span>
  </button>`;
  const button = li.firstElementChild;
  button.onclick = () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', !open);
    if (open) li.querySelector('.details').remove();
    else li.insertAdjacentHTML('beforeend', details(c));
  };
  return li;
}

/** Rides, walks and waits as proportional segments. */
function bar(c) {
  let html = '';
  let previous = c.departure;
  for (const s of riding(c)) {
    const wait = minutes(previous, s.departure);
    if (wait > 0) html += `<span class="wait" style="flex:${wait}"></span>`;
    html += `<span class="${s.ride ? modeOf(s.ride.transport) : 'walk'}" style="flex:${Math.max(minutes(s.departure, s.arrival), 1)}"></span>`;
    previous = s.arrival;
  }
  return html;
}

function details(c) {
  let html = '<div class="details">';
  // When the previous vehicle arrived, if it was just before.
  let previous = null;
  for (const [i, s] of c.sections.entries()) {
    if (!s.ride) {
      // Between two vehicles, the walk is part of the change.
      const next = c.sections.slice(i + 1).find((n) => n.ride);
      const change = next && previous ? `${minutes(previous, next.departure)} min change` : '';
      html += step('walk', `<b>Walk ${minutes(s.departure, s.arrival)} min</b> to ${escape(s.to.name)}`, change);
      previous = null;
      continue;
    }
    const ride = s.ride;
    if (ride.continues) html += step('seat', `<b>Stay on board</b>, continues as ${chip(ride)}`);
    else if (previous) html += step('change', `<b>Change</b> at ${escape(s.from.name)}`, `${minutes(previous, s.departure)} min`);
    const [first, last] = [ride.stops[0], ride.stops.at(-1)];
    const middle = ride.stops.slice(1, -1);
    const row = (time, name, at) =>
      `<div class="stop"><span class="t">${time}</span><span class="rail"></span><span class="name"><b>${escape(name)}</b>${platform(at)}</span></div>`;
    const stops = middle.length
      ? `<div><span></span><span class="rail"></span><details><summary>${plural(middle.length, 'stop')}</summary><ol>${middle.map((p) => `<li>${p.arrival ?? p.departure} ${escape(p.name)}</li>`).join('')}</ol></details></div>`
      : '';
    html += `<div class="leg" style="--c: var(--${modeOf(ride.transport)})">
      ${row(hhmm(s.departure), s.from.name, first?.platform)}
      <div><span></span><span class="rail"></span><span class="info">${chip(ride)} Direction ${escape(ride.direction)} · ${escape(ride.operator)}</span></div>
      ${stops}
      ${row(hhmm(s.arrival), s.to.name, last?.platform)}
    </div>`;
    previous = s.arrival;
  }
  return `${html}</div>`;
}

async function init() {
  closeSuggestions = [autocomplete($('from'), () => $('to').focus()), autocomplete($('to'), search)];
  [$('date').value, $('time').value] = fields(new Date());
  $('swap').onclick = () => {
    [$('from').value, $('to').value] = [$('to').value, $('from').value];
    [places.from, places.to] = [places.to, places.from];
  };
  $('search').onsubmit = (event) => { event.preventDefault(); search(); };
  $('later').onclick = () => more(true);
  $('earlier').onclick = () => more(false);

  try {
    timetable = await api('/metadata');
  } catch {
    return unreachable();
  }
  $('date').min = timetable.start_date;
  $('date').max = timetable.end_date;
  if ($('date').value < timetable.start_date || $('date').value > timetable.end_date) $('date').value = timetable.start_date;

  // A search in the URL (as left by the last search) runs right away.
  const params = new URLSearchParams(location.search);
  if (params.has('from') && params.has('to')) {
    places.from = { id: Number(params.get('from')), name: params.get('fromName') ?? params.get('from') };
    places.to = { id: Number(params.get('to')), name: params.get('toName') ?? params.get('to') };
    [$('from').value, $('to').value] = [places.from.name, places.to.name];
    if (params.has('date')) $('date').value = params.get('date');
    if (params.has('time')) $('time').value = params.get('time');
    document.querySelector(`input[name=mode][value=${params.get('arrival') === 'true' ? 'arrival' : 'departure'}]`).checked = true;
    search();
  }
}

init();
