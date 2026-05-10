# WebForge AI Codebase Analysis

Based on the analysis of the `builderopenrouter` repository, here is a complete breakdown of its purpose and how the code functions.

## 🎯 Purpose
**WebForge AI** is an AI-powered website generator. It provides a browser-based, IDE-like interface where users can type a description of a website they want to build, select a language model, and have the AI generate a complete, working webpage comprising HTML, CSS, and JavaScript. 

The application utilizes the **OpenRouter API** to communicate with various Large Language Models (LLMs) (like Claude, GPT-4, etc.) to perform the actual code generation.

## 🏗️ Architecture

The project follows a standard client-server architecture using Node.js (Express) for the backend and Vanilla JavaScript/HTML/CSS for the frontend.

### 1. Backend (`server.js`)
The backend is a lightweight Express server responsible for serving the frontend static files and securely communicating with the OpenRouter API.

*   **`GET /models`**: Fetches the list of available AI models from OpenRouter using the `OPENROUTER_API_KEY` environment variable. This allows the frontend dropdown to populate dynamically.
*   **`POST /generate`**: The core API endpoint. It takes a `prompt` and a `model` choice from the frontend and sends it to OpenRouter.
    *   **Strict System Prompt**: It uses a highly specific `SYSTEM_PROMPT` instructing the AI to act as an expert developer and return *only* a JSON object structured exactly like `{"files":{"index.html":"...","style.css":"...","script.js":"..."}}`.
    *   **Robust Extraction & Retries**: Because LLMs sometimes include markdown fences or conversational text alongside JSON, the server includes an `extractJSON()` helper to safely parse the response. If the first attempt returns invalid JSON or malformed HTML, the server automatically retries the generation once, prompting the AI to correct its mistake.
    *   **Fallback Mechanism**: If the AI fails twice, the server returns a predefined, attractive "Fallback" placeholder website so the user isn't met with a blank screen.

### 2. Frontend (`public/`)
The frontend is built without heavy frameworks, relying on vanilla JavaScript (`app.js`), standard HTML (`index.html`), and CSS (`style.css`) for a responsive, fast IDE-like experience.

*   **UI Layout (`index.html` & `style.css`)**: Features a dark-mode IDE design. It includes a top bar for the prompt input and model selection, a sidebar file explorer, a central code viewer, and a live preview pane on the right.
*   **Application Logic (`app.js`)**:
    *   **Initialization**: On load, it calls `/models` to populate the custom dropdown model selector.
    *   **Generation Flow**: When "Generate" is clicked, it shows a loading overlay and POSTs the prompt to the backend.
    *   **File Tree Management**: Once the JSON payload of code files is received, it populates the sidebar (`index.html`, `style.css`, `script.js`). Clicking a file updates the code viewer pane.
    *   **Live Preview (`buildPreview()`)**: This is a critical function. It takes the generated HTML, CSS, and JS and logically injects the CSS into the `<head>` and JS before the `</body>`. It then assigns this complete HTML string to an `<iframe>`'s `srcdoc` attribute, rendering the generated website live and safely isolated from the main application. 
    *   **Resilience**: It includes a `FALLBACK_BASE` CSS string. If the AI generates an HTML page but provides very weak or no CSS, the frontend automatically injects this fallback styling to ensure the page still looks somewhat modern.

## ⚙️ How It Works (Step-by-Step Flow)

1. **User Input**: The user selects a model from the top bar and types a prompt (e.g., "A SaaS landing page for a dog walking app").
2. **Request to Server**: The frontend sends this to `/generate`.
3. **OpenRouter API Call**: The Node server packages the prompt with its rigid JSON-enforcing system instructions and requests a completion from OpenRouter.
4. **Code Parsing**: The server receives the AI's response, extracts the raw JSON, and ensures it's valid. 
5. **UI Update**: The frontend receives the JSON files, updates the file tree, displays the raw code in the editor, and dynamically builds an `<iframe>` preview of the requested website.

> Note: Per your instructions, I have only analyzed the codebase and have not made any modifications to the existing files.
