'use strict';

// A query opened in SQL Server Management Studio without CSharpShooter SQL: saved as a .sql file and handed to the newest
// SSMS installed, with SSMS 22's switches (-S, -d, -U, -A, -C, -N) of a connection string of the page's project.
const fs = require('fs');
const os = require('os');
const path = require('path');

/** A connection string's keys (lower case) and values; quoted values may hold ';'. */
function pairs(text) {
  const out = {};
  for (const m of (text || '').matchAll(/\s*([^=;]+?)\s*=\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|[^;]*)\s*(?:;|$)/g)) {
    const raw = m[2].trim();
    out[m[1].toLowerCase()] = /^["']/.test(raw) ? raw.slice(1, -1).replace(/""|''/g, (q) => q[0]) : raw;
  }
  return out;
}

const first = (p, names) => names.map((n) => p[n]).find((v) => v !== undefined);
const isTrue = (v) => /^(true|yes|sspi)$/i.test(v || '');

/** SSMS's switches for a connection string: Windows authentication where no -U or -A is given; never the password. */
function ssmsArguments(text) {
  if (!text) return [];
  const p = pairs(text);
  const out = [];
  const server = first(p, ['data source', 'server', 'address', 'addr', 'network address']);
  const database = first(p, ['initial catalog', 'database']);
  const user = first(p, ['user id', 'uid', 'user']);
  const authentication = first(p, ['authentication']);
  const integrated = isTrue(first(p, ['integrated security', 'trusted_connection']));
  const encrypt = first(p, ['encrypt']);
  if (server) out.push('-S', server);
  if (database) out.push('-d', database);
  if (!integrated && authentication && !/^sql\s*password$/i.test(authentication)) out.push('-A', authentication.replace(/\s+/g, ''));
  if (!integrated && user) out.push('-U', user);
  if (isTrue(first(p, ['trust server certificate', 'trustservercertificate']))) out.push('-C');
  out.push('-N', /^strict$/i.test(encrypt || '') ? 'Strict' : encrypt === undefined || isTrue(encrypt) || /^mandatory$/i.test(encrypt) ? 'Mandatory' : 'Optional');
  return out;
}

/** The newest SSMS installed: SSMS 21 and later under Release\Common7\IDE, earlier ones under Common7\IDE. */
function ssmsPath() {
  const found = [];
  for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root).filter((d) => /^Microsoft SQL Server Management Studio \d+$/i.test(d));
    } catch {
      continue;
    }
    for (const dir of dirs) {
      const exe = ['Release\\Common7\\IDE\\SSMS.exe', 'Common7\\IDE\\Ssms.exe'].map((p) => path.join(root, dir, p)).find((p) => fs.existsSync(p));
      if (exe) found.push({ version: Number(/\d+$/.exec(dir)[0]), exe });
    }
  }
  return found.sort((a, b) => b.version - a.version)[0]?.exe;
}

/** The ConnectionStrings of the appsettings*.json in the folder nearest above the page that has one. */
function projectConnections(file) {
  // shortcut: user secrets are not read here (CSharpShooter SQL's SSMS lens reads them); add them if a project keeps its string there.
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => /^appsettings(\..+)?\.json$/i.test(n));
    } catch {
      names = [];
    }
    const found = [];
    for (const name of names) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')
          .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s || '')
          .replace(/,(\s*[}\]])/g, '$1'));
        for (const [key, value] of Object.entries(json.ConnectionStrings || {})) {
          if (typeof value === 'string' && value.includes('=') && !found.some((f) => f.connectionString === value)) found.push({ name: key, file: name, connectionString: value });
        }
      } catch {
        // an appsettings that is not JSON gives nothing
      }
    }
    if (found.length || path.dirname(dir) === dir) return found;
  }
}

/** Writes the query to %TEMP%\csharpshooter-sql\<name>.sql and starts SSMS on it; the file, or why not. */
function openInSsms(text, name, connectionString) {
  const exe = ssmsPath();
  if (!exe) return { error: 'SQL Server Management Studio was not found in Program Files.' };
  const dir = path.join(os.tmpdir(), 'csharpshooter-sql');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(name || 'query').replace(/[^\w.-]+/g, '-')}.sql`);
  // One kind of line end (CRLF, as SSMS saves), or SSMS asks to normalize them: the page's and the added DECLAREs' differ.
  fs.writeFileSync(file, String(text).replace(/\r?\n/g, '\r\n'));
  require('child_process').spawn(exe, [file, ...ssmsArguments(connectionString), '-nosplash'], { detached: true, stdio: 'ignore' }).unref();
  return { file };
}

module.exports = { ssmsArguments, ssmsPath, projectConnections, openInSsms };
