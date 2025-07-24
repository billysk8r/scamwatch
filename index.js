const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
require('dotenv').config(); // Load environment variables from .env file
const tmi = require('tmi.js'); // Require tmi.js

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const HOST = '127.0.0.1';

// Get Twitch credentials from environment variables
// Ensure you have a .env file in the same directory as this index.js file
// with TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET defined.
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

// Module-level variables to store the access token and its expiry time
let twitchAccessToken = null;
let twitchTokenExpiry = 0; // Stores the Unix timestamp (in milliseconds) when the token expires

// TMI.js client instances (will be initialized when needed)
const numClients = 256; // Number of TMI.js clients to use
const tmiClients = new Array(numClients).fill(null); // Array to store multiple TMI.js client instances

const usersList = []; // Array to store filtered users
const ignoreUsers = ["nightbot", "streamelements", "streamlabs"];
let scanned = 0;
let browsed = 0;
let loopCount = 0; // Added counter for logging frequency

// Hardcoded filter values as per request
const MAX_VIEWER_FILTER = 10;
const MIN_VIEWER_FILTER = 0;

// Serve static files from the 'public' directory
app.use(express.static('public'));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});
// Redirect /discord to your Discord invite
app.get('/discord', (req, res) => {
    res.redirect('https://discord.gg/mTJGzJR7ZX');
});

// Redirect /twitch to your twitch stream
app.get('/twitch', (req, res) => {
    res.redirect('https://www.twitch.tv/electricallongboard');
});

// Serve scamwatch.html
app.get('/scamwatch', (req, res) => {
    res.sendFile(path.join(__dirname, 'scamwatch.html'));
});

/**
 * Deterministically determines the client array index for a given Twitch username.
 * @param {string} username - The Twitch username.
 * @param {BigInt} modulus - The modulus (e.g., numClients) for the operation.
 * @returns {BigInt} The calculated index.
 */
function twitchUsernameToBigIntegerMod(username, modulus) {
    let bigIntVal = 0n;
    let base = 37n;

    // Iterate through the username string in reverse
    for (let i = username.length - 1; i >= 0; i--) {
        const char = username[i];
        const digit = char.charCodeAt(0);

        if (digit < 58) {
            // Number (0-9)
            bigIntVal += BigInt(digit - 48) * base ** BigInt(username.length - 1 - i);
        } else if (char === '_') {
            // Underscore
            bigIntVal += 36n * base ** BigInt(username.length - 1 - i);
        } else {
            // Letter (a-z)
            bigIntVal += BigInt(digit - 87) * base ** BigInt(username.length - 1 - i);
        }
    }

    // Perform modulo operation
    return bigIntVal % modulus;
}

/**
 * Fetches or refreshes the Twitch app access token if it's expired or not available.
 * @returns {Promise<string|null>} The valid access token or null if an error occurred.
 */
async function getTwitchAccessToken() {
    // Check for missing credentials first
    if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
        console.error('Error: TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET not found in environment variables. Please check your .env file.');
        return null;
    }
    // Check if the current token is still valid
    // We use a small buffer (e.g., 60 seconds) to refresh before actual expiry
    if (twitchAccessToken && (Date.now() < twitchTokenExpiry - (60 * 1000))) {
        return twitchAccessToken;
    }
    try {
        console.log('Twitch access token expired or not available. Fetching a new one...');
        const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: TWITCH_CLIENT_ID,
                client_secret: TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials',
            }).toString(),
        });
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            throw new Error(`Failed to get Twitch token: ${tokenResponse.status} ${tokenResponse.statusText} - ${errorText}`);
        }
        const tokenData = await tokenResponse.json();
        twitchAccessToken = tokenData.access_token;
        // Calculate expiry time: current time (ms) + expires_in (seconds * 1000 ms/s)
        twitchTokenExpiry = Date.now() + (tokenData.expires_in * 1000);
        console.log('Successfully obtained new Twitch access token. Expires in:', tokenData.expires_in, 'seconds.');
        return twitchAccessToken;
    } catch (error) {
        console.error('Error getting Twitch access token:', error.message);
        twitchAccessToken = null; // Clear token on failure
        twitchTokenExpiry = 0;
        return null;
    }
}
/**
 * Browses Twitch streams, applies filters, and populates usersList.
 * This function mimics the browsePages logic from the client-side script.
 */
async function fetchTwitchStreams() {
    let cursor = "";
    usersList.length = 0; // Clear the list for a new scan
    scanned = 0;
    browsed = 0;
    loopCount = 0; // Reset loopCount here for each new call to fetchTwitchStreams

    // Initialize and connect TMI.js clients if not already initialized
    for (let i = 0; i < numClients; i++) {
        if (!tmiClients[i]) {
            tmiClients[i] = new tmi.Client({
                options: {
                    skipMembership: true,
                    skipUpdatingEmotesets: true,
                },
                // Anonymous connection as requested
                // No 'identity' part needed for anonymous connection
            });
            // Connect the TMI client
            try {
                await tmiClients[i].connect();
                console.log(`TMI.js client ${i} connected anonymously.`);
            } catch (e) {
                console.error(`Error connecting TMI.js client ${i}:`, e);
                // Continue to try connecting other clients even if one fails
            }

            // TMI.js chat listener to emit to 'scamwatch' room
            tmiClients[i].on("chat", (channel, userstate, message, self) => {
                if (self || ignoreUsers.includes(userstate.username)) return;
                // Emit chat message to all clients in the 'scamwatch' room
                io.to('scamwatch').emit('chat', {
                    channel: channel.replace('#', ''), // Remove '#' from channel name
                    username: userstate.username,
                    message: message
                });
            });
        }
    }


    while (true) {
        try {
            let accessToken = await getTwitchAccessToken(); // Ensure we have a valid token
            if (!accessToken) {
                console.error('No valid access token available to fetch Twitch streams. Exiting stream scan.');
                break; // Exit the loop if no token is available
            }
            // First API call to get streams
            const streamsResponse = await fetch(
                `https://api.twitch.tv/helix/streams?stream_type=live&first=100${cursor.length === 0 ? "" : "&after=" + cursor
                }`,
                {
                    headers: {
                        Authorization: "Bearer " + accessToken, // Use the app access token
                        "Client-ID": TWITCH_CLIENT_ID, // Use our client ID
                    },
                }
            );
            const body = await streamsResponse.json();
            if (!body?.data || body.data.length === 0) {
                console.log('No more stream data or API returned empty data. Breaking loop.');
                break;
            }
            // Check if we've hit the minimum viewer filter (using hardcoded MIN_VIEWER_FILTER)
            if (
                MIN_VIEWER_FILTER !== 0 &&
                Number(body.data[0].viewer_count) < MIN_VIEWER_FILTER
            ) {
                console.log(`Minimum viewer count (${MIN_VIEWER_FILTER}) reached on current page. Breaking loop.`);
                break;
            }
            browsed += body.data.length;
            let loginString = "";
            for (const s of body.data) {
                // Apply max viewer filter and English-only filter (hardcoded to true for simplicity as per script.js's engOnlyCheckBox.checked behavior)
                if (
                    (MAX_VIEWER_FILTER === 0 ||
                        Number(s.viewer_count) <= MAX_VIEWER_FILTER) &&
                    (s.language === "en") // Assuming hardcoded English only based on original script's checkbox
                ) {
                    loginString += "login=" + s.user_login + "&";
                }
            }
            if (loginString !== "") {
                // Second API call to get user details
                accessToken = await getTwitchAccessToken();
                const usersResponse = await fetch(
                    "https://api.twitch.tv/helix/users?" + loginString,
                    {
                        headers: {
                            Authorization: "Bearer " + accessToken, // Use the app access token
                            "Client-ID": TWITCH_CLIENT_ID, // Use our client ID
                        },
                    }
                );
                const userData = await usersResponse.json();

                if (userData?.data) {
                    for (const u of userData.data) {
                        const age = Date.now() - new Date(u.created_at).getTime();
                        // Filter by broadcaster_type, age (30 days), and uniqueness
                        if (
                        //    u.broadcaster_type === "" &&
                            age <= 300 * 24 * 60 * 60 * 1000 &&
                            !usersList.some((usr) => usr.login === u.login)
                        ) {
                            usersList.push(u);
                        }
                    }
                    scanned += userData.data.length;
                }
            }
            // Print usersList.length at the end of the while true body
            loopCount++;
            if (loopCount % 100 === 0) { // Print every 100 iterations
                console.log(`Filtered Total Users: ${usersList.length} (Scanned: ${scanned}, Browsed: ${browsed})`);
            }
            // Update cursor for next iteration
            if (!body.pagination?.cursor) {
                console.log('No more pagination cursor. All streams processed. Breaking loop.');
                break;
            }
            cursor = body.pagination.cursor;
        } catch (error) {
            console.error("Error fetching or processing data:", error);
            break; // Break the loop on error to prevent infinite loops
        }
    }
    // After the loop, process the collected users (e.g., join channels via TMI.js)
    await processUsers(usersList); // Pass usersList to processUsers
}
/**
 * Processes the collected user list (e.g., joins/parts TMI.js channels).
 * This is adapted from the original script.js's processUsers function.
 * @param {Array} currentUsersList - The list of users to process.
 */
async function processUsers(currentUsersList) {
    if (tmiClients.every(client => !client)) {
        console.warn('No TMI.js clients initialized. Cannot process users.');
        return;
    }

    // Sort the list (no truncation as MAX_CHANNELS limit is removed)
    currentUsersList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // Use the full list for processing
    const channelsToProcess = currentUsersList;
    console.log(`Processing ${channelsToProcess.length} channels...`);

    // Collect all current channels from all clients
    let allCurrentChannels = [];
    for (let i = 0; i < numClients; i++) {
        if (tmiClients[i]) {
            allCurrentChannels = allCurrentChannels.concat(
                tmiClients[i].getChannels().map((channel) => channel.replace("#", ""))
            );
        }
    }

    // Part channels not in the current list to process
    for (const channel of allCurrentChannels) {
        if (
            !channelsToProcess.some((user) => user.login === channel)
        ) {
            const clientArrayIndex = Number(twitchUsernameToBigIntegerMod(channel, BigInt(numClients)));
            const clientToUse = tmiClients[clientArrayIndex];
            if (clientToUse) {
                try {
                    await clientToUse.part(channel);
                    // console.log("PARTED", channel, "from client", clientArrayIndex);
                    await new Promise((resolve) => setTimeout(resolve, 25)); // Delay to avoid rate limits
                } catch (e) {
                    console.error("Error parting channel", channel, "from client", clientArrayIndex, e);
                }
            }
        }
    }
    console.log("CHANNELS LENGTH AFTER PARTS", tmiClients.reduce((acc, client) => acc + (client ? client.getChannels().length : 0), 0));

    // Collect all updated channels from all clients after parting
    let allUpdatedChannels = [];
    for (let i = 0; i < numClients; i++) {
        if (tmiClients[i]) {
            allUpdatedChannels = allUpdatedChannels.concat(
                tmiClients[i].getChannels().map((channel) => channel.replace("#", ""))
            );
        }
    }

    // Join new channels from the list to process
    for (const user of channelsToProcess) {
        if (!allUpdatedChannels.includes(user.login)) {
            const clientArrayIndex = Number(twitchUsernameToBigIntegerMod(user.login, BigInt(numClients)));
            const clientToUse = tmiClients[clientArrayIndex];
            if (clientToUse) {
                try {
                    await clientToUse.join(user.login);
                    // console.log("JOINED", user.login, "on client", clientArrayIndex);
                    await new Promise((resolve) => setTimeout(resolve, 25)); // Delay to avoid rate limits
                } catch (e) {
                    console.error("Error joining channel", user.login, "on client", clientArrayIndex, e);
                }
            }
        }
    }
    console.log("CHANNELS LENGTH AFTER JOINS", tmiClients.reduce((acc, client) => acc + (client ? client.getChannels().length : 0), 0));
}
// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('a user connected');

    socket.on('join-scamwatch', () => {
        socket.join('scamwatch');
        console.log('user joined scamwatch room');
    });

    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
});
server.listen(PORT, HOST, async () => {
    console.log(`listening on ${HOST}:${PORT}`);
    // Forever loop call to fetch streams when the server starts.
    // This will now initiate the Browse and TMI.js joining.
    while (true) {
        await fetchTwitchStreams();
    }
});
