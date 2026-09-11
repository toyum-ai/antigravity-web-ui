module.exports = {
  apps: [
    {
      name: 'antigravity-web-ui',
      script: './server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3999,
        HOST: '0.0.0.0',
        AGY_PATH: '/root/.local/bin/agy',
        DEFAULT_WORKSPACE: process.env.DEFAULT_WORKSPACE || '/opt/1panel/www/sites/wc.toyum.cn/index'
      }
    }
  ]
};
