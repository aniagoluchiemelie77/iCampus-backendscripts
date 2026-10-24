# iCampus – Backend API

Node.js / Express API and Socket.IO server for the iCampus mobile app. It handles accounts and verification, the social feed, the classroom (courses, lectures, attendance, live classes, tests, gradebook), the marketplace with escrowed payouts, notifications, admin tools and tiered school analytics.

Data lives in **Firebase Firestore**. The `models.js` Mongoose schemas document document shapes only; there is no MongoDB connection.

---

## Architecture

```
index.js                    Express app + HTTP server, Socket.IO, cron start-up, route mounting
config/firebaseAdmin.js     Firebase Admin (Firestore, Storage, FCM)
tableDeclarations.js        Firestore collection handles (User, Course, Lectures, Posts, …)
routes/                     Express routers (see table below)
controllers/                Request handlers and socket handlers
  socket.js                 Socket.IO bootstrap; per-user rooms
  liveClassControllers.js   Live class signalling + Agora/Deepgram token endpoints
  PhysicalClassControllers.js  BLE attendance sessions (sockets)
  classActions.js           Courses, lectures, attendance, tests, gradebook, reminders
  adminActions.js           Admin dashboard, institutions, stations, getAdminMetrics
  storeControllers.js       Listings, orders, delivery verification, payouts
services/                   notification.js (DB + push + email + socket), pushNotification.js, email
utils/                      lectureTime.js, schoolAnalytics.js, preferences.js, idGenerator.js, …
cron/                       Scheduled jobs (node-cron, run in every instance)
workers/                    QStash email worker, upload helpers
controllertests/            Jest endpoint tests
```

### Route prefixes

| Prefix | Router |
| --- | --- |
| `/users` | Account, preferences, FCM token, feed helpers |
| `/user` | Account details (bank/cards, iTags) |
| `/users/student/class` | Student classroom (courses, attendance, tests) |
| `/users/lecturers/class` | Lecturer classroom (schedule, tests, gradebook) |
| `/posts` | Feed, posts, comments, polls |
| `/store` | Marketplace, orders, delivery verification |
| `/reviews` | Seller/product reviews |
| `/admins` | Admin dashboard, institutions, stations, analytics |
| `/v1/auth` | Sign-in/sign-up, token refresh, **Agora** and Deepgram tokens |
| `/support/tickets` | Support ticketing |
| `/webhooks` | Flutterwave, Persona and inbound email webhooks |
| `/verifyStudent`, `/verifyInstructor`, `/verifyUser` | School and identity verification |

### Real-time (Socket.IO)
Users join a personal room (their uid) from the handshake. Live classes use `lecture_<id>` rooms, and physical attendance uses `lecture_attendance_<id>`. Media for live classes goes over **Agora**; sockets carry chat, raised hands, attendee lists, captions and class state.

### Scheduled jobs (`cron/`)
| Job | Schedule | Purpose |
| --- | --- | --- |
| `lectureReminderCron` | every minute | One in-app/push reminder per lecture, `LECTURE_REMINDER_LEAD_MINUTES` before it starts (leased and persisted in a transaction, so failed sends can retry safely) |
| `subscriptionsCron` | daily, 00:00 | Expires lapsed subscriptions |
| `flagSuspiciousAccountsCron` | daily, 00:00 | Flags suspicious sign-in activity |
| `checkForAlumnisCron` | 1st of every 6th month | Moves graduated students/lecturers |

---

## Tiered school analytics

`GET /admins/get-overview` (`getAdminMetrics`) returns `schoolMetrics` for `school_administrator` admins. A super admin can pass `?schoolCode=` to see any school. The response is built by `utils/schoolAnalytics.js` from the institution's `tier` (`OperationalInstitutions.tier`):

| Tier | Plan | Includes |
| --- | --- | --- |
| `free` | **Basic** | Student/lecturer identity and verification, attendance overview, courses and allocation, school memos, sign-up growth |
| `pro` | **Professional** | + tests and proctoring results, LMS activity, attendance by department/course with an 8-week trend, lecturer activity |
| `premium` | **Enterprise** | + at-risk students, department comparison, 12-week engagement, exam integrity and account security, dedicated support |

Queries for a tier only run when the school has it. The response includes `access` and `locked`, which the app uses to show upgrade prompts. Super admins change a school's plan from **Manage Authorized Institution** (`PATCH /admins/institutions/:id/update`, field `tier`). All analytics are scoped by `schoolCode` on users and courses.

---

## Getting started

### Prerequisites
- Node 18+ (the Dockerfile uses `node:18-slim`)
- A Firebase project with Firestore and Storage, and a service account key
- Accounts for the services listed in `../iCampus/THIRD_PARTY_SERVICES.txt`

### Install and run

```sh
npm install
# create .env from the list below
npm start                # node index.js, port $PORT (default 5000)
```

### Environment variables

```sh
# Server
PORT=5000
NODE_ENV=development
BACKEND_URL=
APP_LIVE_BASE_URL=            # base for online-class links
APP_USERID=                   # uid that authors system posts
JWT_SECRET=
REFRESH_TOKEN_SECRET=

# Firebase
FIREBASE_SERVICE_ACCOUNT=     # JSON string of the service account
FIREBASE_STORAGE_BUCKET=

# Cache / queues (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
QSTASH_TOKEN=

# Payments
FLW_SECRET_KEY=
FLUTTERWAVE_CLIENT_SECRET=
FLW_WEBHOOK_HASH=
EXCHANGERATE_API_KEY=

# Email (Postmark)
POSTMARK_API_KEY=
POSTMARK_SENDER_SIGNATURE=
INDIVIDUAL_TEMPLATE_ID=
ENTERPRISE_TEMPLATE_ID=
ENTERPRISE_SUPPORT_EMAIL=     # shown to Enterprise-plan schools

# WhatsApp / SMS (Twilio)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_WHATSAPP_NUMBER=
TWILIO_CONTENT_SID=

# Live classes
AGORA_APP_ID=                 # Agora console → project → App ID
AGORA_APP_CERTIFICATE=        # enable "App Certificate" in the project
DEEPGRAM_API_KEY=             # live captions

# Lecture reminders
LECTURE_TIMEZONE=Africa/Lagos # zone that "HH:mm" lecture times are in
LECTURE_REMINDER_LEAD_MINUTES=45

# AI, media, verification
GEMINI_API_KEY=
GEMINI_MODEL=
GOOGLE_PLACES_API_KEY=
GIPHY_API_KEY=
PERSONA_API_KEY=
PERSONA_ENV=
PERSONA_WEBHOOK_SECRET=
WEB_CLIENT_ID=                # Google Sign-In audience
MOCK_SCHOOL_SECRET=           # dev-only mock school verification

# Tests (controllertests/)
TEST_SECRET=
TEST_USER_EMAIL=
TEST_USER_PASSWORD=
ADMIN_TEST_EMAIL=
ADMIN_TEST_PASSWORD=
```

With `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` set, live classes work; the app needs no Agora keys of its own. Without them, `/v1/auth/agora-token` returns 503 "Live classes are not configured on the server yet."

### Tests

```sh
npm test        # Jest, against a running server and test accounts
```

---

## Deployment

**Google App Engine Flexible** (current): `app.yaml` + `Dockerfile`.

```sh
gcloud app deploy
```

`app.yaml` keeps at least one instance running (sockets and cron jobs need an always-on process) and scales to five. Set secrets as environment variables or through Secret Manager, not in `app.yaml`.

**Render** (alternative): create a *Web Service* from this repo with start command `npm start` and add the variables above. Use a paid instance, because free instances sleep and drop sockets and crons.

### Firestore indexes
Some queries need composite indexes (for example lectures by `date` + `status`, and orders by `buyerId`/`sellerId` + `status`). When one is missing, the server log shows Firestore's "create index" link; open it and the index builds in a few minutes.
