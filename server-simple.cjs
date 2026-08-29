const express = require('express')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const PORT = 3001

// Load cookies
const loadCookies = () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'gemini-cookies.json'), 'utf8'))
  const cookies = raw.cookies || raw
  return {
    header: cookies.map(c => `${c.name}=${c.value}`).join('; '),
    map: Object.fromEntries(cookies.map(c => [c.name, c.value])),
    count: cookies.length
  }
}

const CACHE = { cookies: null }
function getCookies() {
  if (!CACHE.cookies) {
    CACHE.cookies = loadCookies()
    console.log(`[API] Loaded ${CACHE.cookies.count} cookies`)
  }
  return CACHE.cookies
}

// Health check
app.get('/api/health', (_req, res) => {
  const d = getCookies()
  res.json({ status: 'ok', cookiesCount: d.count, isAuthenticated: true })
})

// Generate endpoint
app.post('/api/generate', async (req, res) => {
  let page = null
  try {
    const { prompt, ratio = '16:9' } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })

    const cookies = getCookies()
    
    // Use Playwright to automate via CDP - simplest reliable approach
    const { chromium } = require('playwright')
    
    console.log(`\n[API] Generating: ${prompt}`)
    
    page = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(async () => {
      throw new Error('Cannot connect to Chrome. Please ensure Chrome with login is running on port 9222')
    })
    
    const context = page.contexts()[0]
    const newPage = await context.newPage()
    
    await newPage.goto('https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await newPage.waitForTimeout(5000)
    
    // Find iframe generator
    let frame = null
    for (const f of newPage.frames()) {
      const ta = await f.locator('textarea:visible').count().catch(() => 0)
      const btn = await f.getByRole('button', { name: 'Generate Gambar' }).count().catch(() => 0)
      if (ta > 0 && btn > 0) {
        frame = f
        break
      }
    }
    
    if (!frame) throw new Error('Generator iframe not found')
    
    await frame.locator('textarea:visible').first().fill(`${prompt}. High quality, detailed, aspect ratio ${ratio}`)
    await frame.getByRole('button', { name: 'Generate Gambar' }).click()
    
    console.log('[API] Waiting for image...')
    
    try {
      await newPage.waitForFunction(() => {
        return [...document.images].filter(img => img.naturalWidth >= 128).length > 0
      }, { timeout: 180000 })
    } catch {}
    
    const images = await newPage.$$('img:not([src^="data:"])')
    
    if (images.length === 0) throw new Error('No image generated')
    
    const buf = await images[0].screenshot({ type: 'png' })
    const base64 = buf.toString('base64')
    
    console.log(`[API] Success! Image size: ${buf.length} bytes`)
    
    res.json({
      success: true,
      data: {
        url: `data:image/png;base64,${base64}`,
        prompt,
        ratio
      }
    })
    
  } catch (error) {
    console.error('[API] Error:', error.message)
    res.status(500).json({ error: error.message })
  } finally {
    if (page) {
      try { await page.close() } catch {}
    }
  }
})

// Image-to-image
app.post('/api/image-to-image', async (_req, res) => {
  res.status(422).json({ error: 'Image upload not supported directly. Use Text to image.' })
})

app.listen(PORT, () => {
  console.log(`[SERVER] Running on http://localhost:${PORT}`)
  getCookies()
})
