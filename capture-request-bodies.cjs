const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const SHARE_URL = 'https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6'

async function main() {
  console.log('[1] Launching Chrome...')
  const browser = await chromium.launchPersistentContext(
    'C:\\Users\\ASUS\\OneDrive\\Documents\\Default Project\\.chrome-profile',
    { channel: 'chrome', headless: false }
  )
  const page = await browser.newPage()

  // Capture request bodies for batchexecute
  const requestCaptures = []
  page.on('request', (req) => {
    const url = req.url()
    if (/batchexecute/i.test(url) && req.method() === 'POST') {
      const postData = req.postData()
      requestCaptures.push({
        url: url.substring(0, 150),
        method: req.method(),
        postData: postData ? postData.substring(0, 2000) : null,
        postDataLength: postData ? postData.length : 0,
        headers: {
          'content-type': req.headers()['content-type'] || '',
          'x-same-domain': req.headers()['x-same-domain'] || '',
          'authorization': req.headers()['authorization'] || 'none',
        },
        params: (() => {
          try {
            const u = new URL(url)
            return Object.fromEntries(u.searchParams.entries())
          } catch { return {} }
        })()
      })
      console.log(`[REQ] POST ${url.substring(0, 80)}...`)
      console.log(`  Body length: ${postData ? postData.length : 0}`)
      if (postData) {
        console.log(`  Body preview: ${postData.substring(0, 300)}`)
      }
    }
  })

  page.on('response', async (res) => {
    const url = res.url()
    if (/q4uTj/i.test(url)) {
      try {
        const body = await res.text()
        console.log(`[RES] q4uTj response: ${body.length} bytes`)
        // Save full response
        fs.writeFileSync('q4uTj-response.txt', body)
        console.log('  Saved to q4uTj-response.txt')
      } catch (e) {}
    }
  })

  console.log('[2] Navigating to share link...')
  await page.goto(SHARE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)

  // Find generator frame
  console.log('[3] Finding generator iframe...')
  let genFrame = null
  for (const frame of page.frames()) {
    const ta = await frame.locator('textarea:visible').count().catch(() => 0)
    const btn = await frame.getByRole('button', { name: 'Generate Gambar' }).count().catch(() => 0)
    if (ta > 0 && btn > 0) {
      genFrame = frame
      console.log('  [OK] Generator found')
      break
    }
  }
  if (!genFrame) {
    console.error('  [FAIL] No generator frame')
    await browser.close()
    process.exit(1)
  }

  // Generate
  console.log('[4] Generating text-to-image...')
  await genFrame.locator('textarea:visible').first().fill('A beautiful mountain landscape at sunset')
  await genFrame.getByRole('button', { name: 'Generate Gambar' }).click()
  console.log('  Prompt sent, waiting...')

  // Wait for response
  await page.waitForTimeout(120000)

  // Save all captured requests
  console.log(`\n[5] Saving ${requestCaptures.length} request captures...`)
  fs.writeFileSync('request-captures.json', JSON.stringify(requestCaptures, null, 2))

  // Save cookies
  const cookies = await browser.cookies()
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  fs.writeFileSync('cookie-header.txt', cookieHeader)
  fs.writeFileSync('gemini-cookies.json', JSON.stringify({
    metadata: { captureTime: new Date().toISOString(), total: cookies.length },
    cookies: cookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite
    }))
  }, null, 2))

  console.log(`  Saved ${requestCaptures.length} requests to request-captures.json`)
  console.log(`  Saved ${cookies.length} cookies to gemini-cookies.json`)
  console.log(`  Saved cookie header to cookie-header.txt`)

  // Print key findings
  console.log('\n=== KEY REQUEST CAPTURES ===')
  requestCaptures.forEach((r, i) => {
    console.log(`\n${i + 1}. ${r.method} ${r.params.rpcids || 'N/A'}`)
    console.log(`   URL: ${r.url.substring(0, 80)}...`)
    console.log(`   Body length: ${r.postDataLength}`)
    if (r.postData) {
      console.log(`   Body: ${r.postData.substring(0, 500)}`)
    }
    console.log(`   Params: rpcids=${r.params.rpcids}, bl=${r.params.bl}, f.sid=${r.params['f.sid']}`)
  })

  await browser.close()
  console.log('\n[DONE]')
}

main().catch((err) => {
  console.error('[FATAL]', err.message)
  process.exit(1)
})
