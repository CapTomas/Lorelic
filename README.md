<p align="center">
  <img src="images/app/platform_logo.svg" alt="Lorelic Logo" width="280"/>
</p>

<h1 align="center">Lorelic</h1>

<p align="center">
  <strong>An AI-Powered Interactive Narrative RPG Engine</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#themes">Themes</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white" alt="Express"/>
  <img src="https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma&logoColor=white" alt="Prisma"/>
  <img src="https://img.shields.io/badge/PostgreSQL-Database-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/Gemini-AI-8E75B2?style=flat-square&logo=google&logoColor=white" alt="Gemini AI"/>
</p>

---

## Overview

**Lorelic** is a sophisticated web-based interactive fiction platform that combines the depth of tabletop RPG mechanics with the power of generative AI. Players embark on unique narrative adventures across multiple thematic worlds, with an AI Game Master that dynamically responds to their choices, creating emergent stories that evolve based on player decisions.

The engine features persistent character progression, rich world-building systems, and a flexible theme architecture that allows for diverse narrative experiences—from gothic monster hunting to high-seas piracy and cosmic custodial adventures.

---

## Features

### 🎮 Core Gameplay
- **AI-Driven Narratives** — Powered by Google's Gemini models for dynamic, contextual storytelling
- **Persistent Character Progression** — Level up characters with XP, unlock traits, and build unique abilities
- **Multiple Playable Themes** — Each theme offers distinct settings, mechanics, and narrative tones
- **Dice Roll Integration** — Traditional TTRPG mechanics interpreted by the AI for consistent challenge resolution

### 📊 Character Systems
- **Four Core Attributes** — Integrity, Willpower, Aptitude, and Resilience govern all character interactions
- **Trait System** — Unlock and choose from theme-specific traits as you level up
- **Equipment & Inventory** — Theme-appropriate gear with static and consumable item types
- **Dynamic Conditions** — Temporary states that affect gameplay based on narrative events

### 🌍 World Building
- **World Shards** — Persistent lore fragments unlocked through gameplay that carry across sessions
- **Theme-Specific Dashboards** — Rich UI panels displaying objectives, relationships, and world state
- **Localization Support** — Full multi-language support for both UI and narrative content

### 👤 User Management
- **Tiered Access System** — Free, Pro, and Ultra tiers with configurable usage limits
- **Secure Authentication** — JWT-based auth with email confirmation and password reset
- **Cloud Save** — Automatic game state persistence across devices

---

## Themes

Lorelic ships with several distinct narrative themes:

| Theme | Setting | Tone |
|-------|---------|------|
| **Grim Warden** | Gothic monster hunting | Dark, atmospheric horror |
| **Salt Reavers** | Pirate adventures on cursed seas | Swashbuckling action |
| **Celestial Custodians** | Cosmic janitors in bizarre stations | Absurdist comedy |
| **Echo Sleuths** | Memory detectives in surreal mindscapes | Noir mystery |

Each theme includes:
- Custom configuration and mechanics
- Unique equipment slots and currency
- Theme-specific traits and progression
- Dedicated prompt systems and lore

---

## Getting Started

### Prerequisites

- **Node.js** 18.x or higher
- **PostgreSQL** database
- **Google AI API Key** (Gemini access)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/lorelic.git
   cd lorelic
   ```

2. **Install server dependencies**
   ```bash
   cd server
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file in the `server` directory:
   ```env
   # Database
   DATABASE_URL="postgresql://user:password@localhost:5432/lorelic"
   DIRECT_URL="postgresql://user:password@localhost:5432/lorelic"

   # Authentication
   JWT_SECRET="your-secure-jwt-secret"
   JWT_EXPIRES_IN="7d"

   # Google AI
   GEMINI_API_KEY="your-gemini-api-key"

   # Server
   PORT=3000
   NODE_ENV=development
   ALLOWED_ORIGINS="http://localhost:3000"
   ```

4. **Initialize the database**
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

5. **Start the server**
   ```bash
   npm start
   ```

6. **Access the application**

   Open `http://localhost:3000` in your browser.

### Development Mode

For hot-reloading during development:
```bash
npm run dev
```

---

## Architecture

```
lorelic/
├── index.html              # Main application entry point
├── style.css               # Global styles
├── js/
│   ├── app.js              # Application bootstrap
│   ├── core/               # Core services (API, config, state, logging)
│   ├── data/               # Static data and manifests
│   ├── game/               # Game controller logic
│   ├── services/           # Business logic (AI, auth, themes, localization)
│   └── ui/                 # UI managers and components
├── server/
│   ├── server.js           # Express server entry point
│   ├── config.js           # Server configuration
│   ├── middleware/         # Auth and rate limiting middleware
│   ├── routes/             # API route handlers
│   ├── utils/              # Helper utilities (dice, tokens, AI)
│   └── prisma/             # Database schema and migrations
├── themes/
│   ├── master/             # Base theme configuration
│   ├── grim_warden/        # Gothic monster hunting theme
│   ├── salt_reavers/       # Pirate adventure theme
│   ├── celestial_custodians/ # Cosmic comedy theme
│   └── echo_sleuths/       # Memory detective theme
└── images/                 # Application and theme assets
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vanilla JavaScript (ES Modules), CSS3 |
| **Backend** | Node.js, Express 5.x |
| **Database** | PostgreSQL with Prisma ORM |
| **AI Engine** | Google Gemini (Flash/Pro models) |
| **Authentication** | JWT with bcrypt password hashing |
| **Security** | Helmet.js, CORS, rate limiting |

---

## API Reference

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/auth/register` | POST | Create new user account |
| `/api/v1/auth/login` | POST | Authenticate user |
| `/api/v1/auth/confirm-email` | GET | Confirm email address |
| `/api/v1/auth/forgot-password` | POST | Request password reset |
| `/api/v1/auth/reset-password` | POST | Reset password with token |

### Game State

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/gamestates` | GET | Retrieve user's game states |
| `/api/v1/gamestates` | POST | Save current game state |
| `/api/v1/gamestates/:themeId` | DELETE | Delete game state for theme |

### AI Generation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/gemini/generate` | POST | Generate AI narrative response |

### World Shards

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/world-shards/:themeId` | GET | Get unlocked shards for theme |
| `/api/v1/world-shards` | POST | Save new world shard |

---

## Game Mechanics

### Attribute System

| Attribute | Base Value | Purpose |
|-----------|------------|---------|
| **Integrity** | 100 | Health/structural wholeness — reaching zero ends the game |
| **Willpower** | 50 | Resource pool for special abilities and extraordinary actions |
| **Aptitude** | 10 | Passive modifier improving action quality and success |
| **Resilience** | 10 | Defensive modifier reducing negative effect severity |

### Progression

- Characters earn **XP** by completing objectives and overcoming challenges
- Each level grants **1 Attribute Point** and a choice of **3 random Traits**
- Character progression persists across game sessions within each theme
- Equipment and currency reset each session for roguelike replayability

---

## Configuration

### Model Tiers

```javascript
// server/middleware/usageLimiter.js
FREE_MODEL  = 'gemini-2.5-flash-lite-preview-06-17'  // Free tier
PRO_MODEL   = 'gemini-2.5-flash'                     // Pro tier
ULTRA_MODEL = 'gemini-2.5-flash'                     // Ultra tier
```

### Theme Configuration

Each theme requires:
- `config.json` — Theme metadata, attributes, equipment slots
- `texts.json` — Localized strings for UI and narrative
- `prompts-config.json` — AI prompt templates and configurations
- `prompts/` — Detailed prompt files for the AI Game Master

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Creating New Themes

See the existing themes in the `themes/` directory as templates. Each theme requires:
- Complete `config.json` with attribute definitions and UI configurations
- Localized `texts.json` for all theme-specific strings
- AI prompt files tailored to the theme's narrative style
- Theme-specific images and icons

---

## License

This project is licensed under the ISC License. See the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- **Google Gemini** — Powering the AI narrative engine
- **Prisma** — Elegant database access and migrations
- **Express** — Fast, unopinionated web framework

---

<p align="center">
  <sub>Built with ❤️ for storytellers and adventurers</sub>
</p>
