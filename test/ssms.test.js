'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ssmsArguments, projectConnections } = require('../ssms');

function test(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (err) {
    console.error('not ok - ' + name);
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

test('SSMS switches of a connection string, never its password', () => {
  assert.deepStrictEqual(ssmsArguments('Server=.\\SQLEXPRESS;Database=Shop;Integrated Security=true;TrustServerCertificate=true'),
    ['-S', '.\\SQLEXPRESS', '-d', 'Shop', '-C', '-N', 'Mandatory']);
  assert.deepStrictEqual(ssmsArguments('Data Source=db;Initial Catalog=Shop;User ID=app;Password="a;b";Encrypt=False'),
    ['-S', 'db', '-d', 'Shop', '-U', 'app', '-N', 'Optional']);
  assert.deepStrictEqual(ssmsArguments('Server=x;Authentication=Active Directory Default;Encrypt=Strict'),
    ['-S', 'x', '-A', 'ActiveDirectoryDefault', '-N', 'Strict']);
  assert.ok(!ssmsArguments('Server=a;User ID=u;Password=secret').includes('secret'));
});

test('connection strings of the nearest folder above the page with an appsettings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssms-test-'));
  const views = path.join(root, 'Web', 'Views', 'Home');
  fs.mkdirSync(views, { recursive: true });
  fs.writeFileSync(path.join(root, 'appsettings.json'), '{ "ConnectionStrings": { "Other": "Server=other" } }');
  fs.writeFileSync(path.join(root, 'Web', 'appsettings.json'), '{\n  // the app\'s\n  "ConnectionStrings": { "Main": "Server=a;Database=b", },\n}');
  fs.writeFileSync(path.join(root, 'Web', 'appsettings.Development.json'), '{ "ConnectionStrings": { "Main": "Server=a;Database=b", "Dev": "Server=dev" } }');
  assert.deepStrictEqual(projectConnections(path.join(views, 'Index.cshtml')).map((c) => c.name), ['Main', 'Dev']);
  fs.rmSync(root, { recursive: true, force: true });
});
