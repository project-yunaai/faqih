const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

;(async () => {
  console.log('[1] Connecting to Chrome on port 9222...')
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  const context = browser.contexts()[0]
  const page = await context.newPage()

  // Capture POST body for batchexecute
  const capturedRequests = []

  page.on('request', (req) => {
    if (req.url().includes('batchexecute') && req.method() === 'POST') {
      const postData = req.postData()
      capturedRequests.push({
        url: req.url(),
        method: req.method(),
        postData: postData ? postData.substring(0, 2000) : null,
        headers: req.headers()
      })
      console.log(`[REQ] POST ${req.url().substring(0, 80)}...`)
      if (postData) {
        console.log(`  Body: ${postData.substring(0, 300)}...`)
      }
    }
  })

  page.on('response', async (res) => {
    if (res.url().includes('batchexecute') && res.url().includes('q4uTj')) {
      const body = await res.text().catch(() => null)
      if (body && body.includes('inlineData')) {
        console.log(`[RES] q4uTj response: ${body.length} bytes - IMAGE FOUND!`)
        // Save the full response
        fs.writeFileSync('q4uTj-response.txt', body)
      }
    }
  })

  console.log('[2] Navigating to share page...')
  await page.goto('https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })
  await page.waitForTimeout(6000)

  // Find generator frame
  console.log('[3] Finding generator iframe...')
  let genFrame = null
  for (const frame of page.frames()) {
    const ta = await frame.locator('textarea:visible').count().catch(() => 0)
    const btn = await frame.getByRole('button', { name: 'Generate Gambar' }).count().catch(() => 0)
    if (ta > 0 && btn > 0) {
      genFrame = frame
      console.log('  [OK] Generator frame found')
      break
    }
  }

  if (!genFrame) {
    console.error('  [FAIL] Generator frame not found')
    process.exit(1)
  }

  console.log('\n[4] Generating image to capture request body...')
  await genFrame.locator('textarea:visible').first().fill('A beautiful sunset over mountains, cinematic, highly detailed')
  await genFrame.getByRole('button', { name: 'Generate Gambar' }).click()

  console.log('[5] Waiting for generation...')
  await page.waitForTimeout(90000)

  // Save all captured requests
  console.log(`\n[6] Captured ${capturedRequests.length} POST requests`)
  fs.writeFileSync('captured-request-bodies.json', JSON.stringify(capturedRequests, null, 2))

  // Also capture fresh cookies
  console.log('[7] Capturing fresh cookies...')
  const cookies = await context.cookies(['https://gemini.google.com', 'https://www.google.com'])
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  fs.writeFileSync('gemini-cookies.json', JSON.stringify({
    metadata: { captureTime: new Date().toISOString(), total: cookies.length },
    cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }))
  }, null, 2))
  fs.writeFileSync('gemini-cookie-header.txt', cookieHeader)

  console.log(`  Saved ${cookies.length} cookies`)
  console.log('\n=== CAPTURED REQUEST BODIES ===')
  capturedRequests.forEach((r, i) => {
    console.log(`\n${i + 1}. ${r.method} ${r.url.substring(0, 100)}`)
    if (r.postData) console.log(`   Body: ${r.postData.substring(0, 500)}`)
  })

  await page.close()
  await browser.close()
  console.log('\n[DONE]')
})().catch(err => {
  console.error('[ERROR]', err.message)
  process.exit(1)
})
