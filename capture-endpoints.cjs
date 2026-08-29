const { chromium } = require("playwright")
const fs = require("fs")
const path = require("path")

(async () => {
  console.log("[1] Launching Chrome with login profile via Playwright...")

  const userDataDir = 'C:\\Users\\ASUS\\OneDrive\\Documents\\Default Project\\.chrome-profile'

  const browser = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false
  })

  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })

  // Record all network requests
  const endpointsMap = new Map()
  
  page.on('request', (request) => {
    const url = request.url()
    const method = request.method()
    const resourceType = request.resourceType()
    
    if (/gemini|googleapis/i.test(url)) {
      const key = `${method} ${url}`
      if (!endpointsMap.has(key)) {
        endpointsMap.set(key, { method, url, types: [], sources: [] })
      }
      const item = endpointsMap.get(key)
      if (!item.types.includes(resourceType)) item.types.push(resourceType)
    }
  })

  page.on('response', async (response) => {
    const url = response.url()
    if (/gemini|googleapis/i.test(url) && /generate|stream|batchexecute/.test(url)) {
      try {
        const headers = response.headers()
        console.log(`[RES] ${response.status()} ${url}`)
        console.log(`   Headers: Content-Type=${headers['content-type'] || 'N/A'}, Cache-Control=${headers['cache-control'] || 'N/A'}`)
        
        // Try to get response body for analysis
        const buffer = await response.buffer().catch(() => null)
        if (buffer && buffer.length > 0) {
          console.log(`   Body size: ${buffer.length} bytes`)
        }
      } catch (e) {}
    }
  })

  console.log("\n[2] Navigating to Gemini share page...")
  await page.goto(
    "https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6",
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  )

  // Wait for page to load and user might need to interact
  console.log("\n[3] Waiting for page load... (You may need to click 'Coba Gemini Canvas' or type in input)")
  console.log("    Press Enter in terminal when ready to capture generation...\n")

  const readline = require("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  await new Promise((resolve) => {
    rl.question("Ready to start capturing? Type 'yes' and press Enter: ", (answer) => {
      rl.close()
      resolve(answer.toLowerCase().trim() === 'yes')
    })
  })

  // Find iframe generator
  console.log("\n[4] Looking for generator frame...")
  let generatorFrame = null
  
  for (const frame of page.frames()) {
    try {
      const textareaExists = await frame.locator('textarea').count().catch(() => 0)
      const buttonExists = await frame.getByRole('button', { name: 'Generate Gambar' }).count().catch(() => 0)
      
      if (textareaExists > 0 && buttonExists > 0) {
        generatorFrame = frame
        console.log(`[✓] Found generator frame at: ${frame.url().substring(0, 80)}...`)
        break
      }
    } catch (e) {
      // Continue trying other frames
    }
  }

  if (!generatorFrame) {
    console.error("[ERROR] Generator frame not found!")
    await browser.close()
    process.exit(1)
  }

  console.log("\n[5] Entering test prompt and generating...")
  
  // Fill textarea and click generate
  await generatorFrame.locator('textarea').first().fill(
    "Beautiful sunset over mountains, highly detailed, cinematic lighting"
  )
  
  console.log("    → Prompt entered")
  
  await generatorFrame.getByRole('button', { name: 'Generate Gambar' }).click()
  console.log("    → Generate clicked\n")

  // Wait for response
  console.log("[6] Waiting for image generation (this may take 1-2 minutes)...")
  console.log("    Watch the terminal for network activity below:\n")

  // Monitor for images appearing
  try {
    await page.waitForFunction(() => {
      return [...document.images].filter(img => img.naturalWidth >= 128).length > 0
    }, { timeout: 180000 })
    
    console.log("\n[✓] Image generated successfully!")
  } catch (error) {
    console.log("\n⚠ Timeout waiting for image, but continuing to save captured endpoints...")
  }

  // Stop recording after some time
  await new Promise(r => setTimeout(r, 5000))

  console.log("\n[7] Saving captured endpoints to files...")

  const endpoints = Array.from(endpointsMap.values()).sort((a, b) => a.url.localeCompare(b.url))

  // Save full data with headers and timing
  const outputData = {
    metadata: {
      captureTime: new Date().toISOString(),
      totalEndpoints: endpoints.length,
      userAgent: "Playwright Capture Tool",
      profilePath: userDataDir,
      targetUrl: "https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6"
    },
    endpoints: endpoints.map(e => ({
      method: e.method,
      url: e.url,
      resourceTypes: e.types,
      hitCount: 1
    }))
  }

  // Pretty JSON file
  fs.writeFileSync(
    path.join(__dirname, 'gemini-endpoints-full.json'),
    JSON.stringify(outputData, null, 2),
    'utf8'
  )

  // Simple text file with just endpoints
  const textLines = [
    '# Gemini Canvas Endpoints Captured',
    `Capture Time: ${new Date().toLocaleString()}`,
    `Total Unique Endpoints: ${endpoints.length}`,
    '',
    '---',
    ''
  ]

  endpoints.forEach((e, idx) => {
    textLines.push(`${idx + 1}. ${e.method.padEnd(7)} ${e.url}`)
    textLines.push(`   Types: ${e.types.join(', ')}`)
    textLines.push('')
  })

  fs.writeFileSync(
    path.join(__dirname, 'gemini-endpoints.txt'),
    textLines.join('\n'),
    'utf8'
  )

  // Extract key API endpoints for direct calling
  const apiEndpoints = endpoints.filter(e => 
    /StreamGenerate|batchexecute|generativelanguage|upload|image/i.test(e.url)
  )

  const apiOnlyData = {
    metadata: outputData.metadata,
    totalApiEndpoints: apiEndpoints.length,
    endpoints: apiEndpoints.map(e => ({
      method: e.method,
      url: e.url,
      category: e.types.includes('xhr') ? 'AJAX' : e.types.includes('fetch') ? 'Fetch' : 'Other'
    }))
  }

  fs.writeFileSync(
    path.join(__dirname, 'gemini-api-endpoints.json'),
    JSON.stringify(apiOnlyData, null, 2),
    'utf8'
  )

  console.log(`\n✅ Saved ${outputData.totalEndpoints} endpoints to:`)
  console.log(`   - gemini-endpoints-full.json (${outputData.endpoints.length} entries)`)
  console.log(`   - gemini-endpoints.txt (human readable)`)
  console.log(`   - gemini-api-endpoints.json (${apiOnlyData.endpoints.length} API endpoints)`)

  console.log("\n--- TOP API ENDPOINTS ---")
  apiEndpoints.slice(0, 10).forEach((e, i) => {
    console.log(`${i + 1}. ${e.method} ${e.url.split('?')[0].substring(0, 70)}...`)
  })

  // Save cookies while we have session
  console.log("\n[8] Saving current session cookies...")
  const context = browser.contexts()[0]
  const cookies = await context.cookies()
  
  const cookieOutput = {
    metadata: {
      ...outputData.metadata,
      captureMethod: "Playwright context cookies"
    },
    totalCookies: cookies.length,
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value.substring(0, 30) + "...",
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite
    }))
  }

  fs.writeFileSync(
    path.join(__dirname, 'gemini-cookies-playwright.json'),
    JSON.stringify(cookieOutput, null, 2),
    'utf8'
  )

  console.log(`[✓] Saved ${cookies.length} cookies to gemini-cookies-playwright.json`)

  await browser.close()
  console.log("\n✅ Done! You can now use these endpoints in your backend.")
  console.log("\nTo use: Copy gemini-api-endpoints.json to your backend and modify it to use these real API calls instead of playright automation.")

})().catch(error => {
  console.error('[ERROR]', error.message)
  process.exit(1)
})
