const TelegramBot = require('node-telegram-bot-api');
const { HTUAssistant, ensureDirForFile } = require('./utils');
const config = require('./config');
const cron = require('node-cron');
const http = require('http');
const fs = require('fs');


// Google Gemini AI integration is now handled inside the /ai command handler for better error handling.

// Initialize bot (support dry-run / test mode by disabling polling)
const polling = !(process.env.NO_POLL === '1' || process.env.DEBUG_NO_POLL === '1');
const bot = new TelegramBot(config.BOT_TOKEN, { polling });
if (!polling) console.log('⚠️ Bot polling disabled (NO_POLL=1 or DEBUG_NO_POLL=1) — running in dry mode');
const htuAssistant = new HTUAssistant();

// User sessions for better interaction
const userSessions = new Map();

// Helper: check or init session for a chat
function ensureSession(chatId) {
    const s = userSessions.get(chatId) || { timestamp: Date.now(), beginner: false };
    userSessions.set(chatId, s);
    return s;
}

// Helper: build simple inline keyboard for beginners or normal keyboard
function buildWelcomeInline(chatId) {
    const s = ensureSession(chatId);
    const beginnerLabel = s.beginner ? 'Turn off Beginner' : 'Beginner Help';
    return {
        inline_keyboard: [
            [{ text: '� Quick Search', callback_data: 'start' }],
            [{ text: '🏢 Departments', callback_data: 'departments' }, { text: '🎯 Clubs', callback_data: 'clubs' }],
            [{ text: beginnerLabel, callback_data: 'beginner_toggle' }, { text: '❓ Help', callback_data: 'help' }]
        ]
    };
}

// Search history for users (in-memory backed by file)
const searchHistory = new Map();

// Map for repeat-search short ids
const repeatSearchMap = new Map();
let repeatCounter = 0;

// Fun usage stats (in-memory backed by file)

let funStats = {
    coin: 0,
    dice: 0,
    eightball: 0,
    quiz: 0
};

// --- Persistence helpers (move these up so they're available early) ---
function loadJson(filePath, defaultValue) {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('Error loading json', filePath, e);
    }
    return defaultValue;
}

function saveJson(filePath, data) {
    try {
        ensureDirForFile(filePath);
        // Atomic write to avoid partial/corrupt files
        const tmp = `${filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, filePath);
    } catch (e) {
        console.error('Error saving json', filePath, e);
    }
}

// ...existing code...

// /ai command (AI integration removed)

function saveSearchHistoryToFile() {
    const obj = {};
    for (const [userId, arr] of searchHistory.entries()) obj[userId] = arr;
    saveJson(config.HISTORY_PATH, obj);
}

function loadSearchHistoryFromFile() {
    const raw = loadJson(config.HISTORY_PATH, {});
    Object.entries(raw).forEach(([uid, arr]) => {
        searchHistory.set(Number(uid), arr);
    });
}

function saveFunStats() {
    saveJson(config.STATS_PATH, funStats);
}

function loadFunStats() {
    const raw = loadJson(config.STATS_PATH, null);
    if (raw && typeof raw === 'object') funStats = Object.assign(funStats, raw);
}

console.log('🤖 Athar Bot is starting...');
console.log(`📊 Loaded ${htuAssistant.doctors.length} doctors from database`);
console.log(`🏢 Found ${htuAssistant.departments.length} departments`);
console.log(`🎯 Loaded ${htuAssistant.clubs.length} clubs and teams`);

// Load persisted data if any
ensureDirForFile(config.HISTORY_PATH);
ensureDirForFile(config.STATS_PATH);
loadSearchHistoryFromFile();
loadFunStats();
// Load user prefs
ensureDirForFile(config.USER_PREFS_PATH);
function loadUserPrefs() {
    const raw = loadJson(config.USER_PREFS_PATH, {});
    Object.entries(raw).forEach(([uid, prefs]) => {
        userSessions.set(Number(uid), Object.assign({ timestamp: Date.now() }, prefs));
    });
}

function saveUserPrefs() {
    const obj = {};
    for (const [uid, prefs] of userSessions.entries()) {
        // only persist small prefs (beginner) to avoid storing large session state
        obj[uid] = { beginner: prefs.beginner === true };
    }
    saveJson(config.USER_PREFS_PATH, obj);
}
loadUserPrefs();

// Ensure a prefs file exists on disk to simplify admin export and first-run behavior
try {
    if (!fs.existsSync(config.USER_PREFS_PATH)) {
        saveJson(config.USER_PREFS_PATH, {});
        console.log('Created default user prefs file at', config.USER_PREFS_PATH);
    }
} catch (e) {
    console.error('Error ensuring user prefs file exists:', e);
}

// Global error handler for unhandled errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log(`👋 New user started bot: ${user.first_name} (${user.id})`);
    
    const welcomeMessage = `👋 Hi ${user.first_name} — welcome to Athar Bot!

I'm here to help you find people, clubs, and rooms on campus.

How to start:
• Type a name (e.g. "Mohammad")
• Or type a room (e.g. "S-321")
• Or tap one of the buttons below.`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '🏢 Departments', callback_data: 'departments' },
                { text: '🎯 Clubs', callback_data: 'clubs' }
            ],
            [
                { text: '🔎 Quick Search', callback_data: 'start' },
                { text: '❓ Help', callback_data: 'help' }
            ],
            [
                { text: '📝 My Searches', callback_data: 'history' }
            ]
        ]
    };
    
    try {
        const s = ensureSession(chatId);
        const markup = s.beginner ? buildWelcomeInline(chatId) : keyboard;
        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: markup
        });
    } catch (error) {
        console.error('Error sending welcome message:', error);
        await bot.sendMessage(chatId, '🎉 Welcome to Athar Bot! Type a name or department to search.');
    }
});

// Toggle beginner mode command
bot.onText(/\/beginner/, async (msg) => {
    const chatId = msg.chat.id;
    const s = ensureSession(chatId);
    s.beginner = !s.beginner;
    userSessions.set(chatId, s);
    const reply = s.beginner ? '✅ Beginner Mode activated — big buttons and simple messages!' : '🔁 Beginner Mode turned off. Back to normal.';
    saveUserPrefs();
    await bot.sendMessage(chatId, reply, { reply_markup: buildWelcomeInline(chatId) });
});

// Show and toggle user prefs
bot.onText(/\/prefs/, async (msg) => {
    const chatId = msg.chat.id;
    const s = ensureSession(chatId);
    const text = `🔧 Your Preferences:\n\nBeginner mode: ${s.beginner ? 'On' : 'Off'}`;
    const kb = { inline_keyboard: [[{ text: s.beginner ? 'Turn off Beginner' : 'Turn on Beginner', callback_data: 'beginner_toggle' }]] };
    await bot.sendMessage(chatId, text, { reply_markup: kb });
});

// Admin export of prefs (sends file contents to admin chat)
bot.onText(/\/export_prefs/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!config.ADMIN_IDS || !config.ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(chatId, '❌ You are not authorized to run this command.');
        return;
    }
    try {
        if (!fs.existsSync(config.USER_PREFS_PATH)) {
            await bot.sendMessage(chatId, 'No prefs file found.');
            return;
        }
        await bot.sendDocument(chatId, config.USER_PREFS_PATH, {}, { caption: 'User prefs export' });
    } catch (e) {
        console.error('Error exporting prefs', e);
        await bot.sendMessage(chatId, `⚠️ Failed to export prefs: ${String(e)}`);
    }
});

// Handle /help command
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const s = ensureSession(chatId);
    if (s.beginner) {
        const simple = `👋 Hi! Quick guide:

1) Type a name or room (e.g. "Mohammad" or "S-321").
2) Tap a button to browse departments or clubs.
3) Tap a result for contact and office details.

Try typing a name now!`;
        const kb = { inline_keyboard: [[{ text: '� Start Search', callback_data: 'start' }], [{ text: '🏢 Departments', callback_data: 'departments' }, { text: '🎯 Clubs', callback_data: 'clubs' }]] };
        await bot.sendMessage(chatId, simple, { parse_mode: 'Markdown', reply_markup: kb });
        return;
    }

    const helpMessage = `❓ Need help? Here's how:

• Type a name to find a person (e.g. "Mohammad").
• Type a room number to find an office (e.g. "S-321").
• Tap 'Departments' or 'Clubs' to browse lists.

Commands: /start /help /beginner /prefs`;

    const keyboard = {
        inline_keyboard: [
            [ { text: '🏢 Departments', callback_data: 'departments' }, { text: '🎯 Clubs', callback_data: 'clubs' } ],
            [ { text: '🏠 Back to Start', callback_data: 'start' } ]
        ]
    };

    await bot.sendMessage(chatId, helpMessage, { 
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

// Handle /fun command
bot.onText(/\/fun/, async (msg) => {
    const chatId = msg.chat.id;
    const menu = `✨ **Fun Zone**

Pick something fun to try:`;
    const keyboard = {
        inline_keyboard: [
            [
                { text: '🪙 Flip a Coin', callback_data: 'fun_coin' },
                { text: '🎲 Roll Dice', callback_data: 'fun_dice' }
            ],
            [
                { text: '🎱 Ask 8-Ball', callback_data: 'fun_8ball_prompt' },
                { text: '🧠 Campus Quiz', callback_data: 'fun_quiz' }
            ],
            [
                { text: '📊 Fun Stats', callback_data: 'fun_stats' },
                { text: '🏠 Home', callback_data: 'start' }
            ]
        ]
    };
    await bot.sendMessage(chatId, menu, { parse_mode: 'Markdown', reply_markup: keyboard });
});

// Handle callback queries (inline keyboard buttons)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;
    
    // Answer the callback query to remove loading state with error handling
    try {
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        // Ignore callback query timeout errors - they're not critical
        if (!error.message.includes('query is too old') && !error.message.includes('query ID is invalid')) {
            console.error('Error answering callback query:', error.message);
        }
    }
    
    try {
        switch (data) {
            case 'fun_coin': {
                const res = htuAssistant.flipCoin();
                funStats.coin++;
                saveFunStats();
                await bot.editMessageText(res.message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[
                        { text: '🔁 Again', callback_data: 'fun_coin' },
                        { text: '✨ Fun Menu', callback_data: 'fun_menu' }
                    ]] }
                });
                break;
            }
            case 'fun_dice': {
                const res = htuAssistant.rollDice();
                funStats.dice++;
                saveFunStats();
                await bot.editMessageText(res.message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[
                        { text: '🔁 Again', callback_data: 'fun_dice' },
                        { text: '✨ Fun Menu', callback_data: 'fun_menu' }
                    ]] }
                });
                break;
            }
            case 'fun_8ball_prompt': {
                const prompt = `🎱 Send me your question, and I'll consult the 8-ball.

Type it now, or tap a suggestion:`;
                const suggestions = [
                    'Will I ace my next exam?',
                    'Is today a lucky day?',
                    'Should I join a new club?'
                ];
                const keyboard = { inline_keyboard: suggestions.map(q => ([{ text: q, callback_data: `fun_8ball_q_${encodeURIComponent(q)}` }]))
                    .concat([[{ text: '✨ Fun Menu', callback_data: 'fun_menu' }]]) };
                await bot.editMessageText(prompt, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
                break;
            }
            case 'fun_quiz': {
                const quiz = htuAssistant.generateQuizQuestion();
                // Store quiz in session for this chat
                const session = userSessions.get(chatId) || {};
                session.quiz = quiz;
                session.timestamp = Date.now();
                userSessions.set(chatId, session);

                const keyboard = { inline_keyboard: quiz.options.map((opt, idx) => ([{ text: opt, callback_data: `fun_quiz_answer_${idx}` }]))
                    .concat([[{ text: '✨ Fun Menu', callback_data: 'fun_menu' }]]) };
                funStats.quiz++;
                saveFunStats();
                await bot.editMessageText(`🧠 ${quiz.question}`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
                break;
            }
            case 'fun_stats': {
                const msg = `📊 **Fun Stats**

🪙 Coin flips: ${funStats.coin}
🎲 Dice rolls: ${funStats.dice}
🎱 8-ball asks: ${funStats.eightball}
🧠 Quizzes started: ${funStats.quiz}`;
                await bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '✨ Fun Menu', callback_data: 'fun_menu' }]] }
                });
                break;
            }
            case 'fun_menu': {
                const menu = `✨ **Fun Zone**\n\nPick something fun to try:`;
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '🪙 Flip a Coin', callback_data: 'fun_coin' },
                            { text: '🎲 Roll Dice', callback_data: 'fun_dice' }
                        ],
                        [
                            { text: '🎱 Ask 8-Ball', callback_data: 'fun_8ball_prompt' },
                            { text: '🧠 Campus Quiz', callback_data: 'fun_quiz' }
                        ],
                        [
                            { text: '📊 Fun Stats', callback_data: 'fun_stats' },
                            { text: '🏠 Home', callback_data: 'start' }
                        ]
                    ]
                };
                await bot.editMessageText(menu, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
                break;
            }
            // Random features removed by configuration - no-op for these callbacks
                
            case 'beginner_toggle': {
                const s = ensureSession(chatId);
                s.beginner = !s.beginner;
                userSessions.set(chatId, s);
                const text = s.beginner ? '✅ Beginner Mode activated — simplified UI.' : '🔁 Beginner Mode deactivated.';
                await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: buildWelcomeInline(chatId) });
                break;
            }
            case 'departments':
                const departments = htuAssistant.getDepartments();
                let deptMessage = `🏢 **HTU Departments**\n\n`;
                departments.forEach((dept, index) => {
                    deptMessage += `${index + 1}. 📚 ${dept}\n`;
                });
                deptMessage += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 **Tip:** Type any department name to find doctors!`;
                
                await bot.editMessageText(deptMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [ { text: '🏠 Back to Start', callback_data: 'start' } ]
                        ]
                    }
                });
                break;
                
            case 'clubs':
                const clubs = htuAssistant.clubs;
                let clubsMessage = `🎯 **HTU Clubs & Teams**\n\n`;
                
                const clubTypes = [...new Set(clubs.map(c => c['Club/ Volunteer team']))].sort();
                
                clubTypes.forEach((type, index) => {
                    const typeClubs = clubs.filter(c => c['Club/ Volunteer team'] === type);
                    clubsMessage += `${index + 1}. 🏷️ **${type}** (${typeClubs.length} clubs)\n`;
                    typeClubs.slice(0, 3).forEach(club => {
                        clubsMessage += `   • ${club['Name of it ']}\n`;
                    });
                    if (typeClubs.length > 3) {
                        clubsMessage += `   • ... and ${typeClubs.length - 3} more\n`;
                    }
                    clubsMessage += `\n`;
                });
                
                clubsMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 **Tip:** Type any club name to get details!`;
                
                await bot.editMessageText(clubsMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🏠 Back to Start', callback_data: 'start' }
                        ]]
                    }
                });
                break;
                
            case 'buildings':
                const buildingGuide = htuAssistant.getBuildingGuide();
                
                await bot.editMessageText(buildingGuide, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🏠 Back to Start', callback_data: 'start' }
                        ]]
                    }
                });
                break;
                
            case 'stats':
                const stats = htuAssistant.getStats();
                const statsMessage = `📊 **Athar Bot Statistics**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👨‍⚕️ **Doctors:** ${stats.totalDoctors} members
🏢 **Departments:** ${stats.departments} departments
🎯 **Clubs & Teams:** ${stats.totalClubs} organizations
🏷️ **Club Types:** ${stats.clubTypes} categories

📅 **Office Info:**
⏰ With Office Hours: ${stats.withOfficeHours}
🏢 With Office Info: ${stats.withOffice}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
                
                await bot.editMessageText(statsMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🏠 Back to Start', callback_data: 'start' }
                        ]]
                    }
                });
                break;
                
            case 'help':
                // Show help message (same as /help command)
                const helpMessage = `🤖 **Athar Bot - Your University Helper** 

👋 **How to Use:**
Just type what you're looking for! I'll understand what you mean.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

�️ **Natural Language Questions:**
Ask me questions in normal language and I'll understand!

**Examples:**
• "What are the office hours of Dr. Mohammad?"
• "Who is the dean of engineering?"
• "Where is the Computer Science department?"
• "How can I contact the admission office?"
• "Who is the registrar?"
• "What is Razan's email?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

�🔍 **Smart Search Examples:**
👨‍⚕️ **Find Doctors:** "Mohammad", "Computer Science", "S-321"
🎯 **Find Clubs:** "Entrepreneurship", "Volunteer team", "programming"
🏢 **Find Locations:** "S-321", "N-402", "Engineering Building"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ **Available Commands:**
/start - Welcome message with quick actions
/help - This helpful guide
/clubs - Browse all clubs and teams
/buildings - Campus building guide
/history - View your recent searches
/stats - Bot statistics and info

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ **Cool Features:**
🧠 Natural language understanding
🎯 Smart search with typo correction
🤔 Helpful suggestions when no results found
📧 Clickable emails and social links
🏢 Office hours and building information
📱 Easy-to-use interface

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 **Pro Tips:**
• Ask questions naturally - I'll understand!
• Don't worry about typos - I'll figure it out
• Try partial names or keywords
• Use the quick action buttons below
• Ask me anything about HTU!`;
                
                await bot.editMessageText(helpMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [ { text: '🏢 Browse Departments', callback_data: 'departments' }, { text: '🎯 Browse Clubs', callback_data: 'clubs' } ],
                            [ { text: '🏠 Back to Start', callback_data: 'start' } ]
                        ]
                    }
                });
                break;
                
            case 'history':
                // Show search history (same as /history command)
                const userId = callbackQuery.from.id;
                const userHistory = searchHistory.get(userId);
                
                if (!userHistory || userHistory.length === 0) {
                    const noHistoryMessage = `📝 **Your Search History**

You haven't searched for anything yet! 

💡 **Try searching for:**
• A faculty name
• A department
• A club or team
• An office location

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **Quick Actions:**`;
                    
                    await bot.editMessageText(noHistoryMessage, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [ { text: '🔍 Search Again', callback_data: 'start' } ],
                                [ { text: '🏠 Back to Start', callback_data: 'start' } ]
                            ]
                        }
                    });
                } else {
                    // Show last 10 searches
                    const recentSearches = userHistory.slice(-10).reverse();
                    let historyMessage = `📝 **Your Recent Searches**\n\n`;
                    
                    recentSearches.forEach((search, index) => {
                        const timeAgo = Math.floor((Date.now() - search.timestamp) / 60000); // minutes ago
                        const status = search.success ? '✅' : '❌';
                        const results = search.success ? 
                            `(${search.doctorResults || 0} faculty, ${search.clubResults || 0} clubs)` : 
                            '(no results)';
                        
                        historyMessage += `${index + 1}. ${status} **"${search.query}"**\n`;
                        historyMessage += `   📅 ${timeAgo < 1 ? 'Just now' : timeAgo + ' min ago'} ${results}\n\n`;
                    });
                    
                    historyMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 **Tip:** Tap any search to try it again!`;
                    
                    // Create inline keyboard with recent searches (use short ids)
                    const keyboard = { inline_keyboard: [] };
                    recentSearches.slice(0, 5).forEach((search, index) => {
                        const id = `r${++repeatCounter}`;
                        repeatSearchMap.set(id, search.query);
                        keyboard.inline_keyboard.push([{
                            text: `🔍 "${search.query}"`,
                            callback_data: `repeat_searchid_${id}`
                        }]);
                    });
                    
                    keyboard.inline_keyboard.push([
                        { text: '🏠 Back to Start', callback_data: 'start' }
                    ]);
                    
                    await bot.editMessageText(historyMessage, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                }
                break;
                
            case 'start':
                // Show welcome message (same as /start command)
                const welcomeMessage = `👋 **Welcome to Athar Bot!**

I'm your HTU assistant. Ask me anything or search directly!

**💬 Ask Questions:**
• "What are Razan's office hours?"
• "Who is the admission office?"
• "Where is Computer Science?"

**🔍 Or Search:**
• Names: "Mohammad"
• Departments: "Engineering"
• Clubs: "Programming"
• Offices: "S-321"`;
                
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: '🏢 All Departments', callback_data: 'departments' },
                            { text: '🎯 All Clubs', callback_data: 'clubs' }
                        ],
                        [
                            { text: '🏫 Building Guide', callback_data: 'buildings' },
                            { text: '📊 Statistics', callback_data: 'stats' }
                        ],
                        [
                            { text: '❓ Help', callback_data: 'help' }
                        ]
                    ]
                };
                
                await bot.editMessageText(welcomeMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: keyboard
                });
                break;
                
            default:
                // Handle doctor and club detail buttons
                if (data.startsWith('doctor_') || data.startsWith('club_')) {
                    const session = userSessions.get(chatId);
                    if (!session || Date.now() - session.timestamp > 300000) { // 5 minutes timeout
                        await bot.sendMessage(chatId, 'Session expired. Please search again!');
                        return;
                    }
                    
                    if (data.startsWith('doctor_')) {
                        const index = parseInt(data.split('_')[1]);
                        const doctor = session.results[index];
                        if (doctor) {
                            const doctorMessage = htuAssistant.formatDoctorInfo(doctor);
                            await bot.sendMessage(chatId, doctorMessage, {
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [ { text: '🔍 Search Again', callback_data: 'start' } ],
                                        [ { text: '� Back to Start', callback_data: 'start' } ]
                                    ]
                                }
                            });
                        }
                    } else if (data.startsWith('club_')) {
                        const index = parseInt(data.split('_')[1]);
                        const club = session.clubs[index];
                        if (club) {
                            const clubMessage = htuAssistant.formatClubInfo(club);
                            await bot.sendMessage(chatId, clubMessage, {
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [ { text: '🔍 Search Again', callback_data: 'start' } ],
                                        [ { text: '� Back to Start', callback_data: 'start' } ]
                                    ]
                                }
                            });
                        }
                    }
                }
                // Handle natural language processing callbacks
                else if (data.startsWith('nl_')) {
                    const parts = data.split('_');
                    const action = parts[1]; // contact, hours, office, club_contact
                    const entityName = decodeURIComponent(parts.slice(2).join('_'));
                    
                    if (action === 'contact') {
                        // Show contact info for a person
                        const nlpResult = htuAssistant.processNaturalLanguageQuery(`contact info of ${entityName}`);
                        if (nlpResult && nlpResult.hasResults) {
                            await bot.sendMessage(chatId, nlpResult.response, {
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [ { text: '⏰ Office Hours', callback_data: `nl_hours_${encodeURIComponent(entityName)}` } ],
                                        [ { text: '🏢 Office Location', callback_data: `nl_office_${encodeURIComponent(entityName)}` } ],
                                        [ { text: '🔍 Search Again', callback_data: 'start' } ]
                                    ]
                                }
                            });
                        } else {
                            await bot.sendMessage(chatId, `😔 I couldn't find contact information for "${entityName}".`);
                        }
                    } else if (action === 'hours') {
                        // Show office hours for a person
                        const nlpResult = htuAssistant.processNaturalLanguageQuery(`office hours of ${entityName}`);
                        if (nlpResult && nlpResult.hasResults) {
                            await bot.sendMessage(chatId, nlpResult.response, {
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [ { text: '📧 Contact Info', callback_data: `nl_contact_${encodeURIComponent(entityName)}` } ],
                                        [ { text: '🏢 Office Location', callback_data: `nl_office_${encodeURIComponent(entityName)}` } ],
                                        [ { text: '🔍 Search Again', callback_data: 'start' } ]
                                    ]
                                }
                            });
                        } else {
                            await bot.sendMessage(chatId, `😔 I couldn't find office hours for "${entityName}".`);
                        }
                    } else if (action === 'office') {
                        // Show office location for a person
                        const nlpResult = htuAssistant.processNaturalLanguageQuery(`office location of ${entityName}`);
                        if (nlpResult && nlpResult.hasResults) {
                            await bot.sendMessage(chatId, nlpResult.response, {
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [ { text: '📧 Contact Info', callback_data: `nl_contact_${encodeURIComponent(entityName)}` } ],
                                        [ { text: '⏰ Office Hours', callback_data: `nl_hours_${encodeURIComponent(entityName)}` } ],
                                        [ { text: '🔍 Search Again', callback_data: 'start' } ]
                                    ]
                                }
                            });
                        } else {
                            await bot.sendMessage(chatId, `😔 I couldn't find office location for "${entityName}".`);
                        }
                    } else if (action === 'club' && parts[2] === 'contact') {
                        // Show contact info for a club
                        const clubName = decodeURIComponent(parts.slice(3).join('_'));
                        const nlpResult = htuAssistant.processNaturalLanguageQuery(`contact info of ${clubName}`);
                        if (nlpResult && nlpResult.hasResults) {
                            await bot.sendMessage(chatId, nlpResult.response, {
                                parse_mode: 'Markdown',
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [ { text: '🎯 Browse All Clubs', callback_data: 'clubs' } ],
                                        [ { text: '🔍 Search Again', callback_data: 'start' } ]
                                    ]
                                }
                            });
                        } else {
                            await bot.sendMessage(chatId, `😔 I couldn't find contact information for "${clubName}".`);
                        }
                    }
                }
                // Handle repeat search from history
                else if (data.startsWith('repeat_search_')) {
                    const searchQuery = data.replace('repeat_search_', '');
                    // Simulate a text message with the search query
                    const fakeMsg = {
                        chat: { id: chatId },
                        from: callbackQuery.from,
                        text: searchQuery
                    };
                    // Trigger the search handler
                    bot.emit('message', fakeMsg);
                    return;
                }
                // 8-ball question via callback
                else if (data.startsWith('fun_8ball_q_')) {
                    const q = decodeURIComponent(data.replace('fun_8ball_q_', ''));
                    const res = htuAssistant.eightBall(q);
                    funStats.eightball++;
                    saveFunStats();
                    await bot.editMessageText(res.message, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[
                            { text: '🎱 Ask again', callback_data: 'fun_8ball_prompt' },
                            { text: '✨ Fun Menu', callback_data: 'fun_menu' }
                        ]] }
                    });
                }
                // Quiz answer
                else if (data.startsWith('fun_quiz_answer_')) {
                    const idx = parseInt(data.replace('fun_quiz_answer_', ''));
                    const session = userSessions.get(chatId);
                    if (!session || !session.quiz) {
                        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Quiz expired. Starting a new one...' });
                        // Replace message with new quiz
                        const quiz = htuAssistant.generateQuizQuestion();
                        const keyboard = { inline_keyboard: quiz.options.map((opt, i) => ([{ text: opt, callback_data: `fun_quiz_answer_${i}` }]))
                            .concat([[{ text: '✨ Fun Menu', callback_data: 'fun_menu' }]]) };
                        userSessions.set(chatId, { ...(session || {}), quiz, timestamp: Date.now() });
                        await bot.editMessageText(`🧠 ${quiz.question}`, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
                        return;
                    }
                    const result = htuAssistant.verifyQuizAnswer(session.quiz, idx);
                    await bot.editMessageText(`${result.message}\n\nWant another question?`, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[
                            { text: '🧠 New Quiz', callback_data: 'fun_quiz' },
                            { text: '✨ Fun Menu', callback_data: 'fun_menu' }
                        ]] }
                    });
                    // Clear quiz to avoid stale answers
                    const s = userSessions.get(chatId) || {};
                    delete s.quiz;
                    userSessions.set(chatId, { ...s, timestamp: Date.now() });
                }
                break;
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        
        // Handle specific Telegram API errors
        if (error.response && error.response.body) {
            const errorBody = error.response.body;
            if (errorBody.description && (
                errorBody.description.includes('message is not modified') ||
                errorBody.description.includes('message to edit not found')
            )) {
                // These are common and not critical errors
                console.log('Non-critical Telegram API error:', errorBody.description);
                return;
            }
        }
        
        // If editing fails, send a new message
        try {
            await bot.sendMessage(chatId, '😔 Something went wrong. Please try again!', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🏠 Back to Start', callback_data: 'start' }
                    ]]
                }
            });
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
    }
});

// Handle /departments command
bot.onText(/\/departments/, async (msg) => {
    const chatId = msg.chat.id;
    const departments = htuAssistant.getDepartments();
    
    let message = `🏢 *HTU Departments*\n\n`;
    departments.forEach((dept, index) => {
        message += `${index + 1}. 📚 ${dept}\n`;
    });
    
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 *Tip:* Type any department name to find doctors!`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Admin reload command to hot-reload data files without restarting the process
bot.onText(/\/reload/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!config.ADMIN_IDS || !Array.isArray(config.ADMIN_IDS) || !config.ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(chatId, '❌ You are not authorized to run this command.');
        return;
    }

    await bot.sendMessage(chatId, '🔁 Reloading data files...');
    try {
        const res = htuAssistant.reload();
        if (res.ok) {
            await bot.sendMessage(chatId, `✅ Reloaded: ${res.doctors} doctors, ${res.clubs} clubs`);
        } else {
            await bot.sendMessage(chatId, `⚠️ Reload failed: ${res.error}`);
        }
    } catch (e) {
        console.error('Reload command error:', e);
        await bot.sendMessage(chatId, `⚠️ Reload failed: ${String(e)}`);
    }
});

// Watch data files and auto-reload (debounced)
// Behavior: attempt to use fs.watch; on EMFILE or other watcher errors, fall back to fs.watchFile polling.
// Also support disabling watchers via environment variable DISABLE_FILE_WATCHERS or config.DISABLE_FILE_WATCHERS.
try {
    const disableWatchers = process.env.DISABLE_FILE_WATCHERS === '1' || config.DISABLE_FILE_WATCHERS === true;
    if (!disableWatchers) {
        const watchFiles = [
            require('path').join(__dirname, 'doctors.json'),
            require('path').join(__dirname, 'htuClubs.json'),
            require('path').join(__dirname, 'htuNameSystem.json')
        ];

        let reloadTimer = null;
        const watchers = [];

        const scheduleReload = () => {
            if (reloadTimer) clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => {
                try {
                    const res = htuAssistant.reload();
                    console.log('Auto-reload result:', res);
                } catch (e) {
                    console.error('Auto-reload error:', e);
                }
            }, 1500);
        };

        watchFiles.forEach(f => {
            try {
                if (!fs.existsSync(f)) return;

                // Attempt fs.watch first
                const w = fs.watch(f, { persistent: false }, (ev, filename) => {
                    try {
                        console.log(`🔔 Detected change in ${filename} (${ev})`);
                        scheduleReload();
                    } catch (inner) {
                        console.error('Watcher callback error:', inner);
                    }
                });
                watchers.push(w);
            } catch (watchErr) {
                // If we hit EMFILE or similar, fall back to polling via fs.watchFile
                console.error('fs.watch failed for', f, watchErr && watchErr.code ? `${watchErr.code}: ${watchErr.message}` : watchErr);
                try {
                    fs.watchFile(f, { interval: 2000 }, (curr, prev) => {
                        if (curr.mtimeMs !== prev.mtimeMs) {
                            console.log(`🔔 (poll) Detected change in ${f}`);
                            scheduleReload();
                        }
                    });
                } catch (pollErr) {
                    console.error('fs.watchFile fallback failed for', f, pollErr);
                }
            }
        });

        // Keep a reference to close watchers on shutdown if needed
        process.on('exit', () => {
            watchers.forEach(w => {
                try { if (typeof w.close === 'function') w.close(); } catch (e) { /* ignore */ }
            });
        });
    } else {
        console.log('File watchers are disabled by configuration (DISABLE_FILE_WATCHERS=1)');
    }
} catch (e) {
    console.error('Error setting up file watchers:', e);
}

// Handle /stats command
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const stats = htuAssistant.getStats();
    
                const statsMessage = `📊 *Athar Bot Statistics*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👨‍⚕️ **Doctors:** ${stats.totalDoctors} members
🏢 **Departments:** ${stats.departments} departments
🎯 **Clubs & Teams:** ${stats.totalClubs} organizations
🏷️ **Club Types:** ${stats.clubTypes} categories

📅 **Office Info:**
⏰ With Office Hours: ${stats.withOfficeHours}
🏢 With Office Info: ${stats.withOffice}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

// /random command removed

// Handle /clubs command
bot.onText(/\/clubs/, async (msg) => {
    const chatId = msg.chat.id;
    const clubs = htuAssistant.clubs;
    
    let message = `🎯 *HTU Clubs & Teams*\n\n`;
    
    const clubTypes = [...new Set(clubs.map(c => c['Club/ Volunteer team']))].sort();
    
    clubTypes.forEach((type, index) => {
        const typeClubs = clubs.filter(c => c['Club/ Volunteer team'] === type);
        message += `${index + 1}. 🏷️ *${type}* (${typeClubs.length} clubs)\n`;
        typeClubs.slice(0, 3).forEach(club => {
            message += `   • ${club['Name of it ']}\n`;
        });
        if (typeClubs.length > 3) {
            message += `   • ... and ${typeClubs.length - 3} more\n`;
        }
        message += `\n`;
    });
    
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 *Tip:* Type any club name to get details!`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Handle /buildings command
bot.onText(/\/buildings/, async (msg) => {
    const chatId = msg.chat.id;
    const buildingGuide = htuAssistant.getBuildingGuide();
    
    await bot.sendMessage(chatId, buildingGuide, { parse_mode: 'Markdown' });
});

// /randomclub command removed

// Handle /history command
bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const userHistory = searchHistory.get(userId);
    
    if (!userHistory || userHistory.length === 0) {
        const noHistoryMessage = `📝 **Your Search History**

You haven't searched for anything yet! 

💡 **Try searching for:**
• A faculty name
• A department
• A club or team
• An office location

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **Quick Actions:**`;

        await bot.sendMessage(chatId, noHistoryMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                        [
                            { text: '� Browse Departments', callback_data: 'departments' },
                            { text: '🎯 Browse Clubs', callback_data: 'clubs' }
                        ],
                    [
                        { text: '🏠 Back to Start', callback_data: 'start' }
                    ]
                ]
            }
        });
        return;
    }
    
    // Show last 10 searches
    const recentSearches = userHistory.slice(-10).reverse();
    let historyMessage = `📝 **Your Recent Searches**\n\n`;
    
    recentSearches.forEach((search, index) => {
        const timeAgo = Math.floor((Date.now() - search.timestamp) / 60000); // minutes ago
        const status = search.success ? '✅' : '❌';
        const results = search.success ? 
            `(${search.doctorResults || 0} faculty, ${search.clubResults || 0} clubs)` : 
            '(no results)';
        
        historyMessage += `${index + 1}. ${status} **"${search.query}"**\n`;
        historyMessage += `   📅 ${timeAgo < 1 ? 'Just now' : timeAgo + ' min ago'} ${results}\n\n`;
    });
    
    historyMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 **Tip:** Tap any search to try it again!`;
    
    // Create inline keyboard with recent searches (use short ids)
    const keyboard = { inline_keyboard: [] };
    recentSearches.slice(0, 5).forEach((search, index) => {
        const id = `r${++repeatCounter}`;
        repeatSearchMap.set(id, search.query);
        keyboard.inline_keyboard.push([{
            text: `🔍 "${search.query}"`,
            callback_data: `repeat_searchid_${id}`
        }]);
    });
    
    keyboard.inline_keyboard.push([
        { text: '🏠 Back to Start', callback_data: 'start' }
    ]);
    
    await bot.sendMessage(chatId, historyMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
});

// Handle search queries (any text that's not a command)
bot.onText(/^(?!\/).+/, async (msg) => {
    const chatId = msg.chat.id;
    const query = msg.text.trim();
        // Skip if it's a command or empty
        if (query.startsWith('/') || query.length === 0) return;
    if (query.startsWith('/')) return;
    
    console.log(`🔍 Search query from ${msg.from.first_name}: "${query}"`);
    
    // Store search in history
    const userId = msg.from.id;
    if (!searchHistory.has(userId)) {
        searchHistory.set(userId, []);
    }
    searchHistory.get(userId).push({
        query,
        timestamp: Date.now(),
        success: false // Will be updated to true if successful
    });
    // Persist history after adding
    try { saveSearchHistoryToFile(); } catch (e) { console.error('Failed to save search history:', e); }
    
    // Show typing indicator
    await bot.sendChatAction(chatId, 'typing');
    
    try {
        // First, try to process as natural language question
        const nlpResult = htuAssistant.processNaturalLanguageQuery(query);
        
        // ...existing code...
        try {
            // First, try to process as natural language question
            const nlpResult = htuAssistant.processNaturalLanguageQuery(query);
            let usedLocal = false;
            let localResponse = '';
            let keyboard = { inline_keyboard: [] };
            if (nlpResult && nlpResult.hasResults) {
                usedLocal = true;
                localResponse = nlpResult.response;
                if (nlpResult.singleResult) {
                    if (nlpResult.singleResult.name) {
                        keyboard.inline_keyboard.push([
                            { text: '📧 Contact Info', callback_data: `nl_contact_${encodeURIComponent(nlpResult.singleResult.name)}` },
                            { text: '⏰ Office Hours', callback_data: `nl_hours_${encodeURIComponent(nlpResult.singleResult.name)}` }
                        ]);
                        keyboard.inline_keyboard.push([
                            { text: '🏢 Office Location', callback_data: `nl_office_${encodeURIComponent(nlpResult.singleResult.name)}` }
                        ]);
                    } else if (nlpResult.singleResult['Name of it ']) {
                        keyboard.inline_keyboard.push([
                            { text: '📧 Contact Club', callback_data: `nl_club_contact_${encodeURIComponent(nlpResult.singleResult['Name of it '])}` }
                        ]);
                    }
                }
                keyboard.inline_keyboard.push([
                    { text: '🔍 Search Again', callback_data: 'start' },
                    { text: '❓ Help', callback_data: 'help' }
                ]);
            }

            // Search both doctors and clubs
            const doctorResults = htuAssistant.search(query);
            const clubResults = htuAssistant.searchClubs(query);
            const userHistory = searchHistory.get(userId);
            if (userHistory && userHistory.length > 0) {
                userHistory[userHistory.length - 1].success = (doctorResults.length > 0 || clubResults.length > 0);
                userHistory[userHistory.length - 1].doctorResults = doctorResults.length;
                userHistory[userHistory.length - 1].clubResults = clubResults.length;
                try { saveSearchHistoryToFile(); } catch (e) { console.error('Failed to save search history:', e); }
            }

            if (doctorResults.length === 0 && clubResults.length === 0) {
                await bot.sendMessage(chatId, '😔 I could not find an answer for your question.');
                return;
            } else if (doctorResults.length === 1 && clubResults.length === 0) {
                // ...existing code for single doctor result...
                const detailedMessage = htuAssistant.formatDoctorInfo(doctorResults[0]);
                await bot.sendMessage(chatId, detailedMessage, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔍 Search Again', callback_data: 'start' }
                            ],
                            [
                                { text: '🏢 Browse Departments', callback_data: 'departments' }
                            ]
                        ]
                    }
        });
    } else if (clubResults.length === 1 && doctorResults.length === 0) {
                // ...existing code for single club result...
                const detailedMessage = htuAssistant.formatClubInfo(clubResults[0]);
                await bot.sendMessage(chatId, detailedMessage, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '🔍 Search Again', callback_data: 'start' }
                            ],
                            [
                                { text: '🎯 Browse All Clubs', callback_data: 'clubs' }
                            ]
                        ]
                    }
        });
    } else {
                // ...existing code for multiple results...
                let resultsMessage = '';
                let keyboard = { inline_keyboard: [] };
                let sessionData = { results: [], clubs: [], query, timestamp: Date.now() };
                const totalResults = doctorResults.length + clubResults.length;
                resultsMessage += `🎉 **Great! Found ${totalResults} result${totalResults === 1 ? '' : 's'} for "${query}"**\n\n`;
                if (doctorResults.length > 0) {
                    resultsMessage += `👨‍⚕️ **Doctors (${doctorResults.length}):**\n\n`;
                    doctorResults.forEach((doctor, index) => {
                        resultsMessage += `${index + 1}. **${doctor.name}**\n`;
                        resultsMessage += `   📚 ${doctor.department}\n`;
                        resultsMessage += `   📧 [${doctor.email}](mailto:${doctor.email})\n`;
                        resultsMessage += `   🏢 ${doctor.office || 'Not specified'}\n\n`;
                    });
                    sessionData.results = doctorResults;
                    doctorResults.forEach((doctor, index) => {
                        keyboard.inline_keyboard.push([{
                            text: `👨‍🏫 ${index + 1}. ${doctor.name}`,
                            callback_data: `doctor_${index}`
                        }]);
                    });
                }
                if (clubResults.length > 0) {
                    if (doctorResults.length > 0) resultsMessage += '\n';
                    resultsMessage += `🎯 **Clubs & Teams (${clubResults.length}):**\n\n`;
                    clubResults.forEach((club, index) => {
                        resultsMessage += `${index + 1}. **${club['Name of it ']}**\n`;
                        resultsMessage += `   🏷️ ${club['Club/ Volunteer team']}\n`;
                        if (club['The email'] && club['The email'] !== 'N/A') {
                            resultsMessage += `   📧 [${club['The email']}](mailto:${club['The email']})\n`;
                        }
                        resultsMessage += `\n`;
                    });
                    sessionData.clubs = clubResults;
                    clubResults.forEach((club, index) => {
                        keyboard.inline_keyboard.push([{
                            text: `🎯 ${index + 1}. ${club['Name of it ']}`,
                            callback_data: `club_${index}`
                        }]);
                    });
                }
                resultsMessage += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 **Click any button below for full details!**`;
                userSessions.set(chatId, sessionData);
                await bot.sendMessage(chatId, resultsMessage, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    reply_markup: keyboard
                });
            }
        } catch (innerError) {
            console.error('Error in inner try block:', innerError);
        }
    } catch (error) {
        console.error('Error processing search query:', error);
        await bot.sendMessage(chatId, '😔 An error occurred while processing your question.');
    }
});

// Handle errors
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Clean up old sessions every hour
cron.schedule('0 * * * *', () => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [chatId, session] of userSessions.entries()) {
        if (now - session.timestamp > oneHour) {
            userSessions.delete(chatId);
        }
    }
    // Memory cleanup
    if (global.gc) {
        global.gc();
    }
    console.log(`🧹 Cleaned up sessions. Active sessions: ${userSessions.size}`);
    console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
});

// Memory monitoring and cleanup every 15 minutes
cron.schedule('*/15 * * * *', () => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const memoryLimitMB = 400; // Set memory limit lower than PM2's 512M restart limit
    
    console.log(`💾 Memory check: ${heapUsedMB}MB used`);
    
    if (heapUsedMB > memoryLimitMB) {
        console.log('⚠️ High memory usage detected, forcing garbage collection');
        if (global.gc) {
            global.gc();
        }
    }
});

// Simple health endpoint
try {
    const healthPort = config.HEALTH_PORT || 3000;
    http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/healthz') {
            const mem = process.memoryUsage();
            const body = JSON.stringify({
                status: 'ok',
                uptime: process.uptime(),
                heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
                sessions: userSessions.size
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(body);
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    }).listen(healthPort, () => {
        console.log(`🔁 Health endpoint listening on :${healthPort}`);
    });
} catch (e) {
    console.error('Failed to start health endpoint', e);
}

console.log('✅ Bot is running and ready to serve!');
console.log('🤖 Bot will work 24/7 and handle all requests automatically');