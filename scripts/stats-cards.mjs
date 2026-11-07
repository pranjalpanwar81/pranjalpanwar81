// Generates the README stat cards from the GitHub API, so the profile never
// depends on third-party card services (which rate-limit or go down and show
// as broken images). Runs daily in .github/workflows/stats-cards.yml.
//
//   GITHUB_TOKEN=... USERNAME=pranjalpanwar81 node scripts/stats-cards.mjs
//   node scripts/stats-cards.mjs --sample   # render with sample data, no API

import { mkdir, writeFile } from 'node:fs/promises'

const OUT = 'assets/stats'
const T = {
  bg: '#0b1030', panel: '#111842', line: '#1f2a5c',
  cyan: '#22d3ee', violet: '#8b5cf6', pink: '#f472b6',
  text: '#cbd5e1', dim: '#94a3b8', white: '#ffffff',
}
const SANS = 'Segoe UI,Helvetica,Arial,sans-serif'
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmt = (n) => n.toLocaleString('en-US')
const dfmt = (iso, withYear = true) => {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

// ---------- data ----------

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats-cards' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) throw new Error(`GitHub API error: ${res.status} ${JSON.stringify(json.errors || json)}`)
  return json.data
}

async function fetchData(login) {
  const base = await gql(
    `query($login:String!){ user(login:$login){
      name login
      followers { totalCount }
      pullRequests { totalCount }
      issues { totalCount }
      contributionsCollection { contributionYears totalCommitContributions restrictedContributionsCount }
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100, privacy: PUBLIC) {
        totalCount
        nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
      }
    } }`,
    { login },
  )
  const u = base.user
  const days = []
  for (const year of u.contributionsCollection.contributionYears) {
    const now = new Date()
    const to = year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z`
    const y = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){ contributionsCollection(from:$from,to:$to){
        totalCommitContributions
        contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`,
      { login, from: `${year}-01-01T00:00:00Z`, to },
    )
    for (const w of y.user.contributionsCollection.contributionCalendar.weeks) days.push(...w.contributionDays)
  }
  const byDate = new Map(days.map((d) => [d.date, d.contributionCount]))
  const calendar = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count }))

  const langs = new Map()
  for (const r of u.repositories.nodes) {
    for (const e of r.languages.edges) {
      const cur = langs.get(e.node.name) || { name: e.node.name, color: e.node.color || T.dim, size: 0 }
      cur.size += e.size
      langs.set(e.node.name, cur)
    }
  }
  return {
    name: u.name || u.login,
    stars: u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    repos: u.repositories.totalCount,
    followers: u.followers.totalCount,
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    commitsThisYear: u.contributionsCollection.totalCommitContributions + u.contributionsCollection.restrictedContributionsCount,
    calendar,
    languages: [...langs.values()].sort((a, b) => b.size - a.size),
  }
}

function sampleData() {
  const calendar = []
  const start = new Date(Date.UTC(2025, 0, 1))
  const today = new Date()
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const i = calendar.length
    const count = (i % 9 === 0 || i % 13 === 0) ? 0 : Math.round(Math.abs(Math.sin(i / 5)) * 6)
    calendar.push({ date: d.toISOString().slice(0, 10), count })
  }
  return {
    name: 'Pranjal Panwar', stars: 3, repos: 27, followers: 12, prs: 9, issues: 4, commitsThisYear: 160, calendar,
    languages: [
      { name: 'JavaScript', color: '#f1e05a', size: 520 }, { name: 'C++', color: '#f34b7d', size: 260 },
      { name: 'Python', color: '#3572A5', size: 150 }, { name: 'HTML', color: '#e34c26', size: 70 },
      { name: 'CSS', color: '#663399', size: 40 }, { name: 'EJS', color: '#a91e50', size: 20 }, { name: 'Shell', color: '#89e051', size: 5 },
    ],
  }
}

// ---------- derived numbers ----------

function streaks(calendar) {
  const todayISO = new Date().toISOString().slice(0, 10)
  const days = calendar.filter((d) => d.date <= todayISO)
  let longest = { len: 0, start: null, end: null }
  let run = { len: 0, start: null }
  for (const d of days) {
    if (d.count > 0) {
      if (run.len === 0) run.start = d.date
      run.len++
      if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d.date }
    } else run = { len: 0, start: null }
  }
  // Current streak: today with no contributions yet doesn't break it.
  let i = days.length - 1
  if (i >= 0 && days[i].count === 0 && days[i].date === todayISO) i--
  let cur = { len: 0, start: null, end: null }
  for (; i >= 0 && days[i].count > 0; i--) {
    cur.len++
    cur.start = days[i].date
    cur.end = cur.end || days[i].date
  }
  const total = days.reduce((s, d) => s + d.count, 0)
  const first = days.find((d) => d.count > 0)?.date || days[0]?.date
  return { total, first, current: cur, longest }
}

// ---------- svg helpers ----------

const frame = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${T.cyan}"/><stop offset="0.55" stop-color="${T.violet}"/><stop offset="1" stop-color="${T.pink}"/></linearGradient>
  <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.violet}" stop-opacity="0.55"/><stop offset="1" stop-color="${T.violet}" stop-opacity="0"/></linearGradient>
</defs>
<style>
  .t{font:600 18px ${SANS};fill:${T.cyan}}
  .l{font:400 14px ${SANS};fill:${T.text}}
  .v{font:700 14px ${SANS};fill:${T.white}}
  .s{font:400 12px ${SANS};fill:${T.dim}}
  .m{font:400 11px ${MONO};fill:${T.dim}}
  .fade{opacity:0;animation:in .6s ease forwards}
  @keyframes in{to{opacity:1}}
</style>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="16" fill="${T.bg}" stroke="${T.line}"/>
${body}
</svg>
`

// Simple line icons, 16x16, stroke-based.
const ICON = {
  commit: '<circle cx="8" cy="8" r="3"/><path d="M1 8h4M11 8h4"/>',
  pr: '<circle cx="4" cy="3.5" r="1.8"/><circle cx="4" cy="12.5" r="1.8"/><circle cx="12" cy="12.5" r="1.8"/><path d="M4 5.3v5.4M12 10.7V6.5a2 2 0 0 0-2-2H7.5M9 2.8 7.3 4.5 9 6.2"/>',
  issue: '<circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>',
  repo: '<path d="M3 2.5h8.5a1 1 0 0 1 1 1v10H4a1 1 0 0 1-1-1z"/><path d="M3 11.5a1 1 0 0 1 1-1h8.5"/>',
  star: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  people: '<circle cx="6" cy="5.5" r="2.4"/><path d="M1.8 13.5a4.2 4.2 0 0 1 8.4 0"/><circle cx="11.5" cy="6" r="1.9"/><path d="M11 9.6a3.6 3.6 0 0 1 3.4 3.9"/>',
}
const icon = (name, x, y, color) =>
  `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" color="${color}">${ICON[name]}</g>`

// ---------- cards ----------

function statsCard(d, s) {
  const year = new Date().getUTCFullYear()
  const rows = [
    ['commit', `Commits (${year})`, d.commitsThisYear, T.cyan],
    ['pr', 'Pull requests', d.prs, T.violet],
    ['issue', 'Issues', d.issues, T.pink],
    ['repo', 'Public repositories', d.repos, T.cyan],
  ]
  const body = rows.map(([ic, label, val, color], i) => {
    const y = 79 + i * 26
    return `<g class="fade" style="animation-delay:${0.1 + i * 0.08}s">${icon(ic, 26, y - 12, color)}<text class="l" x="52" y="${y}">${label}</text><text class="v" x="270" y="${y}" text-anchor="end">${fmt(val)}</text></g>`
  }).join('\n')
  // Ring: contributions in the last 365 days, ring fills by share of active days.
  const last = d.calendar.slice(-365)
  const lastTotal = last.reduce((a, x) => a + x.count, 0)
  const active = last.filter((x) => x.count > 0).length
  const frac = Math.max(0.04, active / Math.max(1, last.length))
  const r = 52, C = 2 * Math.PI * r
  const ring = `<g transform="translate(375 108)">
  <circle r="${r}" fill="none" stroke="${T.line}" stroke-width="9"/>
  <circle r="${r}" fill="none" stroke="url(#g)" stroke-width="9" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}">
    <animate attributeName="stroke-dasharray" from="0 ${C.toFixed(1)}" to="${(C * frac).toFixed(1)} ${C.toFixed(1)}" dur="1.2s" fill="freeze"/>
  </circle>
  <text x="0" y="6" text-anchor="middle" style="font:700 26px ${SANS};fill:${T.white}">${fmt(lastTotal)}</text>
  <text x="0" y="26" text-anchor="middle" class="s">contributions</text>
  <text x="0" y="${r + 28}" text-anchor="middle" class="m">${active} active days · 365d</text>
</g>`
  return frame(480, 210, `<text class="t" x="26" y="34">GitHub Stats</text>\n${body}\n${ring}`, `${d.name}'s GitHub stats`)
}

function langsCard(d) {
  const top = d.languages.slice(0, 6)
  const total = top.reduce((a, l) => a + l.size, 0) || 1
  let x = 26
  const W = 428
  const bar = top.map((l, i) => {
    const w = Math.max(2, (l.size / total) * W)
    const seg = `<rect x="${x.toFixed(1)}" y="52" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`
    x += w
    return seg
  }).join('')
  const legend = top.map((l, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const lx = 26 + col * 220, ly = 98 + row * 30
    const pct = ((l.size / total) * 100).toFixed(1)
    return `<g class="fade" style="animation-delay:${0.1 + i * 0.07}s"><circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${l.color}"/><text class="l" x="${lx + 20}" y="${ly}">${esc(l.name)}</text><text class="s" x="${lx + 196}" y="${ly}" text-anchor="end">${pct}%</text></g>`
  }).join('\n')
  return frame(480, 210, `<text class="t" x="26" y="34">Most Used Languages</text>
<clipPath id="bar"><rect x="26" y="52" width="${W}" height="10" rx="5"/></clipPath>
<g clip-path="url(#bar)">${bar}</g>
${legend}`, 'Most used languages')
}

function streakCard(s) {
  const today = new Date().toISOString().slice(0, 10)
  const range = (a, b) => (a ? (a === b ? dfmt(a) : `${dfmt(a, a.slice(0, 4) !== b.slice(0, 4))} – ${dfmt(b)}`) : '—')
  const col = (cx, big, label, sub, color) => `<g class="fade" transform="translate(${cx} 0)">
  <text x="0" y="104" text-anchor="middle" style="font:700 34px ${SANS};fill:${T.white}">${big}</text>
  <text x="0" y="140" text-anchor="middle" style="font:600 15px ${SANS};fill:${color}">${label}</text>
  <text x="0" y="164" text-anchor="middle" class="s">${sub}</text>
</g>`
  const r = 46, cx = 480
  const ring = `<g transform="translate(${cx} 92)">
  <circle r="${r}" fill="none" stroke="${T.violet}" stroke-width="5"/>
  <path d="M0 ${-r - 14} c 7 8 9 13 4 20 c 6 -2 8 -6 8 -10 c 6 7 5 16 -2 21 c -6 4 -14 4 -20 0 c -7 -5 -8 -14 -2 -21 c 0 4 2 8 6 10 c -3 -6 0 -13 6 -20z" fill="${T.pink}" transform="scale(0.55) translate(0 ${-r * 0.82})"/>
  <text x="0" y="12" text-anchor="middle" style="font:700 34px ${SANS};fill:${T.white}">${s.current.len}</text>
</g>
<text x="${cx}" y="168" text-anchor="middle" style="font:600 15px ${SANS};fill:${T.cyan}">Current Streak</text>
<text x="${cx}" y="190" text-anchor="middle" class="s">${s.current.len ? range(s.current.start, s.current.end) : 'Start one today'}</text>`
  return frame(960, 210, `<line x1="320" y1="40" x2="320" y2="176" stroke="${T.line}"/><line x1="640" y1="40" x2="640" y2="176" stroke="${T.line}"/>
${col(160, fmt(s.total), 'Total Contributions', s.first ? `${dfmt(s.first)} – Present` : '', T.cyan)}
${ring}
${col(800, s.longest.len, 'Longest Streak', range(s.longest.start, s.longest.end), T.cyan)}`, 'Contribution streak')
}

function activityCard(d) {
  const days = d.calendar.filter((x) => x.date <= new Date().toISOString().slice(0, 10)).slice(-31)
  const W = 1200, H = 330, L = 64, R = 32, Tp = 70, B = 56
  const pw = W - L - R, ph = H - Tp - B
  const max = Math.max(4, ...days.map((x) => x.count))
  const step = Math.ceil(max / 4)
  const top = step * 4
  const X = (i) => L + (i / Math.max(1, days.length - 1)) * pw
  const Y = (v) => Tp + ph - (v / top) * ph
  const pts = days.map((x, i) => [X(i), Y(x.count)])
  // Smooth path (Catmull-Rom → cubic Bézier)
  let path = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    path += ` C${c1[0].toFixed(1)} ${Math.min(Tp + ph, c1[1]).toFixed(1)} ${c2[0].toFixed(1)} ${Math.min(Tp + ph, c2[1]).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  const area = `${path} L${pts.at(-1)[0].toFixed(1)} ${Tp + ph} L${pts[0][0].toFixed(1)} ${Tp + ph}Z`
  const grid = [0, 1, 2, 3, 4].map((k) => {
    const v = step * k, y = Y(v)
    return `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${T.line}" stroke-dasharray="${k ? '3 5' : ''}"/><text class="m" x="${L - 12}" y="${y + 4}" text-anchor="end">${v}</text>`
  }).join('\n')
  const xl = days.map((x, i) => (i % 3 === 0 || i === days.length - 1)
    ? `<text class="m" x="${X(i).toFixed(1)}" y="${H - B + 22}" text-anchor="middle">${Number(x.date.slice(8))}</text>` : '').join('')
  const dots = pts.map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${T.bg}" stroke="${T.pink}" stroke-width="2"><title>${dfmt(days[i].date)}: ${days[i].count}</title></circle>`).join('')
  const len = 4000
  const total = days.reduce((a, x) => a + x.count, 0)
  return frame(W, H, `<text class="t" x="${L}" y="38">Contribution Activity</text>
<text class="s" x="${W - R}" y="38" text-anchor="end">${fmt(total)} contributions · ${dfmt(days[0].date, false)} – ${dfmt(days.at(-1).date)}</text>
${grid}
<path d="${area}" fill="url(#gv)" class="fade"/>
<path d="${path}" fill="none" stroke="${T.cyan}" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="${len}">
  <animate attributeName="stroke-dashoffset" from="${len}" to="0" dur="1.6s" fill="freeze"/>
</path>
<g class="fade" style="animation-delay:1.2s">${dots}</g>
${xl}
<text class="m" x="${L + pw / 2}" y="${H - 10}" text-anchor="middle">day of month</text>`, 'Contribution activity, last 31 days')
}

// ---------- main ----------

const sample = process.argv.includes('--sample')
const login = process.env.USERNAME || process.env.GITHUB_REPOSITORY_OWNER || 'pranjalpanwar81'
if (!sample && !process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is required (or pass --sample).')
  process.exit(1)
}
const data = sample ? sampleData() : await fetchData(login)
const s = streaks(data.calendar)
await mkdir(OUT, { recursive: true })
await writeFile(`${OUT}/stats.svg`, statsCard(data, s))
await writeFile(`${OUT}/languages.svg`, langsCard(data))
await writeFile(`${OUT}/streak.svg`, streakCard(s))
console.log(`Wrote 3 cards to ${OUT}/ (total ${s.total}, current streak ${s.current.len}, longest ${s.longest.len})`)
