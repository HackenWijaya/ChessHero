# ChessHero

Comic-themed multiplayer chess powered by Node.js, Socket.IO, and chess.js. Battle as Iron Man, Captain America, or Hulk with live hero/villain palettes, lobby matchmaking, clocks, and authoritative server logic.

## Features
- Real-time multiplayer rooms with Socket.IO and server-side chess.js validation.
- Lobby screen with live room list and superhero theme selector (Iron Man, Captain America, Hulk).
- Authoritative server handles moves, legality checks, clocks, draw offers, resignations, and rematches.
- Canvas-based comic chessboard with custom hero/villain piece art that adapts to theme selection.
- Lightweight, responsive UI built with HTML/CSS/vanilla JS and comic-inspired styling.

## Getting Started
```bash
git clone https://github.com/HackenWijaya/ChessHero.git
cd ChessHero
npm install
npm run dev
```

Open your browser to `http://localhost:3000`, create a room, pick a theme, and share the link with a friend (or open another browser window) to start playing.

## Project Structure
- `server.js` – Express + Socket.IO server with chess.js logic and room management.
- `public/index.html` – Lobby and game UI.
- `public/style.css` – Comic pop-art styling and theme palettes.
- `public/client.js` – Front-end Socket.IO client, canvas rendering, and theme handling.

## Scripts
- `npm run dev` – Start the development server with nodemon.
- `npm start` – Run the server with Node.js.

## Technology
- Node.js, Express, Socket.IO
- chess.js
- HTML5 Canvas, vanilla JavaScript, CSS3

## License
MIT

