For lack of a better place to put it, this folder contains the compose file used to deploy the whole DAMPLab stack on an AWS EC2 instance.

# env file

The `.env` file should be located next to the compose file and contain the following values.

```
# Keycloak admin password
KC_BOOTSTRAP_ADMIN_PASSWORD=foo
# Password for the Keycloak db's user
KEYCLOAK_DB_PASSWORD=bar
# AWS access key for volume backups to S3
BACKUP_AWS_ACCESS_KEY_ID=abc
BACKUP_AWS_SECRET_ACCESS_KEY=123
# JWKs endpoint against which backend checks tokens
JWKS_ENDPOINT=https://damplab-keycloak.sail.codes/realms/damplab/protocol/openid-connect/certs
```

# TLS certificates

Keycloak in production mode requires TLS. Compose is currently configured to expect a `/tls` directory located next to it containing `fullchain17.pem` and `privkey17.pem`. (There is no reason for the 17. The current SAIL certs were named that way.)
