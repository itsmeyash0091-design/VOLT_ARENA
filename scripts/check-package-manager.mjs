// Cross-platform guard: do not require a Unix shell on judges' Windows machines.
if (!(process.env.npm_config_user_agent || '').startsWith('pnpm/')) {
  console.error('Use pnpm install --frozen-lockfile. This project uses pnpm workspaces.');
  process.exit(1);
}
