# WebForge AI

WebForge AI is a powerful, web-based IDE mimicking VS Code, featuring an integrated AI coding assistant, a built-in terminal, code preview capabilities, and an exquisite UI.

## Features

- 📁 **File Explorer**: Browse and manage your workspace files with ease.
- 💻 **Code Editor**: A syntax-highlighted code editor with line numbers and multiple tabs.
- ⚡️ **AI Integration (OpenCode)**: Generate, refactor, and understand code using the built-in AI tools.
- 🐚 **Multi-Terminal**: Spawn multiple terminal instances (PowerShell, bash, OpenCode) with preserved state.
- 📱 **Mobile Responsive**: Fully usable on mobile devices with a custom bottom navigation bar and full-screen overlay menus.

## Setup & Local Development

1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Start the application with `npm run dev` or `node server.js`.
4. Navigate to `http://localhost:3000` in your browser.

## Running on GitHub Actions (TryCloudflare)

This repository includes a GitHub Actions workflow that will automatically launch WebForge AI and expose it publicly via a Cloudflare Tunnel (`trycloudflare`).

When the Action runs, check the **Start Cloudflare Tunnel** step logs to find the public `trycloudflare.com` URL. The server will stay online as long as the GitHub Action runner is active (up to 6 hours).

### Required GitHub Secrets

To make sure the AI features work when deployed through GitHub Actions, you need to add the following secrets to your GitHub repository:

1. Go to your repository on GitHub.
2. Click on **Settings** -> **Secrets and variables** -> **Actions**.
3. Click **New repository secret** and add the following keys (if applicable):

| Secret Name          | Description                                      |
|----------------------|--------------------------------------------------|
| `GEMINI_API_KEY`     | Your Google Gemini API Key (for AI features)     |
| `OPENROUTER_API_KEY` | Your OpenRouter API Key (if using OpenRouter)    |

Once added, these secrets will be securely injected into the environment when the GitHub Action runs.
