const express = require('express')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Load cookies from file
const loadCookies = () => {
  const cookiePath = path.join(__dirname, 'gemini-cookies.json')
  const data = JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
  
  // Extract key session tokens
  const cookiesMap = {}
  for (const cookie of data.cookies) {
    if (!cookiesMap[cookie.name]) cookiesMap[cookie.name] = cookie.value
  }
  
  return cookiesMap
}

const PORT = 3001
let sessionTokens = null

async function getSessionTokens() {
  if (!sessionTokens) {
    sessionTokens = loadCookies()
    console.log('[API] Session tokens loaded:', Object.keys(sessionTokens).length)
  }
  return sessionTokens
}

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const tokens = await getSessionTokens()
    const hasAuth = tokens.SID && tokens.APISID || tokens.__Secure_1PSID
    res.json({ 
      status: 'ok', 
      tokensAvailable: Object.keys(tokens).length,
      isAuthenticated: hasAuth,
      sidLength: tokens.SID?.length || 0
    })
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message })
  }
})

// Direct API call to generate image
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, ratio = '1:1' } = req.body
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt required' })
    
    const tokens = await getSessionTokens()
    
    if (!tokens.SID && !tokens.__Secure_1PSID) {
      return res.status(401).json({ error: 'No valid session found. Please log in to Gemini first.' })
    }
    
    // Use SID or PSID for authentication
    const sessionId = tokens.SID || tokens.__Secure_1PSID
    const apSid = tokens.APISID || tokens.__Secure_1PAPISID
    
    console.log(`[API] Generating: ${prompt} (${ratio})`)
    
    // Construct request body for text-to-image generation
    // This mimics what happens when you type in Gemini Canvas and click Generate
    const requestBody = {
      realResponse: true,
      responseFormat: 'json',
      conversationId: '',
      params: `["${encodeURIComponent(prompt)}"]`
    }
    
    // Call Gemini API with session cookies
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': tokens._API_KEY || 'AIzaSyBWW50ghQ5qHpMg1gxHV7U9t0wHE0qIUk4',
          'Authorization': `Bearer ${sessionId}`,
          'X-Goog-User-Project': 'project-id'
        },
        timeout: 120000
      }
    )
    
    // Parse response and extract generated content
    const result = response.data
    if (result.candidates && result.candidates[0]?.content?.parts) {
      const parts = result.candidates[0].content.parts
      // Check if any part is an image URL
      const imageUrl = parts.find(p => p.inlineData)?.inlineData?.data
      if (imageUrl) {
        res.json({ success: true, data: { url: imageUrl, prompt, ratio } })
        return
      }
    }
    
    // Fallback: Return the text response if image wasn't generated
    const textResponse = result.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || 'No response'
    console.log('[API] Response:', textResponse.substring(0, 200))
    
    res.json({ success: false, data: { error: textResponse, prompt } })
    
  } catch (error) {
    console.error('[API] Generation error:', error.message)
    console.error(error.response?.data)
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data?.error?.message || 'Unknown error occurred'
    })
  }
})

app.listen(PORT, () => console.log(`[SERVER] Running on http://localhost:${PORT}`))

// Initialize
loadCookies().catch((err) => console.error('[ERROR]', err.message))
