# Oscarr Plugin — qBittorrent Manager

Live view of your qBittorrent torrents queue and transfer stats inside Oscarr.

## Features (v0.1)

- **Downloads** nav page — full torrent list with progress, speeds, ETA, sortable by activity, refresh polling 5s.
- **Dashboard widget** — top 5 active transfers + global up/down speed, drag-and-drop on the admin Dashboard tab.
- Read-only — pause/resume/delete actions land in v0.2.

## Requirements

- Oscarr **>= 0.7.0**
- A working **qBittorrent** service configured in Admin → Services. Connection test must pass.

## Install

Drop the plugin folder into Oscarr's plugins directory (`OSCARR_PLUGINS_DIR` or `packages/plugins/`), restart the backend, then enable in Admin → Plugins.

Or download the latest tarball release:

\`\`\`bash
# from Admin → Plugins → "Install from URL"
https://github.com/arediss/Oscarr-Plugin-qBittorrent/releases/latest
\`\`\`

## Permissions

This plugin declares one core permission:

- `qbittorrent.view` — gates all read endpoints. Granted by default to admins; assign to other roles via Admin → Roles.

## Settings

| Key                 | Type   | Default | Description                                            |
|---------------------|--------|---------|--------------------------------------------------------|
| `refreshIntervalMs` | number | `5000`  | Polling interval for the queue and dashboard widget.   |

## Development

\`\`\`bash
npm install
npm run build      # one-shot
npm run dev        # esbuild + tailwind watch
\`\`\`

## License

MIT
