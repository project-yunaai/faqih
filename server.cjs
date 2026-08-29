const express = require('express')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const cors = require('cors')

let SocksProxyAgent = null
try {
  SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent
} catch {}

const USE_WARP = process.env.USE_WARP === '1'
const WARP_URL = process.env.WARP_URL || 'socks5h://127.0.0.1:40000'
const warpAgent = USE_WARP && SocksProxyAgent ? new SocksProxyAgent(WARP_URL) : null
if (USE_WARP && !warpAgent) console.log('[WARP] socks-proxy-agent belum terinstall - jalankan npm install socks-proxy-agent')
if (warpAgent) console.log('[WARP] Aktif - request lewat ' + WARP_URL)

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

const PORT = process.env.PORT || 3010
const API_KEY = process.env.COOKIE_API_KEY || 'yuna-rahasia-2026'

// === Load cookies ===
function loadCookies() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'gemini-cookies.json'), 'utf8'))
  const cookies = raw.cookies || raw
  const arr = Array.isArray(cookies) ? cookies : Object.entries(cookies).map(([name, value]) => ({ name, value }))
  const header = arr.map(c => `${c.name}=${c.value}`).join('; ')
  const map = {}
  for (const c of arr) {
    if (!map[c.name]) map[c.name] = c.value
  }
  return { header, map, count: arr.length }
}

// === Token dinamis (dari ekstensi) ===
function loadTokens() {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, 'gemini-tokens.json'), 'utf8'))
    return t && (t.at || t.bl || t.fSid) ? t : null
  } catch {
    return null
  }
}

// === Endpoint config from capture ===
const ENDPOINT_BASE = 'https://gemini.google.com/_/BardChatUi/data/batchexecute'
const PARAMS = {
  rpcids: 'q4uTj',
  'source-path': '/share/b1493cbc4a17',
  bl: 'boq_assistant-bard-web-server_20260821.03_p0',
  'f.sid': '6751928901003072751',
  hl: 'id',
  _reqid: '59911',
  rt: 'c',
}

let cachedCookies = null
function getCookies() {
  if (!cachedCookies) {
    cachedCookies = loadCookies()
    console.log(`[API] Loaded ${cachedCookies.count} cookies`)
  }
  return cachedCookies
}

// === Terima cookies + token dari ekstensi Chrome (mirip rupaai4-main) ===
app.post('/api/gemini/capture-tokens', (req, res) => {
  try {
    const { key, cookies, cookiesParsed, at, bl, fSid, shareId, hl } = req.body || {}
    if (key !== API_KEY) return res.status(401).json({ error: 'API key salah' })

    let cookieArr = []
    if (Array.isArray(cookies)) {
      cookieArr = cookies.filter((c) => c && c.name && c.value !== undefined)
    } else if (cookiesParsed && typeof cookiesParsed === 'object') {
      cookieArr = Object.entries(cookiesParsed).map(([name, value]) => ({ name, value: String(value) }))
    } else if (typeof cookies === 'string' && cookies.includes('=')) {
      cookieArr = cookies
        .split(';')
        .map((p) => {
          const idx = p.indexOf('=')
          return idx > 0 ? { name: p.slice(0, idx).trim(), value: p.slice(idx + 1).trim() } : null
        })
        .filter(Boolean)
    } else if (cookies && typeof cookies === 'object') {
      cookieArr = Object.entries(cookies).map(([name, value]) => ({ name, value: String(value) }))
    }

    const names = new Set(cookieArr.map((c) => c.name))
    const loggedIn = names.has('__Secure-1PSID') || names.has('__Secure-3PSID') || names.has('SID')
    if (!loggedIn) {
      return res.status(400).json({ error: 'Cookie login tidak ditemukan. Pastikan sudah login ke Gemini.' })
    }

    fs.writeFileSync(
      path.join(__dirname, 'gemini-cookies.json'),
      JSON.stringify({ metadata: { capturedAt: new Date().toISOString(), source: 'chrome-extension' }, cookies: cookieArr }, null, 2)
    )

    const prev = loadTokens() || {}
    const tokens = {
      at: at || prev.at || null,
      bl: bl || prev.bl || null,
      fSid: fSid || prev.fSid || null,
      shareId: shareId || prev.shareId || null,
      hl: hl || prev.hl || 'id',
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(path.join(__dirname, 'gemini-tokens.json'), JSON.stringify(tokens, null, 2))

    cachedCookies = null
    const c = getCookies()
    console.log(`[CAPTURE] Cookies: ${c.count}, tokens: at=${!!tokens.at} bl=${tokens.bl || '-'} fSid=${tokens.fSid || '-'}`)
    res.json({ success: true, cookiesCount: c.count, tokens: { at: !!tokens.at, bl: tokens.bl, fSid: tokens.fSid, shareId: tokens.shareId } })
  } catch (e) {
    console.error('[CAPTURE] Error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// === Status token (untuk popup ekstensi) ===
app.get('/api/gemini/token-status', (_req, res) => {
  const t = loadTokens()
  const c = getCookies()
  res.json({
    hasCookies: c.count > 0,
    cookiesCount: c.count,
    hasSID: !!c.map['__Secure-1PSID'] || !!c.map.SID,
    tokens: t ? { at: !!t.at, bl: t.bl || null, fSid: t.fSid || null, shareId: t.shareId || null, updatedAt: t.updatedAt } : null,
  })
})

// === Terima cookies dari ekstensi Chrome ===
app.post('/api/cookies', (req, res) => {
  try {
    const { key, cookies } = req.body || {}
    if (key !== API_KEY) return res.status(401).json({ error: 'API key salah' })
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({ error: 'Cookies kosong' })
    }

    const names = new Set(cookies.map((c) => c.name))
    const loggedIn = names.has('__Secure-1PSID') || names.has('__Secure-3PSID') || names.has('SID')
    if (!loggedIn) {
      return res.status(400).json({ error: 'Cookie login tidak ditemukan. Pastikan sudah login ke Gemini di browser.' })
    }

    const cleaned = cookies
      .filter((c) => c && c.name && c.value !== undefined)
      .map((c) => ({ name: c.name, value: c.value, domain: c.domain || '', path: c.path || '/' }))

    fs.writeFileSync(
      path.join(__dirname, 'gemini-cookies.json'),
      JSON.stringify(
        { metadata: { capturedAt: new Date().toISOString(), source: 'chrome-extension' }, cookies: cleaned },
        null,
        2
      )
    )
    cachedCookies = null
    const c = getCookies()
    console.log(`[COOKIES] Diperbarui dari ekstensi: ${c.count} cookies`)
    res.json({ success: true, count: c.count, hasSID: !!c.map['__Secure-1PSID'], updatedAt: new Date().toISOString() })
  } catch (e) {
    console.error('[COOKIES] Error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// === Terima hasil generate dari ekstensi Chrome ===
app.post('/api/gemini-from-extension', async (req, res) => {
  try {
    const { prompt, ratio, sessionId } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })
    
    console.log(`[EXTENSION] Generate request received: ${prompt} (${ratio})`)
    
    // Generate unique ID for this session
    const id = `${Date.now()}-${sessionId || Math.random().toString(36).substr(2, 9)}`
    
    // Acknowledge the request and let extension do the work
    res.json({ 
      success: true, 
      status: 'processing',
      id,
      message: 'Extension will process this request'
    })
    
    // Store metadata for history
    const fs = require('fs')
    const historyDir = path.join(__dirname, 'generate-history')
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true })
    
    fs.writeFileSync(
      path.join(historyDir, `${id}.json`),
      JSON.stringify({
        id,
        prompt,
        ratio,
        startTime: new Date().toISOString(),
        source: 'extension-proxy',
      })
    )
    
  } catch (e) {
    console.error('[EXTENSION] Error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// === Receipt result from extension ===
app.post('/api/gemini-result', async (req, res) => {
  try {
    const { id, url, prompt, ratio, success } = req.body
    
    if (!id) return res.status(400).json({ error: 'Missing id' })
    
    const fs = require('fs')
    const historyDir = path.join(__dirname, 'generate-history')
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true })
    
    fs.writeFileSync(
      path.join(historyDir, `${id}.json`),
      JSON.stringify({
        id,
        prompt,
        ratio,
        endTime: new Date().toISOString(),
        resultUrl: url,
        success: success !== false,
        source: 'extension-proxy'
      }, null, 2)
    )
    
    console.log(`[EXTENSION] Result received for ${id}: ${success ? 'success' : 'failed'}`)
    
    res.json({ 
      success: true, 
      processed: true,
      id 
    })
    
  } catch (e) {
    console.error('[RESULT] Error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// === Health ===
app.get('/api/health', (_req, res) => {
  const c = getCookies()
  res.json({
    status: 'ok',
    cookiesCount: c.count,
    hasSID: !!c.map.SID || !!c.map['__Secure-1PSID'],
    hasAPISID: !!c.map.APISID || !!c.map['__Secure-1PAPISID'],
  })
})

// === Generate (text-to-image) ===
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, ratio = '1:1' } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })

    const cookies = getCookies()
    const tokens = loadTokens()
    const reqid = Math.floor(Math.random() * 900000) + 100000

    // Build URL - token dinamis dari ekstensi, fallback ke hardcode
    const url = new URL(ENDPOINT_BASE)
    url.searchParams.set('rpcids', 'q4uTj')
    url.searchParams.set('source-path', tokens?.shareId ? `/share/${tokens.shareId}` : PARAMS['source-path'])
    url.searchParams.set('bl', tokens?.bl || PARAMS.bl)
    url.searchParams.set('f.sid', tokens?.fSid || PARAMS['f.sid'])
    url.searchParams.set('hl', tokens?.hl || PARAMS.hl)
    url.searchParams.set('_reqid', String(reqid))
    url.searchParams.set('rt', 'c')

    // Build request body - format Canvas asli (dari test-live.mjs yang working)
    // inner = JSON string dari {contents, generationConfig}, lalu di-escape ke dalam array f.req
    const inner = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } },
    })
    const shareIdForBody = tokens?.shareId || 'b1493cbc4a17'
    const fReqInner = '[null,"' + inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '",4,"' + shareIdForBody + '"]'
    const fReq = JSON.stringify([[['q4uTj', fReqInner, null, 'generic']]])

    const atToken = tokens?.at || cookies.map.SAPISID || ''
    const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(atToken)}`

    console.log(`[API] Generating: ${prompt} (${ratio})`)
    console.log(`[API] POST ${url.toString().substring(0, 80)}...`)

    const response = await axios.post(url.toString(), body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Cookie': cookies.header,
        'Origin': 'https://gemini.google.com',
        'Referer': tokens?.shareId ? `https://gemini.google.com/share/${tokens.shareId}` : 'https://gemini.google.com/share/b1493cbc4a17',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'X-Same-Domain': '1',
      },
      timeout: 180000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      ...(warpAgent ? { httpAgent: warpAgent, httpsAgent: warpAgent } : {}),
    })

    const raw = response.data
    console.log(`[API] Response length: ${typeof raw === 'string' ? raw.length : 'N/A'}`)
    console.log(`[API] Response preview: ${String(raw).substring(0, 400)}`)

    // Parse the response - Gemini returns format: )]}'\n\n<size>\n<json-data>
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw)

    // Extract base64 image data from response
    // The response contains inlineData with base64 JPEG
    const match = text.match(/"data"\s*:\s*"([^"]{100,})"/)
    if (match) {
      const base64Data = match[1]
      console.log(`[API] Found image data: ${base64Data.length} chars`)
      return res.json({
        success: true,
        data: {
          url: `data:image/jpeg;base64,${base64Data}`,
          prompt,
          ratio,
        },
      })
    }

    // Fallback: try to find any base64 JPEG pattern
    const jpegMatch = text.match(/\/9j\/[A-Za-z0-9+/=]{100,}/)
    if (jpegMatch) {
      const base64Data = jpegMatch[0]
      console.log(`[API] Found JPEG data: ${base64Data.length} chars`)
      return res.json({
        success: true,
        data: {
          url: `data:image/jpeg;base64,${base64Data}`,
          prompt,
          ratio,
        },
      })
    }

    // If no image found, return error with preview
    console.error('[API] No image in response. Preview:', text.substring(0, 500))
    return res.status(500).json({
      error: 'No image generated in response',
      preview: text.substring(0, 500),
    })
  } catch (error) {
    console.error('[API] Error:', error.message)
    if (error.response) {
      console.error('[API] Response status:', error.response.status)
      console.error('[API] Response preview:', String(error.response.data).substring(0, 300))
    }
    return res.status(500).json({
      error: error.message,
      details: error.response?.status ? `HTTP ${error.response.status}` : undefined,
    })
  }
})

// === Image-to-image (port dari rupaai4-main/server/proxy.js generateSingle) ===
app.post('/api/image-to-image', async (req, res) => {
  try {
    const { prompt, ratio = '1:1', base64Image, mimeType } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })
    if (!base64Image) return res.status(400).json({ error: 'base64Image required' })

    // Terima dataURL ("data:image/png;base64,xxx") atau base64 murni
    let imgBase64 = base64Image
    let imgMime = mimeType || 'image/png'
    const dm = String(base64Image).match(/^data:([^;]+);base64,(.+)$/)
    if (dm) {
      imgMime = dm[1]
      imgBase64 = dm[2]
    }
    imgBase64 = imgBase64.replace(/\s/g, '')

    const cookies = getCookies()
    const tokens = loadTokens()
    const reqid = Math.floor(Math.random() * 900000) + 100000
    const shareId = tokens?.shareId || 'b1493cbc4a17'

    const promptFull = `${prompt}\n\nInstruksi Wajib: Buatkan gambar dengan rasio aspek persis ${ratio}.`

    const parts = [
      { text: promptFull },
      { inlineData: { mimeType: imgMime, data: imgBase64 } },
    ]

    const innerJson = JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    })

    const fReq = JSON.stringify([
      [['q4uTj', JSON.stringify([null, innerJson, 4, shareId]), null, 'generic']],
    ])

    const url = new URL(ENDPOINT_BASE)
    url.searchParams.set('rpcids', 'q4uTj')
    url.searchParams.set('source-path', `/share/${shareId}`)
    url.searchParams.set('bl', tokens?.bl || PARAMS.bl)
    url.searchParams.set('f.sid', tokens?.fSid || PARAMS['f.sid'])
    url.searchParams.set('hl', tokens?.hl || PARAMS.hl)
    url.searchParams.set('_reqid', String(reqid))
    url.searchParams.set('rt', 'c')

    const atToken = tokens?.at || cookies.map.SAPISID || ''
    const body = new URLSearchParams({ 'f.req': fReq, at: atToken })

    console.log(`[I2I] Generating: ${prompt.substring(0, 60)} (${ratio}), image: ${imgMime} ${Math.round(imgBase64.length / 1024)}KB`)

    const response = await axios.post(url.toString(), body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Cookie': cookies.header,
        'Origin': 'https://gemini.google.com',
        'Referer': `https://gemini.google.com/share/${shareId}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'X-Same-Domain': '1',
      },
      timeout: 180000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      ...(warpAgent ? { httpAgent: warpAgent, httpsAgent: warpAgent } : {}),
    })

    const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    console.log(`[I2I] Response length: ${raw.length}`)

    // Parse response - cari inlineData base64 (sama seperti parseGeminiResponse di rupaai4-main)
    let imageData = null
    let outText = null
    try {
      let cleaned = raw.startsWith(")]}'") ? raw.substring(4).trim() : raw
      for (const line of cleaned.split('\n')) {
        const t = line.trim()
        if (!t || !t.startsWith('[')) continue
        try {
          const arr = JSON.parse(t)
          if (!Array.isArray(arr) || !arr[0]) continue
          let inner = arr[0][2]
          if (typeof inner !== 'string') continue
          inner = JSON.parse(inner)
          if (Array.isArray(inner)) inner = inner[0]
          if (typeof inner === 'string') inner = JSON.parse(inner)
          if (inner && inner.candidates) {
            for (const cand of inner.candidates) {
              for (const part of cand.content?.parts || []) {
                if (part.inlineData?.data && !imageData) {
                  imageData = { mimeType: part.inlineData.mimeType || 'image/jpeg', data: part.inlineData.data }
                } else if (part.text && !outText) {
                  outText = part.text
                }
              }
            }
          }
        } catch {}
      }
    } catch {}

    if (!imageData) {
      const m = raw.match(/\/9j\/[A-Za-z0-9+/=]{500,}/) || raw.match(/iVBORw0KGgo[A-Za-z0-9+/=]{500,}/)
      if (m) imageData = { mimeType: m[0].startsWith('/9j/') ? 'image/jpeg' : 'image/png', data: m[0] }
    }

    if (!imageData) {
      console.error('[I2I] No image. Preview:', raw.substring(0, 400))
      return res.status(500).json({
        error: outText || 'Tidak ada gambar di response. Model mungkin menolak gambar input.',
        preview: raw.substring(0, 300),
      })
    }

    console.log(`[I2I] Success: ${imageData.data.length} chars`)
    return res.json({
      success: true,
      data: {
        url: `data:${imageData.mimeType};base64,${imageData.data}`,
        prompt,
        ratio,
        text: outText || null,
      },
    })
  } catch (error) {
    console.error('[I2I] Error:', error.message)
    if (error.response) {
      console.error('[I2I] Status:', error.response.status)
      console.error('[I2I] Preview:', String(error.response.data).substring(0, 300))
    }
    return res.status(500).json({
      error: error.message,
      details: error.response?.status ? `HTTP ${error.response.status}` : undefined,
    })
  }
})

// === Terima tokens dari ekstensi Chrome (enhanced) - MERGED di atas, endpoint legacy berikut tetap untuk kompatibilitas ===

// === Start ===
app.listen(PORT, () => {
  console.log(`[SERVER] Running on http://localhost:${PORT}`)
  getCookies()
})
