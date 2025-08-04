require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const { setTimeout } = require('timers/promises');
const path = require('path');

const INPUT_FILE = './connections.json';
const OUTPUT_FILE = './scraped_profiles.json';
const PROFILES_PER_SESSION = 50;
const MIN_DELAY = 5000;
const MAX_DELAY = 10000;

async function scrapeProfile(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Scroll slightly
    await page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
    await setTimeout(1000);

    await page.waitForSelector('h1', { timeout: 15000 });

    const data = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const hd = document.querySelector('.text-body-medium.break-words');
      const anchors = Array.from(document.querySelectorAll('a[data-field="experience_company_logo"]'));

      const spanTextGroups = anchors.map(anchor => {
        const spans = anchor.querySelectorAll('span[aria-hidden="true"]');
        const spanTexts = Array.from(spans)
          .map(span => span.textContent.trim())
          .filter(text => text);
        return spanTexts.join(', ');
      }).filter(group => group.length > 0);

      return {
        name: h1?.innerText.trim() || '',
        headline: hd?.innerText.trim() || '',
        spanTextGroups
      };
    });

    console.log('✅ Scraped:', data.name || url);

    return {
      url,
      name: data.name,
      headline: data.headline,
      experience: data.spanTextGroups
    };
  } catch (err) {
    console.error(`❌ Error scraping ${url}:`, err.message);
    return null;
  }
}

function loadJSON(pathStr) {
  try {
    return JSON.parse(fs.readFileSync(pathStr, 'utf-8'));
  } catch {
    return [];
  }
}

function saveJSON(pathStr, data) {
  fs.writeFileSync(pathStr, JSON.stringify(data, null, 2));
}

function getRemainingUrls(allUrls, scrapedUrls) {
  const scrapedSet = new Set(scrapedUrls.map(item => item.url));
  return allUrls.filter(url => !scrapedSet.has(url));
}

async function loginLinkedIn(page) {
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.type('#username', process.env.LINKEDIN_EMAIL, { delay: 100 });
  await page.type('#password', process.env.LINKEDIN_PASSWORD, { delay: 100 });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded' })
  ]);
  console.log('🔐 Logged in successfully');
}

function getRandomDelay(min = MIN_DELAY, max = MAX_DELAY) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const allUrls = loadJSON(INPUT_FILE);
  const existingProfiles = loadJSON(OUTPUT_FILE);
  const urlsToScrape = getRemainingUrls(allUrls, existingProfiles).slice(0, PROFILES_PER_SESSION);

  if (urlsToScrape.length === 0) {
    console.log('🎉 All profiles scraped!');
    return;
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });

  const page = await browser.newPage();

  // Set a realistic user-agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );

  await loginLinkedIn(page);
  await setTimeout(10000); // Pause for CAPTCHA / 2FA

  const results = [...existingProfiles];

  for (const url of urlsToScrape) {
    console.log('🔍 Scraping:', url);
    const profile = await scrapeProfile(page, url);
    if (profile) {
      results.push(profile);
      saveJSON(OUTPUT_FILE, results); // Save after every successful scrape
    }
    const delay = getRandomDelay();
    console.log(`⏳ Waiting for ${Math.floor(delay / 1000)}s...`);
    await setTimeout(delay);
  }

  console.log(`✅ Session done. Scraped ${urlsToScrape.length} new profiles.`);
  await browser.close();
}

main().catch(console.error);
