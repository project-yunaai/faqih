const express = require('express')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

const PORT = 3001

// Load cookies dari file
function loadCookies() {
  const cookiePath = path.join(__dirname, 'gemini-cookies.json')
  const raw = fs.readFileSync(cookiePath, 'utf8').replace(/^\uFEFF/, '')
  const data = JSON.parse(raw)
  const cookies = data.cookies || data
  const header = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  return { header, count: cookies.length }
}

// Load endpoint config dari file
function loadEndpointConfig() {
  const epPath = path.join(__dirname, 'gemini-endpoints-full.json')
  const raw = fs.readFileSync(epPath, 'utf8').replace(/^\uFEFF/, '')
  const data = JSON.parse(raw)
  const batchEp = data.endpoints.find(e => e.baseUrl.includes('batchexecute'))
  return batchEp || null
}

let cookieCache = null
let endpointCache = null

function getCookies() {
  if (!cookieCache) cookieCache = loadCookies()
  return cookieCache
}

function getEndpoint() {
  if (!endpointCache) endpointCache = loadEndpointConfig()
  return endpointCache
}

// Health check
app.get('/api/health', (_req, res) => {
  const cookies = getCookies()
  const ep = getEndpoint()
  res.json({
    status: 'ok',
    cookiesCount: cookies.count,
    endpoint: ep ? ep.baseUrl : 'not found',
    params: ep ? ep.params : {}
  })
})

// Generate text-to-image
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, ratio = '1:1' } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })

    const cookies = getCookies()
    const ep = getEndpoint()

    if (!ep) {
      return res.status(500).json({ error: 'Endpoint config not found' })
    }

    console.log(`[API] Generating: ${prompt} (${ratio})`)

    // Build batchexecute URL with q4uTj rpcid (the actual image generation endpoint)
    const baseUrl = 'https://gemini.google.com/_/BardChatUi/data/batchexecute'
    const params = new URLSearchParams({
      'rpcids': 'q4uTj',
      'source-path': '/share/b1493cbc4a17',
      'bl': ep.params.bl || 'boq_assistant-bard-web-server_20260821.03_p0',
      'f.sid': ep.params['f.sid'] || '',
      'hl': 'id',
      '_reqid': String(Math.floor(Math.random() * 900000) + 100000),
      'rt': 'c'
    })

    const url = `${baseUrl}?${params.toString()}`

    // Build request body - this mimics the Gemini Canvas generation request
    // The format is: f.req=<array containing prompt data>
    const reqId = Math.floor(Math.random() * 100000)
    const innerData = JSON.stringify([
      null,
      JSON.stringify(prompt),
      null,
      null,
      null,
      null,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ])

    const freqPayload = JSON.stringify([
      [
        [
          'q4uTj',
          JSON.stringify([
            null,
            [[prompt, ratio]],
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
          ]),
          null,
          'generic'
        ]
      ]
    ])

    const formData = `f.req=${encodeURIComponent(freqPayload)}&at=${ep.params['f.sid'] || ''}`

    const response = await axios.post(url, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Cookie': cookies.header,
        'Origin': 'https://gemini.google.com',
        'Referer': 'https://gemini.google.com/share/b1493cbc4a17',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Same-Domain': '1'
      },
      timeout: 180000
    })

    const rawText = response.data

    // Parse the response - Gemini returns a peculiar format starting with )]}'
    // Then contains JSON with inlineData (base64 image)
    let imageData = null

    // Look for inlineData with image/jpeg
    const jpegMatch = rawText.match(/"inlineData":\s*\{\s*"mimeType":\s*"image\/jpeg"\s*,\s*"data":\s*"([^"]+)"/)
    if (jpegMatch) {
      imageData = jpegMatch[1]
      console.log(`[API] Found image data: ${imageData.length} chars base64`)
    }

    if (!imageData) {
      // Try alternative pattern
      const altMatch = rawText.match(/"data"\s*:\s*"([A-Za-z0-9+/=]{1000,})"/)
      if (altMatch) {
        imageData = altMatch[1]
        console.log(`[API] Found image data (alt): ${imageData.length} chars base64`)
      }
    }

    if (!imageData) {
      console.log('[API] No image found in response. Preview:', rawText.substring(0, 500))
      return res.status(500).json({
        error: 'No image generated',
        responsePreview: rawText.substring(0, 500)
      })
    }

    res.json({
      success: true,
      data: {
        url: `data:image/jpeg;base64,${imageData}`,
        prompt,
        ratio
      }
    })

  } catch (error) {
    console.error('[API] Error:', error.message)
    res.status(500).json({
      error: error.message,
      details: error.response?.data?.substring(0, 500) || 'No details'
    })
  }
})

// Image-to-image
app.post('/api/image-to-image', async (_req, res) => {
  res.status(422).json({
    error: 'Image-to-image tidak didukung via direct API. Gunakan text-to-image.'
  })
})

app.listen(PORT, () => {
  console.log(`[SERVER] Running on http://localhost:${PORT}`)
  const c = getCookies()
  const ep = getEndpoint()
  console.log(`[API] Cookies: ${c.count} | Endpoint: ${ep?.baseUrl || 'N/A'}`)
  console.log(`[API] f.sid: ${ep?.params['f.sid'] || 'N/A'}`)
  console.log(`[API] bl: ${ep?.params.bl || 'N/A'}`)
})
