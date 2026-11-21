FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssh-server ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --shell /usr/sbin/nologin fixture

COPY entrypoint.sh /usr/local/bin/fixture-sshd
RUN chmod 0755 /usr/local/bin/fixture-sshd

ENTRYPOINT ["/usr/local/bin/fixture-sshd"]
