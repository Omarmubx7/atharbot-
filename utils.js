const fs = require('fs');
const path = require('path');
const config = require('./config');

// Ensure directory exists for a given file path
function ensureDirForFile(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Basic Markdown escaper for Markdown parse_mode
function escapeMarkdown(text) {
    if (!text && text !== 0) return '';
    return String(text).replace(/([\\`*_\[\]()~>#+\-=|{}.!])/g, '\\$1');
}

class HTUAssistant {
    constructor() {
        this.doctors = this.loadDoctors();
        this.departments = this.extractDepartments();
        this.clubs = this.loadClubs();
        this.nameSystem = this.loadNameSystem();
    }

    // Reload all data files and rebuild derived indexes
    reload() {
        try {
            this.doctors = this.loadDoctors();
            this.departments = this.extractDepartments();
            this.clubs = this.loadClubs();
            this.nameSystem = this.loadNameSystem();
            console.log(`🔁 HTUAssistant reloaded: ${this.doctors.length} doctors, ${this.clubs.length} clubs`);
            return { ok: true, doctors: this.doctors.length, clubs: this.clubs.length };
        } catch (e) {
            console.error('Error during HTUAssistant.reload()', e);
            return { ok: false, error: String(e) };
        }
    }

    // Normalize text: lowercase, remove diacritics, collapse spaces, remove punctuation
    normalize(text) {
        if (!text && text !== 0) return '';
        let s = String(text).toLowerCase().trim();
        // Remove diacritics
        s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
        // Replace punctuation with space, collapse whitespace
        s = s.replace(/[\p{Punctuation}]/gu, ' ').replace(/\s+/g, ' ').trim();
        return s;
    }

    // Jaro-Winkler similarity implementation (fast heuristic for short strings)
    jaroWinkler(s1, s2) {
        if (!s1 || !s2) return 0;
        const m = Math.max(s1.length, s2.length);
        const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
        let matches = 0;
        let transpositions = 0;
        const s1Matches = new Array(s1.length).fill(false);
        const s2Matches = new Array(s2.length).fill(false);

        for (let i = 0; i < s1.length; i++) {
            const start = Math.max(0, i - matchDistance);
            const end = Math.min(i + matchDistance + 1, s2.length);
            for (let j = start; j < end; j++) {
                if (s2Matches[j]) continue;
                if (s1[i] !== s2[j]) continue;
                s1Matches[i] = true;
                s2Matches[j] = true;
                matches++;
                break;
            }
        }

        if (matches === 0) return 0;

        let k = 0;
        for (let i = 0; i < s1.length; i++) {
            if (!s1Matches[i]) continue;
            while (!s2Matches[k]) k++;
            if (s1[i] !== s2[k]) transpositions++;
            k++;
        }

        transpositions = transpositions / 2;
        const mF = matches;
        const jaro = (mF / s1.length + mF / s2.length + (mF - transpositions) / mF) / 3;

        // Winkler bonus for common prefix
        let prefix = 0;
        for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
            if (s1[i] === s2[i]) prefix++; else break;
        }
        return jaro + prefix * 0.1 * (1 - jaro);
    }

    // Token-aware similarity: compare tokens then average, better for multi-word names
    tokenSimilarity(a, b) {
        const na = this.normalize(a).split(' ').filter(Boolean);
        const nb = this.normalize(b).split(' ').filter(Boolean);
        if (na.length === 0 || nb.length === 0) return 0;

        // For each token in na find best match in nb
        let total = 0;
        na.forEach(tokenA => {
            let best = 0;
            nb.forEach(tokenB => {
                // Use jaro-winkler first; fallback to levenshtein similarity
                const jw = this.jaroWinkler(tokenA, tokenB);
                if (jw > best) best = jw;
            });
            total += best;
        });
        return total / na.length;
    }

    // Small helper to pick a random friendly phrase from an array
    choose(arr) {
        if (!Array.isArray(arr) || arr.length === 0) return '';
        return arr[Math.floor(Math.random() * arr.length)];
    }

    loadDoctors() {
        try {
            const configuredPath = config.DOCTORS_DATA_PATH;
            const candidatePaths = [];
            // 1) Respect absolute path as-is, otherwise resolve relative to this file
            candidatePaths.push(
                path.isAbsolute(configuredPath)
                    ? configuredPath
                    : path.join(__dirname, configuredPath)
            );
            // 2) Fallback to local doctors.json beside the bot files
            candidatePaths.push(path.join(__dirname, 'doctors.json'));
            // 3) Fallback to process cwd
            candidatePaths.push(path.join(process.cwd(), 'doctors.json'));

            for (const candidate of candidatePaths) {
                try {
                    if (fs.existsSync(candidate)) {
                        const data = fs.readFileSync(candidate, 'utf8');
                        return JSON.parse(data);
                    }
                } catch (innerError) {
                    // Try next candidate
                }
            }
            throw new Error(`Doctors data file not found. Tried: ${candidatePaths.join(', ')}`);
        } catch (error) {
            console.error('Error loading doctors data:', error);
            return [];
        }
    }

    loadClubs() {
        try {
            const clubsPath = path.join(__dirname, 'htuClubs.json');
            const data = fs.readFileSync(clubsPath, 'utf8');
            const rawClubs = JSON.parse(data);
            
            // Validate and clean the data
            const validClubs = [];
            const seenNames = new Set();
            
            rawClubs.forEach((club, index) => {
                // Check if club has required fields
                if (!club['Club/ Volunteer team'] || !club['Name of it ']) {
                    console.warn(`Skipping invalid club at index ${index}: missing required fields`);
                    return;
                }
                
                // Check for duplicates based on name
                    // Normalize club name aggressively: trim, collapse whitespace
                    const rawName = club['Name of it '] || '';
                    const clubName = rawName.toString().trim().replace(/\s+/g, ' ');
                if (seenNames.has(clubName)) {
                    console.warn(`Skipping duplicate club: "${clubName}" at index ${index}`);
                    return;
                }
                
                // Clean and validate data
                const cleanClub = {
                        'Club/ Volunteer team': club['Club/ Volunteer team'] ? club['Club/ Volunteer team'].toString().trim() : 'N/A',
                        'Name of it ': clubName,
                        'The email': club['The email'] ? club['The email'].toString().trim() : 'N/A',
                        'Instagram account link': club['Instagram account link'] ? club['Instagram account link'].toString().trim() : 'N/A',
                        'What is yours club or volunteer team about ?': club['What is yours club or volunteer team about ?'] ? club['What is yours club or volunteer team about ?'].toString().trim() : ''
                };
                
                seenNames.add(clubName);
                validClubs.push(cleanClub);
            });
            
            console.log(`Loaded ${validClubs.length} valid clubs (filtered ${rawClubs.length - validClubs.length} invalid/duplicate entries)`);
            return validClubs;
        } catch (error) {
            console.error('Error loading clubs data:', error);
            return [];
        }
    }

    loadNameSystem() {
        try {
            const nameSystemPath = path.join(__dirname, 'htuNameSystem.json');
            const data = fs.readFileSync(nameSystemPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading name system data:', error);
            return {};
        }
    }

    extractDepartments() {
        const departments = new Set();
        this.doctors.forEach(doctor => {
            if (doctor.department) {
                departments.add(doctor.department.trim());
            }
        });
        return Array.from(departments).sort();
    }

    search(query) {
        if (!query || query.trim().length < 2) {
            return [];
        }
        const rawQuery = query.trim();
        const searchTerm = rawQuery.toLowerCase();
        const normQuery = this.normalize(searchTerm);
        const queryTokens = normQuery.split(' ').filter(Boolean);

        const results = [];

        this.doctors.forEach(doctor => {
            let score = 0;
            const matchedFields = [];

            // Normalize fields for robust matching
            const name = doctor.name ? doctor.name.toString().trim() : '';
            const normName = this.normalize(name);
            const nameTokens = normName.split(' ').filter(Boolean);

            const dept = doctor.department ? doctor.department.toString().trim() : '';
            const office = doctor.office ? doctor.office.toString().trim() : '';
            const school = doctor.school ? doctor.school.toString().trim() : '';
            const email = doctor.email ? doctor.email.toString().trim() : '';

            // 1) Exact normalized name match (highest priority)
            if (normName && normName === normQuery) {
                score += 350;
                matchedFields.push('exact_name');
            }
            // 2) Full name starts with query OR first token starts with query
            else if (normName.startsWith(normQuery) || (queryTokens.length > 0 && nameTokens[0] && nameTokens[0].startsWith(queryTokens[0]))) {
                score += 220;
                matchedFields.push('name_start');
            }
            // 3) Token-wise prefix matching: every query token matches start of corresponding name token
            else {
                let allPrefix = true;
                if (queryTokens.length > 0) {
                    for (let i = 0; i < queryTokens.length; i++) {
                        if (!nameTokens[i] || !nameTokens[i].startsWith(queryTokens[i])) {
                            allPrefix = false;
                            break;
                        }
                    }
                } else allPrefix = false;

                if (allPrefix) {
                    score += 200;
                    matchedFields.push('tokens_prefix');
                }
                // 4) Name contains (weaker)
                else if (normName.includes(normQuery)) {
                    score += 90;
                    matchedFields.push('name_contains');
                }
                // 5) Fuzzy fallback (stricter than before)
                else {
                    const tokenSim = this.tokenSimilarity(normName, normQuery);
                    const levSim = this.calculateSimilarity(normName, normQuery);
                    const combined = Math.max(tokenSim, levSim);
                    if (combined > 0.70) {
                        score += Math.round(80 * combined);
                        matchedFields.push('fuzzy_name');
                    }
                }
            }

            // Department exact or contains
            if (dept && dept.toLowerCase() === searchTerm) {
                score += 100;
                matchedFields.push('exact_department');
            } else if (dept && dept.toLowerCase().includes(searchTerm)) {
                score += 60;
                matchedFields.push('department');
            }

            // Office exact / contains
            if (office && office.toLowerCase() === searchTerm) {
                score += 80;
                matchedFields.push('exact_office');
            } else if (office && office.toLowerCase().includes(searchTerm)) {
                score += 30;
                matchedFields.push('office');
            }

            // School and email (lower weight)
            if (school && school.toLowerCase().includes(searchTerm)) {
                score += 25;
                matchedFields.push('school');
            }
            if (email && email.toLowerCase().includes(searchTerm)) {
                score += 10;
                matchedFields.push('email');
            }

            if (score > 0) {
                results.push({ doctor, score, matchedFields, normName });
            }
        });

        // Deduplicate by normalized name: keep the highest-scoring entry for a given normalized name
        const bestByName = new Map();
        results.forEach(r => {
            const key = r.normName || this.normalize(r.doctor.name || '');
            const prev = bestByName.get(key);
            if (!prev || r.score > prev.score) bestByName.set(key, r);
        });

        const deduped = Array.from(bestByName.values());

        // Sort by score (highest first) and limit results
        return deduped
            .sort((a, b) => b.score - a.score)
            .slice(0, config.MAX_RESULTS)
            .map(result => result.doctor);
    }

    // Calculate string similarity using Levenshtein distance
    calculateSimilarity(str1, str2) {
        const matrix = [];
        const len1 = str1.length;
        const len2 = str2.length;

        if (len1 === 0) return len2 === 0 ? 1 : 0;
        if (len2 === 0) return 0;

        for (let i = 0; i <= len2; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= len1; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= len2; i++) {
            for (let j = 1; j <= len1; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        const maxLen = Math.max(len1, len2);
        return maxLen === 0 ? 1 : (maxLen - matrix[len2][len1]) / maxLen;
    }

    searchByDepartment(department) {
        return this.doctors.filter(doctor => 
            doctor.department && 
            doctor.department.toLowerCase().includes(department.toLowerCase())
        );
    }

    getDepartments() {
        return this.departments;
    }

    formatDoctorInfo(doctor) {
        const officeHours = doctor.office_hours ? 
            Object.entries(doctor.office_hours)
                .map(([day, hours]) => `📅 **${day}:** ${hours}`)
                .join('\n') : '📅 **Office Hours:** Not specified';

        const office = doctor.office ? doctor.office.toString().trim() : '';
        const officeInfo = office ? this.formatOfficeLocation(office) : '🏢 **Office:** Not specified';

        // Escape dynamic fields to reduce markdown issues
        const name = escapeMarkdown(doctor.name || 'Unknown');
        const school = escapeMarkdown(doctor.school || 'Unknown');
        const dept = escapeMarkdown(doctor.department || 'Unknown');
        const email = doctor.email ? doctor.email.toString().trim() : 'N/A';

        // Friendly prefixes and closings
        const intros = [
            `Here's what I found for *${name}*:`,
            `Details on *${name}*:`,
            `Take a look at *${name}*:`
        ];
        const closing = this.choose([
            'If you need more, try typing a department or office code.',
            'Tap Back to Start or search another name.',
            'Want office hours or contact info? Ask me!'
        ]);

        return `${this.choose(intros)}\n\n` +
            `🏫 **School:** ${school}\n` +
            `📚 **Department:** ${dept}\n` +
            `📧 **Email:** [${email}](mailto:${email})\n` +
            `${officeInfo}\n\n` +
            `⏰ **Office Hours:**\n` +
            `${officeHours}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${closing}`;
    }
    formatSearchResults(results, query) {
        // This helper was previously used for formatting search results.
        // Kept minimal to avoid duplication with higher-level formatting in bot.js.
        if (!results || results.length === 0) return `😔 No results for "${query}".`;
        let message = `🎉 **Found ${results.length} doctor${results.length === 1 ? '' : 's'} for "${query}"**\n\n`;
        results.forEach((doctor, index) => {
            message += `${index + 1}. 👨‍🏫 **${doctor.name}**\n`;
            message += `   📚 ${doctor.department}\n`;
            message += `   📧 [${doctor.email}](mailto:${doctor.email})\n`;
            message += `   🏢 ${doctor.office || 'Not specified'}\n\n`;
        });
        return message;
    }

    // Get smart suggestions for failed searches
    getSmartSuggestions(query) {
        const suggestions = [];
        const queryLower = (query || '').toLowerCase();

        // Check for similar department names
        this.departments.forEach(dept => {
            if (this.calculateSimilarity(dept.toLowerCase(), queryLower) > 0.6) {
                suggestions.push(dept);
            }
        });

        // Check for similar doctor names
        this.doctors.forEach(doctor => {
            if (doctor.name && this.calculateSimilarity(doctor.name.toLowerCase(), queryLower) > 0.6) {
                suggestions.push(doctor.name);
            }
        });

        // Check for common misspellings
        const commonMistakes = {
            'computer': 'Computer Science',
            'cs': 'Computer Science',
            'it': 'Information Technology',
            'eng': 'Engineering',
            'bus': 'Business',
            'admin': 'Administration'
        };

        Object.entries(commonMistakes).forEach(([mistake, correction]) => {
            if (queryLower.includes(mistake)) {
                suggestions.push(correction);
            }
        });

        return [...new Set(suggestions)].slice(0, 3); // Remove duplicates and limit to 3
    }

    formatOfficeLocation(office) {
        if (!office || office === 'N/A') return '🏢 **Office:** Not specified';
        
        const buildingInfo = this.getBuildingInfo(office);
        if (buildingInfo) {
            return `🏢 **Office:** ${office} (${buildingInfo.name} - ${buildingInfo.nickname})`;
        }
        return `🏢 **Office:** ${office}`;
    }

    getBuildingInfo(officeCode) {
        if (!this.nameSystem.legend) return null;
        // Normalize input and attempt to find matching legend entry
        if (!officeCode) return null;
        const prefix = String(officeCode).toString().trim().split(/\s*-?\s*/)[0].toUpperCase();
        return this.nameSystem.legend[prefix] || null;
    }

    searchClubs(query) {
        if (!query || query.trim().length < 2) return [];
        const rawQuery = query.trim();
        const searchTerm = rawQuery.toLowerCase();
        const normQuery = this.normalize(searchTerm);
        const queryTokens = normQuery.split(' ').filter(Boolean);

        const results = [];

        this.clubs.forEach(club => {
            let score = 0;
            const matchedFields = [];
            const clubNameRaw = club['Name of it '] ? club['Name of it '] : '';
            const normClubName = this.normalize(clubNameRaw);
            const clubNameTokens = normClubName.split(' ').filter(Boolean);

            // Exact normalized name
            if (normClubName === normQuery) {
                score += 300;
                matchedFields.push('exact_name');
            }
            // Starts with or first token starts with
            else if (normClubName.startsWith(normQuery) || (queryTokens.length > 0 && clubNameTokens[0] && clubNameTokens[0].startsWith(queryTokens[0]))) {
                score += 180;
                matchedFields.push('name_start');
            }
            // Token prefix match
            else {
                let allPrefix = true;
                for (let i = 0; i < queryTokens.length; i++) {
                    if (!clubNameTokens[i] || !clubNameTokens[i].startsWith(queryTokens[i])) {
                        allPrefix = false;
                        break;
                    }
                }
                if (allPrefix && queryTokens.length > 0) {
                    score += 160;
                    matchedFields.push('tokens_prefix');
                } else if (normClubName.includes(normQuery)) {
                    score += 80;
                    matchedFields.push('name_contains');
                } else {
                    const tokenSim = this.tokenSimilarity(normClubName, normQuery);
                    const levSim = this.calculateSimilarity(normClubName, normQuery);
                    const combined = Math.max(tokenSim, levSim);
                    if (combined > 0.70) {
                        score += Math.round(70 * combined);
                        matchedFields.push('fuzzy_name');
                    }
                }
            }

            const clubType = club['Club/ Volunteer team'] ? club['Club/ Volunteer team'].toLowerCase() : '';
            if (clubType === searchTerm) {
                score += 80;
                matchedFields.push('exact_type');
            } else if (clubType.includes(searchTerm)) {
                score += 50;
                matchedFields.push('type');
            }

            if (club['What is yours club or volunteer team about ?'] && club['What is yours club or volunteer team about ?'].toLowerCase().includes(searchTerm)) {
                score += 30;
                matchedFields.push('description');
            }

            if (score > 0) {
                results.push({ club, score, matchedFields, normClubName });
            }
        });

        // Deduplicate by normalized club name
        const bestByName = new Map();
        results.forEach(r => {
            const key = r.normClubName || this.normalize(r.club['Name of it '] || '');
            const prev = bestByName.get(key);
            if (!prev || r.score > prev.score) bestByName.set(key, r);
        });

        const deduped = Array.from(bestByName.values());

        return deduped
            .sort((a, b) => b.score - a.score)
            .slice(0, config.MAX_RESULTS)
            .map(result => result.club);
    }

    // Return all matching clubs without applying MAX_RESULTS truncation
    searchClubsAll(query) {
        // Full club search without truncation. This method is intentionally
        // kept minimal because the main `searchClubs` satisfies bot needs.
        return this.searchClubs(query);
    }

    // Return the full list of clubs (sorted by name) for browsing without truncation
    getAllClubs() {
        // Return sorted clubs; retained as a small wrapper used for browsing
        return this.clubs.slice().sort((a, b) => ((a['Name of it '] || '').toString().localeCompare((b['Name of it '] || '').toString())));
    }

    formatClubInfo(club) {
        const email = club['The email'] && club['The email'] !== 'N/A' ? 
            `📧 **Email:** [${club['The email']}](mailto:${club['The email']})` : 
            '📧 **Email:** Not available';
            
        const instagram = club['Instagram account link'] && club['Instagram account link'] !== 'N/A' ? 
            `📱 **Instagram:** [Follow us](${club['Instagram account link']})` : 
            '📱 **Instagram:** Not available';

        return `🎯 *${club['Name of it ']}*

🏷️ **Type:** ${club['Club/ Volunteer team']}
${email}
${instagram}

📝 **About:**
${club['What is yours club or volunteer team about ?'] || 'No description available'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    formatClubSearchResults(results, query) {
        if (results.length === 0) {
            // Get smart suggestions for clubs
            const suggestions = this.getClubSuggestions(query);
            
            let message = `😔 **No clubs/teams found for "${query}"**\n\n`;
            
            if (suggestions.length > 0) {
                message += `🤔 **Did you mean:**\n`;
                suggestions.forEach(suggestion => {
                    message += `• "${suggestion}"\n`;
                });
                message += `\n`;
            }
            
            message += `💡 **Search Tips:**\n`;
            message += `• Search by name: "Entrepreneurship"\n`;
            message += `• Search by type: "Volunteer team"\n`;
            message += `• Search by activity: "programming"\n`;
            message += `• Use /clubs to browse all clubs and teams\n`;
            message += `• Use /randomclub for a surprise! 🎲`;
            
            return message;
        }

        let message = `🎉 **Found ${results.length} club${results.length === 1 ? '' : 's'}/team${results.length === 1 ? '' : 's'} for "${query}"**\n\n`;

        results.forEach((club, index) => {
            message += `${index + 1}. 🎯 **${club['Name of it ']}**\n`;
            message += `   🏷️ ${club['Club/ Volunteer team']}\n`;
            if (club['The email'] && club['The email'] !== 'N/A') {
                message += `   📧 [${club['The email']}](mailto:${club['The email']})\n`;
            }
            message += `\n`;
        });

        message += `💡 **Tip:** Click any number above for full details!`;
        return message;
    }

    // Get smart suggestions for club searches
    getClubSuggestions(query) {
        const suggestions = [];
        const queryLower = query.toLowerCase();
        
        // Check for similar club names
        this.clubs.forEach(club => {
            const clubName = club['Name of it '];
            if (clubName && this.calculateSimilarity(clubName.toLowerCase(), queryLower) > 0.6) {
                suggestions.push(clubName);
            }
        });
        
        // Check for similar club types
        const clubTypes = [...new Set(this.clubs.map(c => c['Club/ Volunteer team']))];
        clubTypes.forEach(type => {
            if (this.calculateSimilarity(type.toLowerCase(), queryLower) > 0.6) {
                suggestions.push(type);
            }
        });
        
        // Check for common club-related terms
        const commonTerms = {
            'tech': 'Technology Club',
            'programming': 'Programming Club',
            'coding': 'Programming Club',
            'volunteer': 'Volunteer team',
            'sports': 'Sports Club',
            'art': 'Art Club',
            'music': 'Music Club',
            'drama': 'Drama team',
            'debate': 'Debate Club',
            'chess': 'Chess Club'
        };
        
        Object.entries(commonTerms).forEach(([term, suggestion]) => {
            if (queryLower.includes(term)) {
                suggestions.push(suggestion);
            }
        });
        
        return [...new Set(suggestions)].slice(0, 3); // Remove duplicates and limit to 3
    }

    getRandomDoctor() {
        // Random selection utility was removed from public usage; keep lightweight
        if (!this.doctors || this.doctors.length === 0) return null;
        return this.doctors[Math.floor(Math.random() * this.doctors.length)];
    }

    getRandomClub() {
        if (!this.clubs || this.clubs.length === 0) return null;
        return this.clubs[Math.floor(Math.random() * this.clubs.length)];
    }

    getBuildingGuide() {
        if (!this.nameSystem.legend) return 'Building information not available.';
        
        let message = `🏢 *HTU Campus Buildings*\n\n`;
        
        Object.entries(this.nameSystem.legend).forEach(([code, info]) => {
            message += `**${code}** - ${info.name}\n`;
            message += `   🏷️ ${info.nickname || 'No nickname'}\n`;
            message += `   🎨 ${info.color || 'No color specified'}\n\n`;
        });

        message += `📖 *How to read room codes:*\n`;
        message += `• Letter = Building\n`;
        message += `• First digit = Floor\n`;
        message += `• Last digits = Room\n\n`;

        if (this.nameSystem.examples && this.nameSystem.examples.length > 0) {
            message += `📚 *Examples:*\n`;
            this.nameSystem.examples.forEach(example => {
                message += `• ${example.code} → ${example.building}\n`;
                message += `   📍 Floor: ${example.floor}, Room: ${example.room}\n\n`;
            });
        }

        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        return message;
    }

    getStats() {
        const totalDoctors = this.doctors.length;
        const departments = this.departments.length;
        const totalClubs = this.clubs.length;
        const clubTypes = [...new Set(this.clubs.map(c => c['Club/ Volunteer team']))].length;
        const withOfficeHours = this.doctors.filter(d => d.office_hours && Object.keys(d.office_hours).length > 0).length;
        const withOffice = this.doctors.filter(d => d.office && d.office.trim()).length;

        return {
            totalDoctors,
            departments,
            totalClubs,
            clubTypes,
            withOfficeHours,
            withOffice
        };
    }

    // Utility method to detect duplicates in clubs data
    detectDuplicates() {
        // Duplicate detection helper retained but simplified for maintainability
        const counts = new Map();
        const duplicates = [];
        this.clubs.forEach((club, idx) => {
            const name = (club['Name of it '] || '').toString().trim();
            const prev = counts.get(name) || [];
            prev.push(idx);
            counts.set(name, prev);
        });
        counts.forEach((indices, name) => {
            if (indices.length > 1) duplicates.push({ name, indices, count: indices.length });
        });
        return duplicates;
    }

    // Method to validate club data integrity
    validateClubData() {
        // Basic validation retained; not used by bot runtime but available for devs
        const issues = [];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        this.clubs.forEach((club, index) => {
            if (!club['Club/ Volunteer team']) issues.push(`Club at index ${index}: Missing "Club/ Volunteer team" field`);
            if (!club['Name of it ']) issues.push(`Club at index ${index}: Missing "Name of it" field`);
            if (!club['What is yours club or volunteer team about ?'] || club['What is yours club or volunteer team about ?'].trim() === '') {
                issues.push(`Club "${club['Name of it '] || '<unknown>'}" at index ${index}: Empty description`);
            }
            if (club['The email'] && club['The email'] !== 'N/A' && !emailRegex.test(club['The email'])) {
                issues.push(`Club "${club['Name of it '] || '<unknown>'}" at index ${index}: Invalid email format`);
            }
        });
        return issues;
    }

    // ===== Fun utilities =====
    flipCoin() {
        const isHeads = Math.random() < 0.5;
        return {
            result: isHeads ? 'Heads' : 'Tails',
            emoji: isHeads ? '🪙' : '💰',
            message: `🪙 Coin flip: ${isHeads ? '*Heads*' : '*Tails*'}!`
        };
    }

    rollDice() {
        const value = 1 + Math.floor(Math.random() * 6);
        const diceEmojis = ['⚀','⚁','⚂','⚃','⚄','⚅'];
        return {
            value,
            emoji: diceEmojis[value - 1],
            message: `🎲 Dice roll: *${value}* ${diceEmojis[value - 1]}`
        };
    }

    eightBall(question) {
        const answers = [
            'It is certain', 'Without a doubt', 'You may rely on it', 'Yes – definitely',
            'As I see it, yes', 'Most likely', 'Outlook good', 'Yes',
            'Reply hazy, try again', 'Ask again later', 'Better not tell you now',
            'Cannot predict now', 'Concentrate and ask again',
            "Don't count on it", 'My reply is no', 'My sources say no',
            'Outlook not so good', 'Very doubtful'
        ];
        const pick = answers[Math.floor(Math.random() * answers.length)];
        const safeQ = (question || '').trim();
        const qLine = safeQ ? `"${safeQ}"` : 'your question';
        return {
            answer: pick,
            message: `🎱 8-ball says: *${pick}*\n_Q:_ ${qLine}`
        };
    }

    // Generate a quick multiple-choice quiz about departments or buildings
    generateQuizQuestion() {
        const quizTypes = ['department_count', 'building_prefix', 'doctor_department'];
        const chosen = quizTypes[Math.floor(Math.random() * quizTypes.length)];

        if (chosen === 'department_count') {
            // Ask: How many departments exist?
            const correct = this.departments.length;
            // Create nearby options
            const options = new Set([correct]);
            while (options.size < 4) {
                const delta = Math.floor(Math.random() * 5) + 1; // 1..5
                const sign = Math.random() < 0.5 ? -1 : 1;
                const candidate = Math.max(1, correct + sign * delta);
                options.add(candidate);
            }
            const shuffled = Array.from(options).sort(() => Math.random() - 0.5);
            const correctIndex = shuffled.indexOf(correct);
            return {
                type: 'department_count',
                question: '📚 How many departments are listed in HTU data?',
                options: shuffled.map(n => `${n}`),
                correctIndex
            };
        }

        if (chosen === 'building_prefix' && this.nameSystem && this.nameSystem.legend) {
            const entries = Object.entries(this.nameSystem.legend);
            if (entries.length >= 3) {
                const [correctCode, info] = entries[Math.floor(Math.random() * entries.length)];
                // Wrong options from other codes
                const wrongs = entries
                    .filter(([code]) => code !== correctCode)
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 3)
                    .map(([code]) => code);
                const options = [correctCode, ...wrongs].sort(() => Math.random() - 0.5);
                const correctIndex = options.indexOf(correctCode);
                return {
                    type: 'building_prefix',
                    question: `🏢 Which building code matches "${info.name}"?`,
                    options,
                    correctIndex
                };
            }
        }

        // doctor_department fallback
        if (this.doctors.length > 0) {
            const doctor = this.doctors[Math.floor(Math.random() * this.doctors.length)];
            const correctDept = doctor.department || 'Unknown';
            const distractors = this.departments
                .filter(d => d !== correctDept)
                .sort(() => Math.random() - 0.5)
                .slice(0, 3);
            const options = [correctDept, ...distractors].sort(() => Math.random() - 0.5);
            const correctIndex = options.indexOf(correctDept);
            return {
                type: 'doctor_department',
                question: `👨‍🏫 Which department is ${doctor.name} in?`,
                options,
                correctIndex
            };
        }

        // Safe fallback generic
        const genericOptions = ['Yes', 'No', 'Maybe', 'Not sure'];
        const idx = Math.floor(Math.random() * 4);
        return {
            type: 'generic',
            question: '❓ Just for fun: pick one!',
            options: genericOptions,
            correctIndex: idx
        };
    }

    verifyQuizAnswer(quiz, chosenIndex) {
        const isCorrect = Number(chosenIndex) === Number(quiz.correctIndex);
        return {
            correct: isCorrect,
            message: isCorrect ? '✅ Correct! Nice one!'
                               : `❌ Not quite. The right answer was: *${quiz.options[quiz.correctIndex]}*`
        };
    }

    // ===== Natural Language Processing =====
    
    // Parse natural language questions and extract intent + entities
    parseNaturalLanguageQuery(query) {
        const normalizedQuery = query.toLowerCase().trim();
        
        // Question patterns for different intents
        const patterns = {
            officeHours: [
                /(?:what are?|when are?|tell me about).*(office hours?|hours?|schedule).*(of|for)\s+(.+)/,
                /(?:office hours?|hours?|schedule).*(of|for)\s+(.+)/,
                /when (?:is|does|can i (?:find|see|meet))\s+(.+)\s*(?:available|in office|at office)?/,
                /(.+)\s+(?:office hours?|hours?|schedule)/
            ],
            contactInfo: [
                /(?:what is?|give me|tell me).*(email|contact|phone).*(of|for)\s+(.+)/,
                /(?:email|contact|phone).*(of|for)\s+(.+)/,
                /how (?:can i|do i) (?:contact|reach|email)\s+(.+)/,
                /(.+)\s+(?:email|contact|phone)/
            ],
            officeLocation: [
                /(?:where is?|what is?).*(office|room|location).*(of|for)\s+(.+)/,
                /(?:office|room|location).*(of|for)\s+(.+)/,
                /where (?:can i find|is)\s+(.+)(?:\s+located|\s+office)?/,
                /(.+)\s+(?:office|room|location)/
            ],
            department: [
                /(?:what|which)\s+(?:department|school|faculty).*(is|does)\s+(.+)\s+(?:in|work|belong|teach)/,
                /(.+)\s+(?:department|school|faculty)/,
                /(?:department|school|faculty).*(of|for)\s+(.+)/
            ],
            whoIs: [
                /who is\s+(.+)/,
                /tell me about\s+(.+)/,
                /(?:what|who)\s+(?:is|are)\s+(.+)/
            ],
            admission: [
                /(?:who is?|where is?|what is?).*(admission|admissions?|enrollment).*(office|department|contact)?/,
                /(?:admission|admissions?|enrollment).*(office|department|contact|info|information)/,
                /how (?:can i|do i).*(apply|enroll|admit|admission)/
            ],
            registrar: [
                /(?:who is?|where is?|what is?).*(registrar|registration|academic records?).*(office|department|contact)?/,
                /(?:registrar|registration|academic records?).*(office|department|contact|info)/
            ],
            dean: [
                /(?:who is?).*(dean|head).*(of|for)?\s*(.+)?/,
                /(.+)\s+(?:dean|head)/
            ]
        };

        // Try to match patterns and extract entities
        for (const [intent, intentPatterns] of Object.entries(patterns)) {
            for (const pattern of intentPatterns) {
                const match = normalizedQuery.match(pattern);
                if (match) {
                    // Extract the entity (person name, department, etc.)
                    let entity = '';
                    if (match.length >= 2) {
                        // Get the captured group that contains the entity
                        entity = match[match.length - 1] || match[1] || '';
                        entity = entity.trim().replace(/[?.,!]/g, '');
                    }
                    
                    return {
                        intent,
                        entity,
                        confidence: 0.8,
                        originalQuery: query
                    };
                }
            }
        }

        // If no specific pattern matches, try to detect general question words
        if (normalizedQuery.includes('what') || normalizedQuery.includes('who') || 
            normalizedQuery.includes('where') || normalizedQuery.includes('when') ||
            normalizedQuery.includes('how')) {
            return {
                intent: 'question',
                entity: normalizedQuery.replace(/^(what|who|where|when|how)\s+(is|are|can|do|does)\s*/, ''),
                confidence: 0.6,
                originalQuery: query
            };
        }

        return null; // No natural language pattern detected
    }

    // Process natural language queries and provide intelligent responses
    processNaturalLanguageQuery(query) {
        const parsed = this.parseNaturalLanguageQuery(query);
        if (!parsed) return null;

        const { intent, entity } = parsed;
        
        // Search for the entity in our data
        const doctorResults = entity ? this.search(entity) : [];
        const clubResults = entity ? this.searchClubs(entity) : [];

        switch (intent) {
            case 'officeHours':
                return this.handleOfficeHoursQuery(entity, doctorResults);
            
            case 'contactInfo':
                return this.handleContactInfoQuery(entity, doctorResults, clubResults);
            
            case 'officeLocation':
                return this.handleOfficeLocationQuery(entity, doctorResults);
            
            case 'department':
                return this.handleDepartmentQuery(entity, doctorResults);
            
            case 'whoIs':
                return this.handleWhoIsQuery(entity, doctorResults, clubResults);
            
            case 'admission':
                return this.handleAdmissionQuery();
            
            case 'registrar':
                return this.handleRegistrarQuery();
            
            case 'dean':
                return this.handleDeanQuery(entity);
            
            case 'question':
                return this.handleGeneralQuestion(entity, doctorResults, clubResults);
            
            default:
                return null;
        }
    }

    handleOfficeHoursQuery(entity, doctorResults) {
        if (doctorResults.length === 0) {
            return {
                response: `😔 I couldn't find "${entity}" in our faculty database.\n\n💡 **Try:**\n• Check the spelling\n• Use just the first name\n• Use /departments to browse by department`,
                hasResults: false
            };
        }

        if (doctorResults.length === 1) {
            const doctor = doctorResults[0];
            let response = `⏰ **Office Hours for ${doctor.name}:**\n\n`;
            
            if (doctor.office_hours && Object.keys(doctor.office_hours).length > 0) {
                Object.entries(doctor.office_hours).forEach(([day, hours]) => {
                    response += `📅 **${day}:** ${hours}\n`;
                });
                
                if (doctor.office) {
                    const officeInfo = this.formatOfficeLocation(doctor.office);
                    response += `\n${officeInfo}\n`;
                }
                
                response += `\n📧 **Contact:** [${doctor.email}](mailto:${doctor.email})`;
            } else {
                response += `📅 Office hours are not specified for ${doctor.name}.\n\n`;
                response += `📧 **Contact:** [${doctor.email}](mailto:${doctor.email})\n`;
                if (doctor.office) {
                    response += `🏢 **Office:** ${doctor.office}`;
                }
            }
            
            return { response, hasResults: true, singleResult: doctor };
        }

        // Multiple results
        let response = `⏰ **Office Hours Results for "${entity}":**\n\n`;
        doctorResults.slice(0, 3).forEach((doctor, index) => {
            response += `${index + 1}. **${doctor.name}** (${doctor.department})\n`;
            if (doctor.office_hours && Object.keys(doctor.office_hours).length > 0) {
                response += `   ⏰ Has office hours listed\n`;
            } else {
                response += `   ⏰ Office hours not specified\n`;
            }
            response += `   📧 [${doctor.email}](mailto:${doctor.email})\n\n`;
        });
        
        if (doctorResults.length > 3) {
            response += `... and ${doctorResults.length - 3} more results.\n\n`;
        }
        
        response += `💡 **Tip:** Click on any result above for complete office hours.`;
        
        return { response, hasResults: true, multipleResults: doctorResults };
    }

    handleContactInfoQuery(entity, doctorResults, clubResults) {
        if (doctorResults.length === 0 && clubResults.length === 0) {
            return {
                response: `😔 I couldn't find contact information for "${entity}".\n\n💡 **Try:**\n• Check the spelling\n• Search for a department or club name\n• Use /departments or /clubs to browse`,
                hasResults: false
            };
        }

        let response = `📧 **Contact Information for "${entity}":**\n\n`;

        if (doctorResults.length > 0) {
            response += `👨‍🏫 **Faculty Members:**\n`;
            doctorResults.slice(0, 3).forEach((doctor, index) => {
                response += `${index + 1}. **${doctor.name}**\n`;
                response += `   📧 [${doctor.email}](mailto:${doctor.email})\n`;
                response += `   📚 ${doctor.department}\n`;
                if (doctor.office) {
                    response += `   🏢 ${doctor.office}\n`;
                }
                response += `\n`;
            });
        }

        if (clubResults.length > 0) {
            if (doctorResults.length > 0) response += `\n`;
            response += `🎯 **Clubs & Organizations:**\n`;
            clubResults.slice(0, 3).forEach((club, index) => {
                response += `${index + 1}. **${club['Name of it ']}**\n`;
                if (club['The email'] && club['The email'] !== 'N/A') {
                    response += `   📧 [${club['The email']}](mailto:${club['The email']})\n`;
                }
                if (club['Instagram account link'] && club['Instagram account link'] !== 'N/A') {
                    response += `   📱 [Instagram](${club['Instagram account link']})\n`;
                }
                response += `   🏷️ ${club['Club/ Volunteer team']}\n\n`;
            });
        }

        return { response, hasResults: true, doctorResults, clubResults };
    }

    handleOfficeLocationQuery(entity, doctorResults) {
        if (doctorResults.length === 0) {
            return {
                response: `😔 I couldn't find office location for "${entity}".\n\n💡 **Try:**\n• Check the spelling\n• Use just the first name\n• Use /buildings for campus map`,
                hasResults: false
            };
        }

        if (doctorResults.length === 1) {
            const doctor = doctorResults[0];
            let response = `🏢 **Office Location for ${doctor.name}:**\n\n`;
            
            if (doctor.office) {
                const officeInfo = this.formatOfficeLocation(doctor.office);
                response += `${officeInfo}\n\n`;
                
                // Add building guide if available
                const buildingInfo = this.getBuildingInfo(doctor.office);
                if (buildingInfo) {
                    response += `🗺️ **Building Guide:**\n`;
                    response += `📍 Building: ${buildingInfo.name}\n`;
                    response += `🏷️ Also known as: ${buildingInfo.nickname}\n`;
                    if (buildingInfo.color) {
                        response += `🎨 Color: ${buildingInfo.color}\n`;
                    }
                }
            } else {
                response += `📍 Office location is not specified for ${doctor.name}.\n`;
            }
            
            response += `\n📧 **Contact:** [${doctor.email}](mailto:${doctor.email})\n`;
            response += `📚 **Department:** ${doctor.department}`;
            
            return { response, hasResults: true, singleResult: doctor };
        }

        // Multiple results
        let response = `🏢 **Office Locations for "${entity}":**\n\n`;
        doctorResults.slice(0, 3).forEach((doctor, index) => {
            response += `${index + 1}. **${doctor.name}**\n`;
            response += `   📚 ${doctor.department}\n`;
            if (doctor.office) {
                response += `   🏢 ${doctor.office}\n`;
            } else {
                response += `   🏢 Office not specified\n`;
            }
            response += `   📧 [${doctor.email}](mailto:${doctor.email})\n\n`;
        });
        
        return { response, hasResults: true, multipleResults: doctorResults };
    }

    handleDepartmentQuery(entity, doctorResults) {
        if (doctorResults.length === 0) {
            // Maybe they're asking about a department directly
            const deptMatch = this.departments.find(dept => 
                dept.toLowerCase().includes(entity.toLowerCase()) ||
                entity.toLowerCase().includes(dept.toLowerCase())
            );
            
            if (deptMatch) {
                const deptFaculty = this.searchByDepartment(deptMatch);
                let response = `📚 **${deptMatch} Department:**\n\n`;
                response += `👥 **Faculty Members (${deptFaculty.length}):**\n\n`;
                
                deptFaculty.slice(0, 5).forEach((doctor, index) => {
                    response += `${index + 1}. **${doctor.name}**\n`;
                    response += `   📧 [${doctor.email}](mailto:${doctor.email})\n`;
                    if (doctor.office) {
                        response += `   🏢 ${doctor.office}\n`;
                    }
                    response += `\n`;
                });
                
                if (deptFaculty.length > 5) {
                    response += `... and ${deptFaculty.length - 5} more faculty members.\n\n`;
                }
                
                response += `💡 **Tip:** Type any faculty name for detailed information.`;
                
                return { response, hasResults: true, departmentInfo: { name: deptMatch, faculty: deptFaculty } };
            }
            
            return {
                response: `😔 I couldn't find department information for "${entity}".\n\n💡 **Try:**\n• Use /departments to see all departments\n• Search for a specific faculty member`,
                hasResults: false
            };
        }

        if (doctorResults.length === 1) {
            const doctor = doctorResults[0];
            let response = `📚 **Department Information for ${doctor.name}:**\n\n`;
            response += `🏫 **School:** ${doctor.school || 'Not specified'}\n`;
            response += `📚 **Department:** ${doctor.department}\n\n`;
            
            // Find other faculty in the same department
            const colleagues = this.searchByDepartment(doctor.department)
                .filter(d => d.name !== doctor.name)
                .slice(0, 3);
            
            if (colleagues.length > 0) {
                response += `👥 **Other faculty in ${doctor.department}:**\n`;
                colleagues.forEach((colleague, index) => {
                    response += `${index + 1}. ${colleague.name}\n`;
                });
                response += `\n`;
            }
            
            response += `📧 **Contact ${doctor.name}:** [${doctor.email}](mailto:${doctor.email})`;
            
            return { response, hasResults: true, singleResult: doctor, colleagues };
        }

        // Multiple results
        let response = `📚 **Department Information for "${entity}":**\n\n`;
        doctorResults.slice(0, 3).forEach((doctor, index) => {
            response += `${index + 1}. **${doctor.name}**\n`;
            response += `   📚 ${doctor.department}\n`;
            response += `   🏫 ${doctor.school || 'School not specified'}\n`;
            response += `   📧 [${doctor.email}](mailto:${doctor.email})\n\n`;
        });
        
        return { response, hasResults: true, multipleResults: doctorResults };
    }

    handleWhoIsQuery(entity, doctorResults, clubResults) {
        if (doctorResults.length === 0 && clubResults.length === 0) {
            return {
                response: `🤔 I don't have information about "${entity}" in our database.\n\n💡 **Try:**\n• Check the spelling\n• Search for a faculty member or club\n• Use /departments or /clubs to browse`,
                hasResults: false
            };
        }

        if (doctorResults.length === 1 && clubResults.length === 0) {
            // Single doctor result - provide full info
            return { response: this.formatDoctorInfo(doctorResults[0]), hasResults: true, singleResult: doctorResults[0] };
        }

        if (clubResults.length === 1 && doctorResults.length === 0) {
            // Single club result - provide full info
            return { response: this.formatClubInfo(clubResults[0]), hasResults: true, singleResult: clubResults[0] };
        }

        // Multiple results or mixed results
        let response = `👥 **Here's what I found about "${entity}":**\n\n`;

        if (doctorResults.length > 0) {
            response += `👨‍🏫 **Faculty Members:**\n`;
            doctorResults.slice(0, 2).forEach((doctor, index) => {
                response += `${index + 1}. **${doctor.name}**\n`;
                response += `   📚 ${doctor.department}\n`;
                response += `   📧 [${doctor.email}](mailto:${doctor.email})\n\n`;
            });
        }

        if (clubResults.length > 0) {
            if (doctorResults.length > 0) response += `\n`;
            response += `🎯 **Clubs & Organizations:**\n`;
            clubResults.slice(0, 2).forEach((club, index) => {
                response += `${index + 1}. **${club['Name of it ']}**\n`;
                response += `   🏷️ ${club['Club/ Volunteer team']}\n`;
                if (club['The email'] && club['The email'] !== 'N/A') {
                    response += `   📧 [${club['The email']}](mailto:${club['The email']})\n`;
                }
                response += `\n`;
            });
        }

        response += `💡 **Tip:** Click any result for complete details.`;

        return { response, hasResults: true, doctorResults, clubResults };
    }

    handleAdmissionQuery() {
        // Look for admission-related staff
        const admissionKeywords = ['admission', 'admissions', 'enrollment', 'student affairs', 'registrar'];
        let admissionStaff = [];
        
        for (const keyword of admissionKeywords) {
            const results = this.search(keyword);
            admissionStaff = admissionStaff.concat(results);
        }
        
        // Remove duplicates
        const uniqueStaff = admissionStaff.filter((staff, index, self) => 
            index === self.findIndex(s => s.email === staff.email)
        );

        let response = `🎓 **Admission Information:**\n\n`;
        
        if (uniqueStaff.length > 0) {
            response += `📞 **Contact Admission Office:**\n`;
            uniqueStaff.slice(0, 3).forEach((staff, index) => {
                response += `${index + 1}. **${staff.name}**\n`;
                response += `   📚 ${staff.department}\n`;
                response += `   📧 [${staff.email}](mailto:${staff.email})\n`;
                if (staff.office) {
                    response += `   🏢 ${staff.office}\n`;
                }
                if (staff.office_hours && Object.keys(staff.office_hours).length > 0) {
                    response += `   ⏰ Has office hours available\n`;
                }
                response += `\n`;
            });
        } else {
            response += `📞 **General Contact:**\n`;
            response += `For admission inquiries, you can:\n`;
            response += `• Visit the main administration office\n`;
            response += `• Check the university website\n`;
            response += `• Call the main university number\n\n`;
        }
        
        response += `💡 **Tip:** You can also search for "student affairs" or specific department names.`;
        
        return { response, hasResults: uniqueStaff.length > 0, results: uniqueStaff };
    }

    handleRegistrarQuery() {
        const registrarResults = this.search('registrar');
        const academicResults = this.search('academic records');
        const allResults = [...registrarResults, ...academicResults];
        
        // Remove duplicates
        const uniqueResults = allResults.filter((result, index, self) => 
            index === self.findIndex(r => r.email === result.email)
        );

        let response = `📋 **Registrar Information:**\n\n`;
        
        if (uniqueResults.length > 0) {
            response += `📞 **Contact Registrar Office:**\n`;
            uniqueResults.slice(0, 3).forEach((staff, index) => {
                response += `${index + 1}. **${staff.name}**\n`;
                response += `   📚 ${staff.department}\n`;
                response += `   📧 [${staff.email}](mailto:${staff.email})\n`;
                if (staff.office) {
                    response += `   🏢 ${staff.office}\n`;
                }
                response += `\n`;
            });
        } else {
            response += `📞 **General Information:**\n`;
            response += `For registrar services (transcripts, enrollment verification, etc.):\n`;
            response += `• Visit the student services office\n`;
            response += `• Check with your academic advisor\n`;
            response += `• Contact the main administration\n\n`;
        }
        
        response += `💡 **Tip:** The registrar handles transcripts, enrollment verification, and academic records.`;
        
        return { response, hasResults: uniqueResults.length > 0, results: uniqueResults };
    }

    handleDeanQuery(entity) {
        const deanResults = this.search(`dean ${entity}`);
        const headResults = this.search(`head ${entity}`);
        const allResults = [...deanResults, ...headResults];
        
        // Also search for the entity alone in case dean is in their title
        if (entity) {
            const entityResults = this.search(entity);
            allResults.push(...entityResults.filter(r => 
                r.name.toLowerCase().includes('dean') || 
                r.department.toLowerCase().includes('dean') ||
                r.name.toLowerCase().includes('head')
            ));
        }
        
        // Remove duplicates
        const uniqueResults = allResults.filter((result, index, self) => 
            index === self.findIndex(r => r.email === result.email)
        );

        let response = entity ? 
            `👨‍💼 **Dean/Head Information for "${entity}":**\n\n` :
            `👨‍💼 **Dean Information:**\n\n`;
        
        if (uniqueResults.length > 0) {
            uniqueResults.slice(0, 3).forEach((person, index) => {
                response += `${index + 1}. **${person.name}**\n`;
                response += `   📚 ${person.department}\n`;
                response += `   🏫 ${person.school || 'School not specified'}\n`;
                response += `   📧 [${person.email}](mailto:${person.email})\n`;
                if (person.office) {
                    response += `   🏢 ${person.office}\n`;
                }
                response += `\n`;
            });
        } else {
            response += `😔 I couldn't find specific dean information`;
            if (entity) response += ` for "${entity}"`;
            response += `.\n\n💡 **Try:**\n• Search for a specific department name\n• Use /departments to browse all departments\n• Search for "administration" or "director"`;
        }
        
        return { response, hasResults: uniqueResults.length > 0, results: uniqueResults };
    }

    handleGeneralQuestion(entity, doctorResults, clubResults) {
        // This handles general questions that didn't match specific patterns
        if (doctorResults.length > 0 || clubResults.length > 0) {
            return this.handleWhoIsQuery(entity, doctorResults, clubResults);
        }
        
        // Try to provide helpful suggestions
        let response = `🤔 I'm not sure about "${entity}", but I can help you with:\n\n`;
        response += `🔍 **Search for:**\n`;
        response += `• Faculty names: "Dr. Mohammad"\n`;
        response += `• Departments: "Computer Science"\n`;
        response += `• Clubs: "Programming Club"\n`;
        response += `• Office locations: "S-321"\n\n`;
        response += `❓ **Ask questions like:**\n`;
        response += `• "What are the office hours of [name]?"\n`;
        response += `• "Who is the dean of engineering?"\n`;
        response += `• "Where is the admission office?"\n`;
        response += `• "How can I contact [name]?"\n\n`;
        response += `💡 **Quick actions:** Use /help for more options.`;
        
        return { response, hasResults: false };
    }
}

module.exports = {
    HTUAssistant,
    escapeMarkdown,
    ensureDirForFile
};