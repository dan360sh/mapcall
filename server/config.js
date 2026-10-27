require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

function required(name, devDefault) {
  const value = process.env[name];
  if (value) return value;
  if (isProduction || devDefault === undefined) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return devDefault;
}

module.exports = {
  isProduction,
  port:       Number(process.env.PORT) || 3000,
  jwtSecret:  required('JWT_SECRET', 'mapcall-dev-secret'),
  clientUrl:  (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL,

  oauth: {
    yandex: {
      clientId:     process.env.YANDEX_CLIENT_ID,
      clientSecret: process.env.YANDEX_CLIENT_SECRET,
      redirectUri:  process.env.YANDEX_REDIRECT_URI,
    },
    google: {
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri:  process.env.GOOGLE_REDIRECT_URI,
    },
  },

  // Таймауты и лимиты
  pendingCallTtlMs:   60_000,  // сколько живёт неотвеченный вызов
  reconnectGraceMs:   3_000,   // окно на переподключение без потери состояния
  heartbeatMs:        25_000,
  wsMaxPayload:       256 * 1024,
  maxNameLength:      32,
};
