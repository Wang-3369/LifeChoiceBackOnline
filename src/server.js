import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

const {
  PORT = "10000",
  MONGODB_URI,
  ALLOWED_ORIGIN = "*",
  NODE_ENV = "development"
} = process.env;

const app = express();

app.set("trust proxy", 1);

app.use(cors({
  origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN.split(",").map((origin) => origin.trim()),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json({ limit: "32kb" }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
}));

const forbiddenPatterns = [
  /<\s*script/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,
  /(?:幹你娘|操你媽)/i,
  /\b(?:fuck|shit|bitch|asshole)\b/i
];

const statsSchema = new mongoose.Schema({
  health: Number,
  wealth: Number,
  intelligence: Number,
  charisma: Number,
  morality: Number,
  luck: Number
}, { _id: false, strict: false });

const chatMessageSchema = new mongoose.Schema({
  playerName: { type: String, required: true, trim: true, minlength: 1, maxlength: 30 },
  message: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
  createdAt: { type: Date, default: Date.now, index: true }
}, {
  collection: "chat_messages",
  versionKey: false
});

const sharedStorySchema = new mongoose.Schema({
  playerName: { type: String, required: true, trim: true, minlength: 1, maxlength: 30 },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  worldview: { type: String, required: true, trim: true, maxlength: 40 },
  ageText: { type: String, required: true, trim: true, maxlength: 40 },
  story: { type: String, required: true, trim: true, minlength: 1, maxlength: 3000 },
  stats: { type: statsSchema, default: {} },
  lifeLog: {
    type: [String],
    default: [],
    validate: {
      validator: (items) => items.length <= 80 && items.every((item) => typeof item === "string" && item.trim().length <= 300),
      message: "lifeLog must contain at most 80 strings, each up to 300 characters."
    }
  },
  createdAt: { type: Date, default: Date.now, index: true }
}, {
  collection: "shared_stories",
  versionKey: false
});

const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);
const SharedStory = mongoose.model("SharedStory", sharedStorySchema);

function hasForbiddenContent(value) {
  if (typeof value === "string") {
    return forbiddenPatterns.some((pattern) => pattern.test(value));
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenContent(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value).some((item) => hasForbiddenContent(item));
  }

  return false;
}

function normalizeString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().replace(/\s+/g, " ");
}

function normalizeLongText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function validateLength(value, field, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    return `${field} must be ${min}-${max} characters.`;
  }

  return null;
}

function formatChatMessage(doc) {
  return {
    id: doc._id.toString(),
    playerName: doc.playerName,
    message: doc.message,
    createdAt: doc.createdAt.toISOString()
  };
}

function formatSharedStory(doc) {
  return {
    id: doc._id.toString(),
    playerName: doc.playerName,
    title: doc.title,
    worldview: doc.worldview,
    ageText: doc.ageText,
    story: doc.story,
    createdAt: doc.createdAt.toISOString()
  };
}

async function trimCollection(Model, keep) {
  const staleDocs = await Model.find({})
    .sort({ createdAt: -1, _id: -1 })
    .skip(keep)
    .select("_id")
    .lean();

  if (staleDocs.length > 0) {
    await Model.deleteMany({ _id: { $in: staleDocs.map((doc) => doc._id) } });
  }
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    env: NODE_ENV,
    mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "LifeChoiceBackOnline API",
    endpoints: [
      "GET /health",
      "GET /chat/messages",
      "POST /chat/messages",
      "GET /shares",
      "POST /shares"
    ]
  });
});

app.get("/chat/messages", async (req, res, next) => {
  try {
    const messages = await ChatMessage.find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(50);

    res.json(messages.reverse().map(formatChatMessage));
  } catch (error) {
    next(error);
  }
});

app.post("/chat/messages", async (req, res, next) => {
  try {
    const playerName = normalizeString(req.body?.playerName) || "匿名玩家";
    const message = normalizeLongText(req.body?.message);

    const error = validateLength(playerName, "playerName", 1, 30)
      || validateLength(message, "message", 1, 500);

    if (error) {
      return res.status(400).json({ error });
    }

    if (hasForbiddenContent({ playerName, message })) {
      return res.status(400).json({ error: "Content is not allowed." });
    }

    const saved = await ChatMessage.create({ playerName, message });
    await trimCollection(ChatMessage, 50);

    return res.status(201).json(formatChatMessage(saved));
  } catch (error) {
    return next(error);
  }
});

app.get("/shares", async (req, res, next) => {
  try {
    const stories = await SharedStory.find({})
      .sort({ createdAt: -1, _id: -1 })
      .limit(30);

    res.json(stories.map(formatSharedStory));
  } catch (error) {
    next(error);
  }
});

app.post("/shares", async (req, res, next) => {
  try {
    const playerName = normalizeString(req.body?.playerName);
    const title = normalizeString(req.body?.title);
    const worldview = normalizeString(req.body?.worldview);
    const ageText = normalizeString(req.body?.ageText);
    const story = normalizeLongText(req.body?.story);
    const stats = req.body?.stats && typeof req.body.stats === "object" && !Array.isArray(req.body.stats)
      ? req.body.stats
      : {};
    const lifeLog = Array.isArray(req.body?.lifeLog)
      ? req.body.lifeLog.map((item) => normalizeLongText(item)).filter(Boolean)
      : [];

    const error = validateLength(playerName, "playerName", 1, 30)
      || validateLength(title, "title", 1, 80)
      || validateLength(worldview, "worldview", 1, 40)
      || validateLength(ageText, "ageText", 1, 40)
      || validateLength(story, "story", 1, 3000);

    if (error) {
      return res.status(400).json({ error });
    }

    if (lifeLog.length > 80 || lifeLog.some((item) => item.length > 300)) {
      return res.status(400).json({ error: "lifeLog must contain at most 80 strings, each up to 300 characters." });
    }

    if (hasForbiddenContent({ playerName, title, worldview, ageText, story, lifeLog })) {
      return res.status(400).json({ error: "Content is not allowed." });
    }

    const saved = await SharedStory.create({
      playerName,
      title,
      worldview,
      ageText,
      story,
      stats,
      lifeLog
    });

    await trimCollection(SharedStory, 100);

    return res.status(201).json({
      id: saved._id.toString(),
      success: true
    });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON." });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({ error: "Internal server error." });
});

async function start() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is required.");
  }

  await mongoose.connect(MONGODB_URI);

  app.listen(Number(PORT), () => {
    console.log(`LifeChoiceBackOnline API listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
