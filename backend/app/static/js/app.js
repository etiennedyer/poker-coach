const terminal = document.getElementById("terminal");
const googleLoginBtn = document.getElementById("google-login");
const logoutBtn = document.getElementById("logout");
const callCheckBtn = document.getElementById("call-check");
let ws;
let wsToken = null;
let user = null;
let reconnectTimer = null;
let lastActions = { hero: null, bot: null };
let lastHandId = null;

const TABLE_FACE = [
  "     _______",
  "\\___/_coach_\\___/",
  "  @/ 0   0   \\@",
  "  |   ..     |",
  "  \\   ___   /",
  "   \\_______/",
];

const THINKING_FACE = [
  "     _______",
  "\\___/_coach_\\___/",
  "  @/ °   0   \\@",
  "  |   ..     |",
  "  \\   ___   /",
  "   \\___@___/",
];
const SEAT_WIDTH = 8;
function formatSeat(label) {
  const content = (label || "").trim();
  if (!content || content === "---") {
    const inner = " --- ";
    return `(${inner})`;
  }
  const inner = content.slice(0, SEAT_WIDTH - 2).padEnd(SEAT_WIDTH - 2, " ");
  return `(${inner})`;
}

function formatAction(label, width = SEAT_WIDTH - 2) {
  const target = (label || "---").trim() || "---";
  const innerWidth = Math.max(width, target.length);
  const clipped = target.slice(0, innerWidth);
  const padTotal = Math.max(0, innerWidth - clipped.length);
  const leftPad = Math.floor(padTotal / 2);
  const rightPad = padTotal - leftPad;
  const inner = `${" ".repeat(leftPad)}${clipped}${" ".repeat(rightPad)}`;
  return `[${inner}]`;
}

function formatStack(amount, width = SEAT_WIDTH - 2) {
  if (amount === null || amount === undefined) return formatAction("---", width);
  const raw = `$${amount}`;
  return formatAction(raw, width);
}

function normalizeActionLabel(raw) {
  if (!raw || typeof raw !== "string") return null;
  const withoutActor = raw.replace(/^(hero|bot)\s+/i, "").trim();
  if (!withoutActor) return null;
  return withoutActor.toUpperCase();
}

function rememberAction(actor, action) {
  const label = normalizeActionLabel(action);
  if (!actor || !label) return;
  lastActions[actor] = label;
}

function syncActionsForState(state, meta = {}) {
  if (!state) return;
  if (state.hand_id !== undefined && state.hand_id !== lastHandId) {
    lastHandId = state.hand_id;
    lastActions = { hero: null, bot: null };
  }

  const reason = meta?.reason;
  if (typeof reason === "string") {
    const lowerReason = reason.toLowerCase();
    if (lowerReason.startsWith("hero")) rememberAction("hero", reason);
    else if (lowerReason.startsWith("bot")) rememberAction("bot", reason);
  }

  if (meta.actor === "bot" && meta.bot_action) {
    rememberAction("bot", meta.bot_action);
  }
  if (meta.type === "bot_action" && meta.action) {
    rememberAction("bot", meta.action);
  }

  if (state.last_action) {
    const lower = state.last_action.toLowerCase();
    if (lower.startsWith("hero")) rememberAction("hero", state.last_action);
    else if (lower.startsWith("bot")) rememberAction("bot", state.last_action);
  }

  if (!lastActions.hero && state.hero_bet) rememberAction("hero", `BET ${state.hero_bet}`);
  if (!lastActions.bot && state.bot_bet) rememberAction("bot", `BET ${state.bot_bet}`);
}

function updateCallCheckButton(state) {
  if (!callCheckBtn) return;
  if (!state) {
    callCheckBtn.textContent = "Check";
    callCheckBtn.dataset.action = "check";
    return;
  }
  const heroBet = state.hero_bet ?? 0;
  const botBet = state.bot_bet ?? 0;
  const currentBet = state.current_bet ?? Math.max(heroBet, botBet);
  const toCall = Math.max(0, currentBet - (heroBet || 0));
  if (toCall > 0) {
    callCheckBtn.textContent = `Call $${toCall}`;
    callCheckBtn.dataset.action = "call";
  } else {
    callCheckBtn.textContent = "Check";
    callCheckBtn.dataset.action = "check";
  }
}

function centerText(text, width) {
  const clipped = (text || "").slice(0, width);
  const padTotal = Math.max(0, width - clipped.length);
  const leftPad = Math.floor(padTotal / 2);
  const rightPad = padTotal - leftPad;
  return `${" ".repeat(leftPad)}${clipped}${" ".repeat(rightPad)}`;
}

function buildSixMaxTableLines(state) {
  const pot = state?.pot ?? "--";
  const heroBet = state?.hero_bet ?? 0;
  const botBet = state?.bot_bet ?? 0;
  const heroStack = state?.hero_stack;
  const botStack = state?.bot_stack;
  const currentBet = state?.current_bet ?? Math.max(heroBet, botBet);
  const toCall = Math.max(0, currentBet - (heroBet || 0));
  const b = [
    cardSym(state?.board?.[0]),
    cardSym(state?.board?.[1]),
    cardSym(state?.board?.[2]),
    cardSym(state?.board?.[3]),
    cardSym(state?.board?.[4]),
  ];
  const seats = {
    BTN: formatSeat("---"),
    CO: formatSeat("---"),
    SB: formatSeat("---"),
    MP: formatSeat("---"),
    BB: formatSeat("BB BOT"),
    UTG: formatSeat("BTN/SB YOU"),
  };
  const heroAction = lastActions.hero || (heroBet ? `BET ${heroBet}` : "CHECK");
  const botAction = lastActions.bot || (botBet ? `BET ${botBet}` : "CHECK");
  const actions = {
    CO: formatAction("---"),
    SB: formatAction("---"),
    MP: formatAction("---"),
    BTN: formatAction("---"),
    BB: formatAction(botAction),
    UTG: formatAction(heroAction),
  };
  const stacks = {
    CO: formatStack(null),
    SB: formatStack(null),
    MP: formatStack(null),
    BTN: formatStack(null),
    BB: formatStack(botStack),
    UTG: formatStack(heroStack),
  };
  const potLabel = `${pot}`.padEnd(6, " ");
  const toCallLabel = `${toCall}`.padEnd(6, " ");
  const boardRow = `[${b[0]}] [${b[1]}] [${b[2]}]  [${b[3]}] [${b[4]}]`;
  const utgLine = `           \\_________________${seats.UTG}__________________/ `;
  const utgIndent = utgLine.match(/^ */)?.[0] || "";
  const utgContentWidth = utgLine.length - utgIndent.length;
  return [
    `             _______________${seats.BTN}_______________`,
    `            /               ${actions.BTN}               \\`,
    `           /                ${stacks.BTN}                \\`,
    "          /                                          \\",
    `        ${seats.CO}                                     ${seats.SB}`,
    `       ${actions.CO}      ${boardRow}     ${actions.SB}`,
    `       ${stacks.CO}                                    ${stacks.SB}`,
    `        |                   POT: ${potLabel}               |`,
    "        |                                             |",
    `       ${seats.MP}            TO CALL: ${toCallLabel}         ${seats.BB}`,
    `       ${actions.MP}                                   ${actions.BB}`,
    `       ${stacks.MP}                                   ${stacks.BB}`,
    "         \\                                           /",
    "          \\                                         /",
`           \\_______________${seats.UTG}________________/ `,
    `                           ${actions.UTG}`,
    `                           ${stacks.UTG}`,
  ];
}
let lastTableLines = buildSixMaxTableLines();
let lastFaceLines = TABLE_FACE;
let lastHandBlock = null;
let infoLines = [];
let coachingText = "Play a hand to get feedback!";
let lastInfoWasError = false;
let hasActed = false;
let awaitingCoaching = false;
let coachingSpinner = null;
let coachingSpinnerStep = 1;
const nextHandBtn = document.getElementById("next-hand");
const HEADER_FULL = [
  "    ____        __                ______                 __  ",
  "   / __ \\____  / /_____  _____   / ____/___  ____ ______/ /_ ",
  "  / /_/ / __ \\/ //_/ _ \\/ ___/  / /   / __ \\/ __ `/ ___/ __ \\",
  " / ____/ /_/ / ,< /  __/ /     / /___/ /_/ / /_/ / /__/ / / /",
  "/_/    \\____/_/|_|\\___/_/      \\____/\\____/\\__,_/\\___/_/ /_/ ",
  "                                                             ",
  "                                                             ",
];
const HEADER_FULL_WIDTH = Math.max(...HEADER_FULL.map((l) => l.length));
const COACH_TITLE = "== COACH'S CORNER ==";
const COACH_MAX_WIDTH = "============== COACH'S CORNER ===============".length;
function splitHeader(lines) {
  const width = Math.max(...lines.map((l) => l.length));
  const gapCols = [];
  for (let col = 0; col < width; col++) {
    if (lines.every((ln) => (ln[col] || " ") === " ")) gapCols.push(col);
  }
  const splitCol = gapCols.length ? gapCols[Math.floor(gapCols.length / 2)] + 1 : Math.floor(width / 2);
  const rtrim = (s) => s.replace(/\s+$/, "");
  const left = lines.map((ln) => rtrim(ln.slice(0, splitCol))).filter((ln, idx, arr) => idx < arr.length - 2 || ln.trim());
  const right = lines.map((ln) => rtrim(ln.slice(splitCol))).filter((ln, idx, arr) => idx < arr.length - 2 || ln.trim());
  const leftWidth = Math.max(...left.map((l) => l.length));
  const rightWidth = Math.max(...right.map((l) => l.length));
  return { left, right, leftWidth, rightWidth, stackWidth: Math.max(leftWidth, rightWidth) };
}
const HEADER_SPLIT = splitHeader(HEADER_FULL);
const HEADER_POKER = HEADER_SPLIT.left;
const HEADER_COACH = HEADER_SPLIT.right;
const HEADER_STACK_WIDTH = HEADER_SPLIT.stackWidth;

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

function cardSym(c) {
  if (!c || c.length !== 2) return "??";
  return formatCardSymbols([c]);
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

function dedent(block) {
  const lines = block.split("\n");
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^ */)?.[0].length || 0);
  const minIndent = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(minIndent)).join("\n");
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

function centerBlock(block, widthOverride) {
  const lines = block.split("\n");
  const targetWidth = widthOverride || maxCols();
  const blockWidth = Math.max(...lines.map((l) => l.length), 0);
  const pad = Math.max(0, Math.floor((targetWidth - blockWidth) / 2));
  if (!pad) return block;
  const padStr = " ".repeat(pad);
  return lines.map((ln) => padStr + ln).join("\n");
}

function blockWidth(block) {
  return block.split("\n").reduce((m, ln) => Math.max(m, ln.length), 0);
}

function shrinkLineToWidth(line, maxWidth) {
  if (!line || line.length <= maxWidth) return line;
  let out = line;
  const trimRuns = (regex) => {
    while (out.length > maxWidth) {
      const runs = [...out.matchAll(regex)];
      if (!runs.length) break;
      runs.sort((a, b) => b[0].length - a[0].length);
      const target = runs[0];
      if (!target || target[0].length <= 1) break;
      const cutIdx = target.index + Math.floor(target[0].length / 2);
      out = out.slice(0, cutIdx) + out.slice(cutIdx + 1);
    }
  };
  // Prefer shaving underscores (table edges) before collapsing space gaps.
  trimRuns(/_+/g);
  trimRuns(/ {2,}/g);
  return out.length > maxWidth ? out.slice(0, maxWidth) : out;
}

function shrinkTableLines(lines, maxWidth) {
  return lines.map((ln) => shrinkLineToWidth(ln, maxWidth));
}

function buildTableLayout(tableLines, faceLines) {
  const table = tableLines && tableLines.length ? tableLines : buildSixMaxTableLines();
  const faces = faceLines || [];
  const totalCols = maxCols();
  const faceWidth = faces.length ? Math.max(...faces.map((l) => l.length)) : 0;
  const gap = faces.length ? 2 : 0;
  const maxTableWidth = Math.max(30, totalCols - faceWidth - gap);
  const compactTableLines = shrinkTableLines(table, maxTableWidth);
  if (!faces.length) {
    return compactTableLines.join("\n");
  }
  const facePadTop = Math.max(0, compactTableLines.length - faces.length);
  const paddedFaceLines = Array(facePadTop).fill("").concat(faces);
  return sideBySide(compactTableLines.join("\n"), paddedFaceLines.join("\n"), gap || 2);
}

function renderScreen() {
  const sections = [];
  const cols = maxCols();
  const headerBlock =
    cols >= HEADER_FULL_WIDTH
      ? HEADER_FULL.join("\n")
      : cols >= HEADER_STACK_WIDTH
      ? [...HEADER_POKER, ...HEADER_COACH].join("\n")
      : "Poker\nCoach";
  sections.push(centerBlock(headerBlock, cols));
  const handBlock = `Your hand:\n${lastHandBlock || renderCards(["??", "??"], 2)}`;
  const isCollapsed = cols < HEADER_FULL_WIDTH;
  const tableBlock = dedent(buildTableLayout(lastTableLines, isCollapsed ? [] : lastFaceLines));
  const refWidth = Math.max(cols, blockWidth(tableBlock));
  sections.push(isCollapsed ? tableBlock : centerBlock(tableBlock, cols));
  if (infoLines.length) sections.push(centerBlock(infoLines.join("\n"), refWidth));

  if (isCollapsed) {
    const faceBlock =
      lastFaceLines && lastFaceLines.length ? dedent(lastFaceLines.join("\n")) : "";
    const midRow = centerBlock(sideBySide(handBlock, faceBlock, 4), cols);
    sections.push(midRow);
    const coachBlock = centerBlock(buildCoachSection(coachingText, cols), cols);
    sections.push(coachBlock);
  } else {
    const totalCols = cols;
    const handWidth = handBlock.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
    const gap = 4;
    const coachWidth = Math.max(20, totalCols - handWidth - gap);
    const coachBlock = buildCoachSection(coachingText, coachWidth);
    const combined = sideBySide(handBlock, coachBlock, gap);
    sections.push(centerBlock(combined, cols));
  }
  const text = sections.join("\n\n");
  terminal.textContent = text;
  terminal.scrollTop = terminal.scrollHeight;
}

function setInfo(line) {
  infoLines = line ? [line] : [];
  lastInfoWasError = !!line && line.toLowerCase().startsWith("error");
  renderScreen();
}

function setCoaching(line) {
  const isLoading = line === undefined || line === null || line === "evaluation loading..." || line === "evaluation loading";
  if (isLoading) {
    if (!coachingSpinner) {
      coachingSpinnerStep = 1;
      coachingText = "evaluation loading.";
      coachingSpinner = setInterval(() => {
        coachingSpinnerStep = coachingSpinnerStep % 3 + 1; // cycles 1,2,3
        coachingText = `evaluation loading${".".repeat(coachingSpinnerStep)}`;
        renderScreen();
      }, 450);
    }
    renderScreen();
    return;
  }
  if (coachingSpinner) {
    clearInterval(coachingSpinner);
    coachingSpinner = null;
  }
  coachingText = line;
  renderScreen();
}

function buildBox(text, title, widthOverride, leftPad = 2, alignCenter = false, rightPad = leftPad) {
  const body = text ? text.split("\n") : [""];
  const fullWidth = widthOverride || maxCols();
  const minInner = Math.max(1, Math.min(10, fullWidth - 4));
  let leftPadSpaces = Math.max(0, leftPad);
  let rightPadSpaces = Math.max(0, rightPad);

  if (alignCenter) {
    const maxMargin = 6; // keep centered padding modest on narrow screens
    const padBudget = Math.min(maxMargin, Math.max(0, fullWidth - (minInner + 4)));
    leftPadSpaces = Math.floor(padBudget / 2);
    rightPadSpaces = padBudget - leftPadSpaces;
  } else {
    let innerCandidate = fullWidth - leftPadSpaces - rightPadSpaces - 4;
    if (innerCandidate < minInner) {
      const padBudget = Math.max(0, fullWidth - (minInner + 4));
      const totalPad = Math.max(1, leftPadSpaces + rightPadSpaces);
      const leftShare = Math.floor((leftPadSpaces / totalPad) * padBudget);
      leftPadSpaces = leftShare;
      rightPadSpaces = padBudget - leftPadSpaces;
    }
  }

  let innerWidth = Math.max(minInner, fullWidth - leftPadSpaces - rightPadSpaces - 4); // account for borders plus pad
  let total = innerWidth + 4; // | + space + content + space + |
  if (title.length > total) {
    total = title.length;
    innerWidth = Math.max(minInner, total - 4);
  }
  const overflow = leftPadSpaces + total + rightPadSpaces - fullWidth;
  if (overflow > 0) {
    const trimLeft = Math.min(leftPadSpaces, Math.ceil(overflow / 2));
    const trimRight = Math.min(rightPadSpaces, overflow - trimLeft);
    leftPadSpaces -= trimLeft;
    rightPadSpaces -= trimRight;
  }
  const padWidth = Math.max(total, title.length);
  const padLeft = Math.max(0, Math.floor((padWidth - title.length) / 2));
  const padRight = Math.max(0, padWidth - title.length - padLeft);
  const wrapped = [];
  body.forEach((ln) => {
    let chunk = ln;
    while (chunk.length > innerWidth) {
      wrapped.push(chunk.slice(0, innerWidth));
      chunk = chunk.slice(innerWidth);
    }
    wrapped.push(chunk);
  });
  const padStart = " ".repeat(leftPadSpaces);
  const padEnd = " ".repeat(rightPadSpaces);
  const border = `${padStart}${"=".repeat(padLeft)}${title}${"=".repeat(padRight)}${padEnd}`;
  const footer = `${padStart}${"_".repeat(total)}${padEnd}`;
  const content = wrapped.map((ln) => `${padStart}| ${ln.padEnd(innerWidth, " ")} |${padEnd}`).join("\n");
  return `${border}\n${content}\n${footer}`;
}

function buildCoachingBox(text, widthOverride, alignCenter = false) {
  const boxWidth = Math.min(widthOverride || maxCols(), COACH_MAX_WIDTH);
  return buildBox(
    text || "evaluation loading...",
    COACH_TITLE,
    boxWidth,
    alignCenter ? 0 : 2,
    alignCenter,
    alignCenter ? 0 : 2
  );
}

function buildCoachSection(text, widthOverride) {
  const cols = widthOverride || maxCols();
  const centerCoach = cols < HEADER_FULL_WIDTH;
  return buildCoachingBox(text, cols, centerCoach);
}

function renderTable(state, meta = {}) {
  if (!state) return;
  syncActionsForState(state, meta);
  lastTableLines = buildSixMaxTableLines(state);
  lastFaceLines = TABLE_FACE;
  lastHandBlock = renderCards(state.hero_hand || [], 2);
  updateCallCheckButton(state);
  renderScreen();
}

function handleServerMessage(msg) {
  if (!msg || typeof msg !== "object") {
    setInfo(`server: ${JSON.stringify(msg)}`);
    return;
  }

  switch (msg.type) {
    case "session_joined":
      renderTable(msg.state, msg);
      break;
    case "state_update":
      if (lastInfoWasError) setInfo("");
      renderTable(msg.state, msg);
      // Keep existing coaching message unless we're explicitly awaiting new advice.
      break;
    case "hand_summary": {
      const payout = msg.payout ?? msg.pot;
      const summaryLines = [`Hand over (${msg.reason}) — ${msg.winner || "unknown"}`];
      if (payout !== undefined && payout !== null) {
        summaryLines[0] += ` wins $${payout}`;
      }
      if (msg.bot_hand) {
        summaryLines.push(`Bot hand: ${formatCardSymbols(msg.bot_hand)}`);
      }
      setInfo(summaryLines.join("\n"));
      renderTable(msg.state || msg, msg);
      // Show next hand button if server allows.
      if (msg.can_start_next_hand) {
        nextHandBtn.style.display = "inline-block";
      }
      // Keep the spinner running until coaching advice arrives if we're waiting for it.
      hasActed = false;
      if (awaitingCoaching) {
        setCoaching("evaluation loading...");
      }
      break;
    }
    case "error":
      setInfo(`Error: ${msg.message || "Server error"}`);
      awaitingCoaching = false;
      break;
    case "facts_update":
      // Ignore facts in UI.
      break;
    case "pong":
      setInfo("pong");
      break;
    case "coaching_update":
      if (msg.coaching) setCoaching(`${msg.coaching.assessment || ""}\n${msg.coaching.advice || ""}`);
      awaitingCoaching = false;
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
    if (googleLoginBtn) googleLoginBtn.disabled = true;
    if (logoutBtn) logoutBtn.disabled = false;
    await fetchWsToken();
    return;
  } catch {
    // no session; try dev login to keep table usable without auth
  }
  try {
    await fetch("/auth/dev-login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "dev-user", email: "dev@example.com", name: "Dev User" }),
    });
    const me = await fetchJson("/auth/me");
    user = me;
    if (googleLoginBtn) googleLoginBtn.disabled = true;
    if (logoutBtn) logoutBtn.disabled = false;
    await fetchWsToken();
  } catch {
    user = null;
    if (googleLoginBtn) googleLoginBtn.disabled = true;
    if (logoutBtn) logoutBtn.disabled = true;
    setInfo("Unable to start session.");
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
  if (action === "next_hand") {
    hasActed = false;
    awaitingCoaching = false;
    setCoaching("Play a hand to get feedback!");
    setInfo("");
  } else {
    hasActed = true;
    awaitingCoaching = true;
    setCoaching("evaluation loading...");
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function wireEvents() {
  if (googleLoginBtn) {
    googleLoginBtn.style.display = "none";
    googleLoginBtn.addEventListener("click", () => {
      window.location.href = "/auth/google/login";
    });
  }

  if (logoutBtn) {
    logoutBtn.style.display = "none";
    logoutBtn.addEventListener("click", async () => {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
      user = null;
      wsToken = null;
      if (ws) ws.close();
      await loadSession();
    });
  }

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
  updateCallCheckButton();
  renderScreen();
  window.addEventListener("resize", renderScreen);
}

bootstrap();
