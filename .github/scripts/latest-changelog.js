const fs = require("fs");

const md = fs.readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
const starts = [];
for (const match of md.matchAll(/^## \[/gm)) {
  starts.push(match.index);
}
if (!starts.length) {
  throw new Error("No changelog entries found (expected a ## [x.y.z] heading).");
}

const notes = md.slice(starts[0], starts[1] ?? md.length).trim();
if (!notes) {
  throw new Error("Latest changelog entry is empty.");
}

fs.writeFileSync("release-notes.md", `${notes}\n`, "utf8");
console.log(notes);
