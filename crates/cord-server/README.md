# cord-server

Cord's self-hosted sync server. It keeps every change your devices send and
hands them to your other devices. It never merges or edits your notes.

## Run it

    docker build -f crates/cord-server/Dockerfile -t cord-server crates
    docker run -d --name cord-server -p 8787:8787 -v cord-data:/data cord-server

Put it behind a reverse proxy with a real certificate, for example Caddy:

    notes.example.org {
        reverse_proxy localhost:8787
    }

Cord refuses plain `http://` to anything but `localhost`.

## Accounts

There is no sign-up. Make a one-time invite code (valid 7 days, `--days` to change):

    docker exec cord-server cord-server invite --data /data

Share a vault with another account:

    docker exec cord-server cord-server member add <vault-id> <username> editor --data /data

## Data

Everything is in `/data/server.db`. Back that file up.
