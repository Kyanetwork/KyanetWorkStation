module.exports = {
  apps: [
    {
      name: "kyanet-workstation",
      script: "server/app.js",
      cwd: "/var/www/kyanet-workstation",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
