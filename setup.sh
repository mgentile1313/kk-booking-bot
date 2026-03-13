#!/bin/bash
# Run this first to set up the project

mkdir -p solidcore-booker
cd solidcore-booker

# Initialize project
npm init -y

# Install dependencies
npm install playwright
npx playwright install chromium

echo "Setup complete. Run: node test-session.js"
