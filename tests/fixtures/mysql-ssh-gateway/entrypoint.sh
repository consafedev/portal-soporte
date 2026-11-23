#!/bin/sh
set -eu

case "${FIXTURE_MYSQL_DESTINATION:-}" in
  *:3306) ;;
  *) echo 'FIXTURE_MYSQL_DESTINATION_INVALID' >&2; exit 64 ;;
esac

install -d -m 0700 -o fixture -g fixture /home/fixture/.ssh
install -m 0600 -o fixture -g fixture /run/fixture/authorized_keys /home/fixture/.ssh/authorized_keys
# Desbloquea la cuenta efímera con una contraseña aleatoria provista solo por el fixture.
if [ -z "${FIXTURE_SSH_PASSWORD:-}" ]; then
  echo 'SSH_FIXTURE_PASSWORD_REQUIRED' >&2
  exit 64
fi
clave_hash_sintetica="$(printf '%s' "${FIXTURE_SSH_PASSWORD}" | openssl passwd -6 -stdin)"
printf 'fixture:%s\n' "${clave_hash_sintetica}" | chpasswd --encrypted
unset clave_hash_sintetica
unset FIXTURE_SSH_PASSWORD
ssh-keygen -A
install -d -m 0755 /run/sshd
cat > /run/sshd/sshd_config <<EOF
Port 22
ListenAddress 0.0.0.0
HostKey /etc/ssh/ssh_host_ed25519_key
PubkeyAuthentication yes
AuthenticationMethods any
AuthorizedKeysFile .ssh/authorized_keys
PasswordAuthentication yes
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin no
AllowAgentForwarding no
AllowTcpForwarding local
PermitOpen ${FIXTURE_MYSQL_DESTINATION}
X11Forwarding no
PermitTTY no
MaxSessions 0
UsePAM no
StrictModes yes
LogLevel VERBOSE
EOF
exec /usr/sbin/sshd -D -e -f /run/sshd/sshd_config
