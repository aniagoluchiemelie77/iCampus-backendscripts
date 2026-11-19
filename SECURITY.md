# iCampus security runbook

What the code enforces, and the deployment steps that cannot live in code.
Do the steps in **Rollout order** at the bottom in sequence.

## 1. Edge: Cloudflare WAF in front of the API

1. Add the domain to Cloudflare and proxy (orange cloud) every record that
   points at the backend or the admin portal (`api.…`, `admin.…`).
2. **SSL/TLS → Overview:** Full (strict). **Edge Certificates:** Minimum TLS
   1.2 (1.3 if every client you support handles it), TLS 1.3 on, Always Use
   HTTPS on, HSTS on (max-age 2 years, include subdomains; leave *preload*
   off until you are sure every subdomain is HTTPS-only).
3. **Security → WAF:** enable the Cloudflare Managed Ruleset and the OWASP
   Core Ruleset. Add a rate-limiting rule for `/users/*login*`,
   `/users/refresh-token` and `/v1/secure/github/exchange`.
4. **Origin lock.** Generate a long random value
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - Cloudflare → Rules → Transform Rules → *Modify Request Header*: for the
     API hostname, **set** `X-Origin-Auth` to that value.
   - Set the same value as `ORIGIN_SHARED_SECRET` on the backend.
   - The backend then rejects (403) any HTTP request or socket handshake
     without it, so calling `*.onrender.com` / `*.appspot.com` directly no
     longer bypasses the WAF. `/healthz` stays open for platform health
     checks.
5. Network-level lock (defence in depth on top of step 4):
   - **Google Cloud:** a Cloud Armor security policy on the load balancer
     that allows only [Cloudflare's IP ranges](https://www.cloudflare.com/ips/)
     and denies everything else. (App Engine: Firewall rules with the same
     allowlist, default action *deny*.)
   - **Render:** web services can't restrict inbound IPs, so the
     `ORIGIN_SHARED_SECRET` header check is the lock there.

## 2. Backend HTTP hardening (in code)

`middleware/security.js`, wired in `index.js`:

- `helmet()` headers (HSTS, `nosniff`, `frame-ancestors 'none'`, no referrer),
  `X-Powered-By` removed.
- CORS limited to `ALLOWED_ORIGINS`. The mobile app sends no `Origin` and is
  unaffected.
- Request logs redact `token`, `code`, `signature`, `key`, … query values.
- 5xx responses no longer echo internal error messages.

## 3. Data layer

- **Firestore is the only live database** (Mongoose is used for schema
  definitions only and never connects), so there is no MongoDB Atlas network
  access to lock down. If Atlas is added later: no `0.0.0.0/0`, allow only
  the backend's static egress IPs or use Private Endpoints, and give the app
  user `readWrite` on its one database only.
- **Firestore rules** (`firestore.rules`): deny all client access. Clients
  never read Firestore directly; the backend's Admin SDK isn't subject to
  rules. Deploy with `firebase deploy --only firestore:rules`.
- **Storage rules** (`storage.rules`): uploads need a signed-in user (custom
  token from `POST /v1/secure/firebase-token`, which carries `schoolCode` and
  `usertype` claims), fixed folders, size and type limits, no overwrites or
  deletes. Deploy with `firebase deploy --only storage`.
- **Tenant isolation in the API:** attendance and live-class handlers now
  check enrolment in the lecture's course (which implies the same school)
  using the authenticated user, not ids sent by the client.

## 4. Sockets, attendance and uploads (in code)

- **Socket.IO handshake auth** (`controllers/socket.js`): every connection
  must send the access token (`auth: { token }`). The verified account is
  on `socket.data.user`; personal rooms join only the caller's own uid.
- **Live classes:** host status, room membership and WebRTC signalling use
  the authenticated uid; joining needs enrolment (or being the host/lecturer).
- **Attendance:**
  - Only the lecture's lecturer can open or close a session.
  - The student is the authenticated user and must be enrolled.
  - A signed 5-minute **identity proof** from the face match
    (`/attendance/verify-student`) is required.
  - **Rotating beacon:** updated lecturer apps advertise a code that changes
    every 30 s (HMAC of a per-session secret, kept in
    `attendance_sessions/{lectureId}` and never sent to students). Codes are
    accepted for about 2 minutes, so a recorded broadcast can't be replayed
    later. A live relay within that window is still possible; it needs an
    accomplice in the room in real time.
  - Records store `identityMethod`, `liveness` and `beaconVerified`.
- **Cloudinary:** clients ask `POST /v1/secure/uploads/cloudinary-signature`
  for a 1-hour signature that pins the folder, file name and allowed formats.
  In the Cloudinary console, **delete the old unsigned upload preset** (it is
  in old app builds) and create a *signed* preset with a max file size; set
  its name as `CLOUDINARY_SIGNED_UPLOAD_PRESET`.

## 5. Secrets

The mobile app no longer bundles Gemini, the GitHub client secret, the
exchange-rate key, the APIVerve key or the Cloudinary preset. Those calls
go through `/v1/secure/*`.

**Rotate these now.** The app's `.env` was committed in the `iCampus-App`
history (commits `93b8bb2`, `ace3933`, `962491a`) and shipped in every build,
so treat every value in it as public:

| Key | Where to rotate |
| --- | --- |
| Gemini API key | Google AI Studio / Cloud console → API keys |
| GitHub OAuth client secret | GitHub → Settings → Developer settings → OAuth Apps |
| ExchangeRate-API key | exchangerate-api.com dashboard |
| APIVerve key | apiverve.com dashboard |
| Cloudinary unsigned preset | Delete it (see §4) |
| Firebase web API key | Not secret, but restrict it to your app IDs / domains in Google Cloud → Credentials |

Removing a key from git history does not un-leak it; rotating does.

Store production values in **GCP Secret Manager** (App Engine:
`gcloud secrets create …`, grant the service account *Secret Accessor*,
load them at boot) or **Render → Environment → Secret Files / env vars**.
Never put them in `app.yaml`, the Dockerfile or the repo.

### New backend environment variables

| Variable | Purpose |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated browser origins (web app, admin portal) |
| `ORIGIN_SHARED_SECRET` | Must match Cloudflare's `X-Origin-Auth` header |
| `TRUST_PROXY_HOPS` | Proxy hops in front of Express (default 1) |
| `ATTENDANCE_PROOF_SECRET` | Signs identity proofs (falls back to `JWT_SECRET`) |
| `ATTENDANCE_REQUIRE_FACE_PROOF` | `false` only as a temporary escape hatch for old app builds |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Signed uploads |
| `CLOUDINARY_SIGNED_UPLOAD_PRESET` | Optional signed preset (enforces max size) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in code exchange |
| `VERVE_SEARCH_API_KEY` | Card BIN lookup fallback |

## Rollout order

1. Set the new backend env vars, then deploy the backend. Old app builds keep
   working for HTTP, but their sockets are rejected (no token) and their
   attendance submissions fail (no identity proof): ship the app update
   together with the backend, or set `ATTENDANCE_REQUIRE_FACE_PROOF=false`
   briefly while users update.
2. Release the mobile app and deploy the admin portal.
3. Deploy `firestore.rules` and `storage.rules`.
4. Rotate the leaked keys (§5) and delete the unsigned Cloudinary preset.
5. Put Cloudflare in front, then set `ORIGIN_SHARED_SECRET` and
   `ALLOWED_ORIGINS`.
