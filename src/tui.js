/*
 * tui.js — tiny zero-dependency TUI toolkit.
 * Raw-mode keypresses, screen control, meters, typewriter, spinners.
 */
"use strict";

const readline = require("readline");

const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const red = (s) => c("31", s);
const green = (s) => c("32", s);
const yellow = (s) => c("33", s);
const magenta = (s) => c("35", s);
const cyan = (s) => c("36", s);

const CLEAR = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTTY = () => process.stdout.isTTY && process.stdin.isTTY;

function enter() {
  if (isTTY()) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdout.write(HIDE_CURSOR);
  }
}

function exit() {
  if (isTTY()) {
    process.stdin.setRawMode(false);
    process.stdout.write(SHOW_CURSOR + "\n");
  }
}

const clear = () => process.stdout.write(CLEAR);
const write = (s) => process.stdout.write(s);
const line = (s = "") => write(s + "\n");

/* Wait for a single keypress. Returns the key object. */
function keypress() {
  return new Promise((resolve) => {
    const handler = (str, key) => {
      process.stdin.removeListener("keypress", handler);
      resolve(key || { name: str });
    };
    process.stdin.on("keypress", handler);
  });
}

/* Classic arrow-key menu. Returns the chosen index, or null on q/esc/ctrl-c. */
async function menu(title, items, hint = "↑/↓ select · Enter confirm · q quit") {
  let sel = 0;
  const render = () => {
    clear();
    line();
    line(`  ${bold(magenta(title))}`);
    line();
    items.forEach((item, i) => {
      const cursor = i === sel ? bold(cyan("  ❯ ")) : "    ";
      const label = i === sel ? bold(item) : dim(item);
      line(`${cursor}${label}`);
    });
    line();
    line(`  ${dim(hint)}`);
  };
  render();
  for (;;) {
    const key = await keypress();
    if (key.name === "up" || key.name === "k") { sel = (sel - 1 + items.length) % items.length; render(); }
    else if (key.name === "down" || key.name === "j") { sel = (sel + 1) % items.length; render(); }
    else if (key.name === "return" || key.name === "enter") return sel;
    else if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) return null;
  }
}

/* Typewriter reveal. Any key skips to the end. */
async function typewriter(text, delay = 11) {
  let skip = false;
  const skipper = () => { skip = true; };
  process.stdin.on("keypress", skipper);
  for (const ch of text) {
    write(ch);
    if (!skip) await sleep(delay);
  }
  process.stdin.removeListener("keypress", skipper);
  line();
}

/* Animated meter that fills to the target ratio. */
async function meter(label, ratio, width = 30) {
  const target = Math.round(ratio * width);
  for (let i = 0; i <= target; i++) {
    const filled = red("█".repeat(i)) + dim("░".repeat(width - i));
    write(`\r  ${label.padEnd(22)} ${filled} ${String(Math.round((i / width) * 100)).padStart(3)}%`);
    await sleep(22);
  }
  line();
}

/* Run an async task with rotating status messages. */
async function withStatus(promise, messages, interval = 420) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let f = 0, m = 0, done = false;
  const timer = setInterval(() => {
    write(`\r  ${cyan(frames[f++ % frames.length])} ${dim(messages[m++ % messages.length])}   `);
  }, interval);
  try {
    const result = await promise;
    done = true;
    write("\r" + " ".repeat(90) + "\r");
    return result;
  } finally {
    clearInterval(timer);
  }
}

const BANNER = [
  "  ╔═╗╦═╗╦═╗╦╦  ╔═╗╦═╗╔═╗╦ ╦╔═╗╦═╗",
  "  ║ ║╠╦╝╠╦╝║║  ║ ║╠╦╝║ ╦║ ║╚═╗╠╦╝",
  "  ╚═╝╩╚═╩╚═╩═╝╚═╝╩╚═╚═╝╚═╝╚═╝╩╚═",
];

module.exports = {
  c, bold, dim, red, green, yellow, magenta, cyan,
  CLEAR, HIDE_CURSOR, SHOW_CURSOR, BANNER,
  sleep, isTTY, enter, exit, clear, write, line,
  keypress, menu, typewriter, meter, withStatus,
};
