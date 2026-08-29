const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

;(async () => {
  console.log('[1] Opening browser to app...')
  const browser = await chromium.launch({ channel: 'chrome', headless: false })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  console.log('[2] App loaded')

  // Wait for textarea
  const promptBox = page.locator('textarea').first()
  await promptBox.waitFor({ timeout: 15000 })
  console.log('[3] Prompt box found')

  // Type prompt
  await promptBox.fill('A majestic lion standing on a cliff at golden sunset, cinematic, highly detailed')
  console.log('[4] Prompt entered')

  // Click generate button
  const genBtn = page.locator('button.generate')
  await genBtn.waitFor({ timeout: 10000 })
  await genBtn.click()
  console.log('[5] Generate clicked. Waiting for result (can take up to 3 minutes)...')

  // Wait for result image to appear in .result-card
  try {
    await page.locator('.result-card img').waitFor({ state: 'visible', timeout: 240000 })
    console.log('[6] SUCCESS! Image displayed in UI!')

    // Screenshot the result
    const resultCard = page.locator('.result-card').first()
    await resultCard.screenshot({ path: path.join(__dirname, 'app-generation-result.png') })
    console.log('[7] Result screenshot saved: app-generation-result.png')

    // Also save the image itself
    const imgUrl = await page.locator('.result-card img').first().getAttribute('src')
    if (imgUrl && imgUrl.startsWith('data:image')) {
      const base64Data = imgUrl.replace(/^data:image\/\w+;base64,/, '')
      fs.writeFileSync(path.join(__dirname, 'app-generated-image.jpg'), Buffer.from(base64Data, 'base64'))
      console.log(`[8] Image saved: app-generated-image.jpg (${Math.round(base64Data.length * 0.75 / 1024)} KB)`)
    }
  } catch (e) {
    console.log('[FAIL] Timeout or error waiting for image:', e.message.split('\n')[0])
    await page.screenshot({ path: path.join(__dirname, 'app-error-state.png'), fullPage: true })
    console.log('Error screenshot saved: app-error-state.png')
  }

  // Keep browser open briefly for inspection
  await page.waitForTimeout(5000)
  await browser.close()
  console.log('\n[DONE]')
})().catch(err => {
  console.error('[FATAL]', err.message)
  process.exit(1)
})
