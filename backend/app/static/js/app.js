const terminal = document.getElementById("terminal");
const googleLoginBtn = document.getElementById("google-login");
const logoutBtn = document.getElementById("logout");
let ws;
let wsToken = null;
let user = null;
let reconnectTimer = null;
const PLACEHOLDER_TABLE = [
  "             _________________( BTN )_________________",
  "            /                  [----]                 \\",
  "           /                                            \\",
  "          /                                              \\",
  "        ( CO )                                          ( SB )",
  "      [----]       [??] [??] [??]  [??] [??]            [----]",
  "        |                POT: --                         |",
  "        |                                                 |",
  "      ( MP )                                          ( BB )",
  "      [----]                                          [----]",
  "         \\                                               /",
  "          \\                                             /",
  "           \\_________________( UTG )___________________/",
  "                              [----]",
].join("\n");

let lastTableBlock = PLACEHOLDER_TABLE;
let lastHandBlock = null;
let infoLines = [];
let coachingText = "evaluation loading...";
const COACH_FACE = [
  "              ______",
  "          \\___/______\\___/",
  "          @/  0   0   \\@",
  "          |     ..     |",
  "           \\    ___    /",
  "            \\_______/",
].join("\n");
const nextHandBtn = document.getElementById("next-hand");
const HEADER = [
  "    ____        __                ______                 __  ",
  "   / __ \\____  / /_____  _____   / ____/___  ____ ______/ /_ ",
  "  / /_/ / __ \\/ //_/ _ \\/ ___/  / /   / __ \\/ __ `/ ___/ __ \\",
  " / ____/ /_/ / ,< /  __/ /     / /___/ /_/ / /_/ / /__/ / / /",
  "/_/    \\____/_/|_|\\___/_/      \\____/\\____/\\__,_/\\___/_/ /_/ ",
  "                                                             ",
  "                                                             ",
].join("\n");

const wsBase = location.origin.replace(/^http/, "ws");

function maxCols() {
  const approxCharWidth = 8; // rough monospace width in px
  const width = terminal.clientWidth || window.innerWidth || 640;
  return Math.max(20, Math.floor(width / approxCharWidth));
}

function wrapContent(text) {
  const width = maxCols();
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    let chunk = line;
    while (chunk.length > width) {
      out.push(chunk.slice(0, width));
      chunk = chunk.slice(width);
    }
    out.push(chunk);
  }
  return out.join("\n");
}

function cardLines(code) {
  const rank = code && code.length === 2 ? code[0] : "?";
  const suit = code && code.length === 2 ? code[1] : "?";
  const suitSymbol =
    suit.toLowerCase() === "h"
      ? "♥"
      : suit.toLowerCase() === "d"
      ? "♦"
      : suit.toLowerCase() === "c"
      ? "♣"
      : suit.toLowerCase() === "s"
      ? "♠"
      : "?";
  const face = `${rank}${suitSymbol}`;
  return [" ___ ", `|${face.padEnd(3, " ")}|`, "|___|"];
}

function formatCardSymbols(cards = []) {
  return cards
    .map((code) => {
      const rank = code && code.length === 2 ? code[0] : "?";
      const suit = code && code.length === 2 ? code[1] : "?";
      const suitSymbol =
        suit.toLowerCase() === "h"
          ? "♥"
          : suit.toLowerCase() === "d"
          ? "♦"
          : suit.toLowerCase() === "c"
          ? "♣"
          : suit.toLowerCase() === "s"
          ? "♠"
          : "?";
      return `${rank}${suitSymbol}`;
    })
    .join(" ");
}

function renderCards(cards, maxCount = 5) {
  const lines = ["", "", ""];
  const show = cards && cards.length ? cards : [];
  for (let i = 0; i < maxCount; i++) {
    const card = show[i] || "??";
    const [a, b, c] = cardLines(card);
    lines[0] += a + " ";
    lines[1] += b + " ";
    lines[2] += c + " ";
  }
  return lines.map((l) => l.trimEnd()).join("\n");
}

function sideBySide(leftBlock, rightBlock, gap = 2) {
  const left = leftBlock.split("\n");
  const right = rightBlock.split("\n");
  const leftWidth = Math.max(...left.map((l) => l.length));
  const rightWidth = Math.max(...right.map((l) => l.length));
  const maxLines = Math.max(left.length, right.length);
  const padLine = (arr, idx, width) => (idx < arr.length ? arr[idx].padEnd(width, " ") : "".padEnd(width, " "));
  const lines = [];
  for (let i = 0; i < maxLines; i++) {
    lines.push(`${padLine(left, i, leftWidth)}${" ".repeat(gap)}${padLine(right, i, rightWidth)}`);
  }
  return lines.join("\n");
}

function renderScreen() {
  const sections = [];
  sections.push(HEADER);
  const handBlock = `Your hand:\n${lastHandBlock || renderCards(["??", "??"], 2)}`;
  const totalCols = maxCols();
  const handWidth = handBlock.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
  const gap = 4;
  const coachWidth = Math.max(20, totalCols - handWidth - gap);
  const coachBlock = buildCoachSection(coachingText, coachWidth);
  const combined = sideBySide(handBlock, coachBlock, gap);

  sections.push(lastTableBlock || PLACEHOLDER_TABLE);
  if (infoLines.length) sections.push(infoLines.join("\n"));
  sections.push(combined);
  const text = sections.join("\n\n");
  terminal.textContent = text;
  terminal.scrollTop = terminal.scrollHeight;
}

function setInfo(line) {
  infoLines = line ? [line] : [];
  renderScreen();
}

function setCoaching(line) {
  coachingText = line || "evaluation loading...";
  renderScreen();
}

function buildBox(text, title, widthOverride) {
  const body = text ? text.split("\n") : [""];
  const fullWidth = widthOverride || maxCols();
  const width = Math.max(10, fullWidth - 4); // account for borders
  const total = width + 4;
  const wrapped = [];
  body.forEach((ln) => {
    let chunk = ln;
    while (chunk.length > width) {
      wrapped.push(chunk.slice(0, width));
      chunk = chunk.slice(width);
    }
    wrapped.push(chunk);
  });
  const padLeft = Math.floor((total - title.length) / 2);
  const padRight = Math.max(0, total - title.length - padLeft);
  const border = "=".repeat(Math.max(0, padLeft)) + title + "=".repeat(Math.max(0, padRight));
  const footer = "_".repeat(total);
  const content = wrapped.map((ln) => `| ${ln.padEnd(width, " ")} |`).join("\n");
  return `${border}\n${content}\n${footer}`;
}

function buildCoachingBox(text, widthOverride) {
  return buildBox(text || "evaluation loading...", "== COACH'S CORNER ==", widthOverride);
}

function buildCoachSection(text, widthOverride) {
  return buildCoachingBox(text, widthOverride);
}

function renderTable(state) {
  if (!state) return;
  const cardSym = (c) => {
    if (!c || c.length !== 2) return "??";
    return formatCardSymbols([c]);
  };
  const b = [
    cardSym(state.board[0]),
    cardSym(state.board[1]),
    cardSym(state.board[2]),
    cardSym(state.board[3]),
    cardSym(state.board[4]),
  ];
  const tableLines = [
    "             _________________( BTN )_________________",
    "            /                  [CHECK]                 \\",
    "           /                                            \\",
    "          /                                              \\",
    "      ( CO )                                            ( SB )",
    `      [FOLD]       [${b[0]}] [${b[1]}] [${b[2]}]  [${b[3]}] [${b[4]}]            [CHECK]`,
    `        |                POT: ${state.pot || 0}                           |`,
    "        |                                                 |",
    "      ( MP )                                            ( BB )",
    `      [CALL]                                           [BET ${state.bot_bet || 0}]`,
    "         \\                                               /",
    "          \\                                             /",
    "           \\_________________( UTG )___________________/",
    `                              [RAISE ${state.hero_bet || 0}]`,
  ];

  const faceLines = [
    "              _______",
    "         \\___/_coach_\\___/",
    "           @/ 0   0   \\@",
    "           |   ..     |",
    "           \\   ___   /",
    "            \\_______/",
  ];

  const handVisual = renderCards(state.hero_hand || [], 2);
  const tableBlock = sideBySide(tableLines.join("\n"), faceLines.join("\n"), 4);
  lastTableBlock = tableBlock;
  lastHandBlock = handVisual;
  renderScreen();
}

function handleServerMessage(msg) {
  if (!msg || typeof msg !== "object") {
    setInfo(`server: ${JSON.stringify(msg)}`);
    return;
  }

  switch (msg.type) {
    case "session_joined":
    case "state_update":
      renderTable(msg.state);
      setCoaching("evaluation loading...");
      break;
    case "hand_summary":
      setInfo(`Hand over (${msg.reason}) — winner: ${msg.winner}`);
      renderTable(msg.state || msg);
      // Reveal bot hand on showdown if available.
      if (msg.bot_hand) {
        setInfo(`Bot hand: ${formatCardSymbols(msg.bot_hand)}`);
      }
      // Show next hand button if server allows.
      if (msg.can_start_next_hand) {
        nextHandBtn.style.display = "inline-block";
      }
      setCoaching("evaluation loading...");
      break;
    case "error":
      setInfo(`Error: ${msg.message || "Server error"}`);
      break;
    case "facts_update":
      // Ignore facts in UI.
      break;
    case "pong":
      setInfo("pong");
      break;
    case "coaching_update":
      if (msg.coaching) setCoaching(`${msg.coaching.assessment || ""}\n${msg.coaching.advice || ""}`);
      break;
    default:
      // Ignore unknown messages to avoid clutter.
      break;
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: "include", ...options });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadSession() {
  try {
    const me = await fetchJson("/auth/me");
    user = me;
    googleLoginBtn.disabled = true;
    setInfo(`Signed in as: ${me.email || me.name || me.user_id}`);
    await fetchWsToken();
  } catch {
    user = null;
    googleLoginBtn.disabled = false;
    setInfo("Not signed in. Use Sign in with Google or dev login callback.");
  }
}

async function fetchWsToken() {
  try {
    const data = await fetchJson("/auth/token");
    wsToken = data.ws_token;
    connectWs();
  } catch (err) {
    setInfo("No session; cannot start websocket.");
  }
}

function connectWs() {
  if (!wsToken) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = `${wsBase}/ws/table?token=${encodeURIComponent(wsToken)}`;
  setInfo("Connecting to table...");
  ws = new WebSocket(url);
  ws.onopen = () => {};
  ws.onclose = () => {
    setInfo("Connection closed. Reconnecting...");
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWs, 1500);
  };
  ws.onerror = () => setInfo("Connection error.");
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (err) {
      setInfo(`server: ${event.data}`);
    }
  };
}

function sendAction(action, amount = null) {
  const payload = { action, amount, ts: new Date().toISOString() };
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function wireEvents() {
  googleLoginBtn.addEventListener("click", () => {
    window.location.href = "/auth/google/login";
  });

  logoutBtn.addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    user = null;
    wsToken = null;
    if (ws) ws.close();
    await loadSession();
    setInfo("Logged out.");
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      let amount = null;
      if (action === "bet" || action === "raise") {
        const amountInput = document.getElementById("bet-amount");
        amount = amountInput ? Number(amountInput.value || "0") : null;
      }
      sendAction(action, amount);
    });
  });

  nextHandBtn.addEventListener("click", () => {
    nextHandBtn.style.display = "none";
    sendAction("next_hand", null);
  });
}

function bootstrap() {
  wireEvents();
  loadSession();
  setInfo("Tip: click an action to start. Dev mode allows login without Google secrets.");
  window.addEventListener("resize", renderScreen);
}

bootstrap();
