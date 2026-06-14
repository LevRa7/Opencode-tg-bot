#!/usr/bin/env node
// Terminal Agent — standalone script for VM deployment
// Run: node /opt/terminal-agent.js <sessionId> <cols> <rows> [cwd]
// Reads stdin (user input), writes stdout (PTY output + exit marker).

const pty = require("node-pty");

const sessionId = process.argv[2] || "session";
const cols = parseInt(process.argv[3]) || 80;
const rows = parseInt(process.argv[4]) || 24;
const cwd = process.argv[5] || process.cwd();

const term = pty.spawn("bash", [], {
  name: "xterm-256color",
  cols,
  rows,
  cwd,
});

// Forward PTY output to stdout (goes to bot via SSH pipe)
term.onData((data) => process.stdout.write(data));

// Forward stdin to PTY (user text from bot)
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  if (data === "\x03") { term.kill("SIGINT"); return; }
  if (data === "\x04") { process.stdin.pause(); return; }
  term.write(data);
});
process.stdin.resume();

// On exit, write exit marker and quit
term.onExit(({ exitCode, signal }) => {
  if (signal) {
    process.stdout.write("\n[Killed by signal " + signal + "]\n");
  } else {
    process.stdout.write("\n[Exited with code " + exitCode + "]\n");
  }
  process.exit(exitCode ?? 0);
});
