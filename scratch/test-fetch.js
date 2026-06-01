import { argv } from "node:process";

async function test() {
  console.log("Starting fetch test...");
  try {
    const res = await fetch("http://localhost:4096/global/health");
    console.log("Status:", res.status);
    const json = await res.json();
    console.log("JSON:", json);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
