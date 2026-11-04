#!/usr/bin/env bash
# Endurece o servidor do Huddle (Ubuntu 24.04, Oracle Cloud). Pode rodar mais de
# uma vez: cada passo confere antes de mudar.
#
#   scp -i ~/.ssh/eco-server.key ops/endurecer-servidor.sh ubuntu@129.159.51.96:/tmp/
#   ssh -i ~/.ssh/eco-server.key ubuntu@129.159.51.96 'sudo bash /tmp/endurecer-servidor.sh'
#
# O que faz:
#   1. atualiza os pacotes do sistema (avisa se precisa reiniciar)
#   2. fail2ban bloqueando quem erra o SSH 5 vezes em 10 minutos (1 hora)
#   3. SSH: root não entra mais (o usuário ubuntu, com sudo, continua)
#   4. desliga o rpcbind (porta 111, não é usado)
#   5. backups antigos do banco legíveis só pelo dono
#   6. backup diário do banco às 4h, guardado por 14 dias, só root lê
#   7. cabeçalhos de segurança a mais no Caddy (confere a config antes de recarregar)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
say() { printf '\n== %s\n' "$1"; }

say "1. Pacotes"
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::="--force-confold" upgrade
if [ -f /var/run/reboot-required ]; then echo "ATENÇÃO: o sistema pede reinício (sudo reboot) para usar o kernel novo."; fi

say "2. fail2ban no SSH"
apt-get -y -qq install fail2ban >/dev/null
cat > /etc/fail2ban/jail.d/sshd-huddle.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban
sleep 2
fail2ban-client status sshd | head -3

say "3. SSH sem login do root"
id ubuntu >/dev/null && sudo -l -U ubuntu | grep -q "(ALL" || { echo "O usuário ubuntu não tem sudo: passo pulado para não trancar o acesso."; SKIP_SSH=1; }
if [ -z "${SKIP_SSH:-}" ]; then
  echo "PermitRootLogin no" > /etc/ssh/sshd_config.d/99-huddle.conf
  sshd -t && systemctl reload ssh
  sshd -T | grep -E "^(permitrootlogin|passwordauthentication) "
  echo "Teste agora, em OUTRO terminal, que ainda entra: ssh -i ~/.ssh/eco-server.key ubuntu@129.159.51.96"
fi

say "4. rpcbind (porta 111)"
if systemctl cat rpcbind.service >/dev/null 2>&1; then
  if systemctl list-dependencies --reverse rpcbind.service 2>/dev/null | grep -E "nfs|ypbind" >/dev/null; then
    echo "Algo depende do rpcbind: deixado como está."
  else
    systemctl disable --now rpcbind.socket rpcbind.service 2>/dev/null || true
    echo "rpcbind desligado."
  fi
fi

say "5. Permissões dos backups antigos"
chmod 600 /var/lib/eco/backup-before-*.sqlite 2>/dev/null || true
ls -l /var/lib/eco/*.sqlite | awk '{print $1, $9}'

say "6. Backup diário do banco"
install -d -m 700 -o root -g root /var/backups/eco-diario
cat > /usr/local/sbin/eco-backup <<'EOF'
#!/usr/bin/env bash
# Cópia consistente do banco do Huddle (VACUUM INTO), guardada 14 dias
set -euo pipefail
dest=/var/backups/eco-diario/eco-$(date +%Y%m%d-%H%M).sqlite
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/var/lib/eco/discord_platform_v2.sqlite',{readOnly:true}).exec(\"VACUUM INTO '$dest'\")" 2>/dev/null
chmod 600 "$dest"
find /var/backups/eco-diario -name 'eco-*.sqlite' -mtime +14 -delete
EOF
chmod 700 /usr/local/sbin/eco-backup
cat > /etc/systemd/system/eco-backup.service <<'EOF'
[Unit]
Description=Backup do banco do Huddle
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/eco-backup
EOF
cat > /etc/systemd/system/eco-backup.timer <<'EOF'
[Unit]
Description=Backup diário do banco do Huddle
[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now eco-backup.timer >/dev/null
/usr/local/sbin/eco-backup && ls -l /var/backups/eco-diario | tail -2

say "7. Cabeçalhos no Caddy"
cf=/etc/caddy/Caddyfile
if ! grep -q "Referrer-Policy" "$cf"; then
  cp "$cf" "$cf.bak-$(date +%Y%m%d%H%M)"
  sed -i 's/\t\tX-Content-Type-Options "nosniff"/\t\tX-Content-Type-Options "nosniff"\n\t\tReferrer-Policy "no-referrer"\n\t\tX-Frame-Options "DENY"\n\t\tPermissions-Policy "camera=(), microphone=(), geolocation=()"/' "$cf"
  if caddy validate --config "$cf" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy && echo "Caddy recarregado com os cabeçalhos novos."
  else
    echo "Config do Caddy inválida: voltando a anterior."; cp "$(ls -t $cf.bak-* | head -1)" "$cf"
  fi
fi
grep -q "^\s*log" "$cf" && echo "ATENÇÃO: há log de acesso no Caddy (a URL de eventos antiga leva o token)" || echo "Caddy sem log de acesso (bom)."

say "Pronto"
systemctl is-active eco caddy coturn fail2ban | paste -sd" "
