#!/usr/bin/env bash
# Run on the Ubuntu VPS, not on a development machine.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo 'Run as root: sudo bash scripts/setup-firewall.sh <SSH-port>' >&2
  exit 1
fi
ssh_port=${1:-}
if [[ ! $ssh_port =~ ^[0-9]+$ ]] || (( ssh_port < 1 || ssh_port > 65535 )); then
  echo 'Specify the actual SSH port (usually 22).' >&2
  exit 1
fi
if [[ $ssh_port == 8080 || $ssh_port == 9090 ]]; then
  echo 'SSH uses a restricted service port; configure firewall manually to avoid lockout.' >&2
  exit 1
fi
if ! command -v ufw >/dev/null; then
  apt-get update
  apt-get install -y ufw
fi
# Preserve existing rules; allow SSH before enabling the firewall.
ufw allow "$ssh_port/tcp" comment 'SSH access'
ufw allow 80/tcp comment 'Website HTTP'
ufw allow 443/tcp comment 'Website HTTPS'
ufw allow 3000/tcp comment 'Grafana login'
# Prepend these restrictions so previous broad allow rules cannot override them.
ufw insert 1 deny in proto tcp to any port 8080 comment 'Backend internal only'
ufw insert 1 deny in proto tcp to any port 9090 comment 'Prometheus internal only'
ufw default deny incoming
ufw default allow outgoing
ufw --force enable
ufw status verbose
# Docker can bypass UFW: compose.yaml must keep backend on loopback and
# Prometheus unpublished. Do not publish their ports via compose overrides.
