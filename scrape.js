require('dotenv').config();
const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const moment = require('moment');

// Use environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const BASE_URL = process.env.BASE_URL;
const EVENTS_TO_PROCESS = parseInt(process.env.EVENTS_TO_PROCESS, 10);
const HEADLESS = process.env.HEADLESS === 'true';
const DELAY_BETWEEN_SPEAKERS = parseInt(process.env.DELAY_BETWEEN_SPEAKERS, 10);
const DELAY_BETWEEN_EVENTS = parseInt(process.env.DELAY_BETWEEN_EVENTS, 10);

let uniqueSpeakers = [];

// Define Mongoose schemas
const speakerSchema = new mongoose.Schema({
    id: String,
    name: String,
    photoUrl: String,
    biography: String,
    socialLinks: {
        facebook: String,
        twitter: String,
        instagram: String,
        website: String
    },
    sessions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }] // Updated to use ObjectId references
});

const eventSchema = new mongoose.Schema({
    sessionId: String,
    sessionTitle: String,
    sessionDescription: String,
    sessionLocation: String,
    sessionDate: Date,
    sessionStartTime: Date,
    sessionEndTime: Date,
    speakers: [{
        id: String,
        role: String
    }]
});

// Create Mongoose models
const Speaker = mongoose.model('Speaker', speakerSchema);
const Event = mongoose.model('Event', eventSchema);

// Updated function to insert data using Mongoose
async function insertWithMongoose(data) {
    try {
        await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

        // Insert events first
        const insertedEvents = await Event.insertMany(data.events);
        console.log(`${insertedEvents.length} events inserted into MongoDB`);

        // Create a map of sessionId to ObjectId
        const sessionIdToObjectId = new Map(insertedEvents.map(event => [event.sessionId, event._id]));

        // Update speakers with ObjectId references
        const updatedSpeakers = data.speakers.map(speaker => ({
            ...speaker,
            sessions: speaker.sessions.map(sessionId => sessionIdToObjectId.get(sessionId)).filter(id => id)
        }));

        // Insert updated speakers
        const insertedSpeakers = await Speaker.insertMany(updatedSpeakers);
        console.log(`${insertedSpeakers.length} speakers inserted into MongoDB`);

    } finally {
        await mongoose.disconnect();
    }
}

// Function to wipe out existing data
async function wipeDatabase() {
    try {
        await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

        await Speaker.deleteMany({});
        await Event.deleteMany({});

        console.log('All existing data has been wiped from the database.');
    } catch (error) {
        console.error('Error wiping database:', error);
    }
}

// Function to parse and format date and time
function parseDateTime(dateString, timeString) {
    // Extract date from the format "Friday 4 Oct 2024 (1 hour)"
    const datePart = dateString.split('(')[0].trim();

    // Extract time from the format "2:00 PM - 3:00 PM | 1 hour"
    const [timePart] = timeString.split('|');
    const [startTime, endTime] = timePart.split('-').map(t => t.trim());

    // Combine date and time
    const startDateTime = moment(`${datePart} ${startTime}`, "dddd D MMM YYYY h:mm A");
    const endDateTime = moment(`${datePart} ${endTime}`, "dddd D MMM YYYY h:mm A");

    return {
        date: startDateTime.startOf('day').toDate(),
        startTime: startDateTime.toDate(),
        endTime: endDateTime.toDate()
    };
}

// Update the addUniqueSpeaker function
async function addUniqueSpeaker(speaker) {
    console.log('Processing speaker:', speaker.name, 'URL:', speaker.url);

    const existingIndex = uniqueSpeakers.findIndex(s => s.id === speaker.id);

    if (existingIndex === -1) {
        // New speaker
        if (!speaker.url) {
            console.warn('No URL provided for new speaker:', speaker.name);
            uniqueSpeakers.push({...speaker, sessions: [speaker.sessionId]});
            return;
        }

        const speakerDetails = await scrapeSpeakerDetails(speaker.url);
        if (speakerDetails) {
            console.log('Speaker details fetched successfully for new speaker:', speaker.name);
            uniqueSpeakers.push({
                ...speaker,
                biography: speakerDetails.biography,
                socialLinks: speakerDetails.socialLinks,
                sessions: [speaker.sessionId, ...speakerDetails.sessions]
            });
        } else {
            console.warn('Failed to fetch details for new speaker:', speaker.name);
            uniqueSpeakers.push({...speaker, sessions: [speaker.sessionId]});
        }
    } else {
        // Existing speaker
        console.log('Speaker already exists:', speaker.name);

        if (!uniqueSpeakers[existingIndex].biography && speaker.url) {
            console.log('Updating existing speaker:', speaker.name);
            const speakerDetails = await scrapeSpeakerDetails(speaker.url);
            if (speakerDetails) {
                console.log('Speaker details fetched successfully for existing speaker:', speaker.name);
                uniqueSpeakers[existingIndex] = {
                    ...uniqueSpeakers[existingIndex],
                    biography: speakerDetails.biography,
                    socialLinks: speakerDetails.socialLinks,
                    sessions: [...new Set([...uniqueSpeakers[existingIndex].sessions, speaker.sessionId, ...speakerDetails.sessions])]
                };
            } else {
                console.warn('Failed to fetch details for existing speaker:', speaker.name);
            }
        } else {
            console.log('Existing speaker already has details:', speaker.name);
        }

        // Ensure this speaker's session is included
        if (speaker.sessionId && !uniqueSpeakers[existingIndex].sessions.includes(speaker.sessionId)) {
            uniqueSpeakers[existingIndex].sessions.push(speaker.sessionId);
            console.log(`Added session ${speaker.sessionId} to speaker ${speaker.name}`);
        }
    }
}

(async () => {
    // Wipe existing data
    await wipeDatabase();

    const events = await scrapeCalendarEvents();

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < events.length; i++) {
        try {
            console.log(`Processing event ${i + 1}/${events.length}: ${events[i].sessionId}`);
            const details = await scrapeSessionDetails(events[i].sessionId);
            if (details) {
                const parsedDateTime = parseDateTime(details.sessionDate, events[i].sessionTime);
                events[i] = {
                    ...events[i],
                    sessionDate: parsedDateTime.date,
                    sessionStartTime: parsedDateTime.startTime,
                    sessionEndTime: parsedDateTime.endTime,
                    speakers: details.speakers.map(({id, role}) => ({id, role}))
                };
                delete events[i].sessionTime;

                // Process speakers
                console.log(`Processing ${details.speakers.length} speakers for event ${events[i].sessionId}`);
                for (const speaker of details.speakers) {
                    await addUniqueSpeaker({...speaker, sessionId: events[i].sessionId});
                    await delay(DELAY_BETWEEN_SPEAKERS); // Add a 2-second delay between speaker requests
                }
            }
            await delay(DELAY_BETWEEN_EVENTS);
        } catch (error) {
            console.error(`Failed to process session details: ${events[i].sessionId}`);
            console.error(error);
        }
    }

    console.log('Events to process:', JSON.stringify(events, null, 2));
    console.log("Unique Speakers:", JSON.stringify(uniqueSpeakers, null, 2));

    // Insert data using Mongoose
    await insertWithMongoose({
        events: events,
        speakers: uniqueSpeakers
    });
})();

async function scrapeSessionDetails(sessionId) {
    const browser = await puppeteer.launch({headless: HEADLESS});
    const page = await browser.newPage();

    try {
        await page.goto(`${BASE_URL}/schedule/${sessionId}/`, {waitUntil: 'networkidle2'});

        // Wait for the speakers section to load
        await page.waitForSelector('.d-flex.flex-wrap.justify-content-center.my-5', {timeout: 5000});

        const sessionData = await page.evaluate(() => {
            const getText = (selector, defaultValue = 'Not found') => {
                const element = document.querySelector(selector);
                return element ? element.innerText.trim() : defaultValue;
            };

            const extractSpeakerId = (url) => {
                const matches = url.match(/\/people\/(\d+)/);
                return matches ? matches[1] : null;
            };

            const sessionSpeakers = Array.from(document.querySelectorAll('.d-flex.flex-wrap.justify-content-center.my-5 > div'))
                .map(speaker => {
                    const speakerUrl = speaker.querySelector('a')?.href || '';
                    console.log('Raw speaker URL:', speakerUrl);
                    const fullSpeakerUrl = speakerUrl.startsWith('http') ? speakerUrl : `https://sites.grenadine.co${speakerUrl}`;
                    console.log('Full speaker URL:', fullSpeakerUrl);

                    const speakerId = extractSpeakerId(speakerUrl);
                    const speakerName = speaker.querySelector('p.text-dark.text-small.mb-0')?.innerText.trim() || 'No name found';
                    const photoUrl = speaker.querySelector('img')?.src || '';
                    const role = speaker.querySelector('.badge')?.innerText.trim() || 'No role found';

                    return {
                        id: speakerId,
                        name: speakerName,
                        photoUrl: photoUrl,
                        role: role,
                        url: fullSpeakerUrl
                    };
                });

            return {
                sessionDate: getText('.time-muted').split(',')[1]?.trim() || 'Date not found',
                speakers: sessionSpeakers
            };
        });

        // Process unique speakers outside of page.evaluate
        sessionData.speakers.forEach(speaker => {
            addUniqueSpeaker({
                id: speaker.id,
                name: speaker.name,
                photoUrl: speaker.photoUrl
            });
        });

        console.log(`Scraped details for session ${sessionId}:`, sessionData);
        return sessionData;
    } catch (error) {
        console.error(`Error scraping details for session ${sessionId}:`, error);
        return null;
    } finally {
        await browser.close();
    }
}

async function scrapeSpeakerDetails(speakerUrl) {
    if (!speakerUrl || typeof speakerUrl !== 'string') {
        console.error('Invalid speaker URL:', speakerUrl);
        return null;
    }

    const browser = await puppeteer.launch({headless: HEADLESS});
    const page = await browser.newPage();

    try {
        console.log('Navigating to:', speakerUrl);
        await page.goto(speakerUrl, {waitUntil: 'networkidle2', timeout: 30000});

        // Log the page content for debugging
        const pageContent = await page.content();
        console.log('Page content length:', pageContent.length);
        // console.log('Page content:', pageContent); // Uncomment this line if you want to see the full page content

        const speakerData = await page.evaluate(() => {
            const biography = document.querySelector('.person-published-bio')?.innerText.trim() || '';
            console.log('Biography found:', biography.substring(0, 50) + '...');

            const socialLinks = {
                facebook: document.querySelector('.social-media-container a.facebook:not(.admin)')?.href || '',
                twitter: document.querySelector('.social-media-container a.twitter:not(.admin)')?.href || '',
                instagram: document.querySelector('.social-media-container a.instagram:not(.admin)')?.href || '',
                website: document.querySelector('.social-media-container a.website:not(.admin)')?.href || ''
            };
            console.log('Social links found:', JSON.stringify(socialLinks));

            const sessions = Array.from(document.querySelectorAll('.timeline-item .card-title'))
                .map(link => {
                    const url = link.getAttribute('href');
                    return url ? url.split('/')[8] : null;
                })
                .filter(id => id !== null);
            console.log('Sessions found:', sessions);

            return {
                biography,
                socialLinks,
                sessions
            };
        });

        console.log('Scraped speaker data:', speakerData);
        return speakerData;
    } catch (error) {
        console.error(`Error scraping details for speaker (${speakerUrl}):`, error);
        return null;
    } finally {
        await browser.close();
    }
}

async function scrapeCalendarEvents() {
    const browser = await puppeteer.launch({ headless: HEADLESS });
    const page = await browser.newPage();

    try {
        await page.goto(`${BASE_URL}/schedule?date=all`, { waitUntil: 'networkidle2' });

        const eventDetails = await page.evaluate(() => {
            const eventElements = document.querySelectorAll('[data-session-id]');
            const events = new Map(); // Use a Map to prevent duplicates

            Array.from(eventElements).forEach(event => {
                const sessionId = event.getAttribute('data-session-id');
                if (!events.has(sessionId)) {
                    events.set(sessionId, {
                        sessionId,
                        sessionTitle: event.querySelector('.card-title')?.innerText.trim() || 'Title not found',
                        sessionDescription: event.querySelector('.card-description-text')?.innerText.trim() || 'Description not found',
                        sessionTime: event.querySelector('.time-muted')?.innerText.trim() || 'Time not found',
                        sessionLocation: event.querySelector('.text-small a')?.innerText.trim() || 'Location not found'
                    });
                }
            });

            return Array.from(events.values());
        });

        console.log(`Scraped ${eventDetails.length} calendar events`);
        return eventDetails;
    } catch (error) {
        console.error('Error scraping calendar events:', error);
        return [];
    } finally {
        await browser.close();
    }
}