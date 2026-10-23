"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { searchGifs, prefetchTrendingGifs, GIF_CATEGORIES } = require("./gifLibrary");
const { loadAppConfig } = require("./appConfig");
const { isSupabaseConfigured, sendEmailCode, verifyEmailCode } = require("./accountDelivery");

const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 5;
// Marks verification rows whose code lives in Supabase (the email-otp Edge
// Function e-mails and checks it)
const SUPABASE_CODE = "supabase";
// Same lifetime as CODE_TTL_MS in supabase/functions/email-otp
const SUPABASE_CODE_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000;

// Login sessions: opaque random tokens, stored only as SHA-256 hashes.
// Sliding expiry: each use pushes the expiry SESSION_TTL_MS into the future.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

// Actions anyone may call without a session
const PUBLIC_ACTIONS = new Set([
  "AUTH_LOGIN",
  "login",
  "AUTH_REGISTER",
  "register",
  "INSPECT_INVITE",
  "inspectInvite",
  "SEARCH_GIFS",
  "searchGifs"
]);

// Every parameter name the actions read as "the user performing this".
// For authenticated calls they are all overwritten with the session's user.
const ACTOR_PARAM_KEYS = ["actorId", "userId", "currentUserId", "fromUserId", "authorId", "ownerId"];

// With requireVerifiedEmail on, an account whose e-mail is not confirmed can
// only reach these actions (everything else answers EMAIL_NOT_VERIFIED)
const UNVERIFIED_ALLOWED_ACTIONS = new Set([
  "getAccountSecurity",
  "requestEmailVerification",
  "REQUEST_EMAIL_VERIFICATION",
  "confirmEmailVerification",
  "CONFIRM_EMAIL_VERIFICATION",
  "requestEmailChange",
  "confirmEmailChange",
  "cancelPendingVerification"
]);

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "discord",
  "system",
  "support",
  "moderator",
  "mod",
  "everyone",
  "here",
  "null",
  "undefined",
  "root",
  "bot",
  "clyde",
  "rea_bot",
  "official",
  "security",
  "staff"
]);

const VALID_THEMES = new Set([
  "dark",
  "light",
  "midnight",
  "oled",
  "ocean",
  "nebula",
  "emerald",
  "rose",
  "graphite",
  "sunset"
]);

function normalizeUsername(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function validateUsername(raw) {
  const clean = normalizeUsername(raw);
  if (!clean) {
    return { valid: false, normalized: clean, reason: "O @username não pode ficar vazio." };
  }
  if (clean.length < 3) {
    return { valid: false, normalized: clean, reason: "O @username deve ter pelo menos 3 caracteres." };
  }
  if (clean.length > 32) {
    return { valid: false, normalized: clean, reason: "O @username deve ter no máximo 32 caracteres." };
  }
  if (!/^[a-z0-9_.]+$/.test(clean)) {
    return {
      valid: false,
      normalized: clean,
      reason: "Use apenas letras minúsculas (a-z), números (0-9), ponto (.) e sublinhado (_)."
    };
  }
  if (clean.startsWith(".") || clean.endsWith(".")) {
    return { valid: false, normalized: clean, reason: "O @username não pode começar ou terminar com ponto (.)." };
  }
  if (clean.includes("..")) {
    return { valid: false, normalized: clean, reason: "O @username não pode conter pontos consecutivos (..)." };
  }
  if (RESERVED_USERNAMES.has(clean)) {
    return { valid: false, normalized: clean, reason: "Este @username é reservado pelo sistema." };
  }
  return { valid: true, normalized: clean, reason: null };
}

function legacyHashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "") + "::discord_rea_salt_v2").digest("hex");
}

// New hashes use scrypt with a per-user salt ("scrypt$<salt>$<hash>").
// Older rows still hold the legacy salted SHA-256 and are upgraded on next login.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const value = String(stored || "");
  if (value.startsWith("scrypt$")) {
    const [, salt, hash] = value.split("$");
    const candidate = crypto.scryptSync(String(password || ""), salt, 64);
    const expected = Buffer.from(hash, "hex");
    return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
  }
  return value === legacyHashPassword(password);
}

function isLegacyPasswordHash(stored) {
  return !String(stored || "").startsWith("scrypt$");
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

// Accepts "+55 11 91234-5678", "(11) 91234-5678", etc. Numbers without a
// country code are assumed to be Brazilian (+55).
function maskEmail(email) {
  const [user, domain] = String(email || "").split("@");
  if (!domain) return email;
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${"•".repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

function validateNewPassword(password) {
  const pw = String(password || "");
  if (pw.length < 8) return "A nova senha deve ter pelo menos 8 caracteres.";
  if (pw.length > 128) return "A nova senha deve ter no máximo 128 caracteres.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Use letras e números na nova senha.";
  return null;
}

function detectFileSignature(buffer, declaredMime, purpose) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    return { ok: false, error: "Arquivo vazio ou corrompido." };
  }

  // Reject Windows PE (MZ), ELF, Mach-O, HTML/Script payloads
  if (
    (buffer[0] === 0x4d && buffer[1] === 0x5a) || // MZ
    (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) // ELF
  ) {
    return { ok: false, error: "Arquivos executáveis não são permitidos." };
  }

  const headUtf8 = buffer.subarray(0, 64).toString("utf8").toLowerCase();
  if (headUtf8.includes("<script") || headUtf8.includes("<!doctype html") || headUtf8.includes("<html")) {
    return { ok: false, error: "Arquivos HTML/Script não são permitidos." };
  }

  if (
    purpose === "avatar" ||
    purpose === "banner" ||
    purpose === "attachment_image" ||
    purpose === "attachment"
  ) {
    const maxBytes = purpose === "banner" ? 10 * 1024 * 1024 : 8 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return { ok: false, error: `A imagem excede o limite máximo (${Math.round(maxBytes / 1024 / 1024)} MB).` };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return { ok: true, mime: "image/png", ext: "png", isGif: false };
    }
    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { ok: true, mime: "image/jpeg", ext: "jpg", isGif: false };
    }
    // GIF: GIF87a or GIF89a (47 49 46 38)
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      return { ok: true, mime: "image/gif", ext: "gif", isGif: true };
    }
    // WEBP: RIFF....WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { ok: true, mime: "image/webp", ext: "webp", isGif: false };
    }
    return {
      ok: false,
      error: "Formato de imagem inválido. Formatos aceitos: PNG, JPEG, WEBP, GIF."
    };
  }

  if (purpose === "audio" || purpose === "sound") {
    const maxAudioBytes = 2 * 1024 * 1024;
    if (buffer.length > maxAudioBytes) {
      return { ok: false, error: "O arquivo de áudio excede o limite de 2 MB." };
    }
    // WAV: RIFF....WAVE
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x41 &&
      buffer[10] === 0x56 &&
      buffer[11] === 0x45
    ) {
      return { ok: true, mime: "audio/wav", ext: "wav" };
    }
    // OGG: OggS
    if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
      return { ok: true, mime: "audio/ogg", ext: "ogg" };
    }
    // MP3: ID3 or frame sync FF FB / FF F3 / FF F2
    if (
      (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
      (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    ) {
      return { ok: true, mime: "audio/mpeg", ext: "mp3" };
    }
    // WEBM: 1A 45 DF A3
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return { ok: true, mime: "audio/webm", ext: "webm" };
    }
    return {
      ok: false,
      error: "Formato de áudio não suportado. Formatos aceitos: WAV, MP3, OGG, WEBM."
    };
  }

  return { ok: false, error: `Tipo de upload desconhecido (${declaredMime || purpose || "unspecified"}).` };
}

class DiscordBackendServer {
  constructor(options = {}) {
    this.rootDir = path.resolve(__dirname, "..");
    const dataDir = options.dataDir || options.userDataDir;
    this.dataDir = dataDir;
    this.uploadsDir = path.join(dataDir, "uploads");
    fs.mkdirSync(this.uploadsDir, { recursive: true });

    this.config = options.config || loadAppConfig();
    this.dbPath = path.join(dataDir, "discord_platform_v2.sqlite");
    this.db = new DatabaseSync(this.dbPath);
    this.sseClients = new Set();
    this.voiceRooms = new Map();
    this.screenShares = new Map();
    this.server = null;
    this.port = 0;

    this.initDatabase();
  }

  initDatabase() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        pronouns TEXT NOT NULL DEFAULT '',
        about_me TEXT NOT NULL DEFAULT '',
        custom_status TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'online',
        avatar_color TEXT NOT NULL DEFAULT '#5865f2',
        avatar_url TEXT DEFAULT NULL,
        banner_color TEXT NOT NULL DEFAULT '#5865f2',
        banner_url TEXT DEFAULT NULL,
        banner_type TEXT NOT NULL DEFAULT 'color',
        banner_position INTEGER NOT NULL DEFAULT 50,
        badges_json TEXT NOT NULL DEFAULT '["Active Developer"]',
        created_at TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        theme TEXT NOT NULL DEFAULT 'dark',
        message_display TEXT NOT NULL DEFAULT 'cozy',
        font_scale REAL NOT NULL DEFAULT 1.0,
        call_join_sound_enabled INTEGER NOT NULL DEFAULT 1,
        call_leave_sound_enabled INTEGER NOT NULL DEFAULT 1,
        call_join_sound_preset TEXT NOT NULL DEFAULT 'discord-default',
        call_leave_sound_preset TEXT NOT NULL DEFAULT 'discord-default',
        call_join_custom_url TEXT DEFAULT NULL,
        call_leave_custom_url TEXT DEFAULT NULL,
        call_join_custom_name TEXT NOT NULL DEFAULT '',
        call_leave_custom_name TEXT NOT NULL DEFAULT '',
        call_sound_volume INTEGER NOT NULL DEFAULT 80,
        minimize_to_tray INTEGER NOT NULL DEFAULT 1,
        hardware_acceleration INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_notes (
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (owner_id, target_id)
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(requester_id, addressee_id)
      );

      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        icon_color TEXT NOT NULL DEFAULT '#5865f2',
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_public INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'Science & Tech',
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guild_roles (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#5865f2',
        hoist INTEGER NOT NULL DEFAULT 1,
        permissions_json TEXT NOT NULL DEFAULT '["SEND_MESSAGES","CONNECT_VOICE","CREATE_INSTANT_INVITE"]'
      );

      CREATE TABLE IF NOT EXISTS guild_members (
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        roles_json TEXT NOT NULL DEFAULT '[]',
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS channel_categories (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        category_id TEXT DEFAULT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        topic TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS dm_channels (
        id TEXT PRIMARY KEY,
        user1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        updated_at INTEGER NOT NULL,
        UNIQUE(user1_id, user2_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        reply_to_id TEXT DEFAULT NULL,
        attachment_json TEXT DEFAULT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        edited INTEGER NOT NULL DEFAULT 0,
        reactions_json TEXT NOT NULL DEFAULT '[]',
        replies_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        timestamp_label TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invites (
        token TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER DEFAULT NULL,
        max_uses INTEGER DEFAULT 0,
        uses INTEGER NOT NULL DEFAULT 0,
        revoked INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        time_label TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    const addCol = (table, col, def) => {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      } catch (_) {}
    };

    addCol("guilds", "icon_url", "TEXT");
    addCol("guilds", "banner_url", "TEXT");
    addCol("user_preferences", "call_join_custom_name", "TEXT NOT NULL DEFAULT ''");
    addCol("user_preferences", "call_leave_custom_name", "TEXT NOT NULL DEFAULT ''");
    addCol("user_preferences", "call_mute_sound_enabled", "INTEGER NOT NULL DEFAULT 1");
    addCol("user_preferences", "call_unmute_sound_enabled", "INTEGER NOT NULL DEFAULT 1");
    addCol("user_preferences", "call_mute_sound_preset", "TEXT NOT NULL DEFAULT 'discord-default'");
    addCol("user_preferences", "call_unmute_sound_preset", "TEXT NOT NULL DEFAULT 'discord-default'");
    addCol("user_preferences", "call_mute_custom_url", "TEXT DEFAULT NULL");
    addCol("user_preferences", "call_unmute_custom_url", "TEXT DEFAULT NULL");
    addCol("user_preferences", "voice_input_device_id", "TEXT NOT NULL DEFAULT 'default'");
    addCol("user_preferences", "voice_output_device_id", "TEXT NOT NULL DEFAULT 'default'");
    addCol("user_preferences", "voice_input_volume", "INTEGER NOT NULL DEFAULT 100");
    addCol("user_preferences", "voice_output_volume", "INTEGER NOT NULL DEFAULT 100");

    addCol("users", "avatar_scale", "REAL NOT NULL DEFAULT 1.0");
    addCol("users", "avatar_crop_x", "REAL NOT NULL DEFAULT 0.0");
    addCol("users", "avatar_crop_y", "REAL NOT NULL DEFAULT 0.0");
    addCol("users", "banner_scale", "REAL NOT NULL DEFAULT 1.0");
    addCol("users", "banner_crop_x", "REAL NOT NULL DEFAULT 0.0");
    addCol("users", "banner_crop_y", "REAL NOT NULL DEFAULT 0.0");

    addCol("guild_roles", "position", "INTEGER NOT NULL DEFAULT 0");

    // Account security: verified e-mail and password rotation (phone columns are legacy, unused)
    addCol("users", "email_verified", "INTEGER NOT NULL DEFAULT 0");
    addCol("users", "phone", "TEXT DEFAULT NULL");
    addCol("users", "phone_verified", "INTEGER NOT NULL DEFAULT 0");
    addCol("users", "password_updated_at", "INTEGER DEFAULT NULL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK(purpose IN ('email_verify', 'email_change', 'phone_verify')),
        target TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_verification_user_purpose ON verification_codes(user_id, purpose);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);

    // Remove any legacy illustrative/fictional users if they ever existed
    const fictionalIds = ["u_elena", "u_marcus", "u_sophia", "u_clyde", "u_lucas", "u_pending1"];
    const delStmt = this.db.prepare("DELETE FROM users WHERE id = ?");
    for (const fid of fictionalIds) {
      delStmt.run(fid);
    }

    // If legacy u_me exists, migrate its id to u_davis
    const legacyMe = this.db.prepare("SELECT * FROM users WHERE id = 'u_me'").get();
    const existingDavis = this.db.prepare("SELECT * FROM users WHERE id = 'u_davis'").get();
    if (legacyMe && !existingDavis) {
      this.db.exec("PRAGMA foreign_keys = OFF;");
      this.db.prepare("UPDATE users SET id = 'u_davis' WHERE id = 'u_me'").run();
      this.db.prepare("UPDATE user_preferences SET user_id = 'u_davis' WHERE user_id = 'u_me'").run();
      this.db.prepare("UPDATE guilds SET owner_id = 'u_davis' WHERE owner_id = 'u_me'").run();
      this.db.prepare("UPDATE guild_members SET user_id = 'u_davis' WHERE user_id = 'u_me'").run();
      this.db.prepare("UPDATE audit_logs SET actor_id = 'u_davis' WHERE actor_id = 'u_me'").run();
      this.db.exec("PRAGMA foreign_keys = ON;");
    }

    // Fresh install only: create the starter account and server. Once real
    // accounts exist (or this one was deleted) nothing is recreated.
    const anyUser = this.db.prepare("SELECT 1 FROM users LIMIT 1").get();
    if (!anyUser) {
      const now = Date.now();
      this.db
        .prepare(
          `INSERT INTO users (
            id, email, username, password_hash, display_name, pronouns, about_me,
            custom_status, status, avatar_color, banner_color, banner_type, banner_position,
            badges_json, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          "u_davis",
          "davis@discord.local",
          "davis_dev",
          hashPassword("password123"),
          "Davis",
          "he/him",
          "Systems & Desktop Engineer • Windows 11 Pro",
          "",
          "online",
          "#5865f2",
          "#5865f2",
          "color",
          50,
          JSON.stringify(["Active Developer"]),
          "14 Oct 2021",
          now
        );

      this.db
        .prepare(`INSERT OR IGNORE INTO user_preferences (user_id, updated_at) VALUES ('u_davis', ?)`)
        .run(now);

      this.createGuildInternal("u_davis", {
        id: "g_rea",
        name: "REA Engineering Hub",
        iconColor: "#5865f2",
        isPublic: true,
        category: "Science & Tech",
        description: "Workspace server for Discord Desktop v1.0.9262 engineering and real-time communication."
      });
    }
  }

  resolveUserId(rawId) {
    if (!rawId || rawId === "u_me") return "u_davis";
    return rawId;
  }

  getShortName(name) {
    const words = String(name || "S").trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return String(name || "S").slice(0, 3).toUpperCase();
  }

  formatTimeLabel(ts = Date.now()) {
    const d = new Date(ts);
    return "Today at " + d.toTimeString().slice(0, 5);
  }

  createGuildInternal(ownerId, { id, name, iconColor, isPublic = false, category = "Science & Tech", description = "" }) {
    const cleanName = String(name || "").trim();
    if (!cleanName) throw new Error("Server name is required.");
    const guildId = id || "g_" + crypto.randomBytes(6).toString("hex");
    const now = Date.now();
    const shortName = this.getShortName(cleanName);
    const color = iconColor || "#5865f2";

    const roleAdminId = "r_admin_" + guildId;
    const roleMemberId = "r_member_" + guildId;
    const catTextId = "cat_text_" + guildId;
    const catVoiceId = "cat_voice_" + guildId;
    const chGeneralId = id === "g_rea" ? "c_general" : "c_gen_" + guildId;
    const chVoiceId = id === "g_rea" ? "c_voice_lounge" : "c_voice_" + guildId;

    this.db
      .prepare(
        `INSERT OR IGNORE INTO guilds (id, name, short_name, icon_color, owner_id, is_public, category, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(guildId, cleanName, shortName, color, ownerId, isPublic ? 1 : 0, category, description, now);

    this.db
      .prepare(
        `INSERT OR IGNORE INTO guild_roles (id, guild_id, name, color, hoist, permissions_json)
         VALUES (?, ?, 'Admin', '#f1c40f', 1, ?)`
      )
      .run(
        roleAdminId,
        guildId,
        JSON.stringify([
          "ADMINISTRATOR",
          "MANAGE_GUILD",
          "MANAGE_CHANNELS",
          "MANAGE_ROLES",
          "CREATE_INSTANT_INVITE",
          "SEND_MESSAGES",
          "CONNECT_VOICE"
        ])
      );

    this.db
      .prepare(
        `INSERT OR IGNORE INTO guild_roles (id, guild_id, name, color, hoist, permissions_json)
         VALUES (?, ?, 'Members', '#23a55a', 1, ?)`
      )
      .run(roleMemberId, guildId, JSON.stringify(["CREATE_INSTANT_INVITE", "SEND_MESSAGES", "CONNECT_VOICE"]));

    this.db
      .prepare(
        `INSERT OR IGNORE INTO guild_members (guild_id, user_id, roles_json, joined_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(guildId, ownerId, JSON.stringify([roleAdminId]), now);

    this.db
      .prepare(`INSERT OR IGNORE INTO channel_categories (id, guild_id, name, position) VALUES (?, ?, 'TEXT CHANNELS', 0)`)
      .run(catTextId, guildId);
    this.db
      .prepare(`INSERT OR IGNORE INTO channel_categories (id, guild_id, name, position) VALUES (?, ?, 'VOICE CHANNELS', 1)`)
      .run(catVoiceId, guildId);

    this.db
      .prepare(
        `INSERT OR IGNORE INTO channels (id, guild_id, category_id, name, type, topic, position)
         VALUES (?, ?, ?, 'general', 'text', 'General discussion channel.', 0)`
      )
      .run(chGeneralId, guildId, catTextId);

    this.db
      .prepare(
        `INSERT OR IGNORE INTO channels (id, guild_id, category_id, name, type, topic, position)
         VALUES (?, ?, ?, 'Engineering Lounge', 'voice', 'Real-time voice & screen sharing room', 1)`
      )
      .run(chVoiceId, guildId, catVoiceId);

    this.db
      .prepare(
        `INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "al_" + crypto.randomBytes(6).toString("hex"),
        guildId,
        ownerId,
        `Created server "${cleanName}"`,
        this.formatTimeLabel(now),
        now
      );

    return { guildId, generalChannelId: chGeneralId };
  }

  // Stored upload paths are relative ("/uploads/..."); clients need the absolute URL
  resolveMediaUrl(u) {
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")) return u;
    return this.port ? `http://127.0.0.1:${this.port}${u}` : u;
  }

  serializeUser(row, includeBaseUrl = true) {
    if (!row) return null;
    const base = includeBaseUrl && this.port ? `http://127.0.0.1:${this.port}` : "";
    const resolveUrl = (u) => {
      if (!u) return "";
      if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")) return u;
      return `${base}${u}`;
    };
    const posY = Number(row.banner_position ?? 50);
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      displayName: row.display_name,
      pronouns: row.pronouns || "",
      aboutMe: row.about_me || "",
      customStatus: row.custom_status || "",
      status: row.status || "online",
      avatarColor: row.avatar_color || "#5865f2",
      avatarUrl: resolveUrl(row.avatar_url),
      avatarScale: Number(row.avatar_scale ?? 1.0),
      avatarCropX: Number(row.avatar_crop_x ?? 0.0),
      avatarCropY: Number(row.avatar_crop_y ?? 0.0),
      bannerColor: row.banner_color || "#5865f2",
      bannerUrl: resolveUrl(row.banner_url),
      bannerType: row.banner_type || "color",
      bannerPosition: posY,
      bannerPositionY: posY,
      bannerScale: Number(row.banner_scale ?? 1.0),
      bannerCropX: Number(row.banner_crop_x ?? 0.0),
      bannerCropY: Number(row.banner_crop_y ?? 0.0),
      badges: JSON.parse(row.badges_json || '["Active Developer"]'),
      memberSince: row.created_at || "Today",
      createdAt: row.created_at || "Today",
      version: Number(row.version || 1),
      emailVerified: Boolean(row.email_verified),
      isBot: false
    };
  }

  serializePublicUser(row) {
    const full = this.serializeUser(row);
    if (!full) return null;
    delete full.email;
    delete full.emailVerified;
    return full;
  }

  getPreferences(userId) {
    const uid = this.resolveUserId(userId);
    const now = Date.now();
    this.db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, updated_at) VALUES (?, ?)`).run(uid, now);
    const row = this.db.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`).get(uid);
    const base = this.port ? `http://127.0.0.1:${this.port}` : "";
    const resolveUrl = (u) => {
      if (!u) return "";
      if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:")) return u;
      return `${base}${u}`;
    };
    const joinEnabled = Boolean(row.call_join_sound_enabled);
    const leaveEnabled = Boolean(row.call_leave_sound_enabled);
    const muteEnabled = Boolean(row.call_mute_sound_enabled ?? 1);
    const unmuteEnabled = Boolean(row.call_unmute_sound_enabled ?? 1);
    const joinPreset = row.call_join_sound_preset || "discord-default";
    const leavePreset = row.call_leave_sound_preset || "discord-default";
    const mutePreset = row.call_mute_sound_preset || "discord-default";
    const unmutePreset = row.call_unmute_sound_preset || "discord-default";
    const joinCustomUrl = resolveUrl(row.call_join_custom_url);
    const leaveCustomUrl = resolveUrl(row.call_leave_custom_url);
    const muteCustomUrl = resolveUrl(row.call_mute_custom_url);
    const unmuteCustomUrl = resolveUrl(row.call_unmute_custom_url);
    const joinCustomName = row.call_join_custom_name || "";
    const leaveCustomName = row.call_leave_custom_name || "";
    const volume = Number(row.call_sound_volume ?? 80);

    return {
      theme: VALID_THEMES.has(row.theme) ? row.theme : "dark",
      messageDisplay: row.message_display === "compact" ? "compact" : "cozy",
      fontScale: Number(row.font_scale || 1),
      joinSoundEnabled: joinEnabled,
      leaveSoundEnabled: leaveEnabled,
      muteSoundEnabled: muteEnabled,
      unmuteSoundEnabled: unmuteEnabled,
      joinSoundPreset: joinPreset,
      leaveSoundPreset: leavePreset,
      muteSoundPreset: mutePreset,
      unmuteSoundPreset: unmutePreset,
      joinSoundCustomUrl: joinCustomUrl,
      leaveSoundCustomUrl: leaveCustomUrl,
      muteSoundCustomUrl: muteCustomUrl,
      unmuteSoundCustomUrl: unmuteCustomUrl,
      joinSoundCustomName: joinCustomName,
      leaveSoundCustomName: leaveCustomName,
      callJoinSoundEnabled: joinEnabled,
      callLeaveSoundEnabled: leaveEnabled,
      callMuteSoundEnabled: muteEnabled,
      callUnmuteSoundEnabled: unmuteEnabled,
      callJoinSoundPreset: joinPreset,
      callLeaveSoundPreset: leavePreset,
      callMuteSoundPreset: mutePreset,
      callUnmuteSoundPreset: unmutePreset,
      callJoinCustomUrl: joinCustomUrl,
      callLeaveCustomUrl: leaveCustomUrl,
      callMuteCustomUrl: muteCustomUrl,
      callUnmuteCustomUrl: unmuteCustomUrl,
      callSoundVolume: volume,
      voiceInputDeviceId: row.voice_input_device_id || "default",
      voiceOutputDeviceId: row.voice_output_device_id || "default",
      voiceInputVolume: Number(row.voice_input_volume ?? 100),
      voiceOutputVolume: Number(row.voice_output_volume ?? 100),
      minimizeToTray: Boolean(row.minimize_to_tray),
      hardwareAcceleration: Boolean(row.hardware_acceleration)
    };
  }

  getBootstrapState(rawUserId) {
    const userId = this.resolveUserId(rawUserId);
    let meRow = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    if (!meRow) {
      meRow = this.db.prepare(`SELECT * FROM users WHERE id = 'u_davis'`).get();
    }
    if (!meRow) {
      return { isAuthenticated: false };
    }

    const activeUserId = meRow.id;
    const me = this.serializeUser(meRow);
    const settings = this.getPreferences(activeUserId);

    const allUserRows = this.db.prepare(`SELECT * FROM users`).all();
    const usersMap = {};
    for (const u of allUserRows) {
      usersMap[u.id] = u.id === activeUserId ? this.serializeUser(u) : this.serializePublicUser(u);
    }

    const noteRows = this.db.prepare(`SELECT target_id, note FROM user_notes WHERE owner_id = ?`).all(activeUserId);
    const userNotes = {};
    for (const n of noteRows) {
      userNotes[n.target_id] = n.note;
    }

    const friendRows = this.db
      .prepare(`SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ? ORDER BY updated_at DESC`)
      .all(activeUserId, activeUserId);

    const friends = [];
    for (const f of friendRows) {
      const otherId = f.requester_id === activeUserId ? f.addressee_id : f.requester_id;
      if (!usersMap[otherId]) continue;
      let relation = "friend";
      if (f.status === "accepted") {
        relation = "friend";
      } else if (f.status === "blocked") {
        if (f.requester_id === activeUserId) relation = "blocked";
        else continue;
      } else if (f.status === "pending") {
        relation = f.requester_id === activeUserId ? "outgoing" : "incoming";
      }
      friends.push({
        friendshipId: f.id,
        userId: otherId,
        relation,
        updatedAt: f.updated_at
      });
    }

    const dmRows = this.db
      .prepare(`SELECT * FROM dm_channels WHERE user1_id = ? OR user2_id = ? ORDER BY updated_at DESC`)
      .all(activeUserId, activeUserId);

    const dms = [];
    const messagesMap = {};
    for (const dm of dmRows) {
      const otherId = dm.user1_id === activeUserId ? dm.user2_id : dm.user1_id;
      if (!usersMap[otherId]) continue;
      dms.push({
        id: dm.id,
        userId: otherId,
        unreadCount: 0,
        lastMessageAt: this.formatTimeLabel(dm.updated_at)
      });
      messagesMap[dm.id] = this.getChannelMessages(dm.id);
    }

    const memberGuildRows = this.db
      .prepare(
        `SELECT g.* FROM guilds g
         INNER JOIN guild_members gm ON gm.guild_id = g.id
         WHERE gm.user_id = ?
         ORDER BY g.created_at ASC`
      )
      .all(activeUserId);

    const guilds = memberGuildRows.map((g) => this.serializeGuild(g, messagesMap));

    const publicGuildRows = this.db.prepare(`SELECT * FROM guilds WHERE is_public = 1 ORDER BY created_at DESC`).all();
    const discoverableGuilds = publicGuildRows.map((g) => {
      const memberCount = this.db
        .prepare(`SELECT COUNT(*) AS cnt FROM guild_members WHERE guild_id = ?`)
        .get(g.id).cnt;
      return {
        id: g.id,
        name: g.name,
        shortName: g.short_name,
        category: g.category || "Science & Tech",
        iconColor: g.icon_color,
        bannerColor: g.icon_color,
        description: g.description || `Public server owned by @${usersMap[g.owner_id]?.username || "user"}.`,
        membersCount: String(memberCount),
        onlineCount: String(memberCount),
        isMember: guilds.some((mg) => mg.id === g.id)
      };
    });

    const activeScreenShares = [];
    for (const [chId, share] of this.screenShares.entries()) {
      activeScreenShares.push({
        channelId: chId,
        guildId: share.guildId || "g_rea",
        userId: share.sharerId,
        sharerId: share.sharerId,
        sharerName: usersMap[share.sharerId]?.displayName || "User",
        sharerUsername: usersMap[share.sharerId]?.username || "user",
        sourceId: share.sourceId || "screen:0:0",
        sourceName: share.sourceName || "Entire Screen",
        resolution: share.resolution || "720p",
        fps: share.fps || 15,
        hasSystemAudio: Boolean(share.hasSystemAudio),
        startedAt: share.startedAt,
        frameDataUrl: share.frameDataUrl || null
      });
    }

    return {
      isAuthenticated: true,
      currentUserId: activeUserId,
      currentUser: me,
      settings,
      users: usersMap,
      userNotes,
      friends,
      dms,
      guilds,
      discoverableGuilds,
      messages: messagesMap,
      activeScreenShares,
      appConfig: { appName: this.config.appName, publicUrl: this.getPublicBaseUrl() }
    };
  }

  getMemberPermissions(guildId, userId) {
    const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(guildId);
    if (!guild) return new Set();
    if (guild.owner_id === userId) {
      return new Set([
        "ADMINISTRATOR",
        "MANAGE_SERVER",
        "MANAGE_ROLES",
        "MANAGE_CHANNELS",
        "KICK_MEMBERS",
        "BAN_MEMBERS",
        "SEND_MESSAGES",
        "CONNECT_VOICE",
        "SPEAK_VOICE",
        "STREAM_VIDEO",
        "CREATE_INSTANT_INVITE"
      ]);
    }
    const member = this.db.prepare(`SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
    if (!member) return new Set();
    const roleIds = JSON.parse(member.roles_json || "[]");
    const perms = new Set();
    for (const rId of roleIds) {
      const r = this.db.prepare(`SELECT * FROM guild_roles WHERE id = ? AND guild_id = ?`).get(rId, guildId);
      if (r) {
        const pList = JSON.parse(r.permissions_json || "[]");
        for (const p of pList) perms.add(p);
      }
    }
    if (perms.has("ADMINISTRATOR")) {
      return new Set([
        "ADMINISTRATOR",
        "MANAGE_SERVER",
        "MANAGE_ROLES",
        "MANAGE_CHANNELS",
        "KICK_MEMBERS",
        "BAN_MEMBERS",
        "SEND_MESSAGES",
        "CONNECT_VOICE",
        "SPEAK_VOICE",
        "STREAM_VIDEO",
        "CREATE_INSTANT_INVITE"
      ]);
    }
    return perms;
  }

  getMemberHighestRolePosition(guildId, userId) {
    const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(guildId);
    if (!guild) return 0;
    if (guild.owner_id === userId) return 999999;
    const member = this.db.prepare(`SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
    if (!member) return 0;
    const roleIds = JSON.parse(member.roles_json || "[]");
    let maxPos = 0;
    for (const rId of roleIds) {
      const r = this.db.prepare(`SELECT position FROM guild_roles WHERE id = ? AND guild_id = ?`).get(rId, guildId);
      if (r && Number(r.position || 0) > maxPos) maxPos = Number(r.position);
    }
    return maxPos;
  }

  serializeGuild(g, messagesMap = null) {
    const roles = this.db
      .prepare(`SELECT * FROM guild_roles WHERE guild_id = ? ORDER BY position DESC, name ASC`)
      .all(g.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        hoist: Boolean(r.hoist),
        position: Number(r.position || 0),
        permissions: JSON.parse(r.permissions_json || "[]")
      }));

    const members = this.db
      .prepare(`SELECT * FROM guild_members WHERE guild_id = ?`)
      .all(g.id)
      .map((m) => ({
        userId: m.user_id,
        roles: JSON.parse(m.roles_json || "[]"),
        joinedAt: m.joined_at
      }));

    const memberIds = members.map((m) => m.userId);

    const categories = this.db
      .prepare(`SELECT * FROM channel_categories WHERE guild_id = ? ORDER BY position ASC`)
      .all(g.id)
      .map((c) => ({ id: c.id, name: c.name }));

    const channels = this.db
      .prepare(`SELECT * FROM channels WHERE guild_id = ? ORDER BY position ASC`)
      .all(g.id)
      .map((c) => {
        if (messagesMap && c.type !== "voice") {
          messagesMap[c.id] = this.getChannelMessages(c.id);
        }
        const roomMap = this.voiceRooms.get(c.id);
        const connectedUsers = roomMap ? Array.from(roomMap.keys()) : [];
        const voiceParticipants = roomMap ? Array.from(roomMap.values()) : [];
        return {
          id: c.id,
          categoryId: c.category_id,
          name: c.name,
          type: c.type,
          topic: c.topic || "",
          unread: false,
          mentions: 0,
          connectedUsers,
          voiceParticipants
        };
      });

    const auditLog = this.db
      .prepare(
        `SELECT a.*, u.display_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.guild_id = ? ORDER BY a.created_at DESC LIMIT 30`
      )
      .all(g.id)
      .map((a) => ({
        id: a.id,
        actor: a.display_name || a.actor_id,
        action: a.action,
        time: a.time_label
      }));

    const invites = this.db
      .prepare(`SELECT * FROM invites WHERE guild_id = ? AND revoked = 0 ORDER BY created_at DESC`)
      .all(g.id)
      .map((inv) => ({
        code: inv.token,
        token: inv.token,
        url: this.buildInviteUrl(inv.token),
        guildId: inv.guild_id,
        channelId: inv.channel_id,
        creatorId: inv.creator_id,
        createdAt: inv.created_at,
        expiresAt: inv.expires_at,
        maxUses: inv.max_uses,
        uses: inv.uses,
        revoked: Boolean(inv.revoked)
      }));

    return {
      id: g.id,
      name: g.name,
      shortName: g.short_name,
      iconColor: g.icon_color,
      iconUrl: this.resolveMediaUrl(g.icon_url),
      bannerUrl: this.resolveMediaUrl(g.banner_url),
      ownerId: g.owner_id,
      isPublic: Boolean(g.is_public),
      category: g.category || "Science & Tech",
      description: g.description || "",
      unread: false,
      mentions: 0,
      collapsedCategories: {},
      roles,
      members,
      memberIds,
      categories,
      channels,
      auditLog,
      invites
    };
  }

  getChannelMessages(channelId, limit = 50) {
    const base = this.port ? `http://127.0.0.1:${this.port}` : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?
        ) ORDER BY created_at ASC`
      )
      .all(channelId, limit);

    return rows.map((m) => {
      let attachment = m.attachment_json ? JSON.parse(m.attachment_json) : null;
      if (attachment && attachment.url && attachment.url.startsWith("/uploads/")) {
        attachment = { ...attachment, url: `${base}${attachment.url}`, dataUrl: `${base}${attachment.url}` };
      }
      return {
        id: m.id,
        authorId: m.author_id,
        timestamp: m.timestamp_label,
        content: m.content,
        replyToId: m.reply_to_id,
        attachment,
        pinned: Boolean(m.pinned),
        edited: Boolean(m.edited),
        reactions: JSON.parse(m.reactions_json || "[]"),
        replies: JSON.parse(m.replies_json || "[]")
      };
    });
  }

  broadcastEvent(type, payload) {
    const frame = `data: ${JSON.stringify({ event: type, type, payload, timestamp: Date.now() })}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(frame);
      } catch (_) {
        this.sseClients.delete(res);
      }
    }
  }

  // Invite links point at our own public URL (app.config.json → publicUrl, or
  // APP_PUBLIC_URL). Until the app is hosted they fall back to this local server,
  // which also serves the invite landing page.
  getPublicBaseUrl() {
    if (this.config.publicUrl) return this.config.publicUrl;
    return this.port ? `http://127.0.0.1:${this.port}` : "";
  }

  buildInviteUrl(token) {
    return `${this.getPublicBaseUrl()}${this.config.invitePath}/${token}`;
  }

  // Accepts a bare code or any invite link (ours, legacy /invite/ or discord.gg)
  extractInviteToken(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    const lastSegment = value.split(/[?#\s]/)[0].split("/").filter(Boolean).pop() || "";
    return /^[A-Za-z0-9_-]{4,64}$/.test(lastSegment) ? lastSegment : "";
  }

  // ==========================================================================
  // Account security: e-mail verification codes
  // With Supabase configured, its email-otp Edge Function generates, e-mails
  // (via Brevo) and checks the code
  // (rows store code_hash = SUPABASE_CODE). Without it, a local code is shown
  // on screen (development mode).
  // ==========================================================================
  hashVerificationCode(id, code) {
    return crypto.createHash("sha256").update(`${id}:${code}`).digest("hex");
  }

  async issueVerificationCode(userId, purpose, target) {
    const now = Date.now();
    const recent = this.db
      .prepare(
        `SELECT created_at FROM verification_codes
         WHERE user_id = ? AND purpose = ? AND consumed = 0 ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId, purpose);
    if (recent && now - recent.created_at < VERIFICATION_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((VERIFICATION_RESEND_COOLDOWN_MS - (now - recent.created_at)) / 1000);
      return { ok: false, status: 429, error: `Aguarde ${wait}s para solicitar um novo código.` };
    }

    const viaSupabase = isSupabaseConfigured(this.config);
    if (viaSupabase) {
      const delivery = await sendEmailCode(this.config, target);
      if (!delivery.delivered) return { ok: false, status: 502, error: delivery.error };
    }

    // Only the newest code for a purpose stays valid
    this.db
      .prepare(`UPDATE verification_codes SET consumed = 1 WHERE user_id = ? AND purpose = ? AND consumed = 0`)
      .run(userId, purpose);

    const id = "vc_" + crypto.randomBytes(8).toString("hex");
    const code = viaSupabase ? null : String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    this.db
      .prepare(
        `INSERT INTO verification_codes (id, user_id, purpose, target, code_hash, attempts, created_at, expires_at, consumed)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0)`
      )
      .run(
        id,
        userId,
        purpose,
        target,
        viaSupabase ? SUPABASE_CODE : this.hashVerificationCode(id, code),
        now,
        now + (viaSupabase ? SUPABASE_CODE_TTL_MS : VERIFICATION_CODE_TTL_MS)
      );

    const result = {
      ok: true,
      channel: "email",
      sentTo: maskEmail(target),
      expiresAt: now + (viaSupabase ? SUPABASE_CODE_TTL_MS : VERIFICATION_CODE_TTL_MS),
      delivered: viaSupabase
    };
    // No e-mail service configured: hand the code back so the flow can be tested locally
    if (!viaSupabase) {
      result.devMode = true;
      result.devCode = code;
      console.log(`[account] ${purpose} code for ${target}: ${code} (Supabase not configured)`);
    }
    return result;
  }

  async checkVerificationCode(userId, purpose, code) {
    const row = this.db
      .prepare(
        `SELECT * FROM verification_codes
         WHERE user_id = ? AND purpose = ? AND consumed = 0 ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId, purpose);
    if (!row) return { ok: false, error: "Nenhum código pendente. Solicite um novo código." };
    if (Date.now() > row.expires_at) {
      this.db.prepare(`UPDATE verification_codes SET consumed = 1 WHERE id = ?`).run(row.id);
      return { ok: false, error: "O código expirou. Solicite um novo." };
    }
    if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) {
      this.db.prepare(`UPDATE verification_codes SET consumed = 1 WHERE id = ?`).run(row.id);
      return { ok: false, error: "Muitas tentativas incorretas. Solicite um novo código." };
    }

    const clean = String(code || "").replace(/\D/g, "");
    let valid;
    if (row.code_hash === SUPABASE_CODE) {
      // Supabase codes are 6–10 digits depending on the project setting
      if (clean.length < 6 || clean.length > 10) {
        valid = false;
      } else {
        const check = await verifyEmailCode(this.config, row.target, clean);
        if (check.unavailable) return { ok: false, error: check.error };
        valid = check.valid;
      }
    } else {
      const expected = Buffer.from(row.code_hash, "hex");
      const candidate = Buffer.from(this.hashVerificationCode(row.id, clean), "hex");
      valid = clean.length === 6 && crypto.timingSafeEqual(expected, candidate);
    }

    if (!valid) {
      this.db.prepare(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
      const left = VERIFICATION_MAX_ATTEMPTS - row.attempts - 1;
      return { ok: false, error: left > 0 ? `Código incorreto. ${left} tentativa(s) restante(s).` : "Código incorreto." };
    }
    this.db.prepare(`UPDATE verification_codes SET consumed = 1 WHERE id = ?`).run(row.id);
    return { ok: true, target: row.target };
  }

  getAccountSecurity(userId) {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    if (!row) return null;
    const pending = this.db
      .prepare(
        `SELECT purpose, target, expires_at FROM verification_codes
         WHERE user_id = ? AND consumed = 0 AND expires_at > ?`
      )
      .all(userId, Date.now());
    const pendingOf = (purpose) => {
      const p = pending.find((item) => item.purpose === purpose);
      if (!p) return null;
      return {
        target: p.target,
        masked: maskEmail(p.target),
        expiresAt: p.expires_at
      };
    };
    return {
      email: row.email,
      emailVerified: Boolean(row.email_verified),
      passwordUpdatedAt: row.password_updated_at || null,
      pendingEmailVerify: pendingOf("email_verify"),
      pendingEmailChange: pendingOf("email_change"),
      providers: { email: isSupabaseConfigured(this.config) }
    };
  }

  requireCurrentPassword(row, password) {
    if (!password) return "Informe sua senha atual.";
    if (!verifyPassword(password, row.password_hash)) return "Senha atual incorreta.";
    return null;
  }

  // ==========================================================================
  // Sessions
  // ==========================================================================
  createSession(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, token_hash, user_id, created_at, last_seen_at, expires_at, revoked)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run("s_" + crypto.randomBytes(8).toString("hex"), hashSessionToken(token), userId, now, now, now + SESSION_TTL_MS);
    return token;
  }

  // Returns the user id behind a valid token, or null
  getSessionUserId(token) {
    if (!token || typeof token !== "string") return null;
    const row = this.db.prepare(`SELECT * FROM sessions WHERE token_hash = ?`).get(hashSessionToken(token));
    const now = Date.now();
    if (!row || row.revoked || row.expires_at <= now) return null;
    if (now - row.last_seen_at > SESSION_TOUCH_INTERVAL_MS) {
      this.db
        .prepare(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`)
        .run(now, now + SESSION_TTL_MS, row.id);
    }
    return row.user_id;
  }

  revokeSession(token) {
    this.db.prepare(`UPDATE sessions SET revoked = 1 WHERE token_hash = ?`).run(hashSessionToken(token));
  }

  revokeOtherSessions(userId, keepToken) {
    this.db
      .prepare(`UPDATE sessions SET revoked = 1 WHERE user_id = ? AND token_hash != ?`)
      .run(userId, hashSessionToken(keepToken));
  }

  // Entry point for every request coming from a client (HTTP or Electron IPC).
  // Public actions run without identity; everything else runs as the session's
  // user, whatever ids the client put in the params.
  async handleClientRequest(action, params = {}, token = null) {
    const clean = { ...(params || {}) };
    for (const key of ACTOR_PARAM_KEYS) delete clean[key];

    if (PUBLIC_ACTIONS.has(action)) {
      const res = await this.handleAction(action, clean);
      if (res.ok && res.user && (action === "login" || action === "AUTH_LOGIN" || action === "register" || action === "AUTH_REGISTER")) {
        res.sessionToken = this.createSession(res.user.id);
        if (this.isEmailGateActive(res.user.id)) {
          // Hold back the app data until the e-mail is confirmed
          delete res.data;
          delete res.snapshot;
          res.emailVerificationRequired = true;
          res.verification = await this.issueVerificationCode(res.user.id, "email_verify", res.user.email);
          // Cooldown hit on a quick re-login: a still-valid code was already sent
          if (!res.verification.ok && res.verification.status === 429) {
            res.verification = { ok: true, alreadySent: true, sentTo: maskEmail(res.user.email) };
          }
        }
      }
      return res;
    }

    const userId = this.getSessionUserId(token);
    if (!userId) {
      return { ok: false, status: 401, code: "UNAUTHENTICATED", error: "Sessão expirada. Entre novamente." };
    }

    if (action === "LOGOUT" || action === "logout") {
      this.revokeSession(token);
      return { ok: true };
    }

    if (this.isEmailGateActive(userId) && !UNVERIFIED_ALLOWED_ACTIONS.has(action)) {
      return {
        ok: false,
        status: 403,
        code: "EMAIL_NOT_VERIFIED",
        error: "Confirme seu e-mail para acessar o app."
      };
    }

    for (const key of ACTOR_PARAM_KEYS) clean[key] = userId;
    const res = await this.handleAction(action, clean);

    // A password change signs out every other device
    if (res.ok && (action === "changePassword" || action === "CHANGE_PASSWORD")) {
      this.revokeOtherSessions(userId, token);
    }
    return res;
  }

  isEmailGateActive(userId) {
    if (!this.config.requireVerifiedEmail) return false;
    const row = this.db.prepare(`SELECT email_verified FROM users WHERE id = ?`).get(userId);
    return Boolean(row) && !row.email_verified;
  }

  handleRpc(action, params = {}, token = null) {
    return this.handleClientRequest(action, params, token);
  }

  async handleAction(action, params = {}) {
    switch (action) {
      case "BOOTSTRAP":
      case "getStateSnapshot": {
        const userId = this.resolveUserId(params.userId || params.actorId);
        const snap = this.getBootstrapState(userId);
        return { ok: true, data: snap, snapshot: snap };
      }

      case "AUTH_LOGIN":
      case "login": {
        const clean = String(params.emailOrUsername || params.email || "")
          .trim()
          .replace(/^@+/, "")
          .toLowerCase();
        const password = String(params.password || "");
        const row = this.db
          .prepare(`SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?`)
          .get(clean, clean);
        if (!row) {
          return { ok: false, code: "ACCOUNT_NOT_FOUND", error: "Conta não encontrada. Verifique seu e-mail/@username ou cadastre-se." };
        }
        const passwordOk = verifyPassword(password, row.password_hash);
        if (!passwordOk) {
          return { ok: false, error: "Senha incorreta." };
        }
        if (passwordOk && isLegacyPasswordHash(row.password_hash)) {
          this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), row.id);
        }
        const snap = this.getBootstrapState(row.id);
        return { ok: true, user: this.serializeUser(row), data: snap, snapshot: snap };
      }

      case "AUTH_REGISTER":
      case "register": {
        const email = String(params.email || "").trim().toLowerCase();
        const displayName = String(params.displayName || params.username || "").trim();
        const password = String(params.password || "");
        const uCheck = validateUsername(params.username);

        if (!email || !email.includes("@")) {
          return { ok: false, error: "Informe um endereço de e-mail válido." };
        }
        if (!uCheck.valid) {
          return { ok: false, error: uCheck.reason };
        }
        if (password.length < 6) {
          return { ok: false, error: "A senha deve ter pelo menos 6 caracteres." };
        }

        const existingEmail = this.db.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).get(email);
        if (existingEmail) {
          return { ok: false, error: "Já existe uma conta cadastrada com este e-mail." };
        }

        const existingUsername = this.db
          .prepare(`SELECT id FROM users WHERE LOWER(username) = ?`)
          .get(uCheck.normalized);
        if (existingUsername) {
          return { ok: false, error: `O identificador @${uCheck.normalized} já está em uso.` };
        }

        const id = "u_" + crypto.randomBytes(6).toString("hex");
        const now = Date.now();
        const createdAt = new Date(now).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        });

        this.db
          .prepare(
            `INSERT INTO users (
              id, email, username, password_hash, display_name, pronouns, about_me,
              custom_status, status, avatar_color, banner_color, banner_type, banner_position,
              badges_json, created_at, updated_at, version
            ) VALUES (?, ?, ?, ?, ?, '', '', '', 'online', '#5865f2', '#5865f2', 'color', 50, '["Active Developer"]', ?, ?, 1)`
          )
          .run(id, email, uCheck.normalized, hashPassword(password), displayName || uCheck.normalized, createdAt, now);

        this.db
          .prepare(`INSERT OR IGNORE INTO user_preferences (user_id, updated_at) VALUES (?, ?)`)
          .run(id, now);

        const defaultGuild = this.db.prepare(`SELECT id FROM guilds WHERE id = 'g_rea'`).get();
        if (defaultGuild) {
          this.db
            .prepare(`INSERT OR IGNORE INTO guild_members (guild_id, user_id, roles_json, joined_at) VALUES ('g_rea', ?, '[]', ?)`)
            .run(id, now);
        }

        const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
        this.broadcastEvent("USER_REGISTERED", { user: this.serializePublicUser(row) });
        const snap = this.getBootstrapState(id);
        return { ok: true, user: this.serializeUser(row), data: snap, snapshot: snap };
      }

      case "CHECK_USERNAME":
      case "checkUsernameAvailability": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const check = validateUsername(params.username);
        if (!check.valid) {
          return {
            ok: true,
            available: false,
            valid: false,
            normalized: check.normalized,
            reason: check.reason,
            message: check.reason
          };
        }
        const conflict = this.db
          .prepare(`SELECT id FROM users WHERE LOWER(username) = ? AND id != ?`)
          .get(check.normalized, actorId);
        if (conflict) {
          const msg = `@${check.normalized} já está em uso por outro usuário.`;
          return {
            ok: true,
            available: false,
            valid: true,
            normalized: check.normalized,
            reason: msg,
            message: msg
          };
        }
        const msg = `@${check.normalized} está disponível!`;
        return {
          ok: true,
          available: true,
          valid: true,
          normalized: check.normalized,
          reason: msg,
          message: msg
        };
      }

      case "UPDATE_USERNAME":
      case "updateUsername": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const targetUserId = this.resolveUserId(params.targetUserId || actorId);
        const candidateUsername = params.username !== undefined ? params.username : params.newUsername;
        const expectedVersion = params.expectedVersion;

        if (!actorId || actorId !== targetUserId) {
          return { ok: false, status: 403, error: "Proibido: você só pode alterar seu próprio @username." };
        }
        const check = validateUsername(candidateUsername);
        if (!check.valid) {
          return { ok: false, status: 400, error: check.reason };
        }

        this.db.exec("BEGIN IMMEDIATE");
        try {
          const current = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
          if (!current) {
            this.db.exec("ROLLBACK");
            return { ok: false, status: 404, error: "Conta de usuário não encontrada." };
          }
          if (expectedVersion !== undefined && Number(expectedVersion) !== Number(current.version)) {
            this.db.exec("ROLLBACK");
            return {
              ok: false,
              status: 409,
              error: "Conflito de concorrência: seu perfil foi atualizado em outra sessão."
            };
          }
          const conflict = this.db
            .prepare(`SELECT id FROM users WHERE LOWER(username) = ? AND id != ?`)
            .get(check.normalized, actorId);
          if (conflict) {
            this.db.exec("ROLLBACK");
            return { ok: false, status: 409, error: `O identificador @${check.normalized} já está em uso.` };
          }

          const now = Date.now();
          this.db
            .prepare(`UPDATE users SET username = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
            .run(check.normalized, now, actorId);
          this.db.exec("COMMIT");

          const updatedRow = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
          const serialized = this.serializeUser(updatedRow);
          this.broadcastEvent("USER_UPDATED", { user: this.serializePublicUser(updatedRow) });
          return { ok: true, user: serialized };
        } catch (err) {
          try {
            this.db.exec("ROLLBACK");
          } catch (_) {}
          return { ok: false, status: 500, error: err.message || "Erro ao atualizar @username." };
        }
      }

      case "UPLOAD_MEDIA":
      case "uploadMedia": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const purpose = params.purpose || params.kind || "attachment";
        const { fileName, mimeType, base64Data } = params;
        if (!actorId) return { ok: false, error: "Autenticação necessária para enviar arquivos." };
        const userRow = this.db.prepare(`SELECT id FROM users WHERE id = ?`).get(actorId);
        if (!userRow) return { ok: false, error: "Sessão de usuário inválida." };

        if (!base64Data || typeof base64Data !== "string") {
          return { ok: false, error: "Conteúdo de arquivo ausente." };
        }
        const cleanBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
        const buffer = Buffer.from(cleanBase64, "base64");

        const sig = detectFileSignature(buffer, mimeType, purpose);
        if (!sig.ok) {
          return { ok: false, error: sig.error };
        }

        const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24);
        const storedFileName = `${purpose}_${hash}.${sig.ext}`;
        const fullPath = path.join(this.uploadsDir, storedFileName);
        fs.writeFileSync(fullPath, buffer);

        const relativeUrl = `/uploads/${storedFileName}`;
        const absoluteUrl = this.port ? `http://127.0.0.1:${this.port}${relativeUrl}` : relativeUrl;
        return {
          ok: true,
          relativeUrl,
          url: absoluteUrl,
          mimeType: sig.mime,
          isGif: Boolean(sig.isGif),
          bytes: buffer.length,
          originalName: fileName || storedFileName
        };
      }

      case "UPDATE_PROFILE":
      case "updateProfile": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const targetUserId = this.resolveUserId(params.targetUserId || actorId);
        if (!actorId || actorId !== targetUserId) {
          return { ok: false, status: 403, error: "Proibido: você só pode editar seu próprio perfil." };
        }
        const current = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
        if (!current) return { ok: false, error: "Usuário não encontrado." };

        const displayName =
          params.displayName !== undefined && params.displayName !== null
            ? String(params.displayName).trim()
            : current.display_name;
        if (!displayName) {
          return { ok: false, error: "O Nome de Exibição não pode ficar vazio." };
        }

        const pronouns = params.pronouns !== undefined ? String(params.pronouns).trim() : current.pronouns;
        const aboutMe = params.aboutMe !== undefined ? String(params.aboutMe).trim() : current.about_me;
        const customStatus =
          params.customStatus !== undefined && params.customStatus !== null
            ? String(params.customStatus).trim()
            : current.custom_status;
        const status = params.status || current.status;
        const avatarColor = params.avatarColor || current.avatar_color;

        const normalizeStoredUrl = (u) => {
          if (u === null || u === "") return null;
          if (typeof u === "string" && u.includes("/uploads/")) {
            return "/uploads/" + u.split("/uploads/")[1];
          }
          return u;
        };

        const avatarUrl =
          params.avatarUrl !== undefined ? normalizeStoredUrl(params.avatarUrl) : current.avatar_url;
        const bannerColor = params.bannerColor || current.banner_color;
        const bannerUrl =
          params.bannerUrl !== undefined ? normalizeStoredUrl(params.bannerUrl) : current.banner_url;
        const bannerType = params.bannerType || (bannerUrl ? "image" : "color");
        const rawPos = params.bannerPositionY !== undefined ? params.bannerPositionY : params.bannerPosition;
        const bannerPosition =
          rawPos !== undefined && rawPos !== null
            ? Math.max(0, Math.min(100, Number(rawPos) || 50))
            : (current.banner_position ?? 50);
        const avatarScale =
          params.avatarScale !== undefined
            ? Math.max(1, Math.min(3, Number(params.avatarScale) || 1))
            : (current.avatar_scale ?? 1.0);
        const avatarCropX =
          params.avatarCropX !== undefined ? Number(params.avatarCropX) || 0 : (current.avatar_crop_x ?? 0.0);
        const avatarCropY =
          params.avatarCropY !== undefined ? Number(params.avatarCropY) || 0 : (current.avatar_crop_y ?? 0.0);
        const bannerScale =
          params.bannerScale !== undefined
            ? Math.max(1, Math.min(3, Number(params.bannerScale) || 1))
            : (current.banner_scale ?? 1.0);
        const bannerCropX =
          params.bannerCropX !== undefined ? Number(params.bannerCropX) || 0 : (current.banner_crop_x ?? 0.0);
        const bannerCropY =
          params.bannerCropY !== undefined ? Number(params.bannerCropY) || 0 : (current.banner_crop_y ?? 0.0);

        const now = Date.now();
        this.db
          .prepare(
            `UPDATE users SET
              display_name = ?,
              pronouns = ?,
              about_me = ?,
              custom_status = ?,
              status = ?,
              avatar_color = ?,
              avatar_url = ?,
              banner_color = ?,
              banner_url = ?,
              banner_type = ?,
              banner_position = ?,
              avatar_scale = ?,
              avatar_crop_x = ?,
              avatar_crop_y = ?,
              banner_scale = ?,
              banner_crop_x = ?,
              banner_crop_y = ?,
              updated_at = ?,
              version = version + 1
            WHERE id = ?`
          )
          .run(
            displayName,
            pronouns,
            aboutMe,
            customStatus,
            status,
            avatarColor,
            avatarUrl,
            bannerColor,
            bannerUrl,
            bannerType,
            bannerPosition,
            avatarScale,
            avatarCropX,
            avatarCropY,
            bannerScale,
            bannerCropX,
            bannerCropY,
            now,
            actorId
          );

        const updated = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
        this.broadcastEvent("USER_UPDATED", { user: this.serializePublicUser(updated) });
        return { ok: true, user: this.serializeUser(updated) };
      }

      case "SAVE_USER_NOTE":
      case "saveUserNote": {
        const ownerId = this.resolveUserId(params.ownerId || params.actorId || params.userId);
        const targetId = params.targetId || params.targetUserId;
        const note = String(params.note ?? "");
        if (!ownerId || !targetId) return { ok: false, error: "Parâmetros de nota inválidos." };
        this.db
          .prepare(
            `INSERT INTO user_notes (owner_id, target_id, note) VALUES (?, ?, ?)
             ON CONFLICT(owner_id, target_id) DO UPDATE SET note = excluded.note`
          )
          .run(ownerId, targetId, note);
        return { ok: true };
      }

      case "UPDATE_PREFERENCES":
      case "updatePreferences": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        if (!actorId) return { ok: false, error: "Autenticação necessária." };
        const incoming = params.preferences ? { ...params, ...params.preferences } : params;
        const current = this.getPreferences(actorId);

        const nextTheme = incoming.theme !== undefined ? incoming.theme : current.theme;
        if (!VALID_THEMES.has(nextTheme)) {
          return { ok: false, error: `Tema não suportado: "${nextTheme}".` };
        }

        const normalizeStoredUrl = (u) => {
          if (u === null || u === "") return null;
          if (typeof u === "string" && u.includes("/uploads/")) {
            return "/uploads/" + u.split("/uploads/")[1];
          }
          return u;
        };

        const joinEnabledRaw =
          incoming.joinSoundEnabled !== undefined
            ? incoming.joinSoundEnabled
            : incoming.callJoinSoundEnabled;
        const leaveEnabledRaw =
          incoming.leaveSoundEnabled !== undefined
            ? incoming.leaveSoundEnabled
            : incoming.callLeaveSoundEnabled;
        const joinPresetRaw =
          incoming.joinSoundPreset !== undefined
            ? incoming.joinSoundPreset
            : incoming.callJoinSoundPreset;
        const leavePresetRaw =
          incoming.leaveSoundPreset !== undefined
            ? incoming.leaveSoundPreset
            : incoming.callLeaveSoundPreset;
        const joinUrlRaw =
          incoming.joinSoundCustomUrl !== undefined
            ? incoming.joinSoundCustomUrl
            : incoming.callJoinCustomUrl;
        const leaveUrlRaw =
          incoming.leaveSoundCustomUrl !== undefined
            ? incoming.leaveSoundCustomUrl
            : incoming.callLeaveCustomUrl;

        const muteEnabledRaw =
          incoming.muteSoundEnabled !== undefined
            ? incoming.muteSoundEnabled
            : incoming.callMuteSoundEnabled;
        const unmuteEnabledRaw =
          incoming.unmuteSoundEnabled !== undefined
            ? incoming.unmuteSoundEnabled
            : incoming.callUnmuteSoundEnabled;
        const mutePresetRaw =
          incoming.muteSoundPreset !== undefined
            ? incoming.muteSoundPreset
            : incoming.callMuteSoundPreset;
        const unmutePresetRaw =
          incoming.unmuteSoundPreset !== undefined
            ? incoming.unmuteSoundPreset
            : incoming.callUnmuteSoundPreset;
        const muteUrlRaw =
          incoming.muteSoundCustomUrl !== undefined
            ? incoming.muteSoundCustomUrl
            : incoming.callMuteCustomUrl;
        const unmuteUrlRaw =
          incoming.unmuteSoundCustomUrl !== undefined
            ? incoming.unmuteSoundCustomUrl
            : incoming.callUnmuteCustomUrl;

        const merged = {
          theme: nextTheme,
          messageDisplay:
            incoming.messageDisplay !== undefined ? incoming.messageDisplay : current.messageDisplay,
          fontScale: incoming.fontScale !== undefined ? Number(incoming.fontScale) : current.fontScale,
          callJoinSoundEnabled:
            joinEnabledRaw !== undefined ? Boolean(joinEnabledRaw) : current.callJoinSoundEnabled,
          callLeaveSoundEnabled:
            leaveEnabledRaw !== undefined ? Boolean(leaveEnabledRaw) : current.callLeaveSoundEnabled,
          callJoinSoundPreset:
            joinPresetRaw !== undefined ? String(joinPresetRaw) : current.callJoinSoundPreset,
          callLeaveSoundPreset:
            leavePresetRaw !== undefined ? String(leavePresetRaw) : current.callLeaveSoundPreset,
          callJoinCustomUrl:
            joinUrlRaw !== undefined
              ? normalizeStoredUrl(joinUrlRaw)
              : normalizeStoredUrl(current.callJoinCustomUrl),
          callLeaveCustomUrl:
            leaveUrlRaw !== undefined
              ? normalizeStoredUrl(leaveUrlRaw)
              : normalizeStoredUrl(current.callLeaveCustomUrl),
          callJoinCustomName:
            incoming.joinSoundCustomName !== undefined
              ? String(incoming.joinSoundCustomName)
              : current.joinSoundCustomName,
          callLeaveCustomName:
            incoming.leaveSoundCustomName !== undefined
              ? String(incoming.leaveSoundCustomName)
              : current.leaveSoundCustomName,
          callSoundVolume:
            incoming.callSoundVolume !== undefined
              ? Math.max(0, Math.min(100, Number(incoming.callSoundVolume)))
              : current.callSoundVolume,
          callMuteSoundEnabled:
            muteEnabledRaw !== undefined ? Boolean(muteEnabledRaw) : current.callMuteSoundEnabled,
          callUnmuteSoundEnabled:
            unmuteEnabledRaw !== undefined ? Boolean(unmuteEnabledRaw) : current.callUnmuteSoundEnabled,
          callMuteSoundPreset:
            mutePresetRaw !== undefined ? String(mutePresetRaw) : current.callMuteSoundPreset,
          callUnmuteSoundPreset:
            unmutePresetRaw !== undefined ? String(unmutePresetRaw) : current.callUnmuteSoundPreset,
          callMuteCustomUrl:
            muteUrlRaw !== undefined
              ? normalizeStoredUrl(muteUrlRaw)
              : normalizeStoredUrl(current.callMuteCustomUrl),
          callUnmuteCustomUrl:
            unmuteUrlRaw !== undefined
              ? normalizeStoredUrl(unmuteUrlRaw)
              : normalizeStoredUrl(current.callUnmuteCustomUrl),
          voiceInputDeviceId:
            incoming.voiceInputDeviceId !== undefined ? String(incoming.voiceInputDeviceId) : current.voiceInputDeviceId,
          voiceOutputDeviceId:
            incoming.voiceOutputDeviceId !== undefined ? String(incoming.voiceOutputDeviceId) : current.voiceOutputDeviceId,
          voiceInputVolume:
            incoming.voiceInputVolume !== undefined ? Math.max(0, Math.min(100, Number(incoming.voiceInputVolume))) : current.voiceInputVolume,
          voiceOutputVolume:
            incoming.voiceOutputVolume !== undefined ? Math.max(0, Math.min(100, Number(incoming.voiceOutputVolume))) : current.voiceOutputVolume,
          minimizeToTray:
            incoming.minimizeToTray !== undefined ? Boolean(incoming.minimizeToTray) : current.minimizeToTray,
          hardwareAcceleration:
            incoming.hardwareAcceleration !== undefined
              ? Boolean(incoming.hardwareAcceleration)
              : current.hardwareAcceleration
        };

        const now = Date.now();
        this.db
          .prepare(
            `UPDATE user_preferences SET
              theme = ?,
              message_display = ?,
              font_scale = ?,
              call_join_sound_enabled = ?,
              call_leave_sound_enabled = ?,
              call_join_sound_preset = ?,
              call_leave_sound_preset = ?,
              call_join_custom_url = ?,
              call_leave_custom_url = ?,
              call_join_custom_name = ?,
              call_leave_custom_name = ?,
              call_sound_volume = ?,
              call_mute_sound_enabled = ?,
              call_unmute_sound_enabled = ?,
              call_mute_sound_preset = ?,
              call_unmute_sound_preset = ?,
              call_mute_custom_url = ?,
              call_unmute_custom_url = ?,
              voice_input_device_id = ?,
              voice_output_device_id = ?,
              voice_input_volume = ?,
              voice_output_volume = ?,
              minimize_to_tray = ?,
              hardware_acceleration = ?,
              updated_at = ?
            WHERE user_id = ?`
          )
          .run(
            merged.theme,
            merged.messageDisplay,
            merged.fontScale,
            merged.callJoinSoundEnabled ? 1 : 0,
            merged.callLeaveSoundEnabled ? 1 : 0,
            merged.callJoinSoundPreset,
            merged.callLeaveSoundPreset,
            merged.callJoinCustomUrl,
            merged.callLeaveCustomUrl,
            merged.callJoinCustomName,
            merged.callLeaveCustomName,
            merged.callSoundVolume,
            merged.callMuteSoundEnabled ? 1 : 0,
            merged.callUnmuteSoundEnabled ? 1 : 0,
            merged.callMuteSoundPreset,
            merged.callUnmuteSoundPreset,
            merged.callMuteCustomUrl,
            merged.callUnmuteCustomUrl,
            merged.voiceInputDeviceId,
            merged.voiceOutputDeviceId,
            merged.voiceInputVolume,
            merged.voiceOutputVolume,
            merged.minimizeToTray ? 1 : 0,
            merged.hardwareAcceleration ? 1 : 0,
            now,
            actorId
          );

        return { ok: true, preferences: this.getPreferences(actorId) };
      }

      case "SEARCH_USERS_BY_USERNAME":
      case "searchUsers": {
        const actorId = this.resolveUserId(params.actorId || params.currentUserId || params.userId);
        if (!actorId) return { ok: false, status: 401, error: "Autenticação necessária para buscar usuários." };
        const clean = normalizeUsername(params.query);
        if (!clean) {
          return { ok: true, query: "", results: [], users: [] };
        }

        const rows = this.db
          .prepare(
            `SELECT * FROM users
             WHERE id != ? AND (LOWER(username) = ? OR LOWER(username) LIKE ?)
             ORDER BY CASE WHEN LOWER(username) = ? THEN 0 ELSE 1 END, username ASC
             LIMIT 10`
          )
          .all(actorId, clean, `%${clean}%`, clean);

        const results = rows.map((r) => {
          const pub = this.serializePublicUser(r);
          let relation = "none";
          const f = this.db
            .prepare(
              `SELECT * FROM friendships
               WHERE (requester_id = ? AND addressee_id = ?)
                  OR (requester_id = ? AND addressee_id = ?)`
            )
            .get(actorId, r.id, r.id, actorId);
          if (f) {
            if (f.status === "accepted") relation = "friend";
            else if (f.status === "blocked") relation = "blocked";
            else if (f.status === "pending") {
              relation = f.requester_id === actorId ? "outgoing" : "incoming";
            }
          }
          return { ...pub, relation, relationship: relation };
        });

        return { ok: true, query: clean, results, users: results };
      }

      case "SEND_FRIEND_REQUEST":
      case "sendFriendRequest": {
        const actorId = this.resolveUserId(params.actorId || params.fromUserId || params.userId);
        const username = params.username || params.targetUsername;
        const targetUserId = params.targetUserId;
        if (!actorId) return { ok: false, status: 401, error: "Autenticação necessária." };

        let targetRow = null;
        if (targetUserId) {
          targetRow = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(targetUserId);
        } else {
          const clean = normalizeUsername(username);
          if (!clean) return { ok: false, error: "Informe um @username válido." };
          targetRow = this.db.prepare(`SELECT * FROM users WHERE LOWER(username) = ?`).get(clean);
        }

        if (!targetRow) {
          return {
            ok: false,
            status: 404,
            error: `Nenhum usuário cadastrado encontrado com @${normalizeUsername(username || "")}.`
          };
        }

        if (targetRow.id === actorId) {
          return { ok: false, status: 400, error: "Você não pode enviar uma solicitação de amizade para si mesmo." };
        }

        const existing = this.db
          .prepare(
            `SELECT * FROM friendships
             WHERE (requester_id = ? AND addressee_id = ?)
                OR (requester_id = ? AND addressee_id = ?)`
          )
          .get(actorId, targetRow.id, targetRow.id, actorId);

        const now = Date.now();
        if (existing) {
          if (existing.status === "accepted") {
            return { ok: false, status: 409, error: `Você já é amigo de @${targetRow.username}.` };
          }
          if (existing.status === "blocked") {
            return { ok: false, status: 403, error: `Não foi possível enviar solicitação para @${targetRow.username}.` };
          }
          if (existing.status === "pending") {
            if (existing.requester_id === actorId) {
              return {
                ok: false,
                status: 409,
                error: `Já existe uma solicitação de amizade pendente para @${targetRow.username}.`
              };
            } else {
              this.db
                .prepare(`UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?`)
                .run(now, existing.id);
              this.broadcastEvent("FRIENDSHIP_UPDATED", { actorId, targetUserId: targetRow.id, status: "accepted" });
              const pubUser = this.serializePublicUser(targetRow);
              return {
                ok: true,
                status: "friend",
                autoAccepted: true,
                user: pubUser,
                targetUser: pubUser,
                message: `Solicitação de @${targetRow.username} aceita!`
              };
            }
          }
        }

        const fId = "fr_" + crypto.randomBytes(6).toString("hex");
        this.db
          .prepare(
            `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
             VALUES (?, ?, ?, 'pending', ?, ?)`
          )
          .run(fId, actorId, targetRow.id, now, now);

        this.broadcastEvent("FRIENDSHIP_UPDATED", { actorId, targetUserId: targetRow.id, status: "pending" });
        const pubUser = this.serializePublicUser(targetRow);
        return {
          ok: true,
          status: "outgoing",
          autoAccepted: false,
          user: pubUser,
          targetUser: pubUser,
          message: `Solicitação de amizade enviada para @${targetRow.username}!`
        };
      }

      case "RESPOND_FRIEND_REQUEST":
      case "respondFriendRequest":
      case "removeOrBlockFriend": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const otherUserId = params.otherUserId || params.targetUserId;
        const responseAction = params.responseAction || params.action || "accept";
        if (!actorId || !otherUserId) return { ok: false, error: "Parâmetros inválidos." };

        const existing = this.db
          .prepare(
            `SELECT * FROM friendships
             WHERE (requester_id = ? AND addressee_id = ?)
                OR (requester_id = ? AND addressee_id = ?)`
          )
          .get(actorId, otherUserId, otherUserId, actorId);

        const now = Date.now();
        if (responseAction === "accept") {
          if (!existing || existing.status !== "pending") {
            return { ok: false, error: "Nenhuma solicitação de amizade pendente encontrada." };
          }
          this.db.prepare(`UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?`).run(now, existing.id);
        } else if (
          responseAction === "decline" ||
          responseAction === "cancel" ||
          responseAction === "remove" ||
          responseAction === "unblock"
        ) {
          if (existing) {
            this.db.prepare(`DELETE FROM friendships WHERE id = ?`).run(existing.id);
          }
        } else if (responseAction === "block") {
          if (existing) {
            this.db
              .prepare(`UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'blocked', updated_at = ? WHERE id = ?`)
              .run(actorId, otherUserId, now, existing.id);
          } else {
            this.db
              .prepare(
                `INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at)
                 VALUES (?, ?, ?, 'blocked', ?, ?)`
              )
              .run("fr_" + crypto.randomBytes(6).toString("hex"), actorId, otherUserId, now, now);
          }
        }

        this.broadcastEvent("FRIENDSHIP_UPDATED", { actorId, targetUserId: otherUserId, status: responseAction });
        return { ok: true };
      }

      case "OPEN_OR_CREATE_DM":
      case "openOrCreateDm": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const targetUserId = params.targetUserId;
        if (!actorId || !targetUserId) return { ok: false, error: "IDs de usuário ausentes." };
        const [u1, u2] = [actorId, targetUserId].sort();
        let dm = this.db
          .prepare(`SELECT * FROM dm_channels WHERE user1_id = ? AND user2_id = ?`)
          .get(u1, u2);
        const now = Date.now();
        if (!dm) {
          const dmId = "dm_" + crypto.randomBytes(6).toString("hex");
          this.db
            .prepare(`INSERT INTO dm_channels (id, user1_id, user2_id, updated_at) VALUES (?, ?, ?, ?)`)
            .run(dmId, u1, u2, now);
          dm = { id: dmId, user1_id: u1, user2_id: u2, updated_at: now };
        }
        return { ok: true, dmId: dm.id };
      }

      case "SEND_MESSAGE":
      case "sendMessage": {
        const actorId = this.resolveUserId(params.actorId || params.authorId || params.userId);
        const { channelId, content, replyToId, attachment } = params;
        if (!actorId || !channelId) return { ok: false, error: "Canal ou autor ausente." };
        const text = String(content || "").trim();
        if (!text && !attachment) return { ok: false, error: "A mensagem não pode ficar vazia." };

        const now = Date.now();
        const msgId = "m_" + crypto.randomBytes(6).toString("hex");
        const tsLabel = this.formatTimeLabel(now);
        const storedAtt = attachment
          ? JSON.stringify({
              name: attachment.name,
              size: attachment.size,
              isImage: Boolean(attachment.isImage),
              url: attachment.relativeUrl || attachment.url || attachment.dataUrl
            })
          : null;

        this.db
          .prepare(
            `INSERT INTO messages (
              id, channel_id, author_id, content, reply_to_id, attachment_json,
              pinned, edited, reactions_json, replies_json, created_at, timestamp_label
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, '[]', '[]', ?, ?)`
          )
          .run(msgId, channelId, actorId, text, replyToId || null, storedAtt, now, tsLabel);

        const messageObj = {
          id: msgId,
          authorId: actorId,
          timestamp: tsLabel,
          content: text,
          replyToId: replyToId || null,
          attachment: attachment || null,
          pinned: false,
          edited: false,
          reactions: [],
          replies: []
        };

        this.broadcastEvent("MESSAGE_CREATED", { channelId, messageId: msgId });
        return { ok: true, messageId: msgId, message: messageObj };
      }

      case "EDIT_MESSAGE":
      case "editMessage": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { messageId, newContent } = params;
        const msg = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId);
        if (!msg) return { ok: false, error: "Mensagem não encontrada." };
        if (msg.author_id !== actorId) return { ok: false, error: "Você só pode editar suas próprias mensagens." };
        const clean = String(newContent || "").trim();
        if (!clean) return { ok: false, error: "O conteúdo não pode ficar vazio." };
        this.db.prepare(`UPDATE messages SET content = ?, edited = 1 WHERE id = ?`).run(clean, messageId);
        this.broadcastEvent("MESSAGE_UPDATED", { channelId: msg.channel_id, messageId });
        return { ok: true };
      }

      case "DELETE_MESSAGE":
      case "deleteMessage": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { messageId } = params;
        const msg = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId);
        if (!msg) return { ok: false, error: "Mensagem não encontrada." };
        if (msg.author_id !== actorId) return { ok: false, error: "Permissão negada." };
        this.db.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);
        this.broadcastEvent("MESSAGE_DELETED", { channelId: msg.channel_id, messageId });
        return { ok: true };
      }

      case "TOGGLE_PIN_MESSAGE":
      case "togglePinMessage": {
        const { messageId } = params;
        const msg = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId);
        if (!msg) return { ok: false, error: "Mensagem não encontrada." };
        const nextPin = msg.pinned ? 0 : 1;
        this.db.prepare(`UPDATE messages SET pinned = ? WHERE id = ?`).run(nextPin, messageId);
        this.broadcastEvent("MESSAGE_UPDATED", { channelId: msg.channel_id, messageId });
        return { ok: true, pinned: Boolean(nextPin) };
      }

      case "TOGGLE_REACTION":
      case "toggleReaction": {
        const { messageId, emoji } = params;
        const msg = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId);
        if (!msg) return { ok: false, error: "Mensagem não encontrada." };
        let reactions = JSON.parse(msg.reactions_json || "[]");
        const existing = reactions.find((r) => r.emoji === emoji);
        if (existing) {
          if (existing.me) {
            existing.count -= 1;
            existing.me = false;
            if (existing.count <= 0) reactions = reactions.filter((r) => r.emoji !== emoji);
          } else {
            existing.count += 1;
            existing.me = true;
          }
        } else {
          reactions.push({ emoji, count: 1, me: true });
        }
        this.db.prepare(`UPDATE messages SET reactions_json = ? WHERE id = ?`).run(JSON.stringify(reactions), messageId);
        return { ok: true };
      }

      case "SEND_THREAD_REPLY":
      case "sendThreadReply": {
        const actorId = this.resolveUserId(params.actorId || params.authorId || params.userId);
        const { parentMessageId, content } = params;
        const msg = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(parentMessageId);
        if (!msg) return { ok: false, error: "Mensagem original não encontrada." };
        const clean = String(content || "").trim();
        if (!clean) return { ok: false, error: "A resposta não pode ficar vazia." };
        const replies = JSON.parse(msg.replies_json || "[]");
        replies.push({
          id: "th_" + crypto.randomBytes(5).toString("hex"),
          authorId: actorId,
          timestamp: this.formatTimeLabel(),
          content: clean
        });
        this.db.prepare(`UPDATE messages SET replies_json = ? WHERE id = ?`).run(JSON.stringify(replies), parentMessageId);
        this.broadcastEvent("MESSAGE_UPDATED", { channelId: msg.channel_id, messageId: parentMessageId });
        return { ok: true };
      }

      case "CREATE_GUILD":
      case "UPDATE_GUILD":
      case "updateGuild": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId } = params;
        const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(guildId);
        if (!guild) return { ok: false, status: 404, error: "Servidor não encontrado." };
        const perms = this.getMemberPermissions(guildId, actorId);
        if (!perms.has("ADMINISTRATOR") && !perms.has("MANAGE_GUILD") && !perms.has("MANAGE_SERVER")) {
          return { ok: false, status: 403, error: "Permissão insuficiente para editar o servidor." };
        }

        const normalizeStoredUrl = (u) => {
          if (u === null || u === "") return null;
          if (typeof u === "string" && u.includes("/uploads/")) return "/uploads/" + u.split("/uploads/")[1];
          return u;
        };

        let name = guild.name;
        if (params.name !== undefined) {
          name = String(params.name || "").trim();
          if (!name) return { ok: false, status: 400, error: "O nome do servidor não pode ficar vazio." };
          if (name.length > 100) return { ok: false, status: 400, error: "O nome do servidor pode ter no máximo 100 caracteres." };
        }
        const iconUrl = params.iconUrl !== undefined ? normalizeStoredUrl(params.iconUrl) : guild.icon_url;
        const bannerUrl = params.bannerUrl !== undefined ? normalizeStoredUrl(params.bannerUrl) : guild.banner_url;

        this.db
          .prepare(`UPDATE guilds SET name = ?, short_name = ?, icon_url = ?, banner_url = ? WHERE id = ?`)
          .run(name, this.getShortName(name), iconUrl, bannerUrl, guildId);

        const changes = [];
        if (name !== guild.name) changes.push(`renamed the server to "${name}"`);
        if (iconUrl !== guild.icon_url) changes.push(iconUrl ? "updated the server icon" : "removed the server icon");
        if (bannerUrl !== guild.banner_url) changes.push(bannerUrl ? "updated the server banner" : "removed the server banner");
        const now = Date.now();
        for (const action of changes) {
          this.db
            .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run("al_" + crypto.randomBytes(6).toString("hex"), guildId, actorId, action, this.formatTimeLabel(now), now);
        }

        this.broadcastEvent("GUILD_UPDATED", { guildId });
        const updated = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(guildId);
        return { ok: true, guild: this.serializeGuild(updated) };
      }

      case "createGuild": {
        const actorId = this.resolveUserId(params.actorId || params.ownerId || params.userId);
        const { name, iconColor, isPublic, category, description } = params;
        if (!actorId) return { ok: false, error: "Autenticação necessária." };
        const created = this.createGuildInternal(actorId, {
          name,
          iconColor,
          isPublic: Boolean(isPublic),
          category: category || "Science & Tech",
          description: description || ""
        });
        this.broadcastEvent("GUILD_CREATED", { guildId: created.guildId });
        return { ok: true, guildId: created.guildId, generalChannelId: created.generalChannelId };
      }

      case "CREATE_CHANNEL":
      case "createChannel": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, name, type, topic, categoryId } = params;
        const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(guildId);
        if (!guild) return { ok: false, error: "Servidor não encontrado." };
        const member = this.db
          .prepare(`SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?`)
          .get(guildId, actorId);
        if (!member) return { ok: false, error: "Permissão negada." };

        const rawName = String(name || "").trim();
        if (!rawName) return { ok: false, error: "O nome do canal é obrigatório." };
        const cleanName = type === "voice" ? rawName : rawName.toLowerCase().replace(/\s+/g, "-");
        const chId = "c_" + crypto.randomBytes(6).toString("hex");
        const targetCat =
          categoryId ||
          this.db
            .prepare(`SELECT id FROM channel_categories WHERE guild_id = ? ORDER BY position ASC LIMIT 1`)
            .get(guildId)?.id ||
          null;

        const chType = type || "text";
        this.db
          .prepare(
            `INSERT INTO channels (id, guild_id, category_id, name, type, topic, position)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(chId, guildId, targetCat, cleanName, chType, topic || "", Date.now());

        this.db
          .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            "al_" + crypto.randomBytes(6).toString("hex"),
            guildId,
            actorId,
            `Created ${chType} channel #${cleanName}`,
            this.formatTimeLabel(),
            Date.now()
          );

        const channelObj = {
          id: chId,
          categoryId: targetCat,
          name: cleanName,
          type: chType,
          topic: topic || "",
          unread: false,
          mentions: 0,
          connectedUsers: []
        };
        return { ok: true, channelId: chId, channel: channelObj };
      }

      case "DELETE_CHANNEL":
      case "deleteChannel": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, channelId } = params;
        const count = this.db.prepare(`SELECT COUNT(*) AS cnt FROM channels WHERE guild_id = ?`).get(guildId).cnt;
        if (count <= 1) return { ok: false, error: "Não é possível excluir o último canal do servidor." };
        const ch = this.db.prepare(`SELECT * FROM channels WHERE id = ? AND guild_id = ?`).get(channelId, guildId);
        if (!ch) return { ok: false, error: "Canal não encontrado." };
        this.db.prepare(`DELETE FROM channels WHERE id = ?`).run(channelId);
        this.db
          .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            "al_" + crypto.randomBytes(6).toString("hex"),
            guildId,
            actorId,
            `Deleted channel #${ch.name}`,
            this.formatTimeLabel(),
            Date.now()
          );
        return { ok: true };
      }

      // Phase 11: Cryptographically random Server Invites
      case "CREATE_INVITE":
      case "createInvite": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, channelId, expiresInSeconds, maxUses, reuseExisting } = params;
        if (!actorId || !guildId) return { ok: false, status: 400, error: "Servidor ou usuário ausente." };

        const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(guildId);
        if (!guild) return { ok: false, status: 404, error: "Servidor não encontrado." };

        const member = this.db
          .prepare(`SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?`)
          .get(guildId, actorId);
        if (!member) {
          return { ok: false, status: 403, error: "Apenas membros autorizados do servidor podem gerar convites." };
        }

        const now = Date.now();
        if (reuseExisting) {
          const existing = this.db
            .prepare(
              `SELECT * FROM invites
               WHERE guild_id = ? AND creator_id = ? AND revoked = 0
                 AND (expires_at IS NULL OR expires_at > ?)
                 AND (max_uses = 0 OR uses < max_uses)
               ORDER BY created_at DESC LIMIT 1`
            )
            .get(guildId, actorId, now);
          if (existing) {
            return {
              ok: true,
              reused: true,
              invite: {
                code: existing.token,
                token: existing.token,
                url: this.buildInviteUrl(existing.token),
                guildId: existing.guild_id,
                channelId: existing.channel_id,
                expiresAt: existing.expires_at,
                maxUses: existing.max_uses,
                uses: existing.uses
              }
            };
          }
        }

        // Generate unpredictable 16-char base64url cryptographic token (96 bits entropy)
        const token = crypto.randomBytes(12).toString("base64url");
        const targetChannel =
          channelId ||
          this.db.prepare(`SELECT id FROM channels WHERE guild_id = ? ORDER BY position ASC LIMIT 1`).get(guildId)?.id ||
          "c_general";
        const expiresAt =
          expiresInSeconds && Number(expiresInSeconds) > 0 ? now + Number(expiresInSeconds) * 1000 : null;
        const maxUsesVal = maxUses ? Math.max(0, Number(maxUses)) : 0;

        this.db
          .prepare(
            `INSERT INTO invites (token, guild_id, channel_id, creator_id, created_at, expires_at, max_uses, uses, revoked)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`
          )
          .run(token, guildId, targetChannel, actorId, now, expiresAt, maxUsesVal);

        this.db
          .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            "al_" + crypto.randomBytes(6).toString("hex"),
            guildId,
            actorId,
            `Created invite link /invite/${token}`,
            this.formatTimeLabel(now),
            now
          );

        return {
          ok: true,
          reused: false,
          invite: {
            code: token,
            token,
            url: this.buildInviteUrl(token),
            guildId,
            channelId: targetChannel,
            expiresAt,
            maxUses: maxUsesVal,
            uses: 0
          }
        };
      }

      case "GET_GUILD_INVITES":
      case "getGuildInvites": {
        const { guildId } = params;
        const invites = this.db
          .prepare(`SELECT * FROM invites WHERE guild_id = ? AND revoked = 0 ORDER BY created_at DESC`)
          .all(guildId)
          .map((inv) => ({
            code: inv.token,
            token: inv.token,
            url: this.buildInviteUrl(inv.token),
            guildId: inv.guild_id,
            channelId: inv.channel_id,
            creatorId: inv.creator_id,
            createdAt: inv.created_at,
            expiresAt: inv.expires_at,
            maxUses: inv.max_uses,
            uses: inv.uses,
            revoked: Boolean(inv.revoked)
          }));
        return { ok: true, invites };
      }

      case "REVOKE_INVITE":
      case "revokeInvite": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const token = params.token || params.code;
        const inv = this.db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token);
        if (!inv) return { ok: false, status: 404, error: "Convite não encontrado." };
        const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(inv.guild_id);
        if (!guild || (guild.owner_id !== actorId && inv.creator_id !== actorId)) {
          return { ok: false, status: 403, error: "Você não tem permissão para revogar este convite." };
        }
        this.db.prepare(`UPDATE invites SET revoked = 1 WHERE token = ?`).run(token);
        return { ok: true };
      }

      case "INSPECT_INVITE":
      case "inspectInvite": {
        const raw = String(params.tokenOrUrl || params.code || "").trim();
        const token = this.extractInviteToken(raw);
        if (!token) return { ok: false, status: 400, error: "Informe um código ou link de convite válido." };

        const inv = this.db.prepare(`SELECT * FROM invites WHERE token = ?`).get(token);
        if (!inv) {
          return { ok: false, status: 404, error: "Convite inválido: este código não existe." };
        }
        if (inv.revoked) {
          return { ok: false, status: 410, error: "Convite revogado por um administrador do servidor." };
        }
        if (inv.expires_at && Date.now() > inv.expires_at) {
          return { ok: false, status: 410, error: "Convite expirado." };
        }
        if (inv.max_uses > 0 && inv.uses >= inv.max_uses) {
          return { ok: false, status: 410, error: "Limite máximo de usos deste convite atingido." };
        }

        const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(inv.guild_id);
        if (!guild) return { ok: false, status: 404, error: "O servidor não existe mais." };

        const memberCount = this.db
          .prepare(`SELECT COUNT(*) AS cnt FROM guild_members WHERE guild_id = ?`)
          .get(guild.id).cnt;
        const creator = this.db.prepare(`SELECT username, display_name FROM users WHERE id = ?`).get(inv.creator_id);

        return {
          ok: true,
          preview: {
            code: inv.token,
            token: inv.token,
            guildId: guild.id,
            channelId: inv.channel_id,
            guildName: guild.name,
            guildShortName: guild.short_name,
            guildIconColor: guild.icon_color,
            memberCount,
            inviterUsername: creator?.username || "unknown",
            inviterDisplayName: creator?.display_name || "User",
            expiresAt: inv.expires_at
          }
        };
      }

      case "ACCEPT_INVITE":
      case "acceptInvite": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const tokenOrUrl = params.tokenOrUrl || params.code;
        if (!actorId) return { ok: false, status: 401, error: "Faça login para aceitar um convite de servidor." };
        const inspectRes = await this.handleAction("INSPECT_INVITE", { tokenOrUrl });
        if (!inspectRes.ok) return inspectRes;

        const { token, guildId, channelId, guildName } = inspectRes.preview;
        const existingMember = this.db
          .prepare(`SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?`)
          .get(guildId, actorId);

        if (existingMember) {
          return {
            ok: true,
            alreadyMember: true,
            guildId,
            channelId,
            guildName,
            message: `Você já é membro de ${guildName}!`
          };
        }

        const now = Date.now();
        const memberRole = this.db
          .prepare(`SELECT id FROM guild_roles WHERE guild_id = ? AND name = 'Members' LIMIT 1`)
          .get(guildId);
        const rolesJson = memberRole ? JSON.stringify([memberRole.id]) : "[]";

        this.db
          .prepare(`INSERT INTO guild_members (guild_id, user_id, roles_json, joined_at) VALUES (?, ?, ?, ?)`)
          .run(guildId, actorId, rolesJson, now);
        this.db.prepare(`UPDATE invites SET uses = uses + 1 WHERE token = ?`).run(token);
        this.db
          .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            "al_" + crypto.randomBytes(6).toString("hex"),
            guildId,
            actorId,
            `Joined server via invite /invite/${token}`,
            this.formatTimeLabel(now),
            now
          );

        this.broadcastEvent("GUILD_MEMBER_JOINED", { guildId, userId: actorId });
        return {
          ok: true,
          alreadyMember: false,
          guildId,
          channelId,
          guildName,
          message: `Você entrou em ${guildName}!`
        };
      }

      // Join a server listed in Discovery (only public servers, no invite needed)
      case "JOIN_PUBLIC_GUILD":
      case "joinPublicGuild": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const guild = this.db.prepare(`SELECT * FROM guilds WHERE id = ?`).get(params.guildId);
        if (!guild || !guild.is_public) return { ok: false, status: 404, error: "Servidor público não encontrado." };
        const firstChannel = this.db
          .prepare(`SELECT id FROM channels WHERE guild_id = ? ORDER BY position ASC LIMIT 1`)
          .get(guild.id);
        const existing = this.db
          .prepare(`SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?`)
          .get(guild.id, actorId);
        if (!existing) {
          const now = Date.now();
          const memberRole = this.db
            .prepare(`SELECT id FROM guild_roles WHERE guild_id = ? AND name = 'Members' LIMIT 1`)
            .get(guild.id);
          this.db
            .prepare(`INSERT INTO guild_members (guild_id, user_id, roles_json, joined_at) VALUES (?, ?, ?, ?)`)
            .run(guild.id, actorId, memberRole ? JSON.stringify([memberRole.id]) : "[]", now);
          this.broadcastEvent("GUILD_MEMBER_JOINED", { guildId: guild.id, userId: actorId });
        }
        return { ok: true, alreadyMember: Boolean(existing), guildId: guild.id, channelId: firstChannel?.id || null };
      }

      // Phase 9: Voice RTC & Real-Time Screen Sharing Signaling
      case "RTC_JOIN_VOICE":
      case "joinVoiceChannel": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, channelId } = params;
        if (!actorId || !channelId) return { ok: false, error: "Parâmetros de canal de voz inválidos." };

        for (const [chId, room] of this.voiceRooms.entries()) {
          if (room.has(actorId)) {
            room.delete(actorId);
            if (this.screenShares.get(chId)?.sharerId === actorId) {
              this.screenShares.delete(chId);
              this.broadcastEvent("SCREEN_SHARE_STOPPED", { channelId: chId, sharerId: actorId });
            }
            // Let whoever is still in the old room know this user left
            if (chId !== channelId) {
              this.broadcastEvent("RTC_ROOM_UPDATED", { channelId: chId, participants: Array.from(room.values()) });
            }
          }
        }

        if (!this.voiceRooms.has(channelId)) {
          this.voiceRooms.set(channelId, new Map());
        }
        const room = this.voiceRooms.get(channelId);
        room.set(actorId, {
          userId: actorId,
          guildId,
          channelId,
          muted: Boolean(params.muted),
          deafened: Boolean(params.deafened),
          videoEnabled: false,
          screenShareEnabled: false,
          joinedAt: Date.now()
        });

        this.broadcastEvent("RTC_ROOM_UPDATED", {
          channelId,
          participants: Array.from(room.values())
        });

        return {
          ok: true,
          channelId,
          participants: Array.from(room.values()),
          activeScreenShare: this.screenShares.get(channelId) || null
        };
      }

      case "RTC_LEAVE_VOICE":
      case "leaveVoiceChannel": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const affectedChannels = [];
        for (const [chId, room] of this.voiceRooms.entries()) {
          if (room.has(actorId)) {
            room.delete(actorId);
            affectedChannels.push(chId);
            if (this.screenShares.get(chId)?.sharerId === actorId) {
              this.screenShares.delete(chId);
              this.broadcastEvent("SCREEN_SHARE_STOPPED", { channelId: chId, sharerId: actorId });
            }
            this.broadcastEvent("RTC_ROOM_UPDATED", {
              channelId: chId,
              participants: Array.from(room.values())
            });
          }
        }
        return { ok: true, affectedChannels };
      }

      case "updateVoiceState": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        for (const [, room] of this.voiceRooms.entries()) {
          if (room.has(actorId)) {
            const p = room.get(actorId);
            p.muted = Boolean(params.muted);
            p.deafened = Boolean(params.deafened);
          }
        }
        return { ok: true };
      }

      case "RTC_START_SCREENSHARE":
      case "startScreenShare": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, channelId, sourceId, sourceName, resolution, fps, hasSystemAudio, initialFrameDataUrl } = params;
        if (!actorId || !channelId) return { ok: false, error: "Não conectado a um canal de voz." };
        const room = this.voiceRooms.get(channelId);
        if (room && room.has(actorId)) {
          room.get(actorId).screenShareEnabled = true;
        }

        const userRow = this.db.prepare(`SELECT username, display_name FROM users WHERE id = ?`).get(actorId);
        const shareState = {
          channelId,
          guildId: guildId || "g_rea",
          userId: actorId,
          sharerId: actorId,
          sharerName: userRow?.display_name || "User",
          sharerUsername: userRow?.username || "user",
          sourceId: sourceId || "screen:0:0",
          sourceName: sourceName || "Entire Screen",
          resolution: resolution || "720p",
          fps: Number(fps || 15),
          hasSystemAudio: Boolean(hasSystemAudio),
          startedAt: Date.now(),
          frameDataUrl: initialFrameDataUrl || null
        };

        this.screenShares.set(channelId, shareState);
        this.broadcastEvent("SCREEN_SHARE_STARTED", shareState);
        return { ok: true, share: shareState, screenShare: shareState };
      }

      case "RTC_PUBLISH_SCREENSHARE_FRAME":
      case "broadcastScreenFrame": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { channelId, frameDataUrl, sdpOffer, sdpAnswer, iceCandidate } = params;
        const share = this.screenShares.get(channelId);
        if (!share || share.sharerId !== actorId) {
          return { ok: false, error: "Nenhuma transmissão ativa para este usuário." };
        }
        if (frameDataUrl) {
          share.frameDataUrl = frameDataUrl;
        }
        this.broadcastEvent("SCREEN_SHARE_FRAME", {
          channelId,
          userId: actorId,
          sharerId: actorId,
          sourceName: share.sourceName,
          frameDataUrl: share.frameDataUrl,
          updatedAt: Date.now(),
          sdpOffer: sdpOffer || null,
          sdpAnswer: sdpAnswer || null,
          iceCandidate: iceCandidate || null
        });
        return { ok: true };
      }

      case "RTC_STOP_SCREENSHARE":
      case "stopScreenShare": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { channelId } = params;
        for (const [chId, share] of this.screenShares.entries()) {
          if ((!channelId || chId === channelId) && share.sharerId === actorId) {
            this.screenShares.delete(chId);
            const room = this.voiceRooms.get(chId);
            if (room && room.has(actorId)) {
              room.get(actorId).screenShareEnabled = false;
            }
            this.broadcastEvent("SCREEN_SHARE_STOPPED", { channelId: chId, sharerId: actorId });
          }
        }
        return { ok: true };
      }

      case "RTC_SIGNAL": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { targetUserId, channelId, signalType, signalData } = params;
        const room = this.voiceRooms.get(channelId);
        if (!room || !room.has(actorId)) {
          return { ok: false, error: "Não autorizado neste canal de voz." };
        }
        this.broadcastEvent("RTC_SIGNAL", {
          fromUserId: actorId,
          targetUserId: targetUserId || null,
          channelId,
          signalType,
          signalData
        });
        return { ok: true };
      }

      case "SET_VOICE_SPEAKING":
      case "setVoiceSpeaking": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { channelId, speaking } = params;
        this.broadcastEvent("VOICE_SPEAKING_CHANGED", {
          channelId: channelId || null,
          userId: actorId,
          speaking: Boolean(speaking)
        });
        return { ok: true, speaking: Boolean(speaking), userId: actorId };
      }

      case "SEARCH_GIFS":
      case "searchGifs": {
        const { query, category, limit, offset } = params;
        const result = await searchGifs({ query, category, limit, offset });
        return {
          ok: true,
          categories: result.categories || GIF_CATEGORIES,
          gifs: result.gifs,
          total: result.total,
          offset: result.offset,
          limit: result.limit,
          source: result.source || "giphy"
        };
      }

      case "CREATE_ROLE":
      case "createRole": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, name, color, hoist, permissions, position } = params;
        if (!actorId || !guildId) return { ok: false, error: "Servidor ou usuário ausente." };
        const perms = this.getMemberPermissions(guildId, actorId);
        if (!perms.has("MANAGE_ROLES") && !perms.has("ADMINISTRATOR")) {
          return { ok: false, status: 403, error: "Permissão insuficiente para criar cargos." };
        }
        const actorPos = this.getMemberHighestRolePosition(guildId, actorId);
        const desiredPos = position !== undefined ? Number(position) : 1;
        const isOwner = this.db.prepare(`SELECT owner_id FROM guilds WHERE id = ?`).get(guildId)?.owner_id === actorId;
        if (!isOwner && desiredPos >= actorPos) {
          return { ok: false, status: 403, error: "Você não pode criar um cargo com posição igual ou superior à sua." };
        }

        const roleId = "r_" + crypto.randomBytes(5).toString("hex");
        const cleanName = String(name || "Novo Cargo").trim();
        const roleColor = color || "#99aab5";
        const roleHoist = hoist ? 1 : 0;
        const permsJson = JSON.stringify(Array.isArray(permissions) ? permissions : ["SEND_MESSAGES", "CONNECT_VOICE"]);

        this.db
          .prepare(
            `INSERT INTO guild_roles (id, guild_id, name, color, hoist, permissions_json, position)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(roleId, guildId, cleanName, roleColor, roleHoist, permsJson, desiredPos);

        const now = Date.now();
        this.db
          .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            "al_" + crypto.randomBytes(6).toString("hex"),
            guildId,
            actorId,
            `Created role "${cleanName}"`,
            this.formatTimeLabel(now),
            now
          );

        const newRole = {
          id: roleId,
          name: cleanName,
          color: roleColor,
          hoist: Boolean(roleHoist),
          position: desiredPos,
          permissions: JSON.parse(permsJson)
        };

        this.broadcastEvent("GUILD_ROLE_CREATED", { guildId, role: newRole });
        return { ok: true, roleId, role: newRole };
      }

      case "UPDATE_ROLE":
      case "updateRole": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, roleId, name, color, hoist, permissions, position } = params;
        if (!actorId || !guildId || !roleId) return { ok: false, error: "Parâmetros de cargo inválidos." };
        const existing = this.db.prepare(`SELECT * FROM guild_roles WHERE id = ? AND guild_id = ?`).get(roleId, guildId);
        if (!existing) return { ok: false, status: 404, error: "Cargo não encontrado." };

        const perms = this.getMemberPermissions(guildId, actorId);
        if (!perms.has("MANAGE_ROLES") && !perms.has("ADMINISTRATOR")) {
          return { ok: false, status: 403, error: "Permissão insuficiente para editar cargos." };
        }

        const actorPos = this.getMemberHighestRolePosition(guildId, actorId);
        const isOwner = this.db.prepare(`SELECT owner_id FROM guilds WHERE id = ?`).get(guildId)?.owner_id === actorId;
        if (!isOwner && Number(existing.position || 0) >= actorPos) {
          return { ok: false, status: 403, error: "Você não pode editar um cargo com hierarquia superior ou igual à sua." };
        }

        const nextName = existing.name === "@everyone" ? "@everyone" : (name !== undefined ? String(name).trim() : existing.name);
        const nextColor = color !== undefined ? color : existing.color;
        const nextHoist = existing.name === "@everyone" ? 0 : (hoist !== undefined ? (hoist ? 1 : 0) : existing.hoist);
        const nextPos = existing.name === "@everyone" ? 0 : (position !== undefined ? Number(position) : existing.position);
        if (!isOwner && nextPos >= actorPos) {
          return { ok: false, status: 403, error: "Você não pode posicionar um cargo acima da sua própria hierarquia." };
        }

        const nextPermsJson = permissions !== undefined ? JSON.stringify(Array.isArray(permissions) ? permissions : []) : existing.permissions_json;

        this.db
          .prepare(
            `UPDATE guild_roles SET
               name = ?, color = ?, hoist = ?, permissions_json = ?, position = ?
             WHERE id = ? AND guild_id = ?`
          )
          .run(nextName, nextColor, nextHoist, nextPermsJson, nextPos, roleId, guildId);

        const now = Date.now();
        this.db
          .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            "al_" + crypto.randomBytes(6).toString("hex"),
            guildId,
            actorId,
            `Updated role "${nextName}"`,
            this.formatTimeLabel(now),
            now
          );

        const updatedRole = {
          id: roleId,
          name: nextName,
          color: nextColor,
          hoist: Boolean(nextHoist),
          position: nextPos,
          permissions: JSON.parse(nextPermsJson)
        };

        this.broadcastEvent("GUILD_ROLE_UPDATED", { guildId, role: updatedRole });
        return { ok: true, role: updatedRole };
      }

      case "DELETE_ROLE":
      case "deleteRole": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, roleId } = params;
        if (!actorId || !guildId || !roleId) return { ok: false, error: "Parâmetros de cargo inválidos." };
        const existing = this.db.prepare(`SELECT * FROM guild_roles WHERE id = ? AND guild_id = ?`).get(roleId, guildId);
        if (!existing) return { ok: false, status: 404, error: "Cargo não encontrado." };
        if (existing.name === "@everyone") {
          return { ok: false, status: 400, error: "Não é permitido excluir o cargo padrão @everyone." };
        }

        const perms = this.getMemberPermissions(guildId, actorId);
        if (!perms.has("MANAGE_ROLES") && !perms.has("ADMINISTRATOR")) {
          return { ok: false, status: 403, error: "Permissão insuficiente para excluir cargos." };
        }

        const actorPos = this.getMemberHighestRolePosition(guildId, actorId);
        const isOwner = this.db.prepare(`SELECT owner_id FROM guilds WHERE id = ?`).get(guildId)?.owner_id === actorId;
        if (!isOwner && Number(existing.position || 0) >= actorPos) {
          return { ok: false, status: 403, error: "Você não pode excluir um cargo com hierarquia superior ou igual à sua." };
        }

        // Remove from members
        const members = this.db.prepare(`SELECT user_id, roles_json FROM guild_members WHERE guild_id = ?`).all(guildId);
        for (const m of members) {
          const rList = JSON.parse(m.roles_json || "[]");
          if (rList.includes(roleId)) {
            const filtered = rList.filter((id) => id !== roleId);
            this.db.prepare(`UPDATE guild_members SET roles_json = ? WHERE guild_id = ? AND user_id = ?`).run(JSON.stringify(filtered), guildId, m.user_id);
          }
        }

        this.db.prepare(`DELETE FROM guild_roles WHERE id = ? AND guild_id = ?`).run(roleId, guildId);

        const now = Date.now();
        this.db
          .prepare(`INSERT INTO audit_logs (id, guild_id, actor_id, action, time_label, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            "al_" + crypto.randomBytes(6).toString("hex"),
            guildId,
            actorId,
            `Deleted role "${existing.name}"`,
            this.formatTimeLabel(now),
            now
          );

        this.broadcastEvent("GUILD_ROLE_DELETED", { guildId, roleId });
        return { ok: true, roleId };
      }

      case "ASSIGN_MEMBER_ROLE":
      case "assignMemberRole": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, targetUserId, roleId } = params;
        const uid = this.resolveUserId(targetUserId || params.memberId);
        if (!actorId || !guildId || !uid || !roleId) return { ok: false, error: "Parâmetros inválidos." };

        const perms = this.getMemberPermissions(guildId, actorId);
        if (!perms.has("MANAGE_ROLES") && !perms.has("ADMINISTRATOR")) {
          return { ok: false, status: 403, error: "Permissão insuficiente para atribuir cargos." };
        }

        const role = this.db.prepare(`SELECT * FROM guild_roles WHERE id = ? AND guild_id = ?`).get(roleId, guildId);
        if (!role) return { ok: false, status: 404, error: "Cargo não encontrado." };

        const actorPos = this.getMemberHighestRolePosition(guildId, actorId);
        const isOwner = this.db.prepare(`SELECT owner_id FROM guilds WHERE id = ?`).get(guildId)?.owner_id === actorId;
        if (!isOwner && Number(role.position || 0) >= actorPos) {
          return { ok: false, status: 403, error: "Você não pode atribuir um cargo de hierarquia igual ou superior à sua." };
        }

        const member = this.db.prepare(`SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?`).get(guildId, uid);
        if (!member) return { ok: false, status: 404, error: "Membro não encontrado no servidor." };

        const rList = JSON.parse(member.roles_json || "[]");
        if (!rList.includes(roleId)) {
          rList.push(roleId);
          this.db.prepare(`UPDATE guild_members SET roles_json = ? WHERE guild_id = ? AND user_id = ?`).run(JSON.stringify(rList), guildId, uid);
        }

        this.broadcastEvent("GUILD_MEMBER_UPDATED", { guildId, userId: uid, roles: rList });
        return { ok: true, userId: uid, roles: rList };
      }

      case "REMOVE_MEMBER_ROLE":
      case "removeMemberRole": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const { guildId, targetUserId, roleId } = params;
        const uid = this.resolveUserId(targetUserId || params.memberId);
        if (!actorId || !guildId || !uid || !roleId) return { ok: false, error: "Parâmetros inválidos." };

        const perms = this.getMemberPermissions(guildId, actorId);
        if (!perms.has("MANAGE_ROLES") && !perms.has("ADMINISTRATOR")) {
          return { ok: false, status: 403, error: "Permissão insuficiente para gerenciar cargos." };
        }

        const role = this.db.prepare(`SELECT * FROM guild_roles WHERE id = ? AND guild_id = ?`).get(roleId, guildId);
        if (!role) return { ok: false, status: 404, error: "Cargo não encontrado." };

        const actorPos = this.getMemberHighestRolePosition(guildId, actorId);
        const isOwner = this.db.prepare(`SELECT owner_id FROM guilds WHERE id = ?`).get(guildId)?.owner_id === actorId;
        if (!isOwner && Number(role.position || 0) >= actorPos) {
          return { ok: false, status: 403, error: "Você não pode remover um cargo de hierarquia igual ou superior à sua." };
        }

        const member = this.db.prepare(`SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?`).get(guildId, uid);
        if (!member) return { ok: false, status: 404, error: "Membro não encontrado no servidor." };

        let rList = JSON.parse(member.roles_json || "[]");
        rList = rList.filter((id) => id !== roleId);
        this.db.prepare(`UPDATE guild_members SET roles_json = ? WHERE guild_id = ? AND user_id = ?`).run(JSON.stringify(rList), guildId, uid);

        this.broadcastEvent("GUILD_MEMBER_UPDATED", { guildId, userId: uid, roles: rList });
        return { ok: true, userId: uid, roles: rList };
      }

      // ======================================================================
      // Account security (e-mail, password)
      // ======================================================================
      case "GET_ACCOUNT_SECURITY":
      case "getAccountSecurity": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const security = this.getAccountSecurity(actorId);
        if (!security) return { ok: false, status: 404, error: "Conta não encontrada." };
        return { ok: true, security };
      }

      case "REQUEST_EMAIL_VERIFICATION":
      case "requestEmailVerification": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
        if (!row) return { ok: false, status: 404, error: "Conta não encontrada." };
        if (row.email_verified) return { ok: false, error: "Seu e-mail já está verificado." };
        const res = await this.issueVerificationCode(actorId, "email_verify", row.email);
        return res.ok ? { ...res, security: this.getAccountSecurity(actorId) } : res;
      }

      case "CONFIRM_EMAIL_VERIFICATION":
      case "confirmEmailVerification": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const check = await this.checkVerificationCode(actorId, "email_verify", params.code);
        if (!check.ok) return { ...check, security: this.getAccountSecurity(actorId) };
        const now = Date.now();
        this.db
          .prepare(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ? AND LOWER(email) = LOWER(?)`)
          .run(now, actorId, check.target);
        const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
        return { ok: true, user: this.serializeUser(row), security: this.getAccountSecurity(actorId) };
      }

      case "REQUEST_EMAIL_CHANGE":
      case "requestEmailChange": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
        if (!row) return { ok: false, status: 404, error: "Conta não encontrada." };
        const pwError = this.requireCurrentPassword(row, params.currentPassword);
        if (pwError) return { ok: false, status: 403, error: pwError };
        const newEmail = normalizeEmail(params.newEmail);
        if (!isValidEmail(newEmail)) return { ok: false, error: "Informe um endereço de e-mail válido." };
        if (newEmail === normalizeEmail(row.email)) return { ok: false, error: "Este já é o seu e-mail atual." };
        const taken = this.db.prepare(`SELECT id FROM users WHERE LOWER(email) = ? AND id != ?`).get(newEmail, actorId);
        if (taken) return { ok: false, error: "Já existe uma conta cadastrada com este e-mail." };
        const res = await this.issueVerificationCode(actorId, "email_change", newEmail);
        return res.ok ? { ...res, security: this.getAccountSecurity(actorId) } : res;
      }

      case "CONFIRM_EMAIL_CHANGE":
      case "confirmEmailChange": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const check = await this.checkVerificationCode(actorId, "email_change", params.code);
        if (!check.ok) return { ...check, security: this.getAccountSecurity(actorId) };
        const taken = this.db
          .prepare(`SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?`)
          .get(check.target, actorId);
        if (taken) return { ok: false, error: "Este e-mail foi cadastrado por outra conta enquanto você confirmava." };
        const now = Date.now();
        this.db
          .prepare(`UPDATE users SET email = ?, email_verified = 1, updated_at = ?, version = version + 1 WHERE id = ?`)
          .run(check.target, now, actorId);
        // Any pending verification for the old address is now meaningless
        this.db
          .prepare(`UPDATE verification_codes SET consumed = 1 WHERE user_id = ? AND purpose = 'email_verify'`)
          .run(actorId);
        const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
        return { ok: true, user: this.serializeUser(row), security: this.getAccountSecurity(actorId) };
      }

      case "CHANGE_PASSWORD":
      case "changePassword": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(actorId);
        if (!row) return { ok: false, status: 404, error: "Conta não encontrada." };
        const pwError = this.requireCurrentPassword(row, params.currentPassword);
        if (pwError) return { ok: false, status: 403, error: pwError };
        const newPassword = String(params.newPassword || "");
        const invalid = validateNewPassword(newPassword);
        if (invalid) return { ok: false, error: invalid };
        if (verifyPassword(newPassword, row.password_hash)) {
          return { ok: false, error: "A nova senha precisa ser diferente da atual." };
        }
        const now = Date.now();
        this.db
          .prepare(`UPDATE users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?`)
          .run(hashPassword(newPassword), now, now, actorId);
        return { ok: true, security: this.getAccountSecurity(actorId) };
      }

      case "CANCEL_PENDING_VERIFICATION":
      case "cancelPendingVerification": {
        const actorId = this.resolveUserId(params.actorId || params.userId);
        const purpose = String(params.purpose || "");
        if (!["email_verify", "email_change"].includes(purpose)) {
          return { ok: false, error: "Tipo de verificação inválido." };
        }
        this.db
          .prepare(`UPDATE verification_codes SET consumed = 1 WHERE user_id = ? AND purpose = ? AND consumed = 0`)
          .run(actorId, purpose);
        return { ok: true, security: this.getAccountSecurity(actorId) };
      }

      default:
        return { ok: false, error: `Unknown backend action: ${action}` };
    }
  }

  renderInviteLandingPage(result) {
    const esc = (v) =>
      String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const appName = esc(this.config.appName);
    const p = result.preview;
    const body = result.ok
      ? `<div class="icon" style="background:${esc(p.guildIconColor)}">${esc(p.guildShortName)}</div>
         <p class="muted">${esc(p.inviterDisplayName)} convidou você para entrar em</p>
         <h1>${esc(p.guildName)}</h1>
         <p class="muted">${Number(p.memberCount) || 0} membro(s)</p>
         <div class="code">${esc(p.code)}</div>
         <p class="hint">Abra o ${appName}, clique em <b>+</b> &rsaquo; <b>Entrar em um servidor</b> e cole este link ou código.</p>`
      : `<h1>Convite inválido</h1><p class="muted">${esc(result.error || "Este convite não existe.")}</p>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Convite · ${appName}</title>
      <style>
        body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1a1b26;color:#f2f3f5;font-family:system-ui,sans-serif;padding:16px;box-sizing:border-box}
        .card{background:#24263a;border-radius:16px;padding:32px;max-width:400px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.4)}
        .brand{font-weight:800;letter-spacing:.5px;color:#8b93ff;margin-bottom:20px}
        .icon{width:72px;height:72px;border-radius:22px;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px}
        h1{margin:6px 0;font-size:24px}.muted{color:#a3a6b8;margin:4px 0}
        .code{margin:18px auto 10px;padding:10px 14px;border-radius:8px;background:#15161f;font-family:monospace;font-size:16px;user-select:all}
        .hint{color:#a3a6b8;font-size:13px;line-height:1.5}
      </style></head><body><div class="card"><div class="brand">${appName}</div>${body}</div></body></html>`;
  }

  start(preferredPort = 0) {
    return this.startHttpServer(preferredPort);
  }

  startHttpServer(preferredPort = 0) {
    if (this.server) return Promise.resolve(this.port);
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const parsedUrl = new URL(req.url, `http://127.0.0.1`);

        if (req.method === "GET" && parsedUrl.pathname === "/api/events") {
          // EventSource cannot send headers, so the session token comes in the query string
          const streamUserId = this.getSessionUserId(parsedUrl.searchParams.get("token"));
          if (!streamUserId) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, code: "UNAUTHENTICATED", error: "Sessão inválida." }));
            return;
          }
          if (this.isEmailGateActive(streamUserId)) {
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, code: "EMAIL_NOT_VERIFIED", error: "Confirme seu e-mail." }));
            return;
          }
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          });
          res.write(`data: ${JSON.stringify({ event: "CONNECTED", type: "CONNECTED", timestamp: Date.now() })}\n\n`);
          this.sseClients.add(res);
          req.on("close", () => this.sseClients.delete(res));
          return;
        }

        if (req.method === "GET" && parsedUrl.pathname.startsWith("/uploads/")) {
          const safeName = path.basename(parsedUrl.pathname);
          const filePath = path.join(this.uploadsDir, safeName);
          if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end("Not Found");
            return;
          }
          const ext = path.extname(safeName).toLowerCase();
          const mimeMap = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".ogg": "audio/ogg",
            ".webm": "audio/webm"
          };
          res.writeHead(200, {
            "Content-Type": mimeMap[ext] || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000"
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        if (req.method === "GET" && parsedUrl.pathname.startsWith("/assets/audio/")) {
          const safeName = path.basename(parsedUrl.pathname);
          const filePath = path.join(this.rootDir, "assets", "audio", safeName);
          if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end("Not Found");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=31536000"
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        // Public invite landing page: <publicUrl>/convite/<code>
        const invitePrefix = `${this.config.invitePath}/`;
        if (req.method === "GET" && (parsedUrl.pathname.startsWith(invitePrefix) || parsedUrl.pathname.startsWith("/invite/"))) {
          this.handleAction("INSPECT_INVITE", { tokenOrUrl: parsedUrl.pathname }).then((result) => {
            res.writeHead(result.ok ? 200 : result.status || 404, { "Content-Type": "text/html; charset=utf-8" });
            res.end(this.renderInviteLandingPage(result));
          });
          return;
        }

        if (req.method === "POST" && parsedUrl.pathname === "/api/rpc") {
          const chunks = [];
          let totalBytes = 0;
          req.on("data", (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes <= 16 * 1024 * 1024) chunks.push(chunk);
          });
          req.on("end", async () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
              const authHeader = String(req.headers.authorization || "");
              const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
              const result = await this.handleClientRequest(body.action, body.params || body.payload || {}, token);
              res.writeHead(result.status || 200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            } catch (e) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: e.message }));
            }
          });
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Route not found" }));
      });

      srv.listen(preferredPort, "127.0.0.1", () => {
        this.server = srv;
        this.port = srv.address().port;
        prefetchTrendingGifs();
        resolve(this.port);
      });
      srv.on("error", reject);
    });
  }

  stop() {
    this.close();
    return Promise.resolve();
  }

  close() {
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch (_) {}
    }
    this.sseClients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch (_) {}
    }
  }
}

module.exports = {
  DiscordBackendServer,
  normalizeUsername,
  validateUsername
};
