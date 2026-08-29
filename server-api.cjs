const express = require('express')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

const PORT = 3001
const SHARE_ID = 'b1493cbc4a17'

function loadCookieHeader() {
  const raw = fs.readFileSync(path.join(__dirname, 'gemini-cookies.json'), 'utf8').replace(/^\uFEFF/, '')
  const data = JSON.parse(raw)
  const cookies = data.cookies || data
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

function loadEndpointParams() {
  const raw = fs.readFileSync(path.join(__dirname, 'gemini-endpoints-full.json'), 'utf8').replace(/^\uFEFF/, '')
  const data = JSON.parse(raw)
  const ep = data.endpoints.find(e => e.baseUrl.includes('batchexecute'))
  return ep?.params || {}
}

function loadAtToken() {
  // Try to read from captured request bodies
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'captured-request-bodies.json'), 'utf8').replace(/^\uFEFF/, '')
    const reqs = JSON.parse(raw)
    for (const r of reqs) {
      if (r.postData) {
        const match = r.postData.match(/at=([^&]+)/)
        if (match) return decodeURIComponent(match[1])
      }
    }
  } catch {}
  return null
}

let cookieHeader = null
let endpointParams = null
let atToken = null

function init() {
  cookieHeader = loadCookieHeader()
  endpointParams = loadEndpointParams()
  atToken = loadAtToken()
  console.log(`[API] Cookies loaded`)
  console.log(`[API] f.sid: ${endpointParams['f.sid']}`)
  console.log(`[API] bl: ${endpointParams.bl}`)
  console.log(`[API] at token: ${atToken}`)
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasCookies: !!cookieHeader,
    hasAtToken: !!atToken,
    fSid: endpointParams['f.sid'] || 'N/A'
  })
})

app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, ratio = '1:1' } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })

    console.log(`[API] Generating: ${prompt} (${ratio})`)

    // Build the inner Gemini API request (same format as Canvas)
    const innerRequest = JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: ratio }
      }
    })

    // Build f.req payload (exact format captured from Canvas)
    const freqPayload = JSON.stringify([
      [
        [
          'q4uTj',
          JSON.stringify([null, innerRequest, 4, SHARE_ID]),
          null,
          'generic'
        ]
      ]
    ])

    const postData = `f.req=${encodeURIComponent(freqPayload)}&at=${encodeURIComponent(atToken || '')}`

    // Build URL with fresh params
    const urlParams = new URLSearchParams({
      'rpcids': 'q4uTj',
      'source-path': `/share/${SHARE_ID}`,
      'bl': endpointParams.bl || 'boq_assistant-bard-web-server_20260821.03_p0',
      'f.sid': endpointParams['f.sid'] || '',
      'hl': 'id',
      '_reqid': String(Math.floor(Math.random() * 900000) + 100000),
      'rt': 'c'
    })

    const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?${urlParams.toString()}`

    console.log(`[API] POST to batchexecute (q4uTj)`)

    const response = await axios.post(url, postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Cookie': cookieHeader,
        'Origin': 'https://gemini.google.com',
        'Referer': `https://gemini.google.com/share/${SHARE_ID}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Same-Domain': '1'
      },
      timeout: 180000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    })

    const rawText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)

    // Parse response - Gemini returns nested JSON with escaped quotes
    // The image data is inside multiple layers of JSON encoding
    let imageData = null

    // The response format is: )]}'\n\n<size>\n[["wrb.fr","q4uTj","[\"{\\\"candidates\\\":...\"data\\\":\\\"<base64>\\\"..." 
    // We need to progressively decode the JSON layers

    // Step 1: Remove the XSSI prefix
    let cleaned = rawText.replace(/^\)\]\}'\s*\n*\s*/m, '')

    // Step 2: Find the q4uTj response array
    const q4uTjMatch = cleaned.match(/\["wrb\.fr","q4uTj","(.+?)",null,null,null,"generic"\]/s)
    if (q4uTjMatch) {
      let layer1 = q4uTjMatch[1]
      // layer1 is a JSON string containing another JSON string
      // Decode layer 1
      try {
        const decoded1 = JSON.parse(layer1) // This gives us a string
        // decoded1 is like: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/jpeg","data":"<base64>"}}]}]}
        const parsed = JSON.parse(decoded1)
        if (parsed.candidates?.[0]?.content?.parts) {
          for (const part of parsed.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              imageData = part.inlineData.data
              break
            }
          }
        }
      } catch (e) {
        console.log('[API] JSON parse error:', e.message)
        // Fallback: regex for base64 data
        const base64Match = layer1.match(/"data"\\*:\s*\\*"([A-Za-z0-9+/=]{1000,})/)
        if (base64Match) {
          imageData = base64Match[1]
        }
      }
    }

    // Fallback: search for any very long base64 string in the raw response
    if (!imageData) {
      const match = rawText.match(/([A-Za-z0-9+/=]{50000,})/)
      if (match) {
        imageData = match[1]
      }
    }

    if (!imageData) {
      console.log('[API] No image found. Response preview:', rawText.substring(0, 500))
      return res.status(500).json({
        error: 'No image generated',
        responsePreview: rawText.substring(0, 500)
      })
    }

    console.log(`[API] Image found! Base64 length: ${imageData.length}`)
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
    if (error.response) {
      console.error('[API] Response status:', error.response.status)
      console.error('[API] Response data:', (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)).substring(0, 500))
    }
    res.status(500).json({
      error: error.message,
      details: error.response ? (typeof error.response.data === 'string' ? error.response.data.substring(0, 500) : JSON.stringify(error.response.data).substring(0, 500)) : 'No details'
    })
  }
})

app.post('/api/image-to-image', async (_req, res) => {
  res.status(422).json({ error: 'Image-to-image tidak didukung via direct API' })
})

app.listen(PORT, () => {
  console.log(`[SERVER] Running on http://localhost:${PORT}`)
  init()
})
