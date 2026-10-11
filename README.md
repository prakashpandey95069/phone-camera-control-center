# Phone Camera Control Center

A consent-based Android camera dashboard using React + Vite + Tailwind, Node.js + Express + Socket.IO, and WebRTC.

## Features

- Pairing with a six-digit code that expires after 30 minutes
- Explicit dashboard approval before the camera is activated
- Live phone-to-dashboard video using WebRTC
- Rear/front camera switching, photo capture, and browser-based video recording
- HTTPS-ready browser camera permissions
- Optional TURN server configuration for difficult networks

## Folder structure

```text
phone-camera-control-center/
├── package.json
├── .gitignore
├── README.md
├── server/
│   ├── package.json
│   ├── .env.example
│   └── src/index.js
└── client/
    ├── package.json
    ├── .env.example
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── index.css
```

## Requirements

- Node.js 20 or newer
- npm
- An Android phone with a modern Chrome browser
- A public HTTPS deployment for use over the internet
- For reliable connectivity across restrictive NATs/mobile networks, a TURN server

## Local development

1. Extract the ZIP and open a terminal in the project root.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `server/.env` from `server/.env.example`:

   ```env
   PORT=5000
   CLIENT_ORIGIN=http://localhost:5173
   ```

4. Create `client/.env` from `client/.env.example`:

   ```env
   VITE_SIGNALING_URL=http://localhost:5000
   ```

5. Start both apps:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:5173` on the laptop. Generate a code.
7. Local phone testing still needs a secure camera origin. Use an HTTPS tunnel or deploy the app; opening a LAN IP over plain HTTP generally does not qualify as a secure context for `getUserMedia()`.

## Production deployment (remote access)

Deploy the frontend and signaling server to public hosting. Configure both with TLS so the frontend is HTTPS and the signaling URL is HTTPS/WSS.

### Server environment

Set the following in your backend hosting provider:

```env
PORT=5000
CLIENT_ORIGIN=https://YOUR-FRONTEND-DOMAIN.example
```

Use the exact origin (scheme + hostname, no trailing path). If the frontend uses multiple known origins, list them comma-separated.

### Frontend environment

Set this at build time:

```env
VITE_SIGNALING_URL=https://YOUR-BACKEND-DOMAIN.example
```

Rebuild and redeploy the frontend after changing `VITE_*` variables.

### TURN server (strongly recommended)

STUN alone will not connect successfully on every mobile carrier, office Wi-Fi, or symmetric NAT. Provision a TURN service (for example, a properly secured coturn instance or a managed WebRTC TURN provider) and configure:

```env
VITE_TURN_URL=turn:YOUR-TURN-HOST:3478
VITE_TURN_USERNAME=YOUR_SHORT_LIVED_USERNAME
VITE_TURN_CREDENTIAL=YOUR_SHORT_LIVED_CREDENTIAL
```

For production, use TLS TURN where supported (commonly `turns:`), short-lived credentials, and provider-specific URL/transport configuration. Never publish a permanent TURN secret in frontend code; Vite environment variables are bundled into public JavaScript. Prefer a TURN provider that issues time-limited credentials from a protected backend. This demo only supports static values for development/testing.

## How to use

1. Open the deployed dashboard on your laptop.
2. Click **Generate pairing code**.
3. On Android Chrome, open the same deployed site and add `?mode=phone` to the URL. Example: `https://YOUR-FRONTEND-DOMAIN.example/?mode=phone`.
4. Enter the six-digit code and request connection.
5. On the laptop, approve the pairing request.
6. Android Chrome asks for camera permission. Choose **Allow**.
7. Keep the phone page open and screen awake during streaming. Use dashboard controls to capture a photo or start/stop recording.
8. Recordings are created by the phone browser and saved through its download flow.

## Browser and platform notes

- `getUserMedia()` requires a secure context: HTTPS, or localhost during development, and explicit browser permission.
- Browser behavior can differ by Android model and browser version. The phone page must remain open; mobile OS battery management may pause background camera/recording.
- Photo capture downloads a JPEG to the dashboard. Video recording downloads a WebM file to the phone; codec/container support varies by browser.
- Torch control is best-effort and may not be supported.
- Advanced controls such as manual ISO, shutter speed, focus distance, and exposure are not consistently exposed through mobile browser APIs. A native Android app using CameraX/Camera2 would be required for robust advanced camera controls.
- WebRTC media is peer-to-peer when possible. STUN/TURN configuration affects whether the stream can cross networks.
- The sample does not persist rooms or provide user accounts. Pairing codes are short-lived, but production systems should add rate limiting, stronger authenticated pairing, audit logs, and short-lived TURN credentials.

## Security checklist before public use

- Keep frontend and backend HTTPS-only.
- Restrict `CLIENT_ORIGIN` to your exact production frontend origin.
- Add rate limiting and abuse monitoring to room creation and join attempts.
- Add authenticated dashboard accounts and stronger device identity if using beyond personal testing.
- Never use this app to access a camera without the device owner's explicit consent.
- Do not commit `.env` files or credentials.
