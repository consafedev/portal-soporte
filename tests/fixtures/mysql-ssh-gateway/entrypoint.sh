#!/bin/sh
set -eu

case "${FIXTURE_MYSQL_DESTINATION:-}" in
  *:3306) ;;
  *) echo 'FIXTURE_MYSQL_DESTINATION_INVALID' >&2; exit 64 ;;
esac

install -d -m 0700 -o fixture -g fixture /home/fixture/.ssh
install -m 0600 -o fixture -g fixture /run/fixture/authorized_keys /home/fixture/.ssh/authorized_keys
ssh-keygen -A
install -d -m 0755 /run/sshd
cat > /run/sshd/sshd_config <<EOF
Port 22
ListenAddress 0.0.0.0
HostKey /etc/ssh/ssh_host_ed25519_key
PubkeyAuthentication yes
AuthenticationMethods publickey
AuthorizedKeysFile .ssh/authorized_keys
PasswordAuthentication no
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
