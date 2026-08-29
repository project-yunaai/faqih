const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

(async () => {
  console.log('[1] Launching Chrome with login profile via Playwright...');

  const userDataDir = 'C:\\Users\\ASUS\\OneDrive\\Documents\\Default Project\\.chrome-profile';

  const browser = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  // Record all network requests
  const endpointsMap = new Map();

  page.on('request', (request) => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();

    if (/gemini|googleapis/i.test(url)) {
      const key = `${method} ${url}`;
      if (!endpointsMap.has(key)) {
        endpointsMap.set(key, { method, url, types: [], sources: [] });
      }
      const item = endpointsMap.get(key);
      if (!item.types.includes(resourceType)) item.types.push(resourceType);
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (/gemini|googleapis/i.test(url) && /generate|stream|batchexecute/.test(url)) {
      try {
        const headers = response.headers();
        console.log(`[RES] ${response.status()} ${url}`);
        console.log(`   Headers: Content-Type=${headers['content-type'] || 'N/A'}`);
      } catch (e) {}
    }
  });

  console.log('\n[2] Navigating to Gemini share page...');
  await page.goto(
    'https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6',
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );

  console.log('\n[3] Waiting for page load...\n');
  console.log('Press Enter when ready to capture generation...\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise((resolve) => {
    rl.question('Ready? Type yes and press Enter: ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim() === 'yes');
    });
  });

  console.log('\n[4] Looking for generator frame...');
  let generatorFrame = null;

  for (const frame of page.frames()) {
    try {
      const textareaExists = await frame.locator('textarea').count().catch(() => 0);
      const buttonExists = await frame.getByRole('button', { name: 'Generate Gambar' }).count().catch(() => 0);

      if (textareaExists > 0 && buttonExists > 0) {
        generatorFrame = frame;
        console.log('[✓] Found generator frame');
        break;
      }
    } catch (e) {}
  }

  if (!generatorFrame) {
    console.error('[ERROR] Generator frame not found!');
    await browser.close();
    process.exit(1);
  }

  console.log('\n[5] Entering test prompt and generating...');

  await generatorFrame.locator('textarea').first().fill('Beautiful sunset over mountains, highly detailed');
  console.log('  -> Prompt entered');

  await generatorFrame.getByRole('button', { name: 'Generate Gambar' }).click();
  console.log('  -> Generate clicked\n');

  console.log('[6] Waiting for image generation...\n');

  try {
    await page.waitForFunction(() => {
      return [...document.images].filter(img => img.naturalWidth >= 128).length > 0;
    }, { timeout: 180000 });
    console.log('\n[✓] Image generated successfully!');
  } catch (error) {
    console.log('\n⚠ Timeout waiting for image...');
  }

  await new Promise(r => setTimeout(r, 5000));

  console.log('\n[7] Saving captured endpoints...');

  const endpoints = Array.from(endpointsMap.values()).sort((a, b) => a.url.localeCompare(b.url));

  const outputData = {
    metadata: {
      captureTime: new Date().toISOString(),
      totalEndpoints: endpoints.length,
      targetUrl: 'https://gemini.google.com/share/b1493cbc4a17?skid=289a934e-5432-4462-b43d-dcd739f84ed6'
    },
    endpoints: endpoints.map(e => ({
      method: e.method,
      url: e.url,
      resourceTypes: e.types
    }))
  };

  fs.writeFileSync(
    path.join(__dirname, 'gemini-endpoints-full.json'),
    JSON.stringify(outputData, null, 2),
    'utf8'
  );

  const textLines = [
    '# Gemini Canvas Endpoints Captured',
    `Capture Time: ${new Date().toLocaleString()}`,
    `Total Unique Endpoints: ${endpoints.length}`,
    '',
    ...endpoints.map((e, idx) => `${idx + 1}. ${e.method.padEnd(7)} ${e.url}`)
  ];

  fs.writeFileSync(
    path.join(__dirname, 'gemini-endpoints.txt'),
    textLines.join('\n'),
    'utf8'
  );

  const apiEndpoints = endpoints.filter(e => /StreamGenerate|batchexecute|generativelanguage/i.test(e.url));

  const apiOnlyData = {
    metadata: outputData.metadata,
    totalApiEndpoints: apiEndpoints.length,
    endpoints: apiEndpoints.map(e => ({
      method: e.method,
      url: e.url,
      category: e.types.includes('xhr') ? 'AJAX' : 'Other'
    }))
  };

  fs.writeFileSync(
    path.join(__dirname, 'gemini-api-endpoints.json'),
    JSON.stringify(apiOnlyData, null, 2),
    'utf8'
  );

  console.log(`\n✅ Saved ${outputData.totalEndpoints} endpoints`);
  console.log(`Files created:`);
  console.log(`   - gemini-endpoints-full.json`);
  console.log(`   - gemini-endpoints.txt`);
  console.log(`   - gemini-api-endpoints.json (${apiOnlyData.endpoints.length} API endpoints)`);

  console.log('\n--- TOP API ENDPOINTS ---');
  apiEndpoints.slice(0, 10).forEach((e, i) => {
    console.log(`${i + 1}. ${e.method} ${e.url.split('?')[0].substring(0, 60)}...`);
  });

  await browser.close();
  console.log('\n✅ Done!');
})().catch(error => {
  console.error('[ERROR]', error.message);
  process.exit(1);
});
