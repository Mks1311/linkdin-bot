# 🔗 LinkedIn Scraper — Connection & Profile Automation

This project allows you to **automatically extract your LinkedIn connections** and then **scrape profile details** (name, headline, and job experience) from each one in a safe and resumable manner using Puppeteer.

---

## 📁 Project Structure

| File                   | Description                                      |
|------------------------|--------------------------------------------------|
| `.env`                 | Stores your LinkedIn login credentials           |
| `connectionScrapper.js`| Fetches your LinkedIn connections                | 
| `profileScraper.js`    | Scrapes profile data in chunks                   |
| `connections.json`    | Connection URLs saved                            |
| `scraped_profiles.json`| Final scraped output of profile details          |

---

## 🔧 Setup Instructions

### 1. Install Dependencies

```bash
npm install i
```

### 2. Create .env File

```bash
LINKEDIN_EMAIL=your_email@example.com
LINKEDIN_PASSWORD=your_password
```

### 3. Scrape LinkedIn Connection URLs

This will scroll through your connections page and save profile links into JSON file

```bash
node connectionScrapper.js
```

### 4. Scrape Profile Details

Use the profile scraper to scrape information from the connection URLs. It will:

1. Load connections.json

2. Scrape up to 50 profiles per run (customizable)

3. Resume where it left off (avoids duplicates)

4. Save results in scraped_profiles.json

```bash
node profileScraper.js
```


### 📌 Legal Disclaimer

This project is intended for educational and personal use only.

Scraping LinkedIn is against their Terms of Service. Use responsibly and at your own risk.

