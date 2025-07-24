# elb.gg Season of Scam Watch

![Scam Watch Logo](/logo.jpeg)

This project is a tool designed to monitor Twitch chats in real-time to identify and report potential scam messages and accounts. The backend identifies newly created, low-viewer channels, and the frontend provides an interface to view their chat rooms and take action against suspicious activity.

---

## ## Features

The core of this project is the `/scamwatch` page, which provides a powerful interface for monitoring and moderation.

* **Aggregated Live Feed**: View a combined chat from hundreds of monitored low-viewer Twitch channels in a single "All" tab.
* **Custom Filter Tabs**:
    * Create new tabs that filter the chat from a source tab (like "All") by a specific **keyword** or **username**.
    * Filter tabs update in real-time as new messages arrive.
    * Close tabs you no longer need.
* **Moderation & Reporting Tools**: Each message has quick-action buttons:
    * **🔗 (Link)**: Opens the user's Twitch channel in a new tab.
    * **🚩 (Flag & Copy)**: Copies the specific message content to your clipboard and opens that user's Twitch report page.
    * **📄 (Copy Chat Log)**: Copies a recent history of messages from the current tab to your clipboard (up to a 2000 character limit) and opens the user's report page.
    * **⚖️ (Copy Rules)**: Copies a pre-written rules message to your clipboard and opens the channel's stream page.

---

## ## Technical Overview

The application is built with a Node.js backend and a vanilla JavaScript frontend.

* **Backend (`index.js`)**:
    * Uses **Express** to serve the web pages and **Socket.IO** for real-time communication with the frontend.
    * Fetches live streams from the **Twitch API**, filtering for channels with 0-10 viewers and accounts created within the last 300 days.
    * Connects to up to **256** Twitch chat rooms simultaneously and anonymously using **TMI.js**.
    * A hashing function (`twitchUsernameToBigIntegerMod`) distributes channels evenly across the available TMI clients.
    * Forwards chat messages from all connected channels to the frontend via a `scamwatch` socket room.

* **Frontend (`scamwatch.html`)**:
    * Receives live chat data through a Socket.IO client.
    * Dynamically creates and manages the DOM to display messages and filter tabs without requiring page reloads.
    * Handles all user interactions for creating filters, switching tabs, and using the reporting tools.

---

## ## Getting Started

To run this project locally, follow these steps.

### ### Prerequisites

* Node.js and npm
* A Twitch Application for API credentials

### ### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/billysk8r/scamwatch.git
    cd scamwatch
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create an environment file:**
    * Create a new file in the root of the project named `.env`.
    * Add your Twitch Application credentials to it, as required by `index.js`.
    ```
    TWITCH_CLIENT_ID=your_twitch_client_id
    TWITCH_CLIENT_SECRET=your_twitch_client_secret
    ```

4.  **Run the server:**
    ```bash
    node index.js
    ```
    The server will start on `127.0.0.1:3000`.

### ### Usage

* Navigate to `http://localhost:3000` in your browser to see the landing page.
* Navigate to `http://localhost:3000/scamwatch` to access the live chat monitoring tool.
