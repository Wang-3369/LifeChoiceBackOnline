# LifeChoiceBackOnline API

Node.js 20+ Express backend for chat messages and shared life stories.

## Environment

Copy `.env.example` to `.env` locally or set these values in Render:

```env
PORT=10000
MONGODB_URI=mongodb+srv://...
ALLOWED_ORIGIN=*
NODE_ENV=production
```

`MONGODB_URI` must only live in environment variables. Do not commit it.

## Install and Run

```bash
npm install
npm run dev
```

Production:

```bash
npm start
```

## API

- `GET /health`
- `GET /chat/messages`
- `POST /chat/messages`
- `GET /shares`
- `POST /shares`

Responses use `id` instead of MongoDB `_id`.

## Limits

- Rate limit: 20 requests per IP per minute
- Chat list returns latest 50 messages
- Share list returns latest 30 stories
- Chat collection is trimmed to the latest 50 records after each new chat message
- Shared stories collection is trimmed to the latest 100 records after each new share
