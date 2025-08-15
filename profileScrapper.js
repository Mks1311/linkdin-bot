require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const { setTimeout } = require('timers/promises');
const path = require('path');

const INPUT_FILE = './connections.json';
const OUTPUT_FILE = './scraped_profiles.json';
const PROFILES_PER_SESSION = 30;
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

// Function to test scraping a single profile
async function testSingleProfile(profileUrl) {
  console.log(`🧪 Testing single profile scraping: ${profileUrl}\n`);
  
  // Check if profile already exists in scraped data
  const existingProfiles = loadJSON(OUTPUT_FILE);
  const existingProfile = existingProfiles.find(p => p.url === profileUrl);
  
  if (existingProfile) {
    console.log(`⚠️ This profile was already scraped:`);
    console.log(`👤 Name: ${existingProfile.name}`);
    console.log(`📝 Headline: ${existingProfile.headline}`);
    console.log(`💼 Experience entries: ${existingProfile.experience.length}`);
    console.log('----------------------\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('Do you want to re-scrape this profile? (y/N): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('⏭️ Skipping re-scraping');
      return;
    }
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

  try {
    console.log('🔐 Logging into LinkedIn...');
    await loginLinkedIn(page);
    
    console.log('⏳ Waiting 30 seconds for potential CAPTCHA/2FA...');
    await setTimeout(30000);

    console.log('🔍 Scraping profile...');
    const scrapedProfile = await scrapeProfile(page, profileUrl);

    if (scrapedProfile) {
      console.log('\n✅ SCRAPING SUCCESSFUL!');
      console.log('----------------------');
      console.log(`👤 Name: ${scrapedProfile.name}`);
      console.log(`📝 Headline: ${scrapedProfile.headline}`);
      console.log(`💼 Experience entries: ${scrapedProfile.experience.length}`);
      
      if (scrapedProfile.experience.length > 0) {
        console.log(`📋 Experience details:`);
        scrapedProfile.experience.forEach((exp, index) => {
          console.log(`   ${index + 1}. ${exp}`);
        });
      }
      console.log('----------------------\n');

      // Ask if user wants to save the result
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const saveAnswer = await new Promise(resolve => {
        rl.question('Do you want to save this scraped profile? (y/N): ', resolve);
      });
      rl.close();
      
      if (saveAnswer.toLowerCase() === 'y' || saveAnswer.toLowerCase() === 'yes') {
        let profiles = loadJSON(OUTPUT_FILE);
        
        // Remove existing entry if re-scraping
        profiles = profiles.filter(p => p.url !== profileUrl);
        
        // Add the new/updated profile
        profiles.push(scrapedProfile);
        saveJSON(OUTPUT_FILE, profiles);
        
        console.log(`💾 Profile saved to ${OUTPUT_FILE}`);
        console.log(`📊 Total profiles in file: ${profiles.length}`);
      } else {
        console.log(`⏭️ Profile not saved`);
      }
    } else {
      console.log('\n❌ SCRAPING FAILED');
      console.log('Could not extract profile data. Please check if:');
      console.log('- The URL is accessible');
      console.log('- You are properly logged in');
      console.log('- The profile is not private/restricted');
    }

  } catch (error) {
    console.error(`❌ Error during scraping:`, error.message);
  } finally {
    await browser.close();
    console.log('🔒 Browser closed');
  }
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
  await setTimeout(30000); // Pause for CAPTCHA / 2FA

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

// Check command line arguments to determine which function to run
const args = process.argv.slice(2);

if (args.length > 0) {
  if (args[0] === '--test' && args[1]) {
    // Test single profile: node scraper.js --test "profile_url"
    testSingleProfile(args[1]).catch(console.error);
  } else if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
📋 LinkedIn Scraper Usage:
  node profileScrapper.js                    - Scrape profiles from connections.json
  node profileScrapper.js --test <URL>       - Test scraping single profile by URL
  node profileScrapper.js --help            - Show this help message

📖 Examples:
  node profileScrapper.js --test "https://linkedin.com/in/johndoe"

⚠️  Requirements:
  - Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD in .env file
  - Have connections.json file for batch processing
    `);
  } else {
    console.log(`❌ Unknown argument: ${args[0]}`);
    console.log(`Use --help for usage information`);
  }
} else {
  // Default behavior: scrape all profiles
  main().catch(console.error);
}