// GET /api/status (Azure Functions, Node programming model v3: function.json + this handler; no npm packages).
// The handler and its cache live at module level, so a warm instance reuses the decrypted records for 5 minutes.
'use strict';
const { makeHandler } = require('../shared/status.js');

const handle = makeHandler({ log: m => console.warn(m) });

module.exports = async function (context, req) {
  const r = await handle(req.headers || {});
  context.res = { status: r.status, headers: r.headers, body: r.body };
};
