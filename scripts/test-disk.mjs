import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const start = source.indexOf('function renderHistory(){');
const end = source.indexOf('\n}', start) + 2;
assert.ok(start >= 0 && end > start);

function niceMax(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

function render(node, metrics, opts = {}) {
  const cards = [];
  const ctx = {
    S: {
      lastHistoryData: { metrics, step: 60 },
      detailId: 1,
      cpuScale: opts.cpuScale || 'fit',
      memScale: opts.memScale || 'fit',
      diskScale: opts.diskScale || 'fit'
    },
    document: {
      createDocumentFragment: () => ({}),
      documentElement: { getAttribute: () => (opts.dark ? 'dark' : 'light') }
    },
    window: { scrollY: 0 },
    charts: [],
    $: () => ({ scrollTop: 0 }),
    find: () => node,
    num: v => typeof v === 'number' && Number.isFinite(v),
    ratio: (a, b) =>
      typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b) && b > 0
        ? Math.min(100, (a / b) * 100)
        : null,
    niceMax,
    smoothPts: x => x,
    cssv: () => '#000',
    bytes: v => `${v}B`,
    esc: String,
    axisBytes() {},
    niceBytesMax() {},
    speed() {},
    renderPingChart() {},
    swapContent() {},
    redrawCharts() {},
    desktop: () => true,
    chartCard: (_target, title, series, cfg, header) => cards.push({ title, series, cfg, header })
  };
  vm.runInNewContext(source.slice(start, end) + '\nrenderHistory();', ctx);
  return cards;
}

// 1. 4 system resource cards + memory adaptive range includes swap without clipping it
const cards = render(
  { mem_total: 1000, swap_total: 1000, disk_total: 200 },
  [
    { ts: 1, cpu: 2, cpu_max: 5, mem_used: 330, swap_used: 40, disk_used: 64, tcp: 80, udp: 10, procs: 120 },
    { ts: 2, cpu: 3, cpu_max: 6, mem_used: 340, swap_used: 45, disk_used: 66, tcp: 95, udp: 12, procs: 122 }
  ]
);
const titles = cards.slice(0, 4).map(c => c.title);
assert.deepEqual(titles, ['CPU 占用', '内存使用', '磁盘使用率', '连接数与进程数']);

const mem = cards[1];
assert.ok(mem.cfg.base <= 4, `Memory adaptive base ${mem.cfg.base} must cover swap (4%)`);
assert.ok(mem.cfg.max >= 34, `Memory adaptive max ${mem.cfg.max} must cover mem (34%)`);

const diskFit = cards[2];
assert.ok(diskFit.cfg.base > 0 && diskFit.cfg.max < 100, 'Disk fit mode should zoom into actual band');
assert.equal(diskFit.cfg.subTitle, '总容量 200B');

const conn = cards[3];
assert.deepEqual(Array.from(conn.series, s => s.name), ['TCP', 'UDP', '进程']);
assert.deepEqual(Array.from(conn.series[1].dash), [4, 3]);
assert.equal(conn.cfg.base, 0);
assert.ok(conn.cfg.max >= 122);
assert.equal(conn.cfg.axis(1500), '1.5k');

// 2. Disk abs mode + gaps + missing total + empty conn metrics fallback
const cardsAbs = render(
  { mem_total: 1000, disk_total: 200 },
  [
    { ts: 1, disk_used: 0 },
    { ts: 2, disk_used: null },
    { ts: 3, disk_used: 200 }
  ],
  { diskScale: 'abs', dark: true }
);
assert.equal(cardsAbs[2].cfg.base, 0);
assert.equal(cardsAbs[2].cfg.max, 100);
assert.deepEqual(cardsAbs[2].series[0].pts.map(p => p[1]), [0, null, 100]);
assert.equal(cardsAbs[2].series[0].color, '#56b3b0');
assert.equal(cardsAbs[3].series.length, 0, 'Empty tcp/udp/procs must degrade cleanly');

const cardsNoDisk = render({ disk_total: 0 }, [{ ts: 1, disk_used: 10 }]);
assert.deepEqual(cardsNoDisk[2].series[0].pts.map(p => p[1]), [null]);

// 3. Node sorting (cpu / disk / traffic / expire / offline fallback)
const sortStart = source.indexOf('var SORT_OPTS=');
const sortEnd = source.indexOf('\nfunction desktop()', sortStart);
assert.ok(sortStart >= 0 && sortEnd > sortStart);
function runSort(mode, nodes) {
  const ctx = {
    S: { nodes, group: -1, q: '', sort: mode },
    inGroup: () => true,
    mp: n => (n.metrics && typeof n.metrics === 'object' ? n.metrics : null),
    num: v => typeof v === 'number' && Number.isFinite(v),
    ratio: (a, b) =>
      typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b) && b > 0
        ? Math.min(100, (a / b) * 100)
        : null
  };
  return Array.from(vm.runInNewContext(source.slice(sortStart, sortEnd) + '\nvisible();', ctx), n => n.id);
}
const sampleNodes = [
  { id: 1, name: 'A', online: true, expires_in: 120, month_used: 100, metrics: { cpu: 10, mem_used: 20, mem_total: 100, disk_used: 50, disk_total: 100, net_rx: 10, net_tx: 5 } },
  { id: 2, name: 'B', online: false, expires_in: 5, month_used: 500, metrics: { cpu: 99, mem_used: 90, mem_total: 100, disk_used: 90, disk_total: 100, net_rx: 999, net_tx: 0 } },
  { id: 3, name: 'C', online: true, expires_in: 30, month_used: 300, metrics: { cpu: 45, mem_used: 60, mem_total: 100, disk_used: 20, disk_total: 100, net_rx: 50, net_tx: 50 } },
  { id: 4, name: 'D', online: true, month_rx: 120, month_tx: 80, metrics: { cpu: 25, mem_used: 80, mem_total: 100, disk_used: 70, disk_total: 100, net_rx: 20, net_tx: 10 } }
];
assert.deepEqual(runSort('default', sampleNodes), [1, 2, 3, 4]);
assert.deepEqual(runSort('cpu', sampleNodes), [3, 4, 1, 2]); // offline B last
assert.deepEqual(runSort('mem', sampleNodes), [4, 3, 1, 2]);
assert.deepEqual(runSort('disk', sampleNodes), [4, 1, 3, 2]);
assert.deepEqual(runSort('net', sampleNodes), [3, 4, 1, 2]);
assert.deepEqual(runSort('traffic', sampleNodes), [2, 3, 4, 1]);
assert.deepEqual(runSort('expire', sampleNodes), [2, 3, 1, 4]); // ascending, missing expires_in last

// 4. SVG flag rendering & fallback
const flagStart = source.indexOf('var FLAG_CACHE=');
const flagEnd = source.indexOf('\nfunction renderList()', flagStart);
assert.ok(flagStart >= 0 && flagEnd > flagStart);
const flagCtx = { esc: s => String(s) };
vm.runInNewContext(source.slice(flagStart, flagEnd), flagCtx);
for (const cc of ['CN', 'DE', 'HK', 'JP', 'KR', 'SG', 'TW', 'US', 'uk']) {
  const html = flagCtx.flagHtml(cc, false);
  assert.ok(html.includes('<svg viewBox="0 0 24 18">'), `Flag SVG missing for ${cc}`);
}
assert.ok(flagCtx.flagHtml('ZZ', true).includes('flag-code'), 'Unknown code must fallback to badge');
assert.equal(flagCtx.flagHtml('', false), '');

// 5. Left list OS display strips versions/editions
const osStart = source.indexOf('function osName(s){');
const osEnd = source.indexOf('\nfunction renderList()', osStart);
assert.ok(osStart >= 0 && osEnd > osStart);
const osCtx = {};
vm.runInNewContext(source.slice(osStart, osEnd), osCtx);
assert.equal(osCtx.osName('Debian GNU/Linux 13 (trixie)'), 'Debian');
assert.equal(osCtx.osName('Alpine Linux v3.24'), 'Alpine');
assert.equal(osCtx.osName('Ubuntu 24.04.1 LTS'), 'Ubuntu');
assert.equal(osCtx.osName('Windows'), 'Windows');
assert.equal(osCtx.osName('Windows Server 2022 Standard'), 'Windows');
assert.equal(osCtx.osName('Rocky Linux 9.4 (Blue Onyx)'), 'Rocky');
assert.equal(osCtx.osName('FreeBSD 14.1-RELEASE'), 'FreeBSD');
assert.equal(osCtx.osName(''), '');

console.log('[test] System resource charts + node sorting + SVG flags + OS short name passed.');
