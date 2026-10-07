# YouTube → LLM Summary

A userscript that adds buttons to YouTube to send a video straight to **ChatGPT**, **Claude**, **Grok** or **DeepSeek**. It opens a new chat with a ready-made summary prompt already filled in.

## Features

- **Watch-page buttons**: a "Summarize with" bar below the video title.
- **Thumbnail hover buttons**: small buttons appear when you hover over a video thumbnail (home, search, recommendations, playlists, Shorts). Hover a button to see its label.
- **Prompt pre-fill**: opens the selected LLM in a new tab and inserts the prompt with the video title and link. You can also have it sent automatically.
- **Clipboard fallback**: the prompt is always copied to your clipboard as well. If the input field can't be found (for example after a site redesign), just paste it with `Ctrl+V`.
- **Settings panel**: click the ⚙ gear button in the bottom-right corner of YouTube to change the prompt, the language and the options. Light and dark mode follow your system theme.
- **Multi-language**: English (default) and German. Adding more languages is easy (see below).

## Screenshots
### Settings panel (gear, bottom right)
<img width="300" alt="Settings panel" src="https://github.com/user-attachments/assets/885d863d-64e0-405f-bdb7-2a7a9e54a99b" />

### YouTube home page (thumbnail hover buttons)
<img width="300" alt="Hover buttons on a thumbnail" src="https://github.com/user-attachments/assets/59170e57-e900-410c-8623-5ce0807c1844" />

### Video page
<img width="300" alt="Buttons below the video title" src="https://github.com/user-attachments/assets/7c1cabcf-5201-4cfc-be69-e1f0f8f8c17e" />

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the raw script file. Your userscript manager will offer to install it:
   **[youtube-llm-summary.user.js](https://raw.githubusercontent.com/Jake-double-one/YouTube-to-LLM/main/youtube-llm-summary.user.js)**
3. Be logged in to the LLM(s) you want to use.

The script includes `@updateURL`, so your userscript manager will pick up new versions automatically.

> **Chrome / Edge with Tampermonkey:** you may need to turn on *Developer mode* on the extensions page (or "Allow User Scripts" in the extension details) before userscripts can run.

## Usage

- On a video page, click **ChatGPT**, **Claude**, **Grok** or **DeepSeek** below the title.
- Anywhere else, hover over a thumbnail and click one of the small buttons in its top-left corner.

The LLM opens in a new tab with the prompt filled in. Review it and press Enter, or turn on *Send prompt automatically*.

## Settings

Click the **⚙** button in the bottom-right corner of YouTube. You can also open the settings from your userscript manager's menu (*Settings / Einstellungen*).

| Setting | Description |
| --- | --- |
| Language | UI language and language of the default prompt. |
| Prompt | The text sent to the LLM. Leave it empty or press *Reset to default* to use the default prompt of the selected language. |
| Send prompt automatically | Submits the prompt right away instead of just filling it in. |
| Open LLM tab in background | Keeps you on YouTube while the LLM tab opens. |
| Show buttons below the video title | Toggles the watch-page bar. |
| Show buttons when hovering thumbnails | Toggles the thumbnail hover buttons. |

### Prompt placeholders

| Placeholder | Replaced with |
| --- | --- |
| `{title}` | Video title |
| `{url}` | Video link (`https://www.youtube.com/watch?v=…`) |

When you switch the language, the default prompt switches with it. A custom prompt is kept as you wrote it.

Settings are stored by your userscript manager and survive script updates.

## Adding a language

All translations live in the `I18N` object near the top of the script. To add one:

1. Copy the `en` block.
2. Change the key to the language code (for example `fr`).
3. Translate `name` (shown in the language picker), `prompt` and the `ui` strings.

```js
fr: {
  name: 'Français',
  prompt:
    'Résume cette vidéo YouTube en français. ' +
    'Donne-moi les points clés sous forme de liste et une courte conclusion.\n\n' +
    'Titre : {title}\nLien : {url}',
  ui: {
    summarizeWith: 'Résumer avec',
    summarizeTooltip: 'Résumer la vidéo avec {llm}',
    // …
  },
},
```

The new language appears in the settings automatically. Any `ui` string you leave out falls back to English. Pull requests with new languages are welcome.

## Adding an LLM

LLMs are defined in the `LLMS` object:

```js
mistral: {
  label: 'Le Chat',
  color: '#fa520f',                    // accent color on hover
  url: 'https://chat.mistral.ai/chat', // page that opens a new chat
  input: 'textarea',                   // CSS selector of the prompt input
  send: 'button[type="submit"]',       // CSS selector of the send button (null = press Enter)
  // icon: 'https://…',                // optional, defaults to the site's favicon
},
```

Also add a matching `// @match https://chat.mistral.ai/*` line to the script header.

## How it works

1. When you click a button on YouTube, the script builds the prompt, copies it to the clipboard, stores it temporarily (valid for 60 seconds) and opens the LLM.
2. On the LLM page, the same script picks up the stored prompt, waits for the input field and inserts the text. If enabled, it also clicks send.

## Known limitations

- The LLM sites change their markup from time to time. If the prompt is no longer inserted, the `input`/`send` selectors in `LLMS` need an update. The clipboard fallback still works in the meantime.
- Icons are fetched once through Google's favicon service and cached.

## Disclaimer

This is an unofficial project. It is not affiliated with, endorsed by or sponsored by YouTube/Google, OpenAI, Anthropic, xAI or DeepSeek. All product names and trademarks belong to their respective owners. Use the script in line with the terms of service of the sites involved.

## License

[MIT](LICENSE) © 2026 Jake-double-one
