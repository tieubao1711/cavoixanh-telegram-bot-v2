module.exports = {
  apps: [
    {
      name: 'cavoixanh-telegram-bot-v2',
      script: 'src/bot.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      restart_delay: 3000,
      kill_timeout: 10000
    }
  ]
};
