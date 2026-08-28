const fs = require("fs");

const md = fs.readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
const headings = [...md.matchAll(/^## \[([^\]]+)\]/gm)].filter(
  (match) => match[1].toLowerCase() !== "unreleased"
);
if (!headings.length) {
  throw new Error("No changelog entries found (expected a ## [x.y.z] heading).");
}

const start = headings[0].index;
const end = headings[1] ? headings[1].index : md.length;
const notes = md.slice(start, end).trim();
if (!notes) {
  throw new Error("Latest changelog entry is empty.");
}

fs.writeFileSync("release-notes.md", `${notes}\n`, "utf8");
console.log(notes);
