// connectionScrapper.js
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { setTimeout } = require('timers/promises');

(async () => {
  // 1) Launch with a little slowMo and a real‐looking UA
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 50,                      // slow down operations by 50ms each
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  await page.setViewport({ width: 1280, height: 800 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/115.0.0.0 Safari/537.36'
  );

  // 2) Login
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#username');
  await page.type('#username', process.env.LINKEDIN_EMAIL, { delay: 100 });
  await page.type('#password', process.env.LINKEDIN_PASSWORD, { delay: 100 });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded' })
  ]);

  // 3) Go to Connections
  await page.goto(
    'https://www.linkedin.com/mynetwork/invite-connect/connections/',
    { waitUntil: 'domcontentloaded' }
  );
  const listSel = 'div[componentkey="ConnectionsPage_ConnectionsList"]';
  await page.waitForSelector(listSel);

  // 4) Scroll + “Load more” until we see no growth for a few tries
  let prevCount = 0, stagnant = 0, loops = 0;
  while (loops < 500 && stagnant < 5) {
    loops++;

    // a) Bring last card into view
    await page.evaluate(sel => {
      const c = document.querySelector(sel);
      const cards = c.querySelectorAll('a[href*="/in/"]');
      if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'end' });
    }, listSel);

    // b) Random small pause so LinkedIn has time to load
    await setTimeout(Math.random() * 2000 + 2000);

    // c) Click “Load more” if there
    const loadMore = await page.$(
      `${listSel} button[aria-label*="Load more"], ` +
      `${listSel} button[aria-label*="See more"]`
    );
    if (loadMore) {
      await loadMore.click();
      await setTimeout(Math.random() * 2000 + 2000);
    }

    // d) Count links now
    const currCount = await page.evaluate(sel => {
      return document.querySelectorAll(`${sel} a[href*="/in/"]`).length;
    }, listSel);

    if (currCount > prevCount) {
      prevCount = currCount;
      stagnant = 0;
      console.log(`→ loaded ${currCount} connections…`);
    } else {
      stagnant++;
      console.log(`→ no growth (stagnant #${stagnant})`);
    }
  }

  // 5) Extract & dedupe
  const profileUrls = await page.evaluate(sel => {
    return Array.from(new Set(
      Array.from(
        document.querySelectorAll(`${sel} a[href*="/in/"]`)
      ).map(a => a.href.split('?')[0])
    ));
  }, listSel);

  // 6) Save
  const outPath = path.resolve(__dirname, 'connections.json');
  fs.writeFileSync(outPath, JSON.stringify(profileUrls, null, 2), 'utf-8');
  console.log(`✅ Saved ${profileUrls.length} URLs to ${outPath}`);

  await browser.close();
})();
