/**
 * Dev-only: proxy Agent / OAuth API / MCP to Express (:3001).
 * Do NOT proxy /oauth/mcp — that is the React consent page served by CRA.
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const target = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';
  const options = {
    target,
    changeOrigin: true,
    logLevel: 'warn',
  };

  app.use('/api', createProxyMiddleware(options));
  app.use('/mcp', createProxyMiddleware(options));
  app.use('/.well-known', createProxyMiddleware(options));

  // OAuth API endpoints only — keep SPA route /oauth/mcp on CRA.
  app.use(
    ['/oauth/register', '/oauth/authorize', '/oauth/token', '/oauth/approve', '/oauth/revoke'],
    createProxyMiddleware(options),
  );
};
