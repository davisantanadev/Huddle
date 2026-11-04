#!/usr/bin/env bash
# Apaga a conta de teste criada por engano na produção:
#   usuário upd_teste_x4324, id u_637df5bdfae1, e-mail u@example.test
# Faz backup antes, para o serviço, apaga numa transação e liga de novo.
#
#   scp -i ~/.ssh/eco-server.key ops/apagar-conta-de-teste.sh ubuntu@129.159.51.96:/tmp/
#   ssh -i ~/.ssh/eco-server.key ubuntu@129.159.51.96 'sudo bash /tmp/apagar-conta-de-teste.sh'
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo."; exit 1; }
DB=/var/lib/eco/discord_platform_v2.sqlite
ID=u_637df5bdfae1
install -d -m 700 /var/backups/eco-diario
systemctl stop eco
cp -a "$DB" "/var/backups/eco-diario/antes-de-apagar-teste-$(date +%Y%m%d-%H%M).sqlite"
cd /opt/eco
sudo -u eco node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$DB');
const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get('$ID');
if (!user || user.username !== 'upd_teste_x4324') { console.log('Conta de teste não encontrada (já apagada?)'); process.exit(0); }
db.exec('PRAGMA foreign_keys = ON');
db.exec('BEGIN');
// Toda tabela com uma coluna que aponta para um usuário
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type = 'table'\").all().map((t) => t.name);
let removed = 0;
for (const t of tables) {
  const cols = db.prepare('PRAGMA table_info(' + JSON.stringify(t) + ')').all().map((c) => c.name);
  for (const c of cols.filter((c) => /^(user_id|user1_id|user2_id|requester_id|addressee_id|author_id|actor_id|owner_id)$/.test(c))) {
    if (t === 'users') continue;
    removed += db.prepare('DELETE FROM ' + JSON.stringify(t) + ' WHERE ' + JSON.stringify(c) + ' = ?').run('$ID').changes;
  }
}
db.prepare('DELETE FROM users WHERE id = ?').run('$ID');
db.exec('COMMIT');
console.log('Conta apagada; ' + removed + ' registros ligados a ela removidos.');
"
systemctl start eco
sleep 3
systemctl is-active eco
