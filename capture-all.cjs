const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const SHARE_URL = 'https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6'

async function main() {
  console.log('[1] Launching Chrome with login profile...')
  const browser = await chromium.launchPersistentContext(
    'C:\\Users\\ASUS\\OneDrive\\Documents\\Default Project\\.chrome-profile',
    { channel: 'chrome', headless: false }
  )
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })

  // Record ALL network requests
  const allRequests = []
  page.on('request', (req) => {
    const url = req.url()
    if (/gemini\.google\.com|googleapis/i.test(url)) {
      allRequests.push({
        method: req.method(),
        url,
        type: req.resourceType(),
        time: new Date().toISOString()
      })
    }
  })

  // Capture response bodies for generate endpoints
  const responseBodies = []
  page.on('response', async (res) => {
    const url = res.url()
    if (/StreamGenerate|batchexecute/i.test(url)) {
      try {
        const body = await res.text().catch(() => null)
        responseBodies.push({
          status: res.status(),
          url: url.substring(0, 120),
          contentType: res.headers()['content-type'] || '',
          bodyPreview: body ? body.substring(0, 500) : null,
          bodyLength: body ? body.length : 0
        })
      } catch (e) {}
    }
  })

  console.log('[2] Navigating to share link...')
  await page.goto(SHARE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)

  // --- INSPECT DOM ---
  console.log('\n[3] Inspecting DOM across all frames...')
  const domReport = []
  for (const frame of page.frames()) {
    const entry = { frameUrl: frame.url().substring(0, 80), elements: [] }
    try {
      entry.elements = await frame.locator('textarea, button, input, [role="textbox"], [contenteditable]').evaluateAll((els) =>
        els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          text: (el.textContent || '').trim().substring(0, 60),
          visible: !!(el.offsetWidth || el.offsetHeight)
        }))
      )
    } catch (e) {
      entry.error = e.message
    }
    if (entry.elements.length > 0) domReport.push(entry)
  }
  fs.writeFileSync('dom-selectors.json', JSON.stringify(domReport, null, 2))
  console.log('   Saved dom-selectors.json')
  domReport.forEach((f) => {
    console.log(`\n   Frame: ${f.frameUrl}`)
    f.elements.forEach((el, i) => {
      if (el.visible) {
        console.log(`   ${i + 1}. <${el.tag}> ${el.type} role="${el.role}" aria="${el.ariaLabel}" text="${el.text}"`)
      }
    })
  })

  // --- FIND GENERATOR FRAME ---
  console.log('\n[4] Finding generator iframe...')
  let genFrame = null
  for (const frame of page.frames()) {
    const ta = await frame.locator('textarea:visible').count().catch(() => 0)
    const btn = await frame.getByRole('button', { name: 'Generate Gambar' }).count().catch(() => 0)
    if (ta > 0 && btn > 0) {
      genFrame = frame
      console.log('   [OK] Generator frame found!')
      break
    }
  }
  if (!genFrame) {
    console.error('   [FAIL] Generator frame not found!')
    await browser.close()
    process.exit(1)
  }

  // --- TEXT TO IMAGE ---
  console.log('\n[5] TEXT-TO-IMAGE: Generating...')
  const previousImgs = await genFrame.locator('img').evaluateAll((imgs) => imgs.map((i) => i.src))

  await genFrame.locator('textarea:visible').first().fill('A majestic lion standing on a cliff at sunset, cinematic, highly detailed, 16:9')
  await genFrame.getByRole('button', { name: 'Generate Gambar' }).click()
  console.log('   Prompt sent. Waiting for result...')

  // Wait for new image
  let textResultPath = null
  const startTime = Date.now()
  while (Date.now() - startTime < 180000) {
    const imgs = genFrame.locator('img:visible')
    const count = await imgs.count()
    for (let i = count - 1; i >= 0; i--) {
      const img = imgs.nth(i)
      const info = await img.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight, src: el.src })).catch(() => null)
      if (info && info.w >= 128 && info.h >= 128 && !previousImgs.includes(info.src)) {
        const buf = await img.screenshot({ type: 'png' })
        textResultPath = path.join(__dirname, 'text-to-image-result.png')
        fs.writeFileSync(textResultPath, buf)
        console.log(`   [OK] Text-to-image saved! (${info.w}x${info.h})`)
        break
      }
    }
    if (textResultPath) break
    await page.waitForTimeout(2000)
  }
  if (!textResultPath) {
    // Fallback: screenshot whole page
    await page.screenshot({ path: 'text-to-image-result.png', fullPage: true })
    textResultPath = 'text-to-image-result.png'
    console.log('   [FALLBACK] Screenshot saved')
  }

  // --- IMAGE TO IMAGE ---
  console.log('\n[6] IMAGE-TO-IMAGE: Uploading result image...')
  const fileInput = genFrame.locator('input[type="file"]')
  const fileCount = await fileInput.count()

  if (fileCount > 0 && textResultPath) {
    await fileInput.first().setInputFiles(textResultPath)
    console.log('   Image uploaded. Waiting...')
    await page.waitForTimeout(3000)

    // Fill transformation prompt
    await genFrame.locator('textarea:visible').first().fill('Transform this image into a watercolor painting style, soft colors, artistic')
    await genFrame.getByRole('button', { name: 'Generate Gambar' }).click()
    console.log('   Transform prompt sent. Waiting for result...')

    // Wait for new image
    const beforeImgToImg = await genFrame.locator('img').evaluateAll((imgs) => imgs.map((i) => i.src))
    let imgResultPath = null
    const startTime2 = Date.now()
    while (Date.now() - startTime2 < 180000) {
      const imgs = genFrame.locator('img:visible')
      const count = await imgs.count()
      for (let i = count - 1; i >= 0; i--) {
        const img = imgs.nth(i)
        const info = await img.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight, src: el.src })).catch(() => null)
        if (info && info.w >= 128 && info.h >= 128 && !beforeImgToImg.includes(info.src)) {
          const buf = await img.screenshot({ type: 'png' })
          imgResultPath = path.join(__dirname, 'image-to-image-result.png')
          fs.writeFileSync(imgResultPath, buf)
          console.log(`   [OK] Image-to-image saved! (${info.w}x${info.h})`)
          break
        }
      }
      if (imgResultPath) break
      await page.waitForTimeout(2000)
    }
    if (!imgResultPath) {
      await page.screenshot({ path: 'image-to-image-result.png', fullPage: true })
      console.log('   [FALLBACK] Screenshot saved')
    }
  } else {
    console.log('   [SKIP] No file input found in frame - image-to-image not available')
  }

  // --- SAVE ENDPOINTS ---
  console.log('\n[7] Saving captured endpoints...')
  await page.waitForTimeout(3000)

  // Deduplicate endpoints
  const uniqueEndpoints = []
  const seen = new Set()
  for (const req of allRequests) {
    const base = req.url.split('?')[0]
    const key = `${req.method} ${base}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueEndpoints.push({
        method: req.method,
        baseUrl: base,
        fullUrl: req.url,
        type: req.type,
        params: (() => {
          try {
            const u = new URL(req.url)
            return Object.fromEntries(u.searchParams.entries())
          } catch { return {} }
        })()
      })
    }
  }

  const endpointOutput = {
    metadata: {
      captureTime: new Date().toISOString(),
      totalRequests: allRequests.length,
      uniqueEndpoints: uniqueEndpoints.length,
      shareUrl: SHARE_URL
    },
    endpoints: uniqueEndpoints.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl)),
    responseBodies: responseBodies
  }

  fs.writeFileSync('gemini-endpoints-full.json', JSON.stringify(endpointOutput, null, 2))
  fs.writeFileSync('gemini-endpoints.txt', uniqueEndpoints.map((e, i) => `${i + 1}. ${e.method} ${e.baseUrl}\n   Type: ${e.type}\n   Params: ${JSON.stringify(e.params)}\n`).join('\n'))
  fs.writeFileSync('gemini-response-bodies.json', JSON.stringify(responseBodies, null, 2))

  // --- SAVE COOKIES ---
  console.log('\n[8] Saving fresh cookies...')
  const cookies = await browser.cookies()
  const cookieOutput = {
    metadata: { captureTime: new Date().toISOString(), total: cookies.length },
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite
    }))
  }
  fs.writeFileSync('gemini-cookies.json', JSON.stringify(cookieOutput, null, 2))

  console.log(`\n=== SUMMARY ===`)
  console.log(`Total requests captured: ${allRequests.length}`)
  console.log(`Unique endpoints: ${uniqueEndpoints.length}`)
  console.log(`Response bodies captured: ${responseBodies.length}`)
  console.log(`Cookies saved: ${cookies.length}`)
  console.log(`\nFiles saved:`)
  console.log(`  - dom-selectors.json`)
  console.log(`  - gemini-endpoints-full.json`)
  console.log(`  - gemini-endpoints.txt`)
  console.log(`  - gemini-response-bodies.json`)
  console.log(`  - gemini-cookies.json`)
  console.log(`  - text-to-image-result.png`)
  console.log(`  - image-to-image-result.png`)

  console.log(`\n--- TOP ENDPOINTS ---`)
  uniqueEndpoints.filter((e) => /StreamGenerate|batchexecute|generate/i.test(e.baseUrl)).forEach((e, i) => {
    console.log(`${i + 1}. ${e.method} ${e.baseUrl.substring(0, 70)}`)
    if (e.params.rpcids) console.log(`   rpcids: ${e.params.rpcids}`)
    if (e.params.bl) console.log(`   bl: ${e.params.bl}`)
    if (e.params['f.sid']) console.log(`   f.sid: ${e.params['f.sid']}`)
  })

  await browser.close()
  console.log('\n[DONE]')
}

main().catch((err) => {
  console.error('[FATAL]', err.message)
  process.exit(1)
})
