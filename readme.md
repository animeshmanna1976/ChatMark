# ChatMark

ChatMark is a Chrome extension that lets you highlight important text inside AI chat conversations. Select text in the chat, click the highlight button, and ChatMark saves it so you can find it again later.

## Features

- Highlight selected text in AI chat conversations
- Save highlights in browser local storage
- Restore saved highlights when you reload the page
- View and remove saved highlights from the extension popup
- Add comments to highlighted text

## Installation

1. Download the project as a ZIP file and extract it to a folder.
2. Open Chrome and go to chrome://extensions.
3. Turn on Developer mode.
4. Click Load unpacked.
5. Select the ChatMark project folder.
6. Open a supported AI chat site and start using the extension.

## Project Structure

- content.js - Handles text selection, toolbar display, highlighting, saving, and restoring
- styles.css - Styles for the toolbar and highlighted text
- popup/ - Popup UI for viewing and removing saved highlights
- background.js - Service worker entry point
- manifest.json - Chrome extension configuration


