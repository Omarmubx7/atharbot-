# 🤖 HTU Doctors Telegram Bot

A smart, 24/7 Telegram bot for HTU (Al-Hussein Technical University) faculty directory with clickable emails and advanced search capabilities.

## ✨ Features

- 🔍 **Smart Search**: Search by name, department, office, or school
- 📧 **Clickable Emails**: Direct email links for easy contact
- ⏰ **Office Hours**: Complete office hours information
- 🏢 **Department Filtering**: Browse by department
- 📊 **Statistics**: Bot usage and data statistics
- 🎯 **Interactive Results**: Click buttons for detailed information
- 🔄 **24/7 Operation**: Automatic restart and health monitoring
- 💡 **Smart Suggestions**: Helpful tips when no results found

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Start the bot:**
```bash
# For development (with auto-restart)
npm run dev

# For production (24/7 operation)
npm start
```

## 📱 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and bot introduction |
| `/help` | Show help and available commands |
| `/departments` | List all available departments |
| `/stats` | Show bot statistics |

## 🔍 Search Features

### Text Search
Simply type any text to search:
- **Names**: "Mohammad", "Dr. Samir"
- **Departments**: "Computer Science", "Cyber Security"
- **Offices**: "S-321", "W-B05"
- **Schools**: "Computing"

### Smart Features
- Case-insensitive search
- Partial name matching
- Relevance scoring
- Multiple result handling
- Interactive result selection

## 🏗️ Project Structure

```
telegram-bot/
├── bot.js          # Main bot logic
├── utils.js        # Search and utility functions
├── config.js       # Configuration settings
├── package.json    # Dependencies
└── README.md       # This file
```

## 🔧 Configuration

Edit `config.js` to customize:
- Bot token
- Maximum search results
- Welcome message
- Data file path

## 📊 Data Source

The bot uses the `doctors.json` file in this folder by default, containing:
- Doctor names and departments
- Email addresses (clickable)
- Office locations
- Office hours

## 🛠️ Development

### Adding New Features

1. **New Commands**: Add handlers in `bot.js`
2. **Search Logic**: Extend `DoctorSearch` class in `utils.js`
3. **UI Improvements**: Modify message formatting functions

### Testing

```bash
# Start in development mode
npm run dev

# Test with your Telegram account
# Search for: "Computer Science", "Mohammad", "S-321"
```

## 🚀 Deployment

### Local 24/7 Operation
```bash
node deploy.js
```

### Cloud Deployment (Recommended)
For true 24/7 operation, deploy to:
- **Heroku**: Free tier available
- **Railway**: Free tier available
- **Render**: Free tier available
- **VPS**: DigitalOcean, AWS, etc.

### Environment Variables
Set these in your deployment platform:
```
BOT_TOKEN=your_bot_token_here
NODE_ENV=production
```

## 📈 Monitoring

The bot includes built-in monitoring:
- Health checks every 30 minutes
- Session cleanup every hour
- Automatic restart on crashes
- Usage statistics

## 🔒 Security

- Bot token is stored in config (consider using environment variables)
- Input validation and sanitization
- Error handling and logging
- Rate limiting (built into Telegram API)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

MIT License - feel free to use and modify!

## 🆘 Support

If you encounter issues:
1. Check the console logs
2. Verify the bot token
3. Ensure the doctors.json file is accessible
4. Check your internet connection

## 🎯 Future Enhancements

- [ ] Webhook support for better performance
- [ ] Database integration for dynamic updates
- [ ] Admin panel for data management
- [ ] Multi-language support
- [ ] Advanced analytics
- [ ] Integration with HTU systems

---

**Made with ❤️ for HTU Community** 