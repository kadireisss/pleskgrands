const path = require("path");

module.exports = {
  apps: [
    {
      name: "hocam-merhaba",
      script: "dist/index.cjs",
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "700M",
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: "production",
        PORT: "5000",
      },
      out_file: "logs/pm2-out.log",
      error_file: "logs/pm2-error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
