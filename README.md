# StudyForge AI

StudyForge AI is a full-stack learning website for creating flashcards and quizzes, reviewing with spaced repetition, importing study material, generating AI-assisted notes, and using an AI tutor.

## Features

- User registration and login
- Flashcard decks and spaced-repetition study sessions
- Quizzes and answer review
- PDF, DOCX, text, image, media, and YouTube imports
- AI-generated notes, flashcards, quizzes, and tutor responses
- Local SQLite database through Prisma
- Optional local Whisper transcription service

## Requirements

- Node.js 22.13 or newer
- npm
- Python 3.10 or newer, FFmpeg, and `yt-dlp` only when local media transcription is needed
- An OpenRouter API key only when AI features are needed

## Installation

1. Clone the repository and enter its folder:

   ```bash
   git clone https://github.com/YOUR_GITHUB_USERNAME/studyforge-ai.git
   cd studyforge-ai
   ```

2. Install the Node.js dependencies:

   ```bash
   npm install
   ```

3. Copy the example environment file:

   **Windows PowerShell**

   ```powershell
   Copy-Item .env.example .env
   ```

   **macOS or Linux**

   ```bash
   cp .env.example .env
   ```

4. Open `.env` and configure the values for your machine. Never commit this file.

   ```env
   OPENROUTER_API_KEY=
   OPENROUTER_FREE_ONLY=true
   DATABASE_URL="file:./dev.db"
   NEXT_PUBLIC_APP_NAME="StudyForge AI"
   NEXT_PUBLIC_SITE_URL="http://localhost:3000"
   SITE_URL="http://localhost:3000"
   SESSION_SECRET="replace-with-a-long-random-secret"
   TRANSCRIPTION_SERVICE_URL="http://127.0.0.1:8001"
   ```

   Generate a strong session secret instead of using the example text. AI features remain unavailable until `OPENROUTER_API_KEY` is configured.

5. Prepare and seed the local database:

   ```bash
   npm run db:generate
   npm run db:apply
   npm run db:seed
   ```

6. Start the website:

   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000).

## How to Use the Website

1. Register a new account or use the seeded local demo account:

   ```text
   Email: demo@studyforge.local
   Password: studyforge123
   ```

   The demo credentials are development seed data and must not be used for a production deployment.

2. Open **Decks** to create a deck and add flashcards.
3. Open **Study** to review cards with spaced repetition.
4. Open **Import** to upload supported study material or paste a transcript.
5. Open **Notes** to read imported sources and generate study notes or quizzes.
6. Open **Tutor** to ask questions with the configured OpenRouter model.
7. Open **Settings** to choose a free OpenRouter model mode and study language.

## Optional Local Transcription Service

The Python service is required only for local audio/video transcription and YouTube videos without usable captions.

From the repository root, install its Python dependencies with:

```powershell
pip install -r requirements.txt
```

Then start the service:

```powershell
cd services/transcription
python -m venv .venv
.\.venv\Scripts\Activate.ps1
uvicorn main:app --host 127.0.0.1 --port 8001
```

Install FFmpeg separately and ensure it is available on `PATH`. Keep this terminal open, then start the Next.js app in another terminal.

## Available Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:apply` | Apply the included SQLite migrations |
| `npm run db:seed` | Add local demonstration data |
| `npm run db:studio` | Open Prisma Studio |

## GitHub and Deployment

GitHub stores the source code and runs the automated build check. GitHub Pages cannot host this application because it requires Next.js server routes, authentication, database access, file processing, and an optional Python service.

For a public website, deploy the Next.js application to a server-capable platform such as Vercel or Render and use a production database such as PostgreSQL. Configure environment variables in the hosting dashboard; do not upload `.env`. The optional transcription service must be deployed separately on a host that supports Python and FFmpeg.

Before production deployment:

- Replace SQLite with a managed PostgreSQL database.
- Generate a unique, strong `SESSION_SECRET`.
- Set `NEXT_PUBLIC_SITE_URL` and `SITE_URL` to the public HTTPS address.
- Add `OPENROUTER_API_KEY` only through the host's secret settings.
- Remove or change development seed credentials.
- Use persistent storage for uploads, or move uploaded files to object storage.

## Supported Imports

- PDF with selectable text or scanned/image-heavy pages
- DOCX
- TXT and Markdown
- PNG, JPG, and JPEG
- YouTube URLs
- Audio and video files supported by the transcription service
- Pasted transcript text

## Known Limitations

- AI generation depends on OpenRouter model availability and rate limits.
- Local SQLite and filesystem uploads are intended for local development, not ephemeral serverless production storage.
- Media transcription requires the separate Python service, FFmpeg, and local model resources.
- PowerPoint import is not currently available.

## Security

- `.env`, local databases, build output, logs, and virtual environments are excluded from Git.
- Never commit API keys, tokens, passwords, cookies, or production database files.
- Rotate any credential immediately if it is accidentally committed.

## License

No license has been selected yet. By default, copyright remains with the repository owner.
