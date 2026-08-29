// keeper.cjs - Token Keeper daemon untuk Yuna AI
// Menjalankan Chromium persistent (headed di Xvfb :99), harvest token Gemini tiap 10 menit.
// Login pertama kali via noVNC: https://yuna.kertasdigital.id/vnc/vnc.html
// Data yang di-harvest: cookies (SID dll) + token at/bl/fSid -> gemini-tokens.json & gemini-cookies.json

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const http = require('http')

const PROFILE = path.join(__dirname, '.chrome-profile')
const TOKENS_FILE = path.join(__dirname, 'gemini-tokens.json')
const COOKIES_FILE = path.join(__dirname, 'gemini-cookies.json')
const GEMINI_URL = 'https://gemini.google.com/app'
const DEFAULT_SHARE_ID = 'b1493cbc4a17'
const INTERVAL_MS = 10 * 60 * 1000
const PORT = 3011

process.env.DISPLAY = process.env.DISPLAY || ':99'

const state = {
  lastHarvest: null,
  lastError: null,
  loggedIn: false,
  tokens: null,
  cookieCount: 0,
  harvestCount: 0,
  busy: false,
  startedAt: new Date().toISOString(),
}

let ctx = null
let starting = null

async function ensureBrowser() {
  if (ctx) return ctx
  if (starting) return starting
  starting = (async () => {
    fs.mkdirSync(PROFILE, { recursive: true })
    ctx = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--start-maximized',
      ],
      viewport: { width: 1280, height: 900 },
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    })
    console.log('[KEEPER] Chromium started (DISPLAY=' + process.env.DISPLAY + ')')
    return ctx
  })()
  try {
    return await starting
  } catch (e) {
    starting = null
    ctx = null
    throw e
  }
}

async function extractTokens(page) {
  return page.evaluate(() => {
    const tokens = { at: null, bl: null, fSid: null, shareId: null, hl: null }
    let allText = ''
    for (const s of document.querySelectorAll('script')) allText += (s.textContent || '') + '\n'
    allText += document.documentElement?.outerHTML || ''

    const patterns = {
      at: [/"SNlM0e"\s*:\s*"([^"]+)"/, /'SNlM0e'\s*:\s*'([^']+)'/],
      bl: [/"cfb2h"\s*:\s*"([^"]+)"/, /'cfb2h'\s*:\s*'([^']+)'/],
      fSid: [/"FdrFJe"\s*:\s*"([^"]+)"/, /'FdrFje'\s*:\s*'([^']+)'/],
      hl: [/"hl"\s*:\s*"([a-z]{2}(?:-[A-Z]{2})?)"/],
    }
    for (const [k, list] of Object.entries(patterns)) {
      for (const re of list) {
        const m = allText.match(re)
        if (m && m[1]) { tokens[k] = m[1]; break }
      }
    }
    try {
      if (window.WIZ_global_data) {
        if (!tokens.at && window.WIZ_global_data.SNlM0e) tokens.at = window.WIZ_global_data.SNlM0e
        if (!tokens.bl && window.WIZ_global_data.cfb2h) tokens.bl = window.WIZ_global_data.cfb2h
        if (!tokens.fSid && window.WIZ_global_data.FdrFJe) tokens.fSid = window.WIZ_global_data.FdrFJe
      }
    } catch {}
    return tokens
  })
}

async function harvest() {
  if (state.busy) return { skipped: true, reason: 'harvest masih berjalan' }
  state.busy = true
  try {
    const browser = await ensureBrowser()
    let page = browser.pages()[0]
    if (!page) page = await browser.newPage()

    await page.goto(GEMINI_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(6000)

    const all = await browser.cookies(
      'https://gemini.google.com',
      'https://www.google.com',
      'https://accounts.google.com'
    )

    const loggedIn = all.some((c) => c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID' || c.name === 'SID')
    state.loggedIn = loggedIn

    if (!loggedIn) {
      state.lastError = 'Belum login Google. Buka https://yuna.kertasdigital.id/api/admin lalu klik "Login Google via VNC".'
      console.log('[KEEPER] Belum login - menunggu user login via VNC')
      return { success: false, loggedIn: false, error: state.lastError }
    }

    const tokens = await extractTokens(page)
    tokens.shareId = tokens.shareId || DEFAULT_SHARE_ID
    tokens.updatedAt = new Date().toISOString()

    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2))
    fs.writeFileSync(
      COOKIES_FILE,
      JSON.stringify(
        { metadata: { capturedAt: new Date().toISOString(), source: 'vps-keeper' }, cookies: all },
        null,
        2
      )
    )

    state.lastHarvest = new Date().toISOString()
    state.lastError = null
    state.tokens = { at: !!tokens.at, bl: tokens.bl || null, fSid: tokens.fSid || null }
    state.cookieCount = all.length
    state.harvestCount++
    console.log(`[KEEPER] Harvest OK #${state.harvestCount}: ${all.length} cookies, at=${!!tokens.at} bl=${tokens.bl || '-'}`)
    return { success: true, ...state.tokens, cookieCount: all.length }
  } catch (e) {
    state.lastError = e.message
    console.error('[KEEPER] Harvest error:', e.message)
    return { success: false, error: e.message }
  } finally {
    state.busy = false
  }
}

// === Mini HTTP server untuk kontrol dari server.cjs ===
http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/harvest') {
      harvest().then((r) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(r))
      })
      return
    }
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state))
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[KEEPER] Control API on 127.0.0.1:${PORT}`))

async function main() {
  console.log('[KEEPER] Starting token keeper...')
  harvest().catch(() => {})
  setInterval(() => harvest().catch(() => {}), INTERVAL_MS)
}

main()
