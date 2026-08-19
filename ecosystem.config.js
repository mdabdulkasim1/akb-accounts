module.exports = {
  apps: [{
    name: 'akb-accounts',
    script: 'server.js',
    cwd: '/home/accountsakbgroup/public_html',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3020
    }
  }]
};
