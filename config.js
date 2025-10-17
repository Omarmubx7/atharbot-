// Load environment variables
try {
    require('dotenv').config();
} catch {}

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('[CONFIG] Missing BOT_TOKEN. Set it in environment variables.');
    process.exit(1);
}

module.exports = {
    BOT_TOKEN,
    NODE_ENV: process.env.NODE_ENV || 'production',
    DOCTORS_DATA_PATH: process.env.DOCTORS_DATA_PATH || './doctors.json',
    MAX_RESULTS: Number(process.env.MAX_RESULTS || 10),
     // Health endpoint port for external monitors
     HEALTH_PORT: Number(process.env.HEALTH_PORT || 3000),
     // Paths for simple persistence
     HISTORY_PATH: process.env.HISTORY_PATH || './data/searchHistory.json',
     STATS_PATH: process.env.STATS_PATH || './data/funStats.json',
    // Comma-separated admin user ids (e.g. "12345,67890") for admin-only commands like /reload
    ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(s => Number(s)).filter(Boolean),
    WELCOME_MESSAGE: `🎓 *Welcome to Athar Bot!* 

👋 Hi! I'm your Athar Bot assistant. I can find:

👨‍⚕️ *Doctors & Staff*
• Search by name: "Mohammad"
• Search by department: "Computer Science"
• Search by office: "S-321"

🎯 *Student Clubs & Teams*
• Search by name: "Entrepreneurship"
• Search by type: "Volunteer team"

🏢 *Campus Locations*
• Building codes: N, S, IJC, W, WS
• Room numbers: S-321, N-402

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *How to Use:*
Just type what you're looking for!

🔍 *Examples:*
• Type "Mohammad" to find doctors
• Type "Entrepreneurship" to find clubs
• Type "S-321" to find office info

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ *Quick Commands:*
/help - See all commands
/clubs - Browse all clubs
/buildings - Campus guide

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,

GOOGLE_GEMINI_API_KEY: process.env.GOOGLE_GEMINI_API_KEY,
};