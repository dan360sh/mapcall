// HTTP-авторизация: OAuth (Яндекс, Google) и гостевой вход.
//
// Токен возвращается клиенту во fragment (callback.html#token=...), а не в query:
// fragment не уходит на сервер и не оседает в логах прокси.

const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const SESSION_TTL       = '7d';
const GUEST_SESSION_TTL = '24h';
const STATE_TTL         = '10m';

const PROVIDERS = {
  yandex: {
    authorizeUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl:     'https://oauth.yandex.ru/token',
    scope:        null,
    async fetchProfile(tokens) {
      const { data: p } = await axios.get('https://login.yandex.ru/info?format=json', {
        headers: { Authorization: `OAuth ${tokens.access_token}` },
        timeout: 10_000,
      });
      return {
        userId: `yandex:${p.id}`,
        name:   p.real_name || p.display_name || p.login,
        avatar: p.default_avatar_id && !p.is_avatar_empty
          ? `https://avatars.yandex.net/get-yapic/${p.default_avatar_id}/islands-50`
          : null,
      };
    },
  },
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:     'https://oauth2.googleapis.com/token',
    scope:        'openid profile email',
    async fetchProfile(tokens) {
      const { data: p } = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
        params: { id_token: tokens.id_token },
        timeout: 10_000,
      });
      return { userId: `google:${p.sub}`, name: p.name || p.email, avatar: p.picture || null };
    },
  },
};

function createAuthRouter({ config, upsertUser }) {
  const router = express.Router();
  const { jwtSecret, clientUrl, maxNameLength } = config;

  const signSession = ({ userId, name, avatar }, expiresIn) =>
    jwt.sign({ userId, name, avatar: avatar ?? null }, jwtSecret, { expiresIn });

  const redirectToClient = (res, params) =>
    res.redirect(`${clientUrl}/callback.html#${new URLSearchParams(params)}`);

  for (const [name, provider] of Object.entries(PROVIDERS)) {
    const settings = config.oauth[name];
    const configured = () => settings.clientId && settings.clientSecret && settings.redirectUri;

    router.get(`/auth/${name}`, (_req, res) => {
      if (!configured()) return res.status(503).send(`${name} OAuth is not configured`);
      const state = jwt.sign({ provider: name, nonce: crypto.randomUUID() }, jwtSecret, { expiresIn: STATE_TTL });
      const params = new URLSearchParams({
        response_type: 'code',
        client_id:     settings.clientId,
        redirect_uri:  settings.redirectUri,
        state,
      });
      if (provider.scope) params.set('scope', provider.scope);
      res.redirect(`${provider.authorizeUrl}?${params}`);
    });

    router.get(`/auth/${name}/callback`, async (req, res) => {
      try {
        const { code, state } = req.query;
        if (typeof code !== 'string' || typeof state !== 'string') throw new Error('missing code/state');
        const decoded = jwt.verify(state, jwtSecret);
        if (decoded.provider !== name) throw new Error('state provider mismatch');

        const { data: tokens } = await axios.post(
          provider.tokenUrl,
          new URLSearchParams({
            grant_type:    'authorization_code',
            code,
            client_id:     settings.clientId,
            client_secret: settings.clientSecret,
            redirect_uri:  settings.redirectUri,
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
        );

        const profile = await provider.fetchProfile(tokens);
        profile.name = String(profile.name || 'Пользователь').slice(0, maxNameLength);
        await upsertUser({ id: profile.userId, name: profile.name, avatar: profile.avatar, provider: name });
        redirectToClient(res, { token: signSession(profile, SESSION_TTL) });
      } catch (err) {
        console.error(`[${name}-auth]`, err.message);
        redirectToClient(res, { error: 'auth_failed' });
      }
    });
  }

  router.post('/auth/guest', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, maxNameLength) : '';
    if (!name) return res.status(400).json({ error: 'Name required' });
    const token = signSession({ userId: `guest:${crypto.randomUUID()}`, name, avatar: null }, GUEST_SESSION_TTL);
    res.json({ token });
  });

  return router;
}

// Проверяет JWT сессии; возвращает профиль или null.
function createTokenVerifier(jwtSecret) {
  return (token) => {
    if (typeof token !== 'string') return null;
    try {
      const p = jwt.verify(token, jwtSecret);
      if (typeof p.userId !== 'string' || typeof p.name !== 'string') return null;
      return { userId: p.userId, name: p.name, avatar: typeof p.avatar === 'string' ? p.avatar : null };
    } catch {
      return null;
    }
  };
}

module.exports = { createAuthRouter, createTokenVerifier };
