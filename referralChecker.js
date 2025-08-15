require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
const RESUME_LINK = process.env.RESUME_LINK;

// Define blacklisted companies
const blacklistedCompanies = [
    'whatbytes',
    'gunmade',
];

const referralFilePath = path.join(__dirname, 'profiles_inf.json');

// Initialize the referral file if it doesn't exist
if (!fs.existsSync(referralFilePath)) {
    fs.writeFileSync(referralFilePath, JSON.stringify([]));
}

const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

// Load JSON file
let profiles = JSON.parse(fs.readFileSync('scraped_profiles.json', 'utf-8'));

let processedProfiles = JSON.parse(fs.readFileSync('profiles_inf.json', 'utf-8'));

function isBlacklisted(profile) {
    const combinedText = (
        profile.headline + ' ' + profile.experience.join(' ')
    ).toLowerCase();

    return blacklistedCompanies.some(company =>
        combinedText.includes(company.toLowerCase())
    );
}

async function askGemini(profile, retries = 3, delay = 2000) {
    const experienceText = Array.isArray(profile.experience)
        ? profile.experience.join("\n")
        : "No experience listed.";

    const prompt = `
My name is Manish, and I am currently working as a Software Developer at a remote US-based startup called GunMade. I am actively exploring new opportunities and looking to get referrals at other companies.

Based on the following LinkedIn profile information, please determine whether this person would be a suitable candidate for me to request a referral from. Respond with true if:
- The person has at least 1 year of experience,
- OR is a recruiter,
- OR holds a position such as founder or co-founder.

If suitable, generate a short, personalized message that I can send to them. The message must be complete and not require any manual editing, as it will be sent via automation. Also, include my resume link in the message: https://bit.ly/4fpoxd5

Return the result in the following exact JSON format:
{
  "referal": true/false,
  "message": "..."
}

Profile:
Name: ${profile.name}
Headline: ${profile.headline}
Experience:
${experienceText}
`;

    const requestData = {
        contents: [{ parts: [{ text: prompt }] }]
    };

    try {
        const response = await axios.post(geminiEndpoint, requestData);
        const text = response.data.candidates[0].content.parts[0].text;
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        const jsonStr = text.slice(jsonStart, jsonEnd + 1);
        return JSON.parse(jsonStr);
    } catch (error) {
        const status = error.response?.status;
        
        // Handle rate limiting (429) and service unavailable (503)
        if ((status === 429 || status === 503) && retries > 0) {
            console.warn(`⚠️ Gemini ${status} for ${profile.name}, retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise((res) => setTimeout(res, delay));
            return askGemini(profile, retries - 1, delay * 2); // exponential backoff
        }
        
        // Handle quota exceeded (400 with specific message)
        if (status === 400 && error.response?.data?.error?.message?.includes('quota')) {
            console.warn(`⚠️ Quota exceeded for ${profile.name}, retrying in ${delay}ms... (${retries} retries left)`);
            if (retries > 0) {
                await new Promise((res) => setTimeout(res, delay));
                return askGemini(profile, retries - 1, delay * 2);
            }
        }
        
        console.error(`❌ Error with ${profile.name}:`, error.response?.data || error.message);
        return { referal: false, message: "" };
    }
}

function saveProfileResult(profile, result) {
    const profileData = {
        url: profile.url,
        name: profile.name,
        eligible: result.referal,
        message: result.message,
        processedAt: new Date().toISOString(),
        reason: result.referal ? 'eligible' : 'not_suitable'
    };

    // Read current data, append new profile, and write back
    const currentData = JSON.parse(fs.readFileSync(referralFilePath));
    currentData.push(profileData);
    fs.writeFileSync(referralFilePath, JSON.stringify(currentData, null, 2));
    
    return profileData;
}

async function processProfiles() {
    let processed = processedProfiles.length;
    let eligible = 0;
    let skipped = 0;

    for (const profile of profiles) {
        // Check if profile is already processed
        if (processedProfiles.some(p => p.url === profile.url)) {
            console.log(`🔍 ${profile.name} (${profile.url}) - Already processed`);
            skipped++;
            continue;
        }

        console.log(`👤 Processing: ${profile.name} (${profile.url})`);
        
        // Check for blacklisted companies
        if (isBlacklisted(profile)) {
            console.log(`⛔ Skipping ${profile.name} - Blacklisted company found`);
            
            // Save as processed with blacklisted reason
            const profileData = {
                url: profile.url,
                name: profile.name,
                eligible: false,
                message: "",
                processedAt: new Date().toISOString(),
                reason: 'blacklisted'
            };
            
            const currentData = JSON.parse(fs.readFileSync(referralFilePath));
            currentData.push(profileData);
            fs.writeFileSync(referralFilePath, JSON.stringify(currentData, null, 2));
            
            processed++;
            continue;
        }

        // Check for no experience
        if (profile.experience.length === 0) {
            console.log(`❌ Skipping ${profile.name} - No experience listed`);
            
            // Save as processed with no experience reason
            const profileData = {
                url: profile.url,
                name: profile.name,
                eligible: false,
                message: "",
                processedAt: new Date().toISOString(),
                reason: 'no_experience'
            };
            
            const currentData = JSON.parse(fs.readFileSync(referralFilePath));
            currentData.push(profileData);
            fs.writeFileSync(referralFilePath, JSON.stringify(currentData, null, 2));
            
            processed++;
            continue;
        }

        // Process with Gemini API
        const result = await askGemini(profile);
        const savedProfile = saveProfileResult(profile, result);

        if (result.referal) {
            console.log(`✅ Referral Approved`);
            console.log(`📨 Message:\n${result.message}`);
            eligible++;
        } else {
            console.log(`❌ Not suitable for referral`);
        }
        
        processed++;
        console.log(`📊 Progress: ${processed} processed, ${eligible} eligible, ${skipped} already done`);
        console.log(` Left ${profiles.length - processed}`)
        console.log('----------------------\n');

        // Add delay between requests to avoid rate limiting
        await new Promise((r) => setTimeout(r, 1500));
    }

    console.log(`\n🎉 Processing Complete!`);
    console.log(`📈 Summary:`);
    console.log(`   - Total processed: ${processed}`);
    console.log(`   - Eligible for referral: ${eligible}`);
    console.log(`   - Already processed (skipped): ${skipped}`);
    console.log(`   - Total profiles: ${profiles.length}`); 
}

processProfiles().catch(console.error);