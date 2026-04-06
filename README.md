# Visual World History

An interactive world history map that visualizes thousands of historical events on a Leaflet-powered map with a draggable timeline slider spanning from 10,000 BC to 2000 AD.

## Features

- **Interactive map** with animated dots representing historical events, color-coded by category (Empire, War, Civilization, Discovery, Religion, Cultural, Trade)
- **Timeline slider** built on HTML5 Canvas — drag to change the year and watch events appear/disappear
- **Event details panel** with summaries, image galleries, key figures, and cross-links between related events
- **Hierarchy view** for exploring parent-child event relationships (e.g., Roman Empire > Punic Wars > Battle of Zama)
- **Territory overlays** showing approximate borders of major empires via GeoJSON
- **User accounts** with commenting and favorites
- **Granularity filtering** — toggle between major, notable, and detailed events
- **2,250+ events** with curated summaries and Wikimedia images

## Stack

- **Frontend**: Vanilla JS (ES6 modules), Leaflet.js, Canvas timeline — no build step
- **Backend**: PHP 8.2 + Slim Framework 4
- **Database**: MySQL / MariaDB
- **Deployment**: Shared hosting via FTP

## Getting Started

1. Set up a MySQL/MariaDB database named `worldhistory`
2. Copy `src/config.local.php.example` to `src/config.local.php` and set your DB credentials
3. Import the seed data:
   ```bash
   mysql -u <user> -p <password> -h 127.0.0.1 worldhistory < database/seed_events.sql
   mysql -u <user> -p <password> -h 127.0.0.1 worldhistory < database/seed_details_v2.sql
   ```
4. Start a PHP dev server:
   ```bash
   php -S localhost:8081 -t public
   ```
5. Open `http://localhost:8081`

## Data Pipeline

Event data lives in `database/events-registry.json` (master list) and per-event JSON files in `database/content/`. The SQL is generated from these sources.
