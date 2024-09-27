# Grenadine Event Scraper

## Overview

This project is a web scraper designed to extract event and speaker information from the Grenadine Conference Management Site. It uses Puppeteer for web scraping and MongoDB (via Mongoose) for data storage. The scraper collects detailed information about conference sessions, speakers, and their relationships.

## Features

- Scrapes event details including session title, description, time, and location
- Extracts speaker information including biography and social media links
- Stores data in MongoDB with proper relationships between events and speakers
- Handles duplicate entries and updates existing information
- Provides functions for database operations (insertion and wiping)
- Uses environment variables for configuration

## Prerequisites

- Node.js (v12 or higher recommended)
- MongoDB (v4.0 or higher)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/STLCajun/Grendadine-Scraper.git
   cd Grenadine-Scraper
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up MongoDB:
    - Ensure MongoDB is running on your system

4. Set up environment variables:
    - Copy the `.env.example` file to `.env`
    - Update the values in `.env` to match your environment

## Usage

To run the scraper:

```
node scrape.js
```

This will:
1. Load configuration from the .env file
2. Wipe existing data from the database
3. Scrape calendar events from the Archon47 website
4. Process events based on the EVENTS_TO_PROCESS setting
5. Scrape detailed information for each event and its speakers
6. Insert the collected data into MongoDB

## Configuration

Configuration is managed through the `.env` file. Here are the available options:

- `MONGODB_URI`: MongoDB connection string
- `BASE_URL`: Base URL of the Archon47 website
- `EVENTS_TO_PROCESS`: Number of events to process
- `HEADLESS`: Whether to run Puppeteer in headless mode (true/false)
- `DELAY_BETWEEN_SPEAKERS`: Delay in milliseconds between processing speakers
- `DELAY_BETWEEN_EVENTS`: Delay in milliseconds between processing events

## Data Models

(Data models section remains the same)

## Functions

(Functions section remains the same)

## Error Handling

(Error handling section remains the same)

## Limitations

(Limitations section remains the same)

## Contributing

Contributions to improve the scraper or extend its functionality are welcome. Please submit a pull request or open an issue to discuss proposed changes.

## License

[MIT License](LICENSE)

## Disclaimer

This scraper is for educational purposes only. Ensure you have permission to scrape the target website and comply with their terms of service and robots.txt file.