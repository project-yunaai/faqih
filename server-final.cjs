const express = require('express')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

const PORT = 3001

// Load captured data
const loadCookies = () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'gemini-cookies.json'), 'utf8'))
  const cookies = raw.cookies || raw
  const header = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  return { header, map: Object.fromEntries(cookies.map(c => [c.name, c.value])), count: cookies.length }
}

// Captured values from request bodies
const CAPTURED_VALUES = {
  rpcids: 'q4uTj',
  sourcePath: '/share/b1493cbc4a17',
  bl: 'boq_assistant-bard-web-server_20260821.03_p0',
  at_token: 'ADR5zapbfc67QVv_bgDw4F-GBnZ5%3A1787388279338',
  hl: 'id',
}

let cachedData = null
function getCache() {
  if (!cachedData) {
    cachedData = {
      cookies: loadCookies(),
    }
    console.log(`[API] Loaded ${cachedData.cookies.count} cookies`)
  }
  return cachedData
}

// Health check
app.get('/api/health', (_req, res) => {
  const d = getCache()
  res.json({ status: 'ok', cookiesCount: d.cookies.count, isAuthenticated: true })
})

// Generate endpoint - uses exact captured request format
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, ratio = '1:1' } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })

    const cache = getCache()
    const reqid = Math.floor(Math.random() * 900000) + 100000
    const url = new URL('https://gemini.google.com/_/BardChatUi/data/batchexecute')
    
    // Build query params with fresh _reqid
    for (const [k, v] of Object.entries(CAPTURED_VALUES)) {
      if (k === 'rpcids') url.searchParams.set(k, v)
      else if (k === 'sourcePath') url.searchParams.set('source-path', v)
      else if (k === 'bl') url.searchParams.set(k, v)
      else if (k === 'at_token') url.searchParams.set('at', v)
      else url.searchParams.set(k, v)
    }
    url.searchParams.set('_reqid', String(reqid))
    url.searchParams.set('rt', 'c')

    // Build exact request body from capture (decoded)
    // Format: f.req=%5B%5B%5B..." (URL encoded JSON array)
    const innerContent = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: ratio } }
    })
    
    // This is the exact format from the capture, decoded and updated with our prompt
    const requestBody = JSON.stringify([['q4uTj', [null, innerContent, null, 'generic']]])
    const body = `f.req=${encodeURIComponent(requestBody)}&at=${CAPTURED_VALUES.at_token}`

    console.log(`\n[API] Generating: ${prompt} (${ratio})`)
    console.log(`[API] POST to: ${url.toString().substring(0, 80)}...`)
    console.log(`[API] Request body length: ${body.length}`)

    const response = await axios.post(url.toString(), body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Cookie': cache.cookies.header,
        'Origin': 'https://gemini.google.com',
        'Referer': `https://gemini.google.com/share/${CAPTURED_VALUES.sourcePath.substring(1)}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        'X-Same-Domain': '1',
      },
      timeout: 180000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })

    const rawData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    console.log(`[API] Response size: ${rawData.length} bytes`)

    // Parse Gemini's RPC response format: )]}'\n\n<size>\n<json-data>
    let jsonData
    try {
      const match = rawData.match(/^\]\}'\s+\n\s+(\d+)\s*\n\s+([\s\S]+)$/i)
      if (match) {
        jsonData = JSON.parse(match[2])
        console.log(`[API] Parsed JSON response`)
      } else {
        throw new Error('Unknown response format')
      }
    } catch (e) {
      console.error('[API] Parse error:', e.message)
      return res.status(500).json({
        error: 'Failed to parse response',
        preview: rawData.substring(0, 500),
      })
    }

    // Look for base64 image in candidates
    // Expected structure: [[..., [..., {"inlineData": {"data": "base64..."}}]]]
    const base64Match = rawData.match(/"data"\s*:\s*"\/9j\/[^"]{100,}/g)
    if (base64Match && base64Match.length > 0) {
      const base64Image = base64Match[0].replace('"data":"', '').replace(/"/g, '')
      console.log(`[API] Found base64 image: ${base64Image.length} chars`)
      return res.json({
        success: true,
        data: {
          url: `data:image/jpeg;base64,${base64Image}`,
          prompt,
          ratio,
        },
      })
    }

    // Fallback search for JPEG data pattern
    const jpegPattern = /\/9j\/[A-Za-z0-9+\/=]{500,}/g
    const jpegMatches = rawData.match(jpegPattern)
    if (jpegMatches && jpegMatches.length > 0) {
      const base64Image = jpegMatches[0]
      console.log(`[API] Found JPEG pattern: ${base64Image.length} chars`)
      return res.json({
        success: true,
        data: {
          url: `data:image/jpeg;base64,${base64Image}`,
          prompt,
          ratio,
        },
      })
    }

    console.error('[API] No image found in response. Preview:', rawData.substring(0, 500))
    return res.status(500).json({
      error: 'No image generated',
      preview: rawData.substring(0, 300),
    })

  } catch (error) {
    console.error('[API] Error:', error.message)
    if (error.response) {
      console.error('[API] Status:', error.response.status)
      console.error('[API] Body:', String(error.response.data).substring(0, 300))
    }
    return res.status(500).json({
      error: error.message,
      details: error.response?.status ? `HTTP ${error.response.status}` : undefined,
    })
  }
})

// Image-to-image not supported directly
app.post('/api/image-to-image', async (_req, res) => {
  res.status(422).json({
    error: 'Model ini tidak mendukung upload gambar langsung via API.\nGunakan Text to image untuk generate.',
  })
})

app.listen(PORT, () => {
  console.log(`[SERVER] Running on http://localhost:${PORT}`)
  getCache()
})
