// Bookiraj.si — pobere prave cene z Aviasales/Travelpayouts Data API
// in obdrži SAMO termine, cenejše od povprečja za posamezno progo.
// Zažene GitHub Action (bere skrivnost TRAVELPAYOUTS_TOKEN); lokalno: TRAVELPAYOUTS_TOKEN=... node scripts/fetch-deals.mjs
import { writeFileSync } from 'node:fs';

const TOKEN = process.env.TRAVELPAYOUTS_TOKEN;
const MARKER = process.env.TP_MARKER || '779438';
if (!TOKEN) { console.error('Manjka TRAVELPAYOUTS_TOKEN'); process.exit(1); }

// Kurirane destinacije (slovenski meta + slike). code = kar iščemo na API; London = LON (vsa londonska letališča).
const ROUTES = [
  {city:'Barcelona',code:'BCN',country:'Španija',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'barcelona'},
  {city:'Rim',code:'FCO',country:'Italija',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'rome'},
  {city:'Lizbona',code:'LIS',country:'Portugalska',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'lisbon'},
  {city:'Santorini',code:'JTR',country:'Grčija',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'santorini'},
  {city:'Istanbul',code:'IST',country:'Turčija',fromCity:'Zagreb',fromCode:'ZAG',region:'europa',img:'istanbul'},
  {city:'Amsterdam',code:'AMS',country:'Nizozemska',fromCity:'Ljubljana',fromCode:'LJU',region:'europa',img:'amsterdam'},
  {city:'London',code:'LON',country:'Anglija',fromCity:'Trst',fromCode:'TRS',region:'europa',img:'london'},
  {city:'Reykjavík',code:'KEF',country:'Islandija',fromCity:'Benetke',fromCode:'VCE',region:'europa',img:'iceland'},
  {city:'Dubaj',code:'DXB',country:'ZAE',fromCity:'Zagreb',fromCode:'ZAG',region:'azija',img:'dubai'},
  {city:'Bangkok',code:'BKK',country:'Tajska',fromCity:'Benetke',fromCode:'VCE',region:'azija',img:'bangkok'},
  {city:'Maldivi',code:'MLE',country:'Maldivi',fromCity:'Dunaj',fromCode:'VIE',region:'eksotika',img:'maldives'},
  {city:'New York',code:'JFK',country:'ZDA',fromCity:'Benetke',fromCode:'VCE',region:'amerika',img:'newyork'},
  {city:'Bali',code:'DPS',country:'Indonezija',fromCity:'Dunaj',fromCode:'VIE',region:'eksotika',img:'bali'},
  {city:'Marakeš',code:'RAK',country:'Maroko',fromCity:'Benetke',fromCode:'VCE',region:'eksotika',img:'marrakesh'},
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRoute(origin, dest) {
  const url = `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${origin}&destination=${dest}`
    + `&currency=eur&sorting=price&direct=false&limit=30&page=1&one_way=false&market=si`;
  try {
    const r = await fetch(url, { headers: { 'X-Access-Token': TOKEN } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.data) ? j.data : [];
  } catch { return []; }
}

const out = [];
for (const rt of ROUTES) {
  const data = await fetchRoute(rt.fromCode, rt.code);
  await sleep(350);
  if (!data.length) { console.log(`—  ${rt.fromCode}→${rt.code} ${rt.city}: ni podatkov`); continue; }

  const prices = data.map(d => d.price).filter(p => p > 0);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

  const seen = new Set();
  const below = data
    .filter(d => d.price < avg)                 // SAMO pod povprečjem
    .sort((a, b) => a.price - b.price)
    .filter(d => { const k = d.departure_at.slice(0, 10); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6)
    .map(d => ({
      depart: d.departure_at.slice(0, 10),
      ret: d.return_at ? d.return_at.slice(0, 10) : null,
      price: Math.round(d.price),
      airline: d.airline || '',
      transfers: d.transfers ?? 0,
      url: 'https://www.aviasales.com' + d.link + '&marker=' + MARKER,
    }));

  if (!below.length) { console.log(`~  ${rt.fromCode}→${rt.code} ${rt.city}: ni terminov pod povprečjem (avg ${Math.round(avg)}€)`); continue; }

  out.push({
    city: rt.city, code: rt.code, country: rt.country,
    fromCity: rt.fromCity, fromCode: rt.fromCode, region: rt.region, img: rt.img,
    fromPrice: Math.min(...below.map(t => t.price)),
    avg: Math.round(avg),
    terms: below,
  });
  console.log(`✓  ${rt.fromCode}→${rt.code} ${rt.city}: povpr. ${Math.round(avg)}€ · ${below.length} pod povprečjem · od ${Math.min(...below.map(t => t.price))}€`);
}

out.sort((a, b) => a.fromPrice - b.fromPrice);

// --- Samodejno odkrivanje: najcenejše destinacije iz vseh letališč (radar cen) ---
const CURATED = new Set(ROUTES.map(r => r.code));
const pub = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
const ddmm = (iso) => { const p = iso.slice(0, 10).split('-'); return p[2] + p[1]; };
const cities = await pub('https://api.travelpayouts.com/data/en/cities.json');
const countries = await pub('https://api.travelpayouts.com/data/en/countries.json');
const CITY = {}, COUNTRY = {};
if (cities) for (const c of cities) CITY[c.code] = { name: c.name, cc: c.country_code };
if (countries) for (const c of countries) COUNTRY[c.code] = c.name;

const best = {};
for (const o of ['LJU', 'TRS', 'VCE', 'ZAG', 'VIE', 'MXP', 'TSF', 'MUC', 'BUD']) {
  const url = `https://api.travelpayouts.com/aviasales/v3/get_latest_prices?origin=${o}&currency=eur&period_type=year&one_way=false&limit=40&page=1&market=si`;
  let data = [];
  try { const r = await fetch(url, { headers: { 'X-Access-Token': TOKEN } }); if (r.ok) { const j = await r.json(); data = j.data || []; } } catch {}
  await sleep(300);
  for (const it of data) {
    if (!it.value || !it.depart_date || !it.return_date) continue;
    if (CURATED.has(it.destination)) continue;               // ne podvajaj kuriranih
    if (!best[it.destination] || it.value < best[it.destination].value) best[it.destination] = { ...it, o };
  }
}
let disc = Object.values(best);
if (disc.length) {
  const davg = disc.reduce((s, x) => s + x.value, 0) / disc.length;
  disc = disc.filter(x => x.value < davg).sort((a, b) => a.value - b.value).slice(0, 24).map(x => {
    const ci = CITY[x.destination] || {};
    const sc = x.o + ddmm(x.depart_date) + x.destination + ddmm(x.return_date) + '1';
    return {
      fromCode: x.o, code: x.destination, city: ci.name || x.destination,
      country: (ci.cc && COUNTRY[ci.cc]) || '', price: Math.round(x.value),
      depart: x.depart_date.slice(0, 10), ret: x.return_date.slice(0, 10),
      url: 'https://www.aviasales.com/search/' + sc + '?marker=' + MARKER,
    };
  });
}
console.log(`Radar cen: ${disc.length} odkritih destinacij pod povprečjem`);

const payload = { updated: new Date().toISOString(), deals: out, discover: disc };
writeFileSync(new URL('../deals.js', import.meta.url), 'window.__BOOKIRAJ_DEALS__ = ' + JSON.stringify(payload) + ';\n');
console.log(`\nSkupaj destinacij z akcijami pod povprečjem: ${out.length}`);
